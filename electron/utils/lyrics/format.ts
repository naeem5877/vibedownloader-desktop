/**
 * Turning a lyric payload into a file the user can keep.
 *
 * This is pure string building with no filesystem or dialog access, so it is
 * kept separate from the IPC handler that writes the result. The formatter is
 * the part that can be wrong in a way the user only notices much later - a
 * malformed LRC that no player will sync - so it needs to be testable on its
 * own.
 *
 * Format follows the tab being exported rather than the richest data available:
 * a user looking at Plain wants a text file, not karaoke markup. Word-timed
 * lyrics export as enhanced LRC, which is the format every karaoke player
 * understands.
 */

import type { LyricLine, LyricsResult } from './types';

export type ExportMode = 'plain' | 'synced' | 'words' | 'translation';

export interface LyricsFile {
    filename: string;
    content: string;
}

/**
 * Filesystem-safe stem for a track.
 *
 * Artist names carry slashes ("AC/DC"), titles carry quotes and colons, and
 * Windows rejects a trailing dot or space. Anything outside a conservative set
 * becomes a hyphen so the name cannot escape the folder or the extension.
 */
function safeName(value: string, max = 80): string {
    const cleaned = (value || '')
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        // A trailing dot or space makes Windows silently drop the extension.
        .replace(/[. ]+$/, '')
        .slice(0, max)
        .trim();
    return cleaned || 'lyrics';
}

/**
 * The track name to show the user, from a raw upload title.
 *
 * The metadata a caller hands over is whatever the uploader typed, which for a
 * YouTube music upload is usually
 * `"Ae Ajnabee (Official Music Video) - Aditya Rikhari, Ravator, Kutle Khan |
 * Coke Studio Bharat"` - credits and channel welded into the title. Rendering
 * that verbatim in a panel header is what made the lyrics UI look broken.
 *
 * So the same two cuts the matcher already uses are applied here: drop the
 * channel after `|`, then drop the credit line after the first ` - `. Only
 * parentheses holding a marker are then stripped, so a real parenthetical such
 * as `(Live at Wembley)` survives.
 */
export function displayTitle(raw: string, artist = ''): string {
    const channelStripped = (raw || '').split('|')[0].trim();

    let title = channelStripped;

    // `Ed Sheeran - Perfect (Official Music Video)` is Artist - Title, and
    // cutting at the dash would leave just the artist - producing
    // "Ed Sheeran - Ed Sheeran.lrc". `Ae Ajnabee (Official Music Video) -
    // Aditya Rikhari, Ravator | Coke Studio` is Track - Credits, and the cut is
    // exactly right.
    //
    // Those two are told apart by the artist: cutting is only safe when the left
    // side is known *not* to be the artist. With no artist to compare against,
    // the dash is left alone rather than guessed at.
    const artistName = artist.trim().toLowerCase();
    if (artistName) {
        const dashIndex = title.indexOf(' - ');
        if (dashIndex > 0 && title.slice(0, dashIndex).trim().toLowerCase() !== artistName) {
            title = title.slice(0, dashIndex).trim();
        }
    }

    return (title
        .replace(/\((?:official\s+)?(?:music\s+)?(?:video|audio|lyric\s+video|visualizer|hd|hq|4k|official)\)/gi, '')
        .replace(/\s+/g, ' ')
        .trim()) || channelStripped || raw.trim();
}

/**
 * The artist to show the user, in the casing the metadata had.
 *
 * The matched `artist` is lowercased by normalization, which is right for
 * matching and wrong for a header or a filename (`ed sheeran - Perfect.lrc`).
 * This keeps the full credit list rather than shortening it: the panel header
 * clamps it with CSS, and every real credit stays in a saved file.
 */
