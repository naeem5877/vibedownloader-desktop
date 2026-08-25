/// <reference types="vite/client" />

interface Window {
    electron: {
        getVideoInfo: (url: string) => Promise<any>;
        getSpotifyInfo: (url: string) => Promise<any>;
        downloadVideo: (params: { url: string; formatId: string; title: string; platform?: string; contentType?: string; thumbnail?: string; playlistTitle?: string; suppressNotifications?: boolean; jobId?: string }) => Promise<any>;
        downloadSpotifyTrack: (params: { searchQuery: string; title: string; artist: string; thumbnail?: string; playlistTitle?: string; suppressNotifications?: boolean; jobId?: string }) => Promise<any>;
        getProxyImage: (url: string) => Promise<string | null>;

        showNotification: (title: string, body: string) => Promise<{ success: boolean; error?: string }>;

        saveCookies: (content: string, platform: string) => Promise<{ success: boolean; error?: string }>;
        getCookiesStatus: (platform: string) => Promise<{ exists: boolean; path?: string }>;
        deleteCookies: (platform: string) => Promise<{ success: boolean; error?: string }>;
        chooseCookieFile: () => Promise<{ success: boolean; content?: string; error?: string }>;

        // Download Path
        getDownloadPath: () => Promise<{ path: string }>;
        chooseDownloadFolder: () => Promise<{ path: string | null }>;

        // File Operations
        openInFolder: (filePath: string) => Promise<{ success: boolean }>;
        saveThumbnail: (params: { url: string; title: string }) => Promise<{ success: boolean; path?: string }>;

        // Updates & Versions
        getVersions: () => Promise<{ app: string; ytdlp: string }>;
        updateYtdlp: () => Promise<{ updated: boolean; version?: string; message?: string; error?: string }>;

        // Auto-Update System
        checkForUpdates: () => Promise<{ success: boolean; updateInfo?: any; error?: string }>;
        installUpdate: () => Promise<{ success: boolean; error?: string }>;
        getAppInfo: () => Promise<{ version: string; name: string; isPackaged: boolean }>;
        onUpdateStatus: (callback: (data: any) => void) => void;
        offUpdateStatus?: () => void;

        onProgress: (callback: (data: any) => void) => void;
        offProgress?: () => void;

        minimize: () => Promise<void>;
        maximize: () => Promise<void>;
        close: () => Promise<void>;
        openExternal: (url: string) => Promise<void>;
        copyToClipboard: (text: string) => Promise<void>;

        getSettings: () => Promise<any>;
        saveSettings: (settings: any) => Promise<{ success: boolean; error?: string }>;

        // Extension install
        installExtension: () => Promise<{
            success: boolean;
            id: string;
            mode: 'unpacked';
            crxPath: string;
            xpiPath: string;
            unpackedDir: string;
            version: string;
            browsers: {
                id: string;
                name: string;
                present: boolean;
                installed: boolean;
                manual: boolean;
                needsRestart: boolean;
                note?: string;
            }[];
            error?: string;
        }>;
        getExtensionStatus: () => Promise<{
            id: string;
            mode: 'unpacked';
            crxPath: string;
            xpiPath: string;
            extensionPath: string;
            unpackedDir: string;
            unpackedPrepared: boolean;
            keyExists: boolean;
            browsers: {
                id: string;
                name: string;
                present: boolean;
                installed: boolean;
                manual: boolean;
                needsRestart: boolean;
                note?: string;
            }[];
            isPackaged: boolean;
        }>;
        getInstalledBrowsers: () => Promise<{ id: string; name: string; detected: boolean }[]>;
        openBrowserExtensionsPage: (browserId: string) => Promise<{ success: boolean; browser?: string }>;
        revealExtensionFolder: () => Promise<{ success: boolean; dir?: string; error?: string }>;

        // External URL from browser extension
        onExternalDownloadUrl: (callback: (data: { url: string; title: string; thumbnail: string }) => void) => void;
        offExternalDownloadUrl?: () => void;

        // External Spotify search from browser extension (title/artist → YouTube)
        onExternalSpotifyDownload: (callback: (data: { searchQuery: string; title: string; artist: string; thumbnail: string }) => void) => void;
        offExternalSpotifyDownload?: () => void;

        // Cookies updated from the browser extension (e.g. YouTube account added)
        onCookiesUpdated: (callback: (data: { platform: string }) => void) => void;
        offCookiesUpdated?: () => void;
    }
}

