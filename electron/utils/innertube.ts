/**
 * Metadata fast path for single YouTube videos.
 *
 * Calls the InnerTube `player` endpoint directly instead of spawning yt-dlp, so
 * a paste-to-formats round trip costs a few hundred milliseconds instead of the
 * several seconds a full yt-dlp extraction takes. Nothing here downloads
 * anything: downloads still go through yt-dlp, which re-resolves the video.
 *
 * The result is shaped like a `yt-dlp --dump-single-json` payload on purpose.
 * That lets the existing `buildMetadataFromRaw` produce the renderer's metadata
 * from it, so thumbnails, YouTube Music detection, the caption list and the
 * format picker all behave identically whichever path answered.
 *
 * This is a *fast* path, not a second extractor. Anything it is not sure about
 * returns `null` and the caller falls back to yt-dlp, which is the source of
 * truth. It never throws.
 *
 * Constraints that are easy to undo by accident (shared with the Android app's
 * InnerTubeResolver.kt - keep the client profile in sync between the two):
 *
 *  - VISIONOS is deliberate. ANDROID_VR, which most third-party InnerTube
 *    implementations still use, has had every media URL 403'd since Aug 2026.
 *    The VISIONOS client returns plain `url` fields instead of
 *    `signatureCipher` blobs, so no JS runtime is needed to read formats.
 *  - `visitorData` is required. Without it YouTube answers LOGIN_REQUIRED for
 *    most videos, which looks exactly like a network failure.
 *  - Client versions rotate. CACHE_VERSION is part of the persisted key so a
 *    token issued to a replaced client profile can never outlive it.
 *
 * Deliberately Electron-free so it can be exercised from plain Node.
 */

import { inspectFormats, isDegradedFormatList, formatSummary } from './youtubeStrategy';

const PLAYER_ENDPOINT = 'https://youtubei.googleapis.com/youtubei/v1/player';
const VISITOR_ENDPOINT = 'https://youtubei.googleapis.com/youtubei/v1/visitor_id';

const CLIENT_NAME = 'VISIONOS';
const CLIENT_VERSION = '1.02';
const DEVICE_MAKE = 'Apple';
const DEVICE_MODEL = 'RealityDevice17,1';
const OS_NAME = 'visionOS';
const OS_VERSION = '26.5.23O471';
const USER_AGENT =
    'com.google.ios.youtube/20.10.4 (ApplevisionDevice; U; CPU visionOS 26_5 like Mac OS X)';

/** Bump to invalidate persisted visitor tokens after the client profile changes. */
const CACHE_VERSION = 'v1';
const VISITOR_KEY = `visitor_${CACHE_VERSION}`;

/**
 * The VISIONOS player response carries no `microformat`, so it has no category,
 * upload date, like count or channel URL. The category is not cosmetic: the
 * metadata builder reads `categories` to decide a video is music, which turns on
 * lyrics, the artist and square album art, and hides the caption panel. A WEB
 * player request returns `microformat` (verified: category "Music" for a music
 * video, "Film & Animation" for the first YouTube upload) even though it
 * returns no streams for an anonymous caller, so it is asked in parallel for
 * that and nothing else. Its client version is date-based and a year-old one is
 * still answered; if it ever stops being, the cost is `categories: []`.
 */
const WEB_CLIENT_VERSION = '2.20250925.01.00';
const WEB_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MICROFORMAT_TIMEOUT_MS = 3_000;
/** How long the main answer will wait for the microformat once it is ready. */
const MICROFORMAT_GRACE_MS = 400;

/** Ceiling for a single HTTP request. */
const REQUEST_TIMEOUT_MS = 6_000;

/**
 * Wall-clock ceiling for the whole fast path, retry included. A fast path that
 * could hang would be slower than the yt-dlp path it exists to beat, so on
 * exhaustion it gives up and the caller falls back.
 */
export const FAST_PATH_BUDGET_MS = 8_000;

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

// ---------------------------------------------------------------------------
// Configuration (injected, so this file never imports Electron)
// ---------------------------------------------------------------------------

