import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import YtDlpWrap from 'yt-dlp-wrap';
import { getMainWindow } from './windowManager';
import { showNotification } from './notifications';
import {
    exeName, ytDlpDownloadUrl, ffmpegSources, archiveKind,
    whichSync, makeExecutable, isWindows, isMac
} from './platform';

let ytDlpBinaryPath: string;
let ffmpegBinaryPath: string;
let ffmpegDirPath: string;
let ytDlpWrap: YtDlpWrap;
let ffmpegAvailable = false;

// Resolved absolute locations. The app-managed copy inside userData is
// preferred, but a machine that already has FFmpeg on PATH is a perfectly good
// source and must be used as such - previously every direct ffmpeg/ffprobe call
// looked *only* in userData, so users whose managed copy was missing (failed
// download, cleaned AppData, or a profile/redirected %APPDATA% on another drive)
// hit "ffmpeg not found" even with FFmpeg installed.
let resolvedFfmpeg: string | null = null;
let resolvedFfprobe: string | null = null;

function findOnPath(exeName: string): string | null {
    return whichSync(exeName);
}

/** A copy only counts if it is big enough to be real and actually executes. */
function isUsableBinary(candidate: string | null): candidate is string {
    if (!candidate || !fs.existsSync(candidate)) return false;
    try {
        if (fs.statSync(candidate).size < 1024 * 1024) return false;
    } catch { return false; }
    return canRun(candidate);
}

