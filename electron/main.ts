// Use basic require to avoid TypeScript/transpilation issues with Electron module
/* eslint-disable @typescript-eslint/no-var-requires */
const electron = require('electron');
const { app, BrowserWindow, ipcMain, shell, Notification, dialog } = electron;
import path from 'path';
import YtDlpWrap from 'yt-dlp-wrap';
import fs from 'fs';
import { autoUpdater } from 'electron-updater';

// Configure auto-updater
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

let userDataPath: string;
let ytDlpBinaryPath: string;
let ytDlpWrap: YtDlpWrap;

// Settings storage
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

interface AppSettings {
    downloadBasePath: string;
}

function loadSettings(): AppSettings {
    try {
        if (fs.existsSync(settingsPath())) {
            return JSON.parse(fs.readFileSync(settingsPath(), 'utf-8'));
        }
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
    return { downloadBasePath: app.getPath('downloads') };
}

function saveSettings(settings: AppSettings) {
    try {
        fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf-8');
    } catch (e) {
        console.error('Failed to save settings:', e);
    }
}

// Get organized download path based on platform and content type
function getOrganizedPath(platform: string, contentType: string): string {
    const settings = loadSettings();
    const basePath = settings.downloadBasePath || app.getPath('downloads');

    // Map content types to folder names
    const contentFolders: Record<string, string> = {
        'video': 'Videos',
        'audio': 'Audio',
        'reel': 'Reels',
        'reels': 'Reels',
        'story': 'Stories',
        'stories': 'Stories',
        'playlist': 'Playlists',
        'thumbnail': 'Thumbnails',
        'photo': 'Photos',
        'shorts': 'Shorts',
        'post': 'Posts',
        'track': 'Tracks',
        'album': 'Albums'
    };

    // Map platforms to folder names
    const platformFolders: Record<string, string> = {
        'youtube': 'YouTube',
        'instagram': 'Instagram',
        'tiktok': 'TikTok',
        'facebook': 'Facebook',
        'spotify': 'Spotify',
        'x': 'X (Twitter)',
        'pinterest': 'Pinterest',
        'soundcloud': 'SoundCloud'
    };

    const platformFolder = platformFolders[platform.toLowerCase()] || platform;
    const contentFolder = contentFolders[contentType.toLowerCase()] || 'Videos';

    const fullPath = path.join(basePath, 'VibeDownloader', platformFolder, contentFolder);

    // Create directories if they don't exist
    if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
    }

    return fullPath;
}

// Show native notification
function showNotification(title: string, body: string) {
    if (Notification.isSupported()) {
        new Notification({ title, body }).show();
    }
}

async function ensureYtDlp() {
    if (fs.existsSync(ytDlpBinaryPath)) {
        const stats = fs.statSync(ytDlpBinaryPath);
        if (stats.size < 1024 * 1024) {
            console.log("yt-dlp binary seems corrupted (too small), deleting to redownload...");
            fs.unlinkSync(ytDlpBinaryPath);
        }
    }

    if (!fs.existsSync(ytDlpBinaryPath)) {
        console.log("Downloading yt-dlp binary to " + ytDlpBinaryPath);
        try {
            await YtDlpWrap.downloadFromGithub(ytDlpBinaryPath);
            console.log("Downloaded yt-dlp binary.");
            if (fs.existsSync(ytDlpBinaryPath)) {
                const stats = fs.statSync(ytDlpBinaryPath);
                if (stats.size < 1024 * 1024) throw new Error("Downloaded binary is too small");
            }
        } catch (e) {
            console.error("Error downloading yt-dlp:", e);
            throw e;
        }
    }
}

// FFmpeg on-demand download for audio thumbnail embedding
let ffmpegBinaryPath: string = '';
let ffmpegAvailable = false;

