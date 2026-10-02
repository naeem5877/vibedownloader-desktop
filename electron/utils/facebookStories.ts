import { defaultUserAgent } from './platform';

/**
 * Facebook Stories.
 *
 * yt-dlp has no `facebook:story` extractor, so the page is fetched and read
 * directly. Facebook serves the story's own media in the HTML of the permalink,
 * which is why this is a scraper and not an API client - and why the request
 * has to look exactly like a browser's, because Facebook decides between "here
 * is the story" and "error" purely on that.
 *
 * The header that matters is `Sec-Fetch-Site`. Verified against a live story
 * with a real session cookie: without it Facebook answers **HTTP 400** with a
 * 1.5KB error page and no media, and with it the same URL answers **200** with
 * ~1.8MB containing the video. `Accept`, the user-agent version and `Referer`
 * were each varied independently and changed nothing. This looks like a
 * redundant browser header, so it is the obvious thing for someone to delete as
 * cleanup - do not; deleting it silently breaks every story fetch.
 *
 * An earlier note in `stories.md` concluded that stories were unreachable from
 * this app because `www.facebook.com` returns 400 even with a valid session.
 * That was this header, not an IP or reputation problem: no proxy is needed and
 * no GraphQL `doc_id` is involved. See `scripts/test-facebook-stories.cjs`.
 */

