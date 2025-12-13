import { app } from 'electron';
import path from 'path';
import fs from 'fs';

// Settings storage
export const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

export interface AppSettings {
    downloadBasePath: string;
}

export function loadSettings(): AppSettings {
    try {
        if (fs.existsSync(settingsPath())) {
            return JSON.parse(fs.readFileSync(settingsPath(), 'utf-8'));
        }
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
    return { downloadBasePath: app.getPath('downloads') };
}

export function saveSettings(settings: AppSettings) {
    try {
        fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf-8');
    } catch (e) {
        console.error('Failed to save settings:', e);
    }
}

// Get organized download path based on platform and content type
export function getOrganizedPath(platform: string, contentType: string): string {
    const settings = loadSettings();
    const basePath = settings.downloadBasePath || app.getPath('downloads');

    // Map content types to folder names
    const contentFolders: Record<string, string> = {
        'video': 'Videos',
        'audio': 'Audio',
        'reel': 'Reels',
        'reels': 'Reels',
        'story': 'Stories',
        'stories': 'Stories',
        'playlist': 'Playlists',
        'thumbnail': 'Thumbnails',
        'photo': 'Photos',
        'shorts': 'Shorts',
        'post': 'Posts',
        'track': 'Tracks',
        'album': 'Albums'
    };

    // Map platforms to folder names
    const platformFolders: Record<string, string> = {
        'youtube': 'YouTube',
        'instagram': 'Instagram',
        'tiktok': 'TikTok',
        'facebook': 'Facebook',
        'spotify': 'Spotify',
        'x': 'X (Twitter)',
        'pinterest': 'Pinterest',
        'soundcloud': 'SoundCloud'
    };

    const platformFolder = platformFolders[platform.toLowerCase()] || platform;
    const contentFolder = contentFolders[contentType.toLowerCase()] || 'Videos';

    const fullPath = path.join(basePath, 'VibeDownloader', platformFolder, contentFolder);

    // Create directories if they don't exist
    if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
    }

    return fullPath;
}

// Cookie Management
export function getCookiesDir() {
    const cookiesDir = path.join(app.getPath('userData'), 'cookies');
    if (!fs.existsSync(cookiesDir)) fs.mkdirSync(cookiesDir, { recursive: true });
    return cookiesDir;
}

export function getCookiePath(platform: string) {
    return path.join(getCookiesDir(), `cookies_${platform}.txt`);
}

export function getHistoryPath() {
    return path.join(app.getPath('userData'), 'history.json');
}
