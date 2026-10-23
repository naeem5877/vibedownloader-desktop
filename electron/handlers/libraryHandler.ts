import { ipcMain, shell, dialog, app, protocol, net, nativeImage } from 'electron';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { pathToFileURL } from 'url';
import { getMainWindow } from '../utils/windowManager';
import { loadSettings } from '../utils/paths';
import { getFfmpegBinaryPath, getFfprobePath } from '../utils/binaries';

/**
 * The Library: a gallery of everything the user has downloaded.
 *
 * It indexes media straight from disk rather than from a download log, so it
 * also picks up files that were downloaded before this feature existed, files
 * that were moved in by hand, and anything under a download folder the user has
 * since switched away from.
 *
 *   - video  -> a representative frame pulled out with ffmpeg
 *   - audio  -> the embedded cover art, when there is one
 *   - image  -> a downscaled copy
 *
 * Thumbnails and metadata are cached, so a rescan only touches files that are
 * new or have changed.
 */

export type LibraryKind = 'video' | 'audio' | 'image';

export interface LibraryItem {
    id: string;
    path: string;
    name: string;
    artist?: string;
    platform: string;
    kind: LibraryKind;
    ext: string;
    size: number;
    mtime: number;
    duration?: number;
    width?: number;
    height?: number;
    hasThumb: boolean;
    /** Average colour of the thumbnail, used for the card glow. */
    accent?: string;
    root: string;
    /** size:mtime of the file when it was indexed, to detect changes. */
    sig: string;
}

interface RootEntry {
    path: string;
    /** True for folders derived from the "download location" setting. */
    auto: boolean;
}

interface IndexFile {
    version: 1;
    roots: RootEntry[];
    items: Record<string, LibraryItem>;
}

export interface ScanResult {
    total: number;
    added: number;
    removed: number;
}

const VIDEO_EXT = new Set(['mp4', 'mkv', 'webm', 'mov', 'avi', 'm4v', 'flv', 'wmv']);
const AUDIO_EXT = new Set(['mp3', 'm4a', 'wav', 'flac', 'opus', 'ogg', 'aac', 'wma', 'aiff', 'alac']);
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif']);

// Folder names the app creates under <download folder>/VibeDownloader/.
const KNOWN_PLATFORMS = new Set([
    'YouTube', 'Instagram', 'TikTok', 'Facebook', 'Spotify', 'X (Twitter)', 'Pinterest', 'SoundCloud', 'Twitch',
]);

// yt-dlp scratch output that is not a finished download.
const SKIP_NAME = /(\.f\d{2,4}\.[a-z0-9]+$)|(\.(part|ytdl|temp|tmp|partial)$)|(\.temp\.)|(\.part-)/i;

const THUMB_W = 480;
const SETTLE_MS = 4000; // ignore files touched this recently; they may still be written
const WORKERS = 4;

// ---------------------------------------------------------------------------
// Paths and index
// ---------------------------------------------------------------------------

const libDir = () => path.join(app.getPath('userData'), 'library');
const thumbDir = () => path.join(libDir(), 'thumbs');
const indexPath = () => path.join(libDir(), 'index.json');
const thumbPath = (id: string) => path.join(thumbDir(), `${id}.jpg`);

const norm = (s: string) => {
    const r = path.resolve(s);
    return process.platform === 'win32' ? r.toLowerCase() : r;
};

const idFor = (file: string) =>
    crypto.createHash('sha1').update(norm(file)).digest('hex').slice(0, 16);

const sigOf = (st: fs.Stats) => `${st.size}:${Math.floor(st.mtimeMs)}`;

const currentAutoRoot = () => path.join(loadSettings().downloadBasePath, 'VibeDownloader');

let index: IndexFile | null = null;

function loadIndex(): IndexFile {
    if (index) return index;
    try {
        const raw = JSON.parse(fs.readFileSync(indexPath(), 'utf-8'));
        if (raw && raw.version === 1 && raw.items && Array.isArray(raw.roots)) {
            index = raw as IndexFile;
            return index;
        }
    } catch { /* first run or unreadable: start empty */ }
    index = { version: 1, roots: [], items: {} };
    return index;
}

