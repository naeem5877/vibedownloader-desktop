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
        'radio\\s+(?:edit|mix|version)',
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
 * Supports round (), square [], curly {}, or bare tags.
 */
const NON_TITLE_NOISE: RegExp =
    /[([{\s]*(?:official\s*(?:music\s*)?(?:video|audio)|official|lyric\s*video|lyrics?|visualizer|audio\s*track|hd|hq|4k|remastered\s*\d{4}|full\s*video)[)\]}\s]*/gi;

/** `feat.`, `ft.`, `featuring` and friends, including bracketed or bare forms. */
const FEAT_RE =
    /[([{\[](?:feat|ft|featuring|ft\.)[^)\]}]*[)\]}]|\b(?:feat|ft|featuring)\.?\s+[^-]+$/gi;

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
 * Clean artist name by stripping common channel artefacts and formatting.
 * Handles `- Topic`, `VEVO`, `Official`, and PascalCase spacing (TaylorSwift -> Taylor Swift).
 */
export function cleanArtist(raw: string): string {
    if (!raw) return '';
    let s = raw.trim();
    s = s.replace(/\s*[-–—]\s*Topic$/i, '');
    s = s.replace(/\s*VEVO$/i, '');
    s = s.replace(/VEVO$/i, '');
    s = s.replace(/\s*Official(?:\s*(?:Channel|Music|Page))?$/i, '');
    s = s.replace(/Official$/i, '');
    s = s.replace(/\s*Music$/i, '');
    // PascalCase / camelCase name separation (e.g. JustinBieber -> Justin Bieber)
    s = s.replace(/([a-z])([A-Z])/g, '$1 $2');
    return s.trim();
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
    t = t.replace(/[([{\[](?:with)\s+[^)\]}]*[)\]}]/gi, ' ');

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
 * YouTube uploads frequently use either:
 * - "Artist - Title" (Ed Sheeran - Shape of You)
 * - "Title - Artist / Credits" (Ae Ajnabee - Aditya Rikhari)
 *
 * We produce both sides of the dash as candidates, along with the full title
 * and channel-stripped title.
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

    // Split on dash: could be "Artist - Title" OR "Title - Credits"
    const dashMatch = withoutChannel.match(/\s+[-–—]\s+/);
    if (dashMatch && dashMatch.index !== undefined) {
        const partA = withoutChannel.slice(0, dashMatch.index).trim();
        const partB = withoutChannel.slice(dashMatch.index + dashMatch[0].length).trim();
        // In YouTube, "Artist - Title" is overwhelmingly common -> partB is the title
        add(partB);
        // In "Title - Credits", partA is the title
        add(partA);
    }

    return variants;
}

/**
 * The artist credits the upload put in its own title, normalized.
 *
 * Returns the potential artist portion of a dash-separated title.
 */
export function titleCredits(raw: string): string {
    const withoutChannel = raw.split('|')[0];
    const dashMatch = withoutChannel.match(/\s+[-–—]\s+/);
    if (!dashMatch || dashMatch.index === undefined) return '';
    const partA = withoutChannel.slice(0, dashMatch.index).trim();
    const partB = withoutChannel.slice(dashMatch.index + dashMatch[0].length).trim();
    // In Artist - Title, partA is the artist. In Title - Credits, partB has credits.
    const cleanA = cleanArtist(partA);
    return cleanA || normalizeTitle(partB);
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

    const cleaned = cleanArtist(raw);
    const normalized = cleaned
        .toLowerCase()
        .replace(/\((?:feat|ft|featuring)\.?\s*[^)]*\)/gi, ' ')
        .replace(/[._]+/g, ' ')
        .replace(/&/g, ' and ')
        .replace(FEAT_RE, ' ')
        .replace(EDGE_NOISE_RE, '')
        .replace(/\s+/g, ' ')
        .trim();

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
