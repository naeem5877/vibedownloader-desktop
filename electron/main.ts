
import { app, BrowserWindow, shell, Tray, Menu } from 'electron';
import path from 'path';
import { initPaths, ensureYtDlp, checkFFmpegOnStartup, checkForYtDlpUpdate } from './utils/binaries';
import { setMainWindow } from './utils/windowManager';
import { loadSettings } from './utils/paths';
import { registerDownloadHandlers } from './handlers/downloadHandler';
import { registerInfoHandlers } from './handlers/infoHandler';
import { registerCookieHandlers } from './handlers/cookieHandler';
import { registerGeneralHandlers } from './handlers/generalHandler';
import { setupAutoUpdater, registerUpdaterHandlers } from './utils/updater';
import './utils/env'; // Load env vars

// Initialize paths and binaries state
initPaths();

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

function createWindow() {
    // Get the icon path based on environment
    const iconPath = app.isPackaged
        ? path.join(process.resourcesPath, 'build', 'icon.png')
        : path.join(__dirname, '..', 'build', 'icon.png');

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        frame: false,
        transparent: false, // Transparency breaks Snapping (Aero Snap) on Windows
        icon: iconPath,
        show: false, // Prepare window before showing
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            backgroundThrottling: true, // Throttles timers and animations when window is hidden
        },
        backgroundColor: '#0a0a0b' // Solid background for premium feel
    });

    mainWindow.once('ready-to-show', () => {
        mainWindow?.show();
        mainWindow?.maximize(); // Launch in full screen as requested
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

    // Minimize to Tray logic
    mainWindow.on('close', (event) => {
        const settings = loadSettings();
        if (!isQuitting && settings.minimizeToTray) {
            event.preventDefault();
            mainWindow?.hide();
            return false;
        }
    });

    // Resource Optimization: Suspend heavy tasks when hidden
    mainWindow.on('hide', () => {
        mainWindow?.webContents.setAudioMuted(true);
        // Chromium automatically throttles JS execution when hidden with backgroundThrottling: true
    });

    mainWindow.on('show', () => {
        mainWindow?.webContents.setAudioMuted(false);
    });

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

function createTray() {
    const iconPath = app.isPackaged
        ? path.join(process.resourcesPath, 'build', 'icon.png')
        : path.join(__dirname, '..', 'build', 'icon.png');

    tray = new Tray(iconPath);
    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Open VibeDownloader',
            click: () => {
                mainWindow?.show();
                mainWindow?.focus();
            }
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray.setToolTip('VibeDownloader');
    tray.setContextMenu(contextMenu);

    tray.on('double-click', () => {
        mainWindow?.show();
        mainWindow?.focus();
    });
}

// Set App User Model ID for Windows notifications
if (process.platform === 'win32') {
    app.setAppUserModelId('com.vibedownloader.app');
}

app.whenReady().then(async () => {
    try {
        await ensureYtDlp();
    } catch (e) {
        console.error("Failed to ensure yt-dlp binary:", e);
    }

    checkFFmpegOnStartup();

    createWindow();
    createTray();

    // Check for yt-dlp updates in the background (non-blocking)
    checkForYtDlpUpdate();

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
    else mainWindow.show();
});
