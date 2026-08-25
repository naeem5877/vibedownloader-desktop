// VibeDownloader — Facebook support (feed videos + reels)
(function() {
    'use strict';

    if (window.__vibedownloaderFbInjected) return;
    window.__vibedownloaderFbInjected = true;

    const FB_BTN_CLASS = 'vibedownloader-fb-btn';
    const DONE_ATTR = 'data-vibedownloader-done';

    function findShareAnchor(root) {
        return root.querySelector('[data-ad-rendering-role="share_button"]');
    }

    function findRowOrRail(shareRoleDiv) {
        let clickable = shareRoleDiv.closest('[role="button"][aria-label]');
        if (!clickable) return null;

        let current = clickable.parentElement;
        for (let i = 0; i < 8 && current; i++) {
            const likeBtn = current.querySelector('[aria-label="Like"]');
            const commentBtn = current.querySelector('[aria-label*="omment" i]');
            if (likeBtn && commentBtn && current.contains(clickable)) {
                const direction = getComputedStyle(current).flexDirection;
                const isColumn = direction === 'column' || direction === 'column-reverse';
                return { container: current, clickableShare: clickable, isColumn };
            }
            current = current.parentElement;
        }
        return null;
    }

    function findPostCard(scope) {
        let current = scope;
        for (let i = 0; i < 10 && current && current.parentElement; i++) {
            current = current.parentElement;
            const video = current.querySelector('video');
            // Author links may be relative (/user) OR absolute
            // (https://www.facebook.com/user) depending on render path.
            const followLink = current.querySelector('a[href^="/"], a[href^="https://www.facebook.com/"]');
            if (video && followLink) {
                return current;
            }
        }
        return null;
    }

    function hasVideo(scope) {
        const article = scope.closest('[role="article"]');
        if (article) return !!article.querySelector('video');

        const card = findPostCard(scope);
        if (card) return !!card.querySelector('video');

        // No reliable boundary found — fail closed. Falling back to
        // document would match a video from a completely different post.
        return false;
    }

    function getPostUrl(scope) {
        if (/\/reel\/\d+/.test(window.location.pathname)) {
            return window.location.href.split('?')[0];
        }

        const card = scope.closest('[role="article"]') || findPostCard(scope);
        if (!card) return null;

        const videoIdEl = card.querySelector('[data-video-id]');
        if (videoIdEl) {
            const videoId = videoIdEl.getAttribute('data-video-id');
            if (videoId) return `https://www.facebook.com/watch/?v=${videoId}`;
        }

        let linkEl = card.querySelector(
            'a[href*="/videos/"], a[href*="/reel/"], a[href*="/watch/"], a[href*="/posts/"], a[href*="/stories/"]'
        );
        if (!linkEl) {
            linkEl = Array.from(card.querySelectorAll('a[href]')).find(a => {
                const href = a.getAttribute('href') || '';
                return /permalink\.php|\/videos\/\d+|\/posts\/|\/stories\/|story_fbid=/.test(href);
            });
        }
        if (linkEl) {
            try {
                const url = new URL(linkEl.getAttribute('href'), window.location.origin);
                url.search = '';
                if (url.pathname !== '/' && url.pathname !== '') return url.href;
            } catch (e) {}
        }

        return null;
    }

    function buildButton(scope, variant) {
        const btn = document.createElement('button');
        btn.className = `${FB_BTN_CLASS} vibedownloader-fb-btn--${variant}`;
        btn.title = 'Download with VibeDownloader';
        btn.appendChild(VibeExt.createSvgIcon(16));

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const article = scope.closest('[role="article"]') || document;
            const videoEl = article.querySelector('video');
            const ogImage = document.querySelector('meta[property="og:image"]');
            const url = getPostUrl(scope);

            if (!url) {
                btn.classList.add('vibedownloader-error');
                setTimeout(() => btn.classList.remove('vibedownloader-error'), 2000);
                return;
            }

            VibeExt.sendDownload(
                url,
                document.title.replace(' | Facebook', '').trim(),
                videoEl?.poster || (ogImage ? ogImage.getAttribute('content') || '' : ''),
                btn
            );
        });

        return btn;
    }

    function injectOne(shareRoleDiv) {
        const found = findRowOrRail(shareRoleDiv);
        if (!found) return;

        const container = found.container;
        if (container.hasAttribute(DONE_ATTR)) return;

        // Facebook lazy-loads <video> AFTER the post shell renders, so on the
        // first pass a real video post can look video-less. Retry on later
        // observer passes for a few seconds before giving up, so slow-loading
        // videos still get their download button.
        if (!hasVideo(container)) {
            const tries = Number(container.dataset.vibeRetries || 0) + 1;
            container.dataset.vibeRetries = String(tries);
            if (tries < 12) return;
            // No video appeared within the window — it's an image post.
            container.setAttribute(DONE_ATTR, 'true');
            return;
        }

        container.setAttribute(DONE_ATTR, 'true');

        // Bare wrapper — NOT a clone of FB's heavy item class (that class
        // reserves icon+count width and was pushing the row to wrap).
        const wrapper = document.createElement('div');
        wrapper.style.display = 'inline-flex';
        wrapper.style.alignItems = 'center';
        wrapper.style.flexShrink = '0';

        wrapper.appendChild(buildButton(found.container, found.isColumn ? 'stacked' : 'inline'));

        // Insert after Share's OWN container (its parent), not after the
    // clickable div itself — that container was sized for a single
    // child, which is why the button was wrapping inside it.
    const shareContainer = found.clickableShare.parentElement;
    shareContainer.insertAdjacentElement('afterend', wrapper);
    }

    function injectFacebookButtons() {
        // Detect Share by data-attribute (home feed) or direct aria-label (reels template)
        const byRole = Array.from(document.querySelectorAll('[data-ad-rendering-role="share_button"]'));
        const byAriaLabel = Array.from(document.querySelectorAll('[aria-label="Share"]'))
            .filter(el => !byRole.some(r => el.contains(r)));

        [...byRole, ...byAriaLabel].forEach(shareEl => {
            try {
                injectOne(shareEl);
            } catch (err) {
                // one bad post can't kill the rest
            }
        });
    }

    const observer = VibeExt.createThrottledObserver(injectFacebookButtons);
    observer.observe(document.body, { childList: true, subtree: true });

    injectFacebookButtons();
})();
