/*
 * Music tags for audio downloads.
 *
 * The behaviour worth locking down is the part that touches a file: a WAV has
 * to come out of the tagger still being a bit-identical WAV. Everything else is
 * pure mapping, which is cheap to check directly.
 *
 * Run against the compiled output:
 *   npm run build:electron && node scripts/test-music-tags.cjs
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const DST = path.join(REPO, 'dist-electron');
const SRC = path.join(REPO, 'electron');

/**
 * The compiled modules reach for Electron at import time. Only two things are
 * asked for: the userData folder, to find the managed ffmpeg, and nothing else.
 */
function loadModule() {
    const Module = require('module');
    const original = Module._load;
    Module._load = function (request, ...rest) {
        if (request === 'electron') {
            return {
                app: { getPath: () => path.join(process.env.APPDATA, 'vibe-downloader') },
                BrowserWindow: { getAllWindows: () => [] },
                Notification: class { static isSupported() { return false; } }
            };
        }
        return original.call(this, request, ...rest);
    };
    try {
        const binaries = require(path.join(DST, 'utils', 'binaries.js'));
        // main.ts does this at startup; without it the ffmpeg paths are unset.
        binaries.initPaths();
        return { tags: require(path.join(DST, 'utils', 'musicTags.js')), binaries };
    } finally {
        Module._load = original;
    }
}

const { tags: M, binaries } = loadModule();
const FFMPEG = binaries.getFfmpegBinaryPath();
const FFPROBE = binaries.getFfprobePath();

function makeSilentWav(file) {
    execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
        '-i', 'sine=frequency=440:duration=1', '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', file]);
}

/** The decoded audio, so "did we re-encode?" has an answer. */
function audioHash(file) {
    return execFileSync(FFMPEG, ['-v', 'error', '-i', file, '-f', 'hash', '-hash', 'sha256', '-'],
        { encoding: 'utf8' }).trim();
}

function formatTags(file) {
    const out = execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format_tags', '-of', 'json', file],
        { encoding: 'utf8' });
    return JSON.parse(out).format.tags || {};
}

function isRiffWav(file) {
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(12);
    fs.readSync(fd, head, 0, 12, 0);
    fs.closeSync(fd);
    return head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WAVE';
}

function tmpFile(name) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-tags-'));
    return path.join(dir, name);
}

// ---- what counts as music ---------------------------------------------------

// The exact shapes yt-dlp reports today: a "Topic" upload carries the full
// identity, anything else carries none of it.
const MUSIC_INFO = {
    title: 'Maahiya',
    uploader: 'Release - Topic',
    channel: 'Release - Topic',
    track: 'Maahiya',
    artist: 'Tushar Joshi, Neeti Mohan, Akashdeep Sengupta, Lavraj, Gaurab Chakraborty',
    artists: ['Tushar Joshi', 'Neeti Mohan', 'Akashdeep Sengupta', 'Lavraj', 'Gaurab Chakraborty'],
    album: 'The Revolutionaries',
    release_year: 2026,
    release_date: '20260319',
    upload_date: '20260904'
};

const TUTORIAL_INFO = {
    title: 'This is how real people get good at Video Editing (FAST)',
    uploader: 'Aasil Khan',
    channel: 'Aasil Khan',
    track: '',
    artist: '',
    album: '',
    release_year: null,
    upload_date: '20260826'
};

test('a song keeps its identity', () => {
    const t = M.parseMusicTags(MUSIC_INFO);
    assert.strictEqual(t.title, 'Maahiya');
    assert.match(t.artist, /Neeti Mohan/);
    assert.strictEqual(t.album, 'The Revolutionaries');
    assert.strictEqual(t.year, '2026');
});

test('a tutorial is not a song and is left alone', () => {
    assert.strictEqual(M.parseMusicTags(TUTORIAL_INFO), null);
});

