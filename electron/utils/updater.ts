import { autoUpdater } from 'electron-updater';
import { ipcMain } from 'electron';
import { getMainWindow } from './windowManager';
import { showNotification } from './notifications';

export function setupAutoUpdater() {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    // Log updater events
    autoUpdater.logger = console;

    autoUpdater.on('checking-for-update', () => {
        console.log('Checking for updates...');
        getMainWindow()?.webContents.send('update-status', { status: 'checking' });
    });

    autoUpdater.on('update-available', (info: any) => {
        console.log('Update available:', info.version);
        getMainWindow()?.webContents.send('update-status', {
            status: 'available',
            version: info.version,
            releaseNotes: info.releaseNotes
        });
        showNotification('Update Available! 🎉', `Version ${info.version} is downloading...`);
    });

    autoUpdater.on('update-not-available', () => {
        console.log('App is up to date');
        getMainWindow()?.webContents.send('update-status', { status: 'up-to-date' });
    });

    autoUpdater.on('download-progress', (progressObj: any) => {
        console.log(`Download progress: ${progressObj.percent.toFixed(1)}%`);
        getMainWindow()?.webContents.send('update-status', {
            status: 'downloading',
            percent: progressObj.percent,
            bytesPerSecond: progressObj.bytesPerSecond,
            transferred: progressObj.transferred,
            total: progressObj.total
        });
    });

    autoUpdater.on('update-downloaded', (info: any) => {
        console.log('Update downloaded:', info.version);
        getMainWindow()?.webContents.send('update-status', {
            status: 'downloaded',
            version: info.version
        });
        showNotification('Update Ready! 🚀', `Version ${info.version} will install on restart.`);
    });

    autoUpdater.on('error', (error: Error) => {
        console.error('Auto-update error:', error);
        getMainWindow()?.webContents.send('update-status', {
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

export function registerUpdaterHandlers() {
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
}
