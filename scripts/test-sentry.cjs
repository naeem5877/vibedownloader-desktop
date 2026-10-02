/*
 * Error reporting.
 *
 * Two things are worth locking down here. The SDK integration is plumbing and
 * needs no tests; what needs tests is what we send and what we refuse to send,
 * because this is the only code in the app that deliberately ships data off the
 * machine. A stack frame carries `C:\Users\<someone>\`, a watch URL carries a
 * per-visitor signature, and a story URL names whose story it is - all of which
 * would reach a Sentry event by accident, through a frame filename or a console
 * breadcrumb, rather than on purpose.
 *
 * `@sentry/electron/main` cannot be loaded outside Electron (it reads the
 * Electron version at import time), so the tests below cover `telemetry`, where
 * every event is shaped and scrubbed, and check the wiring by reading it. The
 * SDK boundary is three lines of `captureEvent`.
 *
 * Run against the compiled output:
 *   npm run build:electron && node scripts/test-sentry.cjs
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const DST = path.join(REPO, 'dist-electron');
const SRC = path.join(REPO, 'electron');

const telemetry = require(path.join(DST, 'utils', 'telemetry.js'));
const {
    scrubUserName,
    scrubUrls,
    scrubText,
    scrubEvent,
    scrubBreadcrumb,
    buildExtractionFailureEvent,
    buildThinFormatEvent,
    buildDownloadFailureEvent,
    __resetTelemetryState,
    MAX_EVENTS_PER_SESSION
} = telemetry;

test.beforeEach(() => __resetTelemetryState());

test('a Windows account name never leaves the machine', () => {
    const frame = 'C:\\Users\\naeem589020\\AppData\\Roaming\\vibe-downloader\\app.asar\\electron\\main.js';
    assert.equal(scrubUserName(frame), 'C:\\Users\\<user>\\AppData\\Roaming\\vibe-downloader\\app.asar\\electron\\main.js');
    assert.equal(scrubUserName('/Users/naeem589020/Library/Application Support/x.js'), '/Users/<user>/Library/Application Support/x.js');
    assert.equal(scrubUserName('/home/naeem589020/app/main.js'), '/home/<user>/app/main.js');
});

test('URLs are reduced before they are sent', () => {
    const out = scrubUrls('fetching https://www.youtube.com/watch?v=abc123&si=TRACKER&sig=SECRET now');
    assert.match(out, /youtube\.com\/watch\?v=abc123/);
    assert.ok(!out.includes('SECRET'), 'a signature must not be sent');
    assert.ok(!out.includes('TRACKER'), 'a tracking id must not be sent');
});

test('long text is cut, not sent whole', () => {
    // yt-dlp stderr can be a page of HTML; a truncated head still says what
    // happened and keeps the event readable in the UI.
    const out = scrubText('x'.repeat(5000), 100);
    assert.ok(out.length < 200);
    assert.match(out, /truncated/);
});

test('an event is scrubbed on the way out, including its stack frames', () => {
    const event = {
        request: { url: 'https://www.youtube.com/watch?v=abc&sig=SECRET', headers: { Cookie: 'sessionid=abc' } },
        exception: {
            values: [{
                stacktrace: {
                    frames: [{
                        filename: 'C:\\Users\\naeem589020\\app\\main.js',
                        abs_path: 'C:\\Users\\naeem589020\\app\\main.js',
                        context_line: 'const u = "https://youtu.be/abc?si=SECRET"'
                    }]
                }
            }]
        },
        extra: { note: 'cookie_file present', nested: { path: 'C:\\Users\\naeem589020\\notes.txt' } },
        user: { id: '1', email: 'someone@example.com' }
    };

    const out = scrubEvent(event);
    const serialised = JSON.stringify(out);

    assert.ok(!serialised.includes('naeem589020'), 'the username must not survive');
    assert.ok(!serialised.includes('SECRET'), 'neither must a signature');
    assert.ok(!serialised.includes('sessionid'), 'nor a cookie header');
    assert.ok(!serialised.includes('someone@example.com'), 'nor the user block');
    // The useful part is still there.
    assert.match(serialised, /v=abc/);
    assert.match(serialised, /cookie_file present/);
});

test('a console breadcrumb is scrubbed, and a dumped page is dropped', () => {
    const normal = scrubBreadcrumb({
        category: 'console',
        message: 'Fetching info for https://www.youtube.com/watch?v=abc&sig=SECRET'
    });
    assert.ok(!normal.message.includes('SECRET'));
    assert.match(normal.message, /v=abc/);

    // A megabyte of HTML tells nobody anything and bloats the event.
    const huge = scrubBreadcrumb({ category: 'console', message: 'y'.repeat(5000) });
    assert.equal(huge, null);

    // Errors are kept even when large: that is the one worth reading.
    const error = scrubBreadcrumb({ category: 'console.error', message: 'z'.repeat(5000) });
    assert.ok(error.message.length < 1200, 'kept but bounded');
    assert.match(error.message, /truncated/);
});

test('a fetch failure is reported by cause, with the context that explains it', () => {
    const event = buildExtractionFailureEvent({
        url: 'https://www.youtube.com/watch?v=abc123&sig=SECRET&si=TRACK',
        kind: 'bot-check',
        attempt: 'tv_embedded (with cookies)',
        detail: "ERROR: Sign in to confirm you're not a bot",
        ytdlpVersion: '2025.09.26',
        jsRuntime: 'bundled-node 24.18.0',
        cookieFile: true,
        isYoutube: true
    });

    assert.ok(event, 'the first failure of a kind is always reported');
    assert.match(event.message, /Fetch failed: bot-check/);
    assert.equal(event.level, 'error');
    assert.equal(event.tags.kind, 'bot-check');
    assert.equal(event.tags.platform, 'youtube');
    assert.equal(event.extra.player, 'tv_embedded (with cookies)');
    assert.equal(event.extra.cookie_file, 'present');
    // The payload is what leaves the machine, so it is checked here rather than
    // trusted.
    const serialised = JSON.stringify(event);
    assert.ok(!serialised.includes('SECRET'), 'a signature must not be sent');
    assert.ok(!serialised.includes('TRACK'), 'a tracking id must not be sent');
    assert.match(event.extra.url, /v=abc123/);
    assert.equal(event.tags.ytdlp_present, 'yes');
    // A version in a tag is a new series per release, and the tag view turns to
    // noise; the version belongs in the detail.
    assert.equal(event.tags.runtime, 'bundled-node 24.18.0');
});

test('the same failure is not reported twice in a session', () => {
    // A user with no network clicks repeatedly. One report is enough to know the
    // bug exists; a flood is how a rate-limited DSN stops working at all.
    const base = { kind: 'bot-check', isYoutube: true };
    assert.ok(buildExtractionFailureEvent({ ...base, url: 'https://youtu.be/a' }));
    assert.equal(buildExtractionFailureEvent({ ...base, url: 'https://youtu.be/b' }), null, 'same cause, different link');
    // A different cause is a different question, so it still gets through.
    assert.ok(buildExtractionFailureEvent({ ...base, kind: 'private', url: 'https://youtu.be/a' }));
});

test('the session budget is finite', () => {
    let sent = 0;
    for (let i = 0; i < 100; i++) {
        if (buildDownloadFailureEvent({ url: `https://youtu.be/${i}`, kind: `kind-${i}` })) sent++;
    }
    assert.equal(sent, MAX_EVENTS_PER_SESSION, 'exactly the budget, then silence');
    assert.equal(buildDownloadFailureEvent({ url: 'https://youtu.be/x', kind: 'kind-new' }), null);
});

test('a thin format list is reported once per ceiling, and not as an error', () => {
    const base = {
        url: 'https://youtu.be/abc',
        player: 'tv_embedded',
        formatCount: 3,
        videoFormatCount: 2,
        audioFormatCount: 0,
        heights: [360, 240],
        kept: true,
        jsRuntime: 'bundled-node 24.18.0'
    };

    const event = buildThinFormatEvent({ ...base, maxHeight: 360 });
    // The fetch worked and the answer was wrong. Filing it as an error would put
    // every user's 360p report next to real crashes.
    assert.equal(event.level, 'info');
    assert.match(event.message, /max 360p/);
    assert.equal(event.tags.max_height, '360');
    assert.equal(event.tags.outcome, 'kept');
    assert.equal(event.extra.heights, '360/240');

    assert.equal(buildThinFormatEvent({ ...base, maxHeight: 360 }), null, 'same ceiling, same story');
    assert.ok(buildThinFormatEvent({ ...base, maxHeight: 144 }), 'a different ceiling is different data');
});

test('reporting stays off in a dev build unless it is asked for', () => {
    const sentry = fs.readFileSync(path.join(SRC, 'utils', 'sentry.ts'), 'utf8');
    // Development reports would bury the ones that matter.
    assert.match(sentry, /if \(!app\?\.isPackaged && process\.env\[SEND_FROM_DEV\] !== '1'\) return false;/);
    assert.match(sentry, /const SEND_FROM_DEV = 'VD_SENTRY';/);
    assert.match(sentry, /sendDefaultPii: false/);
});

test('main starts reporting before anything else can throw', () => {
    const main = fs.readFileSync(path.join(SRC, 'main.ts'), 'utf8');
    assert.ok(
        main.indexOf('initSentry()') < main.indexOf('initPaths()'),
        'reporting has to be armed before the first thing that can fail'
    );
    assert.ok(main.indexOf('initSentry()') < main.indexOf('createWindow()'));
    assert.match(main, /flushSentry\(\)/);
});

test('the renderer reports without a DSN, keeping the main process the only holder', () => {
    const renderer = fs.readFileSync(path.join(REPO, 'src', 'main.tsx'), 'utf8');
    assert.match(renderer, /from '@sentry\/electron\/renderer'/);
    assert.ok(!/dsn\s*:/.test(renderer), 'the DSN must not be duplicated into the renderer');
    assert.match(renderer, /globalHandlersIntegration\(\)/);
    // The defaults would collect console output and request URLs, which is how a
    // pasted link ends up in an issue by accident.
    assert.match(renderer, /defaultIntegrations: false/);
    assert.match(renderer, /breadcrumbsIntegration\(\{ console: false \}\)/);
    assert.ok(!/httpClientIntegration|browserTracingIntegration/.test(renderer));
});

test('handled failures are reported, not just crashes', () => {
    // These paths return an error to the UI and throw nothing, which is why
    // crash reporting alone never saw them.
    const info = fs.readFileSync(path.join(SRC, 'handlers', 'infoHandler.ts'), 'utf8');
    assert.match(info, /reportExtractionFailure\(\{/);
    assert.match(info, /reportThinFormatList\(\{/);

    const download = fs.readFileSync(path.join(SRC, 'handlers', 'downloadHandler.ts'), 'utf8');
    assert.match(download, /reportDownloadFailure\(\{/);
});

test('no cookie contents or titles are passed to a report', () => {
    // Presence is a boolean; a title is browsing history. Both would be easy to
    // "just include" later, so the call sites are pinned here.
    const info = fs.readFileSync(path.join(SRC, 'handlers', 'infoHandler.ts'), 'utf8');
    assert.match(info, /cookieFile: sentCookies/);
    assert.ok(!/cookieFile: (cookiePath|cookieText|cookies)/.test(info));

    const download = fs.readFileSync(path.join(SRC, 'handlers', 'downloadHandler.ts'), 'utf8');
    const start = download.indexOf('reportDownloadFailure({');
    const call = download.slice(start, download.indexOf('});', start));
    assert.ok(call.length > 0, 'the call site exists');
    assert.ok(!call.includes('searchQuery'));
    assert.ok(!call.includes('title'));
});
