
import { ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);
// @ts-ignore
import NodeID3 from 'node-id3';
import { getYtDlpWrap, getYtDlpBinaryPath, ensureFFmpeg, getFfmpegBinaryPath, getFfprobePath, isFfmpegAvailable } from '../utils/binaries';
import { getOrganizedPath, getCookiePath, loadSettings } from '../utils/paths';
import { getMainWindow } from '../utils/windowManager';
import { showNotification } from '../utils/notifications';
import { fetchYouTubeMusicAlbumArt, extractYouTubeVideoId } from '../utils/youtubeMusic';
import { defaultUserAgent, detectJsRuntime, jsRuntimeSpawnEnv } from '../utils/platform';
import { preferredYoutubeClient } from '../utils/youtubeStrategy';
import { classifyExtractionError } from '../utils/errorMessage';
import { createStageReader } from '../utils/downloadStages';

// Download an image URL to a unique temp file (used for MP3 cover embedding
// and the Windows completion notification).
async function saveThumbnailTemp(url: string): Promise<{ path: string; mime: string } | null> {
    try {
        const response = await fetch(url, {
            headers: { 'User-Agent': defaultUserAgent() }
        });
        if (!response.ok) {
            console.error('Failed to fetch thumbnail:', response.statusText);
            return null;
        }
        const contentType = response.headers.get('content-type') || 'image/jpeg';
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const ext = contentType.includes('webp') ? 'webp' : contentType.includes('png') ? 'png' : 'jpg';
        const thumbPath = path.join(app.getPath('temp'), `vibe_thumb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`);
        fs.writeFileSync(thumbPath, buffer);
        TEMP_THUMBNAIL_FILES.add(thumbPath);
        return { path: thumbPath, mime: contentType };
    } catch (e) {
        console.error("Failed to save thumbnail:", e);
        return null;
    }
}

// Notification thumbnails are scratch files in the OS temp dir, so they have to
// be cleaned up or they pile up for the life of the machine.
const TEMP_THUMBNAIL_PREFIX = 'vibe_thumb_';
const TEMP_THUMBNAIL_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const TEMP_THUMBNAIL_FILES = new Set<string>();

export function cleanupTempThumbnails(maxAgeMs: number = TEMP_THUMBNAIL_MAX_AGE_MS) {
    const tempDir = app.getPath('temp');
    let names: string[] = [];
    try {
        names = fs.readdirSync(tempDir);
    } catch (e) {
        return;
    }
    const cutoff = Date.now() - maxAgeMs;
    for (const name of names) {
        if (!name.startsWith(TEMP_THUMBNAIL_PREFIX)) continue;
        const full = path.join(tempDir, name);
        try {
            if (fs.statSync(full).mtimeMs < cutoff) {
                fs.unlinkSync(full);
                TEMP_THUMBNAIL_FILES.delete(full);
            }
        } catch (e) { /* best effort */ }
    }
}

function discardTempThumbnail(thumbPath?: string) {
    if (!thumbPath) return;
    try {
        if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
    } catch (e) { /* best effort */ }
    TEMP_THUMBNAIL_FILES.delete(thumbPath);
}

const SUBTITLE_ATTEMPTS = 3;
const SUBTITLE_RETRY_MS = 4000;

export interface SubtitleDownloadResult {
    success: boolean;
    path?: string;
    error?: string;
}

/**
 * Downloads a single caption track on its own, with no media involved.
 *
 * Subtitles are a separate download rather than a sidecar of a video download,
 * so nothing here can be undone by a caption request failing. That isolation
 * also matters because YouTube throttles its caption endpoint aggressively: the
 * machine-translated languages return `HTTP Error 429: Too Many Requests`
 * intermittently. The 429 clears within a few seconds, so retrying with a
 * backoff succeeds where a single attempt does not.
 */
