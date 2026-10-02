// Music tags for an audio download.
//
// yt-dlp already resolves the structured identity of a YouTube Music track -
// the track name, the credited artists, the album, the release year - and the
// app was throwing every bit of it away. A converted WAV came out carrying
// nothing but ffmpeg's own encoder string, and an MP3 came out with a title
// and a cover and nothing else, because nothing ever asked for the metadata.
//
// "Is this music" is decided by the data, not by guessing at the title. A
// tutorial, a vlog or a podcast carries no track and no album on YouTube, and
// writing its uploader into an `artist` field would put a claim in the file
// that the user then reads in Explorer's details pane. So an entry without a
// track identity is reported as "not music" and left exactly as it is today.

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getFfmpegBinaryPath, getYtDlpWrap } from './binaries';
import { getCookiePath } from './paths';
import { detectJsRuntime, jsRuntimeSpawnEnv } from './platform';

const execFileAsync = promisify(execFile);

/** What a tag writer needs, and nothing more. */
export interface MusicTags {
    title: string;
    artist: string;
    album?: string;
    year?: string;
    genre?: string;
}

/** The lookup runs beside the download, so it may take its time, but not forever. */
const LOOKUP_TIMEOUT_MS = 20_000;
/** Short, like every other cache here: it only has to survive a re-click. */
const CACHE_TTL_MS = 10 * 60 * 1000;

/** video url -> tags ('' = known to be "not music", so we stop asking) */
const cache = new Map<string, { at: number; tags: MusicTags | null }>();

/**
 * Reduce a yt-dlp info dict to tags, or `null` when this is not a music track.
 *
 * `track` is the field that matters: YouTube only publishes it for songs, and
 * the two shapes seen in the wild are a full identity (track + artists + album
 * + release year, for a "Topic" upload) and an empty one (a tutorial, a vlog, a
 * podcast, a cover video) where every one of those is blank.
 */
export function parseMusicTags(info: any): MusicTags | null {
    const title = typeof info?.track === 'string' ? info.track.trim() : '';
    if (!title) return null;

    const credited = typeof info?.artist === 'string' ? info.artist.trim() : '';
    const listed = Array.isArray(info?.artists) && info.artists.length
        ? info.artists.filter((a: any) => typeof a === 'string' && a.trim()).join(', ').trim()
        : '';
    const artist = credited || listed;

    const album = typeof info?.album === 'string' ? info.album.trim() : '';
    // A track with no artist and no album is a title, not an identity.
    if (!artist && !album) return null;

    // `release_year` is yt-dlp's normalised form; the raw date is the fallback
    // for the uploads that only carry the latter.
    const year = String(info?.release_year ?? '').trim()
        || String(info?.release_date ?? '').trim().slice(0, 4);
    const genre = typeof info?.genre === 'string' ? info.genre.trim() : '';

    const tags: MusicTags = { title, artist };
    if (album) tags.album = album;
    if (/^\d{4}$/.test(year)) tags.year = year;
    if (genre) tags.genre = genre;
    return tags;
}

/** The same tags shaped for node-id3, which is the app's MP3 tagger. */
export function buildNodeId3Tags(tags: MusicTags): Record<string, string> {
    const out: Record<string, string> = { title: tags.title, artist: tags.artist };
    if (tags.album) out.album = tags.album;
    if (tags.year) out.year = tags.year;
    if (tags.genre) out.genre = tags.genre;
    return out;
}

/**
 * The `-metadata` pairs for a container that has no tagger of its own.
 *
 * ffmpeg maps these onto whatever the format actually uses: RIFF LIST/INFO
 * chunks for WAV, Vorbis comments for FLAC/OGG/OPUS, atoms for M4A. That is what
 * lets a WAV - which has nowhere to put a picture and no tagger in this app -
 * still carry an artist and an album.
 */
