import { WebSocketServer, WebSocket } from 'ws';
import { getMainWindow } from './windowManager';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { getCookiePath } from './paths';

const PORT = 13579;
let wss: WebSocketServer | null = null;

function ensureWindowReady(callback: (mainWindow: any) => void) {
    const mainWindow = getMainWindow();
    if (!mainWindow) return;

    // Show window if hidden
    if (!mainWindow.isVisible()) {
        mainWindow.show();
        mainWindow.focus();
    }
    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }

    // If window is on about:blank (deep purge state), wait for it to restore
    const currentUrl = mainWindow.webContents.getURL();
    if (currentUrl === 'about:blank' || currentUrl === '') {
        const isDev = !app.isPackaged;
        const restoreUrl = isDev ? 'http://localhost:5173' : `file://${path.join(__dirname, '../../dist/index.html')}`;
        mainWindow.webContents.loadURL(restoreUrl);
        mainWindow.webContents.once('did-finish-load', () => {
            setTimeout(() => callback(mainWindow), 500);
        });
    } else {
        callback(mainWindow);
    }
}

function sendUrlToRenderer(url: string, title: string, thumbnail: string) {
    ensureWindowReady((mainWindow) => {
        mainWindow?.webContents.send('external-download-url', { url, title, thumbnail });
    });
}

function sendCookiesUpdatedToRenderer(platform: string) {
    ensureWindowReady((mainWindow) => {
        mainWindow?.webContents.send('cookies-updated', { platform });
    });
}

function sendSpotifyToRenderer(searchQuery: string, title: string, artist: string, thumbnail: string) {
    ensureWindowReady((mainWindow) => {
        mainWindow?.webContents.send('external-download-spotify', { searchQuery, title, artist, thumbnail });
    });
}

export function startWebSocketServer() {
    if (wss) return;

    wss = new WebSocketServer({ port: PORT, host: '127.0.0.1' });

    wss.on('listening', () => {
        console.log(`WebSocket server listening on ws://127.0.0.1:${PORT}`);
    });

    wss.on('connection', (ws: WebSocket) => {
        console.log('Browser extension connected');

        ws.on('message', (data: Buffer) => {
            try {
                const message = JSON.parse(data.toString());

                if (message.type === 'download-url' && message.url) {
                    console.log('Received URL from extension:', message.url);
                    sendUrlToRenderer(message.url, message.title || '', message.thumbnail || '');
                    ws.send(JSON.stringify({ type: 'ack', success: true }));
                }

                if (message.type === 'download-spotify' && message.searchQuery) {
                    console.log('Received Spotify search from extension:', message.searchQuery);
                    sendSpotifyToRenderer(message.searchQuery, message.title || '', message.artist || '', message.thumbnail || '');
                    ws.send(JSON.stringify({ type: 'ack', success: true }));
                }

                if (message.type === 'save-cookies' && message.platform) {
                    // Extension popup hands us cookies (e.g. YouTube session)
                    // extracted from the browser. Persist to the same file the
                    // renderer's Settings UI uses, so yt-dlp picks it up.
                    try {
                        if (!message.content || !message.content.trim()) {
                            ws.send(JSON.stringify({ type: 'ack', id: message.id, success: false, error: 'Empty cookie content' }));
                        } else {
                            const targetPath = getCookiePath(String(message.platform).toLowerCase());
                            const dir = path.dirname(targetPath);
                            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                            fs.writeFileSync(targetPath, String(message.content).trim(), 'utf-8');
                            console.log(`Cookies saved to ${targetPath} for ${message.platform} (from extension)`);
                            sendCookiesUpdatedToRenderer(String(message.platform).toLowerCase());
                            ws.send(JSON.stringify({ type: 'ack', id: message.id, success: true }));
                        }
                    } catch (e: any) {
                        console.error('Failed to save cookies from extension:', e);
                        ws.send(JSON.stringify({ type: 'ack', id: message.id, success: false, error: e.message || String(e) }));
                    }
                }

                if (message.type === 'extension-info' && message.extensionId) {
                    // Extension sends its own ID on connect — update native host manifest
                    updateNativeHostExtensionId(message.extensionId);
                    ws.send(JSON.stringify({ type: 'ack', success: true }));
                }

                if (message.type === 'ping') {
                    ws.send(JSON.stringify({ type: 'pong' }));
                }
            } catch (e) {
                console.error('WebSocket message parse error:', e);
            }
        });

        ws.on('close', () => {
            console.log('Browser extension disconnected');
        });
    });

    wss.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`WebSocket port ${PORT} already in use, another instance may be running`);
        } else {
            console.error('WebSocket server error:', err);
        }
    });
}

function updateNativeHostExtensionId(extensionId: string) {
    const fs = require('fs');
    const os = require('os');
    const hostName = 'com.vibedownloader.host';

    const dirs: string[] = [];
    const home = os.homedir();

    // Chrome dirs
    if (os.platform() === 'win32') {
        dirs.push(path.join(home, 'AppData', 'Local', 'Google', 'Chrome', 'User Data', 'Default', 'NativeMessagingHosts'));
        dirs.push(path.join(home, 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data', 'Default', 'NativeMessagingHosts'));
    } else if (os.platform() === 'darwin') {
        dirs.push(path.join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts'));
    } else {
        dirs.push(path.join(home, '.config', 'google-chrome', 'NativeMessagingHosts'));
    }

    for (const dir of dirs) {
        const manifestPath = path.join(dir, `${hostName}.json`);
        try {
            if (fs.existsSync(manifestPath)) {
                const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
                manifest.allowed_origins = [`chrome-extension://${extensionId}/`];
                fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
                console.log(`Updated native host manifest with extension ID: ${extensionId}`);
            }
        } catch (e) {
            console.error('Failed to update native host manifest:', e);
        }
    }
}

export function stopWebSocketServer() {
    if (wss) {
        wss.close();
        wss = null;
    }
}

export function isWebSocketRunning(): boolean {
    return wss !== null;
}

export function getWebSocketPort(): number {
    return PORT;
}
