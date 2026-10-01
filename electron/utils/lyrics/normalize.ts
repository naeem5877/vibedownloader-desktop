/**
 * Title and artist matching for lyric lookups.
 *
 * This module carries the single most important correctness rule in the
 * feature, and it is a *rejection* rule, not a scoring one.
 *
 * LRCLIB answers `/api/search` with roughly 20 loose candidates for a popular
 * track, spanning compilations, live cuts and remixes. `Shape of You` +
 * `Ed Sheeran` returns results from 234s to 260s. The official track is 234s
 * and has line-only lyrics; `Shape Of You (Galantis Extended Remix)` is 235s -
 * one second away - and has 364 word-level stamps. A matcher that scores on
 * duration proximity alone will hand the user the remix's lyrics for the
 * original song, which is exactly the kind of confidently-wrong result the
 * feature must never produce.
 *
 * So variants are rejected by name *before* any scoring happens, and the
 * rejection is not reversible by normalization. Order matters: the blocklist
 * sees the raw title, so a real variant can never be resurrected by
 * over-aggressive cleanup.
 */

/**
 * Markers that identify a candidate as a different recording of the same song.
 *
 * Anchored with `\b` so `mix` cannot fire inside `mixture`, `edit` inside
 * `editorial`, or `live` inside `delivery`. Entries are deliberately broad: a
 * false rejection only costs the user lyrics, while a false acceptance ships
 * the wrong ones.
 */
const VARIANT_MARKERS: RegExp = new RegExp(
    `\\b(?:${[
        'remix(?:ed|es)?',
        'acoustic',
        'live',
        'unplugged',
        'cover(?:ed)?',
        'karaoke',
        'instrumental',
        'inst',
        'version',
        'edit(?:ed)?',
        'mix(?:ed)?',
        'extended',
        'rework(?:ed)?',
        'remaster(?:ed)?',
        'reissue',
        'demo',
        'radio',
        'sped',
        'slowed',
        'reverb',
        'vip',
        'reprise'
    ].join('|')})\\b`,
    'i'
);

/**
 * Markers that mean "this is a different song", as opposed to a different
 * recording. A candidate titled `Shape of You (Acoustic)` is a variant worth
 * rejecting; one titled `Shape of You (feat. Someone)` is the same song.
 */
const NON_TITLE_NOISE: RegExp =
    /\((?:official\s*(?:music\s*)?(?:video|audio)|official|lyric\s*video|lyrics?|visualizer|hd|hq|4k|remastered\s*\d{4}|full\s*video)\)/gi;

/** `feat.`, `ft.`, `featuring` and friends, including bracketed or bare forms. */
const FEAT_RE =
    /\((?:feat|ft|featuring|ft\.)[^)]*\)|\b(?:feat|ft|featuring)\.?\s+[^-]+$/gi;

/** Trailing dashes and separators left behind after the above removals. */
const EDGE_NOISE_RE = /^[\s\-–—_,.:;|/\\]+|[\s\-–—_,.:;|/\\]+$/g;

/** Filler that carries no identifying weight when comparing two titles. */
const FILLER_RE = /\b(?:the|a|an)\b/gi;

/**
 * True when the title names a recording that is not the canonical track.
 *
 * Checked against the raw title before any normalization, so this cannot be
 * undone later.
 */
export function isVariantTitle(rawTitle: string): boolean {
    if (!rawTitle) return false;

    // Punctuation becomes a space so that `remix`, `remix)` and `(remix` all
    // present the same word boundary to the matcher. The `\b` anchors in the
    // pattern then stop a marker matching inside a longer word.
    const normalized = rawTitle.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    return VARIANT_MARKERS.test(normalized);
}

/**
 * Reduce a title to its identifying core for comparison.
 *
 * Only removes decoration - official-video markers, featured-artist tails and
 * filler articles. Deliberately conservative: it must not turn two genuinely
 * different songs into equal strings, because a false equality is a wrong match
 * whereas a false inequality only costs a lyric.
 */
