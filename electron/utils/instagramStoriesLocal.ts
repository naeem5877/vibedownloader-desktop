import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import { app } from 'electron';
import { StoryError, isPlausibleHandle, type NormalizedStory } from './instagramStories';

interface VendorItem {
    thumbnail?: string;
    url?: string;
}

/** A vendor item that survived the missing-url filter, so `url` is present. */
type StoryItem = { thumbnail: string; url: string };

interface VendorResult {
    status?: boolean;
    data?: VendorItem[];
    msg?: string;
}

type VendorFn = (url: string) => Promise<VendorResult>;

const VENDOR_SUBPATH = ['vendor', 'snapsave-downloader', 'src', 'index.js'];

let vendorCache: VendorFn | null | undefined;

export function vendorModulePath(): string {
    return path.join(app.getAppPath(), 'dist-electron', ...VENDOR_SUBPATH);
}

export function loadStoryDownloader(): VendorFn | null {
    if (vendorCache !== undefined) return vendorCache;

    const target = vendorModulePath();
    try {
        if (!fs.existsSync(target)) {
            console.error('[instagramStories] downloader module missing at', target);
            vendorCache = null;
            return vendorCache;
        }
        const req = createRequire(__filename);
        const loaded = req(target) as unknown;
        const candidate = typeof loaded === 'function'
            ? loaded
            : ((loaded as any)?.default ?? null);
        const fn: VendorFn | null = typeof candidate === 'function' ? (candidate as VendorFn) : null;

        if (!fn) {
            console.error('[instagramStories] downloader module has no callable export');
            vendorCache = null;
        } else {
            vendorCache = fn;
        }
    } catch (e: any) {
        console.error('[instagramStories] failed to load downloader module:', e?.message || e);
        vendorCache = null;
    }
    return vendorCache;
}

export function isStoryDownloaderAvailable(): boolean {
    return loadStoryDownloader() !== null;
}

async function sniffExtension(url: string): Promise<'jpg' | 'mp4' | null> {
    try {
        const res = await fetch(url, {
            headers: { Range: 'bytes=0-15' },
            signal: AbortSignal.timeout(10_000)
        });
        if (!res.ok) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
        if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50) return 'jpg';
        if (buf.length >= 12 && buf.slice(4, 12).toString('latin1').includes('ftyp')) return 'mp4';
        return null;
    } catch {
        return null;
    }
}

async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const i = cursor++;
            out[i] = await fn(items[i], i);
        }
    });
    await Promise.all(workers);
    return out;
}

/**
 * Drop repeats of the same file while preserving first-seen order, so the tray
 * shows one row per story and each file is sniffed and fetched exactly once.
 */
