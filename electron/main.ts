
import { app, BrowserWindow, shell, Tray, Menu } from 'electron';
import path from 'path';
import { initPaths, ensureYtDlp, checkFFmpegOnStartup, checkForYtDlpUpdate } from './utils/binaries';
import { setMainWindow } from './utils/windowManager';
import { registerDownloadHandlers } from './handlers/downloadHandler';
import { registerInfoHandlers } from './handlers/infoHandler';
import { registerCookieHandlers } from './handlers/cookieHandler';
import { registerGeneralHandlers } from './handlers/generalHandler';
import { setupAutoUpdater, registerUpdaterHandlers } from './utils/updater';
import { startWebSocketServer, stopWebSocketServer } from './utils/websocketServer';
import { registerNativeHost } from './utils/nativeHost';
import './utils/env'; // Load env vars

// Initialize paths and binaries state
initPaths();

// Resource Optimization: Disable GPU to save significant RAM (GPU process often uses 50-100MB)
// This also merges processes, reducing the total count from 4-5 down to 2-3.
app.disableHardwareAcceleration();

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let lastAppUrl = '';

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
    lastAppUrl = isDev ? 'http://localhost:5173' : `file://${path.join(__dirname, '../dist/index.html')}`;

    if (isDev) {
        mainWindow.loadURL(lastAppUrl);
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    mainWindow.setMenu(null);

    // Always minimize to tray on close (tray is required for extension support)
    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow?.hide();
            return false;
        }
    });

    // Resource Optimization: Deep Purge when hidden
    mainWindow.on('hide', () => {
        mainWindow?.webContents.setAudioMuted(true);
        // Force GC and unload heavy UI by navigating to a blank page
        // This is the only way to get Electron close to "service-like" memory levels
        if (mainWindow?.webContents) {
            mainWindow.webContents.loadURL('about:blank');
        }
    });

    mainWindow.on('show', () => {
        mainWindow?.webContents.setAudioMuted(false);
        // Restore app state
        if (mainWindow?.webContents && (mainWindow.webContents.getURL() === 'about:blank' || mainWindow.webContents.getURL() === '')) {
            if (lastAppUrl.startsWith('http')) {
                mainWindow.webContents.loadURL(lastAppUrl);
            } else {
                mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
            }
        }
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

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Check if launched with --download-url
        const urlArg = commandLine.find(arg => arg.startsWith('--download-url='));
        const downloadUrl = urlArg ? urlArg.split('=').slice(1).join('=') : null;

        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            if (!mainWindow.isVisible()) mainWindow.show();
            mainWindow.focus();

            // If URL was passed, send it to renderer
            if (downloadUrl) {
                setTimeout(() => {
                    mainWindow?.webContents.send('external-download-url', {
                        url: downloadUrl,
                        title: '',
                        thumbnail: ''
                    });
                }, 500);
            }
        }
    });

    app.whenReady().then(async () => {
        try {
            await ensureYtDlp();
            checkForYtDlpUpdate();
        } catch (e) {
            console.error("Failed to ensure yt-dlp binary:", e);
        }

        checkFFmpegOnStartup();

        createWindow();
        
        // Always create tray for WebSocket server and extension support
        createTray();

        // Start WebSocket server for browser extension
        startWebSocketServer();

        // Register native messaging host for Chrome/Edge (auto-launch when app is closed)
        registerNativeHost();

        // Handle --download-url CLI argument on first launch
        const cliUrlArg = process.argv.find(arg => arg.startsWith('--download-url='));
        if (cliUrlArg) {
            const cliUrl = cliUrlArg.split('=').slice(1).join('=');
            setTimeout(() => {
                mainWindow?.webContents.send('external-download-url', {
                    url: cliUrl,
                    title: '',
                    thumbnail: ''
                });
            }, 1000);
        }

        // @ts-ignore - custom event
        app.on('settings-changed', (newSettings: any) => {
            // Tray is always active for extension support
        });

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
        // Don't quit - tray keeps the app alive for extension
        // Only quit if platform is not darwin
        if (process.platform !== 'darwin') {
            // Keep app running for tray/extension - don't quit
        }
    });
}

app.on('activate', () => {
    if (mainWindow === null) createWindow();
    else mainWindow.show();
});

// Cleanup WebSocket server on quit
app.on('before-quit', () => {
    isQuitting = true;
    stopWebSocketServer();
});
