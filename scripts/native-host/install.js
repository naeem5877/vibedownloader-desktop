// VibeDownloader - Install Native Messaging Host
// Run this once to register the native host with Chrome

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOST_NAME = 'com.vibedownloader.host';

function getChromeNativeMessagingDir() {
    const platform = os.platform();
    const home = os.homedir();

    switch (platform) {
        case 'win32':
            return path.join(home, 'AppData', 'Local', 'Google', 'Chrome', 'User Data', 'Default', 'NativeMessagingHosts');
        case 'darwin':
            return path.join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts');
        case 'linux':
            return path.join(home, '.config', 'google-chrome', 'NativeMessagingHosts');
        default:
            throw new Error(`Unsupported platform: ${platform}`);
    }
}

function install() {
    const hostDir = getChromeNativeMessagingDir();

    // Create directory if it doesn't exist
    if (!fs.existsSync(hostDir)) {
        fs.mkdirSync(hostDir, { recursive: true });
        console.log('Created directory:', hostDir);
    }

    // Find the bat file
    const scriptsDir = path.join(__dirname);
    const batFile = path.join(scriptsDir, 'com.vibedownloader.host.bat');
    const manifestTemplate = path.join(scriptsDir, 'com.vibedownloader.host.json');

    if (!fs.existsSync(batFile)) {
        console.error('ERROR: com.vibedownloader.host.bat not found in:', scriptsDir);
        process.exit(1);
    }

    // Read manifest template
    let manifest = JSON.parse(fs.readFileSync(manifestTemplate, 'utf-8'));

    // Set the correct path to the bat file (escaped for JSON)
    manifest.path = batFile.replace(/\\/g, '\\\\');

    // Write manifest to Chrome directory
    const manifestPath = path.join(hostDir, `${HOST_NAME}.json`);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log('Installed manifest to:', manifestPath);
    console.log('');
    console.log('Native messaging host installed successfully!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Load the extension in chrome://extensions');
    console.log('2. Make sure VibeDownloader is installed');
    console.log('3. Open a YouTube video and look for the Download button');
}

install();
