/**
 * Node-level unit tests for the lyrics pure logic.
 *
 * The repo has no test framework installed and adding one is a larger change
 * than this feature warrants, so these are plain assertions run through
 * `node scripts/test-lyrics.cjs`. They import the compiled CommonJS output in
 * dist-electron, which means `npm run build:electron` must have run first -
 * which is also what proves the modules compile under `strict`.
 */

const assert = require('assert');
const path = require('path');

const dist = path.join(__dirname, '..', 'dist-electron', 'utils', 'lyrics');
const { parseLrc, parseYrc, isUsableTimeline } = require(path.join(dist, 'parsers.js'));
const {
    isVariantTitle,
    normalizeTitle,
    normalizeArtist,
    artistTokens,
    titleScore,
    artistScore,
    durationScore
} = require(path.join(dist, 'normalize.js'));
const { isEmpty } = require(path.join(dist, 'types.js'));
const { titleCandidates, titleCredits } = require(path.join(dist, 'normalize.js'));

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
        console.log(`       ${e.message.split('\n')[0]}`);
    }
}

function group(name) {
    console.log(`\n${name}`);
}

console.log('lyrics pure-logic tests');

// ---------------------------------------------------------------- parsers

group('parseLrc');

test('parses a single timestamp', () => {
    const lines = parseLrc('[00:12.34]Hello world');
    assert.deepStrictEqual(lines, [{ t: 12_340, text: 'Hello world' }]);
});

test('parses mm:ss with no fraction', () => {
    assert.deepStrictEqual(parseLrc('[01:05]Line'), [{ t: 65_000, text: 'Line' }]);
});

test('colon-separated fraction is milliseconds, not hundredths', () => {
    // `:50` = 50ms, so 1s + 50ms. Reading it as hundredths gave 1500ms.
    assert.deepStrictEqual(parseLrc('[00:01:50]X'), [{ t: 1_050, text: 'X' }]);
    assert.strictEqual(parseLrc('[00:01:500]X')[0].t, 1_500);
    assert.strictEqual(parseLrc('[00:01:5]X')[0].t, 1_005);
});

test('dot-separated fraction is hundredths of a second', () => {
    // `.5`, `.50` and `.500` all mean 500ms
    assert.strictEqual(parseLrc('[00:00.5]a')[0].t, 500);
    assert.strictEqual(parseLrc('[00:00.50]a')[0].t, 500);
    assert.strictEqual(parseLrc('[00:00.500]a')[0].t, 500);
    // `.05` means 50ms, not 500
    assert.strictEqual(parseLrc('[00:00.05]a')[0].t, 50);
});

test('expands repeated timestamps for a repeated line', () => {
    const lines = parseLrc('[00:10.00][01:20.00]Chorus');
    assert.deepStrictEqual(lines, [
        { t: 10_000, text: 'Chorus' },
        { t: 80_000, text: 'Chorus' }
    ]);
});

test('drops metadata tags with no timestamp', () => {
    assert.deepStrictEqual(parseLrc('[ar:Ed Sheeran]\n[ti:Shape of You]\n[00:03.00]Real'), [
        { t: 3000, text: 'Real' }
    ]);
});

test('drops a bare timestamp used as a spacer', () => {
    assert.deepStrictEqual(parseLrc('[00:10.00]'), []);
});

test('sorts lines by time regardless of file order', () => {
    const lines = parseLrc('[00:30.00]third\n[00:10.00]first\n[00:20.00]second');
    assert.deepStrictEqual(lines.map((l) => l.text), ['first', 'second', 'third']);
});

test('returns empty for junk input', () => {
    assert.deepStrictEqual(parseLrc(''), []);
    assert.deepStrictEqual(parseLrc('not lyrics at all'), []);
    assert.deepStrictEqual(parseLrc(null), []);
});

group('parseYrc');

