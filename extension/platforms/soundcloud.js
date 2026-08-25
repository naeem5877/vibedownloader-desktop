// VibeDownloader — SoundCloud
// Handles: soundcloud.com
//
// Adds a download button to the bottom player bar's sound badge — the
// like/follow/queue action row for the CURRENT track, present on every
// page. Canonical track URL comes from the title link inside the badge.

(function() {
    'use strict';

    if (window.__vibedownloaderScInjected) return;
    window.__vibedownloaderScInjected = true;

    const BTN_CLASS = 'vibedownloader-sc-btn';
    const DONE_ATTR = 'data-vibedownloader-done';

    function getTrackUrl(badge) {
        const titleLink = badge.querySelector('.playbackSoundBadge__titleLink');
        if (titleLink) {
            try {
                return new URL(titleLink.getAttribute('href'), window.location.origin).toString();
            } catch (e) {}
        }
        return window.location.href;
    }

    function getTrackTitle(badge) {
        const titleLink = badge.querySelector('.playbackSoundBadge__titleLink');
        if (titleLink && titleLink.textContent.trim()) return titleLink.textContent.trim();
        return document.title;
    }

    function getArtworkUrl(badge) {
        // The badge artwork is a tiny t50x50 sprite — request the 500px variant
        const art = badge.querySelector('.sc-artwork[style*="background-image"]');
        if (art) {
            const m = art.getAttribute('style').match(/url\("?([^")]+)"?\)/);
            if (m && m[1]) return m[1].replace(/-t50x50\.png$/, '-t500x500.jpg');
        }
        const og = document.querySelector('meta[property="og:image"]');
        return og ? og.getAttribute('content') || '' : '';
    }

    function buildButton(badge) {
        const btn = document.createElement('button');
        btn.className = BTN_CLASS;
        btn.type = 'button';
        btn.title = 'Download with VibeDownloader';
        btn.setAttribute('aria-label', 'Download with VibeDownloader');
        btn.appendChild(VibeExt.createSvgIcon(16));

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            VibeExt.sendDownload(getTrackUrl(badge), getTrackTitle(badge), getArtworkUrl(badge), btn);
        });

        return btn;
    }

    function injectButton() {
        document.querySelectorAll('.playbackSoundBadge').forEach((badge) => {
            try {
                if (badge.hasAttribute(DONE_ATTR)) return;
                const actions = badge.querySelector('.playbackSoundBadge__actions');
                if (!actions) return;
                badge.setAttribute(DONE_ATTR, 'true');
                actions.appendChild(buildButton(badge));
            } catch (err) {
                // one bad badge can't kill the rest
            }
        });
    }

    const observer = VibeExt.createThrottledObserver(injectButton);
    observer.observe(document.body, { childList: true, subtree: true });

    injectButton();
})();

