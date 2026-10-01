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

export function buildStoriesUrl(handle: string, storyId?: string): string {
    const tail = storyId ? `${encodeURIComponent(storyId)}/` : '';
    return `https://www.instagram.com/stories/${encodeURIComponent(handle)}/${tail}`;
}

export async function fetchStoriesLocal(handle: string, storyId?: string): Promise<NormalizedStory[]> {
    const clean = (handle || '').trim();
    if (!isPlausibleHandle(clean)) {
        throw new StoryError('not_found', `"${clean}" is not a valid Instagram username.`);
    }

    const vendor = loadStoryDownloader();
    if (!vendor) {
        throw new StoryError('upstream', 'The Instagram downloader is missing from this build. Reinstall the app.');
    }

    let result: VendorResult;
    try {
        result = await vendor(buildStoriesUrl(clean, storyId));
    } catch (e: any) {
        throw new StoryError('upstream', `Could not reach Instagram: ${e?.message || 'network error'}`);
    }

    if (!result?.status) {
        throw new StoryError('not_found', result?.msg || `Could not read stories for ${clean}.`);
    }

    const items = (result.data || [])
        .filter((i): i is StoryItem => Boolean(i && typeof i.url === 'string' && i.url.length > 0))
        .map((i) => ({ url: i.url as string, thumbnail: i.thumbnail || '' }));
    if (!items.length) {
        throw new StoryError('no_stories', `${clean} has no stories right now.`);
    }

    const sniffed = await mapLimited(items, 8, (i) => sniffExtension(i.url));

    return items.map((item, i) => {
        const ext = sniffed[i] ?? 'mp4';
        return {
            id: `${clean}:${storyId || i}`,
            title: `Story ${i + 1}`,
            thumbnail: item.thumbnail || '',
            url: item.url,
            isIGStoryImage: ext === 'jpg',
            ext
        } satisfies NormalizedStory;
    });
}