/**
 * Turns a raw yt-dlp failure into a message a user can act on.
 *
 * Why this exists: yt-dlp-wrap rejects with an Error whose message is the
 * *whole invocation* ("Command failed: <exe> <our flags...>") followed by
 * yt-dlp's own output. That command line always contains the flags we pass,
 * so matching with plain substrings hits the wrong thing constantly - most
 * famously `includes('age')` is true for "--user-agent", which made every
 * platform failure (Twitter, Pinterest, a typo'd URL, DRM, ...) report
 * "Age-restricted content".
 *
 * So we classify on yt-dlp's actual output lines and match real phrases
 * instead of loose fragments.
 */

/**
 * yt-dlp output lines, with the invocation echoed back by yt-dlp-wrap removed.
 *
 * The invocation is the trouble: it always contains the flags we pass, so
 * "--socket-timeout" would read as a timeout and "--user-agent" contains
 * "age". Some yt-dlp-wrap versions prefix it ("Error code: Error: Command
 * failed: ..."), so the line is matched anywhere rather than by its start.
 *
 * Flag names are then stripped from what remains as a second line of defence,
 * in case an invocation is embedded in a line we do not recognise.
 */
export function extractYtdlpOutput(raw: string): string {
    return String(raw ?? '')
        .split(/\r?\n/)
        .filter((line) => !/Command failed:/i.test(line))
        .filter((line) => !/^\s*(?:Stderr|Stdout):\s*$/i.test(line))
        .filter((line) => !/^\s*at\s/.test(line))
        .map((line) => line.replace(/^\s*Error code:\s*/i, ''))
        .map((line) => line.replace(/--[a-z][a-z-]*/gi, ' '))
        .join('\n');
}

/**
 * YouTube's anti-bot wall. Almost never a bad URL: it means the local yt-dlp
 * is stale or the IP is being challenged, so an update is usually the fix.
 * Checked first - some of these strings would otherwise match later rules.
 */
