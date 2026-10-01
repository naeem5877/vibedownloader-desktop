/**
 * Tests for the Instagram Stories resolver client.
 *
 * `fetchStoriesRaw` hits a paid endpoint, so `globalThis.fetch` is replaced with
 * a recorder for every case. The assertions that matter most are the ones about
 * *not* spending money and *not* leaking the key, because a bug in either is
 * invisible until a user's bill arrives.
 *
 * Run against the compiled output:
 *   npm run build:electron && node scripts/test-instagram-stories.cjs
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

/**
 * Loads `normalizeInstagramHandle` out of the real Downloader.tsx source.
 *
 * The renderer cannot be imported here (it is TSX inside a Vite bundle), so the
 * source is extracted and evaluated. Copying the function into this file would
 * let the two drift silently - the shipped one would stop matching the tested
 * one and bare usernames would break again. Extracting the actual text means
 * this test fails the moment the shipped behaviour changes.
 */
function loadRendererHandleNormalizer() {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'components', 'Downloader.tsx'), 'utf8'
    );
    const start = source.indexOf('const normalizeInstagramHandle');
    assert.notStrictEqual(start, -1, 'normalizeInstagramHandle not found in Downloader.tsx');
    const end = source.indexOf('\n};', start);
    assert.notStrictEqual(end, -1, 'normalizeInstagramHandle has no closing brace');

    // Strip the two TypeScript annotations so the text can be evaluated.
    const js = source.slice(start, end + 3)
        .replace(/\(raw: string\)/, '(raw)')
        .replace(/\): string \| null =>/, ') =>');
    // eslint-disable-next-line no-new-func
    return new Function(`${js}; return normalizeInstagramHandle;`)();
}

