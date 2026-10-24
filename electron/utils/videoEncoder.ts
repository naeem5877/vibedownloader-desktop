import os from 'os';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Picking an H.264 encoder that suits the machine.
 *
 * Re-encoding a video to H.264 rewrites every frame, so on a long video it is the
 * slowest thing this app does. Two things decide how slow:
 *
 *  - Hardware: a GPU encoder (NVIDIA NVENC, Intel Quick Sync, AMD AMF, Apple
 *    VideoToolbox) is several times faster than the CPU and leaves the CPU free.
 *    A listed encoder is not proof it works (no GPU, old driver), so each one is
 *    test-encoded once with the exact arguments used for real, and the answer is
 *    remembered for the session.
 *  - CPU: x264's presets trade file size for speed. A 4-core laptop and a 16-core
 *    desktop should not use the same one, so the preset follows the core count and
 *    memory of the machine it runs on.
 */

export type PerfTier = 'low' | 'mid' | 'high';
export type EncoderId = 'h264_nvenc' | 'h264_qsv' | 'h264_amf' | 'h264_videotoolbox' | 'libx264';

export interface VideoEncoder {
    id: EncoderId;
    hardware: boolean;
    /** What the loader shows, e.g. "GPU · NVIDIA NVENC". */
    label: string;
}

export interface EncodeProgress {
    /** 0-100 of the file being encoded. */
    percent: number;
    /** Encoding speed as a multiple of real time (2 = twice as fast as playback). */
    speed?: number;
    etaSec?: number;
    encoder?: string;
    hardware?: boolean;
}

export function getPerfTier(): PerfTier {
    const cores = os.cpus().length;
    const gb = os.totalmem() / 1024 ** 3;
    if (cores <= 4 || gb < 6) return 'low';
    if (cores <= 8 || gb < 12) return 'mid';
    return 'high';
}

// A slower preset makes a smaller file at the same quality, which is not worth
// minutes of a weak CPU's time for a compatibility copy.
const X264_BY_TIER: Record<PerfTier, { preset: string; crf: string }> = {
    low: { preset: 'ultrafast', crf: '24' },
    mid: { preset: 'superfast', crf: '22' },
    high: { preset: 'veryfast', crf: '21' },
};

const HARDWARE: Record<Exclude<EncoderId, 'libx264'>, string> = {
    h264_nvenc: 'GPU · NVIDIA NVENC',
    h264_qsv: 'GPU · Intel Quick Sync',
    h264_amf: 'GPU · AMD AMF',
    h264_videotoolbox: 'GPU · Apple VideoToolbox',
};

export function softwareVideoEncoder(): VideoEncoder {
    return { id: 'libx264', hardware: false, label: 'CPU · x264, tuned for this PC' };
}

function hardwareVideoEncoder(id: Exclude<EncoderId, 'libx264'>): VideoEncoder {
    return { id, hardware: true, label: HARDWARE[id] };
}

// VideoToolbox is bitrate-driven, so the bitrate follows the picture size.
function bitrateFor(height: number): string {
    if (height >= 2160) return '20M';
    if (height >= 1440) return '14M';
    if (height >= 1080) return '8M';
    return '5M';
}

/**
 * The video half of an ffmpeg command for `enc`: 8-bit 4:2:0 H.264 tagged `avc1`,
 * which is what QuickTime, editors and phones accept.
 */
export function videoEncodeArgs(enc: VideoEncoder, opts: { height: number; oddSize: boolean }): string[] {
    // 4:2:0 needs even dimensions. The scale filter touches every frame, so it is
    // only added when the picture really has an odd side.
    const even = opts.oddSize ? ['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2'] : [];
    switch (enc.id) {
        case 'h264_nvenc':
            return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '24', '-b:v', '0',
                '-profile:v', 'high', '-pix_fmt', 'yuv420p', ...even, '-tag:v', 'avc1'];
        case 'h264_qsv':
            return ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', '24',
                '-profile:v', 'high', ...even, '-tag:v', 'avc1'];
        case 'h264_amf':
            return ['-c:v', 'h264_amf', '-quality', 'speed', '-rc', 'cqp', '-qp_i', '24', '-qp_p', '26',
                '-profile:v', 'high', ...even, '-tag:v', 'avc1'];
        case 'h264_videotoolbox':
            return ['-c:v', 'h264_videotoolbox', '-b:v', bitrateFor(opts.height), '-pix_fmt', 'yuv420p',
                ...even, '-tag:v', 'avc1'];
        default: {
            const { preset, crf } = X264_BY_TIER[getPerfTier()];
            return ['-c:v', 'libx264', '-preset', preset, '-crf', crf, '-profile:v', 'high',
                '-pix_fmt', 'yuv420p', ...even, '-tag:v', 'avc1'];
        }
    }
}

// One answer per ffmpeg binary, for the life of the app.
const detected = new Map<string, Promise<VideoEncoder>>();

