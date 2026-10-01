/**
 * How to ask YouTube for a video, in the order that actually works.
 *
 * The background: yt-dlp tries several "players" (web, tv, tv_embedded,
 * android_vr, ...) against the same video. `player_client` **pins** it to one.
 * Pinning is not free:
 *
 *  - It disables yt-dlp's automatic fallback. If the pinned client is refused,
 *    the request simply fails instead of trying the next one.
 *  - `tv_embedded` is the embed player. With no session it hits YouTube's login
 *    wall, and YouTube phrases that wall as "Sign in to confirm your age".
 *    That is why an ordinary public video would report an age-restricted error
 *    on some machines and download fine on others: it depends on whether
 *    YouTube serves that IP the embed player or the login wall.
 *
 * So: with cookies, pin `tv_embedded` (best format list, and it is the client
 * that honours an age-verified session). Without cookies, do **not** pin -
 * let yt-dlp use its own fallback, which is what handles public videos.
 * And when a pinned attempt fails, retry unpinned rather than reporting a
 * failure that a different client would not have had.
 */

/** Ordered candidates. `extractorArgs` is `null` for "do not pin". */
export interface YoutubeClientAttempt {
    label: string;
    extractorArgs: string[] | null;
}

const PINNED = 'youtube:player_client=tv_embedded';

/**
 * @param hasCookies  Whether a usable YouTube cookie file was found.
 */
export function youtubeClientAttempts(hasCookies: boolean): YoutubeClientAttempt[] {
    if (hasCookies) {
        return [
            { label: 'tv_embedded (with cookies)', extractorArgs: [PINNED] },
            // A pinned client that gets refused must not become a user-facing
            // failure while an unpinned request would have succeeded.
            { label: 'yt-dlp default fallback (with cookies)', extractorArgs: null }
        ];
    }

    return [
        // Unpinned first: this is the path that works for public videos and it
        // keeps yt-dlp's own fallback available.
        { label: 'yt-dlp default fallback (no cookies)', extractorArgs: null },
        // Second chance, in case the default players are all challenged here.
        { label: 'tv_embedded (no cookies)', extractorArgs: [PINNED] }
    ];
}

/**
 * The single best attempt, for callers that cannot retry.
 *
 * Used by the download path, where a retry would mean restarting a transfer
 * that may already be writing bytes to disk.
 */
export function preferredYoutubeClient(hasCookies: boolean): YoutubeClientAttempt {
    return youtubeClientAttempts(hasCookies)[0];
}

/**
 * True when retrying with a different player could plausibly help.
 *
 * Used to avoid a pointless second round trip: a genuinely missing or private
 * video fails the same way on every client.
 */
export function isClientSensitiveError(rawError: unknown): boolean {
    const text = typeof rawError === 'string' ? rawError : (rawError as Error)?.message ?? '';
    const s = String(text);
    return /confirm your age|confirm you'?re not a bot|not a bot|age[- ]restricted|age[- ]gated|sign in to confirm|requested format is not available|unable to extract|failed to extract any player response|http error 4(?:03|29|1\d\d)|login required/i.test(s);
}