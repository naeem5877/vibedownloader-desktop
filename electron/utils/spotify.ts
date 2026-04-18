/**
 * Spotify metadata fetcher using spotify-url-info.
 * This library scrapes Spotify's own web player — no API key required.
 * It replaces the old official Spotify Web API which now requires Premium.
 */

// spotify-url-info is an ESM-only package, so we use dynamic import()
// The electron backend compiles to CommonJS, so we lazily import it at runtime.

let _spotifyModule: any = null;

async function getSpotifyModule() {
    if (_spotifyModule) return _spotifyModule;
    // Dynamic ESM import in a CommonJS context
    const mod = await eval("import('spotify-url-info')");
    
    // Create a fetch-like wrapper for axios to use in spotify-url-info
    const axiosFetcher = async (url: string, options: any = {}) => {
        const axios = require('axios');
        const response = await axios({
            url,
            method: options.method || 'GET',
            data: options.body,
            headers: options.headers,
            timeout: 15000
        });
        return {
            ok: response.status >= 200 && response.status < 300,
            status: response.status,
            text: async () => typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
            json: async () => response.data,
            headers: {
                get: (name: string) => response.headers[name.toLowerCase()]
            }
        };
    };

    const instance = mod.default(axiosFetcher);
    _spotifyModule = instance;
    return instance;
}

export function extractSpotifyId(url: string): { type: 'track' | 'album' | 'playlist'; id: string } | null {
    // Accounts for optional locale segments like /intl-pt/ or /en-US/
    const match = url.match(/spotify\.com\/(?:[a-z]{2}-[a-z]{2}\/|intl-[a-z]{2}\/)?(track|album|playlist)\/([a-zA-Z0-9]+)/);
    if (match) {
        return {
            type: match[1] as 'track' | 'album' | 'playlist',
            id: match[2]
        };
    }
    return null;
}

/**
 * Fetch full metadata for a Spotify track, album, or playlist.
 * Returns a normalized metadata object compatible with the rest of the app.
 */
export async function fetchSpotifyInfo(url: string): Promise<any> {
    const module = await getSpotifyModule();
    const parsed = extractSpotifyId(url);
    if (!parsed) throw new Error('Invalid Spotify URL');

    console.log(`[Spotify] Fetching ${parsed.type} info via web scrape...`);

    let data: any;
    try {
        data = await module.getData(url);
    } catch (err: any) {
        console.warn(`[Spotify] Primary scraper failed: ${err.message}. Attempting OG fallback...`);
        // Fallback to manual OG scraping if the library fails (common when embed page is blocked)
        return fetchSpotifyOGFallback(url, parsed);
    }

    if (parsed.type === 'track') {
        let albumArt = data.coverArt?.sources?.sort((a: any, b: any) => (b.height || 0) - (a.height || 0))?.[0]?.url
            || data.visualIdentity?.image?.find((i: any) => (i.url || '').includes('i.scdn.co'))?.url
            || data.visualIdentity?.image?.sort((a: any, b: any) => (b.maxHeight || 0) - (a.maxHeight || 0))?.[0]?.url
            || '';
        const artists = data.artists?.map((a: any) => a.name).join(', ') || 'Unknown';
        const releaseDate = data.releaseDate?.isoString?.split('T')[0] || '';

        // Secondary fallback using album-art library
        if (!albumArt || albumArt.includes('placeholder')) {
            try {
                const aa = require('album-art');
                const art = await aa(data.artists?.[0]?.name || artists.split(',')[0], { album: data.name, size: 'large' });
                if (art && !art.includes('error')) albumArt = art;
            } catch {}
        }

        return {
            id: data.id,
            title: data.name,
            thumbnail: albumArt,
            uploader: artists,
            duration: Math.floor((data.duration || 0) / 1000),
            view_count: 0,
            webpage_url: url,
            contentType: 'video',
            album: '',
            release_date: releaseDate,
            searchQuery: `${data.artists?.[0]?.name || artists.split(',')[0]} - ${data.name} audio`,
            spotifyTrackId: data.id,
            entries: []
        };
    }

    // For albums & playlists, fetch the track list too
    let tracks: any[] = [];
    try {
        tracks = await module.getTracks(url);
    } catch (e) {
        console.warn("[Spotify] Failed to fetch track list, returning base metadata only.");
    }

    let coverArt = data.coverArt?.sources?.sort((a: any, b: any) => (b.height || 0) - (a.height || 0))?.[0]?.url || '';
    const uploader = data.subtitle || data.authors?.map((a: any) => a.name).join(', ') || 'Spotify';

    // Fallback for playlist/album thumbnail
    if (!coverArt || coverArt.includes('placeholder')) {
        try {
            const aa = require('album-art');
            const art = await aa(uploader, { size: 'large' });
            if (art && !art.includes('error')) coverArt = art;
        } catch {}
    }

    const entries = tracks.map((track: any) => {
        // Extract track ID from the uri: "spotify:track:XXXX"
        const trackId = track.uri?.split(':')[2] || '';
        const artistName = Array.isArray(track.artists)
            ? track.artists.map((a: any) => a.name).join(', ')
            : track.artist || 'Unknown';

        return {
            id: trackId,
            title: track.name || track.title,
            thumbnail: coverArt, // Playlist/album tracks share the cover
            duration: Math.floor((track.duration || 0) / 1000),
            url: trackId ? `https://open.spotify.com/track/${trackId}` : '',
            artist: artistName,
            searchQuery: `${track.artist || artistName} - ${track.name || track.title} audio`,
            spotifyTrackId: trackId
        };
    }).filter((t: any) => t.id && (t.title || t.name));

    return {
        id: data.id,
        title: data.name || data.title,
        thumbnail: coverArt,
        uploader: uploader,
        duration: 0,
        view_count: 0,
        webpage_url: url,
        contentType: 'playlist',
        playlist_count: entries.length,
        entries
    };
}