test('parses word-level timings', () => {
    const lines = parseYrc('[1000,3000](1000,500,0)Hello (1500,500,0)world');
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(lines[0].t, 1000);
    assert.strictEqual(lines[0].text, 'Hello world');
    assert.deepStrictEqual(lines[0].words, [
        { t: 1000, d: 500, w: 'Hello' },
        { t: 1500, d: 500, w: 'world' }
    ]);
});

test('skips negative-t credit lines', () => {
    // The real shape NetEase returns, rendered as if it were a lyric line.
    const raw = [
        '{"t":-1000,"c":[{"tx":"作词: "},{"tx":"someone"}]}',
        '[0,2000](0,500,0)Real (500,500,0)lyrics'
    ].join('\n');
    const lines = parseYrc(raw);
    assert.strictEqual(lines.length, 1, 'credit line must be dropped');
    assert.strictEqual(lines[0].text, 'Real lyrics');
});

test('skips the JSON credit block that precedes real lyrics', () => {
    // Verified live: NetEase returns a hybrid payload where the first lines are
    // JSON credit metadata and the timed lyrics follow as plain yrc text, all
    // inside one string. Truncated from a real 'Blinding Lights' response.
    const raw = [
        '{"t":0,"c":[{"tx":"制作人: "},{"tx":"The Weeknd","or":"orpheus://nm/artist/home?id=185858&type=artist"}]}',
        '{"t":1000,"c":[{"tx":"作词: "},{"tx":"Max Martin"}]}',
        '{"t":2000,"c":[{"tx":"作曲: "},{"tx":"Oscar Holter"}]}',
        '[23550,120](23550,120,0)Yeah',
        '[24290,150](24290,150,0)I'
    ].join('\n');
    const lines = parseYrc(raw);
    assert.strictEqual(lines.length, 2, 'only the two real lyric lines survive');
    assert.deepStrictEqual(lines.map((l) => l.text), ['Yeah', 'I']);
    assert.strictEqual(lines[0].t, 23_550);
});

test('a real multi-word line keeps every word timing', () => {
    // Truncated from a real 'Yesterday' response, where the comma is its own
    // timed token - it must not be dropped as punctuation.
    const line = parseYrc('[5580,9270](5580,1830,0)Yesterday (7410,1080,0),(8490,330,0)all');
    assert.strictEqual(line.length, 1);
    assert.deepStrictEqual(line[0].words.map((w) => w.w), ['Yesterday', ',', 'all']);
    assert.deepStrictEqual(line[0].words.map((w) => w.t), [5580, 7410, 8490]);
});

test('handles CJK per-character segmentation', () => {
    const lines = parseYrc('[0,2000](0,500,0)你 (500,500,0)好');
    assert.strictEqual(lines.length, 1);
    assert.deepStrictEqual(lines[0].words.map((w) => w.w), ['你', '好']);
});

test('drops a line with no word groups', () => {
    assert.deepStrictEqual(parseYrc('[1000,3000]'), []);
});

test('drops lines with no line stamp', () => {
    assert.deepStrictEqual(parseYrc('(1000,500,0)orphan'), []);
});

test('returns empty for junk input', () => {
    assert.deepStrictEqual(parseYrc(''), []);
    assert.deepStrictEqual(parseYrc(null), []);
});

test('sorts by line time', () => {
    const lines = parseYrc('[3000,1000](3000,100,0)c\n[1000,1000](1000,100,0)a');
    assert.deepStrictEqual(lines.map((l) => l.text), ['a', 'c']);
});

group('isUsableTimeline');

test('accepts a non-empty array', () => {
    assert.strictEqual(isUsableTimeline([{ t: 0, text: 'a' }]), true);
});

test('rejects empty and missing', () => {
    assert.strictEqual(isUsableTimeline([]), false);
    assert.strictEqual(isUsableTimeline(undefined), false);
});

// ------------------------------------------------------------- blocklist

group('isVariantTitle (the remix trap guard)');

