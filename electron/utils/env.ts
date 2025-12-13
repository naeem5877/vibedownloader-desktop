import { config } from 'dotenv';
import path from 'path';

// Load env vars from root directory
// We assume this file is in electron/utils/
config({ path: path.join(__dirname, '../../.env') });

export const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
export const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';
