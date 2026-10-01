/**
 * Copies `electron/vendor` into `dist-electron/vendor`.
 *
 * Why this exists instead of shipping the folder from its source location:
 *
 * - The root package.json is `"type": "module"`, so a `.js` file under
 *   `electron/vendor` would be loaded as ESM. The vendored downloader is
 *   CommonJS, so `require()` of it would throw ERR_REQUIRE_ESM.
 * - `build:electron` already writes `dist-electron/package.json` with
 *   `{"type":"commonjs"}`. Dropping the vendor tree inside `dist-electron`
 *   therefore makes the CommonJS loader apply to it, in both dev and the
 *   packaged app, with no rename and no loader shim.
 *
 * `dist-electron/**\/*` is already in the electron-builder `files` globs, so
 * the copy is what gets into the asar. `tsc` does not copy `.js` inputs, so
 * without this step the module is simply absent at runtime.
 */
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const src = path.join(repo, 'electron', 'vendor');
const dest = path.join(repo, 'dist-electron', 'vendor');

if (!fs.existsSync(src)) {
    console.error(`copy-vendor: source missing at ${src}`);
    process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });

const copied = [];
(function walk(dir, base) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, base);
        else copied.push(path.relative(base, full).replace(/\\/g, '/'));
    }
})(dest, dest);

console.log(`copy-vendor: ${copied.length} file(s) -> dist-electron/vendor`);
for (const f of copied) console.log(`  ${f}`);