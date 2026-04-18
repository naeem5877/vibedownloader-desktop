import { ipcMain, app } from 'electron';
import fs from 'fs';
import path from 'path';
import { getYtDlpWrap } from '../utils/binaries';
import { getCookiePath } from '../utils/paths';
import { fetchSpotifyInfo, extractSpotifyId } from '../utils/spotify';
import { igApi } from 'insta-fetcher';

async function fetchYouTubeMusicAlbumArt(videoId: string): Promise<string | null> {
    try {
        console.log(`[YT Music] Fetching album art for ${videoId} via API...`);
        // Method 1: Internal Next API
        const endpoint = "https://music.youtube.com/youtubei/v1/next?prettyPrint=false";
        const payload = {
            "videoId": videoId,
            "context": {
                "client": {
                    "clientName": "WEB_REMIX",
                    "clientVersion": "1.20240101.01.00",
                    "hl": "en",
                    "gl": "US"
                }
            }
        };
        const headers = {
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Origin": "https://music.youtube.com",
            "Referer": `https://music.youtube.com/watch?v=${videoId}`,
            "X-YouTube-Client-Name": "67",
            "X-YouTube-Client-Version": "1.20240101.01.00"
        };
        
        const resp = await fetch(endpoint, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: headers as any
        });
        
        if (resp.ok) {
            const raw = await resp.text();
            const lh3Urls = raw.match(/https:\/\/lh3\.googleusercontent\.com\/[^"\\]+/g);
            if (lh3Urls && lh3Urls.length > 0) {
                let bestUrl = lh3Urls[0];
                let maxSize = 0;
                for (const u of lh3Urls) {
                    const match = u.match(/=w(\d+)/);
                    const size = match ? parseInt(match[1], 10) : 0;
                    if (size > maxSize) {
                        maxSize = size;
                        bestUrl = u;
                    }
                }
                const finalUrl = bestUrl.replace(/=w\d+[^"]*$/, '=w2000-h2000-l90-rj');
                return finalUrl;
            }
        }
    } catch (e) {
        console.error('[YT Music] API method failed:', e);
    }
    
    // Method 2: Page Scrape fallback
    try {
        console.log(`[YT Music] Trying page scrape for ${videoId}...`);
        const resp = await fetch(`https://music.youtube.com/watch?v=${videoId}`, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept-Language": "en-US,en;q=0.9",
                "Cookie": "CONSENT=YES+; SOCS=CAI"
            }
        });
        if (resp.ok) {
            const raw = await resp.text();
            const lh3Urls = raw.match(/https:\/\/lh3\.googleusercontent\.com\/[^"\\]+/g);
            if (lh3Urls && lh3Urls.length > 0) {
                let bestUrl = lh3Urls[0];
                let maxSize = 0;
                for (const u of lh3Urls) {
                    const match = u.match(/=w(\d+)/);
                    const size = match ? parseInt(match[1], 10) : 0;
                    if (size > maxSize) {
                        maxSize = size;
                        bestUrl = u;
                    }
                }
                const finalUrl = bestUrl.replace(/=w\d+[^"]*$/, '=w2000-h2000-l90-rj');
                return finalUrl;
            }
        }
    } catch (e) {
        console.error('[YT Music] Page scrape failed:', e);
    }
    
    return null;
}

export function registerInfoHandlers() {
    ipcMain.handle('get-video-info', async (event: any, url: any) => {
        if (!url) return { success: false, error: "No URL provided" };
        console.log(`Fetching info for ${url}...`);

        try {
            const ytDlpWrap = getYtDlpWrap();
            const hasListParam = url.includes('list=');
            const isRadioMix = url.includes('start_radio=1') || url.includes('list=RD') || url.includes('list=RDMM');
            const isRegularPlaylist = hasListParam && !isRadioMix && (url.includes('/playlist') || !url.includes('watch?v='));

            const args = [
                url,
                '--dump-single-json',
                '--no-warnings',
                '--socket-timeout', '30',
                '--js-runtimes', 'node',
                '--no-check-certificates'
            ];

            // Add cookies if available for the specific platform
            let cookiePath = null;
            const isInstagram = url.includes('instagram.com') || url.includes('instagr.am');
            const isFacebook = url.includes('facebook.com') || url.includes('fb.watch') || url.includes('fb.com');
            const isYoutube = url.includes('youtube.com') || url.includes('youtu.be');
            const isTiktok = url.includes('tiktok.com');
            const isSnapchat = url.includes('snapchat.com');

            if (isInstagram) {
                cookiePath = getCookiePath('instagram');
            } else if (isFacebook) {
                cookiePath = getCookiePath('facebook');
            } else if (isYoutube) {
                cookiePath = getCookiePath('youtube');
            } else if (isTiktok) {
                cookiePath = getCookiePath('tiktok');
            } else if (isSnapchat) {
                cookiePath = getCookiePath('snapchat');
            }

            // Insta-fetcher for Instagram Stories
            if (isInstagram && (url.includes('/stories/') || url.includes('/story/'))) {
                console.log('Using insta-fetcher for Instagram stories...');
                let sessionid = '';
                if (cookiePath && fs.existsSync(cookiePath)) {
                    const cookieText = fs.readFileSync(cookiePath, 'utf8');
                    for (const line of cookieText.split('\n')) {
                        if (line.includes('sessionid')) {
                            const parts = line.split('\t');
                            if (parts.length >= 7) {
                                sessionid = `sessionid=${parts[6].trim()}`;
                            }
                            break;
                        }
                    }
                }
                
                if (!sessionid) {
                    throw new Error("🔒 Login required. This content is private or requires authentication.");
                }

                // Extract username from url: https://www.instagram.com/stories/username/12345/
                const cleanUrl = url.split('?')[0];
                const match = cleanUrl.match(/\/stories\/([^\/]+)/);
                if (!match) throw new Error("Invalid Instagram Story URL");
                const username = match[1];

                const ig = new igApi(sessionid);
                const storiesData = await ig.fetchStories(username);

                let entries: any[] = [];
                if (storiesData && storiesData.stories) {
                    entries = storiesData.stories.map((s: any, i: number) => ({
                        id: s.id || `story-${i}-${Date.now()}`,
                        title: `Story Part ${i + 1}`,
                        thumbnail: s.type === 'image' ? s.url : (s.url || ''),
                        duration: s.video_duration || 15,
                        url: s.url,
                        isIGStoryImage: s.type === 'image',
                        ext: s.type === 'image' ? 'jpg' : 'mp4'
                    }));
                }

                const metadata = {
                    id: `ig-story-${username}`,
                    title: `Story by ${username}`,
                    thumbnail: entries.length > 0 ? entries[0].thumbnail : '',
                    uploader: username,
                    uploader_url: `https://instagram.com/${username}`,
                    view_count: 0,
                    duration: 0,
                    contentType: 'story',
                    entries: entries,
                    playlist_count: entries.length
                };
                return { success: true, metadata };
            }

            // =============================================
            // Facebook Stories handler (yt-dlp can't handle these)
            // =============================================
            if (isFacebook && (url.includes('/stories/') || url.includes('story_tray'))) {
                console.log('Using HTTP scraping for Facebook Stories...');

                // Build cookie header from the cookies file
                let cookieHeader = '';
                if (cookiePath && fs.existsSync(cookiePath)) {
                    const cookieText = fs.readFileSync(cookiePath, 'utf8');
                    const pairs: string[] = [];
                    for (const line of cookieText.split('\n')) {
                        if (!line.startsWith('#') && line.trim()) {
                            const parts = line.split('\t');
                            if (parts.length >= 7) {
                                pairs.push(`${parts[5].trim()}=${parts[6].trim()}`);
                            }
                        }
                    }
                    cookieHeader = pairs.join('; ');
                }

                if (!cookieHeader) {
                    throw new Error('🔒 Facebook cookies are required to download stories. Please add your Facebook cookies in Settings.');
                }

                const resp = await fetch(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
                        'Cookie': cookieHeader,
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Sec-Fetch-Dest': 'document',
                        'Sec-Fetch-Mode': 'navigate',
                        'Referer': 'https://www.facebook.com/'
                    }
                });

                if (!resp.ok) {
                    throw new Error(`Facebook returned HTTP ${resp.status}. Try refreshing your Facebook cookies.`);
                }

                const html = await resp.text();

                // Extract video URLs from Facebook's JSON blob in the page
                const extractFbUrl = (pattern: RegExp) => {
                    const m = html.match(pattern);
                    if (!m) return null;
                    try {
                        return JSON.parse(`"${m[1]}"`);  // Unescape \u0026 etc
                    } catch { return m[1]; }
                };

                const hdUrl = extractFbUrl(/"browser_native_hd_url"\s*:\s*"([^"]+)"/) ||
                              extractFbUrl(/"playable_url_quality_hd"\s*:\s*"([^"]+)"/);
                const sdUrl = extractFbUrl(/"browser_native_sd_url"\s*:\s*"([^"]+)"/) ||
                              extractFbUrl(/"playable_url"\s*:\s*"([^"]+)"/);
                const thumbnailUrl = extractFbUrl(/"preferred_thumbnail"\s*.*?"uri"\s*:\s*"([^"]+)"/) ||
                                     extractFbUrl(/"thumbnail_image"\s*.*?"uri"\s*:\s*"([^"]+)"/);

                const videoUrl = hdUrl || sdUrl;
                if (!videoUrl) {
                    throw new Error('Could not find video URL in Facebook Story page. The story may have expired or your cookies may be outdated.');
                }

                const uploaderMatch = html.match(/"story_actor"\s*.*?"name"\s*:\s*"([^"]+)"/);
                const uploaderName = uploaderMatch ? uploaderMatch[1] : 'Facebook';

                const entry = {
                    id: `fb-story-${Date.now()}`,
                    title: `Story by ${uploaderName.replace(/\s+/g, '')}`,
                    thumbnail: thumbnailUrl || '',
                    duration: 0,
                    url: videoUrl,
                    ext: 'mp4'
                };

                const metadata = {
                    id: `fb-story-${Date.now()}`,
                    title: `Story by ${uploaderName.replace(/\s+/g, '')}`,
                    thumbnail: thumbnailUrl || '',
                    uploader: uploaderName,
                    uploader_url: `https://facebook.com`,
                    view_count: 0,
                    duration: 0,
                    contentType: 'story',
                    entries: [entry],
                    playlist_count: 1
                };

                return { success: true, metadata };
            }

            // Add User-Agent to help with Facebook/Instagram/YouTube
            const defaultUA = process.platform === 'darwin' 
                ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
                : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
            args.push('--user-agent', defaultUA);

            if (isYoutube && cookiePath && fs.existsSync(cookiePath)) {
                // When using browser cookies, we must use the web client for age verification to work
                args.push('--extractor-args', 'youtube:player_client=web');
            } else {
                args.push('--extractor-args', 'youtube:player_client=android,ios,web,web_embedded');
            }

            // STRICT SEPARATION: Only use cookies for the specific platform
            if (cookiePath && fs.existsSync(cookiePath)) {
                args.push('--cookies', cookiePath);
                const platformName = isInstagram ? 'Instagram' : isFacebook ? 'Facebook' : isYoutube ? 'YouTube' : isTiktok ? 'TikTok' : isSnapchat ? 'Snapchat' : 'Platform';
                console.log(`Using custom cookies for ${platformName} (Path: ${cookiePath})`);
            } else if (!cookiePath && fs.existsSync(path.join(app.getPath('userData'), 'cookies.txt'))) {
                // Only fall back to legacy cookies.txt if strict platform cookies are NOT expected
                // For generic sites, we can use legacy. For FB/Insta, we rely on their specific files.
                args.push('--cookies', path.join(app.getPath('userData'), 'cookies.txt'));
                console.log('Using legacy cookies.txt');
            }

            if (isRadioMix) {
                // Allow mixes to be parsed as playlists
                args.push('--flat-playlist');
                args.push('--playlist-items', '1:50');
            } else if (isRegularPlaylist) {
                args.push('--flat-playlist');
                args.push('--playlist-items', '1:50');
            } else if (hasListParam && url.includes('watch?v=')) {
                args.push('--no-playlist');
            }

            const ytDlpPromise = ytDlpWrap.execPromise(args);
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Request timed out')), 60000);
            });

            const metadataString = await Promise.race([ytDlpPromise, timeoutPromise]) as string;
            const raw = JSON.parse(metadataString);

            let contentType = 'video';
            if (url.includes('/stories/') || url.includes('/story/')) {
                contentType = 'story';
            } else if (raw._type === 'playlist' || (raw.entries && raw.entries.length > 0)) {
                contentType = 'playlist';
            }

            let thumbnail = raw.thumbnail;
            let ytMusicArtFound = false;
            
            const isMusic = isYoutube && (url.includes('music.youtube.com') || raw.categories?.includes('Music') || raw.uploader?.endsWith('- Topic'));

            if (isMusic && raw.id) {
                try {
                    const ytMusicArt = await fetchYouTubeMusicAlbumArt(raw.id);
                    if (ytMusicArt) {
                        thumbnail = ytMusicArt;
                        ytMusicArtFound = true;
                        console.log('✅ Premium YT Music square art fetched:', thumbnail);
                    }
                } catch(e) { console.error('YT Music art fetch error:', e); }
            }

            if (!ytMusicArtFound && raw.thumbnails && raw.thumbnails.length > 0) {
                // Sort thumbnails by resolution total pixels (fallback reference)
                const sortedByRes = [...raw.thumbnails].sort((a: any, b: any) =>
                    ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0))
                );

                // 1. BEST OPTION: Look for square art from Google Content hosts (lh3.googleusercontent.com, etc.)
                // These are high-quality, bar-free square covers
                const googleArt = raw.thumbnails.find((t: any) =>
                    t.url.includes('googleusercontent.com') || t.url.includes('ggpht.com')
                );

                if (googleArt && isYoutube) {
                    // Upgrade resolution to 2000x2000px and FORCE JPEG (-rj)
                    let highResUrl = googleArt.url;
                    if (highResUrl.includes('=w')) {
                        highResUrl = highResUrl.replace(/=w\d+-h\d+/, '=w2000-h2000');
                        // Add -rj if not present to force JPEG
                        if (!highResUrl.includes('-rj')) {
                            highResUrl = highResUrl.split('=').slice(0, -1).join('=') + '=w2000-h2000-rj';
                        }
                    } else if (!highResUrl.includes('=')) {
                        highResUrl += '=w2000-h2000-l90-rj';
                    }
                    thumbnail = highResUrl;
                    console.log('Force JPEG Premium square art selected (from metadata):', thumbnail);
                } else {
                    if (isMusic) {
                        // 2. Music-specific square check
                        const squareThumb = raw.thumbnails.find((t: any) => {
                            if (!t.width || !t.height) return false;
                            const ratio = t.width / t.height;
                            return Math.abs(ratio - 1) < 0.05 && t.width >= 300;
                        });

                        if (squareThumb) {
                            thumbnail = squareThumb.url.replace('/vi_webp/', '/vi/').replace('.webp', '.jpg');
                        } else {
                            // Avoid landscape with bars
                            thumbnail = sortedByRes.find(t => !t.url.includes('maxresdefault'))?.url || sortedByRes[0].url;
                            thumbnail = thumbnail?.replace('/vi_webp/', '/vi/').replace('.webp', '.jpg');
                        }
                    } else {
                        // 3. Regular video logic
                        const potentialSquare = raw.thumbnails.find((t: any) => {
                            if (!t.width || !t.height) return false;
                            return t.width === t.height && t.width >= 400;
                        });

                        thumbnail = potentialSquare?.url || sortedByRes[0].url;
                        thumbnail = thumbnail?.replace('/vi_webp/', '/vi/').replace('.webp', '.jpg');
                    }
                }
            }

            const entriesArr = Array.isArray(raw.entries) ? raw.entries : [];
            const sanitizedEntries = entriesArr
                .filter((e: any) => e && (e.id || e.title || e.url))
                .map((e: any, i: number) => ({
                    id: e.id || `track-${i}-${Date.now()}`,
                    title: e.title || e.fulltitle || `Track ${i + 1}`,
                    thumbnail: e.thumbnail || (e.thumbnails && e.thumbnails.length > 0 ? e.thumbnails[0].url : ''),
                    duration: e.duration || 0,
                    url: e.url || e.webpage_url || (e.id ? `https://www.youtube.com/watch?v=${e.id}` : url)
                }));

            const metadata = {
                id: raw.id || `pl-${Date.now()}`,
                title: raw.title || raw.fulltitle || 'Untitled Playlist',
                thumbnail: thumbnail || '',
                thumbnails: raw.thumbnails || [],
                uploader: raw.uploader || raw.channel || raw.creator || raw.uploader_id || 'Unknown',
                uploader_url: raw.uploader_url || raw.channel_url,
                channel_follower_count: raw.channel_follower_count,
                view_count: raw.view_count || 0,
                like_count: raw.like_count || 0,
                duration: raw.duration || 0,
                description: raw.description?.slice(0, 300) || '',
                formats: raw.formats || [],
                webpage_url: raw.webpage_url || url,
                contentType,
                entries: sanitizedEntries,
                playlist_count: raw.playlist_count || sanitizedEntries.length || 0
            };

            return { success: true, metadata };
        } catch (e: any) {
            console.error("Info fetch error:", e);
            const rawError = e.message || e.stderr || String(e);
            let friendlyError = "Failed to fetch video info";

            if (rawError.includes('log in') || rawError.includes('login') || rawError.includes('authentication')) {
                friendlyError = "🔒 Login required. This content is private or requires authentication.";
            } else if (rawError.includes('Private video') || rawError.includes('private')) {
                friendlyError = "🔒 This video is private and cannot be accessed.";
            } else if (rawError.includes('Video unavailable') || rawError.includes('unavailable')) {
                friendlyError = "❌ This video is unavailable or has been removed.";
            } else if (rawError.includes('age') || rawError.includes('Age')) {
                friendlyError = "🔞 Age-restricted content. Login required to access.";
            } else if (rawError.includes('blocked') || rawError.includes('country')) {
                friendlyError = "🌍 This content is blocked in your region.";
            } else if (rawError.includes('not found') || rawError.includes('404')) {
                friendlyError = "🔍 Content not found. Check the URL and try again.";
            } else if (rawError.includes('timed out') || rawError.includes('timeout')) {
                friendlyError = "⏱️ Request timed out. Please try again.";
            } else if (rawError.includes('network') || rawError.includes('connection')) {
                friendlyError = "📶 Network error. Check your internet connection.";
            } else if (rawError.includes('Unsupported URL')) {
                if (url.includes('facebook.com/stories')) {
                    friendlyError = "⚠️ Facebook Stories are currently not supported by the downloader. Support will be added in a future update.";
                } else {
                    friendlyError = "❌ This URL is not supported.";
                }
            }

            return { success: false, error: friendlyError };
        }
    });

    ipcMain.handle('get-spotify-info', async (event: any, url: any) => {
        if (!url) return { success: false, error: 'No URL provided' };
        console.log(`Fetching Spotify info for ${url}...`);

        // Quick validation before hitting the network
        if (!extractSpotifyId(url)) {
            return { success: false, error: 'Invalid Spotify URL' };
        }

        try {
            const metadata = await fetchSpotifyInfo(url);
            console.log(`[Spotify] Got metadata: "${metadata.title}" — ${metadata.entries?.length || 0} tracks`);
            return { success: true, metadata };
        } catch (e: any) {
            console.error('[Spotify] Fetch error:', e.message);
            // Give the user a helpful message
            const msg = e.message || 'Failed to fetch Spotify info';
            return { success: false, error: `⚠️ ${msg}` };
        }
    });
}
