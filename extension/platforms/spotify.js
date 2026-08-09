// VibeDownloader — Spotify support
// Handles: open.spotify.com
//
// The button ALWAYS sends the REAL Spotify track URL to the desktop app:
// the app opens, switches to the Spotify platform and fetches the true
// Spotify metadata (title/artist/album art/duration), then shows the card
// for the user to click Download. We never auto-download and never send a
// title/artist "fake" card.
//
// The track ID is resolved in this order:
//   0. DOM watcher (spotify-dom-watcher.js) — the now-playing widget's track link
//   1. Spotify's own postMessage broadcasts (playingstate) — deep scan
//   2. The page URL if the user is on a /track/ page
//   3. data-uri / /track/ links already present in the DOM
//   4. Spotify's authenticated player API (get_access_token + /v1/me/player)
//      — works while the user is logged in, even without any postMessage.
//   5. One-click "Copy link to Song" icon in the Now Playing panel — copies
//      the track URL to the clipboard (caught by the MAIN-world clipboard
//      hook), no dialog.
//      Only used as a last resort.

(function() {
    'use strict';

    if (window.__vibedownloaderSpotifyInjected) return;
    window.__vibedownloaderSpotifyInjected = true;

    console.log('[VibeDownloader] Spotify content script loaded');

    const BTN_ID = 'vibedownloader-spotify-btn';
    const BTN_CLASS = 'vibedownloader-spotify-btn';

    let currentTrack = null;

    // 1. Capture current track from Spotify's internal postMessage broadcasts
    //    (type: 'playingstate'). Recursively scans messages for a track URI
    //    since Spotify occasionally reshapes the payload.
    function findTrackUriInObject(obj, depth = 0) {
        if (!obj || typeof obj !== 'object' || depth > 6) return null;
        if (Array.isArray(obj)) {
            for (const item of obj) {
                const found = findTrackUriInObject(item, depth + 1);
                if (found) return found;
            }
            return null;
        }
        for (const key of Object.keys(obj)) {
            const value = obj[key];
            if (typeof value === 'string') {
                if (value.startsWith('spotify:track:')) return value.split(':').pop();
            } else if (value && typeof value === 'object') {
                const found = findTrackUriInObject(value, depth + 1);
                if (found) return found;
            }
        }
        return null;
    }

    window.addEventListener('message', (e) => {
        try {
            let msg = e.data;
            if (typeof msg === 'string') {
                try { msg = JSON.parse(msg); } catch (_) { return; }
            }
            if (!msg || typeof msg !== 'object') return;

            // Preferred: structured current track
            const track = msg.data?.track_window?.current_track || msg.data?.item;
            if (track && (track.uri || track.id)) {
                const trackId = String(track.uri || track.id).split(':').pop();
                if (trackId) {
                    const dom = readFromDom();
                    currentTrack = {
                        id: trackId,
                        title: track.name || dom?.title || '',
                        artist: (track.artists || []).map(a => a.name).join(', ') || dom?.artist || '',
                        thumbnail: (track.album?.images?.[0]?.url) || dom?.thumbnail || ''
                    };
                    return;
                }
            }

            // Fallback: scan the whole message for any track URI
            const uri = findTrackUriInObject(msg);
            if (uri) {
                const dom = readFromDom();
                currentTrack = {
                    id: uri,
                    title: dom?.title || '',
                    artist: dom?.artist || '',
                    thumbnail: dom?.thumbnail || ''
                };
            }
        } catch (_) {}
    });

    // 1b. DOM watcher (spotify-dom-watcher.js, ISOLATED world) watches the
    //     now-playing widget and forwards every track change here; the
    //     clipboard hook (spotify-clipboard-hook.js, MAIN world) forwards
    //     "Copy link to Song" writes the same way. This is the primary,
    //     reliable source: Spotify renders the current track as a real
    //     <a href="/track/<id>"> element — no network interception.
    window.addEventListener('message', (e) => {
        if (!e.data || e.data.source !== 'vibedownloader-spotify-hook') return;
        try {
            const hook = e.data;
            if (hook.type === 'track') {
                if (hook.id) {
                    currentTrack = {
                        id: hook.id,
                        title: hook.name || '',
                        artist: hook.artists || '',
                        thumbnail: hook.image || ''
                    };
                }
            } else if (hook.type === 'copied' && hook.text) {
                const id = String(hook.text).match(/spotify\.com\/track\/([a-zA-Z0-9]+)/);
                if (id && id[1]) {
                    currentTrack = Object.assign({}, currentTrack || {}, { id: id[1] });
                }
            }
        } catch (_) {}
    });

    // 2. Read track title/artist from the now-playing bar DOM
    function readFromDom() {
        const widget = document.querySelector('[data-testid="now-playing-widget"]');
        if (!widget) return null;
        const title = widget.querySelector('[data-testid="context-item-info-title"]')?.textContent?.trim();
        const artist = widget.querySelector('[data-testid="context-item-info-artist"]')?.textContent?.trim();
        if (!title) return null;
        return { id: null, title, artist, thumbnail: '' };
    }

    // 3. Direct URL match if the user is on a track page
    function readFromUrl() {
        const m = window.location.pathname.match(/^\/track\/([a-zA-Z0-9]+)/);
        return m ? { id: m[1], title: '', artist: '', thumbnail: '' } : null;
    }

    // 4. Scan the DOM for an already-visible track link/data-uri
    function findTrackIdInDom() {
        try {
            const uriEl = document.querySelector('[data-uri^="spotify:track:"]');
            if (uriEl) {
                const id = uriEl.getAttribute('data-uri').split(':').pop();
                if (id) return id;
            }
            const link = document.querySelector('a[href^="/track/"]');
            if (link) {
                const m = link.getAttribute('href').match(/^\/track\/([a-zA-Z0-9]+)/);
                if (m) return m[1];
            }
        } catch (_) {}
        return null;
    }

    function getTrack() {
        const dom = readFromDom();
        const url = readFromUrl();
        if (url && url.id && (!dom || !dom.title)) return url;
        if (!dom) return currentTrack;
        if (currentTrack && currentTrack.title === dom.title) {
            return { ...currentTrack, thumbnail: currentTrack.thumbnail || dom.thumbnail };
        }
        return dom;
    }

    function buildTrackUrl(track) {
        if (track && track.id) return `https://open.spotify.com/track/${track.id}`;
        return null;
    }

    // 5. Guaranteed resolver: ask Spotify's own player API for the currently
    //    playing track. Runs on the page (same origin), so the session cookies
    //    are sent automatically and we get a fresh access token without any
    //    user interaction. Returns the REAL track id + metadata.
    async function fetchCurrentTrackFromSpotifyApi() {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 8000);

            const tokenRes = await fetch(
                'https://open.spotify.com/get_access_token?reason=transport&productType=web_player',
                { credentials: 'include', signal: controller.signal }
            );
            if (!tokenRes.ok) {
                clearTimeout(timer);
                return null;
            }
            const tokenData = await tokenRes.json();
            const token = tokenData && tokenData.accessToken;
            if (!token) {
                clearTimeout(timer);
                return null;
            }

            const playerRes = await fetch('https://api.spotify.com/v1/me/player', {
                headers: { 'Authorization': `Bearer ${token}` },
                signal: controller.signal
            });
            clearTimeout(timer);
            if (!playerRes.ok) return null;

            const player = await playerRes.json();
            const item = player && player.item;
            if (!item || (item.type && item.type !== 'track')) return null;

            const trackId = (item.uri || item.id || '').toString().split(':').pop();
            if (!trackId) return null;

            return {
                id: trackId,
                title: item.name || '',
                artist: (item.artists || []).map(a => a.name).join(', '),
                thumbnail: item.album?.images?.[0]?.url || ''
            };
        } catch (_) {
            return null;
        }
    }

    // 6. (removed) The share-button approach was abandoned: clicking
    //    Spotify's "Share" button opened its dialog ("copy link") instead of
    //    reliably triggering the download. Track resolution now uses only
    //    non-intrusive sources: postMessage deep-scan, page URL, DOM links,
    //    and the authenticated player API.

    // 6. Last-resort resolver: Spotify's one-click "Copy link to Song" share
    //    icon in the Now Playing side panel. It copies https://open.spotify.com/
    //    track/<id> straight to the clipboard (no share dialog), which the DOM
    //    watcher (spotify-dom-watcher.js) forwards to us. The icon only exists while
    //    the Now Playing panel is open, so we open it via the player bar's NPV
    //    toggle ([data-testid="control-button-npv"]) if needed.
    function findCopyLinkButton() {
        return Array.from(document.querySelectorAll('button[aria-label]')).find((btn) => {
            const label = btn.getAttribute('aria-label') || '';
            return label === 'Copy link to Song' || label === 'Copy Song Link';
        });
    }

    async function ensureNowPlayingPanel() {
        const npv = document.querySelector('footer [data-testid="control-button-npv"]')
            || document.querySelector('[data-testid="control-button-npv"]');
        if (!npv) return false;
        if (npv.getAttribute('data-active') === 'true') return true;
        npv.click();
        await new Promise((r) => setTimeout(r, 500));
        return true;
    }

    async function grabLinkDirect() {
        let copyBtn = findCopyLinkButton();
        if (!copyBtn) {
            const opened = await ensureNowPlayingPanel();
            if (!opened) return null;
            copyBtn = findCopyLinkButton();
        }
        if (!copyBtn) return null;

        // Tell the MAIN-world hook to suppress the native toast for THIS
        // click only — dispatched into MAIN world so it crosses the world
        // boundary the same way postMessage does.
        window.dispatchEvent(new CustomEvent('vibedownloader-suppress-toast'));

        copyBtn.click();
        await new Promise((r) => setTimeout(r, 400));
        const id = currentTrack && currentTrack.id;
        if (!id) return null;
        return {
            id,
            title: currentTrack.title || '',
            artist: currentTrack.artist || '',
            thumbnail: currentTrack.thumbnail || ''
        };
    }

    function buildButton() {
        const btn = document.createElement('button');
        btn.id = BTN_ID;
        btn.className = BTN_CLASS;
        btn.title = 'Download with VibeDownloader';
        btn.appendChild(VibeExt.createSvgIcon(18));

        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            const track = getTrack() || {};
            let url = buildTrackUrl(track);

            // No ID from postMessage/page URL yet — try visible DOM links
            if (!url) {
                const domId = findTrackIdInDom();
                if (domId) {
                    url = `https://open.spotify.com/track/${domId}`;
                    track.id = domId;
                }
            }

            // Still no ID — ask Spotify's own player API (authenticated).
            // This is the reliable, non-intrusive path: it never clicks
            // anything in the page, so no share dialog pops up.
            if (!url) {
                btn.classList.add('vibedownloader-sending');
                const apiTrack = await fetchCurrentTrackFromSpotifyApi();
                btn.classList.remove('vibedownloader-sending');

                if (apiTrack && apiTrack.id) {
                    track.id = apiTrack.id;
                    track.title = apiTrack.title || track.title;
                    track.artist = apiTrack.artist || track.artist;
                    track.thumbnail = apiTrack.thumbnail || track.thumbnail;
                    url = `https://open.spotify.com/track/${track.id}`;
                }
            }

            // Last resort — the Now Playing panel's one-click "Copy link to
            // Song" icon. Clicks nothing else and never opens the share
            // dialog; it only writes the track URL to the clipboard, which
            // the DOM watcher forwards back to us as currentTrack.id.
            if (!url) {
                btn.classList.add('vibedownloader-sending');
                const clipTrack = await grabLinkDirect();
                btn.classList.remove('vibedownloader-sending');

                if (clipTrack && clipTrack.id) {
                    track.id = clipTrack.id;
                    track.title = clipTrack.title || track.title;
                    track.artist = clipTrack.artist || track.artist;
                    track.thumbnail = clipTrack.thumbnail || track.thumbnail;
                    url = `https://open.spotify.com/track/${track.id}`;
                }
            }

            if (url) {
                // Real URL -> app opens, switches to Spotify, fetches real metadata.
                VibeExt.sendDownload(url, track.title || document.title, track.thumbnail || '', btn);
                return;
            }

            // Honest failure — never send a fake title/artist card.
            btn.classList.add('vibedownloader-error');
            VibeExt.showToast('Could not resolve the current Spotify track — open a track page first');
            setTimeout(() => btn.classList.remove('vibedownloader-error'), 2000);
        });

        return btn;
    }

    function injectButton() {
        const widget = document.querySelector('[data-testid="now-playing-widget"]');
        if (!widget) return;

        let btn = widget.querySelector(`#${BTN_ID}`);
        if (!btn) {
            btn = buildButton();

            // Anchor on the heart button's aria-label (stable) rather than its
            // hashed wrapper class (changes on every Spotify deploy). Insert
            // as a sibling right after that wrapper — small isolated
            // container, so a second inline button here is safe and won't
            // fight the widget's outer 3-column space-between layout.
            const likeBtn = widget.querySelector('button[aria-label="Add to Liked Songs"]');
            const likeWrapper = likeBtn ? likeBtn.closest('div') : null;

            if (likeWrapper) {
                likeWrapper.insertAdjacentElement('afterend', btn);
            } else {
                widget.appendChild(btn); // fallback if the like button isn't found
            }
            console.log('[VibeDownloader] Spotify download button injected');
        }

        // Keep the tooltip in sync with the currently playing track
        const track = getTrack();
        if (track && track.title) {
            const label = track.artist ? `${track.title} — ${track.artist}` : track.title;
            btn.title = `Download "${label}" with VibeDownloader`;
        }
    }

    // Spotify's React re-renders the bar constantly (progress ticks) and
    // can strip injected nodes — observe fast so we re-add promptly.
    let queued = false;
    const observer = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        setTimeout(() => {
            queued = false;
            injectButton();
        }, 100);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    injectButton();
})();