/** The fastest encoder this machine can really run, or x264 when there is none. */
export function pickVideoEncoder(ffmpeg: string): Promise<VideoEncoder> {
    let result = detected.get(ffmpeg);
    if (!result) {
        result = detect(ffmpeg).catch(() => softwareVideoEncoder());
        detected.set(ffmpeg, result);
    }
    return result;
}

async function detect(ffmpeg: string): Promise<VideoEncoder> {
    let listed = '';
    try {
        listed = (await execFileAsync(ffmpeg, ['-hide_banner', '-encoders'], { timeout: 10_000 })).stdout;
    } catch {
        return softwareVideoEncoder();
    }

    const candidates: Exclude<EncoderId, 'libx264'>[] =
        process.platform === 'darwin' ? ['h264_videotoolbox']
        : process.platform === 'win32' ? ['h264_nvenc', 'h264_qsv', 'h264_amf']
        : ['h264_nvenc', 'h264_qsv'];

    // A GPU encoder is not automatically the faster one: a many-core CPU can beat a
    // weak or integrated GPU. So every encoder that works is timed on the same
    // 1080p test clip and the quickest wins. This runs once per app session.
    let best: { enc: VideoEncoder; ms: number } | null = null;
    for (const id of candidates) {
        if (!listed.includes(id)) continue;
        const enc = hardwareVideoEncoder(id);
        const ms = await benchmark(ffmpeg, enc);
        if (ms === null) {
            console.log(`Video encoder ${id} is built in but not usable on this machine`);
            continue;
        }
        console.log(`Video encoder ${id}: ${ms} ms on the test clip`);
        if (!best || ms < best.ms) best = { enc, ms };
    }

    const software = softwareVideoEncoder();
    if (!best) {
        console.log(`Video encoder: x264 (${getPerfTier()} tier, ${os.cpus().length} cores)`);
        return software;
    }
    const softwareMs = await benchmark(ffmpeg, software);
    console.log(`Video encoder x264: ${softwareMs ?? 'failed'} ms on the test clip`);
    // The GPU also leaves the CPU free for everything else, so it wins a near tie.
    if (softwareMs === null || best.ms <= softwareMs * 1.15) {
        console.log(`Video encoder: ${best.enc.label}`);
        return best.enc;
    }
    console.log(`Video encoder: x264 is faster than ${best.enc.id} on this machine`);
    return software;
}

// Encode three seconds of 1080p with the same arguments a real job uses, and
// return how long it took, or null when the encoder cannot run here at all.
async function benchmark(ffmpeg: string, enc: VideoEncoder): Promise<number | null> {
    const startedAt = Date.now();
    try {
        await execFileAsync(ffmpeg, [
            '-hide_banner', '-loglevel', 'error',
            '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30:d=3',
            ...videoEncodeArgs(enc, { height: 1080, oddSize: false }),
            '-f', 'null', '-',
        ], { timeout: 30_000, windowsHide: true });
        return Date.now() - startedAt;
    } catch {
        return null;
    }
}

/**
 * Run ffmpeg and report how far along it is. ffmpeg's `-progress` output gives the
 * position it has reached in the output, which against the source's length is a
 * real percentage, a real speed and a real time-left.
 */
export function runFfmpeg(
    ffmpeg: string,
    args: string[],
    totalSec: number | undefined,
    onProgress?: (p: EncodeProgress) => void,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(ffmpeg, ['-nostdin', '-progress', 'pipe:1', '-nostats', ...args], { windowsHide: true });

        let pending = '';
        let errTail = '';
        let lastSent = 0;
        let position = 0;
        let speed: number | undefined;

        child.stdout.on('data', (chunk: Buffer) => {
            pending += chunk.toString();
            const lines = pending.split(/\r?\n/);
            pending = lines.pop() ?? '';
            for (const line of lines) {
                const eq = line.indexOf('=');
                if (eq < 0) continue;
                const key = line.slice(0, eq).trim();
                const value = line.slice(eq + 1).trim();
                if (key === 'out_time_us' || key === 'out_time_ms') {
                    // Both are microseconds (ffmpeg's "ms" name is a long-standing misnomer).
                    const n = Number(value);
                    if (Number.isFinite(n) && n >= 0) position = n / 1_000_000;
                } else if (key === 'speed') {
                    const n = parseFloat(value);
                    speed = Number.isFinite(n) && n > 0 ? n : undefined;
                } else if (key === 'progress' && onProgress && totalSec && totalSec > 0) {
                    const now = Date.now();
                    if (value === 'end' || now - lastSent > 400) {
                        lastSent = now;
                        onProgress({
                            percent: Math.min(99, Math.max(0, (position / totalSec) * 100)),
                            speed,
                            etaSec: speed ? Math.max(0, (totalSec - position) / speed) : undefined,
                        });
                    }
                }
            }
        });
        child.stderr.on('data', (chunk: Buffer) => {
            errTail = (errTail + chunk.toString()).slice(-4000);
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`ffmpeg exited with code ${code}: ${errTail.trim().slice(-500)}`));
        });
    });
}