function saveIndex() {
    if (!index) return;
    try {
        fs.mkdirSync(libDir(), { recursive: true });
        const tmp = `${indexPath()}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(index), 'utf-8');
        fs.renameSync(tmp, indexPath());
    } catch (e) {
        console.error('Failed to save library index:', e);
    }
}

/**
 * Makes sure the folder the app currently downloads into is a library root.
 * Called on every list/scan, so switching the download location is picked up
 * without the settings code having to know the library exists. Roots from
 * earlier locations are kept, so older downloads stay in the gallery.
 */
function syncRoots(idx: IndexFile): boolean {
    const cur = currentAutoRoot();
    if (idx.roots.some(r => norm(r.path) === norm(cur))) return false;
    idx.roots.push({ path: cur, auto: true });
    return true;
}

function rootsForUi(idx: IndexFile) {
    const cur = norm(currentAutoRoot());
    return idx.roots.map(r => ({
        path: r.path,
        auto: r.auto,
        current: norm(r.path) === cur,
        exists: fs.existsSync(r.path),
    }));
}

// ---------------------------------------------------------------------------
// ffprobe / ffmpeg
// ---------------------------------------------------------------------------

function run(bin: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string }> {
    return new Promise((resolve) => {
        let stdout = '';
        const child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
        const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, timeoutMs);
        child.stdout.on('data', (d: Buffer) => { if (stdout.length < 1_000_000) stdout += d.toString(); });
        child.on('error', () => { clearTimeout(timer); resolve({ code: null, stdout }); });
        child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout }); });
    });
}

interface Probe {
    duration?: number;
    width?: number;
    height?: number;
    hasVideo: boolean;
    hasCover: boolean;
    title?: string;
    artist?: string;
}

function lowerKeys(o: any): Record<string, string> {
    const out: Record<string, string> = {};
    if (o && typeof o === 'object') {
        for (const k of Object.keys(o)) out[k.toLowerCase()] = String(o[k]);
    }
    return out;
}

async function probe(file: string): Promise<Probe | null> {
    const ffprobe = getFfprobePath();
    if (!ffprobe) return null;
    const r = await run(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], 20000);
    if (r.code !== 0) return null;
    try {
        const j = JSON.parse(r.stdout);
        const streams: any[] = Array.isArray(j.streams) ? j.streams : [];
        const isPic = (s: any) => !!(s.disposition && s.disposition.attached_pic);
        const real = streams.find(s => s.codec_type === 'video' && !isPic(s));
        const cover = streams.find(s => s.codec_type === 'video' && isPic(s));
        const tags = lowerKeys(j.format && j.format.tags);
        const dur = parseFloat(j.format && j.format.duration);
        return {
            duration: Number.isFinite(dur) ? dur : undefined,
            width: real && real.width,
            height: real && real.height,
            hasVideo: !!real,
            hasCover: !!cover,
            title: tags.title,
            artist: tags.artist || tags.album_artist,
        };
    } catch {
        return null;
    }
}

async function makeThumb(item: LibraryItem, pr: Probe | null): Promise<boolean> {
    const out = thumbPath(item.id);
    try { fs.mkdirSync(thumbDir(), { recursive: true }); } catch { /* ignore */ }

    // Images do not need a process: Electron can decode and resize them itself.
    if (item.kind === 'image') {
        try {
            const img = nativeImage.createFromPath(item.path);
            if (!img.isEmpty()) {
                const small = img.getSize().width > THUMB_W ? img.resize({ width: THUMB_W, quality: 'good' }) : img;
                fs.writeFileSync(out, small.toJPEG(80));
                return true;
            }
        } catch { /* fall through to ffmpeg */ }
    }

    const ffmpeg = getFfmpegBinaryPath();
    if (!ffmpeg) return false;

    const scale = `scale='min(${THUMB_W},iw)':-2`;
    let args: string[];
    if (item.kind === 'audio') {
        // Only attempt it when the file actually carries artwork.
        if (pr && !pr.hasCover) return false;
        args = ['-v', 'error', '-y', '-i', item.path, '-map', '0:v:0', '-frames:v', '1', '-vf', scale, '-q:v', '4', out];
    } else {
        // Seek a little way in, then let the `thumbnail` filter pick the most
        // representative of the next 40 frames, which skips black fade-ins.
        const dur = pr && pr.duration ? pr.duration : 0;
        const seek = dur > 6 ? Math.min(dur * 0.12, 30) : dur > 0 ? dur * 0.3 : 0;
        args = [
            '-v', 'error', '-y',
            ...(seek > 0 ? ['-ss', seek.toFixed(2)] : []),
            '-i', item.path,
            '-vf', `thumbnail=40,${scale}`,
            '-frames:v', '1', '-q:v', '4', out,
        ];
    }

    const r = await run(ffmpeg, args, 30000);
    const ok = r.code === 0 && fs.existsSync(out) && fs.statSync(out).size > 0;
    if (!ok) { try { fs.rmSync(out, { force: true }); } catch { /* ignore */ } }
    return ok;
}

/** Average colour of a thumbnail, lifted if it is too dark to show as a glow. */
function accentOf(file: string): string | undefined {
    try {
        const img = nativeImage.createFromPath(file);
        if (img.isEmpty()) return undefined;
        // Desktop Chromium bitmaps are BGRA.
        const bm = img.resize({ width: 6, height: 6, quality: 'good' }).toBitmap();
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i + 3 < bm.length; i += 4) { b += bm[i]; g += bm[i + 1]; r += bm[i + 2]; n++; }
        if (!n) return undefined;
        r /= n; g /= n; b /= n;
        const max = Math.max(r, g, b, 1);
        const k = max < 110 ? 110 / max : 1;
        const hex = (v: number) => Math.min(255, Math.round(v * k)).toString(16).padStart(2, '0');
        return `#${hex(r)}${hex(g)}${hex(b)}`;
    } catch {
        return undefined;
    }
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

function platformOf(root: string, file: string): string {
    const first = path.relative(root, file).split(path.sep)[0];
    return KNOWN_PLATFORMS.has(first) ? first : 'Other';
}

function kindOfExt(ext: string): LibraryKind | null {
    if (VIDEO_EXT.has(ext)) return 'video';
    if (AUDIO_EXT.has(ext)) return 'audio';
    if (IMAGE_EXT.has(ext)) return 'image';
    return null;
}

async function walk(dir: string, out: string[], depth = 0): Promise<void> {
    if (depth > 8) return;
    let entries: fs.Dirent[];
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full, out, depth + 1);
        else if (e.isFile()) out.push(full);
    }
}

