/**
 * Instagram Stories via the built-in downloader (no paid resolver, no key).
 *
 * The downloader itself is obfuscated third-party code, so these tests assert
 * the wiring around it: that the module is present where the main process looks
 * for it, that it loads as CommonJS, that URLs are shaped correctly, and that
 * the container/extension decisions the CDN URLs force on us are still made.
 */
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');

const REPO = path.resolve(__dirname, '..');
const SRC = path.join(REPO, 'electron');
const read = (p) => fs.readFileSync(p, 'utf8');

// ---- the module has to actually be loadable --------------------------------

test('the downloader module is copied into dist-electron by the build', () => {
    const built = path.join(REPO, 'dist-electron', 'vendor', 'snapsave-downloader', 'src', 'index.js');
    assert.ok(fs.existsSync(built), `missing ${built} - run npm run build:electron`);
});

test('build:electron runs the vendor copy step', () => {
    const pkg = JSON.parse(read(path.join(REPO, 'package.json')));
    assert.match(pkg.scripts['build:electron'], /copy-vendor\.cjs/);
});

test('the downloader module loads under dist-electron commonjs and is callable', () => {
    const built = path.join(REPO, 'dist-electron', 'vendor', 'snapsave-downloader', 'src', 'index.js');
    const loaded = require(built);
    assert.strictEqual(typeof loaded, 'function');
});

test('dist-electron is marked commonjs so the require above is valid', () => {
    const p = path.join(REPO, 'dist-electron', 'package.json');
    if (!fs.existsSync(p)) return;
    assert.strictEqual(JSON.parse(read(p)).type, 'commonjs');
});

test('the vendored licence and notice ship alongside the code', () => {
    const dir = path.join(REPO, 'electron', 'vendor', 'snapsave-downloader');
    for (const f of ['LICENSE', 'NOTICE']) {
        assert.ok(fs.existsSync(path.join(dir, f)), `missing ${f}`);
    }
});

// ---- duplicate stories ----------------------------------------------------

/** Build a signed-wrapper url whose JWT payload points at `file`. */
function rapidcdn(file, salt) {
    const payload = Buffer.from(JSON.stringify({ url: file })).toString('base64url');
    const token = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${payload}.sig${salt}`;
    return `https://d.rapidcdn.app/v2?token=${token}`;
}

test('re-signed copies of one file collapse to a single story', () => {
    const a = loadAdapter();
    const file = 'https://instagram.fbcdn.net/o1/v/t2/m78/AQNT-story.mp4?oh=abc';
    const items = Array.from({ length: 8 }, (_, i) => ({ url: rapidcdn(file, i) }));
    const out = a.dedupeByFile(items);
    assert.strictEqual(out.length, 1, '8 signed copies of one file should become 1 story');
});

test('different files are all kept', () => {
    const a = loadAdapter();
    const items = [0, 1, 2].map(i => ({ url: rapidcdn(`https://instagram.fbcdn.net/story${i}.mp4`, i) }));
    assert.strictEqual(a.dedupeByFile(items).length, 3);
});

test('a reused file later in the list is dropped, order is kept', () => {
    const a = loadAdapter();
    const one = 'https://instagram.fbcdn.net/one.mp4';
    const two = 'https://instagram.fbcdn.net/two.mp4';
    const items = [
        { url: rapidcdn(one, 0) },
        { url: rapidcdn(two, 1) },
        { url: rapidcdn(one, 2) }
    ];
    const out = a.dedupeByFile(items);
    assert.strictEqual(out.length, 2);
    assert.ok(out[0].url.includes(new URL(rapidcdn(one, 0)).searchParams.get('token')));
});

test('the volatile query is ignored so re-signed urls match', () => {
    const a = loadAdapter();
    const base = 'https://instagram.fbcdn.net/same.mp4';
    assert.strictEqual(a.dedupeKey(base + '?oh=1'), a.dedupeKey(base + '?oh=2'));
});

