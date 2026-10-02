/**
 * Log-safe versions of things that should not be logged verbatim.
 *
 * Media URLs are not anonymous. A YouTube watch URL can carry a `sig`/`lsig`
 * signature and a `si` tracking id that are unique per visitor, an Instagram
 * story URL is the handle plus the story id (i.e. whose story it is), and a
 * Facebook URL can carry an access token. Every one of those ends up in a log
 * line when an extraction fails, and those lines get pasted into an issue.
 * So the URL is reduced to what is needed to tell two failures apart: the site,
 * the path shape, and the parameters that identify *which* video - never the
 * values that identify *who* is looking.
 */

/**
 * Parameters worth keeping: they select the content and carry no identity.
 * Everything else, including anything unknown, is dropped.
 */
const SAFE_QUERY_KEYS = new Set(['v', 'list', 'index', 't', 'start', 'end', 'p', 'repost_id', 'igsh']);

const MAX_LENGTH = 160;

/**
 * Reduce a URL to something safe to write to a log.
 *
 * Falls back to the text before the first `?` when the string will not parse as
 * a URL, so a malformed input never causes this helper to throw on the failure
 * path it exists to protect.
 */
export function redactUrlForLog(value: unknown): string {
    if (typeof value !== 'string' || !value) return '[empty url]';

    let parsed: URL;
    try {
        parsed = new URL(value.trim());
    } catch {
        const cut = value.split('?')[0];
        return truncate(cut);
    }

    const kept: string[] = [];
    for (const [key, val] of parsed.searchParams) {
        if (!SAFE_QUERY_KEYS.has(key.toLowerCase())) continue;
        kept.push(`${key}=${truncate(val, 40)}`);
    }

    const query = kept.length ? `?${kept.join('&')}` : '';
    const path = parsed.pathname.replace(/\/+$/, '');
    return truncate(`${parsed.host}${path}${query}`);
}

function truncate(text: string, max = MAX_LENGTH): string {
    return text.length > max ? `${text.slice(0, max)}...` : text;
}
