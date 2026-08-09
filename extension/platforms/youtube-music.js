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
