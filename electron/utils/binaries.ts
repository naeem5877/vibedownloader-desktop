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

async function downloadFFmpeg(): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const AdmZip = require('adm-zip');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
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
                if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
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
