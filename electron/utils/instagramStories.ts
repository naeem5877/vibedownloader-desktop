/**
 * Instagram Stories via the ProfileQuery resolver.
 *
 * ## Why a third-party resolver at all
 *
 * Instagram serves no story data to anonymous clients. Every mechanism that
 * used to - the page HTML, the embed endpoint, `api/v1/users/web_profile_info`,
 * the GraphQL profile query - now returns a login wall, a 429, or a bare JS
 * shell. See `stories.md` for the full evidence trail. The two survivors are:
 *
 * 1. **yt-dlp + the user's own cookie.** Free and private, but requires a login.
 * 2. **A paid resolver API.** Costs credits, needs no login.
 *
 * This module implements (2) so stories work without asking anyone to hand over
 * an Instagram session. It is deliberately a plain HTTP client: nothing
 * third-party is vendored or bundled, so there is no licensing question, and
 * the app can drop the provider by deleting this file.
 *
 * ## The contract, verified live rather than trusted
 *
 * Both facts below were confirmed by probing the live service, and both are
 * things search results and blog posts get wrong:
 *
 * - **`api.instagramapi.dev` is dead.** It answers `HTTP 410` with
 *   `{"error":{"code":"domain_moved"}}` and points at `api.profilequery.com`.
 *   The docs *website* still renders under the old host and stale posts still
 *   quote it, so a base URL copied from a search result fails at runtime.
 * - **Auth is `Authorization: Bearer <key>`.** The documented alternative is an
 *   `x-api-key` header; a `?api_key=` **query parameter is ignored** and fails
 *   with `missing_api_key`, which would leak the key into logs if it worked.
 *
 * Response shape is `data.items[]` - not `data.stories`, not a bare array.
 * `type` is the string `"photo"` or `"video"` (not `1`/`2`), and `id` is a
 * 19-digit **string** that exceeds `Number.MAX_SAFE_INTEGER`, so it must never
 * be parsed as a number.
 *
 * ## Two behaviours that cost money if ignored
 *
 * - **A 404 is billed.** A private or nonexistent account is a real lookup on
 *   the provider's side, so it burns credits *and* returns nothing. Nothing is
 *   ever retried on 404, and the handle is validated locally first.
 * - **Every call costs 2 credits.** A 50-credit free trial is only 25 lookups.
 *   Hence `CACHE_TTL_MS` below: without it, every re-render of the download
 *   panel would spend the user's money.
 */

/** One story as the resolver reports it. Field names are theirs, not ours. */
export interface ResolverStoryItem {
    /** 19-digit id, as a string. Never parse this as a number. */
    id: string;
    shortcode?: string;
    /** `"photo"` or `"video"`. */
    type: string;
    taken_at?: string;
    /** Cover frame for video, the image itself for a photo. */
    image_url?: string;
    /** `null` for photos. */
    video_url?: string | null;
    /** Seconds, float. `null` for photos. */
    video_duration?: number | null;
}

/** A story normalized into the shape the download panel consumes. */
export interface NormalizedStory {
    id: string;
    title: string;
    thumbnail: string;
    url: string;
    isIGStoryImage: boolean;
    ext: 'jpg' | 'mp4';
    /** Seconds. Photo stories have none, so this is undefined rather than 0. */
    duration?: number;
    takenAt?: string;
}

/**
 * The live base URL.
 *
 * `api.instagramapi.dev` is retained only in `DEAD_HOSTS` so a stale key in
 * someone's config produces an explicit message instead of a bare 410.
 */
const BASE_URL = 'https://api.profilequery.com/v1';
const STORIES_PATH = '/profile/stories';

/** Hostnames that used to serve this API and now only answer 410. */
export const DEAD_HOSTS = ['api.instagramapi.dev'];

/**
 * How long one tray is reused.
 *
 * Stories live for 24h, so 10 minutes is invisible to the user and cuts the
 * credit cost of repeatedly re-opening the same profile by ~as much as the
 * panel is re-rendered. A *different* story id or a *newer* request bypasses it.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;

/** Provider calls are billed; give up rather than hang the panel. */
const REQUEST_TIMEOUT_MS = 12_000;

/** Why a stories lookup failed, in terms the UI can act on. */
export type StoryErrorKind =
    | 'no_api_key'
    | 'invalid_api_key'
    | 'out_of_credits'
    | 'not_found'
    | 'upstream'
    | 'bad_response'
    | 'no_stories';

export class StoryError extends Error {
    readonly kind: StoryErrorKind;

    constructor(kind: StoryErrorKind, message: string) {
        super(message);
        this.name = 'StoryError';
        this.kind = kind;
    }
}

/**
 * Split an Instagram Stories URL into the handle and any story id.
 *
 * Accepts every shape the app has to survive:
 * - `/stories/<handle>/`
 * - `/stories/<handle>/<id>/`
 * - `/stories/<handle>` with no trailing slash
 * - `/story/<handle>/...` (the legacy spelling the old code also matched)
 * - full URLs and bare handles, since the resolver accepts a handle directly
 *
 * The id is returned as a string and compared loosely, because a story URL
 * carries a **shortcode** (`Dd6UTAgE91A`) while the resolver's `id` is the
 * 19-digit pk - and `shortcode` is a separate field again. Callers match
 * against either.
 */
