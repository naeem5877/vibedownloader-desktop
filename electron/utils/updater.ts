import { autoUpdater } from 'electron-updater';
import { app, ipcMain } from 'electron';
import { getMainWindow } from './windowManager';
import { getActiveDownloadCount } from '../handlers/downloadHandler';

const RELEASES_URL = 'https://github.com/naeem5877/vibedownloader-desktop/releases/latest';

export type UpdateStatus =
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'downloaded'
    | 'up-to-date'
    | 'error';

export interface UpdateState {
    status: UpdateStatus;
    /** Version on offer (from the update feed), e.g. "2.2.0". */
    version?: string;
    /** Version running right now - straight from package.json. */
    currentVersion: string;
    percent?: number;
    bytesPerSecond?: number;
    transferred?: number;
    total?: number;
    message?: string;
    releaseUrl: string;
}

// The renderer is thrown away whenever the window is hidden to the tray (it is
// navigated to about:blank to save memory) and again on every reload, so it
// cannot be the one that remembers where the update is. The main process keeps
// the latest state and the UI asks for it when it mounts.
let state: UpdateState = {
    status: 'idle',
    currentVersion: app.getVersion(),
    releaseUrl: RELEASES_URL
};

function publish(patch: Partial<UpdateState>) {
    state = { ...state, ...patch, currentVersion: app.getVersion(), releaseUrl: RELEASES_URL };
    getMainWindow()?.webContents.send('update-status', state);
}

export function getUpdateState(): UpdateState {
    return { ...state, currentVersion: app.getVersion() };
}

export function setupAutoUpdater() {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    // Log updater events
    autoUpdater.logger = console;

    // No desktop notifications from the updater on purpose: they pop up outside
    // the app, say "downloading" and "ready" a minute apart, and confused people.
    // The in-app banner (UpdateBanner) is the single place updates are shown.

    autoUpdater.on('checking-for-update', () => {
        console.log('Checking for updates...');
        // Don't flash the banner away mid-download; only a quiet check state.
        if (state.status === 'downloading' || state.status === 'downloaded') return;
        publish({ status: 'checking', message: undefined });
    });

    autoUpdater.on('update-available', (info: any) => {
        console.log('Update available:', info.version);
        publish({ status: 'available', version: info.version, percent: 0, message: undefined });
    });

    autoUpdater.on('update-not-available', () => {
        console.log('App is up to date');
        if (state.status === 'downloading' || state.status === 'downloaded') return;
        publish({ status: 'up-to-date', version: undefined, percent: undefined });
    });

    autoUpdater.on('download-progress', (progressObj: any) => {
        publish({
            status: 'downloading',
            percent: progressObj.percent,
            bytesPerSecond: progressObj.bytesPerSecond,
            transferred: progressObj.transferred,
            total: progressObj.total
        });
    });

    autoUpdater.on('update-downloaded', (info: any) => {
        console.log('Update downloaded:', info.version);
        publish({ status: 'downloaded', version: info.version, percent: 100, message: undefined });
    });

    autoUpdater.on('error', (error: Error) => {
        console.error('Auto-update error:', error);
        // A background re-check failing (offline, rate limit) must not take the
        // "ready to install" state away from an update that is already on disk.
        if (state.status === 'downloaded') return;
        // Keep the offered version: if the update was found but could not be
        // downloaded or installed (unsigned macOS builds, .deb installs), the
        // banner then offers a manual download of that exact version.
        publish({ status: 'error', message: error?.message || 'Update failed' });
    });

    // Check for updates on startup (after a delay to not block app startup),
    // then every few hours for people who leave the app running in the tray.
    const check = () => autoUpdater.checkForUpdates().catch(err => {
        console.error('Failed to check for updates:', err);
    });
    setTimeout(check, 5000);
    setInterval(check, 6 * 60 * 60 * 1000);
}

export function registerUpdaterHandlers() {
    ipcMain.handle('get-update-state', () => getUpdateState());

    ipcMain.handle('check-for-updates', async () => {
        try {
            const result = await autoUpdater.checkForUpdates();
            return { success: true, updateInfo: result?.updateInfo };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('install-update', async (_event: any, opts?: { force?: boolean }) => {
        try {
            // Restarting kills running downloads mid-file. Let the UI ask first.
            const active = getActiveDownloadCount();
            if (active > 0 && !opts?.force) {
                return { success: false, activeDownloads: active };
            }
            // isSilent=false shows the installer UI on Windows; forceRunAfter=true
            // relaunches the app when the install finishes.
            autoUpdater.quitAndInstall(false, true);
            return { success: true };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    });
}