/** The slice of `fetch` this file uses; both global `fetch` and `net.fetch` fit. */
export type FetchLike = (
    input: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** Tiny persistent key/value store, used only for the visitor token. */
export interface InnerTubeStore {
    read(key: string): string | null;
    write(key: string, value: string | null): void;
}

let fetchImpl: FetchLike = (input, init) => fetch(input, init);
let store: InnerTubeStore | null = null;

/**
 * Optional wiring. The app passes Electron's `net.fetch` so requests follow the
 * system proxy, and a file-backed store so the visitor token survives restarts.
 */
export function configureInnerTube(opts: { fetch?: FetchLike; store?: InnerTubeStore }): void {
    if (opts.fetch) fetchImpl = opts.fetch;
    if (opts.store) store = opts.store;
}

// ---------------------------------------------------------------------------
// URL handling
// ---------------------------------------------------------------------------

/**
 * The video id for a URL that is unambiguously a single YouTube video, or null.
 *
 * Stricter than a bare regex on purpose. This app opens many sites, and a loose
 * `[?&]v=<11 chars>` match would claim any foreign URL that happens to carry a
 * `v` parameter. The host must be YouTube's, and `v=` only counts on `/watch`.
 * Playlist and radio-mix decisions stay with the caller, which already makes them.
 */
export function parseYouTubeVideoId(input: string): string | null {
    const trimmed = (input || '').trim();
    if (!trimmed) return null;

    let u: URL;
    try {
        u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    } catch {
        return null;
    }

    const host = u.hostname.toLowerCase();
    if (host === 'youtu.be') {
        const id = u.pathname.split('/')[1] ?? '';
        return VIDEO_ID.test(id) ? id : null;
    }
    if (host !== 'youtube.com' && !host.endsWith('.youtube.com')) return null;

    if (u.pathname === '/watch') {
        const v = u.searchParams.get('v') ?? '';
        return VIDEO_ID.test(v) ? v : null;
    }
    const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})(?:\/|$)/);
    return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/** An AbortSignal that fires after `ms` or when `parent` does, whichever is first. */
function linkedSignal(parent: AbortSignal | null, ms: number): { signal: AbortSignal; release(): void } {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    const onAbort = () => controller.abort();
    if (parent) {
        if (parent.aborted) controller.abort();
        else parent.addEventListener('abort', onAbort, { once: true });
    }
    return {
        signal: controller.signal,
        release() {
            clearTimeout(timer);
            parent?.removeEventListener('abort', onAbort);
        }
    };
}

interface PostResult {
    /** 0 means the request never produced an HTTP status (network error, timeout). */
    status: number;
    json: any | null;
}

async function postJson(
    url: string,
    body: unknown,
    visitor: string | null,
    parent: AbortSignal | null,
    userAgent: string = USER_AGENT,
    timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<PostResult> {
    const { signal, release } = linkedSignal(parent, timeoutMs);
    try {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'User-Agent': userAgent
        };
        if (visitor) headers['X-Goog-Visitor-Id'] = visitor;

        // Built with JSON.stringify, never a template string: a body with stray
        // newlines in it is answered with `400 Precondition check failed`, which
        // looks like a rejected client profile rather than a formatting bug.
        const res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
        if (!res.ok) return { status: res.status, json: null };

        const text = await res.text();
        return { status: res.status, json: text.trim() ? JSON.parse(text) : null };
    } catch {
        return { status: 0, json: null };
    } finally {
        release();
    }
}

function clientContext(visitor: string | null) {
    const client: Record<string, string> = {
        clientName: CLIENT_NAME,
        clientVersion: CLIENT_VERSION,
        deviceMake: DEVICE_MAKE,
        deviceModel: DEVICE_MODEL,
        osName: OS_NAME,
        osVersion: OS_VERSION,
        hl: 'en',
        gl: 'US'
    };
    if (visitor) client.visitorData = visitor;
    return { client };
}

// ---------------------------------------------------------------------------
// Visitor token
// ---------------------------------------------------------------------------

let cachedVisitor: string | null = null;
let visitorInflight: Promise<string | null> | null = null;

async function mintVisitor(): Promise<string | null> {
    // Own signal, not the caller's: concurrent callers share this promise, and
    // one caller's spent budget must not fail the others.
    const res = await postJson(VISITOR_ENDPOINT, { context: clientContext(null) }, null, null);
    const token = res.json?.responseContext?.visitorData;
    if (typeof token !== 'string' || !token) return null;

    cachedVisitor = token;
    try { store?.write(VISITOR_KEY, token); } catch { /* persistence is a convenience */ }
    return token;
}