test('plain urls without a token still dedupe', () => {
    const a = loadAdapter();
    const items = [
        { url: 'https://instagram.fbcdn.net/a.mp4' },
        { url: 'https://instagram.fbcdn.net/a.mp4' },
        { url: 'https://instagram.fbcdn.net/b.mp4' }
    ];
    assert.strictEqual(a.dedupeByFile(items).length, 2);
});

test('an unreadable url is kept rather than dropped', () => {
    const a = loadAdapter();
    assert.strictEqual(a.dedupeKey('not a url'), 'not a url');
    assert.strictEqual(a.dedupeByFile([{ url: 'not a url' }]).length, 1);
});

test('the adapter deduplicates before mapping rows', () => {
    const src = read(path.join(SRC, 'utils', 'instagramStoriesLocal.ts'));
    assert.match(src, /dedupeByFile\(items\)/);
});

// ---- speed: the container is free, and the scrape is worth caching ---------

test('the cdn path states the container, so no request is needed', () => {
    const a = loadAdapter();
    assert.strictEqual(
        a.inferExtFromPath(rapidcdn('https://instagram.fbcdn.net/o1/v/t2/f2/m78/AQNT.mp4', 0)),
        'mp4'
    );
    assert.strictEqual(
        a.inferExtFromPath(rapidcdn('https://instagram.fbcdn.net/v/t51.82787-15/8284131.jpg', 0)),
        'jpg'
    );
    assert.strictEqual(
        a.inferExtFromPath(rapidcdn('https://instagram.fbcdn.net/o1/v/t32/m78/AQNT.jpg', 0)),
        'jpg'
    );
});

test('an unrecognised path falls back to a probe rather than guessing', () => {
    assert.strictEqual(loadAdapter().inferExtFromPath(rapidcdn('https://example.com/a.bin', 0)), null);
    assert.strictEqual(loadAdapter().inferExtFromPath('not a url'), null);
});

test('the real url is readable out of the wrapper', () => {
    const inner = loadAdapter().innerCdnUrl(rapidcdn('https://instagram.fbcdn.net/o1/v/t2/x.mp4', 0));
    assert.strictEqual(inner, 'https://instagram.fbcdn.net/o1/v/t2/x.mp4');
});

test('the scrape is bounded and cached so reopening is instant', () => {
    const src = read(path.join(SRC, 'utils', 'instagramStoriesLocal.ts'));
    assert.match(src, /SCRAPE_TIMEOUT_MS\s*=\s*30_000/);
    assert.match(src, /const CACHE_TTL_MS = 5 \* 60 \* 1000/);
    assert.match(src, /if \(hit && Date\.now\(\) - hit\.at < CACHE_TTL_MS\)/);
    assert.match(src, /attempt < 2/);
});

// The only test that touches the network. The scraper is a third-party service
// that rate-limits and intermittently answers 500, so an upstream failure skips
// rather than reports a defect in our code.
test('a cache hit does not call the scraper again', async (t) => {
    const a = loadAdapter();
    a.clearStoriesCache('cacheprobe');
    let first;
    try {
        first = await a.fetchStoriesLocal('epicgames');
    } catch {
        return t.skip('upstream scraper unavailable');
    }
    if (!first.length) return t.skip('upstream returned no stories');

    const start = Date.now();
    const second = await a.fetchStoriesLocal('epicgames');
    const elapsed = Date.now() - start;
    assert.strictEqual(second, first, 'a cache hit should return the same array');
    assert.ok(elapsed < 500, `cached read took ${elapsed} ms, expected well under a scrape`);
    a.clearStoriesCache('cacheprobe');
});

// ---- URL shaping -----------------------------------------------------------

/**
 * Load the compiled adapter with `electron` stubbed, so the real build output is
 * exercised instead of a hand-rolled copy of the logic. Only `app.getAppPath`
 * is needed at import time; nothing here performs a network call.
 */