/** Story permalinks, plus the tray form some people copy instead. */
const STORY_PATH = /facebook\.com\/stories\//;
const STORY_FBID_PATH = /facebook\.com\/(?:permalink|story)\.php\?(?:[^#]*&)?story_fbid=(\d+)/;
/**
 * The tray viewer: `story_tray/?bucket_id=<page>&story_fbid=<story>`. Facebook
 * serves this one client-side, so it carries no media in the HTML - but it names
 * both ids, which is enough to ask for the permalink instead.
 */
const STORY_TRAY_PATH = /facebook\.com\/story_tray\/\?[^#]*story_fbid=(\d+)/;
const STORY_TRAY_BUCKET = /[?&]bucket_id=(\d+)/;

export type FacebookStoryErrorKind =
    | 'no_cookies'
    | 'login_required'
    | 'http_error'
    | 'no_media';

export class FacebookStoryError extends Error {
    readonly kind: FacebookStoryErrorKind;
    /** HTTP status, when there was one. */
    readonly status?: number;

    constructor(kind: FacebookStoryErrorKind, message: string, status?: number) {
        super(message);
        this.name = 'FacebookStoryError';
        this.kind = kind;
        this.status = status;
    }
}

export interface FacebookStoryRef {
    /** Page or profile id the story belongs to. */
    pageId?: string;
    /**
     * The numeric story id, when it can be read. `UzpfSVNDOjExMTc3MjU4NDc0OTAxNDQ=`
     * is base64 for `S:_ISC:1117725847490144`, which is also the `story_fbid` of
     * the canonical `permalink.php` form.
     */
    storyFbId?: string;
    /** The base64 token as it appeared in the URL, when present. */
    token?: string;
}

/** True for the story forms this module can resolve. */
export function isFacebookStoryUrl(url: string): boolean {
    return STORY_PATH.test(url) || STORY_FBID_PATH.test(url) || STORY_TRAY_PATH.test(url);
}

/**
 * Pulls the ids out of whichever story URL form was pasted. Both are supported
 * because the permalink form is what Facebook itself hands out when a story is
 * shared, and it has no token in it at all.
 */
export function parseFacebookStoryUrl(url: string): FacebookStoryRef {
    const ref: FacebookStoryRef = {};

    const fbid = url.match(STORY_FBID_PATH);
    if (fbid) ref.storyFbId = fbid[1];

    const stories = url.match(/facebook\.com\/stories\/(\d+)(?:\/([^/?#]+))?/);
    if (stories) {
        ref.pageId = stories[1];
        if (stories[2]) {
            ref.token = decodeURIComponent(stories[2]);
            const decoded = decodeStoryToken(ref.token);
            if (decoded) ref.storyFbId = ref.storyFbId || decoded;
        }
    }

// A permalink carries the page id as `id=`, which is the only place it appears.
    const pageParam = url.match(/[?&]id=(\d+)/);
    if (pageParam) ref.pageId = ref.pageId || pageParam[1];

    // The tray names the same page as `bucket_id=`.
    const tray = url.match(STORY_TRAY_PATH);
    if (tray) {
        ref.storyFbId = ref.storyFbId || tray[1];
        const bucket = url.match(STORY_TRAY_BUCKET);
        if (bucket) ref.pageId = ref.pageId || bucket[1];
    }

    return ref;
}

/**
 * The canonical single-story URL for a reference.
 *
 * Only used for the tray form, whose own HTML carries no media. Exported because
 * the tray branch is the one part of this that could not be checked against a
 * live URL - no tray link was available - and it should be obvious in review
 * that this is a rewrite, not a second fetch path.
 */
export function canonicalStoryUrl(ref: FacebookStoryRef): string | null {
    if (!ref.storyFbId) return null;
    return `https://www.facebook.com/permalink.php?story_fbid=${ref.storyFbId}` +
        (ref.pageId ? `&id=${ref.pageId}` : '');
}

/** `UzpfSVNDOjExMTc3MjU4NDc0OTAxNDQ=` -> `1117725847490144`. Returns null if it is not that shape. */
export function decodeStoryToken(token: string): string | null {
    try {
        const decoded = Buffer.from(token, 'base64').toString('utf8');
        const digits = decoded.match(/(\d{6,})/);
        return digits ? digits[1] : null;
    } catch {
        return null;
    }
}

/**
 * Turns a Netscape cookies.txt into a `Cookie` header.
 *
 * Only the name and value are used, and only for the request being made. The
 * file is never sent anywhere else, and nothing from it reaches a log.
 */
export function cookieHeaderFromNetscape(text: string): string {
    const pairs: string[] = [];
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line) continue;

        // Netscape files mark HttpOnly cookies by prefixing the domain column
        // with `#HttpOnly_`. Every cookie that authenticates a Facebook session
        // is HttpOnly - `xs`, `c_user`, `datr` - and most cookie exporters write
        // that prefix. Reading it as a comment therefore discards the entire
        // session while leaving a file that looks perfectly valid, and the
        // failure surfaces as Facebook's login page rather than as a parse bug.
        // It is a comment marker in appearance only.
        const row = line.startsWith('#HttpOnly_') ? line.slice('#HttpOnly_'.length) : line;
        if (row.startsWith('#')) continue;

        const parts = row.split('\t');
        if (parts.length >= 7) {
            const name = parts[5].trim();
            const value = parts[6].trim();
            if (name) pairs.push(`${name}=${value}`);
        }
    }
    return pairs.join('; ');
}

export interface FacebookStoryMedia {
    /** Direct CDN URL of the story video. Signed, and short-lived by design. */
    mediaUrl: string;
    thumbnailUrl?: string;
    /** Whoever posted it, when the page says. */
    uploaderName?: string;
    ref: FacebookStoryRef;
}

/** FB serves the media escaped inside a JSON blob, so the raw match needs unescaping. */
function unescapeJsonString(raw: string): string {
    try {
        return JSON.parse(`"${raw}"`);
    } catch {
        return raw;
    }
}

function firstMatch(html: string, patterns: RegExp[]): string | null {
    for (const pattern of patterns) {
        const m = html.match(pattern);
        if (m?.[1]) return unescapeJsonString(m[1]);
    }
    return null;
}

/**
 * Fetches one story's media URL.
 *
 * `cookieHeader` is required. A story is not in logged-out HTML at all: the
 * anonymous request is redirected to `login.php`, which is a different failure
 * from this one and worth saying so rather than reporting a parse error.
 */
export async function fetchFacebookStory(url: string, cookieHeader: string): Promise<FacebookStoryMedia> {
    if (!cookieHeader) {
        throw new FacebookStoryError(
            'no_cookies',
            'Facebook needs your login cookies to show a story. Add them in Settings, then try again.'
        );
    }

    // The tray viewer is a client-side shell with no media in it, so ask for the
    // permalink that names the same story instead. Unverified against a live
    // tray link - none was available - but the alternative is yt-dlp, which has
    // no story extractor at all.
    let target = url;
    if (STORY_TRAY_PATH.test(url)) {
        const canonical = canonicalStoryUrl(parseFacebookStoryUrl(url));
        if (!canonical) {
            throw new FacebookStoryError(
                'no_media',
                'That Facebook story link does not say which story it is. Open the story itself and copy that link.'
            );
        }
        target = canonical;
    }

    const resp = await fetch(target, {
        headers: {
            'User-Agent': defaultUserAgent(),
            'Cookie': cookieHeader,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            // See the header note at the top of this file. Its absence turns every
            // story fetch into an HTTP 400 that looks like a cookie problem.
            'Sec-Fetch-Site': 'same-origin',
            'Referer': 'https://www.facebook.com/'
        },
        redirect: 'follow'
    });

    const html = await resp.text();

    // Being redirected to the login page means the cookies are stale or were
    // copied from a different browser profile. Saying "cookies" is the one thing
    // the user can act on, so it is worth detecting rather than inferring.
    if (resp.url.includes('login.php')) {
        throw new FacebookStoryError(
            'login_required',
            'Facebook sent us to its login page, so the saved cookies are no longer valid. Re-copy them from a browser where you are logged in to Facebook.'
        );
    }

    if (!resp.ok) {
        // Facebook's error page carries no explanation. The overwhelmingly usual
        // cause is the request shape, which is fixed in code above, so the message
        // names the cookie route rather than telling the user to go and re-copy
        // cookies that are already fine.
        throw new FacebookStoryError(
            'http_error',
            resp.status === 400
                ? 'Facebook refused the request (HTTP 400). This usually means the saved cookies are no longer valid - re-copy them in Settings.'
                : `Facebook returned HTTP ${resp.status}. Try again in a few minutes.`,
            resp.status
        );
    }

    // Quality order matters: the hd variants are the same bytes Facebook chose
    // for its own player. `browser_native_*` is the pair older scrapers look for
    // and Facebook no longer sends it, which is why `playable_url` is the one
    // that actually resolves.
    const mediaUrl = firstMatch(html, [
        /"browser_native_hd_url"\s*:\s*"([^"]+)"/,
        /"playable_url_quality_hd"\s*:\s*"([^"]+)"/,
        /"browser_native_sd_url"\s*:\s*"([^"]+)"/,
        /"playable_url"\s*:\s*"([^"]+)"/,
        /"video_url"\s*:\s*"([^"]{40,})"/
    ]);

    if (!mediaUrl) {
        throw new FacebookStoryError(
            'no_media',
            'Facebook served the page but no video was in it. The story has most likely expired - stories are removed after about 24 hours.',
            resp.status
        );
    }

    const thumbnailUrl = firstMatch(html, [
        /"preferred_thumbnail"\s*.*?"uri"\s*:\s*"([^"]+)"/,
        /"thumbnail_image"\s*.*?"uri"\s*:\s*"([^"]+)"/,
        /"story_thumbnail"\s*.*?"uri"\s*:\s*"([^"]+)"/
    ]);

    const uploaderName = firstMatch(html, [
        /"story_actor"\s*.*?"name"\s*:\s*"([^"]+)"/,
        /"actors"\s*:\s*\[\s*\{\s*"name"\s*:\s*"([^"]+)"/,
        /"owner"\s*:\s*\{[^{}]*"name"\s*:\s*"([^"]+)"/
    ]);

    return {
        mediaUrl,
        thumbnailUrl: thumbnailUrl || undefined,
        uploaderName: uploaderName || undefined,
        ref: parseFacebookStoryUrl(url)
    };
}