async function downloadSubtitleFile(
    url: string,
    uniqueId: string,
    subtitle: { lang: string; isAuto?: boolean; format?: string },
    downloadPath: string,
    fileStem: string
): Promise<SubtitleDownloadResult> {
    const wantedExt = subtitle.format === 'srt' ? 'srt' : 'vtt';
    const startedAt = Date.now();

    if (subtitle.format === 'srt') {
        // Conversion runs through FFmpeg, so make sure it exists before asking
        // yt-dlp to convert.
        try { await ensureFFmpeg(); } catch (e: any) {
            return { success: false, error: `FFmpeg is needed to save subtitles as SRT: ${e?.message || e}` };
        }
    }

    if (!fs.existsSync(downloadPath)) fs.mkdirSync(downloadPath, { recursive: true });

    // `--write-subs` is author-uploaded tracks and `--write-auto-subs` is
    // YouTube's automatic captions; passing both would write two files for one
    // language. `--skip-download` keeps this to the caption only, and yt-dlp
    // inserts the language code into the output template, so this writes
    // "<title> [<id>].<lang>.srt" with no media file beside it.
    const args: string[] = [
        url,
        '--skip-download',
        '--no-warnings',
        '--no-playlist',
        subtitle.isAuto ? '--write-auto-subs' : '--write-subs',
        '--sub-langs', subtitle.lang,
        '-o', path.join(downloadPath, `${fileStem}.%(ext)s`),
    ];
const jsRuntime = detectJsRuntime();
    if (jsRuntime) args.splice(2, 0, '--js-runtimes', jsRuntime.flag);
    const jsRuntimeEnv = jsRuntimeSpawnEnv(jsRuntime);
    if (subtitle.format === 'srt') {
        // Any published caption format can be converted, so accept whatever the
        // track really offers and let FFmpeg produce the requested srt. Asking
        // for `vtt` alone would fail on tracks that publish srt but not vtt.
        args.push('--sub-format', 'vtt/srt/best');
        args.push('--convert-subs', 'srt');
    } else {
        // vtt is what YouTube serves natively, so it needs no conversion.
        args.push('--sub-format', 'vtt');
    }

    // Conversion needs FFmpeg discoverable by yt-dlp, exactly as the media pass
    // does it, otherwise `--convert-subs` reports ffmpeg as not installed.
    const ffmpegPath = getFfmpegBinaryPath();
    if (ffmpegPath) args.push('--ffmpeg-location', path.dirname(ffmpegPath));

for (let attempt = 1; attempt <= SUBTITLE_ATTEMPTS; attempt++) {
        let stderr = '';
        try {
            await execFileAsync(getYtDlpBinaryPath(), args, { cwd: downloadPath, maxBuffer: 32 * 1024 * 1024, env: jsRuntimeEnv });
        } catch (e: any) {
            stderr = String(e?.stderr || e?.message || '');
            const throttled = /429|Too Many Requests/i.test(stderr);
            console.warn(`Subtitle attempt ${attempt}/${SUBTITLE_ATTEMPTS} for '${subtitle.lang}' failed${throttled ? ' (throttled)' : ''}`);
            if (attempt < SUBTITLE_ATTEMPTS) {
                await new Promise((r) => setTimeout(r, SUBTITLE_RETRY_MS * attempt));
                continue;
            }
            const detail = (stderr.split('\n').find((l) => l.includes('ERROR')) || '').replace('ERROR: ', '').trim().slice(0, 200);
            return {
                success: false,
                error: throttled
                    ? `YouTube is rate-limiting caption downloads right now. Wait about a minute and try "${subtitle.lang}" again.`
                    : `Could not download the ${subtitle.lang} subtitles: ${detail || 'unknown error'}`,
            };
        }

// Success cannot be read from the exit code: yt-dlp exits 0 and writes nothing
        // when it has no track for the requested language. Scan for the file
        // instead, and require a fresh timestamp so a file from an earlier
        // download of the same video cannot pass for this one.
        let found: string | undefined;
        try {
            const fresh = fs.readdirSync(downloadPath)
                .filter((f) => f.startsWith(`${fileStem}.${subtitle.lang}.`))
                .map((f) => path.join(downloadPath, f))
                .filter((f) => {
                    try { return fs.statSync(f).mtimeMs >= startedAt; }
                    catch { return false; }
                });
            found = fresh.find((f) => f.toLowerCase().endsWith(`.${wantedExt}`)) || fresh[0];
        } catch (e) { /* fall through to the retry decision */ }

if (found) return { success: true, path: found };

        // Exited cleanly but wrote nothing. Every attempt is a live extraction
        // now, so one retry is worth it - the first can lose a race with a
        // throttled or half-served response - before telling the user the
        // language has no captions.
        if (attempt < SUBTITLE_ATTEMPTS) {
            console.warn(`No '${subtitle.lang}' subtitle written; retrying with a live extraction`);
            await new Promise((r) => setTimeout(r, SUBTITLE_RETRY_MS * attempt));
            continue;
        }
        return { success: false, error: `This video has no captions in "${subtitle.lang}".` };
    }

    return { success: false, error: `Could not download the ${subtitle.lang} subtitles.` };
}
// Cut a downloaded media file to [start, end] seconds using integrated FFmpeg.
// Stream-copies video/audio where possible for near-lossless speed, falling
// back to a re-encode when the source container doesn't support stream copy.
async function cutMediaFile(filePath: string, start: number, end: number): Promise<string | null> {
    if (!fs.existsSync(filePath)) return null;
    const duration = Math.max(0, end - start);
    if (duration <= 0) return null;

    // Resolve through the shared resolver so a system FFmpeg works too, not
    // just the copy inside userData.
    const ffmpeg = getFfmpegBinaryPath();
    if (!ffmpeg) return null;

    const ext = path.extname(filePath);
    const outPath = filePath.replace(ext, `_cut${ext}`);

    const fmtSec = (s: number) => {
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = (s % 60).toFixed(2).padStart(5, '0');
        return `${h}:${m.toString().padStart(2, '0')}:${sec}`;
    };

    // First try super-fast stream copy (no re-encode) so cuts are instant.
    const copyArgs = [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-ss', fmtSec(start), '-i', filePath,
        '-t', fmtSec(duration),
        '-c', 'copy',
        '-avoid_negative_ts', 'make_zero',
        outPath
    ];
    const run = async (args: string[]) => {
        await execFileAsync(ffmpeg, args);
        return fs.existsSync(outPath);
    };

    // The full-length download is just a temp working file — once the clip is
    // safely produced, remove it so only the cut file stays on disk.
    const removeOriginal = () => {
        try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {
            console.error('Failed to remove full-length temp file:', e);
        }
    };

    try {
        const ok = await run(copyArgs);
        if (ok) {
            removeOriginal();
            return outPath;
        }
    } catch (e) {
        console.error('Stream-copy cut failed, falling back to re-encode:', e);
    }

    // Fallback: re-encode the segment to a compatible H.264 + AAC file.
    try {
        const reencodeArgs = [
            '-hide_banner', '-loglevel', 'error', '-y',
            '-ss', fmtSec(start), '-i', filePath,
            '-t', fmtSec(duration),
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
            '-c:a', 'aac', '-b:a', '192k',
            '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart',
            outPath
        ];
        if (await run(reencodeArgs)) {
            try { if (fs.existsSync(copyArgs[copyArgs.length - 1])) fs.unlinkSync(copyArgs[copyArgs.length - 1]); } catch {}
            removeOriginal();
            return outPath;
        }
    } catch (e) {
        console.error('Re-encode cut failed:', e);
    }
    try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch {}
    return null;
}

// Some platforms (notably Instagram) deliver VP9/AV1 video with HE-AAC audio
// inside an .mp4 container. That plays in a few apps but breaks in editors,
// messaging apps and many hardware players. Probe the finished file and, when
// the video codec isn't H.264 (or the audio is HE-AAC/Vorbis/Opus), re-encode
// to the universally compatible H.264 + AAC-LC using the integrated FFmpeg.
async function recodeVideoToH264(filePath: string): Promise<void> {
    if (!fs.existsSync(filePath)) return;
    const ffmpeg = getFfmpegBinaryPath();
    const ffprobe = getFfprobePath();
    if (!ffprobe || !ffmpeg) {
        console.warn('FFmpeg/ffprobe unavailable, skipping compatibility re-encode');
        return;
    }

    let probe: any;
    try {
        const { stdout } = await execFileAsync(ffprobe, [
            '-hide_banner', '-v', 'error',
            '-show_entries', 'stream=codec_type,codec_name,profile',
            '-of', 'json',
            filePath
        ]);
        probe = JSON.parse(stdout);
    } catch (e) {
        console.error('Failed to probe codecs:', e);
        return;
    }

    const streams = probe?.streams || [];
    const video = streams.find((s: any) => s.codec_type === 'video');
    const audio = streams.find((s: any) => s.codec_type === 'audio');
    if (!video) return;

    const videoOk = /h264|avc/i.test(video.codec_name || '');
    const audioCodec = (audio?.codec_name || '').toLowerCase();
    const audioProfile = (audio?.profile || '').toLowerCase();
    const heAac = audioCodec === 'aac' && (audioProfile.includes('he') || audioProfile.includes('latm'));
    const audioOk = !audio || ['mp3', 'ac3', 'eac3'].includes(audioCodec) || (audioCodec === 'aac' && !heAac);
    if (videoOk && audioOk) return;

    const ext = path.extname(filePath);
    const tmpPath = filePath.replace(ext, `_recode${ext}`);

    // Transcode ONLY the streams that actually need it. Re-encoding the video
    // is the expensive part (minutes for a 1080p file), so an HE-AAC audio
    // track is fixed with a stream copy of the video instead.
    const codecArgs: string[] = videoOk
        ? ['-c:v', 'copy']
        : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p'];

    if (audio) {
        if (audioOk) {
            codecArgs.push('-c:a', 'copy');
        } else {
            codecArgs.push('-c:a', 'aac', '-b:a', '192k');
        }
    }

    const reason = [
        videoOk ? null : `${video.codec_name} video`,
        !audioOk ? `${audioCodec}${heAac ? ' (HE-AAC)' : ''} audio` : null
    ].filter(Boolean).join(' + ') || 'compatibility';
    console.log(`Re-encoding ${reason} for compatibility:`, path.basename(filePath));
    try {
        await execFileAsync(ffmpeg, [
            '-hide_banner', '-loglevel', 'error', '-y',
            '-i', filePath,
            ...codecArgs,
            '-movflags', '+faststart',
            tmpPath
        ]);
        fs.renameSync(tmpPath, filePath);
    } catch (e) {
        console.error('Failed to re-encode video to H.264:', e);
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
    }
}

let activeDownloads = 0;

function registerDownloadStart() {
    activeDownloads++;
}

function registerDownloadEnd() {
    activeDownloads = Math.max(0, activeDownloads - 1);
}

export function getActiveDownloadCount() {
    return activeDownloads;
}

