
import { ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { getYtDlpWrap, ensureFFmpeg, getFfmpegBinaryPath } from '../utils/binaries';
import { getOrganizedPath, getCookiePath } from '../utils/paths';
import { getMainWindow } from '../utils/windowManager';
import { showNotification } from '../utils/notifications';

export function registerDownloadHandlers() {
    ipcMain.handle('download-video', async (event: any, { url, formatId, title, platform, contentType }: { url: any, formatId: any, title: any, platform?: string, contentType?: string }) => {
        try {
            const mainWindow = getMainWindow();
            const ytDlpWrap = getYtDlpWrap();

            // Detect platform and content type from URL if not provided
            const isInstagram = url.includes('instagram.com') || url.includes('instagr.am');
            const isFacebook = url.includes('facebook.com') || url.includes('fb.watch') || url.includes('fb.com');
            const isYoutube = url.includes('youtube.com') || url.includes('youtu.be');
            const isTiktok = url.includes('tiktok.com');
            const isSpotify = url.includes('spotify.com');
            const isPinterest = url.includes('pinterest.com') || url.includes('pin.it');
            const isSoundcloud = url.includes('soundcloud.com');
            const isX = url.includes('twitter.com') || url.includes('x.com');

            // Determine platform
            let detectedPlatform = platform || 'youtube';
            if (isInstagram) detectedPlatform = 'instagram';
            else if (isFacebook) detectedPlatform = 'facebook';
            else if (isYoutube) detectedPlatform = 'youtube';
            else if (isTiktok) detectedPlatform = 'tiktok';
            else if (isSpotify) detectedPlatform = 'spotify';
            else if (isPinterest) detectedPlatform = 'pinterest';
            else if (isSoundcloud) detectedPlatform = 'soundcloud';
            else if (isX) detectedPlatform = 'x';

            // Determine content type from URL patterns
            let detectedContentType = contentType || 'video';
            if (formatId && formatId.startsWith('audio_')) {
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
            }

            // Get organized download path
            const downloadPath = getOrganizedPath(detectedPlatform, detectedContentType);
            const safeTitle = title.replace(/[^a-zA-Z0-9 \-_]/g, '').trim();
            const ext = (formatId && formatId.startsWith('audio_') ? 'mp3' : 'mp4');
            const outputTemplate = path.join(downloadPath, `${safeTitle}.%(ext)s`);

            const args = [
                url,
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

            // Add User-Agent to help with Facebook/Instagram
            args.push('--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');

            if (cookiePath && fs.existsSync(cookiePath)) {
                args.push('--cookies', cookiePath);
                const platformName = isInstagram ? 'Instagram' : isFacebook ? 'Facebook' : isYoutube ? 'YouTube' : 'TikTok';
                console.log(`Using custom cookies for ${platformName}`);
            } else if (!cookiePath && fs.existsSync(path.join(app.getPath('userData'), 'cookies.txt'))) {
                args.push('--cookies', path.join(app.getPath('userData'), 'cookies.txt'));
            }

            if (formatId && formatId.startsWith('audio_')) {
                let quality = '5'; // Standard default
                if (formatId === 'audio_best') quality = '0';
                if (formatId === 'audio_low') quality = '9';

                args.push('-x', '--audio-format', 'mp3', '--audio-quality', quality);

                // Try to embed thumbnail if FFmpeg is available
                const hasFFmpeg = await ensureFFmpeg();
                if (hasFFmpeg) {
                    args.push('--embed-thumbnail');
                    args.push('--add-metadata');
                    // Tell yt-dlp where FFmpeg is located
                    const ffmpegDir = path.dirname(getFfmpegBinaryPath());
                    args.push('--ffmpeg-location', ffmpegDir);
                    console.log('FFmpeg available, will embed thumbnail');
                } else {
                    console.log('FFmpeg not available, skipping thumbnail embedding');
                }
            } else {
                // FORCE MP4 and H264 priority
                // Use --merge-output-format mp4 to ensure WebM streams are converted/merged to MP4
                args.push('--merge-output-format', 'mp4');

                if (formatId && formatId !== 'best') {
                    args.push('-f', `${formatId}+bestaudio/best`);
                } else {
                    // User suggested fix: Sort h264/aac mp4 formats ahead of others
                    args.push('-S', 'vcodec:h264,res,acodec:m4a');
                }
            }

            console.log("Starting download with args:", args);
            console.log("Saving to:", downloadPath);

            const ytDlpEventEmitter = ytDlpWrap.exec(args);

            ytDlpEventEmitter.on('progress', (progress: any) => {
                mainWindow?.webContents.send('download-progress', {
                    percent: progress.percent || 0,
                    totalSize: progress.totalSize,
                    currentSpeed: progress.currentSpeed,
                    eta: progress.eta || '...'
                });
            });

            ytDlpEventEmitter.on('error', (error: any) => {
                console.error("Download Error", error);
                mainWindow?.webContents.send('download-progress', { error: error.message });
                // Show error notification
                showNotification('Download Failed', `Failed to download: ${safeTitle}`);
            });

            ytDlpEventEmitter.on('close', () => {
                console.log("Download complete:", safeTitle);
                mainWindow?.webContents.send('download-progress', {
                    complete: true,
                    title: safeTitle,
                    path: downloadPath
                });
                // Show success notification
                showNotification('Download Complete! ✅', `${safeTitle} saved to ${detectedPlatform}/${detectedContentType}`);
            });

            return { success: true };
        } catch (e: any) {
            console.error("Main Error", e);
            showNotification('Download Failed', e.message);
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('download-spotify-track', async (event: any, { searchQuery, title, artist }: { searchQuery: any, title: any, artist: any }) => {
        try {
            console.log(`Searching YouTube for: ${searchQuery}`);
            const mainWindow = getMainWindow();
            const ytDlpWrap = getYtDlpWrap();

            // Search YouTube for the track
            const ytSearchUrl = `ytsearch1:${searchQuery}`;

            // Use organized path for Spotify tracks
            const downloadPath = getOrganizedPath('spotify', 'track');
            const safeTitle = `${artist} - ${title}`.replace(/[^a-zA-Z0-9 \-_]/g, '').trim();
            const outputTemplate = path.join(downloadPath, `${safeTitle}.%(ext)s`);

            const args = [
                ytSearchUrl,
                '-x',
                '--audio-format', 'mp3',
                '--audio-quality', '0',
                '-o', outputTemplate,
                '--no-playlist'
            ];

            // Try to embed thumbnail if FFmpeg is available
            const hasFFmpeg = await ensureFFmpeg();
            if (hasFFmpeg) {
                args.push('--embed-thumbnail');
                args.push('--add-metadata');
                const ffmpegDir = path.dirname(getFfmpegBinaryPath());
                args.push('--ffmpeg-location', ffmpegDir);
                console.log('FFmpeg available for Spotify, will embed thumbnail');
            }

            console.log("Starting Spotify->YouTube download with args:", args);
            console.log("Saving to:", downloadPath);
            const ytDlpEventEmitter = ytDlpWrap.exec(args);

            ytDlpEventEmitter.on('progress', (progress: any) => {
                mainWindow?.webContents.send('download-progress', {
                    percent: progress.percent || 0,
                    totalSize: progress.totalSize,
                    currentSpeed: progress.currentSpeed,
                    eta: progress.eta || '...'
                });
            });

            ytDlpEventEmitter.on('error', (error: any) => {
                console.error("Spotify Download Error", error);
                mainWindow?.webContents.send('download-progress', { error: error.message });
                showNotification('Download Failed', `Failed to download: ${safeTitle}`);
            });

            ytDlpEventEmitter.on('close', () => {
                console.log("Spotify download completed:", safeTitle);
                mainWindow?.webContents.send('download-progress', {
                    complete: true,
                    title: safeTitle,
                    path: downloadPath
                });
                showNotification('Download Complete! ✅', `${safeTitle} saved to Spotify/Tracks`);
            });

            return { success: true };
        } catch (e: any) {
            console.error("Spotify download error:", e);
            showNotification('Download Failed', e.message);
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('save-thumbnail', async (event: any, { url, title }: { url: string, title: string }) => {
        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            if (!response.ok) throw new Error('Failed to fetch thumbnail');

            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            const safeTitle = title.replace(/[^a-zA-Z0-9 \-_]/g, '').trim();
            const downloadPath = app.getPath('downloads');
            const ext = response.headers.get('content-type')?.includes('png') ? 'png' : 'jpg';
            const filePath = path.join(downloadPath, `${safeTitle}_thumbnail.${ext}`);

            fs.writeFileSync(filePath, buffer);
            const shell = require('electron').shell;
            shell.showItemInFolder(filePath);

            return { success: true, path: filePath };
        } catch (e: any) {
            console.error('Thumbnail save error:', e);
            return { success: false, error: e.message };
        }
    });
}
