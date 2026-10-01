/**
 * Shared shapes for the lyrics pipeline.
 *
 * Three providers feed one result, and each contributes a different format, so
 * the fields are all optional: a track may have plain text from LRCLIB but no
 * word-level timing from NetEase, and that is a normal outcome rather than a
 * failure (see `docs`: NetEase published word-level lyrics for only 9 of 12
 * sampled tracks).
 *
 * `LyricsResult` is only ever built when at least one format has content. The
 * hard rule is no lyrics means no UI, so a "successful" result with every field
 * empty must not be constructed - `isEmpty` exists to enforce that.
 */

/** One timed word, used only by the NetEase word-by-word format. */
export interface WordTiming {
    /** Offset from the start of the track, in milliseconds. */
    t: number;
    /** How long the word stays on screen, in milliseconds. */
    d: number;
    /** The word itself, without surrounding whitespace. */
    w: string;
}

/**
 * One timed line.
 *
 * `words` is populated for word-by-word lyrics and left undefined for
 * line-by-line, which is what lets the renderer tell the two apart without a
 * separate flag.
 */
export interface LyricLine {
    /** Offset from the start of the track, in milliseconds. */
    t: number;
    /** Full text of the line. */
    text: string;
    /** Per-word timings, when the source provided them. */
    words?: WordTiming[];
}

/** Which provider supplied a given piece of the result. */
export type LyricsProvider = 'lrclib' | 'netease';

/** The combined best-effort result for one track. */
export interface LyricsResult {
    /** Untimed lyrics as a single block of text. */
    plain?: string;
    /** Line-by-line timing, from LRCLIB. */
    synced?: LyricLine[];
    /** Word-by-word timing, from NetEase `yrc`. */
    words?: LyricLine[];
    /**
     * Translated line-by-line lyrics, from NetEase `tlyric`.
     * Off by default in the UI and only present when the provider had one.
     */
    translation?: LyricLine[];

    /** Track title used for matching, after normalization. */
    title: string;
    /** Primary artist used for matching, after normalization. */
    artist: string;
    /**
     * The track name to show the user, with upload noise removed.
     *
     * `title` is the string that *matched*, so it is normalized, lowercased, and
     * for a multi-artist upload sometimes the credit line. None of that belongs in
     * a header. Present whenever the caller supplied a title; the panel falls
     * back to `title` when it is absent.
     */
    displayTitle?: string;
    /** The artist to show the user, shortened when the credit list is long. */
    displayArtist?: string;
    /** Track duration in seconds, when known. */
    duration?: number;
    /** Where each format came from, for diagnostics. */
    sources: Partial<Record<'plain' | 'synced' | 'words' | 'translation', LyricsProvider>>;
}

/** What the caller hands in to look lyrics up. */
export interface LyricsQuery {
    title: string;
    artist: string;
    /** Track duration in seconds. Used for candidate scoring, not required. */
    duration?: number;
}

/**
 * True when the result carries nothing a user could read.
 *
 * A track can legitimately produce a `LyricsResult` with only `plain` set, or
 * only `synced`, so this checks every format rather than assuming.
 */
export function isEmpty(result: LyricsResult): boolean {
    return (
        !result.plain?.trim() &&
        (!result.synced || result.synced.length === 0) &&
        (!result.words || result.words.length === 0) &&
        (!result.translation || result.translation.length === 0)
    );
}
