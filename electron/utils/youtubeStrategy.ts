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
 *
 * Failing is only half the story. A player can also be *refused quietly*: exit
 * code 0, valid JSON, and three 360p streams. That is the shape of an unsolved
 * JS challenge, and it is why "some users get 320p while others get 1080p" -
 * the app accepted the first reply it got. So an attempt is also judged on what
 * it returned (`inspectFormats`), and a list that is too thin to be a real answer
 * earns one retry from the next client (`isDegradedFormatList`).
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
 *
 * Pass stderr alongside the message when there is one. yt-dlp puts the reason a
 * player was refused on stderr and often leaves `message` as a generic
 * "ERROR: unable to extract video data", so classifying on the message alone
 * throws away the only text that says *which* wall was hit.
 */
export function isClientSensitiveError(rawError: unknown): boolean {
    const text = typeof rawError === 'string' ? rawError : (rawError as Error)?.message ?? '';
    const stderr = (rawError as { stderr?: unknown })?.stderr;
    const s = `${text}\n${typeof stderr === 'string' ? stderr : ''}`;
    return /confirm your age|confirm you'?re not a bot|not a bot|age[- ]restricted|age[- ]gated|sign in to confirm|requested format is not available|unable to extract|failed to extract any player response|http error 4(?:03|29|1\d\d)|login required/i.test(s);
}

/** What one extraction attempt actually came back with. */
export interface FormatInspection {
    formatCount: number;
    videoFormatCount: number;
    audioFormatCount: number;
    maxHeight: number;
    /** Distinct video heights, highest first. */
    heights: number[];
    hasVideo: boolean;
    hasAudio: boolean;
}

function toHeight(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Measure a `--dump-single-json` payload.
 *
 * Needed because "the request succeeded" and "the request returned the formats
 * you asked for" are different claims. A player that is served a degraded
 * response (challenge not solved, throttled, wrong client pairing) exits 0 with
 * a short format list, so the retry logic - which only looked at errors - walked
 * away with 320p and reported success. See `isDegradedFormatList`.
 */
export function inspectFormats(raw: unknown): FormatInspection {
    const formats = Array.isArray((raw as { formats?: unknown })?.formats)
        ? ((raw as { formats: unknown[] }).formats as Record<string, unknown>[])
        : [];

    const video = formats.filter(
        (f) => Boolean(f.vcodec) && f.vcodec !== 'none' && toHeight(f.height) > 0
    );
    const audio = formats.filter(
        (f) => Boolean(f.acodec) && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none')
    );

    const heights = [...new Set(video.map((f) => toHeight(f.height)))].sort((a, b) => b - a);

    return {
        formatCount: formats.length,
        videoFormatCount: video.length,
        audioFormatCount: audio.length,
        maxHeight: heights[0] ?? 0,
        heights,
        hasVideo: video.length > 0,
        hasAudio: audio.length > 0
    };
}

/**
 * True when a *successful* extraction returned a format list thin enough that a
 * different player is worth one more try.
 *
 * Deliberately narrow. The tempting rule - "retry unless we got 1080p" - is
 * wrong: plenty of real videos top out at 720p, or at 480p, and retrying them
 * doubles the wait on every fetch for nothing. These are instead the shapes a
 * refused or unsolved player actually produces:
 *
 *  - no formats at all;
 *  - one or two video streams, all 360p or lower, which is what YouTube serves
 *    when the JS challenge was not solved;
 *  - video streams with no audio-only stream, which means any `bestaudio`
 *    request will fail at download time rather than at extraction time.
 *
 * `maxHeight` below 1080 is on its own never a trigger.
 */
export function isDegradedFormatList(insp: FormatInspection): boolean {
    if (insp.formatCount === 0) return true;
    if (insp.videoFormatCount > 0 && insp.maxHeight <= 360 && insp.videoFormatCount <= 3) return true;
    if (insp.videoFormatCount > 0 && insp.audioFormatCount === 0) return true;
    return false;
}

/** One-line form for logs. */
export function formatSummary(insp: FormatInspection): string {
    if (!insp.formatCount) return 'no formats returned';
    const heights = insp.heights.length ? insp.heights.join('/') : 'audio only';
    return `${insp.formatCount} formats, max ${insp.maxHeight || '?'}p (${heights}), ${insp.audioFormatCount} audio`;
}