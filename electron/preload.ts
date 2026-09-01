import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
    getVideoInfo: (url: string) => ipcRenderer.invoke('get-video-info', url),
    getSpotifyInfo: (url: string) => ipcRenderer.invoke('get-spotify-info', url),
    downloadVideo: (params: any) => ipcRenderer.invoke('download-video', params),
    cancelDownload: (jobId: string) => ipcRenderer.invoke('cancel-download', jobId),
    downloadSpotifyTrack: (params: any) => ipcRenderer.invoke('download-spotify-track', params),
    getProxyImage: (url: string) => ipcRenderer.invoke('proxy-image', url),

    // Cookies
    saveCookies: (content: string, platform: string) => ipcRenderer.invoke('save-cookies', content, platform),
    getCookiesStatus: (platform: string) => ipcRenderer.invoke('get-cookies-status', platform),
    deleteCookies: (platform: string) => ipcRenderer.invoke('delete-cookies', platform),
    chooseCookieFile: () => ipcRenderer.invoke('choose-cookie-file'),

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

    // Notifications
    showNotification: (title: string, body: string) => ipcRenderer.invoke('show-notification', { title, body }),

    // Window controls
    minimize: () => ipcRenderer.invoke('minimize-window'),
    maximize: () => ipcRenderer.invoke('maximize-window'),
    close: () => ipcRenderer.invoke('close-window'),

    // Utilities
    openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
    copyToClipboard: (text: string) => ipcRenderer.invoke('copy-to-clipboard', text),

    // Settings
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings: any) => ipcRenderer.invoke('save-settings', settings),

    // Extension install
    installExtension: () => ipcRenderer.invoke('install-extension'),
    getExtensionStatus: () => ipcRenderer.invoke('get-extension-status'),
    getInstalledBrowsers: () => ipcRenderer.invoke('get-installed-browsers'),
    openBrowserExtensionsPage: (browserId: string) => ipcRenderer.invoke('open-browser-extensions-page', browserId),
    revealExtensionFolder: () => ipcRenderer.invoke('reveal-extension-folder'),

    // External URL from browser extension
    onExternalDownloadUrl: (callback: (data: { url: string, title: string, thumbnail: string }) => void) => {
        const handler = (_: any, data: any) => callback(data);
        ipcRenderer.on('external-download-url', handler);
        (window as any)._externalUrlHandler = handler;
    },
    offExternalDownloadUrl: () => {
        const handler = (window as any)._externalUrlHandler;
        if (handler) {
            ipcRenderer.removeListener('external-download-url', handler);
        }
    },

    onExternalSpotifyDownload: (callback: (data: { searchQuery: string, title: string, artist: string, thumbnail: string }) => void) => {
        const handler = (_: any, data: any) => callback(data);
        ipcRenderer.on('external-download-spotify', handler);
        (window as any)._externalSpotifyHandler = handler;
    },
    offExternalSpotifyDownload: () => {
        const handler = (window as any)._externalSpotifyHandler;
        if (handler) {
            ipcRenderer.removeListener('external-download-spotify', handler);
        }
    },

    // Cookies updated from the browser extension (e.g. YouTube account added)
    onCookiesUpdated: (callback: (data: { platform: string }) => void) => {
        const handler = (_: any, data: any) => callback(data);
        ipcRenderer.on('cookies-updated', handler);
        (window as any)._cookiesUpdatedHandler = handler;
    },
    offCookiesUpdated: () => {
        const handler = (window as any)._cookiesUpdatedHandler;
        if (handler) {
            ipcRenderer.removeListener('cookies-updated', handler);
        }
    },
});
