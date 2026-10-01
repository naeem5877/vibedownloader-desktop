import { execFileSync } from 'child_process';
import fs from 'fs';

/**
 * Every place the app needs to know "which OS am I on, and what is a binary
 * called here" lives in this file. The download core used to hardcode `.exe`
 * names, `where.exe` and `win64` archives, which made it impossible to run
 * anywhere except Windows.
 */
export const isWindows = process.platform === 'win32';
export const isMac = process.platform === 'darwin';
export const isLinux = process.platform === 'linux';

export function isWindowsArchArm(): boolean {
    return process.arch === 'arm64';
}

/** `ffmpeg` on macOS/Linux, `ffmpeg.exe` on Windows. */
export function exeName(base: string): string {
    return isWindows ? `${base}.exe` : base;
}

/**
 * Asset name for the current platform from the yt-dlp release. These are the
 * real published names; `yt-dlp_macos` is a universal PyInstaller build that
 * runs on both Intel and Apple Silicon.
 */
export function ytDlpAssetName(): string {
    if (isWindows) {
        if (process.arch === 'arm64') return 'yt-dlp_arm64.exe';
        if (process.arch === 'ia32') return 'yt-dlp_x86.exe';
        return 'yt-dlp.exe';
    }
    if (isMac) return 'yt-dlp_macos';
    if (isLinux) {
        if (process.arch === 'arm64') return 'yt-dlp_linux_aarch64';
        return 'yt-dlp_linux';
    }
    return 'yt-dlp';
}

export function ytDlpDownloadUrl(): string {
    return `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ytDlpAssetName()}`;
}

/**
 * FFmpeg download sources, most reliable first.
 *
 * Windows keeps the established order: BtbN first, then gyan.dev, then the
 * user's own custom GitHub build.
 *
 * macOS and Linux are different problems. BtbN publishes no macOS build at all
 * (its release only covers Windows and Linux), so macOS comes from evermeet.cx,
 * which serves a fresh per-run "latest release" zip. Linux comes from BtbN's
 * `.tar.xz` build, with johnvansickle.com's smaller static build as a backup.
 */