async function downloadFFmpeg(): Promise<boolean> {
    const AdmZip = require('adm-zip');
    const https = require('https');

    // Download FFmpeg essentials build (much smaller than full build ~25MB vs ~100MB)
    const ffmpegUrl = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
    const tempZipPath = path.join(app.getPath('userData'), 'ffmpeg-temp.zip');
    const ffmpegDir = path.join(app.getPath('userData'), 'ffmpeg');

    console.log('Downloading FFmpeg...');

    return new Promise((resolve) => {
        const file = fs.createWriteStream(tempZipPath);

        const downloadWithRedirects = (url: string, redirectCount = 0) => {
            if (redirectCount > 5) {
                console.error('Too many redirects');
                resolve(false);
                return;
            }

            https.get(url, (response: any) => {
                // Handle redirects
                if (response.statusCode === 301 || response.statusCode === 302) {
                    const redirectUrl = response.headers.location;
                    console.log('Redirecting to:', redirectUrl);
                    downloadWithRedirects(redirectUrl, redirectCount + 1);
                    return;
                }

                if (response.statusCode !== 200) {
                    console.error('FFmpeg download failed with status:', response.statusCode);
                    resolve(false);
                    return;
                }

                response.pipe(file);

                file.on('finish', () => {
                    file.close();
                    console.log('FFmpeg downloaded, extracting...');

                    try {
                        const zip = new AdmZip(tempZipPath);
                        const zipEntries = zip.getEntries();

                        // Find ffmpeg.exe in the zip
                        const ffmpegEntry = zipEntries.find((entry: any) =>
                            entry.entryName.endsWith('bin/ffmpeg.exe')
                        );

                        if (ffmpegEntry) {
                            if (!fs.existsSync(ffmpegDir)) {
                                fs.mkdirSync(ffmpegDir, { recursive: true });
                            }

                            const ffmpegData = zip.readFile(ffmpegEntry);
                            fs.writeFileSync(path.join(ffmpegDir, 'ffmpeg.exe'), ffmpegData);

                            // Also extract ffprobe if available
                            const ffprobeEntry = zipEntries.find((entry: any) =>
                                entry.entryName.endsWith('bin/ffprobe.exe')
                            );
                            if (ffprobeEntry) {
                                const ffprobeData = zip.readFile(ffprobeEntry);
                                fs.writeFileSync(path.join(ffmpegDir, 'ffprobe.exe'), ffprobeData);
                            }

                            console.log('FFmpeg extracted successfully');
                            ffmpegAvailable = true;

                            // Clean up temp zip
                            fs.unlinkSync(tempZipPath);
                            resolve(true);
                        } else {
                            console.error('ffmpeg.exe not found in zip');
                            resolve(false);
                        }
                    } catch (e) {
                        console.error('Failed to extract FFmpeg:', e);
                        resolve(false);
                    }
                });
            }).on('error', (err: any) => {
                console.error('FFmpeg download error:', err);
                fs.unlinkSync(tempZipPath);
                resolve(false);
            });
        };

        downloadWithRedirects(ffmpegUrl);
    });
}

async function ensureFFmpeg(): Promise<boolean> {
    if (ffmpegAvailable && fs.existsSync(ffmpegBinaryPath)) {
        return true;
    }

    // Check if FFmpeg already exists
    if (fs.existsSync(ffmpegBinaryPath)) {
        const stats = fs.statSync(ffmpegBinaryPath);
        if (stats.size > 10 * 1024 * 1024) { // FFmpeg should be at least 10MB
            ffmpegAvailable = true;
            return true;
        }
    }

    // Download FFmpeg
    console.log('FFmpeg not found, downloading...');
    mainWindow?.webContents.send('download-progress', {
        status: 'Downloading FFmpeg for audio processing... (one-time setup)'
    });

    const success = await downloadFFmpeg();
    if (success) {
        showNotification('FFmpeg Ready', 'Audio files will now include cover art!');
    }
    return success;
}


// Define explicit type for TypeScript
let mainWindow: InstanceType<typeof BrowserWindow> | null;