const VARIANTS = [
    'Shape Of You (Galantis Extended Remix)',
    'Shape of You (Acoustic)',
    'Shape of You (Live)',
    'Shape of You - 2011 Remaster',
    'Shape of You (Radio Edit)',
    'Shape of You (Sped Up)',
    'Shape of You (Slowed + Reverb)',
    'Shape of You (Instrumental)',
    'Shape of You (Karaoke Version)',
    'Kesariya (Unplugged)',
    'Kesariya - Rework',
    'Song (VIP)',
    'Song (Demo)',
    'Song (Cover)'
];

test('rejects every variant form', () => {
    for (const v of VARIANTS) {
        assert.ok(isVariantTitle(v), `should reject: ${v}`);
    }
});

test('accepts the canonical title', () => {
    assert.strictEqual(isVariantTitle('Shape of You'), false);
    assert.strictEqual(isVariantTitle('Kesariya'), false);
    assert.strictEqual(isVariantTitle('Bayaan'), false);
});

test('accepts a title that only credits a featured artist', () => {
    assert.strictEqual(isVariantTitle('Shape of You (feat. Someone)'), false);
});

test('matches whole words, not substrings', () => {
    // "mix" must not fire inside "mixture", "edit" inside "editorial",
    // "live" inside "delivery", "vip" inside "vipper"
    assert.strictEqual(isVariantTitle('A Perfect Mixture'), false);
    assert.strictEqual(isVariantTitle('Editorial Department'), false);
    assert.strictEqual(isVariantTitle('Same Delivery'), false);
    assert.strictEqual(isVariantTitle('Revolver'), false);
});

test('is case insensitive', () => {
    assert.strictEqual(isVariantTitle('shape of you (REMIX)'), true);
});

test('handles empty input', () => {
    assert.strictEqual(isVariantTitle(''), false);
    assert.strictEqual(isVariantTitle(undefined), false);
});

group('normalizeTitle');

test('strips the official-video marker', () => {
    assert.strictEqual(normalizeTitle('Shape of You (Official Video)'), 'shape of you');
    assert.strictEqual(normalizeTitle('Shape of You (Official Music Video)'), 'shape of you');
    assert.strictEqual(normalizeTitle('Shape of You (Official Audio)'), 'shape of you');
});

test('strips featured-artist tails', () => {
    assert.strictEqual(normalizeTitle('Shape of You (feat. Someone)'), 'shape of you');
    assert.strictEqual(normalizeTitle('Shape of You feat. Someone'), 'shape of you');
});

test('strips filler articles', () => {
    assert.strictEqual(normalizeTitle('The Best Song'), 'best song');
});

test('treats dots and underscores as separators', () => {
    assert.strictEqual(normalizeTitle('S.O.S.'), 's o s');
    assert.strictEqual(normalizeTitle('Hello_World'), 'hello world');
});

test('leaves a clean title unchanged apart from case', () => {
    assert.strictEqual(normalizeTitle('Shape of You'), 'shape of you');
    assert.strictEqual(normalizeTitle('Bayaan'), 'bayaan');
});

test('handles empty input', () => {
    assert.strictEqual(normalizeTitle(''), '');
    assert.strictEqual(normalizeTitle(undefined), '');
});

group('normalizeArtist');

test('joins ampersand as and', () => {
    assert.strictEqual(normalizeArtist('Simon & Garfunkel'), 'simon and garfunkel');
});

test('strips a featured-artist group', () => {
    assert.strictEqual(normalizeArtist('Ed Sheeran (feat. Justin Bieber)'), 'ed sheeran');
});

test('handles empty input', () => {
    assert.strictEqual(normalizeArtist(''), '');
});

group('artistTokens');

test('splits a multi-artist string', () => {
    const tokens = artistTokens('Ed Sheeran, Justin Bieber');
    assert.ok(tokens.includes('ed sheeran'));
    assert.ok(tokens.includes('justin bieber'));
});

group('scoring');

test('identical titles score 1', () => {
    assert.strictEqual(titleScore('Shape of You', 'Shape of You'), 1);
});

test('title score survives the official-video suffix', () => {
    assert.strictEqual(titleScore('Shape of You', 'Shape of You (Official Video)'), 1);
});

