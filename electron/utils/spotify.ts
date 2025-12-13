import { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } from './env';

let spotifyAccessToken: string | null = null;
let spotifyTokenExpiry: number = 0;

async function getSpotifyToken(): Promise<string> {
    if (spotifyAccessToken && Date.now() < spotifyTokenExpiry) {
        return spotifyAccessToken;
    }

    console.log('Fetching new Spotify access token...');
    const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')
        },
        body: 'grant_type=client_credentials'
    });

    if (!response.ok) {
        throw new Error('Failed to get Spotify access token');
    }

    const data = await response.json();
    spotifyAccessToken = data.access_token;
    spotifyTokenExpiry = Date.now() + (data.expires_in * 1000) - 60000; // Refresh 1 min early
    console.log('Got Spotify access token');
    return spotifyAccessToken!;
}

export async function spotifyApiRequest(endpoint: string): Promise<any> {
    const token = await getSpotifyToken();
    const response = await fetch(`https://api.spotify.com/v1${endpoint}`, {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });

    if (!response.ok) {
        throw new Error(`Spotify API error: ${response.statusText}`);
    }

    return response.json();
}

export function extractSpotifyId(url: string): { type: 'track' | 'album' | 'playlist'; id: string } | null {
    const patterns = [
        /spotify\.com\/track\/([a-zA-Z0-9]+)/,
        /spotify\.com\/album\/([a-zA-Z0-9]+)/,
        /spotify\.com\/playlist\/([a-zA-Z0-9]+)/
    ];
    const types: ('track' | 'album' | 'playlist')[] = ['track', 'album', 'playlist'];

    for (let i = 0; i < patterns.length; i++) {
        const match = url.match(patterns[i]);
        if (match) {
            return { type: types[i], id: match[1] };
        }
    }
    return null;
}