const BOT_CHECK = /confirm (?:you'?re|you are) not a bot|not a bot|requested format is not available|http error 429|too many requests|unable to extract video data|failed to extract any player response/i;

/**
 * Ordered most specific to most general; the first hit wins. Keep the order:
 * e.g. "Private video. Sign in if you've been granted access" should read as
 * private, not as a generic login prompt, and a DRM complaint mentions a
 * "site" but is really a "this link can't be downloaded" case.
 */
const RULES: Array<{ kind: string; test: RegExp; message: string }> = [
    {
        kind: 'drm',
        test: /\[\s*drm\s*\]|known to use DRM|drm[- ]protected/i,
        message: 'This stream is DRM-protected and cannot be downloaded. For Spotify, paste the link into the Spotify search box so the app can use the official audio source.'
    },
    {
        kind: 'private',
        test: /private video|video is private|post is private|account is private|is private|members[- ]only|only available to members|group is private/i,
        message: '🔒 This content is private, so it can only be downloaded by the account that owns it. Add cookies in Settings if it is your own post.'
    },
    {
        kind: 'unavailable',
        test: /video unavailable|content is unavailable|this (?:post|video|tweet) is unavailable|has been removed|no longer available|has been deleted|account (?:was )?deleted|post not (?:found|available)/i,
        message: '❌ This content is unavailable or has been removed by the uploader.'
    },
    {
        kind: 'no-media',
        test: /no video could be found|no video formats? found|no (?:video )?formats? found|only images?|image(?:s)? only|no suitable extractor|no media (?:found|available)/i,
        message: '🖼️ No downloadable video was found at this link. It is probably an image-only or audio-only post - audio posts are not supported yet.'
    },
    {
        kind: 'age',
        // Must precede `login`: YouTube phrases this as "Sign in to confirm
        // your age", which would otherwise be reported as a login problem.
        test: /confirm your age|confirm you'?re (?:over|old enough)|age[- ]restricted|age[- ]gated|inappropriate for some users|verify your age|sensitive content/i,
        message: '🔞 Age-restricted content. Add cookies in Settings, or open it in a logged-in browser first.'
    },
    {
        kind: 'login',
        test: /\blog ?in\b|\bsign ?in\b|\blogin\b|authentication|authori[sz]e|cookies? (?:are )?(?:required|needed)|use --cookies|account required/i,
        message: '🔒 This content needs a logged-in account. Add cookies for that site in Settings and try again.'
    },
    {
        kind: 'region',
        test: /blocked it in your country|not (?:made this video )?available in your country|geo[- ]restricted|geo[- ]blocked|blocked in your country|not available from your location|geo blocked/i,
        message: '🌍 This content is blocked in your region.'
    },
    {
        kind: 'not-found',
        test: /\b404\b|not found|no longer exists/i,
        message: '🔍 This link could not be found. It may have been deleted, or the link may be incomplete.'
    },
    {
        kind: 'parse',
        test: /cannot parse data|unable to parse|failed to extract|unable to extract .*metadata|json (?:metadata )?(?:is )?(?:invalid|not)|malformed|invalid json/i,
        message: '⚠️ The downloader could not read this page. Instagram, Facebook and X usually need cookies; if cookies are already added, the site layout has likely changed and the app should update itself.'
    },
    {
        kind: 'forbidden',
        test: /\b403\b|forbidden|access denied/i,
        message: '🚫 The site refused this request (403). Adding cookies for that site in Settings usually resolves it.'
    },
    {
        kind: 'timeout',
        test: /timed out|timeout|request timeout|read timed out/i,
        message: '⏱️ Request timed out. Please try again.'
    },
    {
        kind: 'network',
        test: /unable to connect|connection (?:reset|aborted|refused|error|timed out)|\bnetwork\b|dns|getaddrinfo|name resolution|could not resolve host|temporary failure in name resolution|unreachable|ssl|proxy/i,
        message: '📶 Network error. Check your internet connection or VPN and try again.'
    },
    {
        kind: 'unsupported',
        test: /unsupported url|is not a valid url|invalid url|no suitable extractor found/i,
        message: '❌ This link is not supported by the downloader.'
    }
];

const FALLBACK = '⚠️ Could not read this link. If it is your own post, try adding cookies in Settings; otherwise updating the app may help.';

export interface ExtractedError {
    /** Message safe to show in the UI. */
    message: string;
    /** Stable id for tests/logging, e.g. 'private', 'network', 'unknown'. */
    kind: string;
    /** True when a stale yt-dlp is the likely cause and an update should run. */
    suggestYtDlpUpdate: boolean;
}

/**
 * What we already tried, so the message can stop repeating useless advice.
 *
 * "Add cookies in Settings" is the right advice for a genuinely age-gated
 * video, and useless noise when the user already added cookies and it still
 * failed. YouTube serves that same wall to anonymous requests (the embed
 * player asking for an age-verified session), which is how a public video
 * ended up reporting an age error on one machine and downloading fine on
 * another.
 */
export interface ErrorContext {
    /** A usable cookie file for this platform was passed to yt-dlp. */
    hasCookies?: boolean;
}

/**
 * Rewrites the age/login answers once we know cookies were not the fix.
 *
 * Kept separate from the rule table on purpose: the underlying classification
 * is right ("this hit a login/age wall"), only the advice was wrong.
 */
function contextualize(kind: string, message: string, ctx: ErrorContext): string {
    if (!ctx.hasCookies) return message;

    if (kind === 'age') {
        return '⚠️ YouTube refused this video and asked for an age check. Cookies were already sent, so the age gate itself is not the problem - this is YouTube\'s bot protection on your network, or the video was restricted after you added cookies. Try again shortly, use a different network/VPN, or update the app.';
    }
    if (kind === 'login') {
        return '⚠️ YouTube asked for a signed-in session even though cookies were sent. Those cookies are most likely expired or copied from a different browser than the one they were exported from. Export a fresh cookies.txt and add it again.';
    }
    return message;
}

/**
 * @param rawError  The Error message / stderr straight from the yt-dlp call.
 * @param url       The URL that was being fetched, for platform-specific hints.
 * @param ctx       What the app already tried, so the advice is not a repeat.
 */
export function classifyExtractionError(rawError: unknown, url = '', ctx: ErrorContext = {}): ExtractedError {
    const raw = rawError instanceof Error ? rawError.message : String(rawError ?? '');
    const output = extractYtdlpOutput(raw);

    if (BOT_CHECK.test(output)) {
        const base = '⚠️ This site is blocking the request (bot protection). That is usually a temporary or outdated-downloader issue rather than a bad link. The app is updating itself - please try again in a minute. If it keeps failing, try a different network or add cookies in Settings.';
        return {
            kind: 'bot-check',
            suggestYtDlpUpdate: true,
            // Same trap as the age rule: "add cookies" is wrong once the user
            // has already added them, and on YouTube that is the common report.
            message: ctx.hasCookies
                ? '⚠️ YouTube is blocking the request with its bot protection, and cookies were already sent. So this is not a missing login - it is YouTube challenging your network or a stale downloader. Wait a minute, try a different network or VPN, or make sure the app is up to date.'
                : base
        };
    }

    for (const rule of RULES) {
        if (rule.test.test(output)) {
            let message = rule.message;

            // Stories are fetched by our own code, not yt-dlp, so anything that
            // reaches this branch with a story URL is a fallback path. Saying
            // "not supported" here is now a lie that also hides the one thing
            // the user can fix, which is usually their cookies.
            if (rule.kind === 'unsupported' && /facebook\.com\/(stories|story)/i.test(url)) {
                message = ctx.hasCookies
                    ? '⚠️ This Facebook story could not be read even with cookies sent. It may have expired (stories are gone after 24 hours), or Facebook changed the page. Updating the app is the best next step.'
                    : '🔒 Facebook needs your login cookies to read a story. Add them in Settings, then try again.';
            }
            return { kind: rule.kind, message: contextualize(rule.kind, message, ctx), suggestYtDlpUpdate: false };
        }
    }

    // Never leak the raw yt-dlp output: it is multi-line, contains our own
    // command line (with the user-agent flag) and is not actionable.
    const firstLine = output.split('\n').map((l) => l.trim()).find((l) => /^\s*error\b/i.test(l));
    return {
        kind: 'unknown',
        suggestYtDlpUpdate: false,
        message: firstLine && firstLine.length < 120 ? `${FALLBACK} (${firstLine.replace(/^error:?\s*/i, '')})` : FALLBACK
    };
}