test('an unrelated title scores low', () => {
    assert.ok(titleScore('Shape of You', 'Perfect Song') < 0.62);
});

test('artist containment scores high but below exact', () => {
    const exact = artistScore('Ed Sheeran', 'Ed Sheeran');
    const contained = artistScore('Ed Sheeran', 'Ed Sheeran and Someone Else');
    assert.strictEqual(exact, 1);
    assert.ok(contained > 0.7 && contained < 1, `got ${contained}`);
});

test('an unrelated artist scores low', () => {
    assert.ok(artistScore('Ed Sheeran', 'Beyonce') < 0.62);
});

test('duration inside tolerance scores 1', () => {
    assert.strictEqual(durationScore(234, 234), 1);
    assert.strictEqual(durationScore(234, 236), 1);
    assert.strictEqual(durationScore(234, 238), 1);
});

test('the 1-second Galantis gap is treated as a match on duration alone', () => {
    // Documents exactly why duration cannot be trusted on its own.
    assert.strictEqual(durationScore(234, 235), 1);
});

test('duration within 2x tolerance scores 0.5', () => {
    assert.strictEqual(durationScore(234, 241), 0.5);
});

test('a far-off duration scores 0', () => {
    assert.strictEqual(durationScore(234, 260), 0);
});

test('duration score is null when either side is unknown', () => {
    assert.strictEqual(durationScore(undefined, 234), null);
    assert.strictEqual(durationScore(234, undefined), null);
    assert.strictEqual(durationScore(0, 234), null);
});

group('isEmpty');

test('a result with only plain text is not empty', () => {
    assert.strictEqual(
        isEmpty({ title: 't', artist: 'a', plain: 'la la la', sources: {} }),
        false
    );
});

test('a result with only synced lines is not empty', () => {
    assert.strictEqual(
        isEmpty({ title: 't', artist: 'a', synced: [{ t: 0, text: 'a' }], sources: {} }),
        false
    );
});

test('a result with nothing is empty', () => {
    assert.strictEqual(isEmpty({ title: 't', artist: 'a', sources: {} }), true);
    assert.strictEqual(
        isEmpty({ title: 't', artist: 'a', plain: '   ', synced: [], sources: {} }),
        true
    );
});

// -------------------------------------------------- the end-to-end guard

group('remix trap: end-to-end on the measured pair');

test('the remix is rejected and the official track survives', () => {
    // The exact pair measured during research.
    const official = 'Shape of You';
    const remix = 'Shape Of You (Galantis Extended Remix)';

    assert.strictEqual(isVariantTitle(remix), true, 'remix must be blocked');
    assert.strictEqual(isVariantTitle(official), false, 'official must survive');

    // Even though duration says they are the same song, the title gate stops it.
    assert.strictEqual(durationScore(234, 235), 1);
    assert.ok(titleScore(official, remix) < 1, 'remix title must not match exactly');
});

test('a shape-of-you remix never scores above the accept threshold', () => {
    // Mirrors scoreCandidate in lrclib.ts / netease.ts.
    const scoreCandidate = (want, cand) => {
        const t = titleScore(want.title, cand.trackName);
        if (t < 0.5) return 0;
        const a = artistScore(want.artist, cand.artistName);
        if (a < 0.5) return 0;
        const d = durationScore(want.duration, cand.duration);
        const base = t * 0.7 + a * 0.3;
        if (d === null) return base;
        if (d === 0) return base * 0.5;
        return base * (0.9 + 0.1 * d);
    };

    const want = { title: 'Shape of You', artist: 'Ed Sheeran', duration: 234 };

    // With the blocklist in front, the remix never reaches scoring at all.
    const survivors = [
        { trackName: 'Shape of You', artistName: 'Ed Sheeran', duration: 234 },
        { trackName: 'Shape Of You (Galantis Extended Remix)', artistName: 'Galantis', duration: 235 }
    ].filter((c) => !isVariantTitle(c.trackName));

    assert.strictEqual(survivors.length, 1, 'only the official track should survive filtering');
    assert.strictEqual(survivors[0].trackName, 'Shape of You');

    const score = scoreCandidate(want, survivors[0]);
    assert.ok(score >= 0.8, `official track should clear the accept threshold, got ${score}`);

    // And if the blocklist were ever bypassed, scoring alone would still be
    // dragged down by the artist mismatch.
    const bypass = scoreCandidate(want, {
        trackName: 'Shape Of You (Galantis Extended Remix)',
        artistName: 'Galantis',
        duration: 235
    });
    assert.ok(bypass < 0.62, `remix must stay below the floor even unscored-by-title, got ${bypass}`);
});