export function normalizeTitle(raw: string): string {
    if (!raw) return '';

    let t = raw.toLowerCase();

    // Noise markers first, while they are still bracketed.
    t = t.replace(NON_TITLE_NOISE, ' ');

    // Bracketed "feat." groups, then a trailing unbracketed one.
    t = t.replace(FEAT_RE, ' ');
    t = t.replace(/\((?:with)\s+[^)]*\)/gi, ' ');

    // Any remaining bracket content is usually a version tag we already
    // rejected; keeping it would block a legitimate match.
    t = t.replace(/[()[\]{}]/g, ' ');

    // Dots and underscores are word separators in some catalogues.
    t = t.replace(/[._]+/g, ' ');
    t = t.replace(FILLER_RE, ' ');

    return t.replace(EDGE_NOISE_RE, '').replace(/\s+/g, ' ').trim();
}

/**
 * Ordered normalized title candidates for one raw upload title.
 *
 * YouTube's upload convention packs credits and the channel into the title:
 * `Ae Ajnabee (Official Music Video) - Aditya Rikhari, Ravator, Kutle Khan |
 * Coke Studio Bharat`. Only the first segment is the track name, and the extra
 * words are enough to sink the title score even when the artist is right - that
 * exact URL matched nothing until the title was cut down to `Ae Ajnabee`.
 *
 * The variants are ordered safest-first and the caller stops at the first
 * confident match, so a title that already works is never second-guessed.
 * Truncating also cannot invent a match: every variant still has to clear the
 * same threshold and the same variant guards, and it is only ever tried when the
 * fuller title already failed. A wrong cut costs a lyric, never fakes one.
 *
 * The dash is the risky cut - `Ed Sheeran - Perfect` would truncate to
 * `Ed Sheeran` - which is exactly why the untruncated title is tried first.
 */
export function titleCandidates(raw: string): string[] {
    const variants: string[] = [];
    const add = (value: string) => {
        const normalized = normalizeTitle(value);
        if (normalized && !variants.includes(normalized)) variants.push(normalized);
    };

    add(raw);

    // Everything after `|` is the channel. `Ae Ajnabee | Coke Studio Bharat`.
    const withoutChannel = raw.split('|')[0];
    add(withoutChannel);

    // Everything after the first ` - ` is the credit line, when there is one.
    const dashIndex = withoutChannel.indexOf(' - ');
    if (dashIndex > 0) add(withoutChannel.slice(0, dashIndex));

    return variants;
}

/**
 * The artist credits the upload put in its own title, normalized.
 *
 * Worth harvesting because the noisy channel-derived artist is often worse than
 * nothing. On `youtu.be/ut1rfURWyCo` yt-dlp reported `Coke Studio India,
 * Aditya Rikhari, Ravator Music, Kutle Khan Project` - a label, two artists and a
 * project name, none of which match a catalogue as a single string, while the
 * title's own credit line (`Aditya Rikhari, Ravator, Kutle Khan`) matches
 * immediately. Empty string when the title carries no credits.
 */
export function titleCredits(raw: string): string {
    const withoutChannel = raw.split('|')[0];
    const dashIndex = withoutChannel.indexOf(' - ');
    if (dashIndex <= 0) return '';
    return normalizeTitle(withoutChannel.slice(dashIndex + 3));
}

/**
 * Reduce an artist field for comparison.
 *
 * Splits on the separators catalogues actually use rather than flattening them,
 * so a match can check whether the artists overlap at all instead of demanding
 * an exact string.
 */
export function normalizeArtist(raw: string): string {
    if (!raw) return '';

    const normalized = raw
        .toLowerCase()
        .replace(/\((?:feat|ft|featuring)\.?\s*[^)]*\)/gi, ' ')
        .replace(/[._]+/g, ' ')
        .replace(/&/g, ' and ')
        .replace(FEAT_RE, ' ')
        .replace(EDGE_NOISE_RE, '')
        .replace(/\s+/g, ' ')
        .trim();

    // Repeated names are a metadata artefact rather than a collaboration.
    // YouTube Music reports `"A, A"` on single-artist tracks, and a doubled
    // artist matches no catalogue, so the repeat is collapsed here as well as
    // at the source.
    //
    // Only a genuine repeat rewrites the string. Re-joining an unchanged list
    // would quietly turn "simon and garfunkel" into "simon, garfunkel" and
    // change what `artistScore` compares, so the separator style the caller
    // supplied is preserved unless there is something to fix.
    const parts = normalized.split(/\s*(?:,|;|&|\band\b)\s*/).filter(Boolean);
    if (new Set(parts).size === parts.length) return normalized;

    const seen = new Set<string>();
    const unique: string[] = [];
    for (const part of parts) {
        if (seen.has(part)) continue;
        seen.add(part);
        unique.push(part);
    }

    return unique.join(', ');
}

