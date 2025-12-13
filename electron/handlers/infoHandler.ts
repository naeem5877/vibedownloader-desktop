import { ipcMain, app } from 'electron';
import fs from 'fs';
import path from 'path';
import { getYtDlpWrap } from '../utils/binaries';
import { getCookiePath } from '../utils/paths';
import { spotifyApiRequest, extractSpotifyId } from '../utils/spotify';

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
                '--socket-timeout', '15'
            ];

            // Add cookies if available for the specific platform
            let cookiePath = null;
            const isInstagram = url.includes('instagram.com') || url.includes('instagr.am');
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

            // Add User-Agent to help with Facebook/Instagram
            args.push('--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');

            // STRICT SEPARATION: Only use cookies for the specific platform
            if (cookiePath && fs.existsSync(cookiePath)) {
                args.push('--cookies', cookiePath);
                const platformName = isInstagram ? 'Instagram' : isFacebook ? 'Facebook' : isYoutube ? 'YouTube' : 'TikTok';
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
                setTimeout(() => reject(new Error('Request timed out')), 45000);
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
            if (!thumbnail && raw.thumbnails && raw.thumbnails.length > 0) {
                const sorted = [...raw.thumbnails].sort((a: any, b: any) => (b.width || 0) - (a.width || 0));
                thumbnail = sorted[0]?.url || raw.thumbnails[raw.thumbnails.length - 1]?.url;
            }

            if (!thumbnail && raw.entries && raw.entries.length > 0) {
                const first = raw.entries[0];
                thumbnail = first.thumbnail || (first.thumbnails ? first.thumbnails[0]?.url : '');
            }

            const metadata = {
                id: raw.id,
                title: raw.title || raw.fulltitle || 'Untitled',
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
                entries: raw.entries?.map((e: any, i: number) => ({
                    id: e.id,
                    title: e.title || `Track ${i + 1}`,
                    thumbnail: e.thumbnail || e.thumbnails?.[0]?.url || '',
                    duration: e.duration || 0,
                    url: e.url || e.webpage_url || `https://www.youtube.com/watch?v=${e.id}`
                })) || [],
                playlist_count: raw.playlist_count || raw.entries?.length || 0
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
        if (!url) return { success: false, error: "No URL provided" };
        console.log(`Fetching Spotify info for ${url}...`);

        try {
            const parsed = extractSpotifyId(url);
            if (!parsed) {
                return { success: false, error: "Invalid Spotify URL" };
            }

            let metadata: any = {
                contentType: parsed.type,
                entries: []
            };

            if (parsed.type === 'track') {
                const track = await spotifyApiRequest(`/tracks/${parsed.id}`);
                metadata = {
                    id: track.id,
                    title: track.name,
                    thumbnail: track.album?.images?.[0]?.url || '',
                    uploader: track.artists?.map((a: any) => a.name).join(', ') || 'Unknown',
                    duration: Math.floor(track.duration_ms / 1000),
                    view_count: track.popularity || 0,
                    webpage_url: track.external_urls?.spotify || url,
                    contentType: 'video', // Single track = video-like
                    album: track.album?.name,
                    release_date: track.album?.release_date,
                    // For YouTube search
                    searchQuery: `${track.artists?.[0]?.name} - ${track.name} audio`
                };
            } else if (parsed.type === 'album') {
                const album = await spotifyApiRequest(`/albums/${parsed.id}`);
                metadata = {
                    id: album.id,
                    title: album.name,
                    thumbnail: album.images?.[0]?.url || '',
                    uploader: album.artists?.map((a: any) => a.name).join(', ') || 'Unknown',
                    duration: 0,
                    view_count: album.popularity || 0,
                    webpage_url: album.external_urls?.spotify || url,
                    contentType: 'playlist',
                    playlist_count: album.tracks?.total || 0,
                    entries: album.tracks?.items?.map((track: any, i: number) => ({
                        id: track.id,
                        title: track.name,
                        thumbnail: album.images?.[0]?.url || '',
                        duration: Math.floor(track.duration_ms / 1000),
                        url: track.external_urls?.spotify || '',
                        artist: track.artists?.map((a: any) => a.name).join(', '),
                        searchQuery: `${track.artists?.[0]?.name} - ${track.name} audio`
                    })) || []
                };
            } else if (parsed.type === 'playlist') {
                const playlist = await spotifyApiRequest(`/playlists/${parsed.id}`);
                metadata = {
                    id: playlist.id,
                    title: playlist.name,
                    thumbnail: playlist.images?.[0]?.url || '',
                    uploader: playlist.owner?.display_name || 'Unknown',
                    duration: 0,
                    view_count: playlist.followers?.total || 0,
                    webpage_url: playlist.external_urls?.spotify || url,
                    contentType: 'playlist',
                    playlist_count: playlist.tracks?.total || 0,
                    entries: playlist.tracks?.items?.slice(0, 100).map((item: any, i: number) => {
                        const track = item.track;
                        if (!track) return null;
                        return {
                            id: track.id,
                            title: track.name,
                            thumbnail: track.album?.images?.[0]?.url || '',
                            duration: Math.floor(track.duration_ms / 1000),
                            url: track.external_urls?.spotify || '',
                            artist: track.artists?.map((a: any) => a.name).join(', '),
                            searchQuery: `${track.artists?.[0]?.name} - ${track.name} audio`
                        };
                    }).filter(Boolean) || []
                };
            }

            console.log(`Spotify metadata: ${metadata.title}, ${metadata.entries?.length || 0} tracks`);
            return { success: true, metadata };
        } catch (e: any) {
            console.error("Spotify fetch error:", e);
            return { success: false, error: e.message || "Failed to fetch Spotify info" };
        }
    });
}
