import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import os from 'os';
import { spawn } from 'child_process';
import { spawnSync } from 'child_process';
import crx3 from 'crx3';

export type BrowserId = 'chrome' | 'edge' | 'brave' | 'vivaldi' | 'chromium' | 'opera' | 'firefox';

export const FIREFOX_ADDON_ID = 'vibedownloader@vibedownloader.me';

// ---------------------------------------------------------------------------
// Manual (bundled) install.
//
// The extension ships inside the app (see electron-builder extraResources) and
// is copied to a stable folder in the app's userData dir. Chrome/Edge/others
// will not silently auto-install a self-hosted extension on consumer Windows —
// the only universal way is the one-time Developer mode → "Load unpacked" step,
// which the onboarding flow walks the user through with a video + per-browser
// instructions.
// ---------------------------------------------------------------------------

export type InstallMode = 'unpacked';

export interface BrowserStatus {
    id: BrowserId;
    name: string;
    present: boolean;
    installed: boolean;
    manual: boolean;
    needsRestart: boolean;
    note?: string;
}

export interface ExtensionStatus {
    id: string;
    mode: InstallMode;
    crxPath: string;
    xpiPath: string;
    extensionPath: string;
    unpackedDir: string;
    unpackedPrepared: boolean;
    keyExists: boolean;
    browsers: BrowserStatus[];
    isPackaged: boolean;
}

export interface InstallResult {
    success: boolean;
    id: string;
    mode: InstallMode;
    crxPath: string;
    xpiPath: string;
    unpackedDir: string;
    version: string;
    browsers: BrowserStatus[];
    error?: string;
}

export interface BrowserDef {
    id: BrowserId;
    name: string;
    extensionsUrl: string;
    firefox?: boolean;
    manualInstall?: boolean;
    detected: boolean;
    exePath: string | null;
}

function getEnvPaths() {
    const home = os.homedir();
    return {
        pf: process.env.ProgramFiles || 'C:\\Program Files',
        pf86: process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
        la: process.env.LocalAppData || path.join(home, 'AppData', 'Local'),
    };
}