// ------------------------------------------------------- file formatting

const { buildLyricsFile, toLrc, toEnhancedLrc, toPlainText, displayTitle, displayArtist } = require(path.join(dist, 'format.js'));

const sampleLines = [
    { t: 0, text: 'First line', words: [{ t: 0, d: 500, w: 'First' }, { t: 500, d: 400, w: 'line' }] },
    { t: 1000, text: 'Second line' }
];

test('timestamps are zero-padded with hundredths', () => {
    const out = toLrc([{ t: 61234, text: 'x' }], '', '');
    assert.ok(out.includes('[01:01.23]'), out);
});

test('a zero or negative timestamp does not produce a negative stamp', () => {
    const out = toLrc([{ t: -50, text: 'x' }, { t: 0, text: 'y' }], '', '');
    assert.ok(!out.includes('-'), out);
    assert.ok(out.includes('[00:00.00]'), out);
});

test('LRC carries title and artist headers', () => {
    const out = toLrc(sampleLines, 'Perfect', 'Ed Sheeran');
    assert.ok(out.includes('[ti]:Perfect'), out);
    assert.ok(out.includes('[ar]:Ed Sheeran'), out);
});

test('word timings become inline enhanced LRC stamps', () => {
    const out = toEnhancedLrc(sampleLines, 'T', 'A');
    assert.ok(out.includes('<00:00.00>First'), out);
    assert.ok(out.includes('<00:00.50>line'), out);
});

test('a line without word timings stays a valid plain LRC row', () => {
    const out = toEnhancedLrc(sampleLines, 'T', 'A');
    assert.ok(out.includes('[00:01.00]Second line'), out);
    // It must not degrade into an empty run of inline stamps.
    assert.ok(!/\[00:01\.00\]<00:01\.00>/.test(out), out);
});

test('plain text keeps line structure', () => {
    const out = toPlainText(sampleLines, 'T', 'A');
    assert.ok(out.includes('T - A'), out);
    assert.ok(out.includes('First line\nSecond line'), JSON.stringify(out));
});

// A filename is what a user sees in a file dialog, and an unsafe one either
// escapes the folder or produces a name Windows silently mangles.
// A save is named from what the user saw, not from the normalized strings the
// provider matched on - otherwise every file is lowercase and a credit line
// masquerades as the title.
// The filenames a user actually sees. All of these are real upload-title
// shapes taken from the tracks that were being tested against.
test('an Artist - Title upload is not named Artist - Artist - Title', () => {
    const file = buildLyricsFile(
        { title: 'x', artist: 'x', sources: {}, synced: sampleLines },
        'synced',
        'Ed Sheeran - Perfect (Official Music Video)',
        'Ed Sheeran'
    );
    assert.strictEqual(file.filename, 'Ed Sheeran - Perfect.lrc');
});

test('a Track - Credits upload drops the credits', () => {
    const file = buildLyricsFile(
        { title: 'x', artist: 'x', sources: {}, synced: sampleLines },
        'synced',
        'Ae Ajnabee (Official Music Video) - Aditya Rikhari, Ravator, Kutle Khan | Coke Studio Bharat',
        'Coke Studio India'
    );
    assert.strictEqual(file.filename, 'Coke Studio India - Ae Ajnabee.lrc');
});