export function buildFfmpegMetadataArgs(tags: MusicTags): string[] {
    const pairs: Array<[string, string | undefined]> = [
        ['title', tags.title],
        ['artist', tags.artist],
        ['album', tags.album],
        ['date', tags.year],
        ['genre', tags.genre],
    ];
    const args: string[] = [];
    for (const [key, value] of pairs) {
        const text = typeof value === 'string' ? value.trim() : '';
        if (text) args.push('-metadata', `${key}=${text}`);
    }
    return args;
}

/**
 * Write tags into a finished file by remuxing it.
 *
 * The stream is copied, never re-encoded: a WAV stays bit-identical PCM
 * (measured - the decoded audio hashes identically before and after, and the
 * file grows by the size of the tag chunk) and nothing is re-compressed.
 *
 * Deliberately not used on MP3. An MP3 that carries cover art has a second
 * stream, and copying it into a new MP3 is a muxer problem rather than a
 * tagging one; node-id3 already owns that file.
 */
export async function embedTagsWithFfmpeg(filePath: string, tags: MusicTags | null): Promise<boolean> {
    const ffmpeg = getFfmpegBinaryPath();
    if (!ffmpeg) {
        console.warn('Skipping music tags: ffmpeg is not available.');
        return false;
    }
    if (!tags || !tags.title) return false;
    const meta = buildFfmpegMetadataArgs(tags);
    if (!meta.length) return false;
    if (!fs.existsSync(filePath)) return false;

    const dir = path.dirname(filePath);
    // Same directory, so the replace below stays on one volume.
    const tmp = path.join(dir, `.${path.basename(filePath)}.tagging${path.extname(filePath)}`);

    try {
        await execFileAsync(
            ffmpeg,
            ['-hide_banner', '-loglevel', 'error', '-y', '-i', filePath, '-map', '0', '-c', 'copy', ...meta, tmp],
            { maxBuffer: 8 * 1024 * 1024 }
        );
        if (!fs.existsSync(tmp)) return false;
        replaceFile(tmp, filePath);
        const summary = [tags.title, tags.artist, tags.album, tags.year].filter(Boolean).join(' | ');
        console.log(`Wrote music tags to ${path.basename(filePath)}: ${summary}`);
        return true;
    } catch (e: any) {
        console.warn('Failed to write music tags (non-fatal):', e?.message || e);
        try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* the temp is disposable */ }
        return false;
    }
}

/** Rename over the original, falling back to copy+unlink where rename is refused. */
function replaceFile(tmp: string, target: string): void {
    try {
        fs.renameSync(tmp, target);
        return;
    } catch (e: any) {
        if (!['EPERM', 'EACCES', 'EEXIST', 'EBUSY'].includes(e?.code)) throw e;
        console.warn('Rename refused, copying over the original instead:', e.code);
    }
    fs.copyFileSync(tmp, target);
    fs.unlinkSync(tmp);
}

/**
 * Ask yt-dlp what a track is. Runs alongside the download and never blocks it:
 * a lookup that fails, times out or answers "not music" costs the user
 * nothing, which is the whole point of keeping it off the critical path.
 */
export async function fetchMusicTags(url: string): Promise<MusicTags | null> {
    if (!url) return null;

    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.tags;

    let tags: MusicTags | null = null;
    try {
        const args = ['-J', '--no-playlist', '--skip-download', '--no-warnings', '--no-progress'];
        // The same cookies the download will use, or a track the user can play
        // would not be described here either.
        const cookiePath = getCookiePath('youtube');
        if (cookiePath && fs.existsSync(cookiePath)) args.push('--cookies', cookiePath);
        args.push(url);

        const env = jsRuntimeSpawnEnv(detectJsRuntime());
        const raw = await Promise.race([
            getYtDlpWrap().execPromise(args, { env }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), LOOKUP_TIMEOUT_MS)),
        ]) as string;

        tags = parseMusicTags(JSON.parse(raw));
    } catch (e: any) {
        console.warn('Music tag lookup failed (the download is unaffected):', e?.message || e);
        tags = null;
    }

    cache.set(url, { at: Date.now(), tags });
    return tags;
}

/** Test seam, and how a long session avoids re-asking about the same track. */
export function clearMusicTagsCache(): void {
    cache.clear();
}
