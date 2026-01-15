
import { ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
// @ts-ignore
import NodeID3 from 'node-id3';
import { getYtDlpWrap, ensureFFmpeg, getFfmpegBinaryPath, isFfmpegAvailable } from '../utils/binaries';
import { getOrganizedPath, getCookiePath } from '../utils/paths';
import { getMainWindow } from '../utils/windowManager';
import { showNotification } from '../utils/notifications';

export function registerDownloadHandlers() {
    ipcMain.handle('download-video', async (event: any, { url, formatId, title, platform, contentType, thumbnail, playlistTitle }: { url: any, formatId: any, title: any, platform?: string, contentType?: string, thumbnail?: string, playlistTitle?: string }) => {
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
            const downloadPath = getOrganizedPath(detectedPlatform, detectedContentType, playlistTitle);
            const safeTitle = title.replace(/[^a-zA-Z0-9 \-_]/g, '').trim();
            const ext = (formatId && formatId.startsWith('audio_') ? 'mp3' : 'mp4');
            const outputTemplate = path.join(downloadPath, `${safeTitle}.%(ext)s`);

            const args = [
                url,
                '--js-runtimes', 'node',
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
                // Ensure FFmpeg is available for conversion
                await ensureFFmpeg();

                let quality = '5'; // Standard default
                if (formatId === 'audio_best') quality = '0';
                if (formatId === 'audio_low') quality = '9';

                args.push('-x', '--audio-format', 'mp3', '--audio-quality', quality);
                // We will handle thumbnail embedding manually using node-id3
                console.log('Using node-id3 for thumbnail embedding');
            } else {
                // Ensure FFmpeg is available for merging video/audio
                await ensureFFmpeg();

                // FORCE MP4 and H264 priority
                args.push('--merge-output-format', 'mp4');

                if (formatId && formatId !== 'best') {
                    args.push('-f', `${formatId}+bestaudio/best`);
                } else {
                    args.push('-S', 'vcodec:h264,res,acodec:m4a');
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

            // Save thumbnail for notification/embedding
            let thumbPath: string | undefined;
            let thumbMime = 'image/jpeg';
            if (thumbnail) {
                try {
                    console.log('Fetching thumbnail for embedding/notification:', thumbnail.substring(0, 50) + '...');
                    const response = await fetch(thumbnail, {
                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                    });
                    if (response.ok) {
                        const contentType = response.headers.get('content-type');
                        if (contentType) thumbMime = contentType;

                        const arrayBuffer = await response.arrayBuffer();
                        const buffer = Buffer.from(arrayBuffer);

                        const ext = thumbMime.includes('webp') ? 'webp' : thumbMime.includes('png') ? 'png' : 'jpg';
                        thumbPath = path.join(app.getPath('temp'), `vibe_thumb_${Date.now()}.${ext}`);
                        fs.writeFileSync(thumbPath, buffer);
                        console.log(`Saved temporary thumbnail (${thumbMime}) to:`, thumbPath);
                    } else {
                        console.error('Failed to fetch thumbnail:', response.statusText);
                    }
                } catch (e) {
                    console.error("Failed to save notification thumbnail:", e);
                }
            }

            // Speed up downloads with parallel fragments
            args.push('--concurrent-fragments', '16');

            const finalFilePath = path.join(downloadPath, `${safeTitle}.${ext}`);

            console.log("Starting download with args:", args);
            console.log("Saving to:", downloadPath);

            const ytDlpEventEmitter = ytDlpWrap.exec(args);

            ytDlpEventEmitter.on('progress', (progress: any) => {
                // Ensure percent is a number and valid
                const percent = typeof progress.percent === 'number' ? progress.percent : parseFloat(progress.percent) || 0;

                mainWindow?.webContents.send('download-progress', {
                    percent: percent,
                    totalSize: progress.totalSize || '...',
                    currentSpeed: progress.currentSpeed || '...',
                    eta: progress.eta || '...',
                    downloaded: progress.downloadedSize || '...'
                });
            });

            ytDlpEventEmitter.on('error', (error: any) => {
                console.error("Download Error", error);
                mainWindow?.webContents.send('download-progress', { error: error.message });
                // Show error notification
                showNotification('Download Failed', `Failed to download: ${safeTitle}`);
            });

            ytDlpEventEmitter.on('close', async () => {
                console.log("Download complete event for:", safeTitle);

                // Wait a tiny bit for file to be released
                await new Promise(r => setTimeout(r, 500));

                // Embed thumbnail if it's an audio file and we have a thumbnail
                const isAudioDownload = formatId && (formatId.startsWith('audio_') || formatId === 'audio');
                if (isAudioDownload && thumbPath && fs.existsSync(thumbPath) && fs.existsSync(finalFilePath)) {
                    try {
                        console.log("Attempting to embed thumbnail in:", finalFilePath);
                        const imageBuffer = fs.readFileSync(thumbPath);
                        const tags = {
                            title: safeTitle,
                            image: {
                                mime: thumbMime,
                                type: { id: 3, name: "front cover" },
                                description: "Cover",
                                imageBuffer: imageBuffer
                            }
                        };
                        const success = NodeID3.update(tags, finalFilePath);
                        console.log("Thumbnail embedding result:", success);
                    } catch (e) {
                        console.error("Failed to write ID3 tags (node-id3):", e);
                    }
                }

                mainWindow?.webContents.send('download-progress', {
                    complete: true,
                    title: safeTitle,
                    path: finalFilePath
                });

                showNotification(
                    'Download Complete! ✅',
                    `${safeTitle} saved to ${detectedPlatform}/${detectedContentType}`,
                    thumbPath,
                    finalFilePath
                );
            });

            return { success: true };
        } catch (e: any) {
            console.error("Main Error", e);
            showNotification('Download Failed', e.message);
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('download-spotify-track', async (event: any, { searchQuery, title, artist, thumbnail, playlistTitle }) => {
        try {
            // Ensure FFmpeg is available for conversion
            await ensureFFmpeg();

            console.log(`Searching YouTube for: ${searchQuery}`);
            const mainWindow = getMainWindow();
            const ytDlpWrap = getYtDlpWrap();
            const ytSearchUrl = `ytsearch1:${searchQuery}`;

            const downloadPath = getOrganizedPath('spotify', 'track', playlistTitle);
            const safeTitle = `${artist} - ${title}`.replace(/[^a-zA-Z0-9 \-_]/g, '').trim();
            const outputTemplate = path.join(downloadPath, `${safeTitle}.%(ext)s`);

            const args = [
                ytSearchUrl,
                '--js-runtimes', 'node',
                '-x', '--audio-format', 'mp3', '--audio-quality', '0',
                '-o', outputTemplate,
                '--no-playlist',
                '--progress', '--newline',
                '--concurrent-fragments', '16'
            ];

            const ytDlpEventEmitter = ytDlpWrap.exec(args);

            ytDlpEventEmitter.on('progress', (progress: any) => {
                const percent = typeof progress.percent === 'number' ? progress.percent : parseFloat(progress.percent) || 0;
                mainWindow?.webContents.send('download-progress', {
                    percent: percent,
                    totalSize: progress.totalSize || '...',
                    currentSpeed: progress.currentSpeed || '...',
                    eta: progress.eta || '...',
                    downloaded: progress.downloadedSize || '...'
                });
            });

            ytDlpEventEmitter.on('error', (error: any) => {
                console.error("Spotify Download Error", error);
                mainWindow?.webContents.send('download-progress', { error: error.message });
                showNotification('Download Failed', `Failed to download: ${safeTitle}`);
            });

            ytDlpEventEmitter.on('close', async () => {
                const finalFilePath = path.join(downloadPath, `${safeTitle}.mp3`);
                console.log("Spotify download process closed, finalizing:", finalFilePath);

                // Wait a tiny bit for file to be released
                await new Promise(r => setTimeout(r, 500));

                let notificationThumbPath: string | undefined;

                // Embed thumbnail logic...
                try {
                    if (thumbnail) {
                        console.log('Fetching Spotify thumbnail...');
                        const response = await fetch(thumbnail, {
                            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                        });
                        if (response.ok) {
                            const contentType = response.headers.get('content-type') || 'image/jpeg';
                            const buffer = await response.arrayBuffer();
                            const imageBuffer = Buffer.from(buffer);

                            // Save temp for notification
                            const ext = contentType.includes('webp') ? 'webp' : contentType.includes('png') ? 'png' : 'jpg';
                            notificationThumbPath = path.join(app.getPath('temp'), `spotify_thumb_${Date.now()}.${ext}`);
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
                            const success = NodeID3.update(tags, finalFilePath);
                            console.log("Spotify thumbnail embedding result:", success);
                        }
                    }
                } catch (e) {
                    console.error("Failed to embed Spotify thumbnail:", e);
                }

                mainWindow?.webContents.send('download-progress', {
                    complete: true,
                    title: safeTitle,
                    path: finalFilePath
                });
                showNotification('Download Complete! ✅', `${safeTitle} saved to Spotify/Tracks`, notificationThumbPath, finalFilePath);
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