function loadAdapter() {
    const Module = require('module');
    const original = Module._load;
    Module._load = function (request, ...rest) {
        if (request === 'electron') return { app: { getAppPath: () => REPO } };
        return original.call(this, request, ...rest);
    };
    try {
        return require(path.join(REPO, 'dist-electron', 'utils', 'instagramStoriesLocal.js'));
    } finally {
        Module._load = original;
    }
}

test('the compiled adapter resolves the module where the build put it', () => {
    const adapter = loadAdapter();
    const p = adapter.vendorModulePath();
    assert.ok(fs.existsSync(p), `${p} should exist after npm run build:electron`);
    assert.match(p, /dist-electron[\\/]vendor[\\/]snapsave-downloader[\\/]src[\\/]index\.js$/);
});

test('the adapter finds a callable downloader in this build', () => {
    assert.strictEqual(typeof loadAdapter().loadStoryDownloader(), 'function');
    assert.strictEqual(loadAdapter().isStoryDownloaderAvailable(), true);
});

test('a tray url has no story id', () => {
    const build = loadAdapter().buildStoriesUrl;
    assert.strictEqual(build('nike'), 'https://www.instagram.com/stories/nike/');
});

test('a single story url carries its id', () => {
    const build = loadAdapter().buildStoriesUrl;
    assert.strictEqual(
        build('nike', '3400000000000000000'),
        'https://www.instagram.com/stories/nike/3400000000000000000/'
    );
});

test('the handle is encoded so it cannot break out of the path', () => {
    const build = loadAdapter().buildStoriesUrl;
    assert.ok(!build('a/b').includes('/stories/a/b/'));
    assert.match(build('a b'), /%20/);
});

test('an impossible handle is refused before any request is made', async () => {
    const adapter = loadAdapter();
    await assert.rejects(
        () => adapter.fetchStoriesLocal('not a handle!'),
        (e) => /not a valid Instagram username/.test(e.message)
    );
});

// ---- the CDN urls force decisions on us ------------------------------------

test('the fast download path covers the new CDN host', () => {
    const src = read(path.join(SRC, 'handlers', 'downloadHandler.ts'));
    assert.match(src, /rapidcdn\.app/);
    assert.match(src, /url\.includes\('fbcdn\.net'\) \|\| url\.includes\('rapidcdn\.app'\)/);
});

test('the reported container wins over the mp4 default', () => {
    const src = read(path.join(SRC, 'handlers', 'downloadHandler.ts'));
    assert.match(src, /mediaExt === 'jpg' \|\| mediaExt === 'mp4'/);
    assert.match(src, /resolvedMediaExt \?\? ext/);
});

