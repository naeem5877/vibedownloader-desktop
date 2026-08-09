// VibeDownloader — YouTube (watch + shorts)
// Handles: youtube.com/watch, youtube.com/shorts, m.youtube.com/*
//
// Watch page:  #top-level-buttons-computed inside ytd-watch-metadata #actions
//              — append button as a child (inline with Like/Share)
//
// Shorts:      reel-action-bar-view-model > button-view-model
//              — find visible bar, insert circular button after Share

(function() {
    'use strict';

    const BTN_ID = 'vibedownloader-btn';
    const SHORTS_BTN_CLASS = 'vibedownloader-shorts-btn';

    // ─── Watch page ──────────────────────────────────────────────

    function getWatchVideoData() {
        const url = window.location.href;
        const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, h1.title yt-formatted-string');
        const title = titleEl ? titleEl.textContent.trim() : document.title.replace(' - YouTube', '').trim();
        return { url, title, thumbnail: VibeExt.getOGThumbnail() };
    }

    function getWatchActionsContainer() {
        return document.querySelector('ytd-watch-metadata #actions #top-level-buttons-computed');
    }

    function injectWatchButton() {
        const container = getWatchActionsContainer();
        if (!container || container.children.length === 0) return;
        if (container.querySelector(`#${BTN_ID}`)) return;

        const btn = document.createElement('button');
        btn.id = BTN_ID;
        btn.className = 'vibedownloader-btn';
        btn.appendChild(VibeExt.createSvgIcon());
        const span = document.createElement('span');
        span.textContent = 'Download';
        btn.appendChild(span);
        btn.title = 'Download with VibeDownloader';

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            VibeExt.sendDownload(...Object.values(getWatchVideoData()), btn);
        });

        container.appendChild(btn);
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
        const url = window.location.href;
        const title = document.title.replace(' - YouTube', '').trim();
        return { url, title, thumbnail: VibeExt.getOGThumbnail() };
    }

    function injectShortsButton() {
        const actionBar = getActiveActionBar();
        if (!actionBar) return;

        const shareItem = findButtonViewModelByAriaLabel(actionBar, 'Share');
        if (!shareItem) return;

        if (shareItem.nextElementSibling?.classList.contains('vibedownloader-shorts-item')) return;

        document.querySelectorAll('.vibedownloader-shorts-item').forEach(el => el.remove());

        const item = document.createElement('div');
        item.className = 'vibedownloader-shorts-item';

        const btn = document.createElement('button');
        btn.className = SHORTS_BTN_CLASS;
        btn.title = 'Download with VibeDownloader';
        btn.appendChild(VibeExt.createSvgIcon(24));

        const label = document.createElement('span');
        label.className = 'vibedownloader-shorts-label';
        label.textContent = 'Get';

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            VibeExt.sendDownload(...Object.values(getShortsVideoData()), btn);
        });

        item.appendChild(btn);
        item.appendChild(label);
        shareItem.insertAdjacentElement('afterend', item);
    }

    // ─── Router ──────────────────────────────────────────────────

    function route() {
        if (window.location.pathname === '/watch') {
            injectWatchButton();
        } else if (window.location.pathname.startsWith('/shorts/')) {
            injectShortsButton();
        }
    }

    const observer = VibeExt.createThrottledObserver(route);
    observer.observe(document.body, { childList: true, subtree: true });

    route();
})();
