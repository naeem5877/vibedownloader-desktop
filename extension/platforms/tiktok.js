// VibeDownloader — TikTok support (feed + browse/detail pages)
(function() {
    'use strict';

    if (window.__vibedownloaderTiktokInjected) return;
    window.__vibedownloaderTiktokInjected = true;

    const ITEM_CLASS = 'vibedownloader-tt-item';
    const BTN_CLASS = 'vibedownloader-tt-btn';

    // ---------- Hydration JSON: generic deep search ----------
    function collectItemStructs(node, out, depth) {
        if (!node || typeof node !== 'object' || depth > 12) return;
        if (
            typeof node.id === 'string' &&
            typeof node.desc === 'string' &&
            node.author && typeof node.author.uniqueId === 'string' &&
            node.video && typeof node.video === 'object'
        ) {
            out.push(node);
            return;
        }
        for (const key in node) {
            const val = node[key];
            if (val && typeof val === 'object') {
                collectItemStructs(val, out, depth + 1);
            }
        }
    }

    function getAllHydrationItems() {
        try {
            const script = document.querySelector('script[id="__UNIVERSAL_DATA_FOR_REHYDRATION__"]');
            if (!script || !script.textContent) return [];
            const data = JSON.parse(script.textContent);
            const out = [];
            collectItemStructs(data, out, 0);
            return out;
        } catch (e) {
            return [];
        }
    }

    function itemToData(item) {
        const username = item.author.uniqueId || item.author.nickname || '';
        const url = `https://www.tiktok.com/@${username}/video/${item.id}`;
        return {
            url,
            title: item.desc || document.title.replace(' | TikTok', '').trim(),
            thumbnail: item.video.cover || item.video.originCover || item.video.dynamicCover || ''
        };
    }

    // ---------- DOM helpers ----------
    function findItemRoot(el) {
        for (let i = 0; i < 10 && el; i++) {
            if (el.querySelector && el.querySelector('video')) return el;
            el = el.parentElement;
        }
        return null;
    }

    function usernameFromItemRoot(itemRoot) {
        if (!itemRoot) return null;
        const avatar = itemRoot.querySelector('[data-e2e="video-author-avatar"], a[href^="/@"]');
        if (avatar) {
            const href = avatar.getAttribute('href') || '';
            const m = href.match(/^\/@([^/?]+)/);
            if (m) return m[1];
        }
        return null;
    }

    function usernameFromUrl() {
        const m = window.location.pathname.match(/^\/@([^/?]+)\/video\/(\d+)/);
        return m ? { username: m[1], videoId: m[2] } : null;
    }

    function getVideoData(iconEl) {
        // 1. Direct URL match (/@user/video/123 pages)
        const direct = usernameFromUrl();
        if (direct) {
            const items = getAllHydrationItems();
            const match = items.find(it => it.id === direct.videoId) ||
                          items.find(it => it.author.uniqueId === direct.username);
            if (match) return itemToData(match);
            return {
                url: window.location.href.split('?')[0],
                title: document.title.replace(' | TikTok', '').trim(),
                thumbnail: document.querySelector('meta[property="og:image"]')?.content || ''
            };
        }

        // 2. Feed page: match DOM item to hydration item by username
        const itemRoot = findItemRoot(iconEl);
        const username = usernameFromItemRoot(itemRoot);
        if (username) {
            const items = getAllHydrationItems();
            const match = items.find(it => it.author.uniqueId === username);
            if (match) return itemToData(match);
        }

        return null;
    }

    // ---------- Button injection ----------
    function makeButton(getData) {
        const item = document.createElement('div');
        item.className = ITEM_CLASS;

        const btn = document.createElement('button');
        btn.className = BTN_CLASS;
        btn.title = 'Download with VibeDownloader';
        btn.appendChild(VibeExt.createSvgIcon(24));

        const label = document.createElement('span');
        label.className = 'vibedownloader-tt-label';
        label.textContent = 'Get';

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const data = getData();
            if (!data || !data.url || !/\/@[^/]+\/video\/\d+/.test(data.url)) {
                btn.classList.add('vibedownloader-error');
                setTimeout(() => btn.classList.remove('vibedownloader-error'), 2000);
                return;
            }
            VibeExt.sendDownload(data.url, data.title, data.thumbnail, btn);
        });

        item.appendChild(btn);
        item.appendChild(label);
        return item;
    }

    function injectAll() {
        // Feed variant (For You / Explore scrolling feed)
        document.querySelectorAll('[data-e2e="share-icon"]').forEach(icon => {
            const wrapper = icon.closest('[class*="ButtonActionItemV1"]') || icon.parentElement;
            if (!wrapper) return;

            // Per-anchor idempotency guard — same pattern as Instagram
            if (wrapper.nextElementSibling?.classList.contains(ITEM_CLASS)) return;

            const el = makeButton(() => getVideoData(icon));
            wrapper.insertAdjacentElement('afterend', el);
        });

        // Browse/detail variant (single video page right panel)
        document.querySelectorAll('[data-e2e="browse-share-group"]').forEach(group => {
            if (group.nextElementSibling?.classList.contains(ITEM_CLASS)) return;

            const el = makeButton(() => getVideoData(group));
            group.insertAdjacentElement('afterend', el);
        });
    }

    const observer = VibeExt.createThrottledObserver(injectAll);
    observer.observe(document.body, { childList: true, subtree: true });

    injectAll();
})();