function createWindow() {
    // Get the icon path based on environment
    const iconPath = app.isPackaged
        ? path.join(process.resourcesPath, 'build', 'icon.png')
        : path.join(__dirname, '..', 'build', 'icon.png');

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        frame: false,
        transparent: true,
        icon: iconPath,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
        backgroundColor: '#00000000'
    });

    const isDev = !app.isPackaged;

    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    mainWindow.setMenu(null);

    // Open external links in browser
    mainWindow.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });
}

app.whenReady().then(async () => {
    // Initialize paths after app is ready
    userDataPath = app.getPath('userData');
    ytDlpBinaryPath = path.join(userDataPath, 'yt-dlp.exe');
    ffmpegBinaryPath = path.join(userDataPath, 'ffmpeg', 'ffmpeg.exe');
    ytDlpWrap = new YtDlpWrap(ytDlpBinaryPath);

    try {
        await ensureYtDlp();
    } catch (e) {
        console.error("Failed to ensure yt-dlp binary:", e);
    }

    // Check if FFmpeg already exists (don't download yet, just check)
    if (fs.existsSync(ffmpegBinaryPath)) {
        const stats = fs.statSync(ffmpegBinaryPath);
        if (stats.size > 10 * 1024 * 1024) {
            ffmpegAvailable = true;
            console.log('FFmpeg found:', ffmpegBinaryPath);
        }
    }

    createWindow();

    // Initialize auto-updater (only in production)
    if (app.isPackaged) {
        setupAutoUpdater();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('minimize-window', () => mainWindow?.minimize());
ipcMain.handle('maximize-window', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
});
ipcMain.handle('close-window', () => mainWindow?.close());

// Download Path Management
ipcMain.handle('get-download-path', async () => {
    const settings = loadSettings();
    return { path: settings.downloadBasePath };
});

ipcMain.handle('choose-download-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openDirectory'],
        title: 'Choose Download Location'
    });

    if (!result.canceled && result.filePaths.length > 0) {
        const settings = loadSettings();
        settings.downloadBasePath = result.filePaths[0];
        saveSettings(settings);
        return { path: result.filePaths[0] };
    }
    return { path: null };
});

// Cookie Management
const cookiesDir = path.join(app.getPath('userData'), 'cookies');
if (!fs.existsSync(cookiesDir)) fs.mkdirSync(cookiesDir, { recursive: true });


function getCookiePath(platform: string) {
    return path.join(cookiesDir, `cookies_${platform}.txt`);
}