/** `minted` is true when this call had to ask YouTube, so a retry cannot help. */
async function getVisitor(): Promise<{ token: string | null; minted: boolean }> {
    if (cachedVisitor) return { token: cachedVisitor, minted: false };

    let stored: string | null = null;
    try { stored = store?.read(VISITOR_KEY) ?? null; } catch { /* treat as missing */ }
    if (stored) {
        cachedVisitor = stored;
        return { token: stored, minted: false };
    }

    // Parallel fetches (a pasted batch) share one request instead of each
    // minting its own token.
    if (!visitorInflight) visitorInflight = mintVisitor().finally(() => { visitorInflight = null; });
    return { token: await visitorInflight, minted: true };
}

function dropVisitor(): void {
    cachedVisitor = null;
    try { store?.write(VISITOR_KEY, null); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Player response -> yt-dlp-shaped payload
// ---------------------------------------------------------------------------

type Json = Record<string, any>;

const AUDIO_CODEC = /^(mp4a|opus|vorbis|ac-3|ec-3|flac)/i;

function num(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

/** `en.4`, `hi_3` -> `en`, `hi`; falls back to the display name. */
function audioTrackLanguage(track: Json): string {
    // Case is kept: yt-dlp reports `en-US`, and a selector filter is case-sensitive.
    const head = String(track.id || '').split('.')[0].split('_')[0];
    if (/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/i.test(head)) return head;
    return String(track.displayName || '').trim() || 'und';
}

function parseFormat(node: Json, duration: number): Json | null {
    const itag = node.itag;
    const mimeType = typeof node.mimeType === 'string' ? node.mimeType : '';
    if (itag === undefined || !mimeType) return null;

    // Only plain URLs: a ciphered format cannot be read without the JS solver,
    // and DRM streams are not downloadable at all.
    if (typeof node.url !== 'string' || !node.url) return null;
    if (node.drmFamilies || node.drmTrackType) return null;

    const kind = mimeType.split('/')[0];
    const subtype = (mimeType.split('/')[1] || '').split(';')[0].toLowerCase();
    let ext: string;
    if (subtype.includes('mp4')) ext = kind === 'audio' ? 'm4a' : 'mp4';
    else if (subtype.includes('webm')) ext = 'webm';
    else return null;

    const codecs = (mimeType.match(/codecs="([^"]*)"/)?.[1] || '')
        .split(',').map((c) => c.trim()).filter(Boolean);
    // A progressive stream (itag 18/22) lists a video and an audio codec.
    const vcodec = kind === 'video' ? (codecs.find((c) => !AUDIO_CODEC.test(c)) || 'unknown') : 'none';
    const acodec = kind === 'audio'
        ? (codecs[0] || 'unknown')
        : (codecs.find((c) => AUDIO_CODEC.test(c)) || 'none');

    const width = num(node.width);
    const height = num(node.height);
    const bitrate = num(node.averageBitrate) || num(node.bitrate);
    const contentLength = num(node.contentLength);

    const audioQuality = String(node.audioQuality || '').replace('AUDIO_QUALITY_', '').toLowerCase();
    const format: Json = {
        format_id: String(itag),
        ext,
        url: node.url,
        protocol: 'https',
        vcodec,
        acodec,
        video_ext: vcodec !== 'none' ? ext : 'none',
        width: width || undefined,
        height: height || undefined,
        fps: num(node.fps) || undefined,
        tbr: bitrate ? bitrate / 1000 : undefined,
        format_note: String(node.qualityLabel || '') || audioQuality || undefined,
        resolution: height ? `${width}x${height}` : 'audio only'
    };

    // `filesize` only when YouTube states it; otherwise an estimate, which is
    // what yt-dlp reports for streams that omit contentLength.
    if (contentLength) format.filesize = contentLength;
    else if (bitrate && duration) format.filesize_approx = Math.round((bitrate * duration) / 8);

    if (node.audioTrack && typeof node.audioTrack === 'object') {
        format.language = audioTrackLanguage(node.audioTrack);
        // Same meaning as yt-dlp's field: >= 0 marks the original (default) track.
        format.language_preference = node.audioTrack.audioIsDefault ? 10 : -1;
        if (node.isDrc) format.vibe_drc = true;
        if (/DESCRIPTIVE/i.test(String(node.audioTrack.audioTrackType || ''))) format.vibe_descriptive = true;
    }
    return format;
}

/**
 * Caption dicts in yt-dlp's layout, one `vtt` entry per language.
 *
 * The caption list in the picker comes from here, and yt-dlp reports far more
 * than the handful of real tracks: every translatable track can be machine
 * translated into ~150 languages. Returning only the real tracks would make the
 * picker offer different choices depending on which path answered, so the
 * translation languages are expanded here too. The files themselves are written
 * by yt-dlp at download time, so `url` is informational.
 */
function parseCaptions(root: Json): { subtitles: Json; automatic_captions: Json } {
    const subtitles: Json = {};
    const automatic: Json = {};

    const renderer = root.captions?.playerCaptionsTracklistRenderer;
    const tracks: Json[] = Array.isArray(renderer?.captionTracks) ? renderer.captionTracks : [];
    const translations: Json[] = Array.isArray(renderer?.translationLanguages) ? renderer.translationLanguages : [];

    let translatableBase: string | null = null;
    for (const track of tracks) {
        const lang = typeof track.languageCode === 'string' ? track.languageCode : '';
        const baseUrl = typeof track.baseUrl === 'string' ? track.baseUrl : '';
        if (!lang) continue;

        const entry = [{ ext: 'vtt', url: baseUrl ? `${baseUrl}&fmt=vtt` : '' }];
        const target = track.kind === 'asr' ? automatic : subtitles;
        if (!target[lang]) target[lang] = entry;

        if (track.isTranslatable && baseUrl && (!translatableBase || track.kind === 'asr')) {
            translatableBase = baseUrl;
        }
    }

    if (translatableBase) {
        for (const t of translations) {
            const lang = typeof t.languageCode === 'string' ? t.languageCode : '';
            if (lang && !automatic[lang]) {
                automatic[lang] = [{ ext: 'vtt', url: `${translatableBase}&fmt=vtt&tlang=${lang}` }];
            }
        }
    }

    return { subtitles, automatic_captions: automatic };
}

/** A language code that is safe to place inside a yt-dlp format selector. */
const SELECTOR_LANGUAGE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

/**
 * Formats for a video that publishes several audio languages.
 *
 * One audio format per language is kept (AAC over Opus, then bitrate, matching
 * `buildAudioTrackList`), and it is given a unique id plus `vibe_selector`, e.g.
 * `ba[language=de-DE][acodec^=mp4a]`. That selector is what the download passes to
 * yt-dlp. It matches on yt-dlp's own `language` field, so it picks the same track
 * whatever number yt-dlp gave the format. Non-audio formats keep the usual
 * de-duplication by id.
 */
function resolveDubbedFormats(all: Json[]): { formats: Json[] } | { decline: string } {
    const rest: Json[] = [];
    const seen = new Set<string>();
    const best = new Map<string, Json>();
    const rank = (f: Json) => (/^mp4a/i.test(String(f.acodec)) ? 0 : /opus/i.test(String(f.acodec)) ? 1 : 2);

    for (const f of all) {
        const isTrack = f.vcodec === 'none' && typeof f.language === 'string' && f.language;
        if (!isTrack) {
            if (!seen.has(f.format_id)) { seen.add(f.format_id); rest.push(f); }
            continue;
        }
        // yt-dlp lists these under a different language value (`en-desc`), so a
        // picker built here would not match it.
        if (f.vibe_descriptive) return { decline: 'descriptive audio track' };
        if (f.vibe_drc) continue; // volume-normalised twin of a track already listed
        if (!SELECTOR_LANGUAGE.test(f.language)) return { decline: `unusable audio language "${f.language}"` };

        const current = best.get(f.language);
        if (!current || rank(f) < rank(current) || (rank(f) === rank(current) && num(f.tbr) > num(current.tbr))) {
            best.set(f.language, f);
        }
    }

    if (best.size < 2) return { decline: 'fewer than two usable audio languages' };

    for (const f of best.values()) {
        const aac = /^mp4a/i.test(String(f.acodec));
        rest.push({
            ...f,
            format_id: `${f.format_id}-${f.language}`,
            vibe_selector: `ba[language=${f.language}]${aac ? '[acodec^=mp4a]' : ''}`
        });
    }
    return { formats: rest };
}

type BuildResult = { raw: Json } | { decline: string };

export function buildRawFromPlayerResponse(root: Json, videoId: string): BuildResult {
    const status = root?.playabilityStatus?.status;
    if (status && status !== 'OK') return { decline: `playability ${status}` };

    const details: Json = root?.videoDetails || {};
    if (details.isLive || details.isUpcoming) {
        // Live recording has its own handling downstream; leave it to yt-dlp.
        return { decline: 'live or upcoming' };
    }

    const streaming: Json | undefined = root?.streamingData;
    if (!streaming) return { decline: 'no streamingData' };

    const duration = num(details.lengthSeconds);
    const seen = new Set<string>();
    let formats: Json[] = [];
    /** Every parsed format before id de-duplication, which a dubbed video needs. */
    const parsedAll: Json[] = [];
    const audioLanguages = new Set<string>();

    for (const key of ['formats', 'adaptiveFormats']) {
        const list = streaming[key];
        if (!Array.isArray(list)) continue;
        for (const node of list) {
            if (!node || typeof node !== 'object') continue;
            const format = parseFormat(node, duration);
            if (!format) continue;
            // Recorded before the id de-duplication below, never after it: every
            // language of a dubbed video shares one itag, so de-duplicating
            // first would hide all but one language and defeat the check.
            parsedAll.push(format);
            if (format.language && format.vcodec === 'none') audioLanguages.add(format.language);
            if (seen.has(format.format_id)) continue;
            seen.add(format.format_id);
            formats.push(format);
        }
    }
    if (formats.length === 0) return { decline: 'no usable formats' };

    // Dubbed videos publish one audio stream per language under the *same* itag
    // (140 for every language), while yt-dlp numbers them `140-0`, `140-20`, ...
    // in an order that is not derivable from this response. So a track is never
    // identified by an id here: it carries a yt-dlp format *selector* that filters
    // on the language itself (see `resolveDubbedFormats`). Anything that cannot be
    // expressed that way is declined and yt-dlp answers it, as before.
    if (audioLanguages.size > 1) {
        const dubbed = resolveDubbedFormats(parsedAll);
        if ('decline' in dubbed) return { decline: dubbed.decline };
        formats = dubbed.formats;
    }

    const micro: Json = root?.microformat?.playerMicroformatRenderer || {};
    const thumbnails: Json[] = (Array.isArray(details.thumbnail?.thumbnails) ? details.thumbnail.thumbnails : [])
        .filter((t: Json) => t && typeof t.url === 'string' && t.url);
    if (thumbnails.length === 0) {
        thumbnails.push({ url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, width: 480, height: 360 });
    }
    const bestThumb = [...thumbnails].sort(
        (a, b) => num(b.width) * num(b.height) - num(a.width) * num(a.height)
    )[0];

    const publish = typeof micro.publishDate === 'string' ? micro.publishDate.slice(0, 10).replace(/-/g, '') : '';
    const id = typeof details.videoId === 'string' && details.videoId ? details.videoId : videoId;
    const author = typeof details.author === 'string' ? details.author : '';
    const channelId = typeof details.channelId === 'string' ? details.channelId : '';

    const raw: Json = {
        _type: 'video',
        id,
        title: details.title || 'Untitled',
        fulltitle: details.title || 'Untitled',
        description: typeof details.shortDescription === 'string' ? details.shortDescription : '',
        thumbnail: bestThumb.url,
        thumbnails,
        uploader: author,
        channel: author,
        uploader_url: typeof micro.ownerProfileUrl === 'string' ? micro.ownerProfileUrl : undefined,
        channel_url: channelId ? `https://www.youtube.com/channel/${channelId}` : undefined,
        view_count: num(details.viewCount),
        like_count: num(micro.likeCount),
        duration,
        upload_date: publish || undefined,
        // `categories` is one of the YouTube Music signals the metadata builder reads.
        categories: typeof micro.category === 'string' && micro.category ? [micro.category] : [],
        is_live: false,
        webpage_url: `https://www.youtube.com/watch?v=${id}`,
        extractor: 'youtube',
        formats,
        ...parseCaptions(root)
    };

    // The same judgement the yt-dlp path applies to its own answer: a thin list
    // (nothing above 360p, or video with no audio stream) is not trusted, and
    // yt-dlp gets to produce the real one.
    const inspection = inspectFormats(raw);
    if (isDegradedFormatList(inspection)) {
        return { decline: `thin format list (${formatSummary(inspection)})` };
    }

    return { raw };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/** Outcome of one player request: parsed body, or whether a fresh token could help. */
type PlayerOutcome = { ok: true; root: Json } | { ok: false; retryWithNewVisitor: boolean; reason: string };

async function requestPlayer(videoId: string, visitor: string, parent: AbortSignal): Promise<PlayerOutcome> {
    const res = await postJson(
        PLAYER_ENDPOINT,
        { context: clientContext(visitor), videoId, contentCheckOk: true, racyCheckOk: true },
        visitor,
        parent
    );

    if (!res.json) {
        // A rejected request may mean a stale token. A network error or timeout
        // may not, and retrying one would spend the whole budget on it.
        return { ok: false, retryWithNewVisitor: res.status >= 400, reason: `HTTP ${res.status || 'error'}` };
    }

    const status = res.json?.playabilityStatus?.status;
    if (status && status !== 'OK') {
        // LOGIN_REQUIRED is what a stale or missing visitor token looks like.
        // UNPLAYABLE / ERROR are the video's own state; a new token changes nothing.
        return { ok: false, retryWithNewVisitor: status === 'LOGIN_REQUIRED', reason: `playability ${status}` };
    }
    return { ok: true, root: res.json };
}

/**
 * `microformat` from a WEB player request, or null. Never rejects. The HTTP and
 * playability status are ignored on purpose: this request answers UNPLAYABLE to
 * an anonymous caller and still carries the microformat.
 */
function fetchMicroformat(videoId: string, visitor: string, parent: AbortSignal): Promise<Json | null> {
    const body = {
        context: { client: { clientName: 'WEB', clientVersion: WEB_CLIENT_VERSION, hl: 'en', gl: 'US', visitorData: visitor } },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true
    };
    return postJson(PLAYER_ENDPOINT, body, visitor, parent, WEB_USER_AGENT, MICROFORMAT_TIMEOUT_MS).then((res) => {
        const microformat = res.json?.microformat;
        return microformat && typeof microformat === 'object' ? microformat : null;
    });
}

/** The promise's value, or null if it has not settled within `ms`. */
function settleWithin<T>(promise: Promise<T | null>, ms: number): Promise<T | null> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), ms);
        promise.then(
            (value) => { clearTimeout(timer); resolve(value); },
            () => { clearTimeout(timer); resolve(null); }
        );
    });
}

