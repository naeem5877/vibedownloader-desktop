import { app } from 'electron';
import path from 'path';
import fs from 'fs';

// Settings storage
export const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

export interface AppSettings {
    downloadBasePath: string;
    minimizeToTray: boolean;
    onboardingCompleted?: boolean;
}

export function loadSettings(): AppSettings {
    try {
        if (fs.existsSync(settingsPath())) {
            const settings = JSON.parse(fs.readFileSync(settingsPath(), 'utf-8'));
            return {
                downloadBasePath: settings.downloadBasePath || app.getPath('downloads'),
                minimizeToTray: settings.minimizeToTray ?? true, // Default to true for better UX
                onboardingCompleted: settings.onboardingCompleted ?? false,
            };
        }
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
    return {
        downloadBasePath: app.getPath('downloads'),
        minimizeToTray: true,
        onboardingCompleted: false,
    };
}

function getDownloadPath(): string {
    const settings = loadSettings();
    return settings.downloadBasePath;
}

export function saveSettings(settings: AppSettings) {
    try {
        fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf-8');
    } catch (e) {
        console.error('Failed to save settings:', e);
    }
}

// Get organized download path based on platform and content type
export function getOrganizedPath(platform: string, contentType: string, subFolder?: string): string {
    const settings = loadSettings();
    const basePath = settings.downloadBasePath || app.getPath('downloads');

    // Map content types to folder names
    const contentFolders: Record<string, string> = {
        'video': 'Videos',
        'audio': 'Audio',
        'subtitles': 'Subtitles',
        'music': 'Music',
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
        'album': 'Albums',
        'live': 'Live',
        'vod': 'VODs',
        'clip': 'Clips'
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
        'soundcloud': 'SoundCloud',
        'twitch': 'Twitch'
    };

    const platformFolder = platformFolders[platform.toLowerCase()] || platform;
    const contentFolder = contentFolders[contentType.toLowerCase()] || 'Videos';

    let fullPath = path.join(basePath, 'VibeDownloader', platformFolder, contentFolder);

    // Add subfolder (e.g. for playlist titles)
    if (subFolder) {
        const safeSubFolder = subFolder.replace(/[^a-zA-Z0-9 \-_]/g, '').trim();
        if (safeSubFolder) {
            fullPath = path.join(fullPath, safeSubFolder);
        }
    }

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

// Instagram Stories resolver key
//
// Kept in its own file rather than in `settings.json`, because settings are read
// wholesale by `get-settings` and sent to the renderer. This key pays real money
// per lookup, so it must never travel that path. It is deliberately not in the
// `AppSettings` interface for the same reason.
const storiesKeyPath = () => path.join(app.getPath('userData'), 'instagram-stories-key');

/** The resolver API key, or an empty string when none is configured. */
export function loadStoriesApiKey(): string {
    try {
        const p = storiesKeyPath();
        if (fs.existsSync(p)) return fs.readFileSync(p, 'utf-8').trim();
    } catch (e) {
        console.error('Failed to read the stories API key:', e);
    }
    return '';
}

/** Stores the key, or clears it when given an empty value. */
export function saveStoriesApiKey(key: string): void {
    try {
        const p = storiesKeyPath();
        const value = (key || '').trim();
        if (!value) {
            if (fs.existsSync(p)) fs.unlinkSync(p);
            return;
        }
        fs.writeFileSync(p, value, 'utf-8');
    } catch (e) {
        console.error('Failed to save the stories API key:', e);
    }
}

/**
 * What the renderer is told about the key: whether one exists, and a masked
 * hint so a user can tell *which* key is stored without the value being sent
 * anywhere.
 */
export function getStoriesApiKeyStatus(): { configured: boolean; masked: string } {
    const key = loadStoriesApiKey();
    if (!key) return { configured: false, masked: '' };
    if (key.length <= 8) return { configured: true, masked: `${key.slice(0, 2)}${'•'.repeat(6)}` };
    return { configured: true, masked: `${key.slice(0, 6)}…${key.slice(-4)}` };
}


