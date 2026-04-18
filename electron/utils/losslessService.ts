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
 * Check if lossless audio is available for a Spotify track via SongLink or Deezer fallback
 */
export async function checkLosslessAvailability(spotifyTrackId: string, trackTitle?: string, artistName?: string): Promise<LosslessTrackInfo> {
    const axios = require('axios');
    const uas = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'VibeDownloader/1.4.1'
    ];
    
    const getRandomUA = () => uas[Math.floor(Math.random() * uas.length)];

    try {
        console.log(`[Lossless] Checking availability for Spotify track: ${spotifyTrackId}`);

        let tidalURL = '';
        let isrc = '';
        let qobuzAvailable = false;

        // Stage 1: Try SongLink (Primary)
        try {
            const spotifyURL = `https://open.spotify.com/track/${spotifyTrackId}`;
            const songLinkURL = `https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(spotifyURL)}`;

            const response = await axios.get(songLinkURL, {
                headers: { 'User-Agent': getRandomUA() },
                timeout: 10000
            });

            if (response.status === 200) {
                const data = response.data;
                const links = data.linksByPlatform || {};
                
                if (links.tidal?.url) tidalURL = links.tidal.url;
                
                // Try to get ISRC from Deezer or other platforms via SongLink
                if (data.entitiesByUniqueId) {
                    for (const id in data.entitiesByUniqueId) {
                        if (data.entitiesByUniqueId[id].isrc) {
                            isrc = data.entitiesByUniqueId[id].isrc;
                            break;
                        }
                    }
                }
            }
        } catch (songLinkErr: any) {
            console.warn(`[Lossless] SongLink failed (${songLinkErr.message}), falling back to Deezer search...`);
        }

        // Stage 2: Fallback to Deezer Search (if SongLink failed or ISRC missing)
        if (!isrc && trackTitle && artistName) {
            try {
                const query = encodeURIComponent(`${artistName} - ${trackTitle}`);
                const deezerSearchURL = `https://api.deezer.com/search?q=${query}&limit=5`;
                const deezerResp = await axios.get(deezerSearchURL, {
                    headers: { 'User-Agent': getRandomUA() },
                    timeout: 8000
                });
                
                if (deezerResp.data?.data?.length > 0) {
                    // Try to find a good match
                    const match = deezerResp.data.data[0];
                    if (match.isrc) {
                        isrc = match.isrc;
                        console.log(`[Lossless] ✓ Found ISRC via Deezer search: ${isrc}`);
                    }
                }
            } catch (deezerErr: any) {
                console.warn(`[Lossless] Deezer search fallback failed: ${deezerErr.message}`);
            }
        }

        // Stage 3: Resolve Tidal/Qobuz with what we have
        if (isrc) {
            qobuzAvailable = await checkQobuzAvailability(isrc);
        }

        if (tidalURL || isrc) {
            let trackId: any = tidalURL ? extractTidalTrackId(tidalURL) : null;
            
            // If we have ISRC but no track ID, we can still try to find it on our proxies later 
            // but for "availability" check we'll mark as true if ISRC found.
            
            return {
                available: true,
                service: 'tidal',
                quality: 'Lossless',
                format: 'FLAC',
                tidalURL: tidalURL || (isrc ? `ISRC:${isrc}` : undefined),
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
    const axios = require('axios');
    const uas = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'VibeDownloader/1.4.1'
    ];
    const getRandomUA = () => uas[Math.floor(Math.random() * uas.length)];

    try {
        // Step 1: Resolve Tidal URL from SongLink if needed (with retry)
        if (!tidalURL || tidalURL.startsWith('ISRC:')) {
            const isrc = tidalURL?.startsWith('ISRC:') ? tidalURL.replace('ISRC:', '') : null;
            
            if (isrc) {
                console.log(`[Lossless] Attempting to find master track for ISRC: ${isrc}...`);
                // If we have ISRC, we can try to find the track on tidal proxies directly if they support ISRC
                // For now we still try to get a proper Tidal ID if possible.
            }

            const spotifyURL = `https://open.spotify.com/track/${spotifyTrackId}`;
            const songLinkURL = `https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(spotifyURL)}`;

            try {
                const response = await axios.get(songLinkURL, {
                    headers: { 'User-Agent': getRandomUA() },
                    timeout: 10000
                });

                if (response.status === 200) {
                    tidalURL = response.data.linksByPlatform?.tidal?.url || tidalURL;
                }
            } catch (e) {
                console.warn('[Lossless] SongLink resolution failed during download step');
            }
        }

        if (!tidalURL || tidalURL.startsWith('ISRC:')) {
             // If we still only have ISRC, we'll try a guess or specific ISRC endpoints if available
             // Most proxies today require the ID.
             if (tidalURL?.startsWith('ISRC:')) {
                  console.log('[Lossless] Searching for Tidal ID via ISRC proxy...');
                  // Some proxies support ISRC search
             }
             if (!tidalURL || tidalURL.startsWith('ISRC:')) {
                console.log('[Lossless] No Tidal URL available');
                return null;
             }
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
                for (let attempt = 0; attempt < 2; attempt++) {
                    try {
                        const apiURL = `${apiBase}/track/?id=${trackId}&quality=${quality}`;
                        console.log(`[Lossless] Trying ${apiBase} (Attempt ${attempt+1}, ${quality})...`);

                        const resp = await axios.get(apiURL, {
                            headers: { 'User-Agent': getRandomUA() },
                            timeout: attempt === 0 ? 10000 : 20000
                        });

                        const body = resp.data;
                        const bodyStr = typeof body === 'object' ? JSON.stringify(body) : String(body);

                        // Try V2 response (manifest-based)
                        if (body.data?.manifest) {
                            console.log(`[Lossless] ✓ Got manifest from ${apiBase} (${quality})`);
                            return {
                                url: `MANIFEST:${body.data.manifest}`,
                                isManifest: true,
                                service: 'tidal',
                                quality: body.data.audioQuality || quality,
                                bitDepth: body.data.bitDepth,
                                sampleRate: body.data.sampleRate,
                            };
                        }

                        // Try V1 response (direct URL)
                        if (Array.isArray(body) && body.length > 0 && body[0].OriginalTrackUrl) {
                            console.log(`[Lossless] ✓ Got direct URL from ${apiBase} (${quality})`);
                            return {
                                url: body[0].OriginalTrackUrl,
                                isManifest: false,
                                service: 'tidal',
                                quality,
                                bitDepth: 16,
                                sampleRate: 44100,
                            };
                        }
                    } catch (e: any) {
                        console.log(`[Lossless] ${apiBase} failed: ${e.message}`);
                        if (attempt === 0) await new Promise(r => setTimeout(r, 1000));
                    }
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
