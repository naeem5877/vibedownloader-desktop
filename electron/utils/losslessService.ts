/**
 * Lossless Audio Service
 * 
 * Uses SongLink API to find Tidal/Qobuz URLs from Spotify track IDs,
 * then fetches lossless FLAC download URLs via third-party APIs.
 * 
 * Based on SpotiFLAC knowledge base.
 */

// --- SongLink API ---

interface SongLinkURLs {
    tidalURL: string;
    amazonURL: string;
    isrc: string;
}

interface TrackAvailability {
    spotifyId: string;
    tidal: boolean;
    qobuz: boolean;
    amazon: boolean;
    tidalURL?: string;
    amazonURL?: string;
    qobuzAvailable?: boolean;
}

// --- Tidal API ---

interface TidalManifest {
    mimeType: string;
    codecs: string;
    encryptionType: string;
    urls: string[];
}

interface TidalV2Response {
    version: string;
    data: {
        trackId: number;
        assetPresentation: string;
        audioMode: string;
        audioQuality: string;
        manifestMimeType: string;
        manifestHash: string;
        manifest: string;
        bitDepth: number;
        sampleRate: number;
    };
}

interface LosslessTrackInfo {
    available: boolean;
    service: 'tidal' | 'qobuz' | 'none';
    quality: string;
    bitDepth?: number;
    sampleRate?: number;
    format: string;
    tidalURL?: string;
    downloadURL?: string;
}

// Tidal API endpoints (from knowledge base)
const TIDAL_APIS = [
    'https://triton.squid.wtf',
    'https://hifi-one.spotisaver.net',
    'https://hifi-two.spotisaver.net',
    'https://tidal.kinoplus.online',
    'https://tidal-api.binimum.org',
];

// Qobuz API endpoints (from knowledge base)
const QOBUZ_APIS = [
    'https://dab.yeet.su/api/stream?trackId=',
    'https://dabmusic.xyz/api/stream?trackId=',
    'https://qobuz.squid.wtf/api/download-music?track_id=',
];

const QOBUZ_APP_ID = '798273057';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36';

/**
 * Check if lossless audio is available for a Spotify track via SongLink
 */
export async function checkLosslessAvailability(spotifyTrackId: string): Promise<LosslessTrackInfo> {
    try {
        console.log(`[Lossless] Checking availability for Spotify track: ${spotifyTrackId}`);

        // Use SongLink API to find the track on other platforms
        const spotifyURL = `https://open.spotify.com/track/${spotifyTrackId}`;
        const songLinkURL = `https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(spotifyURL)}`;

        const response = await fetch(songLinkURL, {
            headers: { 'User-Agent': USER_AGENT }
        });

        if (!response.ok) {
            console.log(`[Lossless] SongLink API returned ${response.status}`);
            return { available: false, service: 'none', quality: '', format: '' };
        }

        const data = await response.json();
        const links = data.linksByPlatform || {};

        let tidalURL = '';
        let isrc = '';

        // Check Tidal availability
        if (links.tidal?.url) {
            tidalURL = links.tidal.url;
            console.log(`[Lossless] ✓ Found on Tidal: ${tidalURL}`);
        }

        // Get ISRC from Deezer for Qobuz search
        if (links.deezer?.url) {
            try {
                isrc = await getDeezerISRC(links.deezer.url);
                console.log(`[Lossless] ✓ ISRC found: ${isrc}`);
            } catch (e) {
                console.log(`[Lossless] Could not get ISRC from Deezer`);
            }
        }

        // Check Qobuz availability
        let qobuzAvailable = false;
        if (isrc) {
            qobuzAvailable = await checkQobuzAvailability(isrc);
            if (qobuzAvailable) {
                console.log(`[Lossless] ✓ Available on Qobuz`);
            }
        }

        if (tidalURL) {
            // Try to get quality info from Tidal
            try {
                const trackId = extractTidalTrackId(tidalURL);
                if (trackId) {
                    const qualityInfo = await getTidalQualityInfo(trackId);
                    return {
                        available: true,
                        service: 'tidal',
                        quality: qualityInfo.quality,
                        bitDepth: qualityInfo.bitDepth,
                        sampleRate: qualityInfo.sampleRate,
                        format: 'FLAC',
                        tidalURL,
                    };
                }
            } catch (e) {
                // Fallback: we know it's on Tidal, just report as available
                console.log(`[Lossless] Could not get quality info, but track is on Tidal`);
            }

            return {
                available: true,
                service: 'tidal',
                quality: 'Lossless',
                format: 'FLAC',
                tidalURL,
            };
        }

        if (qobuzAvailable) {
            return {
                available: true,
                service: 'qobuz',
                quality: 'Lossless',
                format: 'FLAC',
            };
        }

        return { available: false, service: 'none', quality: '', format: '' };
    } catch (error: any) {
        console.error(`[Lossless] Error checking availability:`, error.message);
        return { available: false, service: 'none', quality: '', format: '' };
    }
}

/**
 * Get the FLAC download URL for a Spotify track via Tidal
 */