async function pool<T>(list: T[], n: number, fn: (x: T) => Promise<void>) {
    let i = 0;
    await Promise.all(
        Array.from({ length: Math.min(n, list.length) }, async () => {
            while (i < list.length) {
                const x = list[i++];
                await fn(x);
            }
        })
    );
}

function emit(payload: Record<string, unknown>) {
    try { getMainWindow()?.webContents.send('library-scan-progress', payload); } catch { /* window gone */ }
}

async function buildItem(file: string, root: string, st: fs.Stats): Promise<LibraryItem> {
    const ext = path.extname(file).slice(1).toLowerCase();
    let kind = kindOfExt(ext) || 'video';
    const pr = await probe(file);
    // Audio-only webm/mp4 files carry a video extension but no picture.
    if (kind === 'video' && pr && !pr.hasVideo) kind = 'audio';

    const base = path.basename(file, path.extname(file));
    // Music carries a real title tag. For video the tag is unreliable (Instagram
    // stores a numeric post id there), and the app already names files after the
    // title, so the filename is the better label.
    const tagTitle = pr && pr.title && !/^\d+$/.test(pr.title.trim()) ? pr.title.trim() : '';
    const item: LibraryItem = {
        id: idFor(file),
        path: file,
        name: (kind === 'audio' && tagTitle ? tagTitle : base).trim() || base,
        artist: pr?.artist,
        platform: platformOf(root, file),
        kind,
        ext,
        size: st.size,
        mtime: st.mtimeMs,
        duration: pr?.duration,
        width: pr?.width,
        height: pr?.height,
        hasThumb: false,
        root,
        sig: sigOf(st),
    };
    item.hasThumb = await makeThumb(item, pr);
    if (item.hasThumb) item.accent = accentOf(thumbPath(item.id));
    return item;
}

