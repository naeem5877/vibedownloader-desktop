import { redactUrlForLog } from './redact';

/**
 * What an error report is allowed to contain, and how it is shaped.
 *
 * This is the only code in the app that deliberately sends data off the
 * machine, so the rules live here, apart from the SDK, and are testable without
 * it. Two things go wrong by accident rather than on purpose:
 *
 *  - A stack frame's filename is a real path, and on Windows a packaged app's
 *    frames point inside the user's own profile directory. Every crash report
 *    would carry `C:\Users\<someone>\`.
 *  - A console breadcrumb is whatever the app printed, and the app prints the
 *    URL the user pasted. A YouTube watch URL carries a per-visitor signature and
 *    tracking id; a story URL names whose story it is.
 *
 * So: usernames become `<user>`, URLs become site + path + the parameters that
 * identify the video, long text is cut, and nothing else is added.
 */

/** Hard ceiling on events per session. See `reserveEvent`. */
export const MAX_EVENTS_PER_SESSION = 25;

const reportedOnce = new Set<string>();
let eventsSent = 0;

/**
 * One report per distinct symptom per session.
 *
 * A user with no network, or a link that is simply dead, produces a failure per
 * click. Without this, that is an event flood against a rate-limited DSN, and
 * the reports that survive the limit are all the same one. One per session is
 * enough to know a bug exists; the count on the issue says how many users.
 */
export function reserveEvent(fingerprint: string): boolean {
    if (reportedOnce.has(fingerprint)) return false;
    if (eventsSent >= MAX_EVENTS_PER_SESSION) return false;
    reportedOnce.add(fingerprint);
    eventsSent++;
    return true;
}

/** Test seam: start a session from a clean budget. */
export function __resetTelemetryState() {
    reportedOnce.clear();
    eventsSent = 0;
}

