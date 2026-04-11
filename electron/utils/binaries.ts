import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import YtDlpWrap from 'yt-dlp-wrap';
import { getMainWindow } from './windowManager';
import { showNotification } from './notifications';

let ytDlpBinaryPath: string;
let ffmpegBinaryPath: string;
let ytDlpWrap: YtDlpWrap;
let ffmpegAvailable = false;

export function initPaths() {
    const userDataPath = app.getPath('userData');
    ytDlpBinaryPath = path.join(userDataPath, 'yt-dlp.exe');
    ffmpegBinaryPath = path.join(userDataPath, 'ffmpeg', 'ffmpeg.exe');
    ytDlpWrap = new YtDlpWrap(ytDlpBinaryPath);
}

export function getYtDlpWrap() {
    return ytDlpWrap;
}

export function getYtDlpBinaryPath() {
    return ytDlpBinaryPath;
}

export function getFfmpegBinaryPath() {
    return ffmpegBinaryPath;
}

export function isFfmpegAvailable() {
    return ffmpegAvailable;
}

export async function ensureYtDlp() {
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

export async function checkForYtDlpUpdate() {
    // Disabled as per user request to avoid unnecessary notifications
    console.log("Background yt-dlp update check is disabled.");
}

async function downloadFFmpeg(): Promise<boolean> {
    const ffmpegDir = path.join(app.getPath('userData'), 'ffmpeg');
    const ffmpegExePath = path.join(ffmpegDir, 'ffmpeg.exe');
    const tempZipPath = path.join(app.getPath('userData'), 'ffmpeg-temp.zip');

    // Use custom FFmpeg download link provided by user
    const FFMPEGReleaseUrl = 'https://github.com/naeem589020/ffmpeg/releases/download/ffmpeg/ffmpeg.zip';
    // Fallback to the standard BtbN standalone build
    const FALLBACK_URL = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';

    console.log('Downloading FFmpeg from GitHub Releases (fast CDN)...');
    const mainWindow = getMainWindow();

    const tryDownload = async (downloadUrl: string): Promise<boolean> => {
        return new Promise((resolve) => {
            const https = require('https');
            const file = fs.createWriteStream(tempZipPath);

            const downloadWithRedirects = (url: string, redirectCount = 0) => {
                if (redirectCount > 8) { resolve(false); return; }

                https.get(url, { headers: { 'User-Agent': 'VibeDownloader/1.0' } }, (response: any) => {
                    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
                        downloadWithRedirects(response.headers.location, redirectCount + 1);
                        return;
                    }
                    if (response.statusCode !== 200) {
                        console.error('FFmpeg download HTTP error:', response.statusCode);
                        resolve(false);
                        return;
                    }

                    const totalSize = parseInt(response.headers['content-length'] || '0', 10);
                    let downloadedSize = 0;
                    let lastPercent = -1;

                    response.on('data', (chunk: Buffer) => {
                        downloadedSize += chunk.length;
                        if (totalSize > 0) {
                            const percent = Math.floor((downloadedSize / totalSize) * 100);
                            if (percent !== lastPercent) {
                                lastPercent = percent;
                                mainWindow?.webContents.send('download-progress', {
                                    percent,
                                    currentSpeed: 'Downloading FFmpeg...',
                                    downloaded: `${(downloadedSize / 1024 / 1024).toFixed(1)} MB / ${(totalSize / 1024 / 1024).toFixed(1)} MB`
                                });
                            }
                        }
                    });

                    response.pipe(file);

                    file.on('finish', () => {
                        file.close();
                        console.log('FFmpeg zip downloaded, extracting...');

                        try {
                            const AdmZip = require('adm-zip');
                            const zip = new AdmZip(tempZipPath);
                            let foundFfmpeg = false;

                            if (!fs.existsSync(ffmpegDir)) fs.mkdirSync(ffmpegDir, { recursive: true });

                            // Extract all .exe files (ffmpeg, ffprobe, ffplay, etc.)
                            zip.getEntries().forEach((entry: any) => {
                                if (!entry.isDirectory && entry.entryName.endsWith('.exe')) {
                                    zip.extractEntryTo(entry, ffmpegDir, false, true);
                                    if (entry.entryName.endsWith('ffmpeg.exe')) {
                                        foundFfmpeg = true;
                                        // Rename if needed
                                        const extractedName = path.join(ffmpegDir, path.basename(entry.entryName));
                                        if (fs.existsSync(extractedName) && extractedName !== ffmpegExePath) {
                                            fs.renameSync(extractedName, ffmpegExePath);
                                        }
                                    }
                                }
                            });

                            if (!foundFfmpeg) {
                                console.error('ffmpeg.exe not found in zip');
                                resolve(false);
                                return;
                            }

                            if (fs.existsSync(tempZipPath)) fs.unlinkSync(tempZipPath);

                            console.log('FFmpeg extracted successfully to:', ffmpegExePath);
                            ffmpegAvailable = true;
                            resolve(true);
                        } catch (e) {
                            console.error('Failed to extract FFmpeg:', e);
                            resolve(false);
                        }
                    });
                }).on('error', (err: any) => {
                    console.error('FFmpeg download error:', err);
                    if (fs.existsSync(tempZipPath)) try { fs.unlinkSync(tempZipPath); } catch {}
                    resolve(false);
                });
            };

            downloadWithRedirects(downloadUrl);
        });
    };

    // Try primary, then fallback
    let success = await tryDownload(FFMPEGReleaseUrl);
    if (!success) {
        console.log('Primary FFmpeg URL failed, trying fallback...');
        success = await tryDownload(FALLBACK_URL);
    }
    return success;
}

export async function ensureFFmpeg(): Promise<boolean> {
    if (ffmpegAvailable && fs.existsSync(ffmpegBinaryPath)) {
        return true;
    }

    // Check if FFmpeg already exists in custom location
    if (fs.existsSync(ffmpegBinaryPath)) {
        const stats = fs.statSync(ffmpegBinaryPath);
        if (stats.size > 10 * 1024 * 1024) { // FFmpeg should be at least 10MB
            ffmpegAvailable = true;
            return true;
        }
    }

    // Check system PATH
    try {
        const { execSync } = require('child_process');
        execSync('ffmpeg -version', { stdio: 'ignore' });
        ffmpegAvailable = true;
        console.log('FFmpeg found in system PATH');
        return true;
    } catch (e) {
        // Not in PATH
    }

    // Download FFmpeg
    console.log('FFmpeg not found, downloading...');
    const mainWindow = getMainWindow();
    mainWindow?.webContents.send('download-progress', {
        status: 'Downloading FFmpeg for high-quality processing... (one-time setup)'
    });

    const success = await downloadFFmpeg();
    if (success) {
        showNotification('FFmpeg Ready', 'High-quality videos and audio files are now fully supported!');
    }
    return success;
}

export function checkFFmpegOnStartup() {
    // Check custom location
    if (fs.existsSync(ffmpegBinaryPath)) {
        const stats = fs.statSync(ffmpegBinaryPath);
        if (stats.size > 10 * 1024 * 1024) {
            ffmpegAvailable = true;
            console.log('FFmpeg found in custom path:', ffmpegBinaryPath);
            return;
        }
    }

    // Check system PATH
    try {
        const { execSync } = require('child_process');
        execSync('ffmpeg -version', { stdio: 'ignore' });
        ffmpegAvailable = true;
        console.log('FFmpeg found in system PATH');
    } catch (e) {
        console.log('FFmpeg not found on startup');
    }
}