// VibeDownloader — SoundCloud set / album / playlist button
// Handles:
//   - Detail pages: soundcloud.com/.../sets/...  (single button)
//   - Search pages: soundcloud.com/search/{albums,sets,playlists,...}?q=...
//     (a button on EVERY result tile's Like/Repost/Share toolbar)
// Albums and playlists both live under /{user}/sets/{slug} on SoundCloud,
// so matching links by /sets/ (and /albums/) covers both.
(function() {
    'use strict';

    if (window.__vibedownloaderScSetInjected) return;
    window.__vibedownloaderScSetInjected = true;

    const BTN_CLASS = 'vibedownloader-sc-album-btn';
    const DONE_ATTR = 'data-vibedownloader-done';

    function isSetDetailPage() {
        return /\/sets\//.test(window.location.pathname) || /\/albums\//.test(window.location.pathname);
    }

    // A real set/album link lives at /{user}/sets/{slug} (pathname only).
    // Track links look like /dusk-of-the-doors?in=user/sets/slug and must NOT
    // match even though their query string contains "/sets/".
    function isSetHref(href) {
        try {
            const url = new URL(href, window.location.origin);
            return /\/sets\//.test(url.pathname) || /\/albums\//.test(url.pathname);
        } catch (e) {
            return false;
        }
    }

    // The authoritative URL for the set currently being viewed: the header
    // title link (soundTitle__title) — falls back to canonical, then to the
    // current page URL (query params stripped).
    function getCurrentSetUrl() {
        const titleLink = Array.from(document.querySelectorAll('.soundTitle__title[href*="/sets/"], .soundTitle__title[href*="/albums/"]'))
            .find((l) => isSetHref(l.getAttribute('href')));
        if (titleLink) {
            const u = absolutize(titleLink.getAttribute('href'));
            if (u) return u;
        }
        const canonical = document.querySelector('link[rel="canonical"]');
        if (canonical) {
            const c = canonical.getAttribute('href');
            if (c && (c.includes('/sets/') || c.includes('/albums/'))) return c;
        }
        return window.location.origin + window.location.pathname;
    }

    // Walk up from a toolbar to find the nearest container that also holds
    // the set/album link for that tile. Only true /sets/ or /albums/ path
    // links count; ?in=.../sets/... track links are filtered out by isSetHref.
    function findSetLink(toolbar) {
        let el = toolbar;
        for (let i = 0; i < 6 && el; i++) {
            const link = Array.from(el.querySelectorAll('a[href*="/sets/"], a[href*="/albums/"]')).find((a) =>
                isSetHref(a.getAttribute('href'))
            );
            if (link) return { link, container: el };
            el = el.parentElement;
        }
        return null;
    }

    function absolutize(href) {
        try {
            return new URL(href, window.location.origin).toString();
        } catch (e) {
            return null;
        }
    }

    function getTileTitle(found) {
        const link = found.link;
        const titleAttr = link.getAttribute('title');
        if (titleAttr && titleAttr.trim()) return titleAttr.trim();
        if (link.textContent.trim()) return link.textContent.trim();
        const heading = found.container.querySelector('h1, h2, h3, h4');
        if (heading && heading.textContent.trim()) return heading.textContent.trim();
        const img = found.container.querySelector('img');
        if (img && img.alt && img.alt.trim()) return img.alt.trim();
        return document.title;
    }

    function getTileThumbnail(found) {
        const img = found.container.querySelector('img');
        if (img && img.src) return img.src.replace(/-t50x50\.png$/, '-t500x500.jpg');
        const art = found.container.querySelector('.sc-artwork[style*="background-image"]');
        if (art) {
            const m = art.getAttribute('style').match(/url\("?([^")]+)"?\)/);
            if (m && m[1]) return m[1].replace(/-t50x50\.png$/, '-t500x500.jpg');
        }
        return '';
    }

    function buildButton(url, title, thumbnail) {
        const btn = document.createElement('button');
        btn.className = BTN_CLASS;
        btn.type = 'button';
        btn.title = 'Download album/playlist with VibeDownloader';
        btn.setAttribute('aria-label', 'Download album/playlist with VibeDownloader');
        btn.appendChild(VibeExt.createSvgIcon(18));

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            VibeExt.sendDownload(url, title, thumbnail, btn);
        });

        return btn;
    }

    function injectOne(toolbar, mainToolbar) {
        if (toolbar.hasAttribute(DONE_ATTR)) return;

        // Track rows inside an album/playlist each carry their own small
        // toolbar (Like/Repost/More for that ONE track) — skip them entirely.
        if (toolbar.classList.contains('soundActions__small')) return;

        let url, title, thumbnail;

        // The detail page's main listen-engagement toolbar downloads the whole
        // set; any OTHER .soundActions on the page resolve their own tile link.
        if (toolbar === mainToolbar) {
            url = getCurrentSetUrl();
            const ogTitle = document.querySelector('meta[property="og:title"]');
            title = ogTitle && ogTitle.getAttribute('content')
                ? ogTitle.getAttribute('content').trim()
                : document.title.replace(' | Free Listening on SoundCloud', '').trim();
            const ogImage = document.querySelector('meta[property="og:image"]');
            thumbnail = ogImage ? ogImage.getAttribute('content') || '' : '';
        } else {
            const found = findSetLink(toolbar);
            if (!found) return; // not a set/album tile (e.g. a track toolbar)
            url = absolutize(found.link.getAttribute('href'));
            if (!url) return;
            title = getTileTitle(found);
            thumbnail = getTileThumbnail(found);
        }

        toolbar.setAttribute(DONE_ATTR, 'true');

        const btn = buildButton(url, title, thumbnail);
        const group = toolbar.querySelector('.sc-button-group');
        if (group) {
            group.insertAdjacentElement('afterend', btn);
        } else {
            toolbar.appendChild(btn);
        }
    }

    function injectButtons() {
        const mainToolbar = isSetDetailPage()
            ? (document.querySelector('.sound__soundActions .soundActions')
                || document.querySelector('.soundActions.listenEngagement__actions')
                || document.querySelector('.soundActions:not(.soundActions__small)'))
            : null;
        document.querySelectorAll('.soundActions').forEach((toolbar) => {
            try {
                injectOne(toolbar, mainToolbar);
            } catch (err) {
                // one bad tile can't kill the rest
            }
        });
    }

    const observer = VibeExt.createThrottledObserver(injectButtons);
    observer.observe(document.body, { childList: true, subtree: true });

    injectButtons();
})();
