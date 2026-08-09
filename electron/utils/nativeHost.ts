import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';

const HOST_NAME = 'com.vibedownloader.host';

function getChromeNativeMessagingDir(): string | null {
    const home = os.homedir();
    const platform = os.platform();

    switch (platform) {
        case 'win32':
            return path.join(home, 'AppData', 'Local', 'Google', 'Chrome', 'User Data', 'Default', 'NativeMessagingHosts');
        case 'darwin':
            return path.join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts');
        case 'linux':
            return path.join(home, '.config', 'google-chrome', 'NativeMessagingHosts');
        default:
            return null;
    }
}

function getEdgeNativeMessagingDir(): string | null {
    const home = os.homedir();
    const platform = os.platform();

    switch (platform) {
        case 'win32':
            return path.join(home, 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data', 'Default', 'NativeMessagingHosts');
        default:
            return null;
    }
}

function findHostScript(): string | null {
    const platform = os.platform();
    const ext = platform === 'win32' ? '.bat' : '.sh';

    // When packaged, the script is in resources
    const packagedPath = app.isPackaged
        ? path.join(process.resourcesPath, 'native-host', `com.vibedownloader.host${ext}`)
        : path.join(__dirname, '..', 'scripts', 'native-host', `com.vibedownloader.host${ext}`);

    if (fs.existsSync(packagedPath)) return packagedPath;

    // Try to find the app executable path for the bat script
    const appPath = app.isPackaged ? process.execPath : process.argv[0];

    // Generate inline script pointing to the actual app
    return null;
}

function generateBatContent(): string {
    const appPath = app.isPackaged ? process.execPath : path.join(__dirname, '..', 'node_modules', '.bin', 'electron');
    return `@echo off
start "" "${appPath}" %*
`;
}

function generateShContent(): string {
    const appPath = app.isPackaged ? process.execPath : path.join(__dirname, '..', 'node_modules', '.bin', 'electron');
    return `#!/bin/bash
exec "${appPath}" "$@"
`;
}

function writeManifest(dir: string, scriptPath: string) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    const manifest = {
        name: HOST_NAME,
        description: 'VibeDownloader Native Messaging Host',
        path: scriptPath.replace(/\\/g, '\\\\'),
        type: 'stdio' as const,
        allowed_origins: [
            'chrome-extension://PLACEHOLDER_EXT_ID/'
        ]
    };

    const manifestPath = path.join(dir, `${HOST_NAME}.json`);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log('Registered native host:', manifestPath);
}

function writeScript(dir: string, content: string, filename: string): string {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const scriptPath = path.join(dir, filename);
    fs.writeFileSync(scriptPath, content, { mode: 0o755 });
    return scriptPath;
}

export function registerNativeHost() {
    try {
        const chromeDir = getChromeNativeMessagingDir();
        const edgeDir = getEdgeNativeMessagingDir();
        const isWin = os.platform() === 'win32';
        const ext = isWin ? '.bat' : '.sh';
        const scriptFilename = `${HOST_NAME}${ext}`;

        // Check if host script already exists from a previous install
        const existingScript = findHostScript();

        if (existingScript) {
            // Register with existing script
            if (chromeDir) writeManifest(chromeDir, existingScript);
            if (edgeDir) writeManifest(edgeDir, existingScript);
            return;
        }

        // Generate and register the host script in a stable location
        const hostDir = path.join(app.getPath('userData'), 'native-host');

        if (!fs.existsSync(hostDir)) {
            fs.mkdirSync(hostDir, { recursive: true });
        }

        const scriptPath = isWin
            ? writeScript(hostDir, generateBatContent(), scriptFilename)
            : writeScript(hostDir, generateShContent(), scriptFilename);

        if (chromeDir) writeManifest(chromeDir, scriptPath);
        if (edgeDir) writeManifest(edgeDir, scriptPath);

    } catch (e) {
        console.error('Failed to register native messaging host:', e);
    }
}
