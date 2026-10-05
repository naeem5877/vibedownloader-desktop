import { ipcMain, shell, dialog, app } from 'electron';
import fs from 'fs';
import { getMainWindow } from '../utils/windowManager';
import { getHistoryPath, loadSettings, saveSettings } from '../utils/paths';
import { getYtDlpVersion, checkForYtDlpUpdate } from '../utils/binaries';
import { defaultUserAgent } from '../utils/platform';
import { showNotification } from '../utils/notifications';

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
        const historyPath = getHistoryPath();
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
        const historyPath = getHistoryPath();
        fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf-8');
    } catch (e) {
        console.error('Failed to save history:', e);
    }
}

export function registerGeneralHandlers() {
    const mainWindow = getMainWindow(); // Note: might be null if called too early, but IPC handlers are called later.

    ipcMain.handle('minimize-window', () => getMainWindow()?.minimize());
    ipcMain.handle('maximize-window', () => {
        const win = getMainWindow();
        if (win?.isMaximized()) win.unmaximize();
        else win?.maximize();
    });
    ipcMain.handle('close-window', () => getMainWindow()?.close());

    // Settings Management
    ipcMain.handle('get-settings', async () => {
        return loadSettings();
    });

    ipcMain.handle('save-settings', async (event: any, settings: any) => {
        try {
            saveSettings(settings);
            // @ts-ignore - custom event
            app.emit('settings-changed', settings);
            return { success: true };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    });

    // Download Path Management
    ipcMain.handle('get-download-path', async () => {
        const settings = loadSettings();
        return { path: settings.downloadBasePath };
    });

    ipcMain.handle('choose-download-folder', async () => {
        const win = getMainWindow();
        const result = await dialog.showOpenDialog(win!, {
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

    ipcMain.handle('choose-cookie-file', async () => {
        const win = getMainWindow();
        const result = await dialog.showOpenDialog(win!, {
            properties: ['openFile'],
            filters: [{ name: 'Text Files', extensions: ['txt'] }],
            title: 'Select Cookie File'
        });

        if (!result.canceled && result.filePaths.length > 0) {
            try {
                const content = fs.readFileSync(result.filePaths[0], 'utf-8');
                return { success: true, content };
            } catch (e: any) {
                return { success: false, error: e.message };
            }
        }
        return { success: false };
    });

    // Proxy Image - Fast Fail Mode (User requested to stop hanging fetches)
    ipcMain.handle('proxy-image', async (event: any, url: string) => {
        if (!url) return null;
        try {
            const axios = require('axios');
            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: 3000, // 3 second max - fail fast
                headers: {
                    'User-Agent': defaultUserAgent(),
                    'Accept': 'image/avif,image/webp,image/apng,image/*,*/*',
                    'Referer': 'https://open.spotify.com/'
                }
            });
            
            if (response.status === 200) {
                const buffer = Buffer.from(response.data);
                const contentType = response.headers['content-type'] || 'image/jpeg';
                return `data:${contentType};base64,${buffer.toString('base64')}`;
            }
            return null;
        } catch (e: any) {
            // Silently fail to keep the app fast
            return null;
        }
    });

    // History
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

    ipcMain.handle('open-in-folder', async (event: any, filePath: string) => {
        try {
            const fs = require('fs');
            if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
                // Opening a folder directly (e.g. a playlist folder) — show the
                // folder contents instead of highlighting it in its parent.
                await shell.openPath(filePath);
            } else {
                shell.showItemInFolder(filePath);
            }
            return { success: true };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('open-external', async (event: any, url: string) => {
        try {
            await shell.openExternal(url);
            return { success: true };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('copy-to-clipboard', async (event: any, text: string) => {
        try {
            const { clipboard } = require('electron');
            clipboard.writeText(text);
            return { success: true };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    });

    // Version & Updates (Application & yt-dlp)
    ipcMain.handle('get-versions', async () => {
        let ytdlpVersion = 'Unknown';
        try {
            ytdlpVersion = (await getYtDlpVersion()) || 'Unknown';
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
            console.log('Checking for yt-dlp updates from settings...');
            const before = await getYtDlpVersion();

            // Uses the same verified path as the automatic updater: the new binary
            // is downloaded beside the old one, must run, and only then replaces
            // it. The previous code deleted the working binary first and then went
            // through GitHub's rate-limited API, so one failed download left the
            // user with no yt-dlp at all (every download then died with ENOENT).
            const result = await checkForYtDlpUpdate(true);

            if (result.error && !result.version) {
                const current = before || (await getYtDlpVersion()) || 'Unknown';
                return { updated: false, error: `Could not update yt-dlp (${result.error}). Your current version still works.`, version: current };
            }
            if (!result.updated) {
                return { updated: false, message: 'yt-dlp engine is already up to date!', version: result.version || before || 'Unknown' };
            }
            return { updated: true, version: result.version || 'Unknown' };
        } catch (e: any) {
            console.error('Update failed:', e);
            return { updated: false, error: e.message || 'Failed to download update' };
        }
    });

    ipcMain.handle('get-app-info', async () => {
        return {
            version: app.getVersion(),
            name: app.getName(),
            isPackaged: app.isPackaged
        };
    });

    ipcMain.handle('show-notification', async (event: any, { title, body }: { title: string, body: string }) => {
        showNotification(title, body);
        return { success: true };
    });
}