export function parseStoryUrl(raw: string): { handle: string; storyId?: string } | null {
    const value = (raw || '').trim();
    if (!value) return null;

    // A bare handle is a valid resolver target. Instagram usernames may contain
    // dots, so this is matched against the handle pattern rather than guessed
    // from the absence of a dot.
    if (BARE_HANDLE.test(value.replace(/^@/, ''))) {
        return { handle: value.replace(/^@/, '') };
    }

    // Strip query and hash, then any host prefix.
    let path = value.split('?')[0].split('#')[0];
    const match = path.match(/\/(?:stories|story)\/([^/?#]+)(?:\/([^/?#]+))?/i);
    if (match) {
        return { handle: match[1], storyId: match[2] };
    }

    // `instagram.com/handle` with no `/stories/` segment.
    const bare = path.match(/instagram\.com\/([^/?#]+)/i);
    if (bare && !RESERVED_SEGMENTS.includes(bare[1].toLowerCase())) {
        return { handle: bare[1] };
    }

    return null;
}

/**
 * True for a URL this module can attempt.
 *
 * Deliberately narrow: only story URLs reach the paid resolver. Posts and reels
 * must keep working anonymously through yt-dlp, and sending them here would
 * spend credits on something already handled.
 */
export function isStoryUrl(url: string): boolean {
    return Boolean(parseStoryUrl(url)) && /\/(?:stories|story)\//i.test(url || '');
}

/** Instagram usernames: letters, digits, dot and underscore, up to 30 chars. */
const BARE_HANDLE = /^[a-z0-9._]{1,30}$/i;

/**
 * Path segments Instagram uses for non-profile pages.
 *
 * `instagram.com/p/<code>` is a post and `instagram.com/reel/<code>` is a reel.
 * Both already extract anonymously through yt-dlp, so treating their leading
 * segment as a handle would send a post to the paid story resolver.
 */
const RESERVED_SEGMENTS = ['stories', 'story', 'reel', 'reels', 'p', 'tv', 'explore', 'direct', 'accounts'];

/**
 * Recognise the Instagram shapes this module can attempt.
 *
 * Handles both a full stories URL and a bare profile page:
 * - `instagram.com/stories/nike/123` - a specific story
 * - `instagram.com/nike` - a profile page
 *
 * A pasted bare handle (`nike`) is expanded by the renderer *before* this runs,
 * because only the renderer knows which platform tab was selected. Expanding it
 * here instead would be a trap: with no platform signal, `dQw4w9WgXcQ` is a
 * perfectly good YouTube id and would be silently read as an Instagram handle.
 *
 * Returns the original string untouched when the input is not an Instagram
 * story request, so callers can use the result unconditionally.
 */
export function normalizeStoryInput(raw: string): { url: string; isStoryRequest: boolean } {
    const value = (raw || '').trim();
    if (!value) return { url: value, isStoryRequest: false };

    const path = value.split('?')[0].split('#')[0];

    // Any full Instagram or instagr.am URL.
    const match = path.match(/^(?:https?:\/\/)?(?:www\.)?(?:instagram\.com|instagr\.am)\/(.+)/i);
    if (!match) return { url: value, isStoryRequest: false };

    // A stories URL is unambiguous.
    if (/^(?:stories|story)\//i.test(match[1])) {
        return { url: value, isStoryRequest: true };
    }

    // Otherwise the first segment is a profile handle - but only if it is not one
    // of Instagram's non-profile pages. Posts and reels already extract
    // anonymously through yt-dlp, so sending them here would spend credits.
    const segment = match[1].split('/')[0];
    const isProfile = Boolean(segment) && !RESERVED_SEGMENTS.includes(segment.toLowerCase());
    return { url: value, isStoryRequest: isProfile };
}

/**
 * A handle the provider will accept, checked before spending credits.
 *
 * The provider 404s - and bills - for a handle that is not a plain username.
 * Rejecting the obvious junk locally keeps a stray paste from costing the user.
 */
export function isPlausibleHandle(handle: string): boolean {
    return /^[a-z0-9._]{1,30}$/i.test((handle || '').trim());
}

/** One cached tray, keyed by handle. */
interface CacheEntry {
    items: ResolverStoryItem[];
    expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Test seam: drops cached trays so a test cannot read another's result. */
export function clearStoryCache(): void {
    cache.clear();
}

/**
 * Fetch one account's active stories.
 *
 * Throws `StoryError`, never a raw network error, so the caller can map the
 * failure to a message without string-matching an HTTP status.
 */
export async function fetchStoriesRaw(
    handle: string,
    apiKey: string,
    now: number = Date.now()
): Promise<ResolverStoryItem[]> {
    const cleanHandle = (handle || '').trim();
    const key = (apiKey || '').trim();

    if (!key) {
        throw new StoryError('no_api_key', 'Add an Instagram Stories API key in Settings to read stories.');
    }
    if (DEAD_HOSTS.some((h) => key.startsWith(h))) {
        throw new StoryError('invalid_api_key', 'That key is for the retired api.instagramapi.dev host. Use a ProfileQuery key.');
    }
    if (!isPlausibleHandle(cleanHandle)) {
        throw new StoryError('not_found', `"${cleanHandle}" is not a valid Instagram username.`);
    }

    const cached = cache.get(cleanHandle.toLowerCase());
    if (cached && cached.expiresAt > now) return cached.items;

    let res: Response;
    try {
        res = await fetch(`${BASE_URL}${STORIES_PATH}?handle=${encodeURIComponent(cleanHandle)}`, {
            headers: {
                Authorization: `Bearer ${key}`,
                Accept: 'application/json'
            },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
    } catch (e: any) {
        // A timeout or DNS failure is transient and was not billed.
        throw new StoryError('upstream', `Could not reach the Instagram Stories service: ${e?.message || 'network error'}`);
    }

    let body: any = null;
    try {
        body = await res.json();
    } catch {
        throw new StoryError('bad_response', 'The Instagram Stories service returned an unreadable response.');
    }

    const code = body?.error?.code;

    if (!res.ok) {
        if (res.status === 401) {
            throw new StoryError(
                code === 'missing_api_key' ? 'no_api_key' : 'invalid_api_key',
                code === 'missing_api_key'
                    ? 'The Instagram Stories API key is missing. Add it in Settings.'
                    : 'That Instagram Stories API key is invalid or has been revoked.'
            );
        }
        if (res.status === 402) {
            throw new StoryError('out_of_credits', 'The Instagram Stories service reports no credits left.');
        }
        if (res.status === 404) {
            // Billed. Never retried.
            const reason = body?.error?.reason;
            const detail = reason === 'private_account'
                ? 'That account is private, which the Stories service cannot read.'
                : 'No stories were found for that account.';
            throw new StoryError('not_found', detail);
        }
        if (res.status === 400) {
            throw new StoryError('not_found', 'The Stories service rejected that username.');
        }
        // 502/504 are explicitly safe to retry upstream; we surface them as-is.
        throw new StoryError('upstream', `The Instagram Stories service failed (HTTP ${res.status}).`);
    }

    // 200 with an empty list means "no active stories", which is a valid answer
    // and not an error - the panel simply shows nothing.
    const items: ResolverStoryItem[] = Array.isArray(body?.data?.items) ? body.data.items : [];

    cache.set(cleanHandle.toLowerCase(), { items, expiresAt: now + CACHE_TTL_MS });
    return items;
}

/**
 * Normalize one resolver item into the shape the panel renders.
 *
 * A photo has no `video_url` and no `video_duration`, so its duration is left
 * undefined rather than defaulted - the progress UI keys off that, and a photo
 * story must not show a fake 15-second bar.
 */
export function normalizeStoryItem(item: ResolverStoryItem, index: number): NormalizedStory | null {
    const isVideo = item?.type === 'video';
    const url = isVideo ? item.video_url : item.image_url;
    if (!url) return null;

    const id = item.id ? String(item.id) : `story-${index}`;
    const duration = typeof item.video_duration === 'number' && item.video_duration > 0
        ? item.video_duration
        : undefined;

    return {
        id,
        title: item.shortcode ? `Story ${item.shortcode}` : `Story ${index + 1}`,
        // There is no thumbnail field; the cover frame is the thumbnail.
        thumbnail: item.image_url || url,
        url,
        isIGStoryImage: !isVideo,
        ext: isVideo ? 'mp4' : 'jpg',
        duration,
        takenAt: item.taken_at
    };
}

/**
 * Fetch and normalize one account's active stories.
 *
 * `storyId` filters the tray client-side, because the resolver has no
 * per-story endpoint. The previous `insta-fetcher` implementation discarded the
 * id from the URL and always returned the whole tray, so a link to one story
 * silently downloaded all of them.
 */
export async function fetchStories(
    handle: string,
    apiKey: string,
    storyId?: string
): Promise<NormalizedStory[]> {
    const items = await fetchStoriesRaw(handle, apiKey);
    if (!items.length) {
        throw new StoryError('no_stories', `No active stories for @${handle} right now.`);
    }

    let selected = items;

    if (storyId) {
        // A story URL carries a shortcode, the resolver's `id` is the pk, and
        // `shortcode` repeats the URL token - so all three are compared.
        const wanted = storyId.trim().toLowerCase();
        selected = items.filter((it) =>
            String(it.id).toLowerCase() === wanted ||
            (it.shortcode || '').toLowerCase() === wanted
        );

        if (!selected.length) {
            throw new StoryError(
                'not_found',
                'That specific story has expired. Stories only live for 24 hours.'
            );
        }
    }

    return selected
        .map((item, i) => normalizeStoryItem(item, i))
        .filter((s): s is NormalizedStory => s !== null);
}