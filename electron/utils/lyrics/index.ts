/**
 * Lyrics orchestrator: one track in, a best-effort combined result out.
 *
 * The two providers are fully independent. Each has its own timeout, and a
 * failure in one never suppresses the other - NetEase being unreachable still
 * leaves LRCLIB's plain and line-synced lyrics intact, and vice versa. That is
 * the reason for running them concurrently rather than in sequence: a hung
 * provider costs its own budget and nothing else.
 *
 * The other rule is that `null` means "render nothing". There is no empty
 * success: if neither provider produced readable lyrics the result is `null`,
 * and the panel is never mounted. Wrong lyrics are worse than no lyrics.
 */

import type { LyricsResult, LyricsQuery } from './types';
import { isEmpty } from './types';
import { fetchLrclib } from './lrclib';
import { fetchNetease } from './netease';
import { normalizeTitle, normalizeArtist, titleCandidates, titleCredits } from './normalize';
import { displayTitle, displayArtist } from './format';

/** Per-provider budget. A hung provider must not stall the download panel. */
const PROVIDER_TIMEOUT_MS = 5000;

/** `lyricsHandler` caps the whole IPC call at 12s, so stop looking before that. */
const ATTEMPT_BUDGET_MS = 9_000;

/**
 * Upper bound on provider round trips for one track.
 *
 * Each attempt costs two concurrent HTTP calls, so this is a latency ceiling as
 * much as a correctness one. Real titles resolve on the first attempt; the
 * budget is only spent by the uploads whose title and artist are both noisy.
 */
const MAX_ATTEMPTS = 6;

/**
 * The (title, artist) pairs to try, in order.
 *
 * The supplied metadata is always tried first, unchanged, so nothing that
 * already matched can regress. Only then are the title's own credits used, which
 * are frequently better than the channel-derived artist.
 */
function buildAttempts(query: LyricsQuery, artist: string, credits: string) {
    const titles = titleCandidates(query.title);
    if (!titles.length || !artist) return [];

    const artists = credits && credits !== artist ? [artist, credits] : [artist];
    const attempts: Array<{ title: string; artist: string }> = [];

    for (const title of titles) {
        for (const a of artists) attempts.push({ title, artist: a });
    }

    return attempts.slice(0, MAX_ATTEMPTS);
}

/**
 * Look up lyrics for one track.
 *
 * Never throws. Every failure path resolves to `null`, because the caller is a
 * renderer asking a question it is happy to get no answer to.
 */
export async function getLyrics(query: LyricsQuery): Promise<LyricsResult | null> {
    const artist = normalizeArtist(query.artist);
    const attempts = buildAttempts(query, artist, titleCredits(query.title));
    if (!attempts.length) return null;

    const startedAt = Date.now();

    for (const attempt of attempts) {
        // Retries are a bonus, never a reason to overrun the caller's budget.
        if (Date.now() - startedAt > ATTEMPT_BUDGET_MS) return null;

        const normalized: LyricsQuery = {
            title: attempt.title,
            artist: attempt.artist,
            duration: query.duration
        };

        const [lrclib, netease] = await Promise.all([
            fetchLrclib(normalized, PROVIDER_TIMEOUT_MS).catch(() => null),
            fetchNetease(normalized, PROVIDER_TIMEOUT_MS).catch(() => null)
        ]);

        // `title`/`artist` below are the strings that *matched*, which is what
        // makes the result reproducible. `displayTitle`/`displayArtist` are what
        // a person should read, derived from the caller's original metadata
        // rather than the candidate - a renderer's header must never show
        // "Ae Ajnabee (Official Music Video) - Aditya Rikhari, Ravator | Coke
        // Studio Bharat".
        const result: LyricsResult = {
            title: attempt.title,
            artist: attempt.artist,
            displayTitle: displayTitle(query.title, query.artist),
            displayArtist: displayArtist(query.artist),
            duration: query.duration,
            sources: {}
        };

        if (lrclib) {
            if (lrclib.plain) {
                result.plain = lrclib.plain;
                result.sources.plain = 'lrclib';
            }
            if (lrclib.synced) {
                result.synced = lrclib.synced;
                result.sources.synced = 'lrclib';
            }
        }

        if (netease) {
            if (netease.words) {
                result.words = netease.words;
                result.sources.words = 'netease';
            }
            if (netease.translation) {
                result.translation = netease.translation;
                result.sources.translation = 'netease';
            }
        }

        // Nothing readable: fall through and try a cleaner title or artist.
        if (isEmpty(result)) continue;

        return result;
    }

    // Nothing readable from any attempt: report no result at all.
    return null;
}
