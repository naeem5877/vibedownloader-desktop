import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// Determine the possible .env locations
const possiblePaths = [
    path.join(process.cwd(), '.env'),             // Root directory during development
    path.join(__dirname, '../../.env'),           // Relative to dist-electron/utils during development
    path.join(__dirname, '../../../.env'),        // Alternative relative path
];

// In production, the .env file might be in the resources path
try {
    const { app } = require('electron');
    if (app && app.isPackaged) {
        possiblePaths.unshift(path.join(process.resourcesPath, '.env'));
    }
} catch (e) {
    // app might not be available yet or we are in a non-electron context
}

let envLoaded = false;
for (const envPath of possiblePaths) {
    if (fs.existsSync(envPath)) {
        console.log('Found .env at:', envPath);
        const rawContent = fs.readFileSync(envPath, 'utf-8');
        console.log(`Raw .env content length: ${rawContent.length}`);

        const result = dotenv.config({ path: envPath, override: true });

        let loadedKeys = Object.keys(result.parsed || {});

        // Manual fallback if dotenv fails but file has content
        if (loadedKeys.length === 0 && rawContent.trim().length > 0) {
            console.log('Dotenv failed to parse, attempting manual parse...');
            const lines = rawContent.split(/\r?\n/);
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;
                const eqIndex = trimmed.indexOf('=');
                if (eqIndex > 0) {
                    const key = trimmed.substring(0, eqIndex).trim();
                    let value = trimmed.substring(eqIndex + 1).trim();
                    if ((value.startsWith('"') && value.endsWith('"')) ||
                        (value.startsWith("'") && value.endsWith("'"))) {
                        value = value.slice(1, -1);
                    }
                    process.env[key] = value;
                    loadedKeys.push(key);
                }
            }
        }

        if (loadedKeys.length > 0) {
            console.log(`Successfully loaded ${loadedKeys.length} environment variables:`, loadedKeys);
            envLoaded = true;
            break;
        }
    }
}

if (!envLoaded) {
    console.warn('No .env file found or no variables loaded');
}

// Ensure the variables are exported with fallbacks
export const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
export const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';

console.log('SPOTIFY_CLIENT_ID exists:', !!process.env.SPOTIFY_CLIENT_ID);
console.log('SPOTIFY_CLIENT_ID value starts with:', process.env.SPOTIFY_CLIENT_ID?.substring(0, 4) + '...');