// Detect which browsers are actually installed on this PC. Brave still reads
// Chrome's external-extension registry key, so its entry doubles as Chrome's.
export function getInstalledBrowsers(): BrowserDef[] {
    const { pf, pf86, la } = getEnvPaths();

    // Some browsers install outside the well-known folders (e.g. Firefox via
    // Windows Store / WinGet). Fall back to the Windows "App Paths" registry.
    const fromRegistry = (name: string): string | null => {
        const keys = [
            `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${name}`,
            `HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${name}`,
            `HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${name}`,
        ];
        for (const key of keys) {
            const r = spawnSync('reg', ['query', key, '/ve'], { encoding: 'utf8', windowsHide: true });
            if (r.status !== 0) continue;
            const m = r.stdout?.match(/\(Default\)\s+REG_SZ\s+(.+)/i);
            if (m) {
                const p = m[1].trim().replace(/^"|"$/g, '');
                if (fs.existsSync(p)) return p;
            }
        }
        return null;
    };

    const firefoxRegistryPath = fromRegistry('firefox.exe');

    const exes: Record<BrowserId, string[]> = {
        chrome: [
            path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(la, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        ],
        edge: [
            path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
            path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
            path.join(la, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        ],
        brave: [
            path.join(la, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
            path.join(pf, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
            path.join(pf86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
        ],
        vivaldi: [
            path.join(la, 'Vivaldi', 'Application', 'vivaldi.exe'),
            path.join(pf, 'Vivaldi', 'Application', 'vivaldi.exe'),
        ],
        chromium: [
            path.join(la, 'Chromium', 'Application', 'chrome.exe'),
            path.join(pf, 'Chromium', 'Application', 'chrome.exe'),
        ],
        opera: [
            path.join(pf, 'Opera', 'launcher.exe'),
            path.join(pf86, 'Opera', 'launcher.exe'),
            path.join(la, 'Programs', 'Opera', 'launcher.exe'),
            path.join(pf, 'Opera GX', 'launcher.exe'),
            path.join(la, 'Programs', 'Opera GX', 'launcher.exe'),
        ],
        firefox: [
            path.join(pf, 'Mozilla Firefox', 'firefox.exe'),
            path.join(pf86, 'Mozilla Firefox', 'firefox.exe'),
            path.join(la, 'Programs', 'Mozilla Firefox', 'firefox.exe'),
            firefoxRegistryPath ?? '',
        ].filter(Boolean),
    };

    const defs: Omit<BrowserDef, 'detected' | 'exePath'>[] = [
        { id: 'chrome', name: 'Google Chrome', extensionsUrl: 'chrome://extensions' },
        { id: 'edge', name: 'Microsoft Edge', extensionsUrl: 'edge://extensions' },
        { id: 'brave', name: 'Brave', extensionsUrl: 'brave://extensions' },
        { id: 'vivaldi', name: 'Vivaldi', extensionsUrl: 'vivaldi://extensions' },
        { id: 'chromium', name: 'Chromium', extensionsUrl: 'chrome://extensions' },
        { id: 'opera', name: 'Opera', extensionsUrl: 'opera://extensions', manualInstall: true },
        { id: 'firefox', name: 'Mozilla Firefox', extensionsUrl: 'about:debugging#/runtime/this-firefox', firefox: true },
    ];

    return defs.map(def => {
        const exePath = exes[def.id].find(exe => fs.existsSync(exe)) || null;
        return { ...def, detected: !!exePath, exePath };
    });
}

// Where the unpacked extension lives. Packaged builds ship it next to the app
// resources (see electron-builder extraResources); dev uses the repo copy.
export function getExtensionRootDir(): string {
    return app.isPackaged
        ? path.join(process.resourcesPath, 'extension')
        : path.join(app.getAppPath(), 'extension');
}

export function getExtensionKeyPath(): string {
    return path.join(app.getPath('userData'), 'extension-key.pem');
}

export function getCrxPath(): string {
    return path.join(app.getPath('userData'), 'vibedownloader-extension.crx');
}

export function getXpiPath(): string {
    return path.join(app.getPath('userData'), 'vibedownloader-extension.xpi');
}

// Stable home for the unpacked copy users load via Developer mode. It lives in
// the app data dir so it survives app updates and never moves while loaded.
export function getUnpackedDir(): string {
    return path.join(app.getPath('userData'), 'extension-unpacked');
}

// The extension ID is derived from the signing key, so it must be stable for
// the lifetime of the install. Generate once, reuse forever.
export function ensureExtensionKey(): string {
    const keyPath = getExtensionKeyPath();
    if (!fs.existsSync(keyPath)) {
        const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 4096 });
        fs.mkdirSync(path.dirname(keyPath), { recursive: true });
        fs.writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
        console.log('Generated extension signing key:', keyPath);
    }
    return keyPath;
}

function getExtensionPublicKey(): string {
    const keyPath = ensureExtensionKey();
    const publicKey = crypto.createPublicKey(fs.readFileSync(keyPath));
    return publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
}

// Chrome extension ID = first 16 bytes of SHA-256 of the SPKI public key, hex.
export function getExtensionId(): string {
    const keyPath = ensureExtensionKey();
    const publicKey = crypto.createPublicKey(fs.readFileSync(keyPath));
    const der = publicKey.export({ type: 'spki', format: 'der' });
    return crypto.createHash('sha256').update(der).digest().subarray(0, 16).toString('hex');
}

export function getInstallMode(): InstallMode {
    return 'unpacked';
}

// The ID browsers see: always the key-derived ID (the bundled extension is
// loaded unpacked from the app's own folder, so the ID is stable).
export function getPrimaryExtensionId(): string {
    return getExtensionId();
}

// Origins the native-messaging host should accept (always the key-derived ID).
export function getNativeOrigins(): string[] {
    try {
        return [`chrome-extension://${getExtensionId()}/`];
    } catch {
        return [];
    }
}

// Copy the extension to a stable, writable location and inject the signing key
// into its manifest so Developer-mode loads get a stable ID (and therefore the
// native-messaging host accepts it).
export function prepareUnpackedExtension(): string {
    const src = getExtensionRootDir();
    const dest = getUnpackedDir();

    if (!fs.existsSync(path.join(src, 'manifest.json'))) {
        throw new Error(`Extension not found at ${src}`);
    }

    fs.rmSync(dest, { recursive: true, force: true });
    for (const file of walkFiles(src)) {
        const rel = path.relative(src, file);
        const target = path.join(dest, rel);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (path.basename(file) === 'manifest.json') {
            const manifest = JSON.parse(fs.readFileSync(file, 'utf-8'));
            manifest.key = getExtensionPublicKey();
            fs.writeFileSync(target, JSON.stringify(manifest, null, 2));
        } else {
            fs.copyFileSync(file, target);
        }
    }
    return dest;
}

// Sign the bundled extension into a CRX3 package. Used as an alternative manual
// install (drag onto chrome://extensions with Developer mode on) and by the
// store flow's `update_url` mechanism.
export async function packExtension(): Promise<{ crxPath: string }> {
    const keyPath = ensureExtensionKey();
    const crxPath = getCrxPath();
    const extDir = getExtensionRootDir();

    if (!fs.existsSync(path.join(extDir, 'manifest.json'))) {
        throw new Error(`Extension not found at ${extDir}`);
    }

    fs.mkdirSync(path.dirname(crxPath), { recursive: true });
    await crx3([extDir], { keyPath, crxPath });
    return { crxPath };
}

function walkFiles(dir: string): string[] {
    const results: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) results.push(...walkFiles(full));
        else results.push(full);
    }
    return results;
}

function getExtensionManifestVersion(): string {
    try {
        const manifest = JSON.parse(
            fs.readFileSync(path.join(getExtensionRootDir(), 'manifest.json'), 'utf-8')
        );
        return manifest.version || '1.0.0';
    } catch {
        return '1.0.0';
    }
}

// ---- Developer-mode (unpacked) detection -----------------------------------

// Chrome/Edge record unpacked extensions in each profile's Preferences file
// (Chrome 137+ uses "Secure Preferences") under extensions.settings.<id> with
// `location: 4` and the absolute `path`.
function getProfilePreferencesFiles(browser: BrowserDef): string[] {
    const { la } = getEnvPaths();
    const roots: Partial<Record<BrowserId, string>> = {
        chrome: path.join(la, 'Google', 'Chrome', 'User Data'),
        edge: path.join(la, 'Microsoft', 'Edge', 'User Data'),
        brave: path.join(la, 'BraveSoftware', 'Brave-Browser', 'User Data'),
        vivaldi: path.join(la, 'Vivaldi', 'User Data'),
        chromium: path.join(la, 'Chromium', 'User Data'),
    };
    const root = roots[browser.id];
    if (!root || !fs.existsSync(root)) return [];

    const candidates: string[] = [];
    try {
        const dirs = fs.readdirSync(root)
            .filter(d => d === 'Default' || /^Profile \d+$/.test(d))
            .map(d => path.join(root, d));
        for (const dir of dirs) {
            candidates.push(path.join(dir, 'Preferences'));
            candidates.push(path.join(dir, 'Secure Preferences'));
        }
    } catch {
        // no readable profiles
    }
    return candidates.filter(p => fs.existsSync(p));
}

function isUnpackedLoaded(browser: BrowserDef, extensionId: string, unpackedDir: string): boolean {
    const dir = unpackedDir.replace(/\\/g, '/');
    for (const prefsPath of getProfilePreferencesFiles(browser)) {
        try {
            const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf-8'));
            const settings = prefs?.extensions?.settings?.[extensionId];
            if (!settings) continue;
            // location 4 = unpacked, 3 = external extension
            if (String(settings.path).replace(/\\/g, '/') === dir && settings.location === 4) return true;
        } catch {
            // keep scanning other profiles
        }
    }
    return false;
}

// ---- Install ---------------------------------------------------------------

export async function installExtension(): Promise<InstallResult> {
    const mode = getInstallMode();
    const id = getPrimaryExtensionId();
    const version = getExtensionManifestVersion();
    const browsers = getInstalledBrowsers();
    const results: BrowserStatus[] = [];
    let unpackedDir = '';

    // Prepare the unpacked copy (+ signed CRX as an Opera alternative). Both
    // share the key-derived ID so the native host registration works up front.
    try {
        unpackedDir = prepareUnpackedExtension();
        await packExtension();
    } catch (e: any) {
        return {
            success: false,
            id,
            mode,
            crxPath: getCrxPath(),
            xpiPath: getXpiPath(),
            unpackedDir,
            version,
            browsers: [],
            error: e?.message || String(e),
        };
    }

    for (const browser of browsers) {
        if (!browser.detected) continue;

        if (browser.firefox) {
            results.push({
                id: browser.id,
                name: browser.name,
                present: true,
                installed: false,
                manual: true,
                needsRestart: false,
                note: 'Firefox: open about:debugging#/runtime/this-firefox, click "Load Temporary Add-on" and pick the manifest.json inside the extension folder.',
            });
            continue;
        }

        if (browser.manualInstall) {
            results.push({
                id: browser.id,
                name: browser.name,
                present: true,
                installed: false,
                manual: true,
                needsRestart: false,
                note: 'Opera: open opera://extensions, turn on Developer mode and drag the .crx file (also revealed below) onto the page.',
            });
            continue;
        }

        results.push({
            id: browser.id,
            name: browser.name,
            present: true,
            installed: false,
            manual: true,
            needsRestart: false,
            note: `Open ${browser.extensionsUrl}, turn on Developer mode, click "Load unpacked" and pick the folder revealed below.`,
        });
    }

    return { success: true, id, mode, crxPath: getCrxPath(), xpiPath: getXpiPath(), unpackedDir, version, browsers: results };
}

export async function getExtensionStatus(): Promise<ExtensionStatus> {
    const mode = getInstallMode();
    const keyExists = fs.existsSync(getExtensionKeyPath());
    const id = getPrimaryExtensionId();
    const unpackedDir = getUnpackedDir();
    const unpackedPrepared = fs.existsSync(path.join(unpackedDir, 'manifest.json'));
    const browsers: BrowserStatus[] = [];

    for (const browser of getInstalledBrowsers()) {
        if (!browser.detected) {
            browsers.push({ id: browser.id, name: browser.name, present: false, installed: false, manual: browser.manualInstall || false, needsRestart: false });
            continue;
        }
        if (browser.firefox || browser.manualInstall) {
            browsers.push({ id: browser.id, name: browser.name, present: true, installed: false, manual: true, needsRestart: false });
            continue;
        }
        const loaded = unpackedPrepared && isUnpackedLoaded(browser, id, unpackedDir);
        browsers.push({ id: browser.id, name: browser.name, present: true, installed: loaded, manual: true, needsRestart: false, note: loaded ? 'Running in this browser' : 'Load unpacked to enable' });
    }

    return {
        id,
        mode,
        crxPath: getCrxPath(),
        xpiPath: getXpiPath(),
        extensionPath: getExtensionRootDir(),
        unpackedDir,
        unpackedPrepared,
        keyExists,
        browsers,
        isPackaged: app.isPackaged,
    };
}

export function openBrowserExtensionsPage(browserId: BrowserId): { success: boolean; browser?: BrowserId } {
    const browser = getInstalledBrowsers().find(b => b.id === browserId);
    if (!browser?.exePath) return { success: false };
    try {
        spawn(browser.exePath, [browser.extensionsUrl], { detached: true, stdio: 'ignore' }).unref();
        return { success: true, browser: browserId };
    } catch (e: any) {
        console.error(`Failed to launch ${browser.name}:`, e?.message);
        return { success: false };
    }
}
