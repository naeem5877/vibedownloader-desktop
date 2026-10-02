/*
 * YouTube extraction strategy, URL redaction, and the wiring around them.
 *
 * The behaviour worth locking down here is a judgement call: deciding that a
 * *successful* extraction returned too little to be trusted, and retrying once.
 * Both directions matter. Too eager and every genuinely low-resolution video pays
 * for a second round trip; too timid and the original bug returns - a 320p
 * answer accepted as success, which is the report that started this.
 *
 * Run against the compiled output:
 *   npm run build:electron && node scripts/test-youtube-strategy.cjs
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const DST = path.join(REPO, 'dist-electron');
const SRC = path.join(REPO, 'electron');

const strategy = require(path.join(DST, 'utils', 'youtubeStrategy.js'));
const { inspectFormats, isDegradedFormatList, formatSummary, isClientSensitiveError } = strategy;
const { redactUrlForLog } = require(path.join(DST, 'utils', 'redact.js'));

/** Build a `--dump-single-json` style payload. */
function raw(formats) {
    return { id: 'x', formats };
}

const video = (height, id) => ({ format_id: id, height, width: height * 16 / 9, vcodec: 'avc1.640028', acodec: 'none' });
const audio = (id) => ({ format_id: id, vcodec: 'none', acodec: 'mp4a.40.2', abr: 128 });

/** A healthy 1080p answer: several video heights plus audio-only streams. */
function healthy() {
    return raw([
        video(1080, '137'), video(720, '136'), video(480, '135'), video(360, '134'),
        audio('140'), audio('251')
    ]);
}

test('inspection measures what came back', () => {
    const insp = inspectFormats(healthy());
    assert.equal(insp.formatCount, 6);
    assert.equal(insp.videoFormatCount, 4);
    assert.equal(insp.audioFormatCount, 2);
    assert.equal(insp.maxHeight, 1080);
    assert.deepEqual(insp.heights, [1080, 720, 480, 360]);
    assert.ok(insp.hasVideo && insp.hasAudio);
});

test('a payload with no formats array at all is measured, not crashed on', () => {
    // The old code would have thrown here and taken the whole request down.
    for (const input of [undefined, null, {}, { formats: null }, { formats: 'nope' }, []]) {
        const insp = inspectFormats(input);
        assert.equal(insp.formatCount, 0);
        assert.equal(insp.maxHeight, 0);
        assert.ok(isDegradedFormatList(insp));
    }
});

test('formats without a usable height do not count as video', () => {
    // Storyboard-only and image formats carry no height; letting one into the
    // video list would make maxHeight meaningless.
    const insp = inspectFormats(raw([
        { format_id: 'sb0', vcodec: 'none', acodec: 'none' },
        { format_id: 'sb1', vcodec: 'vp9', height: null },
        { format_id: 'weird', vcodec: 'vp9', height: 'tall' },
        audio('140')
    ]));
    assert.equal(insp.videoFormatCount, 0);
    assert.equal(insp.maxHeight, 0);
});

test('a real format list is never treated as degraded', () => {
    assert.equal(isDegradedFormatList(inspectFormats(healthy())), false);
});

test('a thin 360p-only list is degraded, which is the 320p report', () => {
    // Exactly what YouTube serves when the JS challenge was not solved: a
    // success, a valid body, and nothing worth downloading.
    const thin = inspectFormats(raw([video(360, '18'), video(240, '133'), audio('140')]));
    assert.equal(thin.maxHeight, 360);
    assert.ok(isDegradedFormatList(thin), 'a couple of low-res streams should earn one retry');
});

test('a 720p-only video is left alone', () => {
    // The rule this file must not grow: "no 1080p" is not a defect. Plenty of
    // real uploads top out at 720p, and retrying them doubles every fetch.
    const only720 = inspectFormats(raw([video(720, '136'), video(480, '135'), audio('140')]));
    assert.equal(isDegradedFormatList(only720), false);

    const single480 = inspectFormats(raw([video(480, '135'), audio('140')]));
    assert.equal(isDegradedFormatList(single480), false, 'one 480p stream is a short list, not an unsolved challenge');
});

test('video with no audio-only stream is degraded', () => {
    // `bestaudio` would fail at download time, after the user has waited for the
    // fetch, so it is worth knowing now.
    const noAudio = inspectFormats(raw([video(1080, '137'), video(720, '136')]));
    assert.equal(isDegradedFormatList(noAudio), true);
});