/** Individual artist names, for overlap testing. */
export function artistTokens(raw: string): string[] {
    const norm = normalizeArtist(raw);
    if (!norm) return [];
    return norm.split(/\s*(?:,|;|&|\bx\b|\band\b|\bwith\b|\bfeaturing\b)\s*| and /).filter(Boolean);
}

/**
 * Levenshtein distance, capped so a full table is never built for long strings.
 * Used only to absorb small catalogue differences such as `Don't` vs `Dont`.
 */
function editDistance(a: string, b: string): number {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > 3) return Math.max(a.length, b.length);

    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const curr = [i];
        for (let j = 1; j <= b.length; j++) {
            curr[j] = Math.min(
                prev[j] + 1,
                curr[j - 1] + 1,
                prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
        }
        prev = curr;
    }
    return prev[b.length];
}

/** 0..1 similarity, tolerant of the small spelling differences catalogues have. */
function similarity(a: string, b: string): number {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const longest = Math.max(a.length, b.length);
    if (longest === 0) return 0;
    return 1 - editDistance(a, b) / longest;
}

/**
 * How closely a candidate title matches the requested one, in 0..1.
 *
 * Exact equality after normalization is the common case and scores 1. Beyond
 * that it falls back to fuzzy similarity, with a substring bonus for the
 * legitimate case of a catalogue title carrying a suffix the request lacks
 * (`Shape of You` against `Shape of You (feat. X)`).
 */
export function titleScore(wantRaw: string, gotRaw: string): number {
    const want = normalizeTitle(wantRaw);
    const got = normalizeTitle(gotRaw);
    if (!want || !got) return 0;
    if (want === got) return 1;

    const fuzzy = similarity(want, got);
    if (got.startsWith(want) || want.startsWith(got)) {
        return Math.max(fuzzy, 0.9);
    }
    if (got.includes(want) || want.includes(got)) {
        return Math.max(fuzzy, 0.8);
    }
    return fuzzy;
}

/**
 * How closely a candidate artist matches the requested one, in 0..1.
 *
 * Containment is generous on purpose: the request often carries a single artist
 * while the catalogue lists several, and that is still the same recording.
 */
export function artistScore(wantRaw: string, gotRaw: string): number {
    const want = normalizeArtist(wantRaw);
    const got = normalizeArtist(gotRaw);
    if (!want || !got) return 0;
    if (want === got) return 1;

    if (got.includes(want) || want.includes(got)) {
        // Prefer the tighter containment, so a single requested artist matching
        // a long collaboration scores below an exact two-artist match.
        return 0.75 + 0.2 * (Math.min(want.length, got.length) / Math.max(want.length, got.length));
    }

    const wantSet = artistTokens(wantRaw);
    const gotSet = artistTokens(gotRaw);
    if (wantSet.length && gotSet.length) {
        const overlap = wantSet.filter((w) => gotSet.some((g) => similarity(w, g) > 0.85));
        if (overlap.length) return 0.7 + 0.2 * (overlap.length / Math.max(wantSet.length, gotSet.length));
    }

    return similarity(want, got);
}

/**
 * Duration agreement in 0..1, or `null` when either side is unknown.
 *
 * Returned separately from the total because an unknown duration must not be
 * scored as a mismatch - plenty of calls have no duration at all.
 *
 * Tolerance is 4 seconds up to 8, widening to 8 seconds beyond that, since
 * catalogue durations are rounded and intros can be trimmed.
 */
export function durationScore(wantSec: number | undefined, gotSec: number | undefined): number | null {
    if (!wantSec || !gotSec) return null;
    if (wantSec <= 0 || gotSec <= 0) return null;

    const diff = Math.abs(wantSec - gotSec);
    const tolerance = wantSec > 480 ? 8 : 4;
    if (diff <= tolerance) return 1;
    if (diff <= tolerance * 2) return 0.5;
    return 0;
}
