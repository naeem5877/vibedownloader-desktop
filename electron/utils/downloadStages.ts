/**
 * Post-processing stages.
 *
 * yt-dlp never reports its conversion work as progress: the last progress line
 * is the last byte of the source stream, and everything after it - muxing video
 * with audio, transcoding to MP3 or WAV, embedding the cover art, and this app's
 * own H.264 recode - is written as `[Name] message` lines instead. Without them
 * a loader sits on the download's last percentage, which reads as "finished"
 * right before the slow part starts and as "stuck" during it.
 *
 * Every bracketed prefix yt-dlp writes for a step, mapped to the copy the
 * loader shows. A step found here is one that is doing work but has no
 * percentage of its own, which is what tells the renderer to stop drawing a
 * number. Unknown prefixes return null so a future yt-dlp release cannot invent
 * a stage this app does not understand.
 */
const STAGE_LABELS: Record<string, string> = {
    merger: 'Merging video & audio',
    extractaudio: 'Converting audio',
    embedthumbnail: 'Embedding cover art',
    thumbnailsconvertor: 'Converting cover art',
    convertthumbnail: 'Converting cover art',
    metadata: 'Writing metadata',
    videoconvertor: 'Converting video',
    videoremuxer: 'Remuxing video',
    fixupm3u8: 'Fixing stream',
    ffmpeg: 'Running FFmpeg',
    ffmpegfixup: 'Fixing stream',
};

/** ffmpeg writes the container it is producing into the Destination line. */
const CONTAINER_RE = /\.([a-z0-9]{2,4})(?=["'\s]|$)/i;

/**
 * Turn one `[Name] message` line into the copy the loader shows, or null when
 * the line carries no stage worth showing.
 *
 * `eventType` is the bracketed prefix with the brackets stripped (what
 * yt-dlp-wrap hands us on `ytDlpEvent`); `data` is the rest of the line.
 */
export function describeStage(eventType: string, data = ''): string | null {
    const type = eventType.trim();
    if (!type) return null;

    if (/^download$/i.test(type)) {
        // Progress lines are already forwarded as percentages, and the
        // Destination line only repeats a filename the loader does not show.
        return null;
    }

    if (/^extractaudio$/i.test(type)) {
        // The Destination line names the container ffmpeg is producing, which is
        // the one moment where the exact format is worth showing instead of a
        // generic "converting audio".
        const destination = /Destination:\s*(.+)$/.exec(data);
        const target = destination ? CONTAINER_RE.exec(destination[1]) : null;
        return target ? `Converting to ${target[1].toUpperCase()}` : 'Converting audio';
    }

    return STAGE_LABELS[type.toLowerCase()] ?? null;
}

/**
 * Read yt-dlp's output and report each stage once, keeping the partial line a
 * chunk boundary landed in the middle of.
 *
 * yt-dlp writes progress to stdout, which yt-dlp-wrap re-emits as parsed
 * events, but post-processor chatter goes to stderr, which the wrapper only
 * buffers for error messages. Both streams carry stages, so both are read here.
 */
export function createStageReader(onStage: (label: string) => void) {
    const lineRe = /^\s*\[([^\]]+)\]\s*(.*)$/;
    let partial = '';

    const readLine = (line: string) => {
        const match = lineRe.exec(line);
        if (!match) return;
        const stage = describeStage(match[1], match[2]);
        if (stage) onStage(stage);
    };

    return {
        /** One already-parsed stdout event from yt-dlp-wrap. */
        fromEvent(eventType: string, data: string) {
            const stage = describeStage(eventType, data);
            if (stage) onStage(stage);
        },
        /** A chunk of stderr, which arrives split at arbitrary byte offsets. */
        fromStderr(chunk: string) {
            partial += chunk;
            const lines = partial.split(/\r?\n/);
            partial = lines.pop() ?? '';
            lines.forEach(readLine);
        },
    };
}
