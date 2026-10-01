/**
 * Timeline parsers for the two lyric formats the providers publish.
 *
 * LRCLIB's `syncedLyrics` is standard LRC, and NetEase's `tlyric` uses the same
 * shape, so one parser covers both. NetEase's `yrc` is a different format with
 * per-word timings and needs its own.
 *
 * Both parsers are total: malformed input yields fewer lines or an empty array,
 * never a throw. A provider returning junk must not take down the panel.
 */

import type { LyricLine, WordTiming } from './types';

/**
 * A single LRC timestamp: `[mm:ss.xx]`, `[mm:ss:xxx]` or `[mm:ss]`.
 *
 * The separator decides how the fraction is read, and the two are not
 * interchangeable: `.` denotes hundredths (`.50` = 500ms, `.5` = 500ms) while
 * `:` denotes milliseconds (`:500` = 500ms, `:5` = 5ms). Treating them the same
 * shifts every colon-style line by up to a second, which desyncs the highlight
 * from the audio. Captured separately so `parseLrc` can scale by separator.
 */
const LRC_TAG = /\[(\d{1,3}):(\d{1,2})(?:([.:])(\d{1,3}))?\]/g;

/**
 * Parse LRC into ordered lines.
 *
 * Handles the multi-timestamp form (`[00:10.00][01:20.00] repeated line`), which
 * LRC uses for a chorus that appears twice, by emitting one line per stamp.
 * Fractional digits are scaled by position, so `.5` is 500ms and `.50` is also
 * 500ms rather than 50ms.
 *
 * A `[ar:]`-style metadata tag carries no timestamp and is skipped.
 */
export function parseLrc(raw: string): LyricLine[] {
    if (!raw) return [];

    const out: LyricLine[] = [];

    for (const rawLine of raw.split(/\r?\n/)) {
        LRC_TAG.lastIndex = 0;

        const stamps: number[] = [];
        let textStart = 0;
        let match: RegExpExecArray | null;

        // Consume the leading run of timestamps; whatever follows is the text.
        while ((match = LRC_TAG.exec(rawLine)) !== null) {
            if (match.index !== textStart) break;
            const [, mm, ss, sep, frac] = match;
            const minutes = parseInt(mm, 10);
            const seconds = parseInt(ss, 10);

            let millis = 0;
            if (frac) {
                if (sep === '.') {
                    // Hundredths: keep two digits and scale to milliseconds.
                    // `.5`/`.05` -> 500/50ms, and a third digit is ignored
                    // rather than overflowing into a full extra second.
                    millis = parseInt(frac.slice(0, 2).padEnd(2, '0'), 10) * 10;
                } else {
                    // Already milliseconds - use verbatim, no padding.
                    millis = parseInt(frac, 10);
                }
            }

            stamps.push(minutes * 60_000 + seconds * 1_000 + millis);
            textStart = LRC_TAG.lastIndex;
        }

        if (stamps.length === 0) continue;

        const text = rawLine.slice(textStart).trim();
        // A bare timestamp with no text is a spacer, not a lyric.
        if (!text) continue;

        for (const t of stamps) out.push({ t, text });
    }

    return out.sort((a, b) => a.t - b.t);
}

/**
 * Parse NetEase `yrc` into lines that carry per-word timings.
 *
 * Format: `[lineStart,lineDuration](wordStart,wordDuration,0)word(wordStart,...)word`
 *
 * English is segmented per word, CJK per character. Timings are milliseconds and
 * are absolute within the track, not offsets from the line.
 *
 * Lines whose start is negative are credit metadata - `{"t":-1000,...}` renders
 * as a fake line at -1s - and are dropped. Without this the panel shows
 * `作词:` as a lyric that appears before the song starts.
 */
export function parseYrc(raw: string): LyricLine[] {
    if (!raw) return [];

    const out: LyricLine[] = [];

    for (const rawLine of raw.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;

        const lineStamp = line.match(/^\[(-?\d+)\s*,\s*(\d+)\]/);
        if (!lineStamp) continue;

        const lineStart = parseInt(lineStamp[1], 10);
        // Negative start is a credit line, not a lyric.
        if (lineStart < 0) continue;

        const words: WordTiming[] = [];
        const wordRe = /\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)\)([^(]*)/g;
        let m: RegExpExecArray | null;

        while ((m = wordRe.exec(line)) !== null) {
            const w = m[4].trim();
            if (!w) continue;
            words.push({ t: parseInt(m[1], 10), d: parseInt(m[2], 10), w });
        }

        if (words.length === 0) continue;

        // Prefer the joined words over the raw slice: the raw text still carries
        // every `(t,d,0)` group, and the spacing between CJK characters in yrc
        // is not meant to render literally.
        out.push({ t: lineStart, text: words.map((w) => w.w).join(' '), words });
    }

    return out.sort((a, b) => a.t - b.t);
}

/**
 * True when a parsed timeline is worth showing.
 *
 * Rejects a single-line result, which in practice means the provider echoed a
 * title or an error string into the lyric field rather than real content.
 */
export function isUsableTimeline(lines: LyricLine[] | undefined): boolean {
    return Array.isArray(lines) && lines.length >= 1;
}
