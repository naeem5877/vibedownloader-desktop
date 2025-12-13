import { ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { getCookiePath } from '../utils/paths';

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
            return { success: false, error: e.message };
        }
    });
}