/**
 * Manual fallback to scrape Open Graph tags from the Spotify page.
 * This is extremely reliable for getting Title, Artist (from desc) and Artwork.
 */
async function fetchSpotifyOGFallback(url: string, parsed: { type: string, id: string }): Promise<any> {
    const axios = require('axios');
    const uas = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'VibeDownloader/1.4.1'
    ];

    let html = '';
    let success = false;
    for (let i = 0; i < uas.length; i++) {
        try {
            const resp = await axios.get(url, {
                timeout: i === 0 ? 10000 : 20000,
                headers: {
                    'User-Agent': uas[i],
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9'
                }
            });
            html = resp.data;
            success = true;
            break;
        } catch (e: any) {
            console.warn(`[Spotify Fallback] Attempt ${i+1} failed: ${e.message}`);
        }
    }

    if (!success) throw new Error("Spotify metadata unavailable. Check your network or the URL.");

    // Extract metadata from OG tags
    const getMeta = (prop: string) => {
        const match = html.match(new RegExp(`<meta property="${prop}" content="(.*?)"`, 'i')) ||
                      html.match(new RegExp(`<meta content="(.*?)" property="${prop}"`, 'i'));
        return match ? match[1] : null;
    };

    let title = getMeta('og:title') || 'Unknown Spotify Title';
    let image = getMeta('og:image') || '';
    let desc = getMeta('og:description') || '';
    
    let uploader = 'Unknown Artist';
    if (parsed.type === 'track') {
        const parts = desc.split(' · ');
        if (parts.length > 0) uploader = parts[0];
    } else {
        uploader = desc || 'Spotify';
    }

    // Fallback: Use album-art library if OG image is missing or a placeholder
    if (!image || image.includes('placeholder') || image.includes('default')) {
        try {
            console.log(`[Spotify Fallback] Fetching high-quality art via album-art library for: ${uploader} - ${title}`);
            const albumArt = require('album-art');
            const searchTitle = parsed.type === 'track' ? title : ''; 
            const artUrl = await albumArt(uploader, { album: searchTitle, size: 'large' });
            if (artUrl && !artUrl.includes('error')) {
                image = artUrl;
                console.log(`[Spotify Fallback] ✓ album-art found: ${image.slice(0, 50)}...`);
            }
        } catch (e) {
            console.warn('[Spotify Fallback] album-art search failed:', e);
        }
    }

    console.log(`[Spotify Fallback] Scraped OG metadata: ${title} by ${uploader}`);

    if (parsed.type === 'track') {
        return {
            id: parsed.id,
            title: title,
            thumbnail: image,
            uploader: uploader,
            duration: 0,
            view_count: 0,
            webpage_url: url,
            contentType: 'video',
            album: '',
            release_date: '',
            searchQuery: `${uploader} - ${title} audio`,
            spotifyTrackId: parsed.id,
            entries: []
        };
    }

    return {
        id: parsed.id,
        title: title,
        thumbnail: image,
        uploader: uploader,
        duration: 0,
        view_count: 0,
        webpage_url: url,
        contentType: 'playlist',
        playlist_count: 0,
        entries: [],
        error: "Track list hidden. Download individual tracks instead."
    };
}