const dist = path.join(__dirname, '..', 'dist-electron', 'utils');
const {
    parseStoryUrl,
    isStoryUrl,
    isPlausibleHandle,
    normalizeStoryInput,
    normalizeStoryItem,
    fetchStoriesRaw,
    fetchStories,
    clearStoryCache,
    StoryError
} = require(path.join(dist, 'instagramStories.js'));

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ok   ${name}`);
    } catch (e) {
        failed++;
        failures.push({ name, error: e });
        console.log(`  FAIL ${name}`);
    }
}

async function testAsync(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`  ok   ${name}`);
    } catch (e) {
        failed++;
        failures.push({ name, error: e });
        console.log(`  FAIL ${name}`);
    }
}

/** Replaces fetch, records every call, and answers with a canned response. */
function stubFetch(responder) {
    const calls = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
        calls.push({ url: String(url), options });
        const spec = typeof responder === 'function' ? responder(String(url), options) : responder;
        return {
            ok: (spec.status ?? 200) >= 200 && (spec.status ?? 200) < 300,
            status: spec.status ?? 200,
            headers: { get: () => 'application/json' },
            json: async () => {
                if (spec.badJson) throw new Error('not json');
                return spec.body;
            }
        };
    };
    return {
        calls,
        restore: () => { globalThis.fetch = original; }
    };
}

const VIDEO_ITEM = {
    id: '3925236392186180177',
    shortcode: 'Dd6UTAgE91A',
    type: 'video',
    taken_at: '2026-09-30T18:18:00Z',
    image_url: 'https://scontent.cdninstagram.com/cover.jpg',
    video_url: 'https://scontent.cdninstagram.com/story.mp4',
    video_duration: 49.866
};

const PHOTO_ITEM = {
    id: '3925236392186180999',
    shortcode: 'Dd7P6Oik9EW',
    type: 'photo',
    taken_at: '2026-10-01T02:59:00Z',
    image_url: 'https://scontent.cdninstagram.com/photo.jpg',
    video_url: null,
    video_duration: null
};

const tray = (items) => ({ body: { data: { items, next_cursor: null }, meta: {} } });

(async () => {
    clearStoryCache();

    // ---- URL parsing -------------------------------------------------------

    test('a tray URL yields the handle and no story id', () => {
        assert.deepStrictEqual(
            parseStoryUrl('https://www.instagram.com/stories/ezsnippet/'),
            { handle: 'ezsnippet', storyId: undefined }
        );
    });

    test('a per-story URL yields the handle and the id', () => {
        assert.deepStrictEqual(
            parseStoryUrl('https://www.instagram.com/stories/rakesh.sharma.sir/3997510902303837178/'),
            { handle: 'rakesh.sharma.sir', storyId: '3997510902303837178' }
        );
    });

    test('a query string does not leak into the id', () => {
        assert.deepStrictEqual(
            parseStoryUrl('https://www.instagram.com/stories/nike/3400000000000000000/?hl=en'),
            { handle: 'nike', storyId: '3400000000000000000' }
        );
    });

    test('the legacy /story/ spelling is accepted', () => {
        assert.deepStrictEqual(
            parseStoryUrl('https://www.instagram.com/story/nike/'),
            { handle: 'nike', storyId: undefined }
        );
    });

    test('a bare handle is a valid resolver target', () => {
        assert.deepStrictEqual(parseStoryUrl('nike'), { handle: 'nike' });
    });

    test('a reel URL does not parse as a story URL', () => {
        assert.strictEqual(parseStoryUrl('https://www.instagram.com/reel/DdzE6sXjT7w/'), null);
        assert.strictEqual(isStoryUrl('https://www.instagram.com/reel/DdzE6sXjT7w/'), false);
    });

    test('a post URL does not parse as a story URL', () => {
        assert.strictEqual(isStoryUrl('https://www.instagram.com/p/fA9uwTtkSN/'), false);
    });

    test('story URLs are recognised across hosts and instagr.am', () => {
        assert.strictEqual(isStoryUrl('https://instagr.am/stories/nike/'), true);
        assert.strictEqual(isStoryUrl('https://www.instagram.com/stories/nike/123/'), true);
    });

    test('junk handles are rejected before they can cost credits', () => {
        assert.strictEqual(isPlausibleHandle('nike'), true);
        assert.strictEqual(isPlausibleHandle('rakesh.sharma.sir'), true);
        assert.strictEqual(isPlausibleHandle('has space'), false);
        assert.strictEqual(isPlausibleHandle('a'.repeat(31)), false);
        assert.strictEqual(isPlausibleHandle(''), false);
    });

    // ---- Bare-handle input normalization -----------------------------------
    // A pasted `nike` has no domain, so every `url.includes('instagram.com')`
    // check downstream would miss it. The renderer expands it before the IPC
    // call; these tests cover the backend half of that contract.

    test('a dotted handle is still recognised as a bare handle', () => {
    // `dawan._.rafi_` contains dots, so it must not be mistaken for a URL.
    assert.deepStrictEqual(parseStoryUrl('dawan._.rafi_'), { handle: 'dawan._.rafi_' });
});

    test('an @-prefixed handle parses without the @', () => {
        assert.deepStrictEqual(parseStoryUrl('@nike'), { handle: 'nike' });
    });

    test('a profile URL is a stories request', () => {
        assert.deepStrictEqual(normalizeStoryInput('instagram.com/nike'), {
            url: 'instagram.com/nike',
            isStoryRequest: true
        });
    });

    test('a full story URL is passed through unchanged', () => {
        assert.deepStrictEqual(normalizeStoryInput('https://www.instagram.com/stories/nike/123/'), {
            url: 'https://www.instagram.com/stories/nike/123/',
            isStoryRequest: true
        });
    });

    test('posts and reels are left to yt-dlp, not sent to the resolver', () => {
        // Both already extract anonymously; spending credits on them is a bug.
        assert.strictEqual(normalizeStoryInput('https://www.instagram.com/p/fA9uwTtkSN/').isStoryRequest, false);
        assert.strictEqual(normalizeStoryInput('https://www.instagram.com/reel/DdzE6sXjT7w/').isStoryRequest, false);
        assert.strictEqual(normalizeStoryInput('https://instagram.com/stories').isStoryRequest, false);
        assert.strictEqual(normalizeStoryInput('https://instagram.com/explore/tags/nike').isStoryRequest, false);
    });

    test('a bare word is never hijacked by the backend', () => {
        // The renderer expands a bare handle because only it knows which platform
        // tab was selected. Doing it here would read the YouTube id
        // `dQw4w9WgXcQ` as an Instagram handle.
        for (const input of ['nike', '@nike', 'dawan._.rafi_', 'dQw4w9WgXcQ', 'x']) {
            assert.strictEqual(normalizeStoryInput(input).isStoryRequest, false, `hijacked: ${input}`);
        }
    });

    test('other platforms are never rewritten', () => {
        for (const input of ['https://youtu.be/dQw4w9WgXcQ', 'has spaces', '', 'youtube.com/watch?v=x']) {
            const r = normalizeStoryInput(input);
            assert.strictEqual(r.isStoryRequest, false, `should not be a story request: ${input}`);
            assert.strictEqual(r.url, input.trim());
        }
    });

    // ---- The renderer half: expanding a pasted handle ---------------------
    // These run against the shipped Downloader.tsx source, so they cannot drift
    // away from what the app actually does.

    test('the renderer expands a bare handle into a stories URL', () => {
        const expand = loadRendererHandleNormalizer();
        assert.strictEqual(expand('nike'), 'https://www.instagram.com/stories/nike/');
        assert.strictEqual(expand('@nike'), 'https://www.instagram.com/stories/nike/');
        assert.strictEqual(expand('  nike  '), 'https://www.instagram.com/stories/nike/');
    });

    test('the renderer accepts dotted handles', () => {
        // Instagram usernames contain dots; treating one as a URL broke this.
        const expand = loadRendererHandleNormalizer();
        assert.strictEqual(expand('dawan._.rafi_'), 'https://www.instagram.com/stories/dawan._.rafi_/');
        assert.strictEqual(expand('rakesh.sharma.sir'), 'https://www.instagram.com/stories/rakesh.sharma.sir/');
    });

    test('the renderer leaves real URLs and junk alone', () => {
        const expand = loadRendererHandleNormalizer();
        for (const input of [
            'https://www.instagram.com/stories/nike/',
            'instagram.com/nike',
            'https://youtu.be/dQw4w9WgXcQ',
            'has spaces',
            'a'.repeat(31),
            '',
            'bad@name'
        ]) {
            assert.strictEqual(expand(input), null, `should not have expanded: ${input}`);
        }
    });

    test('handle expansion then routing resolves to the right handle', () => {
        // The full path: what the renderer sends must reach the resolver.
        const expand = loadRendererHandleNormalizer();
        for (const [input, handle] of [['nike', 'nike'], ['@nike', 'nike'], ['dawan._.rafi_', 'dawan._.rafi_']]) {
            const url = expand(input);
            const r = normalizeStoryInput(url);
            assert.strictEqual(r.isStoryRequest, true, `not a story request: ${input}`);
            assert.deepStrictEqual(parseStoryUrl(r.url), { handle, storyId: undefined });
        }
    });

    // ---- Item normalization ------------------------------------------------

    test('a video story maps to mp4 with its duration', () => {
        const s = normalizeStoryItem(VIDEO_ITEM, 0);
        assert.strictEqual(s.ext, 'mp4');
        assert.strictEqual(s.isIGStoryImage, false);
        assert.strictEqual(s.url, VIDEO_ITEM.video_url);
        assert.strictEqual(s.duration, 49.866);
    });

    test('a photo story has no duration rather than a fake 15s', () => {
        // The old insta-fetcher branch defaulted this to 15, which drove a
        // progress bar for a still image.
        const s = normalizeStoryItem(PHOTO_ITEM, 1);
        assert.strictEqual(s.ext, 'jpg');
        assert.strictEqual(s.isIGStoryImage, true);
        assert.strictEqual(s.url, PHOTO_ITEM.image_url);
        assert.strictEqual(s.duration, undefined);
    });

    test('the cover frame is used as the thumbnail', () => {
        // The provider has no thumbnail field at all.
        assert.strictEqual(normalizeStoryItem(VIDEO_ITEM, 0).thumbnail, VIDEO_ITEM.image_url);
    });

    test('the 19-digit id is carried as a string', () => {
        // Parsing it as a number silently corrupts the last digits.
        const s = normalizeStoryItem(VIDEO_ITEM, 0);
        assert.strictEqual(typeof s.id, 'string');
        assert.strictEqual(s.id, '3925236392186180177');
    });

    test('an item with no usable media is dropped', () => {
        assert.strictEqual(normalizeStoryItem({ id: '1', type: 'video', video_url: null }, 0), null);
    });

    // ---- Error mapping -----------------------------------------------------

    await testAsync('no key fails before any request is made', async () => {
        clearStoryCache();
        const stub = stubFetch(tray([VIDEO_ITEM]));
        try {
            await assert.rejects(
                () => fetchStoriesRaw('nike', ''),
                (e) => e instanceof StoryError && e.kind === 'no_api_key'
            );
            assert.strictEqual(stub.calls.length, 0, 'must not spend credits with no key');
        } finally { stub.restore(); }
    });

    await testAsync('a key for the retired host is rejected with an explanation', async () => {
        clearStoryCache();
        const stub = stubFetch(tray([VIDEO_ITEM]));
        try {
            await assert.rejects(
                () => fetchStoriesRaw('nike', 'api.instagramapi.dev-something'),
                (e) => e.kind === 'invalid_api_key' && /retired/.test(e.message)
            );
            assert.strictEqual(stub.calls.length, 0);
        } finally { stub.restore(); }
    });

    await testAsync('an implausible handle is rejected without a request', async () => {
        clearStoryCache();
        const stub = stubFetch(tray([VIDEO_ITEM]));
        try {
            await assert.rejects(
                () => fetchStoriesRaw('not a handle', 'k'.repeat(20)),
                (e) => e.kind === 'not_found'
            );
            assert.strictEqual(stub.calls.length, 0, 'a 404 costs credits, so it is checked locally');
        } finally { stub.restore(); }
    });

    await testAsync('a 401 with no auth header is reported as a missing key', async () => {
        clearStoryCache();
        const stub = stubFetch({ status: 401, body: { error: { code: 'missing_api_key' } } });
        try {
            await assert.rejects(() => fetchStoriesRaw('nike', 'k'.repeat(20)), (e) => e.kind === 'no_api_key');
        } finally { stub.restore(); }
    });

    await testAsync('a 401 with a bad key is reported as an invalid key', async () => {
        clearStoryCache();
        const stub = stubFetch({ status: 401, body: { error: { code: 'invalid_api_key' } } });
        try {
            await assert.rejects(() => fetchStoriesRaw('nike', 'k'.repeat(20)), (e) => e.kind === 'invalid_api_key');
        } finally { stub.restore(); }
    });

    await testAsync('a 402 is reported as out of credits', async () => {
        clearStoryCache();
        const stub = stubFetch({ status: 402, body: { error: { code: 'insufficient_credits' } } });
        try {
            await assert.rejects(() => fetchStoriesRaw('nike', 'k'.repeat(20)), (e) => e.kind === 'out_of_credits');
        } finally { stub.restore(); }
    });

    await testAsync('a 404 on a private account says so', async () => {
        clearStoryCache();
        const stub = stubFetch({ status: 404, body: { error: { code: 'not_found', reason: 'private_account' } } });
        try {
            await assert.rejects(
                () => fetchStoriesRaw('nike', 'k'.repeat(20)),
                (e) => e.kind === 'not_found' && /private/i.test(e.message)
            );
        } finally { stub.restore(); }
    });

    await testAsync('a 502 is reported as an upstream failure', async () => {
        clearStoryCache();
        const stub = stubFetch({ status: 502, body: { error: { code: 'upstream_error' } } });
        try {
            await assert.rejects(() => fetchStoriesRaw('nike', 'k'.repeat(20)), (e) => e.kind === 'upstream');
        } finally { stub.restore(); }
    });

    await testAsync('a non-JSON response is not mistaken for data', async () => {
        clearStoryCache();
        const stub = stubFetch({ status: 200, badJson: true });
        try {
            await assert.rejects(() => fetchStoriesRaw('nike', 'k'.repeat(20)), (e) => e.kind === 'bad_response');
        } finally { stub.restore(); }
    });

    await testAsync('a network failure does not throw a raw fetch error', async () => {
        clearStoryCache();
        const original = globalThis.fetch;
        globalThis.fetch = async () => { throw new Error('getaddrinfo ENOTFOUND'); };
        try {
            await assert.rejects(() => fetchStoriesRaw('nike', 'k'.repeat(20)), (e) => e instanceof StoryError && e.kind === 'upstream');
        } finally { globalThis.fetch = original; }
    });

    // ---- Request shape and caching ----------------------------------------

    await testAsync('the request targets the live host, not the retired one', async () => {
        clearStoryCache();
        const stub = stubFetch(tray([VIDEO_ITEM]));
        try {
            await fetchStoriesRaw('nike', 'k'.repeat(20));
            assert.ok(stub.calls[0].url.startsWith('https://api.profilequery.com/v1/profile/stories'), stub.calls[0].url);
            assert.ok(!stub.calls[0].url.includes('instagramapi.dev'));
            assert.ok(stub.calls[0].url.includes('handle=nike'));
        } finally { stub.restore(); }
    });

    await testAsync('the key travels as a bearer header, never in the URL', async () => {
        clearStoryCache();
        const stub = stubFetch(tray([VIDEO_ITEM]));
        try {
            await fetchStoriesRaw('nike', 'secret-key-value');
            assert.strictEqual(stub.calls[0].options.headers.Authorization, 'Bearer secret-key-value');
            assert.ok(!stub.calls[0].url.includes('secret-key-value'), 'key must not appear in the URL');
            assert.ok(!stub.calls[0].url.includes('api_key'), 'query-param auth is ignored by the API and leaks into logs');
        } finally { stub.restore(); }
    });

    await testAsync('a repeat lookup reuses the tray instead of spending credits', async () => {
        clearStoryCache();
        const stub = stubFetch(tray([VIDEO_ITEM]));
        try {
            await fetchStoriesRaw('nike', 'k'.repeat(20));
            await fetchStoriesRaw('nike', 'k'.repeat(20));
            assert.strictEqual(stub.calls.length, 1, 'the second lookup should hit the cache');
        } finally { stub.restore(); }
    });

    await testAsync('an expired cache entry triggers a fresh paid call', async () => {
        clearStoryCache();
        const stub = stubFetch(tray([VIDEO_ITEM]));
        try {
            await fetchStoriesRaw('nike', 'k'.repeat(20), 1000);
            // Past the 10 minute TTL.
            await fetchStoriesRaw('nike', 'k'.repeat(20), 1000 + 11 * 60 * 1000);
            assert.strictEqual(stub.calls.length, 2);
        } finally { stub.restore(); }
    });

    await testAsync('different handles are cached separately', async () => {
        clearStoryCache();
        const stub = stubFetch(tray([VIDEO_ITEM]));
        try {
            await fetchStoriesRaw('nike', 'k'.repeat(20));
            await fetchStoriesRaw('adidas', 'k'.repeat(20));
            assert.strictEqual(stub.calls.length, 2);
        } finally { stub.restore(); }
    });

    // ---- Tray selection ----------------------------------------------------

    await testAsync('a tray request returns every active story', async () => {
        clearStoryCache();
        const stub = stubFetch(tray([VIDEO_ITEM, PHOTO_ITEM]));
        try {
            const stories = await fetchStories('nike', 'k'.repeat(20));
            assert.strictEqual(stories.length, 2);
        } finally { stub.restore(); }
    });

    await testAsync('a story id filters to that one story', async () => {
        // The old implementation threw the id away and returned the whole tray.
        clearStoryCache();
        const stub = stubFetch(tray([VIDEO_ITEM, PHOTO_ITEM]));
        try {
            const stories = await fetchStories('nike', 'k'.repeat(20), 'Dd6UTAgE91A');
            assert.strictEqual(stories.length, 1);
            assert.strictEqual(stories[0].shortcodeHint ?? stories[0].id, VIDEO_ITEM.id);
        } finally { stub.restore(); }
    });

    await testAsync('a story id also matches the 19-digit pk', async () => {
        clearStoryCache();
        const stub = stubFetch(tray([VIDEO_ITEM, PHOTO_ITEM]));
        try {
            const stories = await fetchStories('nike', 'k'.repeat(20), '3925236392186180177');
            assert.strictEqual(stories.length, 1);
            assert.strictEqual(stories[0].ext, 'mp4');
        } finally { stub.restore(); }
    });

    await testAsync('an expired story id explains the 24 hour window', async () => {
        clearStoryCache();
        const stub = stubFetch(tray([VIDEO_ITEM]));
        try {
            await assert.rejects(
                () => fetchStories('nike', 'k'.repeat(20), 'DdNONEXISTENT'),
                (e) => e.kind === 'not_found' && /expired/i.test(e.message)
            );
        } finally { stub.restore(); }
    });

    await testAsync('an account with no active stories is not an error state', async () => {
        clearStoryCache();
        const stub = stubFetch(tray([]));
        try {
            await assert.rejects(
                () => fetchStories('nike', 'k'.repeat(20)),
                (e) => e.kind === 'no_stories'
            );
        } finally { stub.restore(); }
    });

    console.log(`\n${passed} passed, ${failed} failed\n`);
    if (failed) {
        console.log('failures:\n');
        failures.forEach((f) => console.log(`  ${f.name}\n    ${f.error.message}\n`));
        process.exit(1);
    }
})();