// VibeDownloader — Spotify clipboard hook (MAIN world)
//
// Must run in the page's own JS world to see Spotify's actual
// navigator.clipboard.writeText() calls — an ISOLATED-world content script
// has its own separate navigator/Clipboard objects and can only see writes
// made by the extension itself, never the page's own writes. The Clipboard
// API also never dispatches a native 'copy' DOM event, so there is no
// document-level listener that could catch this either.
//
// This file is injected via <script src="chrome-extension://..."> from
// spotify-bootstrap.js. Spotify's CSP blocks MAIN-world *inline* injection
// but whitelists the extension origin as a script source, so the external
// load executes in the MAIN world legally.
//
// Captured writes are forwarded to the ISOLATED-world scripts (spotify.js)
// via window.postMessage — that bridge crosses worlds correctly.

(function() {
    'use strict';

    if (window.__vibedownloaderSpotifyClipboardHook) return;
    window.__vibedownloaderSpotifyClipboardHook = true;

    function post(msg) {
        try {
            window.postMessage(Object.assign({ source: 'vibedownloader-spotify-hook' }, msg), '*');
        } catch (_) {}
    }

    try {
        const clip = navigator.clipboard;
        if (clip && clip.writeText) {
            const orig = clip.writeText.bind(clip);
            clip.writeText = function(text) {
                try { post({ type: 'copied', text: String(text) }); } catch (_) {}
                return orig.apply(this, arguments);
            };
        }
    } catch (_) {}

    // Suppress Spotify's own "Link copied to clipboard" toast — but ONLY
    // during a short window right after WE simulate the Copy Link click, not
    // for copies the user triggers themselves (those should keep Spotify's
    // normal toast). Class names are hashed/unstable, so we match on the
    // toast's actual text instead of any CSS selector.
    let suppressToastUntil = 0;

    window.addEventListener('vibedownloader-suppress-toast', () => {
        suppressToastUntil = Date.now() + 1500; // 1.5s window covers the toast's mount delay
    });

    try {
        const observeToasts = () => {
            const target = document.body || document.documentElement;
            if (!target) return;
            const toastObserver = new MutationObserver((mutations) => {
                if (Date.now() > suppressToastUntil) return; // outside our window — let it show
                for (const m of mutations) {
                    for (const node of m.addedNodes) {
                        if (node.nodeType !== 1) continue;
                        const text = node.textContent || '';
                        if (/copied to clipboard/i.test(text)) {
                            node.style.display = 'none';
                        }
                    }
                }
            });
            toastObserver.observe(target, { childList: true, subtree: true });
        };
        if (document.body) {
            observeToasts();
        } else {
            document.addEventListener('DOMContentLoaded', observeToasts);
        }
    } catch (_) {}
})();
