"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electron', {
    getVideoInfo: (url) => electron_1.ipcRenderer.invoke('get-video-info', url),
    getSpotifyInfo: (url) => electron_1.ipcRenderer.invoke('get-spotify-info', url),
    downloadVideo: (params) => electron_1.ipcRenderer.invoke('download-video', params),
    downloadSpotifyTrack: (params) => electron_1.ipcRenderer.invoke('download-spotify-track', params),
    getProxyImage: (url) => electron_1.ipcRenderer.invoke('proxy-image', url),
    // Cookies
    saveCookies: (content, platform) => electron_1.ipcRenderer.invoke('save-cookies', content, platform),
    getCookiesStatus: (platform) => electron_1.ipcRenderer.invoke('get-cookies-status', platform),
    deleteCookies: (platform) => electron_1.ipcRenderer.invoke('delete-cookies', platform),
    // Download Path
    getDownloadPath: () => electron_1.ipcRenderer.invoke('get-download-path'),
    chooseDownloadFolder: () => electron_1.ipcRenderer.invoke('choose-download-folder'),
    // File Operations
    openInFolder: (filePath) => electron_1.ipcRenderer.invoke('open-in-folder', filePath),
    saveThumbnail: (params) => electron_1.ipcRenderer.invoke('save-thumbnail', params),
    // Updates & Versions
    getVersions: () => electron_1.ipcRenderer.invoke('get-versions'),
    updateYtdlp: () => electron_1.ipcRenderer.invoke('update-ytdlp'),
    // Auto-Update System
    checkForUpdates: () => electron_1.ipcRenderer.invoke('check-for-updates'),
    installUpdate: () => electron_1.ipcRenderer.invoke('install-update'),
    getAppInfo: () => electron_1.ipcRenderer.invoke('get-app-info'),
    onUpdateStatus: (callback) => {
        const handler = (_, data) => callback(data);
        electron_1.ipcRenderer.on('update-status', handler);
        window._updateStatusHandler = handler;
    },
    offUpdateStatus: () => {
        const handler = window._updateStatusHandler;
        if (handler) {
            electron_1.ipcRenderer.removeListener('update-status', handler);
        }
    },
    // Progress events
    onProgress: (callback) => {
        const handler = (_, data) => callback(data);
        electron_1.ipcRenderer.on('download-progress', handler);
        window._progressHandler = handler;
    },
    offProgress: () => {
        const handler = window._progressHandler;
        if (handler) {
            electron_1.ipcRenderer.removeListener('download-progress', handler);
        }
    },
    // Window controls
    minimize: () => electron_1.ipcRenderer.invoke('minimize-window'),
    maximize: () => electron_1.ipcRenderer.invoke('maximize-window'),
    close: () => electron_1.ipcRenderer.invoke('close-window'),
});
//# sourceMappingURL=preload.js.map