ipcMain.handle('save-cookies', async (event: any, content: string, platform: string = 'instagram') => {
    try {
        if (!content || !content.trim()) {
            return { success: false, error: "Empty cookie content" };
        }
        const targetPath = getCookiePath(platform);
        const dir = path.dirname(targetPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        // Save cleaned content
        fs.writeFileSync(targetPath, content.trim(), 'utf-8');
        console.log(`Cookies saved to ${targetPath} for ${platform}`);
        return { success: true };
    } catch (e: any) {
        console.error('Failed to save cookies:', e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('get-cookies-status', async (event: any, platform: string = 'instagram') => {
    try {
        const targetPath = getCookiePath(platform);
        if (fs.existsSync(targetPath)) {
            const stats = fs.statSync(targetPath);
            return { exists: stats.size > 0, path: targetPath };
        }
        return { exists: false };
    } catch (e) {
        return { exists: false };
    }
});

ipcMain.handle('delete-cookies', async (event: any, platform: string = 'instagram') => {
    try {
        const targetPath = getCookiePath(platform);
        if (fs.existsSync(targetPath)) {
            fs.unlinkSync(targetPath);
        }
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('get-video-info', async (event: any, url: any) => {
    if (!url) return { success: false, error: "No URL provided" };
    console.log(`Fetching info for ${url}...`);

    try {
        const hasListParam = url.includes('list=');
        const isRadioMix = url.includes('start_radio=1') || url.includes('list=RD') || url.includes('list=RDMM');
        const isRegularPlaylist = hasListParam && !isRadioMix && (url.includes('/playlist') || !url.includes('watch?v='));

        const args = [
            url,
            '--dump-single-json',
            '--no-warnings',
            '--socket-timeout', '15'
        ];

        // Add cookies if available for the specific platform
        let cookiePath = null;
        const isInstagram = url.includes('instagram.com') || url.includes('instagr.am');
        const isFacebook = url.includes('facebook.com') || url.includes('fb.watch') || url.includes('fb.com');
        const isYoutube = url.includes('youtube.com') || url.includes('youtu.be');
        const isTiktok = url.includes('tiktok.com');

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

        // STRICT SEPARATION: Only use cookies for the specific platform
        if (cookiePath && fs.existsSync(cookiePath)) {
            args.push('--cookies', cookiePath);
            const platformName = isInstagram ? 'Instagram' : isFacebook ? 'Facebook' : isYoutube ? 'YouTube' : 'TikTok';
            console.log(`Using custom cookies for ${platformName} (Path: ${cookiePath})`);
        } else if (!cookiePath && fs.existsSync(path.join(app.getPath('userData'), 'cookies.txt'))) {
            // Only fall back to legacy cookies.txt if strict platform cookies are NOT expected
            // For generic sites, we can use legacy. For FB/Insta, we rely on their specific files.
            args.push('--cookies', path.join(app.getPath('userData'), 'cookies.txt'));
            console.log('Using legacy cookies.txt');
        }

        if (isRadioMix) {
            args.push('--no-playlist');
        } else if (isRegularPlaylist) {
            args.push('--flat-playlist');
            args.push('--playlist-items', '1:50');
        } else if (hasListParam && url.includes('watch?v=')) {
            args.push('--no-playlist');
        }

        const ytDlpPromise = ytDlpWrap.execPromise(args);
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Request timed out')), 45000);
        });

        const metadataString = await Promise.race([ytDlpPromise, timeoutPromise]) as string;
        const raw = JSON.parse(metadataString);

        let contentType = 'video';
        if (url.includes('/stories/') || url.includes('/story/')) {
            contentType = 'story';
        } else if (raw._type === 'playlist' || (raw.entries && raw.entries.length > 0)) {
            contentType = 'playlist';
        }

        let thumbnail = raw.thumbnail;
        if (!thumbnail && raw.thumbnails && raw.thumbnails.length > 0) {
            const sorted = [...raw.thumbnails].sort((a: any, b: any) => (b.width || 0) - (a.width || 0));
            thumbnail = sorted[0]?.url || raw.thumbnails[raw.thumbnails.length - 1]?.url;
        }

        if (!thumbnail && raw.entries && raw.entries.length > 0) {
            const first = raw.entries[0];
            thumbnail = first.thumbnail || (first.thumbnails ? first.thumbnails[0]?.url : '');
        }

        const metadata = {
            id: raw.id,
            title: raw.title || raw.fulltitle || 'Untitled',
            thumbnail: thumbnail || '',
            thumbnails: raw.thumbnails || [],
            uploader: raw.uploader || raw.channel || raw.creator || raw.uploader_id || 'Unknown',
            uploader_url: raw.uploader_url || raw.channel_url,
            channel_follower_count: raw.channel_follower_count,
            view_count: raw.view_count || 0,
            like_count: raw.like_count || 0,
            duration: raw.duration || 0,
            description: raw.description?.slice(0, 300) || '',
            formats: raw.formats || [],
            webpage_url: raw.webpage_url || url,
            contentType,
            entries: raw.entries?.map((e: any, i: number) => ({
                id: e.id,
                title: e.title || `Track ${i + 1}`,
                thumbnail: e.thumbnail || e.thumbnails?.[0]?.url || '',
                duration: e.duration || 0,
                url: e.url || e.webpage_url || `https://www.youtube.com/watch?v=${e.id}`
            })) || [],
            playlist_count: raw.playlist_count || raw.entries?.length || 0
        };

        return { success: true, metadata };
    } catch (e: any) {
        console.error("Info fetch error:", e);
        const rawError = e.message || e.stderr || String(e);
        let friendlyError = "Failed to fetch video info";

        if (rawError.includes('log in') || rawError.includes('login') || rawError.includes('authentication')) {
            friendlyError = "🔒 Login required. This content is private or requires authentication.";
        } else if (rawError.includes('Private video') || rawError.includes('private')) {
            friendlyError = "🔒 This video is private and cannot be accessed.";
        } else if (rawError.includes('Video unavailable') || rawError.includes('unavailable')) {
            friendlyError = "❌ This video is unavailable or has been removed.";
        } else if (rawError.includes('age') || rawError.includes('Age')) {
            friendlyError = "🔞 Age-restricted content. Login required to access.";
        } else if (rawError.includes('blocked') || rawError.includes('country')) {
            friendlyError = "🌍 This content is blocked in your region.";
        } else if (rawError.includes('not found') || rawError.includes('404')) {
            friendlyError = "🔍 Content not found. Check the URL and try again.";
        } else if (rawError.includes('timed out') || rawError.includes('timeout')) {
            friendlyError = "⏱️ Request timed out. Please try again.";
        } else if (rawError.includes('network') || rawError.includes('connection')) {
            friendlyError = "📶 Network error. Check your internet connection.";
        } else if (rawError.includes('Unsupported URL')) {
            if (url.includes('facebook.com/stories')) {
                friendlyError = "⚠️ Facebook Stories are currently not supported by the downloader. Support will be added in a future update.";
            } else {
                friendlyError = "❌ This URL is not supported.";
            }
        }

        return { success: false, error: friendlyError };
    }
});

ipcMain.handle('download-video', async (event: any, { url, formatId, title, platform, contentType }: { url: any, formatId: any, title: any, platform?: string, contentType?: string }) => {
    try {
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
        if (formatId === 'audio') {
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

        if (formatId === 'audio') {
            args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');

            // Try to embed thumbnail if FFmpeg is available
            const hasFFmpeg = await ensureFFmpeg();
            if (hasFFmpeg) {
                args.push('--embed-thumbnail');
                args.push('--add-metadata');
                // Tell yt-dlp where FFmpeg is located
                const ffmpegDir = path.dirname(ffmpegBinaryPath);
                args.push('--ffmpeg-location', ffmpegDir);
                console.log('FFmpeg available, will embed thumbnail');
            } else {
                console.log('FFmpeg not available, skipping thumbnail embedding');
            }
        } else {
            if (formatId && formatId !== 'best') {
                args.push('-f', `${formatId}+bestaudio/best`);
            } else {
                args.push('-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4] / b[ext=mp4]');
            }
        }

        console.log("Starting download with args:", args);
        console.log("Saving to:", downloadPath);

        let ytDlpEventEmitter = ytDlpWrap.exec(args);

        const currentDownloadState = {
            percent: 0,
            eta: '...'
        };

        ytDlpEventEmitter.on('progress', (progress: any) => {
            currentDownloadState.percent = progress.percent || 0 || 0;
            currentDownloadState.eta = progress.eta || '...';
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
            // Show success notification (especially useful when minimized)
            showNotification('Download Complete! ✅', `${safeTitle} saved to ${detectedPlatform}/${detectedContentType}`);
        });

        return { success: true };
    } catch (e: any) {
        console.error("Main Error", e);
        showNotification('Download Failed', e.message);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('proxy-image', async (event: any, url: string) => {
    if (!url) return null;
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        return `data:${response.headers.get('content-type') || 'image/jpeg'};base64,${buffer.toString('base64')}`;
    } catch (e) {
        console.error("Image proxy error:", e);
        return null;
    }
});

// ============ SPOTIFY API INTEGRATION ============
const SPOTIFY_CLIENT_ID = '8bd6f4709ce348e7bfe9b564faf88ccb';
const SPOTIFY_CLIENT_SECRET = '8b84e063943e45c39528c37dbfed037d';

let spotifyAccessToken: string | null = null;
let spotifyTokenExpiry: number = 0;

async function getSpotifyToken(): Promise<string> {
    if (spotifyAccessToken && Date.now() < spotifyTokenExpiry) {
        return spotifyAccessToken;
    }

    console.log('Fetching new Spotify access token...');
    const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')
        },
        body: 'grant_type=client_credentials'
    });

    if (!response.ok) {
        throw new Error('Failed to get Spotify access token');
    }

    const data = await response.json();
    spotifyAccessToken = data.access_token;
    spotifyTokenExpiry = Date.now() + (data.expires_in * 1000) - 60000; // Refresh 1 min early
    console.log('Got Spotify access token');
    return spotifyAccessToken!;
}

async function spotifyApiRequest(endpoint: string): Promise<any> {
    const token = await getSpotifyToken();
    const response = await fetch(`https://api.spotify.com/v1${endpoint}`, {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });

    if (!response.ok) {
        throw new Error(`Spotify API error: ${response.statusText}`);
    }

    return response.json();
}

function extractSpotifyId(url: string): { type: 'track' | 'album' | 'playlist'; id: string } | null {
    const patterns = [
        /spotify\.com\/track\/([a-zA-Z0-9]+)/,
        /spotify\.com\/album\/([a-zA-Z0-9]+)/,
        /spotify\.com\/playlist\/([a-zA-Z0-9]+)/
    ];
    const types: ('track' | 'album' | 'playlist')[] = ['track', 'album', 'playlist'];

    for (let i = 0; i < patterns.length; i++) {
        const match = url.match(patterns[i]);
        if (match) {
            return { type: types[i], id: match[1] };
        }
    }
    return null;
}

ipcMain.handle('get-spotify-info', async (event: any, url: any) => {
    if (!url) return { success: false, error: "No URL provided" };
    console.log(`Fetching Spotify info for ${url}...`);

    try {
        const parsed = extractSpotifyId(url);
        if (!parsed) {
            return { success: false, error: "Invalid Spotify URL" };
        }

        let metadata: any = {
            contentType: parsed.type,
            entries: []
        };

        if (parsed.type === 'track') {
            const track = await spotifyApiRequest(`/tracks/${parsed.id}`);
            metadata = {
                id: track.id,
                title: track.name,
                thumbnail: track.album?.images?.[0]?.url || '',
                uploader: track.artists?.map((a: any) => a.name).join(', ') || 'Unknown',
                duration: Math.floor(track.duration_ms / 1000),
                view_count: track.popularity || 0,
                webpage_url: track.external_urls?.spotify || url,
                contentType: 'video', // Single track = video-like
                album: track.album?.name,
                release_date: track.album?.release_date,
                // For YouTube search
                searchQuery: `${track.artists?.[0]?.name} - ${track.name} audio`
            };
        } else if (parsed.type === 'album') {
            const album = await spotifyApiRequest(`/albums/${parsed.id}`);
            metadata = {
                id: album.id,
                title: album.name,
                thumbnail: album.images?.[0]?.url || '',
                uploader: album.artists?.map((a: any) => a.name).join(', ') || 'Unknown',
                duration: 0,
                view_count: album.popularity || 0,
                webpage_url: album.external_urls?.spotify || url,
                contentType: 'playlist',
                playlist_count: album.tracks?.total || 0,
                entries: album.tracks?.items?.map((track: any, i: number) => ({
                    id: track.id,
                    title: track.name,
                    thumbnail: album.images?.[0]?.url || '',
                    duration: Math.floor(track.duration_ms / 1000),
                    url: track.external_urls?.spotify || '',
                    artist: track.artists?.map((a: any) => a.name).join(', '),
                    searchQuery: `${track.artists?.[0]?.name} - ${track.name} audio`
                })) || []
            };
        } else if (parsed.type === 'playlist') {
            const playlist = await spotifyApiRequest(`/playlists/${parsed.id}`);
            metadata = {
                id: playlist.id,
                title: playlist.name,
                thumbnail: playlist.images?.[0]?.url || '',
                uploader: playlist.owner?.display_name || 'Unknown',
                duration: 0,
                view_count: playlist.followers?.total || 0,
                webpage_url: playlist.external_urls?.spotify || url,
                contentType: 'playlist',
                playlist_count: playlist.tracks?.total || 0,
                entries: playlist.tracks?.items?.slice(0, 100).map((item: any, i: number) => {
                    const track = item.track;
                    if (!track) return null;
                    return {
                        id: track.id,
                        title: track.name,
                        thumbnail: track.album?.images?.[0]?.url || '',
                        duration: Math.floor(track.duration_ms / 1000),
                        url: track.external_urls?.spotify || '',
                        artist: track.artists?.map((a: any) => a.name).join(', '),
                        searchQuery: `${track.artists?.[0]?.name} - ${track.name} audio`
                    };
                }).filter(Boolean) || []
            };
        }

        console.log(`Spotify metadata: ${metadata.title}, ${metadata.entries?.length || 0} tracks`);
        return { success: true, metadata };
    } catch (e: any) {
        console.error("Spotify fetch error:", e);
        return { success: false, error: e.message || "Failed to fetch Spotify info" };
    }
});

ipcMain.handle('download-spotify-track', async (event: any, { searchQuery, title, artist }: { searchQuery: any, title: any, artist: any }) => {
    try {
        console.log(`Searching YouTube for: ${searchQuery}`);

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
            const ffmpegDir = path.dirname(ffmpegBinaryPath);
            args.push('--ffmpeg-location', ffmpegDir);
            console.log('FFmpeg available for Spotify, will embed thumbnail');
        }

        console.log("Starting Spotify->YouTube download with args:", args);
        console.log("Saving to:", downloadPath);
        let ytDlpEventEmitter = ytDlpWrap.exec(args);

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

// ============ HISTORY MANAGEMENT ============
const historyPath = path.join(app.getPath('userData'), 'history.json');

interface HistoryItem {
    id: string;
    title: string;
    url: string;
    platform: string;
    thumbnail: string;
    type: 'video' | 'audio';
    downloadedAt: string;
    filePath: string;
}

function loadHistory(): HistoryItem[] {
    try {
        if (fs.existsSync(historyPath)) {
            return JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
        }
    } catch (e) {
        console.error('Failed to load history:', e);
    }
    return [];
}

function saveHistory(history: HistoryItem[]) {
    try {
        fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf-8');
    } catch (e) {
        console.error('Failed to save history:', e);
    }
}

function addToHistory(item: Omit<HistoryItem, 'id' | 'downloadedAt'>) {
    const history = loadHistory();
    const newItem: HistoryItem = {
        ...item,
        id: Date.now().toString(),
        downloadedAt: new Date().toISOString()
    };
    history.unshift(newItem);
    // Keep only last 100 items
    if (history.length > 100) history.pop();
    saveHistory(history);
}

ipcMain.handle('get-history', async () => {
    return { history: loadHistory() };
});

ipcMain.handle('delete-history-item', async (event: any, id: string) => {
    const history = loadHistory().filter(item => item.id !== id);
    saveHistory(history);
    return { success: true };
});

ipcMain.handle('clear-history', async () => {
    saveHistory([]);
    return { success: true };
});

// ============ OPEN IN FOLDER ============
ipcMain.handle('open-in-folder', async (event: any, filePath: string) => {
    try {
        shell.showItemInFolder(filePath);
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
});

// ============ THUMBNAIL SAVER ============
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
        shell.showItemInFolder(filePath);

        return { success: true, path: filePath };
    } catch (e: any) {
        console.error('Thumbnail save error:', e);
        return { success: false, error: e.message };
    }
});

// ============ VERSION & UPDATE CHECKER ============
ipcMain.handle('get-versions', async () => {
    let ytdlpVersion = 'Unknown';
    try {
        const output = await ytDlpWrap.execPromise(['--version']);
        ytdlpVersion = output.trim();
    } catch (e) {
        console.error('Failed to get yt-dlp version:', e);
    }

    return {
        app: app.getVersion(),
        ytdlp: ytdlpVersion
    };
});

ipcMain.handle('update-ytdlp', async () => {
    try {
        console.log('Checking for yt-dlp updates...');

        // Get current version
        let currentVersion = '';
        try {
            currentVersion = (await ytDlpWrap.execPromise(['--version'])).trim();
        } catch (e) {
            console.log('Could not get current version');
        }

        // Delete and redownload
        if (fs.existsSync(ytDlpBinaryPath)) {
            fs.unlinkSync(ytDlpBinaryPath);
        }

        await YtDlpWrap.downloadFromGithub(ytDlpBinaryPath);

        // Get new version
        let newVersion = '';
        try {
            newVersion = (await ytDlpWrap.execPromise(['--version'])).trim();
        } catch (e) {
            console.log('Could not get new version');
        }

        if (newVersion && newVersion !== currentVersion) {
            return { updated: true, version: newVersion };
        } else {
            return { updated: false, message: 'Already up to date', version: newVersion };
        }
    } catch (e: any) {
        console.error('Update failed:', e);
        return { updated: false, error: e.message };
    }
});

// Note: choose-download-folder handler is defined earlier in the file (line 183)

// ============ AUTO-UPDATER SYSTEM ============
function setupAutoUpdater() {
    // Log updater events
    autoUpdater.logger = console;

    autoUpdater.on('checking-for-update', () => {
        console.log('Checking for updates...');
        mainWindow?.webContents.send('update-status', { status: 'checking' });
    });

    autoUpdater.on('update-available', (info: any) => {
        console.log('Update available:', info.version);
        mainWindow?.webContents.send('update-status', {
            status: 'available',
            version: info.version,
            releaseNotes: info.releaseNotes
        });
        showNotification('Update Available! 🎉', `Version ${info.version} is downloading...`);
    });

    autoUpdater.on('update-not-available', () => {
        console.log('App is up to date');
        mainWindow?.webContents.send('update-status', { status: 'up-to-date' });
    });

    autoUpdater.on('download-progress', (progressObj: any) => {
        console.log(`Download progress: ${progressObj.percent.toFixed(1)}%`);
        mainWindow?.webContents.send('update-status', {
            status: 'downloading',
            percent: progressObj.percent,
            bytesPerSecond: progressObj.bytesPerSecond,
            transferred: progressObj.transferred,
            total: progressObj.total
        });
    });

    autoUpdater.on('update-downloaded', (info: any) => {
        console.log('Update downloaded:', info.version);
        mainWindow?.webContents.send('update-status', {
            status: 'downloaded',
            version: info.version
        });
        showNotification('Update Ready! 🚀', `Version ${info.version} will install on restart.`);
    });

    autoUpdater.on('error', (error: Error) => {
        console.error('Auto-update error:', error);
        mainWindow?.webContents.send('update-status', {
            status: 'error',
            message: error.message
        });
    });

    // Check for updates on startup (after a delay to not block app startup)
    setTimeout(() => {
        autoUpdater.checkForUpdates().catch(err => {
            console.error('Failed to check for updates:', err);
        });
    }, 5000);
}

// IPC handlers for manual update control
ipcMain.handle('check-for-updates', async () => {
    try {
        const result = await autoUpdater.checkForUpdates();
        return { success: true, updateInfo: result?.updateInfo };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('install-update', async () => {
    try {
        autoUpdater.quitAndInstall(false, true);
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('get-app-info', async () => {
    return {
        version: app.getVersion(),
        name: app.getName(),
        isPackaged: app.isPackaged
    };
});

