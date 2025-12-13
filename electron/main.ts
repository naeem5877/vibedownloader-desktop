
import { app, BrowserWindow, shell } from 'electron';
import path from 'path';
import { initPaths, ensureYtDlp, checkFFmpegOnStartup } from './utils/binaries';
import { setMainWindow } from './utils/windowManager';
import { registerDownloadHandlers } from './handlers/downloadHandler';
import { registerInfoHandlers } from './handlers/infoHandler';
import { registerCookieHandlers } from './handlers/cookieHandler';
import { registerGeneralHandlers } from './handlers/generalHandler';
import { setupAutoUpdater, registerUpdaterHandlers } from './utils/updater';
import './utils/env'; // Load env vars

// Initialize paths and binaries state
initPaths();

let mainWindow: BrowserWindow | null = null;

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

    // Store reference in window manager
    setMainWindow(mainWindow);

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

    mainWindow.on('closed', () => {
        mainWindow = null;
        setMainWindow(null);
    });
}

app.whenReady().then(async () => {
    try {
        await ensureYtDlp();
    } catch (e) {
        console.error("Failed to ensure yt-dlp binary:", e);
    }

    checkFFmpegOnStartup();

    createWindow();

    // Register all IPC handlers
    registerDownloadHandlers();
    registerInfoHandlers();
    registerCookieHandlers();
    registerGeneralHandlers();
    registerUpdaterHandlers();

    // Initialize auto-updater (only in production)
    if (app.isPackaged) {
        setupAutoUpdater();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (mainWindow === null) createWindow();
});