/** Looks an item up by id (used by the editor to find the source file). */
export function getLibraryItem(id: string): LibraryItem | undefined {
    return loadIndex().items[id];
}

/**
 * Indexes one file right now and returns it, so a freshly made edit shows up in
 * the gallery immediately instead of waiting for the next scan. Only files inside
 * a scanned folder are accepted.
 */
export async function addFileToLibrary(file: string): Promise<LibraryItem | null> {
    try {
        const idx = loadIndex();
        const root = idx.roots.find(r => {
            const rel = path.relative(r.path, file);
            return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
        });
        if (!root) return null;
        const item = await buildItem(file, root.path, await fsp.stat(file));
        idx.items[item.id] = item;
        saveIndex();
        return item;
    } catch (e) {
        console.error('Library: could not add', file, e);
        return null;
    }
}

let scanPromise: Promise<ScanResult> | null = null;

export function scanLibrary(): Promise<ScanResult> {
    if (!scanPromise) {
        scanPromise = doScan().finally(() => { scanPromise = null; });
    }
    return scanPromise;
}

async function doScan(): Promise<ScanResult> {
    const idx = loadIndex();
    syncRoots(idx);
    const scanStartedAt = Date.now();

    emit({ phase: 'scanning', done: 0, total: 0 });

    // 1. Enumerate media files under every root that still exists.
    const found: { file: string; root: string }[] = [];
    for (const r of idx.roots) {
        if (!fs.existsSync(r.path)) continue;
        const all: string[] = [];
        await walk(r.path, all);
        for (const f of all) {
            if (SKIP_NAME.test(path.basename(f))) continue;
            if (!kindOfExt(path.extname(f).slice(1).toLowerCase())) continue;
            found.push({ file: f, root: r.path });
        }
    }

    // 2. Stat them, and work out what is new, changed or gone.
    const seen = new Set<string>();
    const todo: { file: string; root: string; st: fs.Stats }[] = [];
    for (let i = 0; i < found.length; i += 64) {
        const chunk = found.slice(i, i + 64);
        const stats = await Promise.all(chunk.map(async (c) => {
            try { return { ...c, st: await fsp.stat(c.file) }; } catch { return null; }
        }));
        for (const s of stats) {
            if (!s || s.st.size <= 0) continue;
            const id = idFor(s.file);
            seen.add(id);
            const prev = idx.items[id];
            const settled = Date.now() - s.st.mtimeMs > SETTLE_MS;
            const thumbLost = !!prev && prev.hasThumb && !fs.existsSync(thumbPath(id));
            const changed = !prev || prev.sig !== sigOf(s.st) || thumbLost || prev.root !== s.root;
            if (changed && settled) todo.push(s);
        }
    }

    // A file created while this scan was running (an editor export, say) was not in
    // the folder listing, so it must not be mistaken for a deleted one.
    const removedIds = Object.keys(idx.items).filter(id => !seen.has(id) && idx.items[id].mtime < scanStartedAt - 1000);
    for (const id of removedIds) {
        try { fs.rmSync(thumbPath(id), { force: true }); } catch { /* ignore */ }
        delete idx.items[id];
    }

    let added = 0;
    let done = 0;
    emit({ phase: 'processing', done: 0, total: todo.length, removed: removedIds });

    // 3. Build the new/changed items a few at a time, streaming each to the UI.
    await pool(todo, WORKERS, async (c) => {
        try {
            const item = await buildItem(c.file, c.root, c.st);
            if (!idx.items[item.id]) added++;
            idx.items[item.id] = item;
            done++;
            emit({ phase: 'processing', done, total: todo.length, item });
            if (done % 25 === 0) saveIndex();
        } catch (e) {
            done++;
            console.error('Library: could not index', c.file, e);
        }
    });

    saveIndex();
    const total = Object.keys(idx.items).length;
    emit({ phase: 'done', done, total: todo.length, count: total });
    return { total, added, removed: removedIds.length };
}

// ---------------------------------------------------------------------------
// Protocol + IPC
// ---------------------------------------------------------------------------