export function displayArtist(raw: string): string {
    return (raw || '')
        .replace(/\s*[-–]\s*Topic\s*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * `Artist - Title.ext`, or just `Title.ext` when the artist is unknown.
 *
 * When the artist is already the whole title, the name is not doubled.
 */
function fileNameFor(title: string, artist: string, ext: string): string {
    const trimmedArtist = artist.trim();
    const a = trimmedArtist ? safeName(trimmedArtist, 60) : '';
    let t = safeName(displayTitle(title, artist));

    // The title often still leads with the artist, because the dash was left in
    // place for exactly that case. Prefixing the artist again would read
    // "Ed Sheeran - Ed Sheeran - Perfect.lrc", so the leading repeat is dropped.
    const artistKey = trimmedArtist.toLowerCase();
    if (artistKey && t.toLowerCase().startsWith(`${artistKey} - `)) {
        t = safeName(t.slice(artistKey.length + 3));
    }

    if (a && t.toLowerCase() === a.toLowerCase()) return `${t}.${ext}`;

    return a ? `${a} - ${t}.${ext}` : `${t}.${ext}`;
}

/** `[mm:ss.xx]`, the timestamp both LRC and SRT-style players expect. */
function stamp(ms: number): string {
    const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
    const totalSeconds = Math.floor(safe / 1000);
    const hundredths = Math.floor((safe % 1000) / 10);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

/**
 * LRC metadata header.
 *
 * Uses the same display title as the filename, so the file agrees with its own
 * name. One `[ti]` tag is emitted even when the raw title contains `]`, because
 * splitting on newlines already gives every tag its own line and a stray `]`
 * inside the value is harmless.
 */
function header(title: string, artist: string): string {
    return [`[ti]:${displayTitle(title, artist)}`, `[ar]:${artist}`].join('\n');
}

/**
 * Plain lyrics as text.
 *
 * `text` is used when present because a word-timed line's `text` field is the
 * whole line; a blank line is preserved so verse structure survives the round
 * trip.
 */
export function toPlainText(lines: LyricLine[] | undefined, title = '', artist = ''): string {
    if (!lines?.length) return '';

    const meta: string[] = [];
    if (title) meta.push(displayTitle(title, artist));
    if (artist) meta.push(artist);

    const body = lines.map((line) => line.text).join('\n');

    return meta.length ? `${meta.join(' - ')}\n\n${body}\n` : `${body}\n`;
}

/**
 * Line-synced lyrics as LRC.
 *
 * A blank `[00:00.00]` row is not emitted for gaps: some players treat it as a
 * real line and flash an empty row, so spacing is carried in the original
 * order instead.
 */
export function toLrc(lines: LyricLine[] | undefined, title = '', artist = ''): string {
    if (!lines?.length) return '';

    const rows = lines.map((line) => `[${stamp(line.t)}]${line.text}`);
    return `${header(title, artist)}\n${rows.join('\n')}\n`;
}

/**
 * Word-timed lyrics as enhanced LRC.
 *
 * Each word carries its own inline timestamp, which is what makes a player
 * highlight word by word. A line with no word timings degrades to a plain LRC
 * row rather than emitting empty per-word stamps, so the file is still usable if
 * the data is partial.
 */
export function toEnhancedLrc(lines: LyricLine[] | undefined, title = '', artist = ''): string {
    if (!lines?.length) return '';

    const rows = lines.map((line) => {
        if (!line.words?.length) return `[${stamp(line.t)}]${line.text}`;

        const inline = line.words
            .map((word) => `<${stamp(word.t)}>${word.w}`)
            .join('');
        return `[${stamp(line.t)}]${inline}`;
    });

    return `${header(title, artist)}\n${rows.join('\n')}\n`;
}

/**
 * The file for a given tab.
 *
 * Returns `null` when that tab has no data, so the caller can refuse to write an
 * empty file rather than leaving a 0-byte artefact on disk.
 *
 * `shownTitle` / `shownArtist` override the result's own strings for naming.
 * Those are the *normalized* values the provider matched on - lowercase,
 * de-noised, and for a multi-artist upload sometimes the credit line rather
 * than the track name. They are right for matching and wrong for a filename, so
 * a save passes the result's `displayTitle` / `displayArtist`, which the main
 * process derived from the original metadata (see `index.ts`).
 */
export function buildLyricsFile(
    lyrics: LyricsResult | null,
    mode: ExportMode,
    shownTitle?: string,
    shownArtist?: string
): LyricsFile | null {
    if (!lyrics) return null;

    // Named `shown*` rather than `display*` so they do not shadow the
    // `displayTitle()` helper that trims the raw upload title.
    const title = shownTitle ?? lyrics.title ?? '';
    const artist = shownArtist ?? lyrics.artist ?? '';

    if (mode === 'words') {
        const lines = lyrics.words;
        if (!lines?.length) return null;
        return {
            filename: fileNameFor(title, artist, 'lrc'),
            content: toEnhancedLrc(lines, title, artist)
        };
    }

    if (mode === 'synced') {
        const lines = lyrics.synced;
        if (!lines?.length) return null;
        return {
            filename: fileNameFor(title, artist, 'lrc'),
            content: toLrc(lines, title, artist)
        };
    }

    if (mode === 'translation') {
        const lines = lyrics.translation;
        if (!lines?.length) return null;
        return {
            filename: `${fileNameFor(title, artist, 'txt').replace(/\.txt$/, '')} translation.txt`,
            content: toPlainText(lines, title, artist)
        };
    }

    if (mode === 'plain') {
        if (lyrics.plain?.trim()) {
            const meta: string[] = [];
            if (title) meta.push(displayTitle(title, artist));
            if (artist) meta.push(artist);
            const headerText = meta.length ? `${meta.join(' - ')}\n\n` : '';
            return {
                filename: fileNameFor(title, artist, 'txt'),
                content: `${headerText}${lyrics.plain}\n`
            };
        }
        if (lyrics.synced?.length) {
            return {
                filename: fileNameFor(title, artist, 'txt'),
                content: toPlainText(lyrics.synced, title, artist)
            };
        }
        return null;
    }

    return null;
}