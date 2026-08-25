// VibeDownloader — YouTube (watch + shorts)
// Handles: youtube.com/watch, youtube.com/shorts, m.youtube.com/*
//
// Watch page:  #top-level-buttons-computed inside ytd-watch-metadata #actions
//              — append button as a child (inline with Like/Share)
//
// Shorts:      reel-action-bar-view-model > button-view-model
//              — find visible bar, insert circular button after Share
//
// Navigation: yt-navigate-finish only, NO MutationObservers (they cause loops).

(function() {
    'use strict';

    const BTN_ID           = 'vibedownloader-btn';
    const SHORTS_CLASS     = 'vibedownloader-shorts-item';
    const SHORTS_BTN_CLASS = 'vibedownloader-shorts-btn';

    let currentUrl       = window.location.href;
    let _watchInjecting  = false;
    let _shortsInjecting = false;

    // ─── Watch page ──────────────────────────────────────────────

    function getWatchVideoData() {
        const url     = window.location.href;
        const titleEl = document.querySelector(
            'h1.ytd-watch-metadata yt-formatted-string, h1.title yt-formatted-string'
        );
        const title = titleEl
            ? titleEl.textContent.trim()
            : document.title.replace(' - YouTube', '').trim();
        return { url, title, thumbnail: VibeExt.getOGThumbnail() };
    }

    function getWatchActionsContainer() {
        return document.querySelector('ytd-watch-metadata #actions #top-level-buttons-computed');
    }

    function injectWatchButton() {
        if (_watchInjecting) return;
        if (document.getElementById(BTN_ID)) return;

        _watchInjecting = true;
        const targetUrl = window.location.href;

        function tryInject(attemptsLeft) {
            if (window.location.href !== targetUrl) { _watchInjecting = false; return; }

            const container = getWatchActionsContainer();
            if (!container || container.children.length === 0) {
                if (attemptsLeft > 0) setTimeout(() => tryInject(attemptsLeft - 1), 200);
                else _watchInjecting = false;
                return;
            }

            if (document.getElementById(BTN_ID)) { _watchInjecting = false; return; }

            const btn = document.createElement('button');
            btn.id        = BTN_ID;
            btn.className = 'vibedownloader-btn';
            btn.title     = 'Download with VibeDownloader';
            btn.appendChild(VibeExt.createSvgIcon());
            const span       = document.createElement('span');
            span.textContent = 'Download';
            btn.appendChild(span);

            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                VibeExt.sendDownload(...Object.values(getWatchVideoData()), btn);
            });

            container.appendChild(btn);
            _watchInjecting = false;
        }

        tryInject(20);
    }

    // ─── Shorts ──────────────────────────────────────────────────

    function getActiveActionBar() {
        const bars = document.querySelectorAll('reel-action-bar-view-model');
        for (const bar of bars) {
            if (bar.offsetParent !== null) return bar;
        }
        return null;
    }

    function findButtonViewModelByAriaLabel(actionBar, label) {
        const candidates = actionBar.querySelectorAll(':scope > button-view-model');
        return Array.from(candidates).find(el =>
            el.querySelector(`button[aria-label="${label}"]`)
        );
    }

    function getShortsVideoData() {
        const url   = window.location.href;
        const title = document.title.replace(' - YouTube', '').trim();
        return { url, title, thumbnail: VibeExt.getOGThumbnail() };
    }

    function injectShortsButton() {
        if (_shortsInjecting) return;

        const existing = document.querySelector(`.${SHORTS_CLASS}`);
        if (existing) return;

        _shortsInjecting = true;
        const targetUrl = window.location.href;

        function tryInject(attemptsLeft) {
            if (window.location.href !== targetUrl) { _shortsInjecting = false; return; }

            const actionBar = getActiveActionBar();
            if (!actionBar) { retry(attemptsLeft); return; }

            const shareItem = findButtonViewModelByAriaLabel(actionBar, 'Share');
            if (!shareItem) { retry(attemptsLeft); return; }

            if (shareItem.nextElementSibling?.classList.contains(SHORTS_CLASS)) {
                _shortsInjecting = false;
                return;
            }

            const item = document.createElement('div');
            item.className = SHORTS_CLASS;

            const btn = document.createElement('button');
            btn.className = SHORTS_BTN_CLASS;
            btn.title     = 'Download with VibeDownloader';
            btn.appendChild(VibeExt.createSvgIcon(24));

            const label       = document.createElement('span');
            label.className   = 'vibedownloader-shorts-label';
            label.textContent = 'Get';

            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                VibeExt.sendDownload(...Object.values(getShortsVideoData()), btn);
            });

            item.appendChild(btn);
            item.appendChild(label);
            shareItem.insertAdjacentElement('afterend', item);
            _shortsInjecting = false;
        }

        function retry(attemptsLeft) {
            if (attemptsLeft > 0) setTimeout(() => tryInject(attemptsLeft - 1), 200);
            else _shortsInjecting = false;
        }

        tryInject(20);
    }

    // ─── Route & navigation ───────────────────────────────────────

    function route() {
        if (window.location.pathname === '/watch') {
            injectWatchButton();
        } else if (window.location.pathname.startsWith('/shorts/')) {
            injectShortsButton();
        }
    }

    function onNavigate() {
        _watchInjecting  = false;
        _shortsInjecting = false;
        currentUrl       = window.location.href;
        route();
    }

    // yt-navigate-finish: YouTube's SPA event, fires on every navigation AND
    // same-page data refreshes.  We respond IMMEDIATELY (no debounce) so the
    // gap between Polymer removing content and us re-injecting is < 1 frame.
    window.addEventListener('yt-navigate-finish', () => {
        if (window.location.href !== currentUrl) {
            onNavigate();
        } else {
            // Same URL: data refresh or Polymer re-render — re-check idempotently.
            _watchInjecting  = false;
            _shortsInjecting = false;
            route();
        }
    });

    // Initial page load.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onNavigate);
    } else {
        onNavigate();
    }
})();