test('formatSummary says the useful thing for a log', () => {
    assert.match(formatSummary(inspectFormats(healthy())), /6 formats, max 1080p \(1080\/720\/480\/360\), 2 audio/);
    assert.equal(formatSummary(inspectFormats({})), 'no formats returned');
});

test('client-sensitive errors are recognised on stderr, not just on message', () => {
    // yt-dlp leaves `message` generic and puts the real reason on stderr. The
    // retry decision used to read only the message, so these all looked alike.
    const onStderr = (stderr) => Object.assign(new Error('ERROR: unable to extract video data'), { stderr });

    assert.ok(isClientSensitiveError(onStderr('ERROR: [youtube] x: Sign in to confirm your age')));
    assert.ok(isClientSensitiveError(onStderr('ERROR: unable to download: HTTP Error 429')));
    assert.ok(isClientSensitiveError(onStderr('ERROR: [youtube] x: nsig extraction failed')));
    assert.ok(isClientSensitiveError('ERROR: [youtube] x: Sign in to confirm you\'re not a bot'));

    // Still no false positive on unrelated noise.
    assert.equal(isClientSensitiveError(new Error('Request timed out')), false);
    assert.equal(isClientSensitiveError('ERROR: Video unavailable'), false);
});

test('a timeout is not mistaken for a player refusal', () => {
    // Otherwise a slow network burns a second full extraction on every attempt.
    assert.equal(isClientSensitiveError(new Error('Request timed out')), false);
});

test('log-safe URLs keep the video and drop the identity', () => {
    const watch = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=TRACKING-ID-abc&sig=SECRET';
    const redacted = redactUrlForLog(watch);
    assert.match(redacted, /youtube\.com\/watch\?v=dQw4w9WgXcQ/);
    assert.ok(!redacted.includes('SECRET'), 'a signature must not reach a log');
    assert.ok(!redacted.includes('TRACKING-ID-abc'), 'a tracking id must not reach a log');
});

test('log-safe URLs survive the platforms the app actually opens', () => {
    // `www` is kept: it changes which site is meant, and it identifies nobody.
    assert.equal(
        redactUrlForLog('https://www.instagram.com/stories/naeem589020/3456789012/?hl=en'),
        'www.instagram.com/stories/naeem589020/3456789012'
    );
    assert.match(redactUrlForLog('https://music.youtube.com/watch?v=tdnkkMK3N88&list=RDAMVM'), /v=tdnkkMK3N88/);
    assert.equal(redactUrlForLog('https://example.com/path/'), 'example.com/path');
});

test('redaction cannot throw on the failure path it exists to protect', () => {
    for (const input of [undefined, null, 42, '', 'not a url at all', '://broken', { a: 1 }]) {
        const out = redactUrlForLog(input);
        assert.equal(typeof out, 'string');
        assert.ok(out.length > 0);
    }
    // A non-parseable URL keeps only what is before the query string.
    assert.equal(redactUrlForLog('weird link?token=secret'), 'weird link');
});

