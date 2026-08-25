// VibeDownloader — X / Twitter
// Handles: x.com, twitter.com
//
// Adds a download button to every tweet action bar (the reply/retweet/
// like/views/bookmark/share row). The bar is a <div role="group"> whose
// aria-label lists the counts (e.g. "1487 replies, 991 reposts, ..."); we
// anchor on the stable [data-testid="bookmark"] button and walk up to it.
// The canonical tweet URL comes from the timestamp link inside the article.

(function() {
    'use strict';

    if (window.__vibedownloaderXInjected) return;
    window.__vibedownloaderXInjected = true;

    const BTN_CLASS = 'vibedownloader-x-btn';
    const DONE_ATTR = 'data-vibedownloader-done';

    function getTweetUrl(scope) {
        const article = scope.closest('article') || document;
        // The timestamp is inside the canonical status link
        const timeLink = article.querySelector('a[href*="/status/"] time');
        const link = timeLink ? timeLink.closest('a') : article.querySelector('a[href*="/status/"]');
        if (link) {
            try {
                return new URL(link.getAttribute('href'), window.location.origin).href;
            } catch (e) {}
        }
        return window.location.href;
    }

    function getTweetTitle(scope) {
        const article = scope.closest('article') || document;
        const text = article.querySelector('[data-testid="tweetText"]');
        if (text && text.textContent.trim()) return text.textContent.trim();
        return document.title.replace(' / X', '').replace(' / Twitter', '').trim();
    }

    function getTweetThumbnail(scope) {
        const article = scope.closest('article') || document;
        const video = article.querySelector('video[poster]');
        if (video) return video.getAttribute('poster') || '';
        const img = article.querySelector('img[src*="pbs.twimg.com"]');
        if (img && img.src) return img.src;
        const og = document.querySelector('meta[property="og:image"]');
        return og ? og.getAttribute('content') || '' : '';
    }

    function buildButton(scope) {
        const btn = document.createElement('button');
        btn.className = BTN_CLASS;
        btn.type = 'button';
        btn.title = 'Download with VibeDownloader';
        btn.setAttribute('aria-label', 'Download with VibeDownloader');
        btn.appendChild(VibeExt.createSvgIcon(18));

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            VibeExt.sendDownload(getTweetUrl(scope), getTweetTitle(scope), getTweetThumbnail(scope), btn);
        });

        return btn;
    }

    function hasVideo(scope) {
        const article = scope.closest('article') || document;
        return !!article.querySelector('video');
    }

    function injectOne(bookmarkBtn) {
        const group = bookmarkBtn.closest('[role="group"]');
        if (!group || group.hasAttribute(DONE_ATTR)) return;
        // Make sure this is a real tweet action bar (has a Like button)
        if (!group.querySelector('[data-testid="like"]')) return;
        if (!hasVideo(group)) return;
        group.setAttribute(DONE_ATTR, 'true');
        group.appendChild(buildButton(group));
    }

    function injectXButton() {
        document.querySelectorAll('button[data-testid="bookmark"]').forEach((bm) => {
            try {
                injectOne(bm);
            } catch (err) {
                // one bad tweet can't kill the rest
            }
        });
    }

    const observer = VibeExt.createThrottledObserver(injectXButton);
    observer.observe(document.body, { childList: true, subtree: true });

    injectXButton();
})();