// Resolves when no downloads are running. Used to delay app quit until the
// current downloads finish instead of killing yt-dlp mid-file.
export function waitForDownloadsToFinish(timeoutMs: number = 30 * 60 * 1000): Promise<void> {
    return new Promise<void>((resolve) => {
        const start = Date.now();
        const poll = () => {
            if (activeDownloads <= 0 || Date.now() - start >= timeoutMs) return resolve();
            setTimeout(poll, 1000);
        };
        poll();
    });
}

// yt-dlp leaves *.part / *.ytdl files behind when a download is interrupted
// (crash or forced kill). Nothing can be downloading on a fresh launch, so
// sweep the whole download tree and remove the stale fragments.
export function cleanupDownloadArtifacts(): number {
    const base = path.join(loadSettings().downloadBasePath, 'VibeDownloader');
    if (!fs.existsSync(base)) return 0;
    const walk = (dir: string): number => {
        let removed = 0;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                removed += walk(full);
            } else if (/\.(part|ytdl|temp|tmp)$/i.test(entry.name)) {
                try {
                    fs.unlinkSync(full);
                    removed++;
                } catch (e) {
                    console.error('Failed to remove stale artifact:', full, e);
                }
            }
        }
        return removed;
    };
    const n = walk(base);
    if (n > 0) console.log(`Cleaned up ${n} incomplete download artifact(s)`);
    return n;
}

// Live recordings (Twitch etc.) never "complete" on their own — they run until
// the stream ends or the user stops them. Track each active job so we can kill
// its yt-dlp process on demand and still finalize the partial file cleanly.
interface ActiveJob {
    proc?: any;
    cancelled: boolean;
}
const activeJobs = new Map<string, ActiveJob>();

// Best-effort remux of a possibly-interrupted recording to a playable MP4.
async function remuxToMp4(src: string, out: string): Promise<void> {
    const ffmpeg = getFfmpegBinaryPath();
    if (!ffmpeg) throw new Error('FFmpeg is required to finalise this recording but could not be found or downloaded.');
    if (fs.existsSync(out)) try { fs.unlinkSync(out); } catch {}
    await execFileAsync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-c', 'copy', '-movflags', '+faststart', out]);
    if (!fs.existsSync(out)) throw new Error('remux produced no output');
}

// Locate the file yt-dlp left behind after a live recording was stopped and
// turn it into a final playable mp4 ("<name>.part" is the un-finalized file).
async function finalizeLiveRecording(downloadPath: string, uniqueFilename: string, desiredName: string): Promise<string | null> {
    try {
        const files = fs.readdirSync(downloadPath).filter(f => f.startsWith(`${uniqueFilename}.`));
        if (!files.length) return null;

        // Already-final media file (stream ended on its own before we stopped it)
        const existing = files.find(f => /\.(mp4|mkv|ts|webm|mov)$/i.test(f) && !f.endsWith('.part'));
        if (existing) {
            const src = path.join(downloadPath, existing);
            if (existing.toLowerCase().endsWith('.mp4')) return src;
            const out = path.join(downloadPath, desiredName);
            try { await remuxToMp4(src, out); return out; } catch (e) { console.error('Remux failed:', e); return src; }
        }

        // Interrupted mid-recording → un-finalized "<name>.part"
        const part = files.find(f => f.endsWith('.part'));
        if (part) {
            const src = path.join(downloadPath, part);
            const out = path.join(downloadPath, desiredName);
            try {
                await remuxToMp4(src, out);
                try { fs.unlinkSync(src); } catch {}
                return out;
            } catch (e) {
                console.error('Remux of interrupted recording failed, keeping raw file:', e);
                try { fs.renameSync(src, out); } catch {}
                return out;
            }
        }
        return null;
    } catch (e) {
        console.error('finalizeLiveRecording error:', e);
        return null;
    }
}