export function ffmpegSources(): { label: string; url: string }[] {
    if (isWindows) {
        return [
            { label: 'BtbN', url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip' },
            { label: 'gyan.dev', url: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' },
            { label: 'custom GitHub build', url: 'https://github.com/naeem589020/ffmpeg/releases/download/ffmpeg/ffmpeg.zip' }
        ];
    }
    if (isMac) {
        return [
            { label: 'evermeet.cx', url: 'https://evermeet.cx/ffmpeg/getrelease/zip' },
            { label: 'evermeet.cx (ffprobe)', url: 'https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip' }
        ];
    }
    if (isLinux) {
        const arch = isWindowsArchArm() ? 'linuxarm64' : 'linux64';
        return [
            { label: 'BtbN', url: `https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-${arch}-gpl.tar.xz` },
            { label: 'johnvansickle.com', url: isWindowsArchArm() ? 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz' : 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz' }
        ];
    }
    return [];
}

/** Archive type of a downloaded file, used to pick an extractor. */
export function archiveKind(file: string): 'zip' | 'tar' | null {
    const lower = file.toLowerCase();
    if (lower.endsWith('.zip')) return 'zip';
    if (lower.endsWith('.tar.xz') || lower.endsWith('.tar.gz') || lower.endsWith('.tgz') || lower.endsWith('.tar')) return 'tar';
    return null;
}

/** A User-Agent that matches the host OS, used for direct HTTP fetches. */
export function defaultUserAgent(): string {
    if (isMac) {
        return 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
    }
    if (isLinux) {
        return 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
    }
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
}

/** Cross-platform PATH lookup: `where.exe` on Windows, `which` elsewhere. */
export function whichSync(command: string): string | null {
    try {
        const probe = isWindows ? 'where.exe' : 'which';
        const out = execFileSync(probe, [command], {
            encoding: 'utf-8',
            timeout: 10000,
            windowsHide: true
        });
        const first = (out || '').split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean)[0];
        if (first && fs.existsSync(first)) return first;
    } catch { /* not on PATH */ }
    return null;
}

/** Mark a freshly downloaded binary executable. A no-op on Windows. */
export function makeExecutable(file: string) {
    if (isWindows) return;
    try {
        fs.chmodSync(file, 0o755);
    } catch (e) {
        console.error('Failed to mark binary executable:', e);
    }
}

/**
 * A JavaScript runtime for yt-dlp.
 *
 * `flag` is the value for `--js-runtimes`. yt-dlp accepts `RUNTIME` or
 * `RUNTIME:PATH`; the explicit form is preferred because it never depends on the
 * child process inheriting our PATH.
 *
 * `env` is extra environment the yt-dlp process needs in order to *launch* that
 * runtime. The bundled case needs `ELECTRON_RUN_AS_NODE`, which is what turns
 * the Electron binary into a plain Node process.
 */
export interface JsRuntime {
    /** Human-readable origin, for logs and diagnostics. */
    source: 'bundled-node' | 'system-deno' | 'system-node';
    /** Value for `--js-runtimes`. */
    flag: string;
    /** Extra environment for the spawned yt-dlp process. */
    env: NodeJS.ProcessEnv;
}

/**
 * Electron bundles Node. Setting `ELECTRON_RUN_AS_NODE` makes the app's own
 * binary behave as a plain Node runtime, which means the app can always supply
 * yt-dlp with one without asking the user to install anything.
 *
 * This is the path in development, where `process.execPath` is electron.exe out
 * of node_modules, and in a packaged build, where it is the installed app exe.
 * Both honour ELECTRON_RUN_AS_NODE, because the Electron default keeps the
 * RunAsNode fuse enabled - we do not configure electronFuses.
 *
 * Returning a path rather than the name matters: the name alone would be
 * resolved from PATH, and a normal user's machine has no `node` on PATH, which
 * is precisely why this function used to return null for most installs.
 */
function bundledNodeRuntime(): JsRuntime | null {
    try {
        const exe = process.execPath;
        // In development Electron lives out of node_modules/electron/dist; we
        // still want the real binary, and process.execPath already is it.
        if (!exe || !fs.existsSync(exe)) return null;
        return {
            source: 'bundled-node',
            flag: `node:${exe}`,
            env: {
                ELECTRON_RUN_AS_NODE: '1',
                // Keeps the child from trying to attach to our devtools port.
                ELECTRON_NO_ATTACH_CONSOLE: '1'
            }
        };
    } catch {
        return null;
    }
}

let cachedJsRuntime: JsRuntime | null | undefined;

/**
 * A JavaScript runtime for yt-dlp, preferring the one already inside this app.
 *
 * yt-dlp needs a JS runtime to solve YouTube's n-sig/PO-token challenges. It
 * warns loudly when it has none: "No supported JavaScript runtime could be
 * found... YouTube extraction without a JS runtime has been deprecated, and
 * some formats may be missing." That deprecation is the quiet failure mode -
 * not an error, just missing formats and formats that vanish over time.
 *
 * The old version of this function searched PATH for deno/node, so a developer
 * machine with Node installed worked while a normal install had no runtime at
 * all. That is a real cause of "works on my PC".
 */
export function detectJsRuntime(): JsRuntime | null {
    if (cachedJsRuntime !== undefined) return cachedJsRuntime;
    cachedJsRuntime = bundledNodeRuntime();
    if (!cachedJsRuntime) {
        const deno = whichSync('deno');
        const node = whichSync('node');
        if (deno) cachedJsRuntime = { source: 'system-deno', flag: `deno:${deno}`, env: {} };
        else if (node) cachedJsRuntime = { source: 'system-node', flag: `node:${node}`, env: {} };
        else cachedJsRuntime = null;
    }
    if (cachedJsRuntime) {
        console.log(`JS runtime for yt-dlp: ${cachedJsRuntime.source} (${cachedJsRuntime.flag})`);
    } else {
        console.warn('No JavaScript runtime available for yt-dlp; YouTube extraction may be degraded');
    }
    return cachedJsRuntime;
}

/** Test seam: lets tests exercise detection without the real Electron process. */
export function __resetJsRuntimeCache() {
    cachedJsRuntime = undefined;
}

/**
 * Environment for spawning yt-dlp with the given runtime. Spread over
 * `process.env` so the child keeps PATH and everything else it normally needs.
 */
export function jsRuntimeSpawnEnv(runtime: JsRuntime | null): NodeJS.ProcessEnv | undefined {
    return runtime ? { ...process.env, ...runtime.env } : undefined;
}
