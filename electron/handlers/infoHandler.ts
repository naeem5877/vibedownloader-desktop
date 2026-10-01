import { ipcMain, app } from 'electron';
import fs from 'fs';
import path from 'path';
import { getYtDlpWrap } from '../utils/binaries';
import { getCookiePath } from '../utils/paths';
import { fetchSpotifyInfo, extractSpotifyId } from '../utils/spotify';
import { defaultUserAgent, detectJsRuntime, jsRuntimeSpawnEnv } from '../utils/platform';
import { classifyExtractionError } from '../utils/errorMessage';
import { buildSubtitleList } from '../utils/subtitles';
import { buildAudioTrackList } from '../utils/audioTracks';
import { fetchYouTubeMusicAlbumArt } from '../utils/youtubeMusic';
import { parseStoryUrl, normalizeStoryInput } from '../utils/instagramStories';
import { fetchStoriesLocal } from '../utils/instagramStoriesLocal';
import { youtubeClientAttempts, isClientSensitiveError } from '../utils/youtubeStrategy';
import { getYtDlpVersion } from '../utils/binaries';
import type { NormalizedStory } from '../utils/instagramStories';

/** Separators YouTube uses between artist names in a single credit string. */
const ARTIST_SPLIT = /\s*(?:,|;|&|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\band\b)\s*/i;

/**
 * The artist to match lyrics against.
 *
 * yt-dlp exposes three overlapping fields and they disagree. YouTube Music
 * sometimes reports the same name twice in `artist` - verified on
 * `music.youtube.com/watch?v=tdnkkMK3N88`, where `artist` and `creator` are both
 * `"Murtaza Qizilbash, Murtaza Qizilbash"` while `uploader` is clean. Passing
 * the doubled string straight through matches no catalogue, and the result is a
 * silent "no lyrics" rather than a visible error.
 *
 * So each source is taken in turn, split into individual names, stripped of the
 * `- Topic` channel marker, and de-duplicated case-insensitively. A repeated
 * name is a metadata artefact, never a real collaboration - two songs by the
 * same artist are not a collaboration.
 */
function pickMusicArtist(raw: any): string {
    for (const source of [raw.artist, raw.creator, raw.uploader]) {
        if (typeof source !== 'string') continue;

        const names = source
            .split(ARTIST_SPLIT)
            .map((name: string) => name.replace(/\s*-\s*Topic\s*$/i, '').trim())
            .filter(Boolean);

        const seen = new Set<string>();
        const unique: string[] = [];
        for (const name of names) {
            const key = name.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            unique.push(name);
        }

        if (unique.length) return unique.join(', ');
    }

    return '';
}

/**
 * Turns a raw yt-dlp JSON payload into the metadata shape the renderer expects.
 * Kept separate from the IPC handler so a cached extraction can be rendered
 * through exactly the same code as a live one, and exported so the metadata
 * contract can be asserted without going through yt-dlp.
 */
export async function buildMetadataFromRaw(raw: any, url: string, isYoutube: boolean) {
    let contentType = 'video';
    if (url.includes('/stories/') || url.includes('/story/')) {
        contentType = 'story';
    } else if (raw._type === 'playlist' || (raw.entries && raw.entries.length > 0)) {
        contentType = 'playlist';
    }

    let thumbnail = raw.thumbnail;
    let ytMusicArtFound = false;

    const isMusic = isYoutube && (url.includes('music.youtube.com') || raw.categories?.includes('Music') || raw.uploader?.endsWith('-Topic'));

    if (isMusic && raw.id) {
        try {
            const ytMusicArt = await fetchYouTubeMusicAlbumArt(raw.id);
            if (ytMusicArt) {
                thumbnail = ytMusicArt;
                ytMusicArtFound = true;
                console.log('✅ Premium YT Music square art fetched:', thumbnail);
            }
        } catch (e) { console.error('YT Music art fetch error:', e); }
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

    // The renderer needs to know this is a music track to decide whether lyrics
    // are worth looking up, and the raw yt-dlp signals that drive that decision
    // are not otherwise forwarded. `isMusic` was already computed above; the
    // categories travel with it so the renderer can re-derive the same answer
    // instead of trusting a bare boolean it cannot audit.
    const musicArtist = isMusic ? pickMusicArtist(raw) : '';

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
        subtitles: buildSubtitleList(raw),
        audioTracks: buildAudioTrackList(raw),
        isLive: !!raw.is_live,
        isMusic,
        categories: raw.categories || [],
        artist: musicArtist,
        webpage_url: raw.webpage_url || url,
        contentType,
        entries: sanitizedEntries,
        playlist_count: raw.playlist_count || sanitizedEntries.length || 0
    };

    return { metadata, contentType };
}