export function registerDownloadHandlers() {
    ipcMain.handle('download-video', async (event: any, { url, formatId, title, platform, contentType, thumbnail, playlistTitle, suppressNotifications, jobId, cutStart, cutEnd, audioTrack, audioLangLabel, mediaExt }: { url: any, formatId: any, title: any, platform?: string, contentType?: string, thumbnail?: string, playlistTitle?: string, suppressNotifications?: boolean, jobId?: string, cutStart?: number, cutEnd?: number, audioTrack?: string, audioLangLabel?: string, mediaExt?: string }) => {
        registerDownloadStart();
        try {
            const mainWindow = getMainWindow();
            const ytDlpWrap = getYtDlpWrap();

            // TikTok tracking params (is_from_webapp, sender_device) can break
            // yt-dlp's webpage request — strip them here too so downloads are
            // safe even if the URL came straight from the clipboard.
            if (typeof url === 'string' && url.includes('tiktok.com') && /\/video\/\d+/.test(url)) {
                url = url.split('?')[0];
            }

            // Detect platform and content type from URL if not provided
            const isFbcdnUrl = url.includes('fbcdn.net') || url.includes('rapidcdn.app');
            const isFacebook = url.includes('facebook.com') || url.includes('fb.watch') || url.includes('fb.com') || (isFbcdnUrl && platform === 'facebook');
            const isInstagram = platform === 'instagram' || url.includes('instagram.com') || url.includes('instagr.am') || (isFbcdnUrl && platform !== 'facebook');
            const isYoutube = url.includes('youtube.com') || url.includes('youtu.be');
            const isTiktok = url.includes('tiktok.com');
            const isSpotify = url.includes('spotify.com');
            const isPinterest = url.includes('pinterest.com') || url.includes('pin.it');
            const isSoundcloud = url.includes('soundcloud.com');
            const isX = url.includes('twitter.com') || url.includes('x.com');
            const isTwitch = url.includes('twitch.tv');

            // Determine platform
            let detectedPlatform = platform || 'youtube';
            if (!platform || platform === 'youtube') {
                // Auto-detect from URL
                if (isInstagram) detectedPlatform = 'instagram';
                else if (isFacebook) detectedPlatform = 'facebook';
                else if (isYoutube) detectedPlatform = 'youtube';
                else if (isTiktok) detectedPlatform = 'tiktok';
                else if (isSpotify) detectedPlatform = 'spotify';
                else if (isPinterest) detectedPlatform = 'pinterest';
                else if (isSoundcloud) detectedPlatform = 'soundcloud';
                else if (isX) detectedPlatform = 'x';
                else if (isTwitch) detectedPlatform = 'twitch';
            }

            // Determine content type from URL patterns
            let detectedContentType = contentType;
            if (!detectedContentType) {
                if (url.includes('music.youtube.com') && formatId && formatId.startsWith('audio_')) {
                    detectedContentType = 'music';
                } else if (formatId && formatId.startsWith('audio_')) {
                    detectedContentType = 'audio';
                } else if (url.includes('/reel/') || url.includes('/reels/')) {
                    detectedContentType = 'reels';
                } else if (url.includes('/stories/') || url.includes('/story/')) {
                    detectedContentType = 'stories';
                } else if (url.includes('/shorts/')) {
                    detectedContentType = 'shorts';
                } else if (url.includes('/playlist')) {
                    detectedContentType = 'playlist';
                } else if (url.includes('/p/') && isInstagram) {
                    detectedContentType = 'post';
                } else if (isFbcdnUrl && isInstagram) {
                    detectedContentType = 'stories'; // Default direct CDN to stories
                } else if (/\/videos\/\d+/.test(url)) {
                    detectedContentType = 'vod';
                } else if (url.includes('/clip/')) {
                    detectedContentType = 'clip';
                } else if (isTwitch) {
                    detectedContentType = 'live';
                } else {
                    detectedContentType = 'video';
                }
            }

            // Get organized download path
            const downloadPath = getOrganizedPath(detectedPlatform, detectedContentType, playlistTitle);
            const safeTitle = title.replace(/[^a-zA-Z0-9 \-_]/g, '').trim();
            // WAV is the one audio target that is not an MP3, so it has to be
            // named here as well or the app waits on a `.mp3` that never lands.
            const ext = (formatId === 'audio_wav' ? 'wav' : (formatId && formatId.startsWith('audio_') ? 'mp3' : 'mp4'));
            const isCutDownload = typeof cutStart === 'number' && typeof cutEnd === 'number' && cutEnd > cutStart;
            const isLiveDownload = isTwitch && detectedContentType === 'live';

            // Extract unique ID from URL to prevent file overwrites when downloading multiple videos from same creator
            let uniqueId = '';
            if (isInstagram) {
                // Instagram URLs: /reel/ABC123/, /p/ABC123/, /stories/user/123456/
                const reelMatch = url.match(/\/reel\/([A-Za-z0-9_-]+)/);
                const postMatch = url.match(/\/p\/([A-Za-z0-9_-]+)/);
                const storyMatch = url.match(/\/stories\/[^/]+\/(\d+)/);
                uniqueId = reelMatch?.[1] || postMatch?.[1] || storyMatch?.[1] || '';
            } else if (isTiktok) {
                // TikTok URLs: /video/1234567890
                const tiktokMatch = url.match(/\/video\/(\d+)/);
                uniqueId = tiktokMatch?.[1] || '';
            } else if (isX) {
                // X/Twitter URLs: /status/1234567890
                const xMatch = url.match(/\/status\/(\d+)/);
                uniqueId = xMatch?.[1] || '';
            } else if (isFacebook) {
                // Facebook URLs: /videos/1234567890 or /watch?v=1234567890
                const fbVideoMatch = url.match(/\/videos\/(\d+)/);
                const fbWatchMatch = url.match(/[?&]v=(\d+)/);
                uniqueId = fbVideoMatch?.[1] || fbWatchMatch?.[1] || '';
            } else if (isYoutube) {
                // YouTube / YouTube Music: use the stable video ID so re-downloading
                // the same song overwrites the old file instead of cloning a new one.
                uniqueId = extractYouTubeVideoId(url) || '';
            } else if (isTwitch) {
                // Twitch: /videos/<id> VODs, /clip/<slug> clips, or channel name live
                const twitchVod = url.match(/\/videos\/(\d+)/);
                const twitchClip = url.match(/\/clip\/([A-Za-z0-9_-]+)/);
                const twitchChannel = url.match(/twitch\.tv\/([^/?#]+)/);
                uniqueId = twitchVod?.[1] || twitchClip?.[1] || twitchChannel?.[1] || '';
            }

            // If no unique ID found from URL, generate a short timestamp-based ID
            if (!uniqueId) {
                if (url.includes('fbcdn.net')) {
                    // Extract ID from filename before query params
                    const match = url.match(/\/([^\/?#]+)\.(mp4|jpg|jpeg|png)[\?#]/i);
                    if (match) uniqueId = match[1].substring(0, 10);
                    else uniqueId = Date.now().toString(36);
                } else {
                    uniqueId = Date.now().toString(36);
                }
            }

            // Create filename with unique ID to prevent overwrites
            const cutSuffix = isCutDownload ? `_cut_${Math.round(cutStart)}-${Math.round(cutEnd)}` : '';
            const uniqueFilename = `${safeTitle}${cutSuffix}_${uniqueId}`;
            // If it's a direct fbcdn image url, force jpg ext, else use formatId
            const isFbcdnImage = url.includes('fbcdn.net') && (url.includes('.jpg?') || url.includes('.jpeg?'));
            // The renderer reports the real container for CDN items (Instagram
            // story trays mix mp4 and jpg, and the CDN URLs carry no extension
            // and answer with application/octet-stream, so nothing downstream can
            // infer it). Only trust an explicit jpg/mp4 from the main process.
            const resolvedMediaExt = mediaExt === 'jpg' || mediaExt === 'mp4' ? mediaExt : null;
            const finalExt = isFbcdnImage ? 'jpg' : (resolvedMediaExt ?? ext);
            const outputTemplate = path.join(downloadPath, `${uniqueFilename}.%(ext)s`);
            const finalFilePath = path.join(downloadPath, `${uniqueFilename}.${finalExt}`);

            // ==========================================
            // FAST PATH: Direct CDN links (e.g. IG Stories)
            // ==========================================
            // Hosts that serve the media bytes directly. Instagram hands out two
            // different CDNs depending on which path resolved the item:
            // fbcdn.net for anonymous CDN links, and rapidcdn.app for the
            // built-in downloader's story tray URLs.
            const isDirectCdn = url.includes('fbcdn.net') || url.includes('rapidcdn.app');
            if (isDirectCdn) {
                console.log('Using FAST PATH for direct CDN URL:', url.substring(0, 50));
                mainWindow?.webContents.send('download-progress', { percent: 10, currentSpeed: 'Downloading...', jobId });

                const resp = await fetch(url, {
                    headers: { 'User-Agent': defaultUserAgent() }
                });

                if (!resp.ok) throw new Error(`Failed to direct download: ${resp.status}`);

                const totalBytes = parseInt(resp.headers.get('content-length') || '0', 10);
                const reader = resp.body?.getReader();
                if (!reader) throw new Error('No response body');

                const chunks: Uint8Array[] = [];
                let downloadedBytes = 0;
                const startTime = Date.now();

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                    downloadedBytes += value.length;

                    const percent = totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 50;
                    const elapsed = (Date.now() - startTime) / 1000;
                    const speed = elapsed > 0 ? (downloadedBytes / 1024 / 1024 / elapsed) : 0;

                    mainWindow?.webContents.send('download-progress', {
                        percent: Math.min(percent, 99),
                        currentSpeed: `${speed.toFixed(1)} MB/s`,
                        downloaded: `${(downloadedBytes / 1024 / 1024).toFixed(1)} MB`,
                        totalSize: totalBytes > 0 ? `${(totalBytes / 1024 / 1024).toFixed(1)} MB` : '...',
                        jobId
                    });
                }

const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
                const fileBuffer = Buffer.concat(chunks.map(c => Buffer.from(c)), totalLength);
                fs.writeFileSync(finalFilePath, fileBuffer);

                if (finalExt === 'mp4') {
                    await recodeVideoToH264(finalFilePath);
                }

                    let resultPath = finalFilePath;
                    if (isCutDownload) {
                        mainWindow?.webContents.send('download-progress', { percent: 95, currentSpeed: 'Cutting segment...', jobId });
                        const cutPath = await cutMediaFile(finalFilePath, cutStart, cutEnd);
                        if (cutPath) resultPath = cutPath;
                        else console.error('Cut failed, keeping full-length file');
                    }

                    mainWindow?.webContents.send('download-progress', {
                        complete: true,
                        title: safeTitle,
                        path: resultPath,
                        jobId
                    });

                if (!suppressNotifications) {
                    showNotification('Download Complete! ✅', `${safeTitle} saved`, undefined, resultPath);
                }
                return { success: true };
            }

            const args = [
                url,
                '--no-check-certificates',
                '-o', outputTemplate,
                '--no-playlist'
            ];

            // Always have a JS runtime: it is the Node inside this app.
            const jsRuntime = detectJsRuntime();
            if (jsRuntime) args.splice(1, 0, '--js-runtimes', jsRuntime.flag);
            const jsRuntimeEnv = jsRuntimeSpawnEnv(jsRuntime);

            // Add cookies if available for the specific platform
            let cookiePath = null;

            if (isInstagram) {
                cookiePath = getCookiePath('instagram');
            } else if (isFacebook) {
                cookiePath = getCookiePath('facebook');
            } else if (isYoutube) {
                cookiePath = getCookiePath('youtube');
            } else if (isTiktok) {
                cookiePath = getCookiePath('tiktok');
            }

            // Add User-Agent to help with Facebook/Instagram/YouTube
            const defaultUA = defaultUserAgent();
            // Not for YouTube: yt-dlp's default UA is paired with its default
            // player client, and substituting a browser UA for it is what made
            // the app return a low-res-only format list where the same user's
            // own `yt-dlp` command returned 1080p. See infoHandler.ts.
            if (!isYoutube) args.push('--user-agent', defaultUA);

            // Pinning a player disables yt-dlp's own fallback, and tv_embedded without a
            // session hits YouTube's login wall - which YouTube phrases as
            // "Sign in to confirm your age". That is why the same public video
            // downloaded on some machines and reported an age error on others.
            // So only pin when there are cookies; otherwise let yt-dlp choose.
            // The download path cannot retry mid-transfer, so this takes the
            // single best attempt. See utils/youtubeStrategy.ts.
            if (isYoutube) {
                const preferred = preferredYoutubeClient(Boolean(cookiePath && fs.existsSync(cookiePath)));
                if (preferred.extractorArgs) {
                    args.push('--extractor-args', preferred.extractorArgs[0]);
                }
            }

            if (cookiePath && fs.existsSync(cookiePath)) {
                args.push('--cookies', cookiePath);
                const platformName = isInstagram ? 'Instagram' : isFacebook ? 'Facebook' : isYoutube ? 'YouTube' : isTiktok ? 'TikTok' : 'Platform';
                console.log(`Using custom cookies for ${platformName}`);
            } else if (!cookiePath && fs.existsSync(path.join(app.getPath('userData'), 'cookies.txt'))) {
                args.push('--cookies', path.join(app.getPath('userData'), 'cookies.txt'));
            }

            // yt-dlp's last progress line is the last byte of the *source*
            // stream; everything that makes the file the user asked for runs
            // after it. Those steps report themselves as `[Name]` lines, so
            // without reading them the loader can only say the download
            // finished - while, for audio, the transcode that takes longer than
            // the download itself is still running.
            //
            // Declared ahead of the FFmpeg download below because that is also a
            // silent wait on a machine that has never converted anything.
            let lastPercent = 0;
            // `work` marks a step that is running but has no percentage of its
            // own, which is what tells the renderer to sweep the ring instead of
            // pinning it to the download's last number.
            let lastStage: { label: string; work: boolean } | null = null;

            const sendStage = (label: string, work = true) => {
                lastStage = { label, work };
                mainWindow?.webContents.send('download-progress', {
                    percent: lastPercent,
                    stage: label,
                    processing: work,
                    isLive: isLiveDownload,
                    jobId
                });
            };

            const publishStage = (label: string) => {
                if (label === lastStage?.label) return;
                sendStage(label);
            };

            if (formatId && formatId.startsWith('audio_')) {
                // Ensure FFmpeg is available for conversion
                sendStage('Preparing FFmpeg', false);
                await ensureFFmpeg();

                // WAV is uncompressed PCM, so an MP3 VBR digit has nothing to
                // mean here. ffmpeg only repackages the chosen source stream,
                // which is why no `--audio-quality` is passed for it.
                const wantsWav = formatId === 'audio_wav';

                let quality = '5'; // Standard default
                if (formatId === 'audio_best') quality = '0';
                if (formatId === 'audio_low') quality = '9';

                // A dubbed video publishes one audio format set per language.
                // Pinning the chosen language's format id is what makes the
                // download that language instead of YouTube's default track;
                // without a selection the normal best-audio choice stands.
                if (audioTrack) {
                    args.push('-f', audioTrack);
                    console.log(`Extracting ${audioLangLabel || audioTrack} audio (format ${audioTrack})`);
                }

                args.push('-x', '--audio-format', wantsWav ? 'wav' : 'mp3');
                if (!wantsWav) args.push('--audio-quality', quality);
                // Let yt-dlp write + embed the best thumbnail (for music /
                // "Topic" videos this is the square album cover). node-id3 is
                // no longer used for the YouTube path.
                args.push('--write-thumbnail', '--convert-thumbnails', 'jpg', '--embed-thumbnail');
            } else {
                // Ensure FFmpeg is available for merging video/audio
                sendStage('Preparing FFmpeg', false);
                await ensureFFmpeg();

                if (isLiveDownload) {
                    // Live broadcast: record the single live format stream until
                    // the user stops it or the merge finishes.
                    args.push('-f', 'best');
                } else {
                    // FORCE MP4 and H264 priority
                    args.push('--merge-output-format', 'mp4');

                    if (formatId && formatId !== 'best') {
                        // Pair the chosen video with the chosen audio language.
                        // `bestaudio` would quietly hand back the original track.
                        args.push('-f', `${formatId}+${audioTrack || 'bestaudio'}/best`);
                        if (audioTrack) {
                            console.log(`Merging ${formatId} with ${audioLangLabel || audioTrack} audio (format ${audioTrack})`);
                        }
                    } else {
                        args.push('-S', 'res,ext:mp4:m4a,vcodec:h264,acodec:aac');
                    }
                }
            }

            args.push('--progress', '--newline');

            // Ensure we use our own FFmpeg if available, or fall back to system
            // Point yt-dlp at whichever FFmpeg we actually resolved.
            const ffmpegPath = getFfmpegBinaryPath();
            if (ffmpegPath) {
                const ffmpegDir = path.dirname(ffmpegPath);
                args.push('--ffmpeg-location', ffmpegDir);
                console.log('Using FFmpeg at:', ffmpegDir);
            } else {
                console.warn('No FFmpeg available, letting yt-dlp use whatever it can find');
            }

            // Captions are NOT part of a media download. The user downloads a
            // subtitle on its own via the `download-subtitles` channel, so there
            // are no subtitle flags here: YouTube throttles its caption endpoint
            // (HTTP 429 on the machine-translated languages) and yt-dlp fetches
            // subtitles before the media, so bundling them would let a throttled
            // caption abort - and therefore destroy - the video download.

            // Thumbnail for the completion notification. yt-dlp embeds its own
            // thumbnail into audio files; we ALSO kick off a parallel YouTube
            // Music album-art lookup and, when it resolves, override the cover
            // with the true square album art via node-id3.
            let thumbPath: string | undefined;
            let artPromise: Promise<string | null> | null = null;
            const isYoutubeAudio = isYoutube && formatId && formatId.startsWith('audio_');
            if (isYoutubeAudio) {
                const videoId = extractYouTubeVideoId(url);
                if (videoId) {
                    artPromise = fetchYouTubeMusicAlbumArt(videoId).catch(() => null);
                }
            }

            if (thumbnail) {
                const info = await saveThumbnailTemp(thumbnail);
                if (info) { thumbPath = info.path; }
            }

            // Speed up downloads with parallel fragments
            args.push('--concurrent-fragments', '16');

            // YouTube applies a per-connection throttle to googlevideo streams.
            // yt-dlp's native downloader only chunks when this is set (it is
            // disabled by default), so plain-HTTPS DASH streams otherwise run
            // over a single un-chunked connection and crawl.
            args.push('--http-chunk-size', '10M');

            console.log("Starting download with args:", args);
            console.log("Saving to:", downloadPath);

            const jobHandle: ActiveJob = { cancelled: false };
            if (jobId) activeJobs.set(jobId, jobHandle);

            // Captured before the process starts so a subtitle sidecar left over
            // from an earlier download of the same video cannot be mistaken for
            // the one this run produced.
            const downloadStartedAt = Date.now() - 2000;

            // Runs yt-dlp with the given args and resolves only once the
            // finished file has been located and post-processed. It rejects on
            // failure so a cached-extraction run can be retried from scratch.
            const runYtDlp = (execArgs: string[]) => {
                const ytDlpEventEmitter = ytDlpWrap.exec(execArgs, { env: jsRuntimeEnv });
                jobHandle.proc = ytDlpEventEmitter;

                const stageReader = createStageReader(publishStage);

                // stdout, re-parsed by yt-dlp-wrap...
                ytDlpEventEmitter.on('ytDlpEvent', (eventType: string, data: string) => stageReader.fromEvent(eventType, data));
                // ...and stderr, which is where post-processor chatter goes and
                // which the wrapper only buffers for error messages.
                (ytDlpEventEmitter as any).ytDlpProcess?.stderr?.on('data', (chunk: Buffer) => stageReader.fromStderr(chunk.toString()));

                ytDlpEventEmitter.on('progress', (progress: any) => {
                    // Ensure percent is a number and valid
                    const percent = typeof progress.percent === 'number' ? progress.percent : parseFloat(progress.percent) || 0;
                    if (percent > lastPercent) lastPercent = percent;

                    mainWindow?.webContents.send('download-progress', {
                        percent: percent,
                        totalSize: progress.totalSize || '...',
                        currentSpeed: progress.currentSpeed || '...',
                        eta: progress.eta || '...',
                        downloaded: progress.downloadedSize || '...',
                        // A download line can still arrive after a post-processor
                        // one when yt-dlp fetches streams in parallel, so a stage
                        // that is doing work is kept rather than cleared on every
                        // tick. An announcement ("Preparing FFmpeg") is dropped, or
                        // it would hide the speed for the rest of the transfer.
                        stage: lastStage?.work ? lastStage.label : null,
                        processing: lastStage?.work ?? false,
                        isLive: isLiveDownload,
                        jobId
                    });
                });

                // Resolve only after yt-dlp actually finishes, so callers (e.g.
                // playlist bulk download) know when the file is really done.
                return new Promise<{ success: boolean; path?: string }>((resolve, reject) => {
                    let settled = false;
                    let failed = false;

                    ytDlpEventEmitter.on('error', (error: any) => {
                        console.error("Download Error", error);
                        failed = true;
                        // Never hand the UI yt-dlp's raw output: it is multi-line
                        // and echoes our own command line back, flags included.
                        // Classifying also fixes the misleading case where a user
                        // who already added cookies was told to add cookies.
                        const classified = classifyExtractionError(error?.message || String(error), url, {
                            hasCookies: Boolean(cookiePath && fs.existsSync(cookiePath))
                        });
                        mainWindow?.webContents.send('download-progress', { error: classified.message, jobId });
                        if (!settled) { settled = true; reject(new Error(classified.message)); }
                    });

                    ytDlpEventEmitter.on('close', async (code?: number | null) => {
                        if (failed) return;
                        if (jobId) activeJobs.delete(jobId);

                        // Non-zero exit without an error event: treat as a failure,
                        // EXCEPT a live recording the user stopped on purpose.
                        if (typeof code === 'number' && code !== 0 && !(isLiveDownload && jobHandle.cancelled)) {
                            console.error(`Download exited with code ${code}:`, safeTitle);
                            if (!settled) { settled = true; reject(new Error(`yt-dlp exited with code ${code}`)); }
                            return;
                        }

                        console.log("Download complete event for:", safeTitle);

                        if (isLiveDownload) {
                            // Recording stopped (by user or stream end) — finalize the
                            // partial file into a playable mp4.
                            sendStage('Finalizing recording');
                            const desiredName = `${uniqueFilename}.mp4`;
                            const finalPath = await finalizeLiveRecording(downloadPath, uniqueFilename, desiredName);
                            if (!finalPath) {
                                console.error('Live recording produced no file');
                                if (!settled) { settled = true; reject(new Error('Recording ended with no output file')); }
                                return;
                            }

                        mainWindow?.webContents.send('download-progress', {
                            complete: true,
                            title: safeTitle,
                            path: finalPath,
                            isLive: true,
                                jobId
                            });
                            if (!suppressNotifications) {
                                showNotification('Recording Saved! ✅', `${safeTitle} (live)`, undefined, finalPath);
                            }
                            if (!settled) { settled = true; resolve({ success: true, path: finalPath }); }
                            return;
                        }

                        // Wait a tiny bit for file to be released
                        await new Promise(r => setTimeout(r, 500));

                        // yt-dlp may write a different extension than finalExt (e.g.
                        // webm/mkv when no mp4 format exists) — locate the real file.
                        let actualFilePath = finalFilePath;
                        if (!fs.existsSync(actualFilePath)) {
                            try {
                                const mediaFiles = fs.readdirSync(downloadPath).filter(f =>
                                    f.startsWith(`${uniqueFilename}.`) && /\.(mp4|webm|mkv|mov|m4v)$/i.test(f)
                                );
                                if (mediaFiles.length) actualFilePath = path.join(downloadPath, mediaFiles[0]);
                            } catch (e) {
                                console.error('Failed to locate output media file:', e);
                            }
                        }
                        const isVideoDownload = !(formatId && (formatId.startsWith('audio_') || formatId === 'audio'));
                        if (isVideoDownload && fs.existsSync(actualFilePath)) {
                            // A second ffmpeg pass, and the longest step of a video
                            // download: recoding to H.264 rewrites every frame.
                            sendStage('Converting to H.264');
                            await recodeVideoToH264(actualFilePath);
                        }

                        // Cut the finished file down to [cutStart, cutEnd] if requested.
                        let displayPath = actualFilePath;
                        if (isCutDownload && fs.existsSync(actualFilePath)) {
                            sendStage('Cutting segment');
                            const cutResultPath = await cutMediaFile(actualFilePath, cutStart, cutEnd);
                            if (cutResultPath) displayPath = cutResultPath;
                            else console.error('Cut failed, keeping full-length file');
                        }

                        // yt-dlp can leave the converted thumbnail file behind after
                        // embedding — remove any leftover image files for this download.
                        try {
                            for (const f of fs.readdirSync(downloadPath)) {
                                if (f.startsWith(`${uniqueFilename}.`) && /\.(jpe?g|png|webp)$/i.test(f)) {
                                    try {
                                        fs.unlinkSync(path.join(downloadPath, f));
                                        console.log('Removed leftover thumbnail:', f);
                                    } catch (e) {
                                        console.error('Failed to remove leftover thumbnail:', e);
                                    }
                                }
                            }
                        } catch (e) {
                            console.error('Failed to scan download folder for leftover thumbnails:', e);
                        }

                        // Upgrade the embedded cover to the true square YouTube Music
                        // album art when the parallel lookup succeeded.
                        const isAudioDownload = formatId && (formatId.startsWith('audio_') || formatId === 'audio');
                        // node-id3 only writes MP3 tags, so a WAV download is
                        // left with whatever yt-dlp embedded instead of being
                        // handed to a tagger that cannot parse it.
                        if (isAudioDownload && finalExt === 'mp3' && artPromise && fs.existsSync(finalFilePath)) {
                            // The lookup runs in parallel with the download, but a
                            // network miss here still costs the user a visible wait.
                            sendStage('Fetching album art');
                            const art = await artPromise;
                            if (art) {
                                console.log('Upgrading cover to YouTube Music album art:', art.substring(0, 50) + '...');
                                sendStage('Embedding album art');
                                const info = await saveThumbnailTemp(art);
                                if (info) {
                                    // The earlier candidate is superseded by the real
                                    // album art, so drop it instead of leaking it.
                                    discardTempThumbnail(thumbPath);
                                    thumbPath = info.path;
                                    try {
                                        const tags = {
                                            title: safeTitle,
                                            image: {
                                                mime: info.mime,
                                                type: { id: 3, name: "front cover" },
                                                description: "Cover",
                                                imageBuffer: fs.readFileSync(info.path)
                                            }
                                        };
                                        console.log("Embedding YouTube Music album art:", NodeID3.update(tags, finalFilePath));
                                    } catch (e) {
                                        console.error("Failed to write album art tags (non-fatal):", e);
                                    }
                                }
                            }
                        }

                        // Captions are downloaded separately by the user through
                        // the `download-subtitles` channel, so a media download
                        // has nothing left to verify here.
                        mainWindow?.webContents.send('download-progress', {
                            complete: true,
                            title: safeTitle,
                            path: displayPath,
                            jobId
                        });

                        if (!suppressNotifications) {
                            showNotification(
                                'Download Complete! ✅',
                                `${safeTitle} saved to ${detectedPlatform}/${detectedContentType}`,
                                thumbPath,
                                displayPath
                            );
                        }
                        // The notification has taken the image into memory by now,
                        // so the scratch file is no longer needed.
                        discardTempThumbnail(thumbPath);

                        if (settled) return;


                        settled = true;
                        resolve({ success: true, path: displayPath });
                    });
                });
            };

            try {
                return await runYtDlp(args);
            } finally {
                if (jobId) activeJobs.delete(jobId);
                // Safety net for failures and cancellations, which never reach
                // the success path that discards the thumbnail.
                discardTempThumbnail(thumbPath);
            }
        } catch (e: any) {
            console.error("Main Error", e);
            if (!suppressNotifications) {
                showNotification('Download Failed', e.message);
            }
            return { success: false, error: e.message };
        } finally {
            registerDownloadEnd();
        }
    });

    // Captions are downloaded on their own, never as part of a media download,
    // and land in the platform's Subtitles folder.
    ipcMain.handle('download-subtitles', async (event: any, { url, title, platform, contentType, playlistTitle, thumbnail, suppressNotifications, subtitle }: {
        url: string; title?: string; platform?: string; contentType?: string; playlistTitle?: string;
        thumbnail?: string; suppressNotifications?: boolean;
        subtitle: { lang: string; isAuto?: boolean; format?: 'srt' | 'vtt' };
    }) => {
        if (!url) return { success: false, error: 'No URL provided' };
        if (!subtitle?.lang) return { success: false, error: 'No subtitle language selected' };
        registerDownloadStart();
        try {
            const detectedPlatform = platform || 'youtube';
            const safeTitle = (title || 'video').replace(/[\\/:*?"<>|]/g, '').trim() || 'video';
            // A playlist keeps its own folder, matching where its media goes.
            const subtitleDir = getOrganizedPath(detectedPlatform, 'subtitles', playlistTitle);
            const uniqueId = extractYouTubeVideoId(url) || Date.now().toString(36);
            const fileStem = `${safeTitle} [${uniqueId}]`;

            console.log(`Downloading ${subtitle.lang} (${subtitle.isAuto ? 'auto' : 'manual'}) subtitles as ${subtitle.format || 'vtt'}`);

            const result = await downloadSubtitleFile(url, uniqueId, subtitle, subtitleDir, fileStem);

            if (result.success && result.path && !suppressNotifications) {
                const thumb = thumbnail ? await saveThumbnailTemp(thumbnail) : null;
                showNotification(
                    'Subtitles Saved! \u2705',
                    `${path.basename(result.path)} saved to ${detectedPlatform}/Subtitles`,
                    thumb?.path,
                    result.path
                );
                discardTempThumbnail(thumb?.path);
            }
            if (!result.success) {
                console.error('Subtitle download failed:', result.error);
                if (!suppressNotifications) showNotification('Subtitle Download Failed', result.error || 'Unknown error');
            }
            return result;
        } catch (e: any) {
            console.error('Subtitle download error:', e);
            return { success: false, error: e?.message || String(e) };
        } finally {
            registerDownloadEnd();
        }
    });

    ipcMain.handle('cancel-download', (event: any, jobId: string) => {
        const handle = activeJobs.get(jobId);
        if (!handle) return { success: false, error: 'No active download for this job' };
        handle.cancelled = true;
        try {
            handle.proc?.ytDlpProcess?.kill();
        } catch (e) {
            console.error('Failed to kill download process:', e);
        }
        return { success: true };
    });

    ipcMain.handle('download-spotify-track', async (event: any, { searchQuery, title, artist, thumbnail, playlistTitle, suppressNotifications, jobId, formatId }) => {
        registerDownloadStart();
        try {
            const mainWindow = getMainWindow();
            // Ensure FFmpeg is available for conversion
            // On a machine that has never converted anything this pulls an ~80 MB
            // binary, which is otherwise a loader with nothing to say for it.
            mainWindow?.webContents.send('download-progress', { percent: 0, stage: 'Preparing FFmpeg', processing: false, jobId });
            await ensureFFmpeg();

            console.log(`Searching YouTube for: ${searchQuery}`);
            const ytDlpWrap = getYtDlpWrap();
            // Search top 3 results so yt-dlp picks the best relevance match
            const ytSearchUrl = `ytsearch3:${searchQuery}`;

            // Playlist tracks go in Spotify/Playlists/<playlist name>/, single
            // tracks go in Spotify/Tracks/.
            const isPlaylist = !!playlistTitle;
            const downloadPath = getOrganizedPath('spotify', isPlaylist ? 'playlist' : 'track', playlistTitle);
            const safeTitle = `${artist} - ${title}`.replace(/[^a-zA-Z0-9 \-_]/g, '').trim();
            const outputTemplate = path.join(downloadPath, `${safeTitle}.%(ext)s`);

            // Spotify tracks are matched on YouTube and then converted, so the
            // picker picks the same three MP3 bitrates plus WAV as everywhere
            // else. An unknown id falls back to the 320k default, which is what
            // every caller sent before the format became selectable.
            const audioExt = formatId === 'audio_wav' ? 'wav' : 'mp3';
            const audioQuality = formatId === 'audio_standard' ? '5' : formatId === 'audio_low' ? '9' : '0';

            const args = [
                ytSearchUrl,
                '--extractor-args', 'youtube:player_client=tv_embedded',
                '--no-check-certificates',
                '-x', '--audio-format', audioExt,
                '-o', outputTemplate,
                '--no-playlist',
                '--playlist-items', '1',
                '--progress', '--newline',
                '--concurrent-fragments', '16'
            ];

            // WAV is uncompressed PCM, where an MP3 VBR digit means nothing.
            if (audioExt === 'mp3') args.push('--audio-quality', audioQuality);

            const spotifyJsRuntime = detectJsRuntime();
            if (spotifyJsRuntime) args.splice(1, 0, '--js-runtimes', spotifyJsRuntime.flag);

            // Pass ffmpeg location to yt-dlp so it can find ffprobe/ffmpeg
            const ffmpegPath = getFfmpegBinaryPath();
            if (ffmpegPath) {
                args.push('--ffmpeg-location', path.dirname(ffmpegPath));
            }

            const ytDlpEventEmitter = ytDlpWrap.exec(args, { env: jsRuntimeSpawnEnv(spotifyJsRuntime) });

            // A Spotify "track" is a YouTube video re-encoded to audio, so it
            // hits the same two-phase pipeline: a progress line per byte, then
            // the ExtractAudio/EmbedThumbnail work that has no percentage.
            let lastPercent = 0;
            let lastStage: { label: string; work: boolean } | null = null;

            const sendStage = (label: string, work = true) => {
                lastStage = { label, work };
                mainWindow?.webContents.send('download-progress', {
                    percent: lastPercent,
                    stage: label,
                    processing: work,
                    jobId
                });
            };

            const stageReader = createStageReader(label => {
                if (label === lastStage?.label) return;
                sendStage(label);
            });
            ytDlpEventEmitter.on('ytDlpEvent', (eventType: string, data: string) => stageReader.fromEvent(eventType, data));
            (ytDlpEventEmitter as any).ytDlpProcess?.stderr?.on('data', (chunk: Buffer) => stageReader.fromStderr(chunk.toString()));

            ytDlpEventEmitter.on('progress', (progress: any) => {
                const percent = typeof progress.percent === 'number' ? progress.percent : parseFloat(progress.percent) || 0;
                if (percent > lastPercent) lastPercent = percent;
                mainWindow?.webContents.send('download-progress', {
                    percent: percent,
                    totalSize: progress.totalSize || '...',
                    currentSpeed: progress.currentSpeed || '...',
                    eta: progress.eta || '...',
                    downloaded: progress.downloadedSize || '...',
                    stage: lastStage?.work ? lastStage.label : null,
                    processing: lastStage?.work ?? false,
                    jobId
                });
            });

            // Resolve only after yt-dlp actually finishes, so callers (e.g.
            // playlist bulk download) know when the file is really done.
            return await new Promise<{ success: boolean; path?: string }>((resolve, reject) => {
                let settled = false;
                let failed = false;

                ytDlpEventEmitter.on('error', (error: any) => {
                    console.error("Spotify Download Error", error);
                    failed = true;
                    mainWindow?.webContents.send('download-progress', { error: error.message, jobId });
                    if (!settled) { settled = true; reject(new Error(error.message)); }
                });

                ytDlpEventEmitter.on('close', async (code?: number | null) => {
                    if (failed) return;

                    // Non-zero exit without an error event: treat as a failure
                    if (typeof code === 'number' && code !== 0) {
                        console.error(`Spotify download exited with code ${code}:`, safeTitle);
                        if (!settled) { settled = true; reject(new Error(`yt-dlp exited with code ${code}`)); }
                        return;
                    }

                    const finalFilePath = path.join(downloadPath, `${safeTitle}.${audioExt}`);
                    console.log("Spotify download process closed, finalizing:", finalFilePath);

                    // Wait a tiny bit for file to be released
                    await new Promise(r => setTimeout(r, 500));

                    let notificationThumbPath: string | undefined;

                    // Embed thumbnail logic with retry and longer timeout
                    // node-id3 only writes MP3 tags, so a WAV track is left
                    // untagged rather than handed to a tagger that cannot
                    // parse it.
                    try {
                        if (thumbnail && audioExt === 'mp3') {
                            sendStage('Embedding cover art');
                            console.log('Fetching Spotify thumbnail (with retry):', thumbnail.slice(0, 60));

                            const axios = require('axios');
                            try {
                                const response = await axios.get(thumbnail, {
                                    responseType: 'arraybuffer',
                                    timeout: 3000,
                                    headers: {
                                        'User-Agent': defaultUserAgent(),
                                        'Referer': 'https://open.spotify.com/',
                                        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*',
                                    }
                                });

                                if (response.status === 200) {
                                    const contentType = response.headers['content-type'] || 'image/jpeg';
                                    const imageBuffer = Buffer.from(response.data);

                                    // Save temp for notification
                                    const imgExt = contentType.includes('webp') ? 'webp' : contentType.includes('png') ? 'png' : 'jpg';
                                    notificationThumbPath = path.join(app.getPath('temp'), `spotify_thumb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${imgExt}`);
                                    fs.writeFileSync(notificationThumbPath, imageBuffer);

                                    const tags = {
                                        title, artist,
                                        image: {
                                            mime: contentType,
                                            type: { id: 3, name: "front cover" },
                                            description: "Cover",
                                            imageBuffer
                                        }
                                    };
                                    const embedResult = NodeID3.update(tags, finalFilePath);
                                    console.log("Spotify thumbnail embedding result:", embedResult);
                                }
                            } catch (e: any) {
                                console.warn('Skipping thumbnail due to slow connection or block:', e.message);
                            }
                        }
                    } catch (e: any) {
                        console.warn('Failed to embed Spotify thumbnail (non-fatal):', e.message || e);
                    }

                    mainWindow?.webContents.send('download-progress', {
                        complete: true,
                        title: safeTitle,
                        path: finalFilePath,
                        jobId
                    });
                    if (!suppressNotifications) {
                        const folderLabel = isPlaylist ? `Spotify/Playlists/${playlistTitle}` : 'Spotify/Tracks';
                        showNotification('Download Complete! ✅', `${safeTitle} saved to ${folderLabel}`, notificationThumbPath, finalFilePath);
                    }

                    if (!settled) { settled = true; resolve({ success: true, path: finalFilePath }); }
                });
            });
        } catch (e: any) {
            console.error("Spotify download error:", e);
            if (!suppressNotifications) {
                showNotification('Download Failed', e.message);
            }
            return { success: false, error: e.message };
        } finally {
            registerDownloadEnd();
        }
    });

    ipcMain.handle('save-thumbnail', async (event: any, { url, title }: { url: string, title: string }) => {
        try {
            const axios = require('axios');
            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: 3000,
                headers: {
                    'User-Agent': defaultUserAgent(),
                    'Referer': 'https://open.spotify.com/',
                    'Accept': 'image/avif,image/webp,image/apng,image/*,*/*',
                }
            });

            if (response.status !== 200) throw new Error(`CDN returned ${response.status}`);

            const buffer = Buffer.from(response.data);
            const safeTitle = title.replace(/[^a-zA-Z0-9 \-_]/g, '').trim();
            const downloadPath = app.getPath('downloads');
            const contentType = response.headers['content-type'] || 'image/jpeg';
            const ext = contentType.includes('png') ? 'png' : 'jpg';
            const filePath = path.join(downloadPath, `${safeTitle}_thumbnail.${ext}`);

            fs.writeFileSync(filePath, buffer);
            const shell = require('electron').shell;
            shell.showItemInFolder(filePath);

            return { success: true, path: filePath };
        } catch (e: any) {
            console.error('Thumbnail save failed or timed out:', e.message);
            return { success: false, error: 'Thumbnail unavailable or took too long to load.' };
        }
    });
}