function canRun(binary: string): boolean {
    try {
        const { execFileSync } = require('child_process');
        execFileSync(binary, ['-version'], { timeout: 20000, windowsHide: true, stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

/**
 * Single source of truth for where ffmpeg/ffprobe live. Managed copy first, then
 * PATH. Callers must use this instead of assuming the userData location, which
 * is what made the app drive- and machine-dependent.
 */
function resolveFfmpegTools(force: boolean = false) {
    if (!force && resolvedFfmpeg && isUsableBinary(resolvedFfmpeg)) {
        return { ffmpeg: resolvedFfmpeg, ffprobe: resolvedFfprobe };
    }

    const managedFfmpeg = path.join(ffmpegDirPath, exeName('ffmpeg'));
    const managedFfprobe = path.join(ffmpegDirPath, exeName('ffprobe'));

    resolvedFfmpeg = isUsableBinary(managedFfmpeg) ? managedFfmpeg : findOnPath('ffmpeg');

    // ffprobe ships in the same folder as whichever ffmpeg we picked.
    let siblingFfprobe: string | null = null;
    if (resolvedFfmpeg) {
        const candidate = path.join(path.dirname(resolvedFfmpeg), exeName('ffprobe'));
        if (fs.existsSync(candidate)) siblingFfprobe = candidate;
    }
    resolvedFfprobe = isUsableBinary(managedFfprobe)
        ? managedFfprobe
        : (siblingFfprobe || findOnPath('ffprobe'));

    ffmpegAvailable = !!resolvedFfmpeg;
    return { ffmpeg: resolvedFfmpeg, ffprobe: resolvedFfprobe };
}

export function initPaths() {
    const userDataPath = app.getPath('userData');
    // Stored under one stable local name (`yt-dlp` / `yt-dlp.exe`) regardless of
    // which release asset it came from (`yt-dlp_macos`, `yt-dlp_linux`, ...).
    ytDlpBinaryPath = path.join(userDataPath, exeName('yt-dlp'));
    ffmpegDirPath = path.join(userDataPath, 'ffmpeg');
    ffmpegBinaryPath = path.join(ffmpegDirPath, exeName('ffmpeg'));
    ytDlpWrap = new YtDlpWrap(ytDlpBinaryPath);
}

export function getYtDlpWrap() {
    return ytDlpWrap;
}

export function getYtDlpBinaryPath() {
    return ytDlpBinaryPath;
}

/** Absolute path to a working ffmpeg, or null. Never points at a missing file. */
export function getFfmpegBinaryPath(): string | null {
    return resolveFfmpegTools().ffmpeg;
}

/** Absolute path to a working ffprobe, or null. */
export function getFfprobePath(): string | null {
    return resolveFfmpegTools().ffprobe;
}

export function isFfmpegAvailable() {
    return !!resolveFfmpegTools().ffmpeg;
}

/**
 * yt-dlp is the part of this app that talks to YouTube, and YouTube breaks it
 * several times a year. When that happens an outdated binary produces exactly
 * the errors non-technical users report as "bot protection":
 *   "Sign in to confirm you're not a bot", "Requested format is not available",
 *   "HTTP Error 429: Too Many Requests", "unable to extract video data".
 *
 * So the binary must stay current on machines we do not control. The update has
 * to survive: no GitHub API (rate limited to 60 req/hour per IP, and every user
 * behind one office/college/carrier NAT shares that single bucket), no
 * Node/Python on the machine (it is a self-contained exe), and antivirus or a
 * corporate proxy blocking the GitHub API host.
 */
const YTDLP_LATEST_URL = ytDlpDownloadUrl();
const YTDLP_MIN_SIZE = 1024 * 1024;
// Don't re-download 17MB on every single launch.
const YTDLP_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

let ytdlpUpdateRunning = false;

function getUpdateStatePath() {
    return path.join(app.getPath('userData'), 'yt-dlp-update.json');
}

function readUpdateState(): { lastSuccess: number; consecutiveFailures: number } {
    try {
        const raw = JSON.parse(fs.readFileSync(getUpdateStatePath(), 'utf-8'));
        return {
            lastSuccess: Number(raw.lastSuccess) || 0,
            consecutiveFailures: Number(raw.consecutiveFailures) || 0
        };
    } catch {
        return { lastSuccess: 0, consecutiveFailures: 0 };
    }
}

function writeUpdateState(state: { lastSuccess: number; consecutiveFailures: number }) {
    try {
        fs.writeFileSync(getUpdateStatePath(), JSON.stringify(state));
    } catch { /* non-fatal: just means we check again next launch */ }
}

/**
 * The installed yt-dlp version, e.g. "2026.08.19".
 *
 * Exported because "same app version" does NOT mean "same yt-dlp": the binary
 * is downloaded and updated separately from the network, so two users on the
 * same release can be months apart. A stale yt-dlp is a leading cause of
 * YouTube extraction failures, and without this there is no way to tell that
 * apart from a bad link. Resolves null if the binary is missing or will not run.
 */
export function getYtDlpVersion(binary: string = ytDlpBinaryPath): Promise<string | null> {
    return new Promise((resolve) => {
        try {
            const { execFile } = require('child_process');
            execFile(binary, ['--version'], { timeout: 20000, windowsHide: true }, (err: any, stdout: string) => {
                if (err) { resolve(null); return; }
                const first = (stdout || '').trim().split(/\r?\n/)[0];
                resolve(first && first.length > 0 ? first : null);
            });
        } catch {
            resolve(null);
        }
    });
}

function downloadToFile(url: string, dest: string, redirectCount = 0): Promise<boolean> {
    return new Promise((resolve) => {
        if (redirectCount > 8) { resolve(false); return; }
        const https = require('https');
        const request = https.get(url, { headers: { 'User-Agent': 'VibeDownloader/1.0' }, timeout: 180000 }, (response: any) => {
            if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
                response.resume();
                downloadToFile(response.headers.location, dest, redirectCount + 1).then(resolve);
                return;
            }
            if (response.statusCode !== 200) {
                console.error('yt-dlp update HTTP error:', response.statusCode);
                response.resume();
                resolve(false);
                return;
            }
            const file = fs.createWriteStream(dest);
            response.pipe(file);
            file.on('finish', () => { file.close(); resolve(true); });
            file.on('error', () => {
                try { fs.unlinkSync(dest); } catch { /* ignore */ }
                resolve(false);
            });
        });
        request.on('error', (e: any) => { console.error('yt-dlp update network error:', e.message); resolve(false); });
        request.on('timeout', () => { request.destroy(); resolve(false); });
    });
}

/**
 * Swap the new binary in. On Windows a running/locked exe cannot be overwritten,
 * so the current one is moved aside first and restored if the swap fails. If the
 * file is locked we simply give up and retry on the next launch rather than
 * leaving the user without a working downloader.
 */
function swapYtDlpBinary(newBinary: string): boolean {
    const backup = ytDlpBinaryPath + '.old';
    try { if (fs.existsSync(backup)) fs.unlinkSync(backup); } catch { /* ignore */ }

    try {
        if (fs.existsSync(ytDlpBinaryPath)) fs.renameSync(ytDlpBinaryPath, backup);
    } catch (e) {
        console.error('Could not move the current yt-dlp binary aside:', e);
        return false;
    }

    try {
        fs.renameSync(newBinary, ytDlpBinaryPath);
    // A renamed file keeps its mode on unix, but a file written by Electron may
    // not have arrived executable, and an unexecutable yt-dlp fails with a
    // confusing "permission denied" on every download.
    makeExecutable(ytDlpBinaryPath);
    } catch (e) {
        console.error('Could not install the new yt-dlp binary:', e);
        try { if (fs.existsSync(backup)) fs.renameSync(backup, ytDlpBinaryPath); } catch { /* ignore */ }
        return false;
    }

    try { if (fs.existsSync(backup)) fs.unlinkSync(backup); } catch { /* ignore */ }
    try { fs.chmodSync(ytDlpBinaryPath, 0o755); } catch { /* ignore */ }
    return true;
}

/** First bytes of the file, or null. Used to tell a Windows PE from a unix binary. */
function readMagic(file: string): Buffer | null {
    try {
        const fd = fs.openSync(file, 'r');
        try {
            const buf = Buffer.alloc(4);
            const n = fs.readSync(fd, buf, 0, 4, 0);
            return n >= 2 ? buf.subarray(0, n) : null;
        } finally {
            fs.closeSync(fd);
        }
    } catch {
        return null;
    }
}

/**
 * Removes yt-dlp binaries that belong to another OS: a stray `yt-dlp.exe` on
 * macOS/Linux, or a Windows PE ("MZ") sitting under the unix name. Reports of
 * "spawn .../yt-dlp ENOENT" on macOS came from exactly this state.
 */
function removeForeignYtDlp() {
    try {
        const dir = path.dirname(ytDlpBinaryPath);
        if (!isWindows) {
            const stray = path.join(dir, 'yt-dlp.exe');
            if (fs.existsSync(stray)) {
                try { fs.unlinkSync(stray); } catch { /* ignore */ }
            }
            if (fs.existsSync(ytDlpBinaryPath)) {
                const magic = readMagic(ytDlpBinaryPath);
                // "MZ" = Windows executable. Mach-O/ELF never start with it.
                if (magic && magic[0] === 0x4d && magic[1] === 0x5a) {
                    console.warn('yt-dlp binary is a Windows executable, replacing it for this OS');
                    try { fs.unlinkSync(ytDlpBinaryPath); } catch { /* ignore */ }
                }
            }
        }
    } catch (e) {
        console.error('Foreign yt-dlp cleanup failed:', e);
    }
}

/**
 * Guarantees the binary exists right before it is used. Startup already does
 * this, but if that first download failed (offline launch, firewall) the file
 * is missing later and every spawn dies with ENOENT. Cheap when it is present.
 */
export async function ensureYtDlpReady(): Promise<void> {
    if (fs.existsSync(ytDlpBinaryPath)) {
        let sizeOk = false;
        try { sizeOk = fs.statSync(ytDlpBinaryPath).size >= YTDLP_MIN_SIZE; } catch { /* treat as missing */ }
        if (sizeOk) {
            if (isWindows) return;
            const magic = readMagic(ytDlpBinaryPath);
            const isForeignPE = !!(magic && magic[0] === 0x4d && magic[1] === 0x5a);
            if (!isForeignPE) {
                // Downloaded files can arrive without the execute bit; spawn
                // then fails and gets reported as a confusing ENOENT/EACCES.
                try { fs.accessSync(ytDlpBinaryPath, fs.constants.X_OK); }
                catch { makeExecutable(ytDlpBinaryPath); }
                return;
            }
        }
    }
    await ensureYtDlp();
}

/** Waits for a running update/download to finish, up to `maxMs`. */
async function waitForYtDlpUpdate(maxMs: number = 180000): Promise<void> {
    const start = Date.now();
    while (ytdlpUpdateRunning && Date.now() - start < maxMs) {
        await new Promise(r => setTimeout(r, 250));
    }
}

let ytdlpEnsureInFlight: Promise<void> | null = null;

/**
 * Guarantees a working yt-dlp before the app does anything else. Shares the
 * updater's verified download path on purpose: the old implementation used
 * yt-dlp-wrap's GitHub API download, which is rate limited per IP (so first-run
 * installs could fail) and then got immediately re-downloaded by the update
 * check anyway.
 */
export function ensureYtDlp(): Promise<void> {
    // Startup, the info fetch and the download handler can all land here at once
    // on a first run. Sharing one run means the later callers wait for the first
    // download instead of failing with "update already in progress" (which then
    // surfaced as `spawn .../yt-dlp ENOENT`).
    if (!ytdlpEnsureInFlight) {
        ytdlpEnsureInFlight = ensureYtDlpInner().finally(() => { ytdlpEnsureInFlight = null; });
    }
    return ytdlpEnsureInFlight;
}

async function ensureYtDlpInner(): Promise<void> {
    // A binary left behind by a different OS build (e.g. a Windows `yt-dlp.exe`
    // copied into a macOS/Linux profile, or a PE file stored under the unix
    // name) can never run here. Clear it so it gets re-fetched for this OS.
    removeForeignYtDlp();

    // The background updater may already be fetching the binary.
    if (ytdlpUpdateRunning) await waitForYtDlpUpdate();

    if (!fs.existsSync(ytDlpBinaryPath)) {
        console.log('No yt-dlp binary found, fetching the current release...');
        let r = await checkForYtDlpUpdate(true);
        if (!r.version && r.error === 'update already in progress') {
            await waitForYtDlpUpdate();
            r = { updated: false, version: await getYtDlpVersion(), error: null };
        }
        if (!r.version) {
            throw new Error(r.error || 'Could not obtain a working yt-dlp binary');
        }
        return;
    }

    // Present but unusable: truncated by a crash, quarantined by antivirus, or
    // blocked by policy. Repair it now instead of leaving the user stuck.
    const version = await getYtDlpVersion();
    if (!version) {
        console.warn('yt-dlp binary exists but will not run, repairing it now...');
        let r = await checkForYtDlpUpdate(true);
        if (!r.version && r.error === 'update already in progress') {
            await waitForYtDlpUpdate();
            r = { updated: false, version: await getYtDlpVersion(), error: null };
        }
        if (!r.version) {
            throw new Error(r.error || 'The existing yt-dlp binary is broken and could not be replaced');
        }
    }
}

/**
 * Keeps yt-dlp current. Safe to call on every launch: it self-throttles, verifies
 * whatever it downloads before trusting it, and never leaves a broken binary
 * behind. `force` bypasses the throttle (used when a fetch has already failed).
 */
export async function checkForYtDlpUpdate(force: boolean = false): Promise<{ updated: boolean; version: string | null; error: string | null }> {
    if (ytdlpUpdateRunning) {
        return { updated: false, version: null, error: 'update already in progress' };
    }
    ytdlpUpdateRunning = true;

    const fail = (message: string) => {
        const state = readUpdateState();
        const failures = state.consecutiveFailures + 1;
        writeUpdateState({ lastSuccess: state.lastSuccess, consecutiveFailures: failures });
        console.error('yt-dlp update failed:', message);
        // Tell the user once we have clearly been stuck, not on every launch.
        if (failures === 3) {
            try {
                showNotification(
                    'VibeDownloader needs attention',
                    'Could not update its YouTube downloader (yt-dlp) automatically. Some videos may fail to load. Restart the app to retry.'
                );
            } catch { /* a failed toast must never mask the real state */ }
        }
        return { updated: false, version: null, error: message };
    };

    try {
        // No ensureYtDlp() call here on purpose: the download below creates the
        // binary from nothing, so calling back into it would be mutual recursion
        // and would leave a fresh install with no binary at all.
        const currentVersion = await getYtDlpVersion();
        // A binary that will not run at all (quarantined by AV, truncated by a
        // crash, blocked by policy) must be replaced regardless of throttling.
        const isBroken = currentVersion === null;

        if (!force && !isBroken) {
            const state = readUpdateState();
            if (state.lastSuccess && Date.now() - state.lastSuccess < YTDLP_CHECK_INTERVAL_MS) {
                return { updated: false, version: currentVersion, error: null };
            }
        }

        const tmpPath = ytDlpBinaryPath + '.new';
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* ignore */ }

        console.log(`Checking yt-dlp for updates (${isBroken ? 'repairing broken binary' : 'direct release URL, no API rate limit'})...`);
        if (!await downloadToFile(YTDLP_LATEST_URL, tmpPath)) {
            return fail('download failed');
        }

        if (fs.statSync(tmpPath).size < YTDLP_MIN_SIZE) {
            try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
            return fail('downloaded file was too small to be yt-dlp');
        }

        // Never install something we cannot execute. A file written by
        // createWriteStream is mode 0666, so on macOS/Linux it must be marked
        // executable BEFORE the probe - otherwise the probe always fails and the
        // binary is never installed (the root cause of `spawn yt-dlp ENOENT`).
        makeExecutable(tmpPath);
        const newVersion = await getYtDlpVersion(tmpPath);
        if (!newVersion) {
            try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
            return fail('downloaded binary would not run (possibly blocked by antivirus)');
        }

        if (!isBroken && newVersion === currentVersion) {
            try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
            writeUpdateState({ lastSuccess: Date.now(), consecutiveFailures: 0 });
            return { updated: false, version: currentVersion, error: null };
        }

        if (!swapYtDlpBinary(tmpPath)) {
            return fail('could not replace the binary (file in use)');
        }

        const installed = await getYtDlpVersion();
        if (!installed) {
            return fail('new binary did not run after install');
        }

        writeUpdateState({ lastSuccess: Date.now(), consecutiveFailures: 0 });
        if (!isBroken) {
            console.log(`yt-dlp updated: ${currentVersion} -> ${installed}`);
            try {
                showNotification('VibeDownloader updated', `yt-dlp ${currentVersion} → ${installed}. YouTube fixes are active.`);
            } catch { /* ignore */ }
        } else {
            console.log(`yt-dlp repaired: installed ${installed}`);
        }
        return { updated: true, version: installed, error: null };
    } catch (e: any) {
        return fail(e && e.message ? e.message : String(e));
    } finally {
        ytdlpUpdateRunning = false;
    }
}

async function downloadFFmpeg(onlyProbe: boolean = false): Promise<boolean> {
    const ffmpegDir = ffmpegDirPath;
    const ffmpegExePath = path.join(ffmpegDir, exeName('ffmpeg'));
    const ffprobeExePath = path.join(ffmpegDir, exeName('ffprobe'));
    // `onlyProbe`: ffmpeg is already in place but ffprobe is not. Only macOS
    // ships them as two archives, so only there can the missing half be fetched alone.
    const sources = ffmpegSources().filter(s => !onlyProbe || /ffprobe/i.test(s.url));
    // The archive extension has to match the source, because the extractor is
    // chosen from it: Windows and macOS ship zips, Linux ships .tar.xz.
    const firstExt = sources.length && archiveKind(sources[0].url) === 'tar' ? '.tar.xz' : '.zip';
    const tempZipPath = path.join(app.getPath('userData'), `ffmpeg-temp${firstExt}`);

    console.log('Downloading FFmpeg...');
    const mainWindow = getMainWindow();

    const tryDownload = async (downloadUrl: string): Promise<boolean> => {
        return new Promise((resolve) => {
            const https = require('https');
            const file = fs.createWriteStream(tempZipPath);

            // This archive is ~200MB. Without the guards below, a connection that
            // dies part-way through (ISP reset, throttled asset, sleep/wake) left
            // 'finish' unfired forever: the promise never settled, the app sat on
            // "Downloading FFmpeg..." indefinitely, and every later step reported
            // FFmpeg as missing even though the user had "downloaded" it.
            let settled = false;
            let lastDataAt = Date.now();
            let watchdog: any = null;

            const done = (ok: boolean) => {
                if (settled) return;
                settled = true;
                if (watchdog) clearInterval(watchdog);
                resolve(ok);
            };
            const discardPartial = () => {
                try { file.destroy(); } catch { /* ignore */ }
                try { if (fs.existsSync(tempZipPath)) fs.unlinkSync(tempZipPath); } catch { /* ignore */ }
            };
            // Give up if the transfer stalls completely, so a dead socket is
            // retried against the next source instead of hanging.
            watchdog = setInterval(() => {
                if (Date.now() - lastDataAt > 60000) {
                    console.error('FFmpeg download stalled, giving up on this source');
                    discardPartial();
                    done(false);
                }
            }, 5000);

            const downloadWithRedirects = (url: string, redirectCount = 0) => {
                if (redirectCount > 8) { discardPartial(); done(false); return; }

                const request = https.get(url, { headers: { 'User-Agent': 'VibeDownloader/1.0' } }, (response: any) => {
                    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
                        response.resume();
                        downloadWithRedirects(response.headers.location, redirectCount + 1);
                        return;
                    }
                    if (response.statusCode !== 200) {
                        console.error('FFmpeg download HTTP error:', response.statusCode);
                        discardPartial();
                        done(false);
                        return;
                    }

                    const totalSize = parseInt(response.headers['content-length'] || '0', 10);
                    let downloadedSize = 0;
                    let lastPercent = -1;

                    response.on('data', (chunk: Buffer) => {
                        lastDataAt = Date.now();
                        downloadedSize += chunk.length;
                        if (totalSize > 0) {
                            const percent = Math.floor((downloadedSize / totalSize) * 100);
                            if (percent !== lastPercent) {
                                lastPercent = percent;
                                mainWindow?.webContents.send('download-progress', {
                                    percent,
                                    currentSpeed: 'Downloading FFmpeg...',
                                    downloaded: `${(downloadedSize / 1024 / 1024).toFixed(1)} MB / ${(totalSize / 1024 / 1024).toFixed(1)} MB`
                                });
                            }
                        }
                    });

                    // The connection died part-way through: settle instead of hanging.
                    response.on('aborted', () => {
                        console.error('FFmpeg download aborted by the server');
                        discardPartial();
                        done(false);
                    });
                    response.on('error', (err: any) => {
                        console.error('FFmpeg download stream error:', err && err.message);
                        discardPartial();
                        done(false);
                    });

                    response.pipe(file);

                    file.on('finish', () => {
                        file.close();
                        console.log('FFmpeg zip downloaded, extracting...');

                        try {
                            if (!fs.existsSync(ffmpegDir)) fs.mkdirSync(ffmpegDir, { recursive: true });
                            const ok = extractFfmpegBinaries(tempZipPath, ffmpegDir);
                            // The macOS ffprobe archive holds only ffprobe, so what
                            // counts as "found" depends on which archive this is.
                            const isProbeArchive = /ffprobe/i.test(downloadUrl);
                            const expectedPath = isProbeArchive ? ffprobeExePath : ffmpegExePath;
                            const expectedName = isProbeArchive ? exeName('ffprobe') : exeName('ffmpeg');

                            if (!ok || !fs.existsSync(expectedPath)) {
                                console.error(expectedName + ' not found in archive');
                                discardPartial();
                                done(false);
                                return;
                            }

                            // A binary that cannot run is worse than no file at all:
                            // every later merge fails with a confusing error. Verify
                            // before declaring success.
                            // Deliberately NOT deleting it on failure: a slow or cold
                            // machine can time out on the first -version call, and
                            // throwing away a perfectly good download because of that
                            // would be worse.
                            if (!canRun(expectedPath)) {
                                console.warn('Extracted ' + expectedName + ' did not respond to -version; it will not be used');
                                if (fs.existsSync(tempZipPath)) try { fs.unlinkSync(tempZipPath); } catch { /* ignore */ }
                                done(false);
                                return;
                            }

                            if (fs.existsSync(tempZipPath)) fs.unlinkSync(tempZipPath);

                            console.log(expectedName + ' extracted successfully to:', expectedPath);
                            if (!isProbeArchive) ffmpegAvailable = true;
                            resolveFfmpegTools(true);
                            done(true);
                        } catch (e) {
                            console.error('Failed to extract FFmpeg:', e);
                            discardPartial();
                            done(false);
                        }
                    });
                }).on('error', (err: any) => {
                    console.error('FFmpeg download error:', err);
                    discardPartial();
                    done(false);
                });
            };

            downloadWithRedirects(downloadUrl);
        });
    };

    // Most-reliable-first, per platform. macOS is special: evermeet publishes
    // ffmpeg and ffprobe as two separate archives, so both have to be fetched
    // before the pair is usable.
    let gotFfmpeg = false;
    for (const source of sources) {
        console.log(`Trying FFmpeg source: ${source.label}`);
        const ok = await tryDownload(source.url);
        if (ok) gotFfmpeg = true;

        if (!isMac) {
            if (gotFfmpeg) break;
            continue;
        }
        // On macOS keep going until both halves of the pair are present.
        if (gotFfmpeg && fs.existsSync(path.join(ffmpegDir, exeName('ffprobe')))) break;
    }
    return gotFfmpeg;
}

/**
 * Unpacks an FFmpeg archive of either kind and flattens ffmpeg/ffprobe/ffplay
 * into the managed folder.
 *
 * These builds all nest the binaries somewhere different - BtbN puts them in
 * `bin/`, evermeet and gyan put them at the root, johnvansickle uses a versioned
 * top-level directory - so the binaries are located by name anywhere in the tree
 * rather than by assuming a layout. `tar` comes from the OS (present on macOS
 * and effectively all Linux distributions) because shipping an xz decompressor
 * for a 150MB archive would be a poor trade.
 */
function extractFfmpegBinaries(archivePath: string, ffmpegDir: string): boolean {
    const kind = archiveKind(archivePath);
    if (!kind) {
        console.error('Unsupported FFmpeg archive:', path.basename(archivePath));
        return false;
    }

    const staging = path.join(ffmpegDir, '.staging');
    try {
        fs.rmSync(staging, { recursive: true, force: true });
        fs.mkdirSync(staging, { recursive: true });

        if (kind === 'zip') {
            const AdmZip = require('adm-zip');
            new AdmZip(archivePath).extractAllTo(staging, true);
        } else {
            const { execFileSync } = require('child_process');
            execFileSync('tar', ['-xf', archivePath, '-C', staging], {
                stdio: 'ignore',
                timeout: 600000
            });
        }

        const wanted = new Map<string, string>();
        const walk = (dir: string) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    walk(full);
                    continue;
                }
                const key = entry.name.toLowerCase().replace(/\.(exe)?$/, '');
                if ((key === 'ffmpeg' || key === 'ffprobe' || key === 'ffplay') && !wanted.has(key)) {
                    wanted.set(key, full);
                }
            }
        };
        walk(staging);

        for (const [key, source] of wanted) {
            const dest = path.join(ffmpegDir, exeName(key));
            try { fs.copyFileSync(source, dest); } catch (e) { continue; }
            makeExecutable(dest);
        }

        return wanted.size > 0;
    } catch (e) {
        console.error('FFmpeg extraction failed:', e);
        return false;
    } finally {
        try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* best effort */ }
    }
}

