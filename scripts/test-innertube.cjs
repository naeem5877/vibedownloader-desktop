/**
 * Tests for electron/utils/innertube.ts (the YouTube metadata fast path).
 *
 *   npm run build:electron          # compile first - this loads dist-electron
 *   node scripts/test-innertube.cjs                 # offline: parsing + decline rules + token logic
 *   node scripts/test-innertube.cjs --live <id>     # also hit YouTube once and print what came back
 *
 * The offline half uses a synthetic player response and an injected fetch, so it
 * needs no network and cannot be broken by YouTube changing. The live half is a
 * smoke check, not an assertion suite: whether YouTube still accepts the client
 * profile is exactly the thing that changes underneath us.
 */

const assert = require('node:assert/strict');
const path = require('node:path');

const it = require(path.join(__dirname, '..', 'dist-electron', 'utils', 'innertube.js'));

let passed = 0;
async function test(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`  ok   ${name}`);
    } catch (e) {
        console.error(`  FAIL ${name}\n       ${e.message}`);
        process.exitCode = 1;
    }
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const vid = (itag, h, mime, extra = {}) => ({
    itag, url: `https://r.example/${itag}`, mimeType: mime, width: Math.round(h * 16 / 9), height: h,
    fps: 30, bitrate: 1_000_000 * (h / 360), qualityLabel: `${h}p`, contentLength: String(h * 100_000), ...extra
});
const aud = (itag, mime, extra = {}) => ({
    itag, url: `https://r.example/${itag}`, mimeType: mime, bitrate: 128_000,
    audioQuality: 'AUDIO_QUALITY_MEDIUM', contentLength: '3000000', ...extra
});