test('the dash is left alone when there is no artist to compare against', () => {
    // Guessing here is how "Ed Sheeran - Perfect" became "Ed Sheeran".
    const file = buildLyricsFile(
        { title: 'x', artist: 'x', sources: {}, synced: sampleLines },
        'synced',
        'Ed Sheeran - Perfect (Official Music Video)',
        ''
    );
    assert.strictEqual(file.filename, 'Ed Sheeran - Perfect.lrc');
});

test('a real parenthetical in the title survives', () => {
    const file = buildLyricsFile(
        { title: 'x', artist: 'x', sources: {}, synced: sampleLines },
        'synced',
        'Song (Live at Wembley)',
        'Some Artist'
    );
    assert.ok(file.filename.includes('Live at Wembley'), file.filename);
});

// The panel header regression: raw upload metadata rendered verbatim, so the
// header showed the credits and channel welded into the title.
test('the display title strips credits and channel', () => {
    assert.strictEqual(
        displayTitle('Ae Ajnabee (Official Music Video) - Aditya Rikhari, Ravator, Kutle Khan | Coke Studio Bharat', 'Coke Studio India'),
        'Ae Ajnabee'
    );
    assert.strictEqual(
        displayTitle('Ed Sheeran - Perfect (Official Music Video)', 'Ed Sheeran'),
        'Ed Sheeran - Perfect'
    );
    assert.strictEqual(displayTitle('Shape of You (Official Video)', 'Ed Sheeran'), 'Shape of You');
    assert.strictEqual(displayTitle('Tum', 'Murtaza Qizilbash'), 'Tum');
});

// The display artist keeps the original casing, because the matched `artist` is
// lowercased by normalization and that leaked into both the header and filenames.
test('the display artist keeps the original casing and full credits', () => {
    assert.strictEqual(
        displayArtist('Coke Studio India, Aditya Rikhari, Ravator Music, Kutle Khan Project'),
        'Coke Studio India, Aditya Rikhari, Ravator Music, Kutle Khan Project'
    );
    assert.strictEqual(displayArtist('Ed Sheeran'), 'Ed Sheeran');
    assert.strictEqual(displayArtist('Ed Sheeran, Justin Bieber'), 'Ed Sheeran, Justin Bieber');
    assert.strictEqual(displayArtist('Ed Sheeran - Topic'), 'Ed Sheeran');
    assert.strictEqual(displayArtist(''), '');
});

test('a saved file is named in the metadata casing, not the lowercase match', () => {
    const file = buildLyricsFile(
        { title: 'n', artist: 'n', sources: {}, synced: sampleLines },
        'synced',
        'Ae Ajnabee',
        'Aditya Rikhari, Ravator, Kutle Khan'
    );
    assert.strictEqual(file.filename, 'Aditya Rikhari, Ravator, Kutle Khan - Ae Ajnabee.lrc');
    // The matched `artist` for this track is lowercase; it must not be the
    // prefix that lands on disk.
    assert.ok(file.filename.startsWith('Aditya'), file.filename);
});

test('an unknown artist does not produce a "lyrics - " prefix', () => {
    const file = buildLyricsFile(
        { title: 'x', artist: 'x', sources: {}, synced: sampleLines },
        'synced',
        'Shape of You',
        ''
    );
    assert.strictEqual(file.filename, 'Shape of You.lrc');
});

test('display strings override the normalized ones', () => {
    const file = buildLyricsFile(
        { title: 'ed sheeran - perfect', artist: 'ed sheeran', sources: {}, synced: sampleLines },
        'synced',
        'Ed Sheeran - Perfect (Official Music Video)',
        'Ed Sheeran'
    );
    assert.ok(file.filename.startsWith('Ed Sheeran - '), file.filename);
    assert.ok(file.filename.includes('Ed Sheeran - Perfect'), file.filename);
    assert.ok(file.content.includes('[ti]:Ed Sheeran - Perfect'), file.content);
});

