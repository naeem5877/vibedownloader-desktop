// VibeDownloader — Spotify MAIN-world hook bootstrap (ISOLATED world, document_start)
//
// MV3 `world: "MAIN"` content scripts are injected as INLINE scripts, which
// Spotify's CSP blocks ('unsafe-inline' is not allowed). Instead we load the
// MAIN-world hook (spotify-clipboard-hook.js) as an EXTERNAL script via a
// <script src> tag: Chrome automatically whitelists chrome-extension://<id>/
// in the page's script-src, so the tag executes in the MAIN world without any
// CSP violation.

(function() {
    if (window.__vibedownloaderSpotifyBootstrap) return;
    window.__vibedownloaderSpotifyBootstrap = true;

    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('platforms/spotify-clipboard-hook.js');
    s.async = false;
    (document.head || document.documentElement).appendChild(s);
})();
