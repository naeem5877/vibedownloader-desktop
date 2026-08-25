// VibeDownloader Extension — Shared utilities
// Common functions used by all platform scripts.
//
// IMPORTANT: Downloads are sent DIRECTLY from the content script to the
// desktop app over its own WebSocket. We do NOT route through the MV3
// service worker: Chrome kills the SW when idle, which invalidates
// `chrome.runtime.sendMessage` on any open page ("Extension context
// invalidated") and breaks every platform button.

const VibeExt = {
    // Lazily opened WebSocket to the desktop app (127.0.0.1:13579).
    _ws: null,
    _pending: null, // single in-flight request (one user click at a time)

    connectWebSocket() {
        if (this._ws && this._ws.readyState === WebSocket.OPEN) {
            return Promise.resolve();
        }
        if (this._connecting) return this._connecting;

        this._connecting = new Promise((resolve, reject) => {
            try {
                const ws = new WebSocket('ws://127.0.0.1:13579');
                this._ws = ws;

                ws.onopen = () => {
                    this._connecting = null;
                    resolve();
                };
                ws.onerror = () => {
                    this._connecting = null;
                    this._ws = null;
                    reject(new Error('app-not-running'));
                };
                ws.onmessage = (e) => {
                    try {
                        const msg = JSON.parse(e.data);
                        if (msg.type === 'ack' && this._pending) {
                            const p = this._pending;
                            this._pending = null;
                            p.resolve(msg);
                        }
                    } catch (_) {}
                };
                ws.onclose = () => {
                    this._connecting = null;
                    this._ws = null;
                    if (this._pending) {
                        const p = this._pending;
                        this._pending = null;
                        p.reject(new Error('app-not-running'));
                    }
                };
            } catch (e) {
                this._connecting = null;
                reject(e);
            }
        });
        return this._connecting;
    },

    sendToApp(payload, btn) {
        btn.classList.add('vibedownloader-sending');
        const finish = () => btn.classList.remove('vibedownloader-sending');
        const flashSent = () => {
            btn.classList.add('vibedownloader-sent');
            setTimeout(() => btn.classList.remove('vibedownloader-sent'), 2000);
        };
        const flashError = () => {
            btn.classList.add('vibedownloader-error');
            setTimeout(() => btn.classList.remove('vibedownloader-error'), 2000);
        };

        // Safety: always re-enable the button after 15 s no matter what,
        // so a dropped WebSocket can never leave it permanently unclickable.
        const safetyTimer = setTimeout(() => { finish(); }, 15000);

        const doSend = () => this.connectWebSocket()
            .then(() => {
                return new Promise((resolve, reject) => {
                    this._pending = { resolve, reject };
                    try {
                        this._ws.send(JSON.stringify(payload));
                    } catch (e) {
                        this._pending = null;
                        reject(e);
                    }
                });
            })
            .then((ack) => {
                clearTimeout(safetyTimer);
                finish();
                if (ack && ack.success) flashSent();
                else flashError();
            });

        return doSend().catch(() => {
            // App isn't running. Ask the background SW to launch it through the
            // native host, wait for its WebSocket to come up, then resend.
            this._pending = null;
            return this.launchAppAndWait()
                .then(() => doSend())
                .catch(() => {
                    clearTimeout(safetyTimer);
                    finish();
                    flashError();
                    this.showToast('VibeDownloader app is not running — open it first');
                });
        });
    },

    // Ask the MV3 background worker to start the desktop app via Native
    // Messaging (content scripts can't call chrome.runtime.connectNative).
    // If that fails (host forbidden/not found, SW asleep), fall back to firing
    // the vibedownloader:// protocol, which Windows resolves to the app exe.
    launchApp() {
        return new Promise((resolve) => {
            let settled = false;
            const done = (v) => { if (!settled) { settled = true; resolve(v); } };
            const tryProtocol = () => done(this.launchViaProtocol());
            try {
                chrome.runtime.sendMessage({ type: 'launch-app' }, (res) => {
                    if (res && res.launched) return done(true);
                    tryProtocol();
                });
            } catch (e) {
                tryProtocol();
            }
            // SW can be suspended/restarting and never answer — fire the
            // protocol anyway after a short grace period.
            setTimeout(tryProtocol, 1500);
        });
    },

    launchViaProtocol() {
        try {
            const f = document.createElement('iframe');
            f.style.display = 'none';
            f.setAttribute('aria-hidden', 'true');
            f.src = 'vibedownloader://launch';
            document.documentElement.appendChild(f);
            setTimeout(() => f.remove(), 5000);
            return true;
        } catch (e) {
            return false;
        }
    },

    // Fire the launch request, then poll the WebSocket until the app boots.
    // If the launch itself failed (app not installed) reject right away.
    // Falls back to rejecting after maxAttempts so we don't spin forever.
    launchAppAndWait(maxAttempts = 14, delayMs = 1200) {
        return new Promise((resolve, reject) => {
            this.launchApp().then((launched) => {
                if (!launched) return reject(new Error('app-not-running'));
                let attempts = 0;
                const attempt = () => {
                    attempts++;
                    this.connectWebSocket()
                        .then(() => resolve())
                        .catch(() => {
                            if (attempts >= maxAttempts) reject(new Error('app-not-running'));
                            else setTimeout(attempt, delayMs);
                        });
                };
                attempt();
            });
        });
    },

    sendDownload(url, title, thumbnail, btn) {
        return this.sendToApp({
            type: 'download-url',
            url,
            title: title || '',
            thumbnail: thumbnail || ''
        }, btn);
    },

    // Spotify doesn't expose the track ID in the DOM, so this path sends
    // title/artist and lets the desktop app search YouTube directly.
    sendSpotifySearch(searchQuery, title, artist, thumbnail, btn) {
        return this.sendToApp({
            type: 'download-spotify',
            searchQuery,
            title: title || '',
            artist: artist || '',
            thumbnail: thumbnail || ''
        }, btn);
    },

    getOGThumbnail() {
        try {
            const meta = document.querySelector('meta[property="og:image"]');
            return meta ? meta.content : '';
        } catch (_) {
            return '';
        }
    },

    createThrottledObserver(callback, delay = 300) {
        let queued = false;
        const observer = new MutationObserver(() => {
            if (queued) return;
            queued = true;
            setTimeout(() => {
                queued = false;
                callback();
            }, delay);
        });
        return observer;
    },

    showToast(message) {
        try {
            if (document.querySelector('.vibedownloader-toast')) return;
            const toast = document.createElement('div');
            toast.className = 'vibedownloader-toast';
            toast.textContent = message;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 4000);
        } catch (_) {}
    },

    createSvgIcon(size = 20) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', size);
        svg.setAttribute('height', size);
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.innerHTML = [
            '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>',
            '<polyline points="7 10 12 15 17 10"></polyline>',
            '<line x1="12" y1="15" x2="12" y2="3"></line>'
        ].join('');
        return svg;
    }
};
