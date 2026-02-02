/// <reference types="vite/client" />

interface Window {
    electron: {
        getVideoInfo: (url: string) => Promise<any>;
        getSpotifyInfo: (url: string) => Promise<any>;
        downloadVideo: (params: { url: string; formatId: string; title: string; platform?: string; contentType?: string; thumbnail?: string; playlistTitle?: string }) => Promise<any>;
        downloadSpotifyTrack: (params: { searchQuery: string; title: string; artist: string; thumbnail?: string; playlistTitle?: string }) => Promise<any>;
        getProxyImage: (url: string) => Promise<string | null>;

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
    }
}

