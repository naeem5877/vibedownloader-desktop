// YouTube / YouTube Music helpers.

// Pull the 11-char video ID out of any YouTube/YouTube Music URL.
export function extractYouTubeVideoId(url: string): string | null {
    if (!url) return null;
    const watchMatch = url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
    const shortMatch = url.match(/\/shorts\/([A-Za-z0-9_-]{11})/);
    const beMatch = url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
    const liveMatch = url.match(/\/live\/([A-Za-z0-9_-]{11})/);
    const embedMatch = url.match(/\/embed\/([A-Za-z0-9_-]{11})/);
    return watchMatch?.[1] || shortMatch?.[1] || beMatch?.[1] || liveMatch?.[1] || embedMatch?.[1] || null;
}

// Force a large square JPEG out of a Google content-host URL.
// yt3/lh3 URLs look like "...=w544-h544" — replace everything from the size
// params onwards.
function rewriteArtUrl(url: string): string {
    return url.replace(/=w\d+.*$/, '=w2000-h2000-p-l90-rj');
}

let _artCache = new Map<string, string>(); // videoId -> art url ('' = known failure)

/**
 * Resolve the true square YouTube Music album cover for a video.
 *
 * The watch page and the old youtubei/v1/next scraping code were unreliable,
 * so this POSTs to the internal Next API (like the music.youtube.com web app
 * does) and picks the largest square image it returns. Google escapes `/` in
 * the JSON as `\/`, so the URLs are unescaped before matching.
 */
export async function fetchYouTubeMusicAlbumArt(videoId: string): Promise<string | null> {
    if (!videoId) return null;
    if (_artCache.has(videoId)) return _artCache.get(videoId) || null;

    try {
        console.log(`[YT Music] Fetching album art for ${videoId} via API...`);
        const endpoint = "https://music.youtube.com/youtubei/v1/next?prettyPrint=false";
        const payload = {
            videoId,
            context: {
                client: {
                    clientName: "WEB_REMIX",
                    clientVersion: "1.20240101.01.00",
                    hl: "en",
                    gl: "US"
                }
            }
        };
        const resp = await fetch(endpoint, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: {
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Origin": "https://music.youtube.com",
                "Referer": `https://music.youtube.com/watch?v=${videoId}`,
                "X-YouTube-Client-Name": "67",
                "X-YouTube-Client-Version": "1.20240101.01.00"
            } as any
        });

        if (resp.ok) {
            let raw = await resp.text();
            // The JSON escapes slashes as \/ — unescape so URL matching works
            raw = raw.replace(/\\\//g, '/');
            const urls = raw.match(/https?:\/\/(?:lh3|yt3)\.googleusercontent\.com\/[^"\\]+/g) || [];

            let best: string | null = null;
            let maxSize = 0;
            for (const u of urls) {
                const m = u.match(/=w(\d+)/);
                const size = m ? parseInt(m[1], 10) : 0;
                if (size > maxSize) {
                    maxSize = size;
                    best = u;
                }
            }
            if (best) {
                const art = rewriteArtUrl(best);
                _artCache.set(videoId, art);
                return art;
            }
        } else {
            console.error(`[YT Music] API returned ${resp.status}`);
        }
    } catch (e) {
        console.error('[YT Music] API method failed:', e);
    }

    _artCache.set(videoId, '');
    return null;
}
