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

        return this.connectWebSocket()
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
                finish();
                if (ack && ack.success) {
                    btn.classList.add('vibedownloader-sent');
                    setTimeout(() => btn.classList.remove('vibedownloader-sent'), 2000);
                } else {
                    btn.classList.add('vibedownloader-error');
                    setTimeout(() => btn.classList.remove('vibedownloader-error'), 2000);
                }
            })
            .catch(() => {
                finish();
                btn.classList.add('vibedownloader-error');
                this.showToast('VibeDownloader app is not running — open it first');
                setTimeout(() => btn.classList.remove('vibedownloader-error'), 2000);
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