test('a jpg story is not run through the video transcode', () => {
    const src = read(path.join(SRC, 'handlers', 'downloadHandler.ts'));
    assert.match(src, /if \(finalExt === 'mp4'\)\s*\{\s*await recodeVideoToH264/);
});

test('both download entry points forward the container', () => {
    const src = read(path.join(REPO, 'src', 'components', 'Downloader.tsx'));
    const forwards = src.match(/mediaExt:/g) || [];
    assert.strictEqual(forwards.length, 3, 'expected batch, single and download-all to all pass mediaExt');
});

test('the entry type carries the container through to the renderer', () => {
    const src = read(path.join(REPO, 'src', 'components', 'Downloader.tsx'));
    const block = src.slice(src.indexOf('interface PlaylistEntry'), src.indexOf('interface SubtitleTrack'));
    assert.match(block, /ext\?: string;/);
});

// ---- no key required -------------------------------------------------------

test('infoHandler uses the built-in downloader and never loads a key', () => {
    const src = read(path.join(SRC, 'handlers', 'infoHandler.ts'));
    assert.match(src, /fetchStoriesLocal\(parsed\.handle, parsed\.storyId\)/);
    assert.doesNotMatch(src, /loadStoriesApiKey/);
});

test('the adapter fails with a sentence a user can act on', () => {
    const src = read(path.join(SRC, 'utils', 'instagramStoriesLocal.ts'));
    assert.match(src, /is not a valid Instagram username/);
    assert.match(src, /has no stories right now/);
    assert.match(src, /missing from this build/);
});

test('a raw exception from the vendor is never shown to a user', () => {
    const { readableVendorMessage } = loadAdapter();
    // Real strings observed from the obfuscated bundle, all unactionable.
    assert.strictEqual(readableVendorMessage("Cannot read properties of undefined (reading 'split')"), '');
    assert.strictEqual(readableVendorMessage('vendor.fn is not a function'), '');
    assert.strictEqual(readableVendorMessage(undefined), '');
    assert.strictEqual(readableVendorMessage('x'.repeat(200)), '');
    // Instagram's own answers are worth passing through.
    assert.strictEqual(readableVendorMessage('This account is private'), 'This account is private');
});

test('an unreadable tray still gets a sentence of its own', () => {
    const src = read(path.join(SRC, 'utils', 'instagramStoriesLocal.ts'));
    assert.match(src, /usable \|\| `Could not read stories for \$\{clean\} right now\.`/);
    assert.match(src, /console\.warn\(`Story downloader could not read/);
});

// ---- an account with nothing posted is a result, not a failure -------------

test('an empty tray is answered, not raised as a download error', () => {
    const src = read(path.join(SRC, 'handlers', 'infoHandler.ts'));
    // The one thing that must not be rethrown is `no_stories`; everything else
    // keeps its sentence.
    assert.match(src, /e instanceof StoryError && e\.kind === 'no_stories'/);
    assert.match(src, /noStoriesMessage = e\.message/);
    assert.match(src, /noStories,\s*\n\s*noStoriesMessage/);
});

test('the stories card survives an empty tray and explains it', () => {
    const src = read(path.join(REPO, 'src', 'components', 'Downloader.tsx'));
    // Gating `isStory` on entries used to send a storyless account to the
    // single-video card, which rendered it as a 0-second video.
    assert.match(src, /const isStory = !!metadata && metadata\?\.contentType === 'story'/);
    assert.match(src, /No active stories/);
    assert.match(src, /Stories only live for 24 hours/);
    // The action row has to disappear, or it offers "Download All" over nothing.
    const card = src.slice(src.indexOf('{/* Story Result (Instagram) */}'), src.indexOf('{/* Success */}'));
    assert.strictEqual((card.match(/\{storyCount > 0 && \(/g) || []).length, 3, 'expected Download All, the select row and the footer to all be gated');
});

test('the empty state is reachable from the type the handler sends', () => {
    const handler = read(path.join(SRC, 'handlers', 'infoHandler.ts'));
    const ui = read(path.join(REPO, 'src', 'components', 'Downloader.tsx'));
    const iface = ui.slice(ui.indexOf('interface VideoMetadata'), ui.indexOf('type PlatformId'));
    // The handler sends them as object shorthand, the renderer declares them
    // optional because every other platform's metadata lacks them.
    for (const field of ['noStories', 'noStoriesMessage']) {
        assert.match(handler, new RegExp(`\\n\\s*${field}\\b`), 'handler should send ' + field);
        assert.match(iface, new RegExp(`${field}\\?:`), 'VideoMetadata should declare ' + field + ' as optional');
    }
});

test('the api key box is gone from the UI', () => {
    const src = read(path.join(REPO, 'src', 'components', 'Downloader.tsx'));
    for (const gone of ['storiesKey', 'handleSaveStoriesKey', 'handleClearStoriesKey', 'getStoriesApiKeyStatus']) {
        assert.ok(!src.includes(gone), `${gone} should be removed`);
    }
});

test('nothing tells users to buy credits any more', () => {
    const src = read(path.join(REPO, 'src', 'components', 'Downloader.tsx'));
    assert.doesNotMatch(src, /credits left/i);
    assert.doesNotMatch(src, /Stories API key/);
});