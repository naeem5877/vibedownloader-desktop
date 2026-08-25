
import { app, BrowserWindow, shell, Tray, Menu } from 'electron';
import path from 'path';
import { initPaths, ensureYtDlp, checkFFmpegOnStartup, checkForYtDlpUpdate } from './utils/binaries';
import { setMainWindow } from './utils/windowManager';
import { registerDownloadHandlers, getActiveDownloadCount, waitForDownloadsToFinish, cleanupDownloadArtifacts } from './handlers/downloadHandler';
import { registerInfoHandlers } from './handlers/infoHandler';
import { registerCookieHandlers } from './handlers/cookieHandler';
import { registerGeneralHandlers } from './handlers/generalHandler';
import { registerExtensionHandlers } from './handlers/extensionHandler';
import { showNotification } from './utils/notifications';
import { setupAutoUpdater, registerUpdaterHandlers } from './utils/updater';
import { startWebSocketServer, stopWebSocketServer } from './utils/websocketServer';
import { registerNativeHost, registerUrlProtocol } from './utils/nativeHost';
import { prepareUnpackedExtension } from './utils/extensionInstaller';
import { loadSettings } from './utils/paths';
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
let settings = loadSettings();

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

    // Close behaviour follows the "Minimize to Tray" setting:
    //  - enabled  → hide the window, keep the app (and WebSocket server) alive in the tray.
    //  - disabled → quit the app for real. The browser extension can still relaunch
    //               it later through the native-messaging host.
    mainWindow.on('close', (event) => {
        if (isQuitting) return;
        event.preventDefault();
        if (settings.minimizeToTray) {
            mainWindow?.hide();
        } else {
            requestAppQuit();
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
                requestAppQuit();
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

// Create or destroy the tray to match the "Minimize to Tray" setting. The tray
// is NOT required for the extension — the native host can relaunch the app even
// when it's fully quit — so disabling the setting removes it entirely.
function applyTrayFromSettings() {
    if (settings.minimizeToTray && !tray) {
        createTray();
    } else if (!settings.minimizeToTray && tray) {
        tray.destroy();
        tray = null;
    }
}

// Quit the app, but never kill an in-progress download. If downloads are
// running, keep the app alive (quietly, in the tray) until they finish —
// otherwise yt-dlp gets killed mid-file and leaves broken *.part fragments.
// Falls back to a hard quit after 30 minutes in case a download hangs.
function requestAppQuit() {
    isQuitting = true;
    const active = getActiveDownloadCount();
    if (active > 0) {
        console.log(`Waiting for ${active} active download(s) to finish before quitting...`);
        showNotification('VibeDownloader', `Waiting for ${active} download(s) to finish before quitting...`);
        waitForDownloadsToFinish()
            .then(() => {
                console.log('Downloads finished, quitting now.');
                app.quit();
            })
            .catch(() => app.quit());
    } else {
        app.quit();
    }
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
        
        // Tray only when "Minimize to Tray" is enabled
        applyTrayFromSettings();

        // Remove yt-dlp fragment files left behind by a previously interrupted
        // download (crash / forced kill). Safe: nothing can be downloading yet.
        cleanupDownloadArtifacts();

        // Start WebSocket server for browser extension
        startWebSocketServer();

        // Register native messaging host for Chrome/Edge (auto-launch when app is closed)
        registerNativeHost();

        // Register the vibedownloader:// protocol so the extension has a second,
        // native-messaging-free way to relaunch the app.
        registerUrlProtocol();

        // Keep the developer-loaded extension folder in sync with the bundled
        // extension (stable key-derived ID + latest code) on every launch.
        try {
            prepareUnpackedExtension();
        } catch (e) {
            console.error('Failed to prepare unpacked extension:', e);
        }

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
            settings = loadSettings();
            applyTrayFromSettings();
        });

        // Register all IPC handlers
        registerDownloadHandlers();
        registerInfoHandlers();
        registerCookieHandlers();
        registerGeneralHandlers();
        registerExtensionHandlers();
        registerUpdaterHandlers();

        // Initialize auto-updater (only in production)
        if (app.isPackaged) {
            setupAutoUpdater();
        }
    });

    app.on('window-all-closed', () => {
        // If "Minimize to Tray" is off, closing the window should quit the app
        // completely. When it's on, the window hides instead of closing, so this
        // only runs on a real quit.
        if (!settings.minimizeToTray) {
            requestAppQuit();
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
