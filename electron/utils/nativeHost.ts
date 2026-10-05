import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execFileSync } from 'child_process';
import { getNativeOrigins, FIREFOX_ADDON_ID } from './extensionInstaller';

const HOST_NAME = 'com.vibedownloader.host';

/**
 * NativeMessagingHosts folders for every Chromium-family browser on macOS and
 * Linux. Chrome is always written (it is the common case and creating its
 * folder is harmless); the others only when the browser's profile folder
 * already exists, so we never litter machines that do not have them.
 */
function getChromiumNativeMessagingDirs(): string[] {
    const home = os.homedir();
    const platform = os.platform();
    const roots: { root: string; always?: boolean }[] = [];

    if (platform === 'darwin') {
        const support = path.join(home, 'Library', 'Application Support');
        roots.push(
            { root: path.join(support, 'Google', 'Chrome'), always: true },
            { root: path.join(support, 'Microsoft Edge') },
            { root: path.join(support, 'BraveSoftware', 'Brave-Browser') },
            { root: path.join(support, 'Vivaldi') },
            { root: path.join(support, 'Chromium') },
            { root: path.join(support, 'com.operasoftware.Opera') },
        );
    } else if (platform === 'linux') {
        const config = path.join(home, '.config');
        roots.push(
            { root: path.join(config, 'google-chrome'), always: true },
            { root: path.join(config, 'microsoft-edge') },
            { root: path.join(config, 'BraveSoftware', 'Brave-Browser') },
            { root: path.join(config, 'vivaldi') },
            { root: path.join(config, 'chromium') },
            { root: path.join(config, 'opera') },
        );
    }

    return roots
        .filter(r => r.always || fs.existsSync(r.root))
        .map(r => path.join(r.root, 'NativeMessagingHosts'));
}

// Where the bundled Windows host exe lives inside the app. Only ever called
// from the Windows branch below, but guarded anyway so a future caller on
// mac/linux gets a clear error instead of probing for a non-existent .exe.
function getSourceHostExe(): string {
    if (os.platform() !== 'win32') {
        throw new Error('The native messaging host binary is Windows-only.');
    }
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'native-host', `${HOST_NAME}.exe`);
    }
    return path.join(app.getAppPath(), 'native-host', `${HOST_NAME}.exe`);
}

function generateShContent(): string {
    const appPath = app.isPackaged
        ? `"${process.execPath}"`
        : `"${process.execPath}" "${app.getAppPath()}"`;
    return `#!/bin/bash
${appPath} "$@" &
while read -r line; do :; done
`;
}

function writeShScript(dir: string, content: string, filename: string): string {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const scriptPath = path.join(dir, filename);
    fs.writeFileSync(scriptPath, content, { mode: 0o755 });
    return scriptPath;
}

function writeManifest(manifestPath: string, manifest: Record<string, unknown>) {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log('Registered native host:', manifestPath);
}

// Windows host: the bridge is a small .exe that (1) launches the desktop app
// detached via ShellExecute and (2) holds the native-messaging stdin pipe open
// so the browser sees the host as alive. The app runs in its own process tree,
// so Chrome killing the bridge (it does, 2s after the port closes) never
// touches an in-progress download.
function setupWindowsHost(hostDir: string): string {
    fs.mkdirSync(hostDir, { recursive: true });

    const hostExe = path.join(hostDir, `${HOST_NAME}.exe`);
    const sourceExe = getSourceHostExe();
    if (fs.existsSync(sourceExe)) {
        fs.copyFileSync(sourceExe, hostExe);
    } else if (!fs.existsSync(hostExe)) {
        throw new Error(`Native host exe not found at ${sourceExe}`);
    }

    // Config tells the bridge what to launch: line 1 = app exe, line 2 = args.
    const appExe = process.execPath;
    const appArgs = app.isPackaged ? '' : `"${app.getAppPath()}"`;
    fs.writeFileSync(
        path.join(hostDir, `${HOST_NAME}.config`),
        `${appExe}\r\n${appArgs}\r\n`,
        { encoding: 'utf8' }
    );

    // Remove the old .bat host so nothing points at the fragile cmd path.
    const oldBat = path.join(hostDir, `${HOST_NAME}.bat`);
    if (fs.existsSync(oldBat)) fs.rmSync(oldBat, { force: true });

    return hostExe;
}