function getFfmpegStatePath() {
    return path.join(app.getPath('userData'), 'ffmpeg-setup.json');
}

function readFfmpegState(): { lastAttempt: number; consecutiveFailures: number } {
    try {
        const raw = JSON.parse(fs.readFileSync(getFfmpegStatePath(), 'utf-8'));
        return {
            lastAttempt: Number(raw.lastAttempt) || 0,
            consecutiveFailures: Number(raw.consecutiveFailures) || 0
        };
    } catch {
        return { lastAttempt: 0, consecutiveFailures: 0 };
    }
}

function writeFfmpegState(state: { lastAttempt: number; consecutiveFailures: number }) {
    try {
        fs.writeFileSync(getFfmpegStatePath(), JSON.stringify(state));
    } catch { /* non-fatal */ }
}

// FFmpeg is ~190MB. Without this, a machine that cannot reach any of the
// mirrors would re-download it on every single launch.
const FFMPEG_RETRY_INTERVAL_MS = 12 * 60 * 60 * 1000;
const FFMPEG_MAX_BACKGROUND_FAILURES = 3;

// Only one ffprobe top-up per app session: if the mirror is down we must not
// hold every download hostage to a retry loop.
let ffprobeTopUpPromise: Promise<void> | null = null;
let ffprobeTopUpTried = false;

