/**
 * Tests for the JavaScript runtime handed to yt-dlp.
 *
 * The bug behind "it downloaded on my PC and failed on theirs":
 *
 *   WARNING: [youtube] No supported JavaScript runtime could be found.
 *            YouTube extraction without a JS runtime has been deprecated,
 *            and some formats may be missing.
 *
 * The old detectJsRuntime() searched PATH for deno/node and returned a bare
 * name. A developer machine with Node installed passed `--js-runtimes node`
 * and worked; a normal install had neither, got no flag at all, and silently
 * lost formats - which then surfaced as vague bot/age/login errors.
 *
 * Electron bundles Node. Setting ELECTRON_RUN_AS_NODE turns this app's own
 * binary into a plain Node runtime, so the app can always supply one.
 *
 *   npm run build:electron && node scripts/test-js-runtime.cjs
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const platform = require(path.join(__dirname, '..', 'dist-electron', 'utils', 'platform.js'));

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

const SRC = path.join(__dirname, '..', 'electron');
function readSource(rel) {
    return fs.readFileSync(path.join(SRC, rel), 'utf8');
}

// ---- The regression: there is always a runtime -----------------------------

test('detectJsRuntime() returns a runtime', () => {
    const rt = platform.detectJsRuntime();
    assert.ok(rt, 'no JavaScript runtime - yt-dlp will silently lose formats');
});

test('the runtime is the Node bundled inside the app, not a PATH lookup', () => {
    const rt = platform.detectJsRuntime();
    assert.strictEqual(rt.source, 'bundled-node');
    assert.strictEqual(rt.flag, `node:${process.execPath}`);
});

test('the flag carries an explicit path, never a bare name', () => {
    // A bare "node" is resolved from the child's PATH, which is exactly the
    // dependency that made this fail on machines without Node installed.
    const rt = platform.detectJsRuntime();
    assert.ok(rt.flag.includes(':'), `flag ${rt.flag} has no :PATH component`);
    const [, p] = rt.flag.split(/^node:/);
    assert.ok(p && path.isAbsolute(p), `${rt.flag} does not point at an absolute path`);
});

test('the spawn env sets ELECTRON_RUN_AS_NODE', () => {
    // Without this the Electron binary launches the GUI instead of Node.
    const rt = platform.detectJsRuntime();
    assert.strictEqual(rt.env.ELECTRON_RUN_AS_NODE, '1');
});

test('the spawn env does not leak ELECTRON_NO_ATTACH_CONSOLE as a stray string', () => {
    const rt = platform.detectJsRuntime();
    assert.strictEqual(rt.env.ELECTRON_NO_ATTACH_CONSOLE, '1');
});

test('caching returns the same object, so detection is not repeated per call', () => {
    assert.strictEqual(platform.detectJsRuntime(), platform.detectJsRuntime());
});

test('__resetJsRuntimeCache clears the cache', () => {
    platform.__resetJsRuntimeCache();
    assert.ok(platform.detectJsRuntime());
});

// ---- The spawn environment -------------------------------------------------

test('jsRuntimeSpawnEnv keeps PATH and adds the runtime vars', () => {
    const rt = platform.detectJsRuntime();
    const env = platform.jsRuntimeSpawnEnv(rt);
    // On Windows the variable is spelled "Path", not "PATH", and spreading
    // process.env preserves that spelling. The child needs it either way or it
    // cannot find ffmpeg.
    const hasPath = Object.keys(env).some((k) => k.toUpperCase() === 'PATH');
    assert.ok(hasPath, `PATH was dropped - keys: ${Object.keys(env).slice(0, 8).join(', ')}`);
    assert.strictEqual(env.ELECTRON_RUN_AS_NODE, '1');
});

test('jsRuntimeSpawnEnv does not mutate process.env', () => {
    const before = process.env.ELECTRON_RUN_AS_NODE;
    platform.jsRuntimeSpawnEnv(platform.detectJsRuntime());
    assert.strictEqual(process.env.ELECTRON_RUN_AS_NODE, before);
});

test('jsRuntimeSpawnEnv returns undefined when there is no runtime', () => {
    assert.strictEqual(platform.jsRuntimeSpawnEnv(null), undefined);
});

// ---- Drift guards: the handlers must actually use flag + env ---------------

for (const [file, label] of [
    ['handlers/infoHandler.ts', 'infoHandler'],
    ['handlers/downloadHandler.ts', 'downloadHandler']
]) {
    test(`${label} passes .flag to --js-runtimes`, () => {
        const src = readSource(file);
        const uses = src.match(/--js-runtimes/g) || [];
        assert.ok(uses.length > 0, 'no --js-runtimes usage found');
        assert.ok(
            !/'--js-runtimes',\s*[A-Za-z]+\b(?!\.flag)/.test(src),
            'a bare runtime name is passed to --js-runtimes; it must be .flag'
        );
    });

    test(`${label} passes the runtime env to the yt-dlp spawn`, () => {
        const src = readSource(file);
        assert.ok(
            /env:\s*jsRuntimeSpawnEnv\(/.test(src) || /\{\s*env:\s*jsRuntimeEnv\s*\}/.test(src),
            'yt-dlp is spawned without the runtime env, so ELECTRON_RUN_AS_NODE never reaches it'
        );
    });
}

test('infoHandler still retries alternate YouTube players', () => {
    // Bundling a runtime fixes missing formats; the player retry fixes players
    // that YouTube refuses. Both are needed - do not let one replace the other.
    const src = readSource('handlers/infoHandler.ts');
    assert.ok(/youtubeClientAttempts\(/.test(src));
    assert.ok(/isClientSensitiveError\(/.test(src));
});

test('downloadHandler still takes one preferred player', () => {
    const src = readSource('handlers/downloadHandler.ts');
    assert.ok(/preferredYoutubeClient\(/.test(src));
});

// ---- Do not reintroduce the flag overrides that cost high-res ------------

test('YouTube requests do NOT override the User-Agent', () => {
    // A user running plain `yt-dlp -F` got 1080p while the app offered 320p
    // only. The difference was this override: yt-dlp pairs its default UA with
    // its default player client, and a browser UA in front of that client is a
    // mismatch YouTube answers with a degraded format list.
    for (const [file, label] of [
        ['handlers/infoHandler.ts', 'infoHandler'],
        ['handlers/downloadHandler.ts', 'downloadHandler']
    ]) {
        const src = readSource(file);
        assert.ok(
            /if \(!isYoutube\) args\.push\('--user-agent'/.test(src),
            `${label} pushes --user-agent unconditionally`
        );
    }
});

test('the app does not pin a player when it has no cookies', () => {
    const { preferredYoutubeClient } = require(
        path.join(__dirname, '..', 'dist-electron', 'utils', 'youtubeStrategy.js')
    );
    assert.strictEqual(preferredYoutubeClient(false).extractorArgs, null);
});

// ---- Report ----------------------------------------------------------------

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);