test('the handler aborts the child on timeout instead of abandoning the wait', () => {
    const handler = fs.readFileSync(path.join(SRC, 'handlers', 'infoHandler.ts'), 'utf8');

    // A bare Promise.race against a timer stops the wait, not the process.
    assert.ok(!/Promise\.race\(\s*\[ytDlpPromise/.test(handler), 'the old race-based timeout is gone');
    assert.match(handler, /new AbortController\(\)/);
    assert.match(handler, /execPromise\(attemptArgs, \{ env: jsRuntimeEnv \}, controller\.signal\)/,
        'the signal has to reach execPromise, which taskkills the child on abort');
    assert.match(handler, /clearTimeout\(timer\)/,
        'a successful extraction must not leave a 60s timer armed');
    assert.match(handler, /if \(timedOut\) throw new Error\('Request timed out'\)/);
});

test('one budget covers the whole request, not each attempt', () => {
    const handler = fs.readFileSync(path.join(SRC, 'handlers', 'infoHandler.ts'), 'utf8');
    assert.match(handler, /const deadline = Date\.now\(\) \+ EXTRACTION_TIMEOUT_MS/);
    assert.match(handler, /Math\.max\(1000, deadline - Date\.now\(\)\)/,
        'the next client attempt only gets what is left of the budget');
});

test('a successful extraction is judged on what it returned', () => {
    const handler = fs.readFileSync(path.join(SRC, 'handlers', 'infoHandler.ts'), 'utf8');
    assert.match(handler, /const inspection = inspectFormats\(raw\)/);
    assert.match(handler, /isDegradedFormatList\(inspection\)/);
    // And the retry is bounded, because the honest answer to a real 240p video
    // is to accept it.
    assert.match(handler, /degradedRetriesLeft--/);
    assert.match(handler, /degradedRetriesLeft > 0/);
});

test('the extraction no longer disables TLS verification', () => {
    // Was on every request, for every site the app can open, to accommodate one
    // machine. A trust store gets fixed; the check does not get turned off.
    // Matched as a quoted flag so the comment that explains its removal does not
    // read as the flag being present.
    for (const file of ['handlers/infoHandler.ts', 'handlers/downloadHandler.ts']) {
        const text = fs.readFileSync(path.join(SRC, file), 'utf8');
        assert.ok(!/'--no-check-certificates'/.test(text), `${file} still disables certificate checks`);
    }
});

test('a non-string URL is rejected before any string method is called on it', () => {
    const handler = fs.readFileSync(path.join(SRC, 'handlers', 'infoHandler.ts'), 'utf8');
    // Scoped to the handler: other functions in the file take a validated string.
    const body = handler.slice(handler.indexOf("ipcMain.handle('get-video-info'"));
    assert.match(body, /typeof url !== 'string'/);
    assert.ok(
        body.indexOf("typeof url !== 'string'") < body.indexOf('url.includes('),
        'the type check must precede the string checks'
    );
});

test('failure logs never carry the raw URL', () => {
    const handler = fs.readFileSync(path.join(SRC, 'handlers', 'infoHandler.ts'), 'utf8');
    assert.match(handler, /url=\$\{redactUrlForLog\(url\)\}/);
    // The bare `console.error("Info fetch error:", e)` dumped yt-dlp's message,
    // which embeds the URL it was given.
    assert.ok(!/console\.error\("Info fetch error:", e\)/.test(handler));

    const download = fs.readFileSync(path.join(SRC, 'handlers', 'downloadHandler.ts'), 'utf8');
    assert.match(download, /\[redactUrlForLog\(args\[0\]\), \.\.\.args\.slice\(1\)\]/,
        'the download arg log has to redact args[0] too');
});

test('the cookie log claims only what is known', () => {
    // A cookie file on disk is not a logged-in session; the site decides that,
    // and only the site knows.
    const handler = fs.readFileSync(path.join(SRC, 'handlers', 'infoHandler.ts'), 'utf8');
    assert.ok(!/Using custom cookies for/.test(handler));
    assert.match(handler, /whether \$\{platformName\} accepts it is not known yet/);
});

test('classification sees stderr as well as the message', () => {
    const handler = fs.readFileSync(path.join(SRC, 'handlers', 'infoHandler.ts'), 'utf8');
    assert.match(handler, /\[e\?\.stderr, e\?\.message\]\.filter\(Boolean\)\.join\('\\n'\)/);
    assert.ok(!/classifyExtractionError\(e\.message \|\| e\.stderr/.test(handler),
        'preferring the message threw away the reason the player was refused');
});

test('the JS runtime is logged with a version, and an old one is rejected', () => {
    const platform = fs.readFileSync(path.join(SRC, 'utils', 'platform.ts'), 'utf8');
    assert.match(platform, /describeJsRuntime/);
    assert.match(platform, /MIN_RUNTIME_MAJOR = 22/,
        'yt-dlp needs Node 22+ for the EJS challenge solver; older silently loses formats');
    // And the spawned environment keeps what Windows needs to run at all.
    assert.match(platform, /\{ \.\.\.process\.env, \.\.\.runtime\.env \}/);
});

test('the Spotify path asks for the same player as everything else', () => {
    const download = fs.readFileSync(path.join(SRC, 'handlers', 'downloadHandler.ts'), 'utf8');
    // `tv_embedded` hardcoded means a cookieless Spotify download is refused by
    // YouTube's embed-player login wall, for a reason unrelated to Spotify.
    assert.ok(!/'youtube:player_client=tv_embedded'/.test(download),
        'the player must come from the strategy, not a literal');
    assert.match(download, /preferredYoutubeClient\(fs\.existsSync\(spotifyCookiePath\)\)/);
});

test('every YouTube download logs what was asked for and what ran it', () => {
    const download = fs.readFileSync(path.join(SRC, 'handlers', 'downloadHandler.ts'), 'utf8');
    assert.match(download, /\[YouTube\] download via \$\{preferred\.label\}/);
    assert.match(download, /js-runtime=\$\{describeJsRuntime\(jsRuntime\)\}/);
});
