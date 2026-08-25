import { ipcMain, shell } from 'electron';
import {
    installExtension,
    getExtensionStatus,
    openBrowserExtensionsPage,
    getInstalledBrowsers,
    prepareUnpackedExtension,
} from '../utils/extensionInstaller';

export function registerExtensionHandlers() {
    ipcMain.handle('install-extension', async () => {
        return installExtension();
    });

    ipcMain.handle('get-extension-status', async () => {
        return getExtensionStatus();
    });

    // `chrome://extensions` (and friends) are not OS-registered protocols, so
    // shell.openExternal won't work. Launch the browser binary directly.
    ipcMain.handle('open-browser-extensions-page', async (event: any, browserId: string) => {
        return openBrowserExtensionsPage(browserId as any);
    });

    ipcMain.handle('get-installed-browsers', async () => {
        return getInstalledBrowsers().map(b => ({ id: b.id, name: b.name, detected: b.detected }));
    });

    // Copy the bundled extension to its hidden home in the app data dir and
    // reveal it in Explorer so the user can pick it via "Load unpacked".
    ipcMain.handle('reveal-extension-folder', async () => {
        try {
            const dir = prepareUnpackedExtension();
            shell.openPath(dir);
            return { success: true, dir };
        } catch (e: any) {
            return { success: false, error: e?.message || String(e) };
        }
    });
}