/**
 * The metadata shape the renderer expects for one resolved story.
 *
 * Lives here rather than in the handler because three of these fields are a
 * contract with the UI rather than with Facebook, and the two are easy to break
 * quietly:
 *
 *  - `webpage_url` is the CDN media URL. The single-video card's Download button
 *    resolves its target from this field, so if it is the story page instead, or
 *    missing, the card renders with no working download at all.
 *  - `singleStory` is what tells the renderer to show that card instead of the
 *    story tray. Without it the result comes back looking like a tray holding
 *    one item, full of Select All and Download All buttons that do nothing.
 *  - `formats` is empty on purpose: the media is already resolved, so there is
 *    nothing to choose between, and the card uses its emptiness to know it
 *    should offer one download rather than a quality list.
 */
export function buildFacebookStoryMetadata(story: FacebookStoryMedia) {
    // Facebook display names carry line breaks, and a two-line filename is a
    // filename nobody can type.
    const uploaderName = (story.uploaderName || 'Facebook').replace(/\s+/g, ' ').trim();
    const title = `Story by ${uploaderName}`;
    const storyId = story.ref.storyFbId || String(Date.now());

    return {
        id: `fb-story-${storyId}`,
        title,
        thumbnail: story.thumbnailUrl || '',
        uploader: uploaderName,
        uploader_url: 'https://facebook.com',
        view_count: 0,
        duration: 0,
        contentType: 'story' as const,
        singleStory: true,
        formats: [],
        webpage_url: story.mediaUrl,
        playlist_count: 1,
        entries: [
            {
                id: `fb-story-${storyId}`,
                title,
                thumbnail: story.thumbnailUrl || '',
                duration: 0,
                // The resolved CDN URL, not the page URL: this is what the
                // download button is handed, and a page URL would send the
                // user straight back to yt-dlp's "Unsupported URL".
                url: story.mediaUrl,
                ext: 'mp4'
            }
        ]
    };
}