/**
 * A yt-dlp-shaped payload for `videoId`, or null when the fast path cannot serve
 * it and the caller should run yt-dlp. Never throws.
 */
export async function resolveInnerTube(videoId: string, budgetMs: number = FAST_PATH_BUDGET_MS): Promise<Json | null> {
    const started = Date.now();
    const budget = new AbortController();
    const timer = setTimeout(() => budget.abort(), budgetMs);
    const elapsed = () => `${Date.now() - started}ms`;

    try {
        let { token, minted } = await getVisitor();
        if (!token) {
            console.log(`[InnerTube] declined: no visitor token (${elapsed()})`);
            return null;
        }

        // Asked alongside the player request rather than after it, so it adds
        // no wall-clock time.
        let micro = fetchMicroformat(videoId, token, budget.signal);
        let outcome = await requestPlayer(videoId, token, budget.signal);

        // One retry, and only when the token came from the cache: a token
        // minted a moment ago is not the problem.
        if (!outcome.ok && outcome.retryWithNewVisitor && !minted && !budget.signal.aborted) {
            dropVisitor();
            ({ token } = await getVisitor());
            if (token) {
                micro = fetchMicroformat(videoId, token, budget.signal);
                outcome = await requestPlayer(videoId, token, budget.signal);
            }
        }

        if (!outcome.ok) {
            console.log(`[InnerTube] declined: ${outcome.reason} (${elapsed()})`);
            return null;
        }

        // The streams are ready; the category gets a moment more, and no longer.
        // Missing it degrades to `categories: []`, never to a slower answer.
        const microformat = await settleWithin(micro, MICROFORMAT_GRACE_MS);
        if (microformat && !outcome.root.microformat) outcome.root.microformat = microformat;

        const built = buildRawFromPlayerResponse(outcome.root, videoId);
        if ('decline' in built) {
            console.log(`[InnerTube] declined: ${built.decline} (${elapsed()})`);
            return null;
        }

        console.log(`[InnerTube] resolved in ${elapsed()}: ${formatSummary(inspectFormats(built.raw))}`);
        return built.raw;
    } catch (e: any) {
        console.warn(`[InnerTube] failed (${e?.name || 'Error'}: ${e?.message || e}) after ${elapsed()}`);
        return null;
    } finally {
        clearTimeout(timer);
        // Cancels a microformat request still in flight on an early return.
        budget.abort();
    }
}

/** Test hook: forget the in-memory token. */
export function resetInnerTubeForTests(): void {
    cachedVisitor = null;
    visitorInflight = null;
}