/** `C:\Users\naeem\` and `/Users/naeem/` become `<user>`. */
export function scrubUserName(text: string): string {
    return String(text)
        .replace(/([A-Za-z]:\\Users\\)[^\\\r\n"']+/g, '$1<user>')
        .replace(/(\/Users\/)[^/\r\n"']+/g, '$1<user>')
        .replace(/(\/home\/)[^/\r\n"']+/g, '$1<user>');
}

/** Any URL in the text is reduced to site, path and content-identifying params. */
export function scrubUrls(text: string): string {
    return String(text).replace(/\bhttps?:\/\/[^\s"'<>)\]]+/g, (match) => redactUrlForLog(match));
}

/**
 * Every outgoing string goes through this.
 *
 * Long strings are cut rather than sent whole: yt-dlp stderr can be a page of
 * text, and a truncated head still says what happened while keeping the event
 * readable in the UI.
 */
export function scrubText(text: string, max = 2000): string {
    const scrubbed = scrubUrls(scrubUserName(String(text)));
    return scrubbed.length > max ? `${scrubbed.slice(0, max)}... [truncated]` : scrubbed;
}

export function scrubValue(value: unknown, depth = 0): unknown {
    if (typeof value === 'string') return scrubText(value);
    if (Array.isArray(value)) return depth > 4 ? '[array]' : value.map((v) => scrubValue(v, depth + 1));
    if (value && typeof value === 'object') {
        if (depth > 4) return '[object]';
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            out[k] = scrubValue(v, depth + 1);
        }
        return out;
    }
    return value;
}

/**
 * Last gate before an event leaves the machine.
 *
 * The frames are the important part, and the reason this exists at all.
 */
export function scrubEvent(event: any): any {
    if (!event) return event;
    if (event.request?.url) event.request.url = scrubText(event.request.url, 300);
    // Headers can carry an Authorization or Cookie value.
    if (event.request?.headers) event.request.headers = undefined;

    for (const frame of event.exception?.values?.[0]?.stacktrace?.frames || []) {
        if (frame.filename) frame.filename = scrubText(frame.filename, 300);
        if (frame.abs_path) frame.abs_path = scrubText(frame.abs_path, 300);
        if (frame.module) frame.module = scrubText(frame.module, 300);
        if (frame.context_line) frame.context_line = scrubText(frame.context_line, 300);
    }

    if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
    if (event.extra) event.extra = scrubValue(event.extra);
    if (event.contexts) event.contexts = scrubValue(event.contexts);
    // The SDK fills this in from the machine. A report does not need it.
    if (event.user) event.user = undefined;
    return event;
}

/**
 * Console breadcrumbs are the useful ones for an extraction bug - the format
 * summary, the winning player, the runtime - but they are also whatever else the
 * app printed, so each is scrubbed and oversized ones are dropped.
 */
export function scrubBreadcrumb(breadcrumb: any): any {
    if (!breadcrumb) return breadcrumb;
    if (breadcrumb.data) breadcrumb.data = scrubValue(breadcrumb.data);

    if (breadcrumb.message) {
        const message = scrubText(breadcrumb.message, 1000);
        // A dumped HTML page or a whole JSON payload tells nobody anything.
        if (message.length > 1000 && breadcrumb.category !== 'console.error') return null;
        breadcrumb.message = message;
    }
    return breadcrumb;
}

// --- reported (non-crash) failures ----------------------------------------

export interface ExtractionFailureReport {
    /** Raw or already-redacted; scrubbed here either way. */
    url: string;
    /** From `classifyExtractionError`: bot-check, age-gated, private, ... */
    kind: string;
    /** Which player was being tried when it gave up. */
    attempt?: string;
    /** yt-dlp's own words. The most useful field in the report. */
    detail?: string;
    ytdlpVersion?: string | null;
    jsRuntime?: string;
    /** Presence only. A cookie file is never opened. */
    cookieFile?: boolean;
    isYoutube?: boolean;
}

/**
 * A fetch that could not produce metadata, or null if already reported.
 *
 * Grouped by kind rather than by message, so one bug is one issue with a count
 * on it instead of a new issue per wording yt-dlp happened to use. The
 * user-facing sentence is deliberately left out: it is written for a human
 * reading it in the app and varies with the cookie state, which would split one
 * problem into several.
 */
export function buildExtractionFailureEvent(report: ExtractionFailureReport): any | null {
    const platform = report.isYoutube ? 'youtube' : 'other';
    if (!reserveEvent(`extraction:${platform}:${report.kind}`)) return null;

    return {
        message: `Fetch failed: ${report.kind}`,
        level: 'error',
        tags: {
            kind: report.kind,
            platform,
            runtime: report.jsRuntime || 'unknown',
            // Low cardinality on purpose: a tag with a version in it is a new
            // series per release and turns the tag view into noise.
            ytdlp_present: report.ytdlpVersion ? 'yes' : 'no'
        },
        extra: {
            // Tags are indexed and searchable; this is the detail behind them.
            url: scrubText(report.url, 200),
            player: report.attempt || 'unknown',
            ytdlp: report.ytdlpVersion || 'unknown',
            js_runtime: report.jsRuntime || 'unknown',
            cookie_file: report.cookieFile ? 'present' : 'absent',
            yt_dlp_said: scrubText(report.detail || '', 600)
        }
    };
}

export interface ThinFormatReport {
    url: string;
    player: string;
    formatCount: number;
    maxHeight: number;
    videoFormatCount: number;
    audioFormatCount: number;
    heights: number[];
    /** True when retries were used up, i.e. this is what the user is left with. */
    kept: boolean;
    jsRuntime?: string;
}

/**
 * A successful fetch that returned too little to be a real answer, or null if
 * already reported.
 *
 * This is the "360p instead of 1080p" report, and crash reporting cannot see it
 * because nothing failed: the request succeeded and the answer was wrong. Filed
 * at info level, once per distinct ceiling per session - a user who retries
 * three times is one user, not three.
 */
export function buildThinFormatEvent(report: ThinFormatReport): any | null {
    if (!reserveEvent(`thin-formats:${report.maxHeight}:${report.kept ? 'kept' : 'retried'}`)) return null;

    return {
        message: `Thin format list: max ${report.maxHeight || '?'}p`,
        level: 'info',
        tags: {
            max_height: String(report.maxHeight || 0),
            outcome: report.kept ? 'kept' : 'retried',
            runtime: report.jsRuntime || 'unknown'
        },
        extra: {
            url: scrubText(report.url, 200),
            player: report.player,
            formats: report.formatCount,
            video_formats: report.videoFormatCount,
            audio_formats: report.audioFormatCount,
            heights: report.heights.join('/')
        }
    };
}

export interface DownloadFailureReport {
    url: string;
    kind: string;
    formatId?: string;
    attempt?: string;
    detail?: string;
    ytdlpVersion?: string | null;
    jsRuntime?: string;
}

/** A transfer that could not start or could not finish. A different problem from a fetch failure. */
export function buildDownloadFailureEvent(report: DownloadFailureReport): any | null {
    if (!reserveEvent(`download:${report.kind}`)) return null;

    return {
        message: `Download failed: ${report.kind}`,
        level: 'error',
        tags: {
            kind: report.kind,
            format: report.formatId || 'unknown',
            runtime: report.jsRuntime || 'unknown'
        },
        extra: {
            url: scrubText(report.url, 200),
            player: report.attempt || 'unknown',
            ytdlp: report.ytdlpVersion || 'unknown',
            yt_dlp_said: scrubText(report.detail || '', 600)
        }
    };
}
