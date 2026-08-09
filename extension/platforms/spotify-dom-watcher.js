// VibeDownloader — Spotify DOM watcher (ISOLATED world, document_idle)
//
// Spotify renders the currently playing track as a real element in the
// bottom-left "now playing" widget: the song title is
// a[data-testid="context-item-info-title"], the artist(s) live in
// [data-testid="context-item-info-artist"]. No network sniffing, no
// MAIN-world injection, no CSP tricks — this is plain DOM observation,
// and it only reads the shared DOM so it belongs in the ISOLATED world.
//
// Captured tracks are forwarded to spotify.js via window.postMessage with
// source 'vibedownloader-spotify-hook'. Nothing is clicked, nothing is
// shown — fully passive.
//
// NOTE: clipboard capture does NOT live here. The page's
// navigator.clipboard.writeText calls happen in its own JS world and are
// invisible to this ISOLATED-world script — see spotify-clipboard-hook.js
// (MAIN world, loaded via spotify-bootstrap.js).

(function() {
    'use strict';

    if (window.__vibedownloaderSpotifyWatcher) return;
    window.__vibedownloaderSpotifyWatcher = true;

    function post(msg) {
        try {
            window.postMessage(Object.assign({ source: 'vibedownloader-spotify-hook' }, msg), '*');
        } catch (_) {}
    }

    function trackIdFromHref(href) {
        const m = (href || '').match(/\/track\/([a-zA-Z0-9]+)/);
        return m ? m[1] : null;
    }

    let lastId = null;

    function scan() {
        const npBar = document.querySelector('[data-testid="now-playing-widget"]');
        if (!npBar) return;

        // Track ID: prefer the title link itself, then any track link or
        // data-uri inside the widget. (Spotify's bottom-left widget anchors
        // the title to /track/<id> — if that ever regresses to /album/, the
        // first query just won't match and we fall through.)
        const titleLink = npBar.querySelector('a[data-testid="context-item-info-title"]');
        const id = trackIdFromHref(titleLink && titleLink.getAttribute('href'))
            || trackIdFromHref(
                npBar.querySelector('a[href^="/track/"]') &&
                npBar.querySelector('a[href^="/track/"]').getAttribute('href')
            );

        if (!id || id === lastId) return;
        lastId = id;

        const name = (titleLink && titleLink.textContent.trim()) || '';
        const artistEl = npBar.querySelector('[data-testid="context-item-info-artist"]');
        const artists = artistEl ? artistEl.textContent.trim() : '';
        const imgEl = npBar.querySelector('img');
        const image = imgEl ? imgEl.src : '';

        post({ type: 'track', id, name, artists, image });
    }

    const observer = new MutationObserver(() => scan());
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });

    scan();
    setInterval(scan, 2000); // safety net in case a mutation is missed
})();
