import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';

/**
 * Gives the VibeDownloader download folder its own icon in Windows Explorer: a
 * yellow folder with the app's logo badge, the way VLC and other apps mark theirs.
 *
 * Windows reads a folder's icon from a hidden `desktop.ini` inside it. The icon file
 * is copied into the folder too and referenced by a relative path, so the icon keeps
 * working if the app is moved, updated or uninstalled.
 *
 * The top-level VibeDownloader folder gets the app logo; each platform folder
 * (YouTube, Instagram, ...) gets the same folder with that platform's logo.
 *
 * macOS (.icns via NSWorkspace) and Linux (gio custom-icon + .directory) are handled too.
 *
 * Safe by design: never throws, and never touches a folder that
 * already has a `desktop.ini` of its own (a custom icon the user chose).
 */

const ICON_PREFIX = 'vibedownloader';

function iconNameFor(key: string): string {
    return key === 'app' ? `${ICON_PREFIX}.ico` : `${ICON_PREFIX}-${key}.ico`;
}

function buildIni(iconName: string): string {
    return [
        '[.ShellClassInfo]',
        `IconFile=${iconName}`,
        'IconIndex=0',
        `IconResource=${iconName},0`,
        '',
    ].join('\r\n');
}

const handled = new Set<string>();

function sourceIcon(key: string): string | null {
    let rel: string;
    if (process.platform === 'darwin') rel = path.join('folder-icons-mac', `${key}.icns`);
    else if (process.platform === 'linux') rel = path.join('folder-icons-linux', `${key}.png`);
    else rel = key === 'app' ? 'folder-icon.ico' : path.join('folder-icons', `${key}.ico`);
    const p = app.isPackaged
        ? path.join(process.resourcesPath, 'build', rel)
        : path.join(__dirname, '..', '..', 'build', rel);
    return fs.existsSync(p) ? p : null;
}

function attrib(args: string[]): Promise<void> {
    return new Promise((resolve) => {
        execFile('attrib', args, { windowsHide: true, timeout: 10000 }, () => resolve());
    });
}

// Tells Explorer that icons changed, so the new one shows without a manual refresh.
function refreshShell() {
    const script =
        "Add-Type -Namespace W -Name S -MemberDefinition '[DllImport(\"shell32.dll\")] public static extern void SHChangeNotify(int e,int f,IntPtr a,IntPtr b);';" +
        '[W.S]::SHChangeNotify(0x08000000,0,[IntPtr]::Zero,[IntPtr]::Zero)';
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15000 }, () => { /* best effort */ });
}

// macOS: set the folder's custom icon through NSWorkspace (osascript JXA). Skips a folder
// that already has a custom icon (an `Icon\r` file), so a user's own choice is kept.
function applyMac(dir: string, src: string): Promise<void> {
    return new Promise((resolve) => {
        if (fs.existsSync(path.join(dir, 'Icon\r'))) return resolve();
        const js =
            'ObjC.import("AppKit");' +
            `var img=$.NSImage.alloc.initWithContentsOfFile(${JSON.stringify(src)});` +
            `$.NSWorkspace.sharedWorkspace.setIconForFileOptions(img,${JSON.stringify(dir)},0);`;
        execFile('osascript', ['-l', 'JavaScript', '-e', js], { timeout: 15000 }, () => resolve());
    });
}

// Linux: GNOME/Nautilus/Cinnamon/MATE read `metadata::custom-icon`; KDE/Dolphin reads a
// `.directory` file. The png is copied into the folder so the icon survives the app
// being moved or uninstalled. An existing `.directory` is never overwritten.
function applyLinux(dir: string, key: string, src: string): Promise<void> {
    const iconName = `.${iconNameFor(key).replace(/\.ico$/, '.png')}`;
    const icon = path.join(dir, iconName);
    fs.copyFileSync(src, icon);
    const dirFile = path.join(dir, '.directory');
    if (!fs.existsSync(dirFile)) {
        fs.writeFileSync(dirFile, `[Desktop Entry]\nIcon=${icon}\n`, 'utf8');
    }
    return new Promise((resolve) => {
        execFile('gio', ['set', dir, 'metadata::custom-icon', `file://${encodeURI(icon)}`], { timeout: 10000 }, () => resolve());
    });
}

/** `key` is 'app' for the VibeDownloader folder, or a platform key such as 'youtube'. */
export async function applyFolderIcon(dir: string, key: string = 'app'): Promise<void> {
    try {
        if (process.platform !== 'win32' && process.platform !== 'darwin' && process.platform !== 'linux') return;
        const dirKey = path.resolve(dir).toLowerCase();
        if (handled.has(dirKey)) return;
        handled.add(dirKey);

        const src = sourceIcon(key);
        if (!src || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return;

        if (process.platform === 'darwin') return await applyMac(dir, src);
        if (process.platform === 'linux') return await applyLinux(dir, key, src);

        const iconName = iconNameFor(key);
        const ini = path.join(dir, 'desktop.ini');
        const icon = path.join(dir, iconName);

        if (fs.existsSync(ini)) {
            // Ours already? Just make sure the icon file is still there. Someone else's? Leave it.
            let mine = false;
            try { mine = fs.readFileSync(ini, 'latin1').includes(ICON_PREFIX); } catch { /* unreadable */ }
            if (mine) {
                // Keep our icon current (e.g. after a redesign): replace it when it differs.
                let same = false;
                try { same = fs.existsSync(icon) && fs.readFileSync(icon).equals(fs.readFileSync(src)); } catch { /* unreadable */ }
                if (!same) {
                    if (fs.existsSync(icon)) await attrib(['-h', '-s', icon]);
                    fs.copyFileSync(src, icon);
                    await attrib(['+h', '+s', icon]);
                    refreshShell();
                }
            }
            return;
        }

        fs.copyFileSync(src, icon);
        fs.writeFileSync(ini, buildIni(iconName), 'latin1');
        await attrib(['+h', '+s', icon]);
        await attrib(['+h', '+s', ini]);
        // Explorer only honours desktop.ini on folders marked read-only/system.
        await attrib(['+s', dir]);
        refreshShell();
    } catch (e) {
        console.error('Could not set the folder icon:', e);
    }
}
