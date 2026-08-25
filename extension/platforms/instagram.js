// VibeDownloader — Instagram support (video posts + reels only)
(function() {
    'use strict';

    if (window.__vibedownloaderIgInjected) return;
    window.__vibedownloaderIgInjected = true;

    const IG_BTN_CLASS = 'vibedownloader-ig-btn';
    const DONE_ATTR = 'data-vibedownloader-done';

    function svgWithLabel(root, pattern) {
        return Array.from(root.querySelectorAll('svg[aria-label]'))
            .find(svg => pattern.test(svg.getAttribute('aria-label')));
    }

    // Strategy 1: home-feed horizontal row (Like+Share present, no Save)
    function findActionRow(shareSvg) {
        let current = shareSvg.parentElement;
        for (let i = 0; i < 8 && current; i++) {
            const hasLike = svgWithLabel(current, /^like/i);
            const hasShare = svgWithLabel(current, /^share/i);
            const hasSave = svgWithLabel(current, /save/i);
            if (hasLike && hasShare && !hasSave) return { type: 'row', el: current };
            current = current.parentElement;
        }
        return null;
    }

    // Single detection: find the container both Share and Save live in,
    // then decide row vs column from its REAL computed flex-direction —
    // no more guessing via two competing pattern-matchers.
    function findShareSaveContainer(shareSvg) {
        let current = shareSvg.parentElement;
        for (let i = 0; i < 8 && current; i++) {
            const saveSvg = svgWithLabel(current, /save/i);
            if (saveSvg) {
                const shareWrapper = Array.from(current.children).find(child => child.contains(shareSvg));
                const saveWrapper = Array.from(current.children).find(child => child.contains(saveSvg));
                if (shareWrapper && saveWrapper) {
                    const direction = getComputedStyle(current).flexDirection;
                    const isColumn = direction === 'column' || direction === 'column-reverse';
                    return { el: current, shareWrapper, saveWrapper, isColumn };
                }
            }
            current = current.parentElement;
        }
        return null;
    }

    function getPostUrl(scope) {
        const article = scope.closest('article') || document;
        const linkEl = article.querySelector('a[href*="/p/"], a[href*="/reel/"], a[href*="/tv/"]');
        if (linkEl) {
            try {
                return new URL(linkEl.getAttribute('href'), window.location.origin).href;
            } catch (e) {}
        }
        return window.location.href;
    }

    function hasVideo(scope) {
        const article = scope.closest('article') || document;
        return !!article.querySelector('video');
    }



    function buildButton(scope, variant) {
        const btn = document.createElement('button');
        btn.className = `${IG_BTN_CLASS} vibedownloader-ig-btn--${variant}`;
        btn.title = 'Download with VibeDownloader';
        btn.appendChild(VibeExt.createSvgIcon(16));

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const article = scope.closest('article') || document;
            const videoEl = article.querySelector('video');
            const ogImage = document.querySelector('meta[property="og:image"]');

            VibeExt.sendDownload(
                getPostUrl(scope),
                document.title.replace(' • Instagram', '').trim(),
                videoEl?.poster || (ogImage ? ogImage.getAttribute('content') || '' : ''),
                btn
            );
        });

        return btn;
    }

    function injectOne(shareSvg) {
        const row = findActionRow(shareSvg);
        if (row) {
            if (row.el.querySelector(`.${IG_BTN_CLASS}`)) return;
            if (!hasVideo(row.el)) return;
            row.el.appendChild(buildButton(row.el, 'inline'));
            return;
        }

        const found = findShareSaveContainer(shareSvg);
        if (found) {
            if (found.el.querySelector(`.${IG_BTN_CLASS}`)) return;
            if (!hasVideo(found.el)) return;

            if (found.isColumn) {
                const wrapper = document.createElement('div');
                wrapper.className = found.saveWrapper.className;
                wrapper.appendChild(buildButton(found.el, 'stacked'));
                found.saveWrapper.insertAdjacentElement('afterend', wrapper);
            } else {
                const wrapper = document.createElement('div');
                wrapper.className = found.shareWrapper.className;
                wrapper.appendChild(buildButton(found.el, 'inline'));
                found.shareWrapper.insertAdjacentElement('afterend', wrapper);
            }
        }
    }

    function injectInstagramButton() {
        const shareSvgs = Array.from(document.querySelectorAll('svg[aria-label]'))
            .filter(svg => /^share/i.test(svg.getAttribute('aria-label')));

        shareSvgs.forEach(shareSvg => {
            try {
                injectOne(shareSvg);
            } catch (err) {
                // one bad post can't kill the rest
            }
        });
    }

    const observer = VibeExt.createThrottledObserver(injectInstagramButton);
    observer.observe(document.body, { childList: true, subtree: true });

    injectInstagramButton();
})();