export function dedupeByFile<T extends { url: string }>(items: T[]): T[] {
    const seen = new Set<string>();
    return items.filter((item) => {
        const key = dedupeKey(item.url);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function buildStoriesUrl(handle: string, storyId?: string): string {
    const tail = storyId ? `${encodeURIComponent(storyId)}/` : '';
    return `https://www.instagram.com/stories/${encodeURIComponent(handle)}/${tail}`;
}

/**
 * Identity of the file behind a CDN url, for deduplication.
 *
 * The upstream page repeats every story several times, and it hands out a fresh
 * signed wrapper each time, so comparing the outer urls finds nothing to merge:
 * eight distinct tokens all decode to one identical file. The token is a JWT
 * whose payload carries the real CDN url, so that is what identifies the media.
 * The volatile query is dropped because Instagram re-signs the same path.
 */
export function dedupeKey(raw: string): string {
    try {
        const parsed = new URL(raw);
        const token = parsed.searchParams.get('token');
        if (token) {
            const parts = token.split('.');
            if (parts.length >= 2) {
                const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
                if (typeof payload?.url === 'string' && payload.url) {
                    return payload.url.split('?')[0];
                }
            }
            // Opaque token with no readable payload: the token is all we have,
            // minus any cache-busting query.
            return `${parsed.host}${parsed.pathname}${token}`;
        }
        // Same rule as above: the path names the file, the query only signs it.
        return `${parsed.host}${parsed.pathname}`;
    } catch {
        return raw;
    }
}

/** The real CDN url carried inside the signed wrapper, if it is readable. */
export function innerCdnUrl(raw: string): string | null {
    try {
        const token = new URL(raw).searchParams.get('token');
        if (!token) return null;
        const parts = token.split('.');
        if (parts.length < 2) return null;
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        return typeof payload?.url === 'string' && payload.url ? payload.url : null;
    } catch {
        return null;
    }
}

/**
 * Instagram's own CDN path already states the container: images live under
 * t51/t52/t32 and videos under t2. Reading it costs nothing, where asking the
 * server for the first bytes costs a round trip per story.
 */
export function inferExtFromPath(raw: string): 'jpg' | 'mp4' | null {
    const inner = innerCdnUrl(raw);
    if (!inner) return null;
    const path = (() => { try { return new URL(inner).pathname; } catch { return inner; } })();
    if (/\/t5[12](\.|\/)/.test(path) || /\/t32\//.test(path)) return 'jpg';
    if (/\/t2\//.test(path) || /\/o1\/v\/t2\//.test(path)) return 'mp4';
    return null;
}

/**
 * The vendor reports a failure as `status: false` plus a free-text `msg`, and
 * that text is two different things: sometimes Instagram's own answer ("This
 * account is private"), and sometimes an exception thrown inside the
 * obfuscated bundle because the page did not look like what it expected. The
 * second kind is worth exactly nothing on screen - a user cannot act on
 * "Cannot read properties of undefined (reading 'split')" - so it is filtered
 * out here and kept for the log instead.
 */
export function readableVendorMessage(msg: unknown): string {
    if (typeof msg !== 'string') return '';
    const text = msg.trim();
    if (!text || text.length > 160) return '';
    const looksLikeAnException =
        /cannot read propert|is not a function|is not defined|undefined is not|null is not|cannot destructure|cannot convert|is not iterable/i.test(text);
    return looksLikeAnException ? '' : text;
}

// Scraping a profile takes 12-16s upstream, so hold the result briefly and let
// re-opening the same tray feel instant. Signatures expire, so keep it short.
const CACHE_TTL_MS = 5 * 60 * 1000;
const SCRAPE_TIMEOUT_MS = 30_000;
const cache = new Map<string, { at: number; stories: NormalizedStory[] }>();

export function clearStoriesCache(handle?: string): void {
    if (handle) cache.delete(handle.trim().toLowerCase());
    else cache.clear();
}

async function scrape(url: string, load: () => Promise<VendorResult>): Promise<VendorResult> {
    // The upstream intermittently answers 500; one quick retry clears it.
    let lastError: any;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const timeout = new Promise<never>((_resolve, reject) =>
                setTimeout(() => reject(new Error('timed out')), SCRAPE_TIMEOUT_MS)
            );
            return await Promise.race([load(), timeout]);
        } catch (e: any) {
            lastError = e;
            if (attempt === 0) await new Promise((r) => setTimeout(r, 700));
        }
    }
    throw lastError;
}

export async function fetchStoriesLocal(handle: string, storyId?: string): Promise<NormalizedStory[]> {
    const clean = (handle || '').trim();
    if (!isPlausibleHandle(clean)) {
        throw new StoryError('not_found', `"${clean}" is not a valid Instagram username.`);
    }

    const cacheKey = `${clean.toLowerCase()}:${storyId || ''}`;
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
        return hit.stories;
    }

    const vendor = loadStoryDownloader();
    if (!vendor) {
        throw new StoryError('upstream', 'The Instagram downloader is missing from this build. Reinstall the app.');
    }

    let result: VendorResult;
    try {
        result = await scrape(buildStoriesUrl(clean, storyId), () => vendor(buildStoriesUrl(clean, storyId)));
    } catch (e: any) {
        throw new StoryError('upstream', `Could not reach Instagram: ${e?.message || 'network error'}`);
    }

    if (!result?.status) {
        const usable = readableVendorMessage(result?.msg);
        if (!usable && result?.msg) {
            console.warn(`Story downloader could not read ${clean}'s page:`, String(result.msg).slice(0, 200));
        }
        throw new StoryError('not_found', usable || `Could not read stories for ${clean} right now.`);
    }

    const items = (result.data || [])
        .filter((i): i is StoryItem => Boolean(i && typeof i.url === 'string' && i.url.length > 0))
        .map((i) => ({ url: i.url as string, thumbnail: i.thumbnail || '' }));

    // The upstream page lists every story several times over, each with its own
    // signed wrapper, so collapse them before touching the network: one row per
    // story in the UI, and at most one probe per distinct file.
    const unique = dedupeByFile(items);

    if (!unique.length) {
        throw new StoryError('no_stories', `${clean} has no stories right now.`);
    }

    // Trust the path, and only spend a request on the few urls that do not say.
    const guessed = unique.map((i) => inferExtFromPath(i.url));
    const needProbe = guessed.map((g, i) => (g ? -1 : i)).filter((i) => i >= 0);
    const probed = needProbe.length
        ? await mapLimited(
              needProbe.map((i) => unique[i]),
              4,
              (i) => sniffExtension(i.url).then((e) => e ?? 'mp4')
          )
        : [];
    const probedFor = new Map(needProbe.map((idx, n) => [idx, probed[n]]));

    const stories = unique.map((item, i) => {
        const ext = guessed[i] ?? probedFor.get(i) ?? 'mp4';
        return {
            id: `${clean}:${storyId || i}`,
            title: `Story ${i + 1}`,
            thumbnail: item.thumbnail || '',
            url: item.url,
            isIGStoryImage: ext === 'jpg',
            ext
        } satisfies NormalizedStory;
    });

    cache.set(cacheKey, { at: Date.now(), stories });
    return stories;
}