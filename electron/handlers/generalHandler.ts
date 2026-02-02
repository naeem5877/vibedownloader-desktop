import { ipcMain, shell, dialog, app } from 'electron';
import fs from 'fs';
import { getMainWindow } from '../utils/windowManager';
import { getHistoryPath, loadSettings, saveSettings } from '../utils/paths';
import { getYtDlpWrap, getYtDlpBinaryPath, initPaths } from '../utils/binaries';
import YtDlpWrap from 'yt-dlp-wrap';

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

    // Proxy Image
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
            shell.showItemInFolder(filePath);
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
            const output = await getYtDlpWrap().execPromise(['--version']);
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
            console.log('Checking for yt-dlp updates from settings...');
            const ytDlpBinaryPath = getYtDlpBinaryPath();

            // 1. Get current version
            let currentVersion = 'Unknown';
            try {
                const ytDlp = new YtDlpWrap(ytDlpBinaryPath);
                currentVersion = (await ytDlp.getVersion()).trim();
            } catch (e) {
                console.log('Could not get current version');
            }

            // 2. Get latest version from Github
            const latestGithubRelease = await YtDlpWrap.getGithubReleases(1, 1);
            if (!latestGithubRelease || latestGithubRelease.length === 0) {
                return { updated: false, message: 'Could not connect to GitHub', version: currentVersion };
            }

            const latestVersion = latestGithubRelease[0].tag_name;

            if (currentVersion === latestVersion) {
                return { updated: false, message: 'yt-dlp engine is already up to date!', version: currentVersion };
            }

            // 3. Download update
            console.log(`Updating yt-dlp: ${currentVersion} -> ${latestVersion}`);

            // Delete old binary first to avoid permission issues on some systems
            if (fs.existsSync(ytDlpBinaryPath)) {
                try {
                    fs.unlinkSync(ytDlpBinaryPath);
                } catch (e) {
                    console.error('Failed to delete old binary:', e);
                }
            }

            await YtDlpWrap.downloadFromGithub(ytDlpBinaryPath);

            // 4. Verify new version
            let newVersion = '';
            try {
                const ytDlp = new YtDlpWrap(ytDlpBinaryPath);
                newVersion = (await ytDlp.getVersion()).trim();
            } catch (e) {
                console.log('Could not verify new version');
            }

            if (newVersion && newVersion === latestVersion) {
                return { updated: true, version: newVersion };
            } else {
                return { updated: true, version: newVersion || latestVersion, message: 'Update completed but version verification failed' };
            }
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
}