test('nothing to describe means nothing is written', () => {
    for (const info of [null, undefined, {}, 'a string', 42, { track: '   ' }, { track: 'Song' }]) {
        assert.strictEqual(M.parseMusicTags(info), null, `${JSON.stringify(info)} should not be music`);
    }
});

test('the artist list stands in when the credited string is missing', () => {
    const t = M.parseMusicTags({ track: 'Song', artists: ['A', 'B', ''] });
    assert.strictEqual(t.artist, 'A, B');
});

test('the album alone is enough to make it music', () => {
    const t = M.parseMusicTags({ track: 'Song', album: 'Best Of' });
    assert.strictEqual(t.artist, '');
    assert.strictEqual(t.album, 'Best Of');
});

test('the year is normalised, and nonsense is dropped', () => {
    assert.strictEqual(M.parseMusicTags({ track: 'S', artist: 'A', release_date: '20260319' }).year, '2026');
    assert.strictEqual(M.parseMusicTags({ track: 'S', artist: 'A', release_year: 'unknown' }).year, undefined);
});

// ---- shaping the tags ------------------------------------------------------

test('the node-id3 patch carries only what is known', () => {
    assert.deepStrictEqual(
        M.buildNodeId3Tags({ title: 'Maahiya', artist: 'A, B', album: 'Album', year: '2026' }),
        { title: 'Maahiya', artist: 'A, B', album: 'Album', year: '2026' }
    );
    assert.deepStrictEqual(
        M.buildNodeId3Tags({ title: 'Maahiya', artist: 'A' }),
        { title: 'Maahiya', artist: 'A' }
    );
});

test('ffmpeg gets a -metadata pair per known field', () => {
    assert.deepStrictEqual(
        M.buildFfmpegMetadataArgs({ title: 'T', artist: 'A', album: 'Al', year: '2026', genre: 'Pop' }),
        ['-metadata', 'title=T', '-metadata', 'artist=A', '-metadata', 'album=Al',
            '-metadata', 'date=2026', '-metadata', 'genre=Pop']
    );
    assert.deepStrictEqual(M.buildFfmpegMetadataArgs({ title: 'T', artist: 'A' }),
        ['-metadata', 'title=T', '-metadata', 'artist=A']);
});

// ---- the part that touches the file ---------------------------------------

test('a WAV gains tags and keeps every sample', { skip: FFMPEG ? false : 'ffmpeg is not available' }, async () => {
    const file = tmpFile('tagged.wav');
    makeSilentWav(file);
    const before = audioHash(file);

    assert.strictEqual(await M.embedTagsWithFfmpeg(file, {
        title: 'Maahiya', artist: 'Tushar Joshi, Neeti Mohan', album: 'The Revolutionaries',
        year: '2026', genre: 'Soundtrack'
    }), true);

    const tags = formatTags(file);
    assert.strictEqual(tags.title, 'Maahiya');
    assert.strictEqual(tags.artist, 'Tushar Joshi, Neeti Mohan');
    assert.strictEqual(tags.album, 'The Revolutionaries');
    assert.strictEqual(tags.date, '2026');
    assert.strictEqual(tags.genre, 'Soundtrack');

    // The whole point: a WAV that now carries metadata must still be the same
    // audio, in the same container, sample for sample.
    assert.strictEqual(audioHash(file), before, 'the audio must not be re-encoded');
    assert.ok(isRiffWav(file), 'must still be a RIFF/WAVE file');
    assert.strictEqual(fs.existsSync(path.join(path.dirname(file), `.tagged.wav.tagging.wav`)), false,
        'no temp file may be left behind');
});

