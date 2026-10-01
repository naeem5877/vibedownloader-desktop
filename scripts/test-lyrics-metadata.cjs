/**
 * Contract test for the metadata the lyrics panel depends on.
 *
 * The panel never guesses whether a track is music: it reads `isMusic` and
 * `artist` off the metadata that `buildMetadataFromRaw` produced. If either is
 * missing or wrong the panel silently renders nothing, which is exactly the bug
 * this file exists to prevent. So these assertions run against the real builder
 * rather than a hand-written stand-in.
 */

const assert = require('assert');
const { buildMetadataFromRaw } = require('../dist-electron/handlers/infoHandler.js');

let passed = 0;
let failed = 0;

function check(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ok   ${name}`);
    } catch (e) {
        failed++;
        console.log(`  FAIL ${name}`);
        console.log(`       ${e.message}`);
    }
}

function baseRaw(over = {}) {
    return {
        id: 'abc123',
        title: 'Shape of You',
        uploader: 'Ed Sheeran',
        channel: 'Ed Sheeran',
        duration: 233,
        view_count: 1000,
        categories: [],
        thumbnails: [],
        formats: [],
        webpage_url: 'https://www.youtube.com/watch?v=abc123',
        ...over
    };
}

/** The builder returns `{ metadata, contentType }`; these cases only care about metadata. */
async function metadataFor(raw, url, isYoutube) {
    const { metadata } = await buildMetadataFromRaw(raw, url, isYoutube);
    return metadata;
}

async function main() {
    console.log('lyrics metadata contract\n');

    // A `-Topic` uploader is the common YouTube Music case: the channel is the
    // artist plus a marker, and that marker must not reach the lyric search or
    // it will compare against an artist name no provider knows.
    const topic = await metadataFor(
        baseRaw({ uploader: 'Ed Sheeran - Topic', channel: 'Ed Sheeran - Topic', categories: ['Music'] }),
        'https://www.youtube.com/watch?v=abc123',
        true
    );
    check('a -Topic uploader is recognised as music', () => {
        assert.strictEqual(topic.isMusic, true);
    });
    check('the -Topic marker is stripped from the artist', () => {
        assert.strictEqual(topic.artist, 'Ed Sheeran');
    });

    // A Music category is the other signal, and it must work without a Topic name.
    const categorised = await metadataFor(
        baseRaw({ uploader: 'SomeOfficialVEVO', channel: 'SomeOfficialVEVO', categories: ['Music'] }),
        'https://www.youtube.com/watch?v=abc123',
        true
    );
    check('a Music category is recognised as music', () => {
        assert.strictEqual(categorised.isMusic, true);
    });
    check('a Music category still yields a usable artist', () => {
        assert.ok(String(categorised.artist || '').length > 0, 'artist must not be empty');
    });

    // music.youtube.com host detection, with no category and no Topic suffix.
    const host = await metadataFor(
        baseRaw({ uploader: 'Ed Sheeran', categories: [] }),
        'https://music.youtube.com/watch?v=abc123',
        true
    );
    check('the music.youtube.com host is recognised as music', () => {
        assert.strictEqual(host.isMusic, true);
    });

    // The negative case matters most: a talk or gaming video must not be looked
    // up, otherwise a loosely-titled track can pull in the wrong lyrics.
    const talk = await metadataFor(
        baseRaw({ title: 'Why I Left YouTube', uploader: 'SomeGamer', categories: ['Gaming'] }),
        'https://www.youtube.com/watch?v=abc123',
        true
    );
    check('an ordinary video is not music', () => {
        assert.strictEqual(talk.isMusic, false);
    });
    check('a non-music video yields no artist for matching', () => {
        assert.strictEqual(talk.artist, '');
    });

    // YouTube-only detection: a non-YouTube extraction must not inherit it.
    const nonYt = await metadataFor(
        baseRaw({ categories: ['Music'] }),
        'https://example.com/watch?v=abc123',
        false
    );
    check('music detection does not leak to non-YouTube extractions', () => {
        assert.strictEqual(nonYt.isMusic, false);
    });

    // Regression: `music.youtube.com/watch?v=tdnkkMK3N88` reports the same
    // name twice in both `artist` and `creator`. The doubled string matches no
    // catalogue, so the panel rendered nothing with no visible cause.
    const doubled = await metadataFor(
        baseRaw({
            title: 'Tum',
            artist: 'Murtaza Qizilbash, Murtaza Qizilbash',
            creator: 'Murtaza Qizilbash, Murtaza Qizilbash',
            uploader: 'Murtaza Qizilbash',
            uploader_id: '@murtazaqizilbash',
            categories: ['Music']
        }),
        'https://music.youtube.com/watch?v=tdnkkMK3N88',
        true
    );
    check('a repeated artist name is collapsed to one', () => {
        assert.strictEqual(doubled.artist, 'Murtaza Qizilbash');
    });

    // A real collaboration must survive: two different names is a feature
    // credit, not the same artefact as a repeated name.
    const collab = await metadataFor(
        baseRaw({
            title: 'Stay',
            artist: 'Ed Sheeran, Justin Bieber',
            uploader: 'Ed Sheeran',
            categories: ['Music']
        }),
        'https://www.youtube.com/watch?v=8pXQemQAig8',
        true
    );
    check('two different artists are both kept', () => {
        assert.strictEqual(collab.artist, 'Ed Sheeran, Justin Bieber');
    });

    const topicChannel = await metadataFor(
        baseRaw({
            title: 'Perfect',
            artist: 'Ed Sheeran - Topic',
            uploader: 'Ed Sheeran - Topic',
            categories: ['Music']
        }),
        'https://www.youtube.com/watch?v=2Vv-BfVoq4g',
        true
    );
    check('the - Topic channel marker is stripped', () => {
        assert.strictEqual(topicChannel.artist, 'Ed Sheeran');
    });

    console.log(`\n${passed} passed, ${failed} failed`);

    // The music cases kick off a YouTube Music artwork fetch that outlives the
    // last assertion, so let it drain before exiting rather than tearing the
    // socket out from under it.
    await new Promise((r) => setTimeout(r, 1500));
    process.exit(failed === 0 ? 0 : 1);
}

main();