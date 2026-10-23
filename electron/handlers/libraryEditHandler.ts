import { ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { getMainWindow } from '../utils/windowManager';
import { getFfmpegBinaryPath } from '../utils/binaries';
import { getLibraryItem, addFileToLibrary, LibraryItem } from './libraryHandler';

/**
 * Quick edits for files in the Library: pull the audio out of a video, convert or
 * shrink it, or cut a short GIF.
 *
 * Every edit writes a NEW file next to the original and never touches the source.
 * Output is written to `<name>.temp.<ext>` first (the library scanner skips those)
 * and renamed into place only when ffmpeg finishes cleanly, so a cancelled or
 * failed job leaves nothing half-written behind.
 */

export type EditRequest =
    | { type: 'audio'; format: 'mp3' | 'm4a'; quality: 'best' | 'standard' }
    | { type: 'convert'; format: 'mp4' | 'webm' | 'mkv'; height: number; quality: 'high' | 'balanced' | 'small' }
    | { type: 'gif'; start: number; length: number; width: number; fps: number };

export interface EditResult {
    success: boolean;
    item?: LibraryItem;
    inBytes?: number;
    outBytes?: number;
    error?: string;
    cancelled?: boolean;
}

interface Plan {
    ext: string;
    suffix: string;
    pre: string[];
    post: string[];
    /** Seconds of output expected, for the progress bar. 0 when unknown. */
    total: number;
}

// Values come from the renderer, so each one is checked against an allow-list or
// clamped; nothing from the request is ever placed into the command unchecked.
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    (allowed as readonly string[]).includes(v as string) ? (v as T) : fallback;

const clamp = (v: unknown, min: number, max: number, fallback: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const fixed = (n: number) => n.toFixed(2);

function buildPlan(item: LibraryItem, req: EditRequest): Plan | { error: string } {
    const dur = item.duration && item.duration > 0 ? item.duration : 0;

    if (req.type === 'audio') {
        const format = pick(req.format, ['mp3', 'm4a'] as const, 'mp3');
        const best = pick(req.quality, ['best', 'standard'] as const, 'best') === 'best';
        const post = ['-vn', '-map', '0:a:0', '-map_metadata', '0'];
        if (format === 'mp3') {
            post.push('-c:a', 'libmp3lame', '-b:a', best ? '320k' : '192k', '-id3v2_version', '3');
        } else {
            post.push('-c:a', 'aac', '-b:a', best ? '256k' : '128k');
        }
        return { ext: format, suffix: '', pre: [], post, total: dur };
    }

    if (req.type === 'convert') {
        const format = pick(req.format, ['mp4', 'webm', 'mkv'] as const, 'mp4');
        const quality = pick(req.quality, ['high', 'balanced', 'small'] as const, 'balanced');
        const height = [0, 1080, 720, 480, 360].includes(Number(req.height)) ? Number(req.height) : 0;

        // Even dimensions are required by yuv420p; -2 keeps the aspect ratio.
        const vf = height
            ? `scale=-2:'min(${height},ih)'`
            : 'scale=trunc(iw/2)*2:trunc(ih/2)*2';

        const post = ['-map', '0:v:0', '-map', '0:a:0?', '-sn', '-vf', vf];
        if (format === 'webm') {
            const crf = { high: 29, balanced: 33, small: 38 }[quality];
            post.push('-c:v', 'libvpx-vp9', '-crf', String(crf), '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4',
                '-c:a', 'libopus', '-b:a', '128k');
        } else {
            const crf = { high: 20, balanced: 24, small: 29 }[quality];
            post.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', '-b:a', '160k');
            if (format === 'mp4') post.push('-movflags', '+faststart');
        }
        const tag = height ? `${height}p` : (format === item.ext ? 'converted' : format.toUpperCase());
        return { ext: format, suffix: ` (${tag})`, pre: [], post, total: dur };
    }

    if (req.type === 'gif') {
        const width = [320, 480, 640].includes(Number(req.width)) ? Number(req.width) : 480;
        const fps = [10, 15, 20].includes(Number(req.fps)) ? Number(req.fps) : 15;
        const maxLen = dur > 0 ? Math.min(15, dur) : 15;
        const length = clamp(req.length, 0.5, maxLen, Math.min(5, maxLen));
        const start = clamp(req.start, 0, Math.max(0, (dur || 3600) - length), 0);
        const vf =
            `fps=${fps},scale='min(${width},iw)':-1:flags=lanczos,` +
            `split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5`;
        return {
            ext: 'gif',
            suffix: ' (GIF)',
            pre: ['-ss', fixed(start), '-t', fixed(length)],
            post: ['-an', '-vf', vf, '-loop', '0'],
            total: length,
        };
    }

    return { error: 'Unknown edit.' };
}

/** `<dir>/<base><suffix>.<ext>`, with " 2", " 3"… added until it is free. */
function uniqueOutput(dir: string, base: string, suffix: string, ext: string, source: string): string {
    const norm = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
    let n = 1;
    for (;;) {
        const name = `${base}${suffix}${n > 1 ? ` ${n}` : ''}.${ext}`;
        const full = path.join(dir, name);
        if (!fs.existsSync(full) && norm(full) !== norm(source)) return full;
        n++;
    }
}

function friendlyError(tail: string): string {
    if (/does not contain any stream|matches no streams|Stream map/i.test(tail)) return 'This video has no audio track to extract.';
    if (/Unknown encoder|Encoder .* not found/i.test(tail)) return 'This copy of FFmpeg cannot make that format. Try MP4 instead.';
    if (/No space left/i.test(tail)) return 'Your disk is full.';
    if (/Permission denied|Access is denied/i.test(tail)) return 'The folder is read-only or the file is in use.';
    return 'FFmpeg could not finish this edit.';
}

interface ActiveJob {
    jobId: string;
    child: ChildProcess;
    temp: string;
    cancelled: boolean;
}

let active: ActiveJob | null = null;

function sendProgress(jobId: string, pct: number) {
    try { getMainWindow()?.webContents.send('library-edit-progress', { jobId, pct }); } catch { /* window gone */ }
}

function removeQuietly(p: string) {
    try { fs.rmSync(p, { force: true }); } catch { /* ignore */ }
}

async function runEdit(jobId: string, itemId: string, req: EditRequest): Promise<EditResult> {
    if (active) return { success: false, error: 'Another edit is already running.' };

    const item = getLibraryItem(itemId);
    if (!item || !fs.existsSync(item.path)) return { success: false, error: 'That file was moved or deleted.' };
    if (item.kind !== 'video') return { success: false, error: 'Only videos can be edited here.' };

    const ffmpeg = getFfmpegBinaryPath();
    if (!ffmpeg) return { success: false, error: 'FFmpeg is not ready yet. It downloads in the background, so try again in a minute.' };

    const plan = buildPlan(item, req);
    if ('error' in plan) return { success: false, error: plan.error };

    const dir = path.dirname(item.path);
    const base = path.basename(item.path, path.extname(item.path));
    const finalPath = uniqueOutput(dir, base, plan.suffix, plan.ext, item.path);
    const tempPath = finalPath.replace(new RegExp(`\\.${plan.ext}$`), `.temp.${plan.ext}`);

    const args = [
        '-hide_banner', '-v', 'error', '-y', '-nostdin', '-progress', 'pipe:1', '-nostats',
        ...plan.pre, '-i', item.path, ...plan.post, tempPath,
    ];

    return new Promise<EditResult>((resolve) => {
        let stderr = '';
        let lastSent = 0;
        let buf = '';
        const child = spawn(ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        const job: ActiveJob = { jobId, child, temp: tempPath, cancelled: false };
        active = job;
        sendProgress(jobId, plan.total > 0 ? 0 : -1);

        child.stdout!.on('data', (d: Buffer) => {
            buf += d.toString();
            const lines = buf.split(/\r?\n/);
            buf = lines.pop() || '';
            for (const line of lines) {
                const m = /^out_time_us=(\d+)/.exec(line);
                if (!m || plan.total <= 0) continue;
                const now = Date.now();
                if (now - lastSent < 100) continue;
                lastSent = now;
                // Held below 100 so the bar only completes once the file is in place.
                sendProgress(jobId, Math.min(99, (Number(m[1]) / 1e6 / plan.total) * 100));
            }
        });
        child.stderr!.on('data', (d: Buffer) => { stderr = (stderr + d.toString()).slice(-2000); });

        const finish = async (code: number | null) => {
            active = null;
            if (job.cancelled) {
                removeQuietly(tempPath);
                return resolve({ success: false, cancelled: true });
            }
            if (code !== 0 || !fs.existsSync(tempPath) || fs.statSync(tempPath).size === 0) {
                removeQuietly(tempPath);
                console.error('Library edit failed:', code, stderr.trim());
                return resolve({ success: false, error: friendlyError(stderr) });
            }
            try {
                fs.renameSync(tempPath, finalPath);
            } catch (e: any) {
                removeQuietly(tempPath);
                return resolve({ success: false, error: e && e.message ? e.message : 'Could not save the file.' });
            }
            sendProgress(jobId, 100);
            const added = await addFileToLibrary(finalPath);
            resolve({
                success: true,
                item: added || undefined,
                inBytes: item.size,
                outBytes: fs.statSync(finalPath).size,
            });
        };

        child.on('error', (e) => {
            active = null;
            removeQuietly(tempPath);
            resolve({ success: false, error: e && e.message ? e.message : 'Could not start FFmpeg.' });
        });
        child.on('close', (code) => { void finish(code); });
    });
}

export function cancelAllEdits() {
    if (!active) return;
    active.cancelled = true;
    try { active.child.kill('SIGKILL'); } catch { /* already gone */ }
}

export function registerLibraryEditHandlers() {
    ipcMain.handle('library-edit', async (_e: any, jobId: string, itemId: string, req: EditRequest) => {
        try {
            return await runEdit(String(jobId), String(itemId), req);
        } catch (e: any) {
            console.error('Library edit crashed:', e);
            active = null;
            return { success: false, error: e && e.message ? e.message : 'The edit failed.' } as EditResult;
        }
    });

    ipcMain.handle('library-edit-cancel', async (_e: any, jobId: string) => {
        if (active && active.jobId === jobId) {
            cancelAllEdits();
            return { success: true };
        }
        return { success: false };
    });
}