test('re-tagging replaces the tags instead of stacking them', { skip: FFMPEG ? false : 'ffmpeg is not available' }, async () => {
    const file = tmpFile('retagged.wav');
    makeSilentWav(file);
    const before = audioHash(file);

    await M.embedTagsWithFfmpeg(file, { title: 'First', artist: 'A', album: 'One' });
    await M.embedTagsWithFfmpeg(file, { title: 'Second', artist: 'B', album: 'Two' });

    const tags = formatTags(file);
    assert.strictEqual(tags.title, 'Second');
    assert.strictEqual(tags.album, 'Two');
    assert.strictEqual(tags.artist, 'B');
    assert.strictEqual(audioHash(file), before);
});

test('a file that cannot be tagged is left exactly as it was', { skip: FFMPEG ? false : 'ffmpeg is not available' }, async () => {
    const file = tmpFile('not-audio.wav');
    fs.writeFileSync(file, 'this is not audio');
    const before = fs.readFileSync(file);

    assert.strictEqual(await M.embedTagsWithFfmpeg(file, { title: 'T', artist: 'A' }), false);
    assert.deepStrictEqual(fs.readFileSync(file), before, 'a failed tag write must not damage the file');
    assert.deepStrictEqual(
        fs.readdirSync(path.dirname(file)).filter((f) => f.includes('tagging')),
        [], 'no temp file may be left behind'
    );
});

test('nothing to write, nothing attempted', async () => {
    assert.strictEqual(await M.embedTagsWithFfmpeg(tmpFile('absent.wav'), { title: 'T', artist: 'A' }), false);
});

// ---- the wiring ------------------------------------------------------------

test('only audio downloads ask for tags', () => {
    const src = fs.readFileSync(path.join(SRC, 'handlers', 'downloadHandler.ts'), 'utf8');
    assert.match(src, /if \(isYoutube && formatId && formatId\.startsWith\('audio_'\)\) \{\s*tagsPromise = fetchMusicTags\(url\)/);
});

test('both audio formats are tagged on the way out', () => {
    const src = fs.readFileSync(path.join(SRC, 'handlers', 'downloadHandler.ts'), 'utf8');
    // Split at the Spotify handler so each assertion is about one code path,
    // instead of about how many characters separate two lines.
    const split = src.indexOf("ipcMain.handle('download-spotify-track'");
    assert.ok(split > 0, 'the Spotify handler should still be here');
    const youtube = src.slice(0, split);
    const spotify = src.slice(split);

    assert.match(youtube, /buildNodeId3Tags\(musicTags\)/, 'the MP3 should be tagged through node-id3');
    assert.match(youtube, /embedTagsWithFfmpeg\(finalFilePath, musicTags\)/, 'the WAV should be tagged through ffmpeg');

    // The Spotify MP3 already carried title, artist and cover; its WAV carried
    // nothing, which is the gap this closes.
    assert.match(spotify, /embedTagsWithFfmpeg\(finalFilePath, \{ title, artist \}\)/);
    // node-id3 must stay behind the mp3 guard; it cannot parse a WAV. Checked by
    // position rather than by pattern, so the test cannot be satisfied by a
    // comment that merely mentions the guard.
    const guardAt = spotify.indexOf("if (thumbnail && audioExt === 'mp3')");
    const nodeId3At = spotify.indexOf('NodeID3.update(');
    assert.ok(guardAt > -1, 'the Spotify cover should still be mp3-only');
    assert.ok(nodeId3At > guardAt, 'node-id3 must not be reachable for a WAV');
});

test('a failed lookup never blocks the file', () => {
    const handler = fs.readFileSync(path.join(SRC, 'handlers', 'downloadHandler.ts'), 'utf8');
    const lookup = fs.readFileSync(path.join(SRC, 'utils', 'musicTags.ts'), 'utf8');
    // The handler guards the call; the lookup logs and returns null on its own.
    assert.match(handler, /tagsPromise = fetchMusicTags\(url\)\.catch\(\(\) => null\)/);
    assert.match(lookup, /the download is unaffected/);
    assert.match(lookup, /tags = parseMusicTags\(JSON\.parse\(raw\)\)/,
        'a failure must land on null, not on half-built tags');
});