// Firefox reads native-messaging host manifests from the registry on Windows:
// HKCU\Software\Mozilla\NativeMessagingHosts\<name> -> default value = path to
// the JSON manifest. The manifest uses `allowed_extensions` (add-on IDs) rather
// than `allowed_origins`.
function registerFirefoxNativeHost(hostDir: string, hostPath: string) {
    const home = os.homedir();
    const isWin = os.platform() === 'win32';
    if (!isWin) return;

    const manifestDir = path.join(home, 'AppData', 'Roaming', 'Mozilla', 'NativeMessagingHosts');
    if (!fs.existsSync(manifestDir)) fs.mkdirSync(manifestDir, { recursive: true });

    const manifest = {
        name: HOST_NAME,
        description: 'VibeDownloader Native Messaging Host',
        path: hostPath,
        type: 'stdio',
        allowed_extensions: [FIREFOX_ADDON_ID],
    };

    const manifestPath = path.join(manifestDir, `${HOST_NAME}.json`);
    writeManifest(manifestPath, manifest);

    try {
        execFileSync('reg', ['add', `HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${HOST_NAME}`, '/f', '/t', 'REG_SZ', '/ve', '/d', manifestPath]);
    } catch (e) {
        console.error('Failed to register Firefox native host in registry:', e);
    }
}

// Windows URL protocol fallback: the extension can launch the app with a
// vibedownloader:// link even if native messaging is blocked/misconfigured in
// the browser. `%1` is the full URL, which the app just ignores on boot.
export function registerUrlProtocol() {
    if (os.platform() !== 'win32') return;
    const appExe = process.execPath;
    try {
        const base = 'HKCU\\Software\\Classes\\vibedownloader';
        execFileSync('reg', ['add', base, '/f', '/ve', '/d', 'URL:vibedownloader Protocol']);
        execFileSync('reg', ['add', base, '/f', '/v', 'URL Protocol', '/t', 'REG_SZ', '/d', '']);
        execFileSync('reg', ['add', `${base}\\DefaultIcon`, '/f', '/ve', '/d', `"${appExe}",0`]);
        execFileSync('reg', ['add', `${base}\\shell\\open\\command`, '/f', '/d', `"${appExe}" "%1"`]);
        console.log('Registered vibedownloader:// URL protocol:', appExe);
    } catch (e) {
        console.error('Failed to register URL protocol:', e);
    }
}

export function registerNativeHost() {
    try {
        const isWin = os.platform() === 'win32';
        const hostDir = path.join(app.getPath('userData'), 'native-host');

        if (isWin) {
            const hostExe = setupWindowsHost(hostDir);

            const manifest = {
                name: HOST_NAME,
                description: 'VibeDownloader Native Messaging Host',
                path: hostExe,
                type: 'stdio' as const,
                allowed_origins: getNativeOrigins()
            };
            const manifestPath = path.join(hostDir, `${HOST_NAME}.json`);
            writeManifest(manifestPath, manifest);

            // Chromium-family browsers on Windows discover native hosts ONLY via
            // the registry (a NativeMessagingHosts directory is not read).
            const registries: { base: string; name: string }[] = [
                { base: 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts', name: 'Chrome' },
                { base: 'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts', name: 'Edge' },
                { base: 'HKCU\\Software\\BraveSoftware\\Brave\\NativeMessagingHosts', name: 'Brave' },
                { base: 'HKCU\\Software\\Vivaldi\\NativeMessagingHosts', name: 'Vivaldi' },
                { base: 'HKCU\\Software\\Chromium\\NativeMessagingHosts', name: 'Chromium' },
                { base: 'HKLM\\Software\\Google\\Chrome\\NativeMessagingHosts', name: 'Chrome (all users)' },
                { base: 'HKLM\\Software\\Microsoft\\Edge\\NativeMessagingHosts', name: 'Edge (all users)' },
                { base: 'HKLM\\Software\\BraveSoftware\\Brave\\NativeMessagingHosts', name: 'Brave (all users)' },
            ];
            for (const { base, name } of registries) {
                try {
                    execFileSync('reg', ['add', `${base}\\${HOST_NAME}`, '/f', '/t', 'REG_SZ', '/ve', '/d', manifestPath]);
                    console.log(`Registered native host for ${name}: ${base}\\${HOST_NAME}`);
                } catch (e) {
                    // HKLM needs admin — HKCU (which browsers check first) is enough.
                    console.error(`Failed to register native host for ${name}:`, e);
                }
            }
            registerFirefoxNativeHost(hostDir, hostExe);
        } else {
            // macOS / Linux: hosts are discovered from these directories.
            const scriptPath = writeShScript(hostDir, generateShContent(), `${HOST_NAME}.sh`);
            const manifest = {
                name: HOST_NAME,
                description: 'VibeDownloader Native Messaging Host',
                path: scriptPath,
                type: 'stdio' as const,
                allowed_origins: getNativeOrigins()
            };
            // Each browser has its own folder, and a missing one used to throw on
            // the first browser and silently skip every browser after it.
            for (const dir of getChromiumNativeMessagingDirs()) {
                try {
                    writeManifest(path.join(dir, `${HOST_NAME}.json`), manifest);
                } catch (e) {
                    console.error('Failed to register native host in', dir, e);
                }
            }
        }

    } catch (e) {
        console.error('Failed to register native messaging host:', e);
    }
}
