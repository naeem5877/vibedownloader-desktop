import { ipcMain, app } from 'electron';
import fs from 'fs';
import path from 'path';
import { getYtDlpWrap, ensureYtDlpReady } from '../utils/binaries';
import { getCookiePath } from '../utils/paths';
import { fetchSpotifyInfo, extractSpotifyId } from '../utils/spotify';
import { defaultUserAgent, detectJsRuntime, jsRuntimeSpawnEnv, describeJsRuntime } from '../utils/platform';
import { classifyExtractionError } from '../utils/errorMessage';
import { buildSubtitleList } from '../utils/subtitles';
import { buildAudioTrackList } from '../utils/audioTracks';
import { fetchYouTubeMusicAlbumArt } from '../utils/youtubeMusic';
import { parseStoryUrl, normalizeStoryInput, StoryError } from '../utils/instagramStories';
import { fetchStoriesLocal } from '../utils/instagramStoriesLocal';
import {
    youtubeClientAttempts,
    isClientSensitiveError,
    inspectFormats,
    isDegradedFormatList,
    formatSummary
} from '../utils/youtubeStrategy';
import { redactUrlForLog } from '../utils/redact';
import { fetchFacebookStory, isFacebookStoryUrl, cookieHeaderFromNetscape, buildFacebookStoryMetadata } from '../utils/facebookStories';
import { reportExtractionFailure, reportThinFormatList } from '../utils/sentry';
import { getYtDlpVersion } from '../utils/binaries';
import type { NormalizedStory } from '../utils/instagramStories';

/**
 * Wall-clock ceiling for one metadata extraction.
 *
 * Covers every client attempt of a single request in total, which is what the
 * user experiences as "the app is thinking". It aborts the child process rather
 * than abandoning the wait, so a stuck extraction cannot leave a yt-dlp running
 * after the UI has given up.
 */
