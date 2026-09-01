
import { ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);
// @ts-ignore
import NodeID3 from 'node-id3';
import { getYtDlpWrap, ensureFFmpeg, getFfmpegBinaryPath, isFfmpegAvailable } from '../utils/binaries';
import { getOrganizedPath, getCookiePath, loadSettings } from '../utils/paths';
import { getMainWindow } from '../utils/windowManager';
import { showNotification } from '../utils/notifications';
import { fetchYouTubeMusicAlbumArt, extractYouTubeVideoId } from '../utils/youtubeMusic';

// Download an image URL to a unique temp file (used for MP3 cover embedding
// and the Windows completion notification).
async function saveThumbnailTemp(url: string): Promise<{ path: string; mime: string } | null> {
    try {
        const response = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
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
        return { path: thumbPath, mime: contentType };
    } catch (e) {
        console.error("Failed to save thumbnail:", e);
        return null;
    }
}

// Cut a downloaded media file to [start, end] seconds using integrated FFmpeg.
// Stream-copies video/audio where possible for near-lossless speed, falling
// back to a re-encode when the source container doesn't support stream copy.
async function cutMediaFile(filePath: string, start: number, end: number): Promise<string | null> {
    if (!fs.existsSync(filePath)) return null;
    const duration = Math.max(0, end - start);
    if (duration <= 0) return null;

    const ffmpegDir = path.dirname(getFfmpegBinaryPath());
    const ffmpeg = path.join(ffmpegDir, 'ffmpeg.exe');
    if (!fs.existsSync(ffmpeg)) return null;

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
    const ffmpegDir = path.dirname(getFfmpegBinaryPath());
    const ffprobe = path.join(ffmpegDir, 'ffprobe.exe');
    const ffmpeg = path.join(ffmpegDir, 'ffmpeg.exe');
    if (!fs.existsSync(ffprobe) || !fs.existsSync(ffmpeg)) return;

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
    const reason = videoOk ? `HE-AAC audio` : `${video.codec_name} video`;
    console.log(`Re-encoding ${reason} for compatibility:`, path.basename(filePath));
    try {
        await execFileAsync(ffmpeg, [
            '-hide_banner', '-loglevel', 'error', '-y',
            '-i', filePath,
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
            '-c:a', 'aac', '-b:a', '192k',
            '-movflags', '+faststart',
            '-pix_fmt', 'yuv420p',
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
    const ffmpegDir = path.dirname(getFfmpegBinaryPath());
    const ffmpeg = path.join(ffmpegDir, 'ffmpeg.exe');
    if (!fs.existsSync(ffmpeg)) throw new Error('ffmpeg not found');
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
    ipcMain.handle('download-video', async (event: any, { url, formatId, title, platform, contentType, thumbnail, playlistTitle, suppressNotifications, jobId, cutStart, cutEnd }: { url: any, formatId: any, title: any, platform?: string, contentType?: string, thumbnail?: string, playlistTitle?: string, suppressNotifications?: boolean, jobId?: string, cutStart?: number, cutEnd?: number }) => {
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
            const isFbcdnUrl = url.includes('fbcdn.net');
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
            const ext = (formatId && formatId.startsWith('audio_') ? 'mp3' : 'mp4');
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
            const finalExt = isFbcdnImage ? 'jpg' : ext;
            const outputTemplate = path.join(downloadPath, `${uniqueFilename}.%(ext)s`);
            const finalFilePath = path.join(downloadPath, `${uniqueFilename}.${finalExt}`);

            // ==========================================
            // FAST PATH: Direct CDN links (e.g. IG Stories)
            // ==========================================
            if (url.includes('fbcdn.net')) {
                console.log('Using FAST PATH for direct CDN URL:', url.substring(0, 50));
                mainWindow?.webContents.send('download-progress', { percent: 10, currentSpeed: 'Downloading...', jobId });

                const resp = await fetch(url, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
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
                '--js-runtimes', 'node',
                '--no-check-certificates',
                '-o', outputTemplate,
                '--no-playlist'
            ];

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
            const defaultUA = process.platform === 'darwin'
                ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
                : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
            args.push('--user-agent', defaultUA);

            if (isYoutube && cookiePath && fs.existsSync(cookiePath)) {
                // tv_embedded returns the FULL DASH format list (up to 4K) AND
                // handles age-gated videos. Other clients (web, android_vr,
                // web_safari) currently return only the combined 360p format.
                args.push('--extractor-args', 'youtube:player_client=tv_embedded');
            } else {
                args.push('--extractor-args', 'youtube:player_client=tv_embedded');
            }

            if (cookiePath && fs.existsSync(cookiePath)) {
                args.push('--cookies', cookiePath);
                const platformName = isInstagram ? 'Instagram' : isFacebook ? 'Facebook' : isYoutube ? 'YouTube' : isTiktok ? 'TikTok' : 'Platform';
                console.log(`Using custom cookies for ${platformName}`);
            } else if (!cookiePath && fs.existsSync(path.join(app.getPath('userData'), 'cookies.txt'))) {
                args.push('--cookies', path.join(app.getPath('userData'), 'cookies.txt'));
            }

            if (formatId && formatId.startsWith('audio_')) {
                // Ensure FFmpeg is available for conversion
                await ensureFFmpeg();

                let quality = '5'; // Standard default
                if (formatId === 'audio_best') quality = '0';
                if (formatId === 'audio_low') quality = '9';

                args.push('-x', '--audio-format', 'mp3', '--audio-quality', quality);
                // Let yt-dlp write + embed the best thumbnail (for music /
                // "Topic" videos this is the square album cover). node-id3 is
                // no longer used for the YouTube path.
                args.push('--write-thumbnail', '--convert-thumbnails', 'jpg', '--embed-thumbnail');
            } else {
                // Ensure FFmpeg is available for merging video/audio
                await ensureFFmpeg();

                if (isLiveDownload) {
                    // Live broadcast: record the single live format stream until
                    // the user stops it or the stream ends (no merge needed).
                    args.push('-f', 'best');
                } else {
                    // FORCE MP4 and H264 priority
                    args.push('--merge-output-format', 'mp4');

                    if (formatId && formatId !== 'best') {
                        args.push('-f', `${formatId}+bestaudio/best`);
                    } else {
                        args.push('-S', 'res,ext:mp4:m4a,vcodec:h264,acodec:aac');
                    }
                }
            }

            args.push('--progress', '--newline');

            // Ensure we use our own FFmpeg if available, or fall back to system
            if (isFfmpegAvailable()) {
                const ffmpegPath = getFfmpegBinaryPath();
                if (fs.existsSync(ffmpegPath)) {
                    const ffmpegDir = path.dirname(ffmpegPath);
                    args.push('--ffmpeg-location', ffmpegDir);
                    console.log('Using integrated FFmpeg at:', ffmpegDir);
                } else {
                    console.log('Using system FFmpeg');
                }
            }

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

            console.log("Starting download with args:", args);
            console.log("Saving to:", downloadPath);


            const ytDlpEventEmitter = ytDlpWrap.exec(args);

            const jobHandle: ActiveJob = { cancelled: false };
            jobHandle.proc = ytDlpEventEmitter;
            if (jobId) activeJobs.set(jobId, jobHandle);

            ytDlpEventEmitter.on('progress', (progress: any) => {
                // Ensure percent is a number and valid
                const percent = typeof progress.percent === 'number' ? progress.percent : parseFloat(progress.percent) || 0;

                mainWindow?.webContents.send('download-progress', {
                    percent: percent,
                    totalSize: progress.totalSize || '...',
                    currentSpeed: progress.currentSpeed || '...',
                    eta: progress.eta || '...',
                    downloaded: progress.downloadedSize || '...',
                    isLive: isLiveDownload,
                    jobId
                });
            });

            // Resolve only after yt-dlp actually finishes, so callers (e.g.
            // playlist bulk download) know when the file is really done.
            return await new Promise<{ success: boolean; path?: string }>((resolve, reject) => {
                let settled = false;
                let failed = false;

                ytDlpEventEmitter.on('error', (error: any) => {
                    console.error("Download Error", error);
                    failed = true;
                    mainWindow?.webContents.send('download-progress', { error: error.message, jobId });
                    if (!settled) { settled = true; reject(new Error(error.message)); }
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
                        await recodeVideoToH264(actualFilePath);
                    }

                    // Cut the finished file down to [cutStart, cutEnd] if requested.
                    let displayPath = actualFilePath;
                    if (isCutDownload && fs.existsSync(actualFilePath)) {
                        mainWindow?.webContents.send('download-progress', { percent: 95, currentSpeed: 'Cutting segment...', jobId });
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
                    if (isAudioDownload && artPromise && fs.existsSync(finalFilePath)) {
                        const art = await artPromise;
                        if (art) {
                            console.log('Upgrading cover to YouTube Music album art:', art.substring(0, 50) + '...');
                            const info = await saveThumbnailTemp(art);
                            if (info) {
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

                    if (!settled) { settled = true; resolve({ success: true, path: displayPath }); }
                });
            });
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

    ipcMain.handle('download-spotify-track', async (event: any, { searchQuery, title, artist, thumbnail, playlistTitle, suppressNotifications, jobId }) => {
        registerDownloadStart();
        try {
            // Ensure FFmpeg is available for conversion
            await ensureFFmpeg();

            console.log(`Searching YouTube for: ${searchQuery}`);
            const mainWindow = getMainWindow();
            const ytDlpWrap = getYtDlpWrap();
            // Search top 3 results so yt-dlp picks the best relevance match
            const ytSearchUrl = `ytsearch3:${searchQuery}`;

            // Playlist tracks go in Spotify/Playlists/<playlist name>/, single
            // tracks go in Spotify/Tracks/.
            const isPlaylist = !!playlistTitle;
            const downloadPath = getOrganizedPath('spotify', isPlaylist ? 'playlist' : 'track', playlistTitle);
            const safeTitle = `${artist} - ${title}`.replace(/[^a-zA-Z0-9 \-_]/g, '').trim();
            const outputTemplate = path.join(downloadPath, `${safeTitle}.%(ext)s`);

            const args = [
                ytSearchUrl,
                '--js-runtimes', 'node',
                '--extractor-args', 'youtube:player_client=tv_embedded',
                '--no-check-certificates',
                '-x', '--audio-format', 'mp3', '--audio-quality', '0',
                '-o', outputTemplate,
                '--no-playlist',
                '--playlist-items', '1',
                '--progress', '--newline',
                '--concurrent-fragments', '16'
            ];

            // Pass ffmpeg location to yt-dlp so it can find ffprobe/ffmpeg
            if (isFfmpegAvailable()) {
                const ffmpegPath = getFfmpegBinaryPath();
                if (fs.existsSync(ffmpegPath)) {
                    args.push('--ffmpeg-location', path.dirname(ffmpegPath));
                }
            }

            const ytDlpEventEmitter = ytDlpWrap.exec(args);

            ytDlpEventEmitter.on('progress', (progress: any) => {
                const percent = typeof progress.percent === 'number' ? progress.percent : parseFloat(progress.percent) || 0;
                mainWindow?.webContents.send('download-progress', {
                    percent: percent,
                    totalSize: progress.totalSize || '...',
                    currentSpeed: progress.currentSpeed || '...',
                    eta: progress.eta || '...',
                    downloaded: progress.downloadedSize || '...',
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

                    const finalFilePath = path.join(downloadPath, `${safeTitle}.mp3`);
                    console.log("Spotify download process closed, finalizing:", finalFilePath);

                    // Wait a tiny bit for file to be released
                    await new Promise(r => setTimeout(r, 500));

                    let notificationThumbPath: string | undefined;

                    // Embed thumbnail logic with retry and longer timeout
                    try {
                        if (thumbnail) {
                            console.log('Fetching Spotify thumbnail (with retry):', thumbnail.slice(0, 60));

                            const axios = require('axios');
                            try {
                                const response = await axios.get(thumbnail, {
                                    responseType: 'arraybuffer',
                                    timeout: 3000,
                                    headers: {
                                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
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
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
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
