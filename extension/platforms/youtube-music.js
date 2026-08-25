// VibeDownloader — YouTube Music
// Handles: music.youtube.com
//
// Player bar: ytmusic-player-bar .middle-controls-buttons
//   — icon-only circular button before the ••• menu
//   Strips auto-generated radio playlist params (RDAMVM..., RDAMPL...)
//   from URLs before sending.

(function() {
    'use strict';

    const BTN_ID = 'vibedownloader-music-btn';

    function getTrackData() {
        let url = window.location.href;
        // Strip auto-generated radio/playlist params
        try {
            const urlObj = new URL(url);
            const listParam = urlObj.searchParams.get('list');
            if (listParam && /^(RDAMVM|RDAMPL|RD)/.test(listParam)) {
                urlObj.searchParams.delete('list');
                url = urlObj.toString();
            }
        } catch (_) {}

        const titleEl = document.querySelector('.title.style-scope.ytmusic-player-bar');
        const title = titleEl ? titleEl.textContent.trim() : document.title.replace(' - YouTube Music', '').trim();
        const thumbEl = document.querySelector('ytmusic-player-bar img');
        const thumbnail = thumbEl ? thumbEl.src : '';

        // The player bar title is a link to the CURRENT track's watch page —
        // that is the real URL of the playing song, even when you're on a
        // queue/playlist/radio page and the browser URL never changes.
        const linkEl = document.querySelector('.title.style-scope.ytmusic-player-bar[href]') ||
                       document.querySelector('ytmusic-player-bar a[href*="/watch?v="]');
        let trackUrl = '';
        if (linkEl) {
            const href = linkEl.getAttribute('href');
            if (href && href.includes('/watch?v=')) {
                try {
                    trackUrl = new URL(href, window.location.origin).toString();
                } catch (_) {
                    trackUrl = href;
                }
            }
        }

        return { url: trackUrl || url, title, thumbnail };
    }

    function getControlsContainer() {
        return document.querySelector('ytmusic-player-bar .middle-controls-buttons');
    }

    function injectButton() {
        const container = getControlsContainer();
        if (!container) return;
        if (container.querySelector(`#${BTN_ID}`)) return;

        const menuRenderer = container.querySelector('ytmusic-menu-renderer');
        if (!menuRenderer) return;

        const btn = document.createElement('button');
        btn.id = BTN_ID;
        btn.className = 'vibedownloader-music-btn';
        btn.title = 'Download with VibeDownloader';
        btn.appendChild(VibeExt.createSvgIcon());

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            VibeExt.sendDownload(...Object.values(getTrackData()), btn);
        });

        menuRenderer.insertAdjacentElement('beforebegin', btn);
    }

    const observer = VibeExt.createThrottledObserver(injectButton);
    observer.observe(document.body, { childList: true, subtree: true });

    injectButton();
})();

// VibeDownloader — YouTube Music PLAYLIST page button
// Handles: music.youtube.com/playlist?list=...
// The playlist URL itself is the correct link — no per-track resolution
// needed, same pattern as the Spotify playlist button.
//
// #action-buttons here is a plain custom-element row (Polymer "shady DOM",
// not real Shadow DOM), so it's fully accessible via normal querySelector.
// We anchor the insertion on the "Action menu" (•••) button's aria-label,
// which is the most semantically stable element in the row.
(function() {
    'use strict';

    const BTN_ID = 'vibedownloader-ytm-playlist-btn';

    function getPlaylistTitle() {
        // Prefer the header's title text; fall back to document.title
        const titleEl = document.querySelector('ytmusic-responsive-header-renderer yt-formatted-string.title')
            || document.querySelector('ytmusic-responsive-header-renderer h1')
            || document.querySelector('h1.title, yt-formatted-string.title');
        if (titleEl && titleEl.textContent.trim()) return titleEl.textContent.trim();
        return document.title.replace(' - YouTube Music', '').trim();
    }

    function getPlaylistThumbnail() {
        const ogImage = document.querySelector('meta[property="og:image"]');
        if (ogImage) return ogImage.getAttribute('content') || '';
        const img = document.querySelector('ytmusic-responsive-header-renderer img');
        return img ? img.src : '';
    }

    function buildButton() {
        const btn = document.createElement('button');
        btn.id = BTN_ID;
        btn.className = 'vibedownloader-ytm-playlist-btn';
        btn.title = 'Download playlist with VibeDownloader';
        btn.setAttribute('aria-label', 'Download playlist with VibeDownloader');
        btn.appendChild(VibeExt.createSvgIcon(20));

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const url = window.location.href.split('&')[0]; // strip extra query params, keep ?list=
            const title = getPlaylistTitle();
            const thumbnail = getPlaylistThumbnail();

            VibeExt.sendDownload(url, title, thumbnail, btn);
        });

        return btn;
    }

    function injectButton() {
        // Only on actual playlist pages
        if (!/\/playlist\?/.test(window.location.pathname + window.location.search)) return;

        const actionBar = document.querySelector('#action-buttons.ytmusic-responsive-header-renderer');
        if (!actionBar) return;

        let btn = actionBar.querySelector(`#${BTN_ID}`);
        if (!btn) {
            btn = buildButton();

            // Insert right before the "Action menu" (•••) button — stable
            // aria-label anchor.
            const menuBtn = actionBar.querySelector('[aria-label="Action menu"]')?.closest('ytmusic-menu-renderer');
            if (menuBtn) {
                menuBtn.insertAdjacentElement('beforebegin', btn);
            } else {
                actionBar.appendChild(btn);
            }
        }
    }

    const observer = VibeExt.createThrottledObserver(injectButton);
    observer.observe(document.body, { childList: true, subtree: true });

    // YT Music is an SPA — also re-check on navigation events
    window.addEventListener('yt-navigate-finish', injectButton);

    injectButton();
})();
