/**
 * Tests for the YouTube player strategy and the cookie-aware error messages.
 *
 * These cover the bug behind "works on my PC, shows age-restricted on his":
 * the app pinned `player_client=tv_embedded` in *both* branches of an
 * if/else, so it always disabled yt-dlp's own fallback, and the embed player
 * without a session makes YouTube answer "Sign in to confirm your age" - even
 * for a public video.
 *
 *   npm run build:electron && node scripts/test-youtube-age.cjs
 */

const assert = require('assert');
const path = require('path');

const {
    youtubeClientAttempts,
    preferredYoutubeClient,
    isClientSensitiveError
} = require(path.join(__dirname, '..', 'dist-electron', 'utils', 'youtubeStrategy.js'));

const { classifyExtractionError, extractYtdlpOutput } = require(
    path.join(__dirname, '..', 'dist-electron', 'utils', 'errorMessage.js')
);

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  ok   ${name}`);
        passed++;
    } catch (e) {
        console.log(`  FAIL ${name}`);
        console.log(`       ${e.message}`);
        failed++;
    }
}

const PIN = 'youtube:player_client=tv_embedded';

// ---- The regression that caused the report -------------------------------

test('without cookies the app does NOT pin a player', () => {
    // Pinning here is what produced the bogus age-restricted error.
    assert.strictEqual(preferredYoutubeClient(false).extractorArgs, null);
});

test('with cookies tv_embedded is pinned for the full format list', () => {
    assert.deepStrictEqual(preferredYoutubeClient(true).extractorArgs, [PIN]);
});

test('both paths end in an unpinned retry, so fallback is never lost', () => {
    for (const hasCookies of [true, false]) {
        const attempts = youtubeClientAttempts(hasCookies);
        assert.strictEqual(attempts.length, 2, `expected 2 attempts with cookies=${hasCookies}`);
        assert.ok(
            attempts.some(a => a.extractorArgs === null),
            `no unpinned retry available with cookies=${hasCookies}`
        );
    }
});

test('the two orders differ, so the preferred one is genuinely best-effort', () => {
    // Cookies: pin first. No cookies: try yt-dlp's own fallback first.
    assert.deepStrictEqual(youtubeClientAttempts(true)[0].extractorArgs, [PIN]);
    assert.strictEqual(youtubeClientAttempts(false)[0].extractorArgs, null);
});

test('a refused player is worth retrying on another one', () => {
    for (const msg of [
        'ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users.',
        'ERROR: [youtube] abc: Sign in to confirm you\'re not a bot.',
        'ERROR: [youtube] abc: Requested format is not available.',
        'ERROR: [youtube] abc: Unable to extract player response'
    ]) {
        assert.strictEqual(isClientSensitiveError(msg), true, `should retry: ${msg}`);
    }
});

test('a genuinely missing video is NOT retried', () => {
    // Retrying these just doubles the wait before the same answer.
    for (const msg of [
        'ERROR: [youtube] abc: Private video. Sign in if you\'ve been granted access',
        'ERROR: [youtube] abc: Video unavailable',
        'ERROR: Unable to download webpage'
    ]) {
        assert.strictEqual(isClientSensitiveError(msg), false, `should not retry: ${msg}`);
    }
});

// ---- Dynamic error messages ---------------------------------------------

const AGE_WALL = 'ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users.';

test('without cookies an age wall still advises adding cookies', () => {
    const r = classifyExtractionError(AGE_WALL, 'https://youtu.be/abc');
    assert.strictEqual(r.kind, 'age');
    assert.ok(/Add cookies/i.test(r.message), r.message);
});

test('with cookies it stops telling the user to add cookies again', () => {
    // The exact complaint: he added cookies and was still told to add cookies.
    const r = classifyExtractionError(AGE_WALL, 'https://youtu.be/abc', { hasCookies: true });
    assert.strictEqual(r.kind, 'age');
    assert.ok(!/Add cookies in Settings/i.test(r.message), 'still says add cookies');
    assert.ok(/bot protection|not the problem/i.test(r.message), r.message);
});

test('with cookies an expired session is named as the likely cause', () => {
    const r = classifyExtractionError(
        'ERROR: [youtube] abc: Sign in to confirm you\'re not a bot. Use --cookies for the authentication.',
        'https://youtu.be/abc',
        { hasCookies: true }
    );
    // Bot-check is matched first, so this asserts on that branch too - it also
    // used to end with "add cookies in Settings" after the user had done it.
    assert.strictEqual(r.kind, 'bot-check');
    assert.ok(!/add cookies in Settings/i.test(r.message), 'still says add cookies');
    assert.ok(/bot protection/i.test(r.message), r.message);
});

test('bot-check still mentions cookies when none were sent', () => {
    const r = classifyExtractionError(
        'ERROR: [youtube] abc: Sign in to confirm you\'re not a bot.',
        'https://youtu.be/abc'
    );
    assert.strictEqual(r.kind, 'bot-check');
    assert.ok(/add cookies in Settings/i.test(r.message), r.message);
});

test('a genuinely age-gated video is still explained correctly', () => {
    // "age-restricted" is a distinct yt-dlp phrase from the login wall.
    const r = classifyExtractionError(
        'ERROR: [youtube] abc: This video is age-restricted',
        'https://youtu.be/abc',
        { hasCookies: true }
    );
    assert.strictEqual(r.kind, 'age');
});

test('unrelated platforms are unaffected by the cookie-aware messages', () => {
    const r = classifyExtractionError('ERROR: [tiktok] Private video', 'https://tiktok.com/x', { hasCookies: true });
    assert.strictEqual(r.kind, 'private');
    assert.ok(/private/i.test(r.message));
});

test('the context argument is optional', () => {
    assert.doesNotThrow(() => classifyExtractionError(AGE_WALL, 'https://youtu.be/abc'));
});

// ---- The earlier --user-agent trap must stay fixed ------------------------

test('our own command line cannot trigger a false age error', () => {
    const raw = 'Command failed: yt-dlp --user-agent "Mozilla/5.0" https://youtu.be/abc\nERROR: [generic] Unable to download webpage';
    const r = classifyExtractionError(raw, 'https://youtu.be/abc');
    assert.notStrictEqual(r.kind, 'age');
});

test('the invocation is stripped before classification', () => {
    const out = extractYtdlpOutput('Command failed: yt-dlp --user-agent "x" url\nERROR: boom');
    assert.ok(!/user-agent/.test(out), out);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);