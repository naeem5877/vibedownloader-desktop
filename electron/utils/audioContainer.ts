import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getFfprobePath } from './binaries';

const execFileAsync = promisify(execFile);

/**
 * WAV is a promise the file extension makes to the user, and a download that
 * reports success has to have kept it. The conversion itself is ffmpeg's, but
 * nothing in the pipeline checks its result - a container that merely got an
 * `.wav` name would be handed over as "uncompressed PCM", which is exactly the
 * claim a WAV download must never make falsely.
 *
 * The container is identified from the file's own header rather than ffprobe:
 * this runs on every WAV download, and four bytes answer the question.
 */
export function isWavFile(filePath: string): boolean {
    let handle: number;
    try {
        handle = fs.openSync(filePath, 'r');
    } catch {
        return false;
    }
    try {
        const header = Buffer.alloc(12);
        const read = fs.readSync(handle, header, 0, 12, 0);
        if (read < 12) return false;
        // RIFF....WAVE
        return header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WAVE';
    } catch {
        return false;
    } finally {
        fs.closeSync(handle);
    }
}

/**
 * The codec actually inside a file, for the error message when a download
 * claimed a format it does not have. Returns null when ffprobe is unavailable
 * or cannot read the file, which is not itself a failure: the caller is only
 * naming a problem that has already been detected.
 */
export async function describeAudioCodec(filePath: string): Promise<string | null> {
    const ffprobe = getFfprobePath();
    if (!ffprobe) return null;
    try {
        const { stdout } = await execFileAsync(ffprobe, [
            '-hide_banner', '-v', 'error',
            '-select_streams', 'a:0',
            '-show_entries', 'stream=codec_name',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            filePath
        ]);
        return stdout.trim() || null;
    } catch {
        return null;
    }
}