// What this client actually returns carries no `microformat`; see MICROFORMAT below.
function fixture(over = {}) {
    return {
        playabilityStatus: { status: 'OK' },
        videoDetails: {
            videoId: 'abcdefghijk', title: 'A title', author: 'An Author', channelId: 'UC123',
            lengthSeconds: '212', viewCount: '12345', shortDescription: 'desc', isLive: false,
            thumbnail: { thumbnails: [
                { url: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg', width: 480, height: 360 },
                { url: 'https://i.ytimg.com/vi/abcdefghijk/maxresdefault.jpg', width: 1280, height: 720 }
            ] }
        },
        streamingData: {
            formats: [
                // progressive: video + audio in one stream
                vid(18, 360, 'video/mp4; codecs="avc1.42001E, mp4a.40.2"'),
                // ciphered, no url: must be skipped
                { itag: 22, signatureCipher: 's=abc&url=x', mimeType: 'video/mp4; codecs="avc1.64001F, mp4a.40.2"' }
            ],
            adaptiveFormats: [
                vid(137, 1080, 'video/mp4; codecs="avc1.640028"'),
                vid(136, 720, 'video/mp4; codecs="avc1.4d401f"'),
                vid(248, 1080, 'video/webm; codecs="vp9"'),
                aud(140, 'audio/mp4; codecs="mp4a.40.2"'),
                aud(251, 'audio/webm; codecs="opus"')
            ]
        },
        captions: { playerCaptionsTracklistRenderer: {
            captionTracks: [
                { baseUrl: 'https://c.example/a?x=1', languageCode: 'en', kind: 'asr', isTranslatable: true },
                { baseUrl: 'https://c.example/b?x=1', languageCode: 'de', isTranslatable: true }
            ],
            translationLanguages: [{ languageCode: 'fr' }, { languageCode: 'es' }, { languageCode: 'en' }]
        } },
        ...over
    };
}

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

// What a WEB player request returns and the VISIONOS one does not.
const MICROFORMAT = { playerMicroformatRenderer: {
    category: 'Music', publishDate: '2024-05-01', likeCount: '99', ownerProfileUrl: 'http://www.youtube.com/@author'
} };

(async () => {
    console.log('parseYouTubeVideoId');
    const ID = 'dQw4w9WgXcQ';
    const urls = {
        [`https://www.youtube.com/watch?v=${ID}`]: ID,
        [`https://youtube.com/watch?v=${ID}&list=PL1&t=5`]: ID,
        [`https://m.youtube.com/watch?v=${ID}`]: ID,
        [`https://music.youtube.com/watch?v=${ID}`]: ID,
        [`https://youtu.be/${ID}?si=zzz`]: ID,
        [`https://www.youtube.com/shorts/${ID}`]: ID,
        [`https://www.youtube.com/live/${ID}`]: ID,
        [`https://www.youtube.com/embed/${ID}`]: ID,
        [`www.youtube.com/watch?v=${ID}`]: ID,        // pasted without a scheme
        // Must NOT match: foreign hosts that merely carry a `v` parameter or path.
        [`https://example.com/watch?v=${ID}`]: null,
        [`https://notyoutube.com/watch?v=${ID}`]: null,
        [`https://youtube.com.evil.test/watch?v=${ID}`]: null,
        [`https://www.tiktok.com/embed/${ID}`]: null,
        // YouTube, but not a single video.
        'https://www.youtube.com/playlist?list=PLabc': null,
        'https://www.youtube.com/@somechannel': null,
        [`https://www.youtube.com/results?v=${ID}`]: null,
        'https://www.youtube.com/watch?v=short': null,
        '': null
    };
    for (const [input, expected] of Object.entries(urls)) {
        await test(`${input || '(empty)'} -> ${expected}`, () => assert.equal(it.parseYouTubeVideoId(input), expected));
    }

    // -----------------------------------------------------------------------
    console.log('\nbuildRawFromPlayerResponse');

    await test('maps a normal response into a yt-dlp-shaped payload', () => {
        const r = it.buildRawFromPlayerResponse(fixture({ microformat: MICROFORMAT }), 'abcdefghijk');
        assert.ok(r.raw, `declined: ${r.decline}`);
        const raw = r.raw;
        assert.equal(raw.id, 'abcdefghijk');
        assert.equal(raw.uploader, 'An Author');
        assert.equal(raw.duration, 212);
        assert.equal(raw.view_count, 12345);
        assert.equal(raw.like_count, 99);
        assert.equal(raw.upload_date, '20240501');
        assert.equal(raw.uploader_url, 'http://www.youtube.com/@author');
        assert.deepEqual(raw.categories, ['Music']);   // feeds the isMusic check downstream
        assert.equal(raw.thumbnail, 'https://i.ytimg.com/vi/abcdefghijk/maxresdefault.jpg');
        assert.equal(raw.thumbnails.length, 2);
    });

    await test('without a microformat, categories is empty rather than missing', () => {
        const { raw } = it.buildRawFromPlayerResponse(fixture(), 'abcdefghijk');
        assert.deepEqual(raw.categories, []);
        assert.equal(raw.upload_date, undefined);
    });

    await test('skips ciphered formats and keeps ids unique', () => {
        const { raw } = it.buildRawFromPlayerResponse(fixture(), 'abcdefghijk');
        const ids = raw.formats.map((f) => f.format_id);
        assert.ok(!ids.includes('22'));
        assert.equal(new Set(ids).size, ids.length);
        assert.deepEqual([...ids].sort(), ['136', '137', '140', '18', '248', '251']);
    });

    await test('classifies video-only, audio-only and progressive streams', () => {
        const { raw } = it.buildRawFromPlayerResponse(fixture(), 'abcdefghijk');
        const by = Object.fromEntries(raw.formats.map((f) => [f.format_id, f]));

        assert.equal(by[137].vcodec, 'avc1.640028');
        assert.equal(by[137].acodec, 'none');
        assert.equal(by[137].video_ext, 'mp4');   // the renderer's video filter reads this

        assert.equal(by[140].vcodec, 'none');
        assert.equal(by[140].acodec, 'mp4a.40.2');
        assert.equal(by[140].video_ext, 'none');  // audio is kept out of the video list
        assert.equal(by[140].ext, 'm4a');
        assert.equal(by[140].height, undefined);
        assert.equal(by[251].ext, 'webm');

        assert.equal(by[18].vcodec, 'avc1.42001E');   // progressive carries both
        assert.equal(by[18].acodec, 'mp4a.40.2');
        assert.equal(by[248].ext, 'webm');
        assert.equal(by[137].format_note, '1080p');
        assert.equal(by[137].filesize, 108_000_000);
    });

    await test('estimates filesize when contentLength is absent', () => {
        const f = fixture();
        delete f.streamingData.adaptiveFormats[0].contentLength;
        const { raw } = it.buildRawFromPlayerResponse(f, 'abcdefghijk');
        const v = raw.formats.find((x) => x.format_id === '137');
        assert.equal(v.filesize, undefined);
        assert.ok(v.filesize_approx > 0);
    });

    await test('caption dicts: real tracks plus translation languages', () => {
        const { raw } = it.buildRawFromPlayerResponse(fixture(), 'abcdefghijk');
        assert.deepEqual(Object.keys(raw.subtitles), ['de']);            // author-uploaded
        assert.deepEqual(Object.keys(raw.automatic_captions).sort(), ['en', 'es', 'fr']);
        assert.equal(raw.automatic_captions.en[0].ext, 'vtt');           // one vtt entry per language
        assert.match(raw.automatic_captions.fr[0].url, /tlang=fr$/);
        assert.equal(raw.automatic_captions.en[0].url.includes('tlang'), false); // real asr track not overwritten
    });

    await test('feeds the existing renderer helpers unchanged', () => {
        const { buildSubtitleList } = require(path.join(__dirname, '..', 'dist-electron', 'utils', 'subtitles.js'));
        const { buildAudioTrackList } = require(path.join(__dirname, '..', 'dist-electron', 'utils', 'audioTracks.js'));
        const { raw } = it.buildRawFromPlayerResponse(fixture(), 'abcdefghijk');
        const subs = buildSubtitleList(raw);
        assert.ok(subs.find((s) => s.key === 'manual:de'));
        assert.ok(subs.find((s) => s.key === 'auto:fr' && s.isAuto));
        assert.deepEqual(buildAudioTrackList(raw), []);   // single language: picker stays hidden
    });

    // A dubbed video: the same itag published once per language. `extra` adds formats.
    const dubbed = (extra = []) => fixture({ streamingData: { adaptiveFormats: [
        vid(137, 1080, 'video/mp4; codecs="avc1.640028"'),
        aud(140, 'audio/mp4; codecs="mp4a.40.2"', { audioTrack: { id: 'hi.3', displayName: 'Hindi' } }),
        aud(251, 'audio/webm; codecs="opus"', { audioTrack: { id: 'hi.3', displayName: 'Hindi' } }),
        aud(140, 'audio/mp4; codecs="mp4a.40.2"', { audioTrack: { id: 'en-US.4', displayName: 'English (US)', audioIsDefault: true } }),
        aud(251, 'audio/webm; codecs="opus"', { audioTrack: { id: 'ja.5', displayName: 'Japanese' } }),
        ...extra
    ] } });

    // Every one of these must return null so yt-dlp answers instead.
    const declines = {
        'login wall': () => fixture({ playabilityStatus: { status: 'LOGIN_REQUIRED' } }),
        'unplayable': () => fixture({ playabilityStatus: { status: 'UNPLAYABLE' } }),
        'live stream': () => { const f = fixture(); f.videoDetails.isLive = true; return f; },
        'upcoming premiere': () => { const f = fixture(); f.videoDetails.isUpcoming = true; return f; },
        'no streamingData': () => fixture({ streamingData: undefined }),
        'no usable formats': () => fixture({ streamingData: { formats: [], adaptiveFormats: [] } }),
        'only ciphered formats': () => fixture({ streamingData: { adaptiveFormats: [
            { itag: 137, signatureCipher: 'x', mimeType: 'video/mp4; codecs="avc1.640028"' }
        ] } }),
        'thin list (360p only)': () => fixture({ streamingData: { formats: [
            vid(18, 360, 'video/mp4; codecs="avc1.42001E, mp4a.40.2"')
        ], adaptiveFormats: [aud(140, 'audio/mp4; codecs="mp4a.40.2"')] } }),
        'video but no audio stream': () => fixture({ streamingData: { adaptiveFormats: [
            vid(137, 1080, 'video/mp4; codecs="avc1.640028"'), vid(136, 720, 'video/mp4; codecs="avc1.4d401f"'),
            vid(135, 480, 'video/mp4; codecs="avc1.4d401f"'), vid(134, 360, 'video/mp4; codecs="avc1.4d401f"')
        ] } }),
        // Dubbed videos are served now (see below). These dubbed shapes still go to yt-dlp,
        // because a selector built here would not match what yt-dlp reports.
        'dubbed: descriptive audio track': () => dubbed([
            aud(140, 'audio/mp4; codecs="mp4a.40.2"', { audioTrack: { id: 'en-US.9', displayName: 'English descriptive', audioTrackType: 'AUDIO_TRACK_TYPE_DESCRIPTIVE' } })
        ]),
        'dubbed: language that cannot go in a selector': () => dubbed([
            aud(140, 'audio/mp4; codecs="mp4a.40.2"', { audioTrack: { id: '??', displayName: 'Some Language (x)' } })
        ]),
        'dubbed: fewer than two usable languages': () => fixture({ streamingData: { adaptiveFormats: [
            vid(137, 1080, 'video/mp4; codecs="avc1.640028"'),
            aud(140, 'audio/mp4; codecs="mp4a.40.2"', { audioTrack: { id: 'en-US.4', displayName: 'English', audioIsDefault: true } }),
            aud(140, 'audio/mp4; codecs="mp4a.40.2"', { isDrc: true, audioTrack: { id: 'hi.3', displayName: 'Hindi' } })
        ] } })
    };
    for (const [name, make] of Object.entries(declines)) {
        await test(`declines: ${name}`, () => {
            const r = it.buildRawFromPlayerResponse(make(), 'abcdefghijk');
            assert.ok(r.decline, 'expected a decline');
            assert.equal(r.raw, undefined);
        });
    }

    // Dubbed videos are answered by the fast path. Each track carries a yt-dlp selector on the
    // *language*, because the `140-N` ids yt-dlp assigns are not derivable from this response.
    const { buildAudioTrackList: tracksOf } = require(path.join(__dirname, '..', 'dist-electron', 'utils', 'audioTracks.js'));

    await test('dubbed: served, one track per language, original first, case kept', () => {
        const r = it.buildRawFromPlayerResponse(dubbed(), 'abcdefghijk');
        assert.ok(r.raw, `declined: ${r.decline}`);
        const t = tracksOf(r.raw);
        assert.deepEqual(t.map((x) => x.lang), ['en-US', 'hi', 'ja']);   // original first, then A-Z by label
        assert.deepEqual(t.map((x) => x.isOriginal), [true, false, false]);
        assert.deepEqual(new Set(t.map((x) => x.key)).size, 3);
    });

    await test('dubbed: selectors prefer AAC and fall back to any codec for that language', () => {
        const t = tracksOf(it.buildRawFromPlayerResponse(dubbed(), 'abcdefghijk').raw);
        const by = Object.fromEntries(t.map((x) => [x.lang, x.formatId]));
        assert.equal(by['en-US'], 'ba[language=en-US][acodec^=mp4a]');
        assert.equal(by['hi'], 'ba[language=hi][acodec^=mp4a]');        // AAC beat the Opus twin
        assert.equal(by['ja'], 'ba[language=ja]');                      // Opus only: no codec filter
    });

    await test('dubbed: a volume-normalised (DRC) twin is ignored, not picked for its bitrate', () => {
        const extra = [aud(140, 'audio/mp4; codecs="mp4a.40.2"', { isDrc: true, bitrate: 9e6, audioTrack: { id: 'hi.3', displayName: 'Hindi' } })];
        const r = it.buildRawFromPlayerResponse(dubbed(extra), 'abcdefghijk');
        assert.ok(r.raw, `declined: ${r.decline}`);
        assert.equal(tracksOf(r.raw).length, 3);
        assert.ok(!r.raw.formats.some((f) => f.vibe_drc), 'a DRC format leaked into the list');
    });

    await test('dubbed: video formats and the rest of the payload are untouched', () => {
        const r = it.buildRawFromPlayerResponse(dubbed(), 'abcdefghijk');
        assert.ok(r.raw.formats.some((f) => f.format_id === '137' && f.height === 1080));
        assert.equal(r.raw.formats.filter((f) => f.vcodec === 'none').length, 3);   // one audio per language
    });

    await test('single-language video is unchanged: no selector, no tracks, plain itag ids', () => {
        const r = it.buildRawFromPlayerResponse(fixture(), 'abcdefghijk');
        assert.deepEqual(tracksOf(r.raw), []);
        assert.ok(r.raw.formats.every((f) => !('vibe_selector' in f)));
    });

    await test('does NOT decline a video that legitimately tops out at 720p', () => {
        const r = it.buildRawFromPlayerResponse(fixture({ streamingData: {
            formats: [vid(18, 360, 'video/mp4; codecs="avc1.42001E, mp4a.40.2"')],
            adaptiveFormats: [
                vid(136, 720, 'video/mp4; codecs="avc1.4d401f"'),
                vid(135, 480, 'video/mp4; codecs="avc1.4d401f"'),
                vid(134, 360, 'video/mp4; codecs="avc1.4d401f"'),
                vid(133, 240, 'video/mp4; codecs="avc1.4d401f"'),
                aud(140, 'audio/mp4; codecs="mp4a.40.2"')
            ]
        } }), 'abcdefghijk');
        assert.ok(r.raw, `declined: ${r.decline}`);
    });

    // -----------------------------------------------------------------------
    console.log('\nresolveInnerTube (injected fetch)');

    const json = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
    const http = (status) => ({ ok: false, status, text: async () => '' });
    const memStore = (initial = {}) => {
        const data = { ...initial };
        return { data, read: (k) => data[k] ?? null, write: (k, v) => { if (v) data[k] = v; else delete data[k]; } };
    };
    const KEY = 'visitor_v1';
    // The WEB microformat request hits the same URL as the main player request,
    // so it is told apart by the client named in its body.
    const kindOf = (u, init) => {
        if (u.includes('/visitor_id')) return 'visitor';
        try { if (JSON.parse(init.body).context.client.clientName === 'WEB') return 'web'; } catch { /* not a WEB body */ }
        return 'player';
    };
    // Each test describes only the main player; the microformat request gets a
    // canned answer unless a test supplies its own `web` handler.
    const cfg = (opts) => it.configureInnerTube({
        ...opts,
        fetch: (u, init) => (kindOf(u, init) === 'web'
            ? (opts.web ? opts.web(u, init) : Promise.resolve(json({ microformat: MICROFORMAT })))
            : opts.fetch(u, init))
    });

    await test('mints a token once, persists it, then reuses it', async () => {
        it.resetInnerTubeForTests();
        const store = memStore();
        const calls = [];
        cfg({ store, fetch: async (u, init) => {
            calls.push({ kind: kindOf(u), visitor: init.headers['X-Goog-Visitor-Id'] });
            return kindOf(u) === 'visitor' ? json({ responseContext: { visitorData: 'TOKEN1' } }) : json(fixture());
        } });

        assert.ok(await it.resolveInnerTube('abcdefghijk'));
        assert.ok(await it.resolveInnerTube('abcdefghijk'));
        assert.deepEqual(calls.map((c) => c.kind), ['visitor', 'player', 'player']);  // one mint, two lookups
        assert.equal(calls[1].visitor, 'TOKEN1');
        assert.equal(store.data[KEY], 'TOKEN1');
    });

    await test('uses a persisted token without minting', async () => {
        it.resetInnerTubeForTests();
        const calls = [];
        cfg({ store: memStore({ [KEY]: 'SAVED' }), fetch: async (u, init) => {
            calls.push({ kind: kindOf(u), visitor: init.headers['X-Goog-Visitor-Id'] });
            return json(fixture());
        } });
        assert.ok(await it.resolveInnerTube('abcdefghijk'));
        assert.deepEqual(calls, [{ kind: 'player', visitor: 'SAVED' }]);
    });

    await test('stale cached token: drops it, mints a new one, retries once', async () => {
        it.resetInnerTubeForTests();
        const store = memStore({ [KEY]: 'STALE' });
        const calls = [];
        cfg({ store, fetch: async (u, init) => {
            const v = init.headers['X-Goog-Visitor-Id'];
            calls.push(`${kindOf(u)}:${v ?? '-'}`);
            if (kindOf(u) === 'visitor') return json({ responseContext: { visitorData: 'FRESH' } });
            return v === 'STALE' ? json({ playabilityStatus: { status: 'LOGIN_REQUIRED' } }) : json(fixture());
        } });
        assert.ok(await it.resolveInnerTube('abcdefghijk'));
        assert.deepEqual(calls, ['player:STALE', 'visitor:-', 'player:FRESH']);
        assert.equal(store.data[KEY], 'FRESH');
    });

    await test('freshly minted token that is refused is NOT retried', async () => {
        it.resetInnerTubeForTests();
        let players = 0;
        cfg({ store: memStore(), fetch: async (u) => {
            if (kindOf(u) === 'visitor') return json({ responseContext: { visitorData: 'NEW' } });
            players++;
            return json({ playabilityStatus: { status: 'LOGIN_REQUIRED' } });  // e.g. an age-gated video
        } });
        assert.equal(await it.resolveInnerTube('abcdefghijk'), null);
        assert.equal(players, 1);
    });

    await test('a video that is simply unplayable is not retried', async () => {
        it.resetInnerTubeForTests();
        let players = 0;
        cfg({ store: memStore({ [KEY]: 'OK' }), fetch: async () => {
            players++;
            return json({ playabilityStatus: { status: 'UNPLAYABLE' } });
        } });
        assert.equal(await it.resolveInnerTube('abcdefghijk'), null);
        assert.equal(players, 1);
    });

    await test('network error declines instead of throwing', async () => {
        it.resetInnerTubeForTests();
        cfg({ store: memStore({ [KEY]: 'OK' }), fetch: async () => { throw new Error('ECONNRESET'); } });
        assert.equal(await it.resolveInnerTube('abcdefghijk'), null);
    });

    await test('no visitor token available: declines without a player call', async () => {
        it.resetInnerTubeForTests();
        let players = 0;
        cfg({ store: memStore(), fetch: async (u) => {
            if (kindOf(u) === 'visitor') return http(500);
            players++;
            return json(fixture());
        } });
        assert.equal(await it.resolveInnerTube('abcdefghijk'), null);
        assert.equal(players, 0);
    });

    await test('concurrent lookups share one token request', async () => {
        it.resetInnerTubeForTests();
        let mints = 0;
        cfg({ store: memStore(), fetch: async (u) => {
            if (kindOf(u) === 'visitor') {
                mints++;
                await new Promise((r) => setTimeout(r, 30));
                return json({ responseContext: { visitorData: 'SHARED' } });
            }
            return json(fixture());
        } });
        const results = await Promise.all([1, 2, 3, 4].map(() => it.resolveInnerTube('abcdefghijk')));
        assert.ok(results.every(Boolean));
        assert.equal(mints, 1);
    });

    await test('category and dates come from the parallel WEB request', async () => {
        it.resetInnerTubeForTests();
        const seen = [];
        cfg({ store: memStore({ [KEY]: 'OK' }),
            fetch: async (u, init) => { seen.push(init.headers['User-Agent']); return json(fixture()); },
            web: async (u, init) => { seen.push(init.headers['User-Agent']); return json({ microformat: MICROFORMAT }); } });
        const raw = await it.resolveInnerTube('abcdefghijk');
        assert.deepEqual(raw.categories, ['Music']);      // restores the isMusic signal
        assert.equal(raw.upload_date, '20240501');
        assert.equal(raw.like_count, 99);
        assert.equal(seen.length, 2);
        assert.match(seen.find((ua) => ua.startsWith('com.google.ios')), /visionOS/);   // streams: VISIONOS profile
        assert.match(seen.find((ua) => ua.startsWith('Mozilla')), /Chrome/);            // microformat: WEB profile
    });

    await test('the WEB request failing costs the category, not the answer', async () => {
        it.resetInnerTubeForTests();
        cfg({ store: memStore({ [KEY]: 'OK' }), fetch: async () => json(fixture()), web: async () => http(403) });
        const raw = await it.resolveInnerTube('abcdefghijk');
        assert.ok(raw);
        assert.deepEqual(raw.categories, []);
        assert.equal(raw.formats.length, 6);
    });

    await test('a slow WEB request does not hold up the answer', async () => {
        it.resetInnerTubeForTests();
        cfg({ store: memStore({ [KEY]: 'OK' }), fetch: async () => json(fixture()),
            web: (u, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))) });
        const started = Date.now();
        const raw = await it.resolveInnerTube('abcdefghijk');
        const took = Date.now() - started;
        assert.ok(raw);
        assert.deepEqual(raw.categories, []);
        assert.ok(took < 1500, `took ${took}ms; should wait only the short grace period`);
    });

    await test('the overall budget is enforced', async () => {
        it.resetInnerTubeForTests();
        cfg({ store: memStore({ [KEY]: 'OK' }), fetch: (u, init) => new Promise((_, reject) => {
            init.signal.addEventListener('abort', () => reject(new Error('aborted')));   // hangs until aborted
        }) });
        const started = Date.now();
        assert.equal(await it.resolveInnerTube('abcdefghijk', 150), null);
        assert.ok(Date.now() - started < 1500, 'gave up promptly');
    });

    // -----------------------------------------------------------------------
    console.log(`\n${passed} passed${process.exitCode ? ', with failures' : ''}`);

    // -----------------------------------------------------------------------
    const liveAt = process.argv.indexOf('--live');
    if (liveAt !== -1) {
        const id = process.argv[liveAt + 1] || 'dQw4w9WgXcQ';
        console.log(`\nLIVE smoke check against YouTube for ${id}`);
        it.resetInnerTubeForTests();
        it.configureInnerTube({ store: memStore(), fetch: (u, init) => fetch(u, init) });

        for (const label of ['cold (mints a token)', 'warm (token cached)']) {
            const t = Date.now();
            const raw = await it.resolveInnerTube(id);
            const ms = Date.now() - t;
            if (!raw) { console.log(`  ${label}: declined after ${ms}ms (see [InnerTube] line above)`); continue; }
            console.log(`  ${label}: ${ms}ms, ${raw.formats.length} formats, title ${JSON.stringify(raw.title)}`);
            if (label.startsWith('warm')) {
                const heights = [...new Set(raw.formats.filter((f) => f.video_ext !== 'none').map((f) => f.height))].sort((a, b) => b - a);
                console.log(`  video heights: ${heights.join(', ')}`);
                console.log(`  audio: ${raw.formats.filter((f) => f.vcodec === 'none').map((f) => `${f.format_id}/${f.ext}`).join(', ')}`);
                console.log(`  subtitles: ${Object.keys(raw.subtitles).length} manual, ${Object.keys(raw.automatic_captions).length} auto`);
                console.log(`  thumbnails: ${raw.thumbnails.map((t) => `${t.width}x${t.height}`).join(', ')}`);
                console.log(`  best thumbnail: ${raw.thumbnail}`);
                console.log(`  categories: ${JSON.stringify(raw.categories)}`);
            }
        }
    }
})().catch((e) => { console.error(e); process.exit(1); });
