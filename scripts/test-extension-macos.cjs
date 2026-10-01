/**
 * Tests for browser detection on macOS.
 *
 * Reported from an M1 MacBook Pro running VibeDownloader-2.0.0-arm64.dmg:
 * the onboarding said "this PC", did not see Microsoft Edge, and showed
 * "We couldn't detect a browser on this PC".
 *
 * The cause was that every candidate path was a Windows .exe under Program
 * Files or LOCALAPPDATA. None of those exist on a Mac, so detection returned
 * nothing for every user on macOS - the app looked broken there while working
 * fine on Windows.
 *
 *   npm run build:electron && node scripts/test-extension-macos.cjs
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ext = require(path.join(__dirname, '..', 'dist-electron', 'utils', 'extensionInstaller.js'));

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

// ---- The bundle layout -----------------------------------------------------

test('a macOS browser resolves to Contents/MacOS inside the .app', () => {
    // Asserted structurally rather than as a literal: these paths are only ever
    // built on macOS, where path.join uses '/', but this suite also runs on a
    // Windows dev box where it uses '\'. The invariant that matters is the
    // bundle layout, and that no Windows .exe path leaked in.
    for (const p of ext.macAppPaths('Microsoft Edge', 'Microsoft Edge')) {
        assert.ok(p.includes('.app'), p);
        assert.ok(p.includes(`${path.sep}Contents${path.sep}MacOS${path.sep}`), p);
        assert.ok(p.endsWith('Microsoft Edge'), p);
        assert.ok(!p.includes('.exe'), p);
    }
});

test('both a system-wide and a per-user install location are searched', () => {
    const paths = ext.macAppPaths('Google Chrome', 'Google Chrome');
    assert.strictEqual(paths.length, 2);
    // System-wide first, ~/Applications second - the drag-and-drop install
    // location that is easy to forget.
    assert.ok(paths[0].endsWith(`${path.sep}Contents${path.sep}MacOS${path.sep}Google Chrome`), paths[0]);
    assert.ok(paths[1].includes(`${path.sep}Applications${path.sep}Google Chrome.app`), paths[1]);
    // The second entry must come from the home directory, not a hardcoded one.
    assert.ok(!/^[A-Z]:\\Program Files/i.test(paths[1]), paths[1]);
});

test('every supported browser has a macOS bundle path', () => {
    // The list of names must cover all seven, or one of them stays invisible.
    const expected = {
        chrome: ['Google Chrome', 'Google Chrome'],
        edge: ['Microsoft Edge', 'Microsoft Edge'],
        brave: ['Brave Browser', 'Brave Browser'],
        vivaldi: ['Vivaldi', 'Vivaldi'],
        chromium: ['Chromium', 'Chromium'],
        opera: ['Opera', 'Opera'],
        firefox: ['Firefox', 'firefox']
    };
    const src = readSource('utils/extensionInstaller.ts');
    for (const [id, [app, exe]] of Object.entries(expected)) {
        assert.ok(
            src.includes(`macAppPaths('${app}', '${exe}')`),
            `${id} has no macOS bundle path`
        );
    }
});

test('macOS profile roots live in Library/Application Support', () => {
    // No "User Data" segment on macOS - that dir holds Default/Profile N itself.
    const root = ext.macProfileRoot('Microsoft Edge');
    assert.ok(root.includes(path.join('Library', 'Application Support')), root);
    assert.ok(!root.includes('User Data'), root);
});

// ---- The two halves must agree ---------------------------------------------

test('profile roots exist for every Chromium browser that gets detected', () => {
    const src = readSource('utils/extensionInstaller.ts');
    const macBlock = src.slice(src.indexOf('const macRoots'), src.indexOf('const winRoots'));
    for (const id of ['chrome', 'edge', 'brave', 'vivaldi', 'chromium']) {
        assert.ok(macBlock.includes(`${id}:`), `${id} has no macOS profile root`);
    }
});

test('the macOS branch is selected by platform, not always used', () => {
    const src = readSource('utils/extensionInstaller.ts');
    assert.ok(
        /const isMac = process\.platform === 'darwin'/.test(src),
        'no darwin guard on the executable list'
    );
    assert.ok(
        src.includes("const exes: Record<BrowserId, string[]> = isMac ?"),
        'the executable list is not platform-conditional'
    );
});

// ---- Windows must not regress ----------------------------------------------

test('Windows detection still finds browsers on this machine', () => {
    const browsers = ext.getInstalledBrowsers();
    assert.ok(browsers.length > 0, 'no browsers detected at all on Windows');
    assert.strictEqual(browsers.filter(b => b.detected).length > 0, true);
});

test('the Windows paths are unchanged', () => {
    const src = readSource('utils/extensionInstaller.ts');
    assert.ok(src.includes("'Microsoft', 'Edge', 'Application', 'msedge.exe'"));
    assert.ok(src.includes("'Google', 'Chrome', 'Application', 'chrome.exe'"));
});

// ---- The UI wording --------------------------------------------------------

test('the onboarding no longer says "this PC"', () => {
    const src = readSource(path.join('..', 'src', 'components', 'Onboarding.tsx'));
    assert.ok(!/on this PC/.test(src), '"on this PC" is still hardcoded');
    assert.ok(!/stays on your PC/.test(src), '"stays on your PC" is still hardcoded');
});

test('the wording is chosen from the user agent', () => {
    const src = readSource(path.join('..', 'src', 'components', 'Onboarding.tsx'));
    assert.ok(/IS_MAC\s*=\s*\/Macintosh/.test(src), 'no macOS detection in the UI');
});

// ---- The native host already supported macOS; keep it that way -------------

test('native messaging hosts are registered per-platform, not Windows only', () => {
    const src = readSource('utils/nativeHost.ts');
    assert.ok(src.includes("case 'darwin'"), 'no darwin branch for native hosts');
    assert.ok(
        src.includes("Library', 'Application Support'"),
        'macOS native host path is not under Application Support'
    );
});

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);