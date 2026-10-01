/**
 * LRCLIB client for plain and line-synced lyrics.
 *
 * Public API, no key, no login. Sampled 18 popular tracks during research and
 * all 18 carried both `plainLyrics` and `syncedLyrics`; `hasWordSync` was false
 * on all 18, which is why word-by-word comes from NetEase instead.
 *
 * Use the runtime `fetch`, not `https`. PowerShell's `Invoke-WebRequest` returned
 * 503 repeatedly against this host; that was a client/TLS issue, not an outage.
 */

import type { LyricLine, LyricsProvider } from './types';
import { parseLrc, isUsableTimeline } from './parsers';
import { titleScore, artistScore, durationScore, isVariantTitle } from './normalize';

const BASE = 'https://lrclib.net/api';

/**
 * Minimum score a candidate must reach to be considered at all, and the minimum
 * to be returned.
 *
 * Both are deliberately strict. Research measured the failure this guards
 * against: `Shape of You` is 234s with line-only lyrics, and
 * `Shape Of You (Galantis Extended Remix)` is 235s with 364 word-level stamps.
 * A loose threshold returns the remix's words for the original song, which is a
 * worse outcome than showing nothing.
 */
const CANDIDATE_FLOOR = 0.62;
const ACCEPT_THRESHOLD = 0.8;

export interface LrclibCandidate {
    id: number;
    trackName: string;
    artistName: string;
    plainLyrics?: string;
    syncedLyrics?: string;
    instrumental?: boolean;
    duration?: number;
}

export interface LrclibMatch {
    plain?: string;
    synced?: LyricLine[];
    provider: LyricsProvider;
    /** Highest score seen, for diagnostics. */
    score: number;
}

/**
 * Score one candidate against the request, in 0..1.
 *
 * Title dominates, artist reinforces, and duration can only break ties - it is
 * never able to carry a candidate on its own, because duration alone is what
 * picks the remix in the trap above.
 */
function scoreCandidate(
    want: { title: string; artist: string; duration?: number },
    cand: LrclibCandidate
): number {
    const t = titleScore(want.title, cand.trackName);
    if (t < 0.5) return 0;

    const a = artistScore(want.artist, cand.artistName);
    if (a < 0.5) return 0;

    const d = durationScore(want.duration, cand.duration);

    // Title and artist are required to agree; duration modulates what they score
    // rather than being added on top, so an exact duration cannot rescue a
    // differently-named song.
    const base = t * 0.7 + a * 0.3;
    if (d === null) return base;
    if (d === 0) return base * 0.5;

    return base * (0.9 + 0.1 * d);
}

/**
 * Find the best LRCLIB match, or `null` when nothing is confidently correct.
 *
 * Returns `null` rather than a weak match on purpose: the caller renders no
 * panel at all in that case, which is the intended behaviour for a bad match.
 */
export async function fetchLrclib(
    query: { title: string; artist: string; duration?: number },
    timeoutMs = 5000
): Promise<LrclibMatch | null> {
    const { title, artist } = query;
    if (!title || !artist) return null;

    const params = new URLSearchParams({
        track_name: title,
        artist_name: artist
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let payload: any[] = [];
    try {
        const res = await fetch(`${BASE}/search?${params.toString()}`, {
            signal: controller.signal,
            headers: { Accept: 'application/json' }
        });
        if (!res.ok) return null;

        const body = await res.json();
        if (!Array.isArray(body)) return null;
        payload = body;
    } catch {
        // Network failure, abort, or bad JSON. The caller falls back to NetEase.
        return null;
    } finally {
        clearTimeout(timer);
    }

    if (payload.length === 0) return null;

    let best: { cand: LrclibCandidate; score: number } | null = null;
    let bestScore = 0;

    for (const raw of payload) {
        const cand = raw as LrclibCandidate;
        if (!cand?.trackName) continue;

        // An instrumental has no words to show.
        if (cand.instrumental) continue;

        // Reject variants by raw title before scoring. This is the remix guard,
        // and it is not reversible by normalization.
        if (isVariantTitle(cand.trackName)) continue;

        if (!cand.plainLyrics && !cand.syncedLyrics) continue;

        const score = scoreCandidate(query, cand);
        if (score < CANDIDATE_FLOOR) continue;

        if (score > bestScore) {
            bestScore = score;
            best = { cand, score };
        }
    }

    if (!best || bestScore < ACCEPT_THRESHOLD) return null;

    const { cand } = best;
    const synced = parseLrc(cand.syncedLyrics || '');
    const plain = cand.plainLyrics?.trim() || undefined;

    // Both fields empty means the "match" carried no text.
    if (!plain && !isUsableTimeline(synced)) return null;

    return { plain, synced: isUsableTimeline(synced) ? synced : undefined, provider: 'lrclib', score: bestScore };
}