const EXTRACTION_TIMEOUT_MS = 60_000;

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
        // Type first. Everything below calls `url.includes`, so a non-string
        // from the renderer used to throw a TypeError here and surface as a
        // generic failure, hiding the real cause (a bad argument, not the link).
        if (typeof url !== 'string' || !url.trim()) {
            return { success: false, error: "No URL provided" };
        }
        url = url.trim();

        // TikTok tracking params (is_from_webapp, sender_device) can cause
        // yt-dlp's webpage request to fail. The video ID lives in the path,
        // so strip all query params for TikTok video URLs.
        if (url.includes('tiktok.com') && /\/video\/\d+/.test(url)) {
            url = url.split('?')[0];
        }

        console.log(`Fetching info for ${redactUrlForLog(url)}...`);

        // Hoisted: the catch block needs to know whether cookies were actually
        // sent, so that a failure does not tell a user to add cookies again.
        let sentCookies = false;

        // Which player gave up. The error text from yt-dlp rarely says, and
        // "which client was refused" is the first question about a bot-wall
        // report. Declared out here because the report is sent from the catch.
        let lastAttemptLabel = 'default';

        try {
            await ensureYtDlpReady();
            const ytDlpWrap = getYtDlpWrap();
            const hasListParam = url.includes('list=');
            const isRadioMix = url.includes('start_radio=1') || url.includes('list=RD') || url.includes('list=RDMM');
            const isRegularPlaylist = hasListParam && !isRadioMix && (url.includes('/playlist') || !url.includes('watch?v='));

            // `--no-check-certificates` used to sit here. It disabled TLS
            // verification for every site the app can open, to work around one
            // machine's certificate problem - which is also what would let a
            // proxy present a forged certificate unnoticed. A machine that
            // cannot verify a site needs its trust store fixed, not the check
            // turned off for everything, so it is gone.
            const args = [
                url,
                '--dump-single-json',
                '--no-warnings',
                '--socket-timeout', '30'
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

                let stories: NormalizedStory[] = [];
                let noStories = false;
                let noStoriesMessage = '';
                try {
                    stories = await fetchStoriesLocal(parsed.handle, parsed.storyId);
                } catch (e: any) {
                    // "This account has posted nothing" is the most ordinary
                    // answer a stories lookup can give, not a failure. It used
                    // to be thrown on, where the generic extractor classifier
                    // flattened it into "could not read this link - add
                    // cookies", which is both wrong and unactionable. So it
                    // comes back as an empty tray the UI explains instead.
                    if (e instanceof StoryError && e.kind === 'no_stories') {
                        noStories = true;
                        noStoriesMessage = e.message;
                    } else {
                        // Every other failure mode is already a user-facing
                        // sentence.
                        throw new Error(e?.message || 'Could not read those Instagram stories.');
                    }
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
                    playlist_count: entries.length,
                    // Set only when the account simply has nothing posted, so
                    // the tray can say so instead of rendering empty.
                    noStories,
                    noStoriesMessage
                };
                return { success: true, metadata };
            }

            // =============================================
            // Facebook Stories handler (yt-dlp can't handle these)
            // =============================================
            //
            // The fetching and the parsing live in utils/facebookStories.ts. It
            // used to sit inline here, which made it impossible to exercise
            // without Electron - and the one thing that actually mattered, that
            // Facebook needs a `Sec-Fetch-Site` header or answers 400, was a line
            // among many and therefore invisible.
            if (isFacebook && isFacebookStoryUrl(url)) {
                console.log('Fetching Facebook story page directly (yt-dlp has no story extractor)...');

                let cookieHeader = '';
                if (cookiePath && fs.existsSync(cookiePath)) {
                    cookieHeader = cookieHeaderFromNetscape(fs.readFileSync(cookiePath, 'utf8'));
                }

                const story = await fetchFacebookStory(url, cookieHeader);

                return { success: true, metadata: buildFacebookStoryMetadata(story) };
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
                // "Cookie file found" and "cookies accepted" are different facts.
                // Only the site can say the second one, so the log claims only the
                // first, and a later failure that mentions a login wall is read
                // against it rather than as a missing-cookie problem.
                console.log(`Cookie file present for ${platformName} (Path: ${cookiePath}); whether ${platformName} accepts it is not known yet`);
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

            // One retry is allowed for a *successful but degraded* answer, and
            // only one. A second thin reply means the answer really is that thin,
            // and looping here would turn a 2s fetch into an 8s one for every
            // genuinely low-resolution video.
            let degradedRetriesLeft = 1;

            // One budget for the whole request, not per attempt. A user who
            // clicked once waits at most this long however many players are
            // tried; the remaining slice is what the next attempt gets.
            const deadline = Date.now() + EXTRACTION_TIMEOUT_MS;

            let lastError: any;
            for (const attempt of attempts) {
                lastAttemptLabel = attempt.label;
                const attemptArgs = attempt.extractorArgs
                    ? [...args, '--extractor-args', attempt.extractorArgs[0]]
                    : args;

                try {
                    // A real deadline. `Promise.race` against a bare timer - which
                    // is what this used to be - stops the *wait* but not yt-dlp:
                    // the process keeps running to its own conclusion, and its
                    // timer stays armed for the full 60s on requests that finish
                    // in one. An AbortSignal is wired to `taskkill /T /F` by
                    // yt-dlp-wrap, so a timeout now ends the child too.
                    const controller = new AbortController();
                    let timedOut = false;
                    const timer = setTimeout(() => {
                        timedOut = true;
                        controller.abort();
                    }, Math.max(1000, deadline - Date.now()));
                    let metadataString: string;
                    try {
                        metadataString = await ytDlpWrap.execPromise(attemptArgs, { env: jsRuntimeEnv }, controller.signal) as string;
                    } catch (e: any) {
                        // The abort kills the child, and the wrapper then rejects
                        // with whatever partial stderr it collected. Report the
                        // deadline instead, so the message is the one the
                        // classifier already knows how to explain.
                        if (timedOut) throw new Error('Request timed out');
                        throw e;
                    } finally {
                        clearTimeout(timer);
                    }
                    const raw = JSON.parse(metadataString);

                    // Judge the answer, not just the exit code. This is the line
                    // that decides a "successful" 320p is not the end of the
                    // story: see isDegradedFormatList for why these rules are
                    // narrow, and why a video that simply tops out below 1080p
                    // is left alone.
                    const inspection = inspectFormats(raw);
                    const isLast = attempt === attempts[attempts.length - 1];
                    if (isYoutube && isDegradedFormatList(inspection)) {
                        const runtime = describeJsRuntime(jsRuntime);
                        console.warn(
                            `[YouTube] ${attempt.label} returned a thin format list: ${formatSummary(inspection)} ` +
                            `(runtime: ${runtime})`
                        );
                        // Reported, not just logged. This is the "I got 360p"
                        // report, and nothing crashes: the fetch succeeded and the
                        // answer was wrong, so no crash reporter would ever see
                        // it. Sent only when this is what the user is left with,
                        // not on every attempt along the way.
                        reportThinFormatList({
                            url,
                            player: attempt.label,
                            formatCount: inspection.formatCount,
                            maxHeight: inspection.maxHeight,
                            videoFormatCount: inspection.videoFormatCount,
                            audioFormatCount: inspection.audioFormatCount,
                            heights: inspection.heights,
                            kept: isLast,
                            jsRuntime: runtime
                        });
                        if (!isLast && degradedRetriesLeft > 0) {
                            degradedRetriesLeft--;
                            console.log(`[YouTube] Trying the next player for a better format list (${degradedRetriesLeft} such retry left)...`);
                            continue;
                        }
                        // Out of retries, or nothing left to try. Say so in the
                        // log, because this is the answer to "why was my video
                        // only 360p": the platform gave us this list.
                        console.warn(`[YouTube] Keeping the thin format list from ${attempt.label}: ${formatSummary(inspection)}`);
                    } else if (isYoutube && attempts.length > 1) {
                        console.log(`[YouTube] Extraction succeeded via ${attempt.label}: ${formatSummary(inspection)}`);
                    }

                    const { metadata } = await buildMetadataFromRaw(raw, url, isYoutube);
                    return { success: true, metadata };
                } catch (e: any) {
                    lastError = e;
                    // stderr carries the reason the player was refused; `message`
                    // is often just "ERROR: unable to extract video data".
                    console.warn(
                        `Extraction failed via ${attempt.label}: ` +
                        `${String(e?.stderr || e?.message || e).trim().split('\n')[0]}`
                    );

                    const isLast = attempt === attempts[attempts.length - 1];
                    if (isLast || !isClientSensitiveError(e)) throw e;
                    console.log('Retrying extraction with a different player...');
                }
            }

            throw lastError;
} catch (e: any) {
            // The whole error object is not logged: yt-dlp embeds the URL it was
            // given in its message, and these lines end up in pasted bug reports.
            console.error(`Info fetch error (${String(e?.message || e).split('\n')[0]})`);

            // `hasCookies` matters: without it every age/login failure says "add
            // cookies", which is useless advice for a user who already did, and
            // actively wrong when YouTube's bot wall was reported as an age
            // gate.
            //
            // Both `message` and `stderr` go in, rather than the first one that
            // exists. yt-dlp puts the actual refusal ("Sign in to confirm your
            // age", "HTTP Error 429") on stderr while `message` stays a generic
            // "unable to extract video data", so preferring the message
            // classified every failure as the same unknown thing.
            const rawFailureText = [e?.stderr, e?.message].filter(Boolean).join('\n') || String(e);
            const classified = classifyExtractionError(rawFailureText, url, {
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
            const jsRuntimeDescription = describeJsRuntime(detectJsRuntime());
            console.warn(
                `Extraction failed (${classified.kind}) | url=${redactUrlForLog(url)} | ` +
                `yt-dlp=${ytdlpVersion || 'unknown'} | js-runtime=${jsRuntimeDescription} | ` +
                // "file sent", not "accepted": the site never tells us.
                `cookie-file=${sentCookies ? 'sent' : 'none'} | ${String(rawFailureText).trim().split('\n')[0]}`
            );

            // This is the report users actually make - "it didn't work" - and it
            // never throws, so no crash reporter would ever see it. Reported by
            // `kind` rather than by message, so one cause is one issue with a
            // count on it instead of a new issue per wording yt-dlp used.
            reportExtractionFailure({
                url,
                kind: classified.kind,
                attempt: lastAttemptLabel,
                detail: String(rawFailureText).trim().split('\n').slice(0, 3).join(' | '),
                ytdlpVersion,
                jsRuntime: jsRuntimeDescription,
                cookieFile: sentCookies,
                isYoutube: url.includes('youtube.com') || url.includes('youtu.be')
            });

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
