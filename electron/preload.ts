import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
    getVideoInfo: (url: string) => ipcRenderer.invoke('get-video-info', url),
    getSpotifyInfo: (url: string) => ipcRenderer.invoke('get-spotify-info', url),
    downloadVideo: (params: any) => ipcRenderer.invoke('download-video', params),
    downloadSpotifyTrack: (params: any) => ipcRenderer.invoke('download-spotify-track', params),
    getProxyImage: (url: string) => ipcRenderer.invoke('proxy-image', url),

    // Cookies
    saveCookies: (content: string, platform: string) => ipcRenderer.invoke('save-cookies', content, platform),
    getCookiesStatus: (platform: string) => ipcRenderer.invoke('get-cookies-status', platform),
    deleteCookies: (platform: string) => ipcRenderer.invoke('delete-cookies', platform),

    // Download Path
    getDownloadPath: () => ipcRenderer.invoke('get-download-path'),
    chooseDownloadFolder: () => ipcRenderer.invoke('choose-download-folder'),

    // File Operations
    openInFolder: (filePath: string) => ipcRenderer.invoke('open-in-folder', filePath),
    saveThumbnail: (params: { url: string, title: string }) => ipcRenderer.invoke('save-thumbnail', params),

    // Updates & Versions
    getVersions: () => ipcRenderer.invoke('get-versions'),
    updateYtdlp: () => ipcRenderer.invoke('update-ytdlp'),

    // Auto-Update System
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    installUpdate: () => ipcRenderer.invoke('install-update'),
    getAppInfo: () => ipcRenderer.invoke('get-app-info'),
    onUpdateStatus: (callback: (data: any) => void) => {
        const handler = (_: any, data: any) => callback(data);
        ipcRenderer.on('update-status', handler);
        (window as any)._updateStatusHandler = handler;
    },
    offUpdateStatus: () => {
        const handler = (window as any)._updateStatusHandler;
        if (handler) {
            ipcRenderer.removeListener('update-status', handler);
        }
    },

    // Progress events
    onProgress: (callback: (data: any) => void) => {
        const handler = (_: any, data: any) => callback(data);
        ipcRenderer.on('download-progress', handler);
        (window as any)._progressHandler = handler;
    },
    offProgress: () => {
        const handler = (window as any)._progressHandler;
        if (handler) {
            ipcRenderer.removeListener('download-progress', handler);
        }
    },

    // Window controls
    minimize: () => ipcRenderer.invoke('minimize-window'),
    maximize: () => ipcRenderer.invoke('maximize-window'),
    close: () => ipcRenderer.invoke('close-window'),

    // Utilities
    openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
    copyToClipboard: (text: string) => ipcRenderer.invoke('copy-to-clipboard', text),
});
