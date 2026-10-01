import { ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { getCookiePath, loadStoriesApiKey, saveStoriesApiKey, getStoriesApiKeyStatus } from '../utils/paths';

export function registerCookieHandlers() {
    ipcMain.handle('save-cookies', async (event: any, content: string, platform: string = 'instagram') => {
        try {
            if (!content || !content.trim()) {
                return { success: false, error: "Empty cookie content" };
            }
            const targetPath = getCookiePath(platform);
            const dir = path.dirname(targetPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            // Save cleaned content
            fs.writeFileSync(targetPath, content.trim(), 'utf-8');
            console.log(`Cookies saved to ${targetPath} for ${platform}`);
            return { success: true };
        } catch (e: any) {
            console.error('Failed to save cookies:', e);
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('get-cookies-status', async (event: any, platform: string = 'instagram') => {
        try {
            const targetPath = getCookiePath(platform);
            if (fs.existsSync(targetPath)) {
                const stats = fs.statSync(targetPath);
                return { exists: stats.size > 0, path: targetPath };
            }
            return { exists: false };
        } catch (e) {
            return { exists: false };
        }
    });

    ipcMain.handle('delete-cookies', async (event: any, platform: string = 'instagram') => {
        try {
            const targetPath = getCookiePath(platform);
            if (fs.existsSync(targetPath)) {
                fs.unlinkSync(targetPath);
            }
            return { success: true };
        } catch (e: any) {
            return { success: false, error: e?.message || e };
        }
    });

    /**
     * The Instagram Stories resolver key.
     *
     * There is deliberately no getter that returns the value - only a masked
     * status. The key is a paid credential, so it is stored outside
     * `settings.json` and never crosses back into the renderer once written. The
     * UI can show "key configured" and can overwrite or clear it, but cannot
     * read it back out.
     */
    ipcMain.handle('get-stories-api-key-status', async () => {
        return getStoriesApiKeyStatus();
    });

    ipcMain.handle('save-stories-api-key', async (event: any, key: string) => {
        try {
            const value = typeof key === 'string' ? key.trim() : '';
            // A key pasted with surrounding whitespace, or with a URL wrapper
            // around it, fails with `invalid_api_key` - which reads like a
            // revoked key and sends the user off to re-issue one needlessly.
            if (value && /\s/.test(value)) {
                return { success: false, error: 'The key must not contain spaces. Paste just the key.' };
            }
            saveStoriesApiKey(value);
            return { success: true, ...getStoriesApiKeyStatus() };
        } catch (e: any) {
            return { success: false, error: e?.message || 'Could not save the key.' };
        }
    });

    ipcMain.handle('clear-stories-api-key', async () => {
        try {
            saveStoriesApiKey('');
            return { success: true, ...getStoriesApiKeyStatus() };
        } catch (e: any) {
            return { success: false, error: e?.message || 'Could not clear the key.' };
        }
    });

    /**
     * Confirms a key against the live service before the user relies on it.
     *
     * `/v1/credits` is free, unlike the 2-credit stories call, so verifying here
     * cannot spend anything. A well-formed key is not proof that it works - a
     * revoked key looks identical until it is actually sent.
     */
    ipcMain.handle('test-stories-api-key', async () => {
        const key = loadStoriesApiKey();
        if (!key) return { success: false, error: 'No key is configured yet.' };

        try {
            const res = await fetch('https://api.profilequery.com/v1/credits', {
                headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
                signal: AbortSignal.timeout(10_000)
            });
            const body: any = await res.json().catch(() => null);

            if (res.ok) {
                return { success: true, credits: body?.data?.credits ?? body?.credits ?? null };
            }
            return {
                success: false,
                error: body?.error?.message || `The Stories service rejected the key (HTTP ${res.status}).`
            };
        } catch (e: any) {
            return { success: false, error: `Could not reach the Stories service: ${e?.message || 'network error'}` };
        }
    });
}