test('slashes and quotes in an artist cannot escape the folder', () => {
    const file = buildLyricsFile(
        { title: 'Song: Part 1', artist: 'AC/DC', sources: {}, synced: sampleLines },
        'synced'
    );
    assert.ok(!file.filename.includes('/'), file.filename);
    assert.ok(!file.filename.includes(':'), file.filename);
    assert.ok(file.filename.endsWith('.lrc'), file.filename);
});

test('a trailing dot is stripped so the extension survives', () => {
    const file = buildLyricsFile(
        { title: 'Song.', artist: 'Artist.', sources: {}, synced: sampleLines },
        'synced'
    );
    assert.ok(!/\.lrc\.lrc/.test(file.filename), file.filename);
    assert.ok(file.filename.endsWith('.lrc'), file.filename);
});

test('word export is LRC, plain export is text', () => {
    const lyrics = {
        title: 'T', artist: 'A', sources: {},
        words: sampleLines, synced: sampleLines, plain: 'raw text',
        translation: sampleLines
    };
    assert.ok(buildLyricsFile(lyrics, 'words').filename.endsWith('.lrc'));
    assert.ok(buildLyricsFile(lyrics, 'plain').filename.endsWith('.txt'));
    assert.ok(buildLyricsFile(lyrics, 'synced').filename.endsWith('.lrc'));
    assert.ok(buildLyricsFile(lyrics, 'translation').filename.endsWith('.txt'));
});

test('plain export falls back to synced lines when no raw text exists', () => {
    const file = buildLyricsFile(
        { title: 'T', artist: 'A', sources: {}, synced: sampleLines },
        'plain'
    );
    assert.ok(file.content.includes('First line'), JSON.stringify(file.content));
});

test('an empty tab yields null instead of an empty file', () => {
    const lyrics = { title: 'T', artist: 'A', sources: {}, synced: sampleLines };
    assert.strictEqual(buildLyricsFile(lyrics, 'words'), null);
    assert.strictEqual(buildLyricsFile(lyrics, 'translation'), null);
    assert.strictEqual(buildLyricsFile(null, 'synced'), null);
});

// ------------------------------------------------- title / credit candidates

// Verified against real uploads that returned no lyrics until these were cut.
const AE_AJNABEE = 'Ae Ajnabee (Official Music Video) - Aditya Rikhari, Ravator, Kutle Khan | Coke Studio Bharat';

test('the untruncated title is always the first candidate', () => {
    const [first] = titleCandidates('Ed Sheeran - Perfect (Official Music Video)');
    assert.strictEqual(first, 'ed sheeran - perfect');
});

test('the channel after a pipe is dropped', () => {
    const variants = titleCandidates('Sandwich | Some Channel');
    assert.ok(variants.includes('sandwich'), variants.join(' | '));
});

test('the credit line after a dash is dropped', () => {
    const variants = titleCandidates(AE_AJNABEE);
    assert.ok(variants.includes('ae ajnabee'), variants.join(' | '));
});

test('candidates are de-duplicated', () => {
    const variants = titleCandidates('Sandwich');
    assert.deepStrictEqual(variants, ['sandwich']);
});

test('a title with no dash or pipe yields one candidate', () => {
    assert.deepStrictEqual(titleCandidates('Shape of You'), ['shape of you']);
});

// The dash cut is the dangerous one, so the safer full title must be tried first
// and must remain present in the list.
test('a dash title keeps the longer form available first', () => {
    const variants = titleCandidates('Ed Sheeran - Perfect');
    assert.deepStrictEqual(variants, ['ed sheeran - perfect', 'ed sheeran']);
});

test('credits are read out of the title credit line', () => {
    assert.strictEqual(
        titleCredits(AE_AJNABEE),
        'aditya rikhari, ravator, kutle khan'
    );
});

test('a title with no credit line reports none', () => {
    assert.strictEqual(titleCredits('Shape of You'), '');
});

// ----------------------------------------------------------------- report

console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) {
    console.log('\nfailures:');
    for (const f of failures) {
        console.log(`\n  ${f.name}`);
        console.log(`  ${f.error.stack.split('\n').slice(0, 4).join('\n  ')}`);
    }
    process.exit(1);
}