export async function getLosslessDownloadURL(spotifyTrackId: string, tidalURL?: string): Promise<{
    url: string;
    isManifest: boolean;
    service: string;
    quality: string;
    bitDepth?: number;
    sampleRate?: number;
} | null> {
    try {
        // Step 1: Get Tidal URL if not provided
        if (!tidalURL) {
            const spotifyURL = `https://open.spotify.com/track/${spotifyTrackId}`;
            const songLinkURL = `https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(spotifyURL)}`;

            const response = await fetch(songLinkURL, {
                headers: { 'User-Agent': USER_AGENT }
            });

            if (response.ok) {
                const data = await response.json();
                tidalURL = data.linksByPlatform?.tidal?.url || '';
            }
        }

        if (!tidalURL) {
            console.log('[Lossless] No Tidal URL available');
            return null;
        }

        // Step 2: Extract track ID
        const trackId = extractTidalTrackId(tidalURL);
        if (!trackId) {
            console.log('[Lossless] Could not extract Tidal track ID');
            return null;
        }

        // Step 3: Try all APIs to get download URL (rotate for reliability)
        const shuffledAPIs = [...TIDAL_APIS].sort(() => Math.random() - 0.5);

        for (const quality of ['LOSSLESS', 'HI_RES']) {
            for (const apiBase of shuffledAPIs) {
                try {
                    const apiURL = `${apiBase}/track/?id=${trackId}&quality=${quality}`;
                    console.log(`[Lossless] Trying ${apiBase} with quality ${quality}...`);

                    const resp = await fetch(apiURL, {
                        headers: { 'User-Agent': USER_AGENT },
                        signal: AbortSignal.timeout(8000)
                    });

                    if (!resp.ok) continue;

                    const body = await resp.text();

                    // Try V2 response (manifest-based)
                    try {
                        const v2: TidalV2Response = JSON.parse(body);
                        if (v2.data?.manifest) {
                            console.log(`[Lossless] ✓ Got manifest from ${apiBase} (${quality})`);
                            return {
                                url: `MANIFEST:${v2.data.manifest}`,
                                isManifest: true,
                                service: 'tidal',
                                quality: v2.data.audioQuality || quality,
                                bitDepth: v2.data.bitDepth,
                                sampleRate: v2.data.sampleRate,
                            };
                        }
                    } catch { }

                    // Try V1 response (direct URL)
                    try {
                        const v1 = JSON.parse(body);
                        if (Array.isArray(v1) && v1.length > 0 && v1[0].OriginalTrackUrl) {
                            console.log(`[Lossless] ✓ Got direct URL from ${apiBase} (${quality})`);
                            return {
                                url: v1[0].OriginalTrackUrl,
                                isManifest: false,
                                service: 'tidal',
                                quality,
                                bitDepth: 16,
                                sampleRate: 44100,
                            };
                        }
                    } catch { }
                } catch (e: any) {
                    console.log(`[Lossless] ${apiBase} failed: ${e.message}`);
                }
            }
        }

        console.log('[Lossless] All Tidal APIs failed');
        return null;
    } catch (error: any) {
        console.error('[Lossless] Error getting download URL:', error.message);
        return null;
    }
}

// --- Helper functions ---

function extractTidalTrackId(url: string): number | null {
    const parts = url.split('/track/');
    if (parts.length < 2) return null;
    const idStr = parts[1].split('?')[0].trim();
    const id = parseInt(idStr, 10);
    return isNaN(id) ? null : id;
}

async function getDeezerISRC(deezerURL: string): Promise<string> {
    const parts = deezerURL.split('/track/');
    if (parts.length < 2) throw new Error('Invalid Deezer URL');

    const trackId = parts[1].split('?')[0].trim();
    const resp = await fetch(`https://api.deezer.com/track/${trackId}`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(10000)
    });

    if (!resp.ok) throw new Error(`Deezer API returned ${resp.status}`);

    const data = await resp.json();
    if (!data.isrc) throw new Error('ISRC not found');

    return data.isrc;
}

async function checkQobuzAvailability(isrc: string): Promise<boolean> {
    try {
        const searchURL = `https://www.qobuz.com/api.json/0.2/track/search?query=${isrc}&limit=1&app_id=${QOBUZ_APP_ID}`;
        const resp = await fetch(searchURL, {
            headers: { 'User-Agent': USER_AGENT },
            signal: AbortSignal.timeout(10000)
        });

        if (!resp.ok) return false;

        const data = await resp.json();
        return (data.tracks?.total || 0) > 0;
    } catch {
        return false;
    }
}

async function getTidalQualityInfo(trackId: number): Promise<{
    quality: string;
    bitDepth: number;
    sampleRate: number;
}> {
    // Try to get quality from the first available API
    for (const apiBase of TIDAL_APIS) {
        try {
            const apiURL = `${apiBase}/track/?id=${trackId}&quality=LOSSLESS`;
            const resp = await fetch(apiURL, {
                headers: { 'User-Agent': USER_AGENT },
                signal: AbortSignal.timeout(5000)
            });

            if (!resp.ok) continue;

            const body = await resp.text();
            try {
                const v2: TidalV2Response = JSON.parse(body);
                if (v2.data) {
                    return {
                        quality: v2.data.audioQuality || 'LOSSLESS',
                        bitDepth: v2.data.bitDepth || 16,
                        sampleRate: v2.data.sampleRate || 44100,
                    };
                }
            } catch { }
        } catch { }
    }

    return { quality: 'LOSSLESS', bitDepth: 16, sampleRate: 44100 };
}

/**
 * Parse a Tidal manifest (base64) and return the direct download URL(s)
 */
export function parseTidalManifest(manifestB64: string): {
    directURL: string;
    mimeType: string;
} | null {
    try {
        const decoded = Buffer.from(manifestB64, 'base64').toString('utf-8');

        // Try JSON manifest first (BTS format)
        if (decoded.trim().startsWith('{')) {
            const parsed: TidalManifest = JSON.parse(decoded);
            if (parsed.urls && parsed.urls.length > 0) {
                return {
                    directURL: parsed.urls[0],
                    mimeType: parsed.mimeType || 'audio/flac',
                };
            }
        }

        // MPD/DASH manifest would need more complex parsing
        // For now, return null for DASH manifests
        console.log('[Lossless] DASH manifests not supported in direct download mode');
        return null;
    } catch (e) {
        console.error('[Lossless] Failed to parse manifest:', e);
        return null;
    }
}