/**
 * macOS ships ffmpeg and ffprobe as two separate archives, so a machine can end
 * up with a working ffmpeg and no ffprobe (first archive fetched, second failed
 * or interrupted). Everything that needs ffprobe then silently degrades
 * ("ffprobe unavailable, skipping compatibility re-encode"). Fetch just the
 * missing half.
 */
async function topUpFfprobe(): Promise<void> {
    if (!isMac || ffprobeTopUpTried) return;
    if (ffprobeTopUpPromise) return ffprobeTopUpPromise;
    ffprobeTopUpTried = true;
    ffprobeTopUpPromise = (async () => {
        console.log('ffprobe missing next to a working ffmpeg, fetching it...');
        try {
            if (await downloadFFmpeg(true)) {
                resolveFfmpegTools(true);
                console.log('ffprobe ready:', resolvedFfprobe);
            } else {
                console.warn('Could not fetch ffprobe; continuing without it.');
            }
        } catch (e) {
            console.warn('ffprobe top-up failed:', e);
        } finally {
            ffprobeTopUpPromise = null;
        }
    })();
    return ffprobeTopUpPromise;
}

export async function ensureFFmpeg(force: boolean = true): Promise<boolean> {
    const { ffmpeg, ffprobe } = resolveFfmpegTools();
    if (ffmpeg) {
        ffmpegAvailable = true;
        if (!ffprobe) await topUpFfprobe();
        return true;
    }

    const state = readFfmpegState();
    if (!force) {
        // Background startup attempt: back off, and stop entirely if every
        // source has failed repeatedly on this machine.
        if (state.lastAttempt && Date.now() - state.lastAttempt < FFMPEG_RETRY_INTERVAL_MS) {
            return false;
        }
        if (state.consecutiveFailures >= FFMPEG_MAX_BACKGROUND_FAILURES) {
            console.log('Not retrying FFmpeg automatically: every download source has failed repeatedly.');
            return false;
        }
    }

    console.log('FFmpeg not found, downloading...');
    writeFfmpegState({ lastAttempt: Date.now(), consecutiveFailures: state.consecutiveFailures });
    const mainWindow = getMainWindow();
    mainWindow?.webContents.send('download-progress', {
        status: 'Downloading FFmpeg for high-quality processing... (one-time setup)'
    });

    const success = await downloadFFmpeg();
    if (success) {
        writeFfmpegState({ lastAttempt: Date.now(), consecutiveFailures: 0 });
        try {
            showNotification('FFmpeg Ready', 'High-quality videos and audio files are now fully supported!');
        } catch { /* ignore */ }
        return true;
    }

    const failures = state.consecutiveFailures + 1;
    writeFfmpegState({ lastAttempt: Date.now(), consecutiveFailures: failures });
    console.error('FFmpeg download failed on every source.');
    if (failures === FFMPEG_MAX_BACKGROUND_FAILURES) {
        try {
            showNotification(
                'VibeDownloader needs attention',
                'FFmpeg could not be downloaded, so some video processing will not work. Check your internet connection or firewall, then restart the app.'
            );
        } catch { /* ignore */ }
    }
    return false;
}

export function checkFFmpegOnStartup() {
    const { ffmpeg, ffprobe } = resolveFfmpegTools();
    if (ffmpeg) {
        ffmpegAvailable = true;
        console.log('FFmpeg ready:', ffmpeg);
        if (!ffprobe) topUpFfprobe().catch((e) => console.error('Background ffprobe setup failed:', e));
        return;
    }

    console.log('FFmpeg not found on startup, fetching it in the background...');
    // Fetch it now rather than making the user wait for (or fail) a download.
    // Fire and forget: startup must not block on a ~190MB download, and
    // ensureFFmpeg(false) handles the backoff.
    ensureFFmpeg(false).catch((e) => console.error('Background FFmpeg setup failed:', e));
}