// VibeDownloader — Spotify playlist/album page button
// Playlist/album pages don't need track resolution — the current URL
// IS the correct link already, so this is much simpler than the
// now-playing widget button. Completely independent of the code above.
(function() {
    'use strict';

    const PLAYLIST_BTN_ID = 'vibedownloader-spotify-playlist-btn';

    function buildPlaylistButton() {
        const btn = document.createElement('button');
        btn.id = PLAYLIST_BTN_ID;
        btn.className = 'vibedownloader-spotify-playlist-btn';
        btn.title = 'Download with VibeDownloader';
        btn.setAttribute('aria-label', 'Download playlist with VibeDownloader');
        btn.appendChild(VibeExt.createSvgIcon(20));

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const url = window.location.href.split('?')[0];
            const titleEl = document.querySelector('h1');
            const title = titleEl ? titleEl.textContent.trim() : document.title;
            const imgEl = document.querySelector('img[data-testid="entity-image"], img[data-image-status="loaded"]');
            const thumbnail = imgEl ? imgEl.src : '';

            VibeExt.sendDownload(url, title, thumbnail, btn);
        });

        return btn;
    }

    function injectPlaylistButton() {
        const actionBar = document.querySelector('[data-testid="action-bar-row"]');
        if (!actionBar) return;

        let btn = actionBar.querySelector(`#${PLAYLIST_BTN_ID}`);
        if (!btn) {
            btn = buildPlaylistButton();

            // Insert right before "More options" — anchored on aria-label
            // (stable) rather than the hashed wrapper class.
            const moreBtn = actionBar.querySelector('[data-testid="more-button"]');
            if (moreBtn) {
                moreBtn.insertAdjacentElement('beforebegin', btn);
            } else {
                actionBar.appendChild(btn);
            }
        }
    }

    let queued = false;
    const observer = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        setTimeout(() => {
            queued = false;
            injectPlaylistButton();
        }, 100);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    injectPlaylistButton();
})();