export function registerInfoHandlers() {
    ipcMain.handle('get-video-info', async (event: any, url: any) => {
        if (!url) return { success: false, error: "No URL provided" };

        // TikTok tracking params (is_from_webapp, sender_device) can cause
        // yt-dlp's webpage request to fail. The video ID lives in the path,
        // so strip all query params for TikTok video URLs.
        if (typeof url === 'string' && url.includes('tiktok.com') && /\/video\/\d+/.test(url)) {
            url = url.split('?')[0];
        }

        console.log(`Fetching info for ${url}...`);

        // Hoisted: the catch block needs to know whether cookies were actually
        // sent, so that a failure does not tell a user to add cookies again.
        let sentCookies = false;

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
                '--no-check-certificates'
            ];

            // yt-dlp needs a JavaScript runtime to get past YouTube's challenges, and
            // warns that without one "some formats may be missing". We now always
            // have one: the Node runtime already inside this app. See
            // utils/platform.ts detectJsRuntime.
            const jsRuntime = detectJsRuntime();
            if (jsRuntime) args.push('--js-runtimes', jsRuntime.flag);
            const jsRuntimeEnv = jsRuntimeSpawnEnv(jsRuntime);

            // Add cookies if available for the specific platform
            let cookiePath = null;
            // A bare `@handle` carries no domain, so it is normalised to a
            // canonical stories URL before any of this runs. That keeps every
            // downstream `url.includes('instagram.com')` check working without
            // teaching each one about handles.
            const normalized = normalizeStoryInput(url);
            const isInstagram = normalized.url.includes('instagram.com') || normalized.url.includes('instagr.am');
            const isFacebook = url.includes('facebook.com') || url.includes('fb.watch') || url.includes('fb.com');
            const isYoutube = url.includes('youtube.com') || url.includes('youtu.be');
            const isTiktok = url.includes('tiktok.com');

            if (isInstagram) {
                cookiePath = getCookiePath('instagram');
            } else if (isFacebook) {
                cookiePath = getCookiePath('facebook');
            } else if (isYoutube) {
                cookiePath = getCookiePath('youtube');
            } else if (isTiktok) {
                cookiePath = getCookiePath('tiktok');
            }
// Instagram Stories via the ProfileQuery resolver.
            //
            // The previous implementation used `insta-fetcher`, which is dead
            // (400 at `getIdByUsername()`, UA from 2021) and also discarded the
            // story id from the URL, so `/stories/user/<id>/` returned the whole
            // tray. See `stories.md`.
            if (isInstagram && normalized.isStoryRequest) {
                console.log('Using the built-in downloader for Instagram stories...');

                const parsed = parseStoryUrl(normalized.url);
                if (!parsed) throw new Error("Invalid Instagram Story URL");

                let stories: NormalizedStory[];
                try {
                    stories = await fetchStoriesLocal(parsed.handle, parsed.storyId);
                } catch (e: any) {
                    // Every failure mode is already a user-facing sentence.
                    throw new Error(e?.message || 'Could not read those Instagram stories.');
                }

                const entries = stories.map((s, i) => ({
                    id: s.id,
                    title: s.title || `Story ${i + 1}`,
                    thumbnail: s.thumbnail,
                    duration: s.duration,
                    url: s.url,
                    isIGStoryImage: s.isIGStoryImage,
                    ext: s.ext
                }));

                const metadata = {
                    id: `ig-story-${parsed.handle}`,
                    title: `Story by ${parsed.handle}`,
                    thumbnail: entries.length > 0 ? entries[0].thumbnail : '',
                    uploader: parsed.handle,
                    uploader_url: `https://instagram.com/${parsed.handle}`,
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
                        'User-Agent': defaultUserAgent(),
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
            const defaultUA = defaultUserAgent();
            // ...but never for YouTube. yt-dlp pairs its own default UA with its
            // default player client; overriding the UA with a desktop Chrome
            // string while still using that non-browser client is a mismatch,
            // and YouTube answers a mismatched client with a degraded format
            // list (only low-res offered). A user's own `yt-dlp -F` uses the
            // default UA and works, while the app with this override did not.
            // yt-dlp also sets per-extractor UAs itself, so the default is the
            // correct value, not a gap.
            if (!isYoutube) args.push('--user-agent', defaultUA);

            // STRICT SEPARATION: Only use cookies for the specific platform
            if (cookiePath && fs.existsSync(cookiePath)) {
                args.push('--cookies', cookiePath);
                sentCookies = true;
                const platformName = isInstagram ? 'Instagram' : isFacebook ? 'Facebook' : isYoutube ? 'YouTube' : isTiktok ? 'TikTok' : 'Platform';
                console.log(`Using custom cookies for ${platformName} (Path: ${cookiePath})`);
            } else if (!cookiePath && fs.existsSync(path.join(app.getPath('userData'), 'cookies.txt'))) {
                // Only fall back to legacy cookies.txt if strict platform cookies are NOT expected
                // For generic sites, we can use legacy. For FB/Insta, we rely on their specific files.
                args.push('--cookies', path.join(app.getPath('userData'), 'cookies.txt'));
                sentCookies = true;
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

// Always a live extraction. There used to be a cache-first branch
            // here that answered a re-pasted video from a payload on disk, which
            // made a repeat visit feel instant - but it also meant the UI could
            // show metadata that no longer matched the video, since format lists,
            // caption languages and stream URLs all change on YouTube's side.
            // Freshness is worth the round trip.
            //
            // YouTube is attempted through each player in turn. A player that
            // gets refused (age wall, bot wall, "format not available") must not
            // become a user-facing failure while a different player would have
            // worked, which is what made this succeed on some machines and not
            // others. See utils/youtubeStrategy.ts.
            const hasCookies = sentCookies;
            const attempts = isYoutube ? youtubeClientAttempts(hasCookies) : [{ label: 'default', extractorArgs: null }];

            let lastError: any;
            for (const attempt of attempts) {
                const attemptArgs = attempt.extractorArgs
                    ? [...args, '--extractor-args', attempt.extractorArgs[0]]
                    : args;

                try {
                    const ytDlpPromise = ytDlpWrap.execPromise(attemptArgs, { env: jsRuntimeEnv });
                    const timeoutPromise = new Promise((_, reject) => {
                        setTimeout(() => reject(new Error('Request timed out')), 60000);
                    });

                    const metadataString = await Promise.race([ytDlpPromise, timeoutPromise]) as string;
                    const raw = JSON.parse(metadataString);

                    if (attempts.length > 1) {
                        console.log(`YouTube extraction succeeded via ${attempt.label}`);
                    }

                    const { metadata } = await buildMetadataFromRaw(raw, url, isYoutube);
                    return { success: true, metadata };
                } catch (e: any) {
                    lastError = e;
                    console.warn(`YouTube extraction failed via ${attempt.label}:`, String(e?.message || e).split('\n')[0]);

                    const isLast = attempt === attempts[attempts.length - 1];
                    if (isLast || !isClientSensitiveError(e)) throw e;
                    console.log('Retrying YouTube extraction with a different player...');
                }
            }

            throw lastError;
        } catch (e: any) {
            console.error("Info fetch error:", e);

            // `hasCookies` matters: without it every age/login failure says "add
            // cookies", which is useless advice for a user who already did, and
            // actively wrong when YouTube's bot wall was reported as an age
            // gate.
            const classified = classifyExtractionError(e.message || e.stderr || String(e), url, {
                hasCookies: sentCookies
            });

            // Log the yt-dlp version with every failure. "Same app version" does
            // not mean "same yt-dlp" - the binary is updated separately over the
            // network, so two users on one release are routinely months apart,
            // and that is invisible unless it is written down.
            let ytdlpVersion: string | null = null;
            try {
                ytdlpVersion = await getYtDlpVersion();
            } catch { /* the binary may be the thing that is broken */ }
            console.warn(
                `Extraction failed (${classified.kind}) | url=${url} | yt-dlp=${ytdlpVersion || 'unknown'} | ` +
                `cookies=${sentCookies ? 'yes' : 'no'} | ${String(e).split('\n')[0]}`
            );

            // A stale yt-dlp is the usual cause of bot-protection failures, so
            // start a throttled update attempt while we report the failure.
            if (classified.suggestYtDlpUpdate) {
                try {
                    const { checkForYtDlpUpdate } = require('../utils/binaries');
                    checkForYtDlpUpdate(true).catch(() => {});
                } catch { /* ignore */ }
            }

            // Name the version in the message when the failure is the kind a stale
            // yt-dlp causes. The user cannot check this themselves, and it is
            // the one variable that differs between two identical installs.
            let message = classified.message;
            if (classified.suggestYtDlpUpdate && ytdlpVersion) {
                message += ` (downloader version: ${ytdlpVersion})`;
            }

            return { success: false, error: message };
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