/** Must run before the app is ready. */
export function registerLibraryScheme() {
    protocol.registerSchemesAsPrivileged([
        { scheme: 'vibe-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
    ]);
}

export function registerLibraryHandlers() {
    // vibe-media://thumb/<id>  -> cached thumbnail
    // vibe-media://file/<id>   -> the media file itself (supports seeking)
    // Only ids that are in the library index resolve, so this cannot be used to
    // read arbitrary files off the disk.
    protocol.handle('vibe-media', async (req) => {
        try {
            const u = new URL(req.url);
            const kind = u.hostname;
            const id = decodeURIComponent(u.pathname.replace(/^\//, ''));
            const item = /^[a-f0-9]{16}$/.test(id) ? loadIndex().items[id] : undefined;
            if (!item) return new Response('Not found', { status: 404 });

            let target: string | null = null;
            if (kind === 'thumb' && item.hasThumb) target = thumbPath(id);
            else if (kind === 'file') target = item.path;
            if (!target || !fs.existsSync(target)) return new Response('Not found', { status: 404 });

            const range = req.headers.get('range');
            return await net.fetch(pathToFileURL(target).toString(), range ? { headers: { range } } : undefined);
        } catch {
            return new Response('Error', { status: 500 });
        }
    });

    ipcMain.handle('library-list', async () => {
        const idx = loadIndex();
        if (syncRoots(idx)) saveIndex();
        return {
            items: Object.values(idx.items),
            roots: rootsForUi(idx),
            ffmpeg: !!getFfmpegBinaryPath(),
            scanning: !!scanPromise,
        };
    });

    ipcMain.handle('library-scan', async () => {
        try {
            return { success: true, ...(await scanLibrary()) };
        } catch (e: any) {
            console.error('Library scan failed:', e);
            return { success: false, error: e && e.message ? e.message : 'Scan failed' };
        }
    });

    ipcMain.handle('library-add-folder', async () => {
        const win = getMainWindow();
        const opts: Electron.OpenDialogOptions = { properties: ['openDirectory'], title: 'Add a folder to your Library' };
        const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
        const idx = loadIndex();
        if (!result.canceled && result.filePaths.length > 0) {
            const picked = result.filePaths[0];
            if (!idx.roots.some(r => norm(r.path) === norm(picked))) {
                idx.roots.push({ path: picked, auto: false });
                saveIndex();
            }
        }
        return { roots: rootsForUi(idx) };
    });

    ipcMain.handle('library-remove-folder', async (_e: any, folder: string) => {
        const idx = loadIndex();
        // The folder the app downloads into right now cannot be removed.
        if (norm(folder) === norm(currentAutoRoot())) return { roots: rootsForUi(idx), removedIds: [] as string[] };
        idx.roots = idx.roots.filter(r => norm(r.path) !== norm(folder));
        const removedIds = Object.values(idx.items).filter(i => norm(i.root) === norm(folder)).map(i => i.id);
        for (const id of removedIds) {
            try { fs.rmSync(thumbPath(id), { force: true }); } catch { /* ignore */ }
            delete idx.items[id];
        }
        saveIndex();
        return { roots: rootsForUi(idx), removedIds };
    });

    ipcMain.handle('library-open', async (_e: any, id: string) => {
        const item = loadIndex().items[id];
        if (!item || !fs.existsSync(item.path)) return { success: false, error: 'missing' };
        const err = await shell.openPath(item.path);
        return err ? { success: false, error: err } : { success: true };
    });

    ipcMain.handle('library-reveal', async (_e: any, id: string) => {
        const item = loadIndex().items[id];
        if (!item || !fs.existsSync(item.path)) return { success: false, error: 'missing' };
        shell.showItemInFolder(item.path);
        return { success: true };
    });

    ipcMain.handle('library-trash', async (_e: any, id: string) => {
        const idx = loadIndex();
        const item = idx.items[id];
        if (!item) return { success: false, error: 'missing' };
        try {
            if (fs.existsSync(item.path)) await shell.trashItem(item.path);
            try { fs.rmSync(thumbPath(id), { force: true }); } catch { /* ignore */ }
            delete idx.items[id];
            saveIndex();
            return { success: true };
        } catch (e: any) {
            return { success: false, error: e && e.message ? e.message : 'Could not move to trash' };
        }
    });
}
