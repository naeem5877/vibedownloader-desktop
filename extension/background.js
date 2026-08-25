// VibeDownloader Extension — Background Service Worker
//
// WebSocket connection policy:
//   We NEVER connect proactively. connectWebSocket() is only called when the
//   user clicks a Download button (via content script message) or when the
//   popup explicitly asks.  This prevents the ERR_CONNECTION_REFUSED console
//   error that appears when the extension loads but the desktop app is closed.
//
//   Chrome logs a network-level ERR_CONNECTION_REFUSED for every WebSocket
//   that fails to connect — there is no way to suppress it in JS.  The only
//   solution is to not attempt the connection until we know (or hope) the
//   app is running.

const WS_URL = 'ws://127.0.0.1:13579';

let ws              = null;
let _connecting     = false;   // prevents concurrent connect attempts
let _pingTimer      = null;
let _pendingAcks    = new Map();
let _ackId          = 0;

// ─── WebSocket lifecycle ──────────────────────────────────────────────────

function connectWebSocket() {
    // Already open — nothing to do.
    if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve();
    // Already connecting — return the in-flight promise.
    if (_connecting) return _connecting;

    _connecting = new Promise((resolve, reject) => {
        let settled = false;
        function settle(ok, err) {
            if (settled) return;
            settled = true;
            _connecting = null;
            ok ? resolve() : reject(err || new Error('connection failed'));
        }

        try {
            const sock = new WebSocket(WS_URL);

            sock.onopen = () => {
                ws = sock;
                sock.send(JSON.stringify({
                    type: 'extension-info',
                    extensionId: chrome.runtime.id
                }));
                startPing();
                settle(true);
            };

            sock.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'ack' && msg.id && _pendingAcks.has(msg.id)) {
                        const cb = _pendingAcks.get(msg.id);
                        _pendingAcks.delete(msg.id);
                        cb(msg);
                    }
                } catch (_) {}
            };

            sock.onerror = () => {
                // onerror fires before onclose; onclose will do the cleanup.
                // We reject here so the caller knows the connection failed,
                // but we do NOT null out ws yet — onclose handles that.
                settle(false, new Error('app-not-running'));
            };

            sock.onclose = () => {
                // Only clean up if this socket is still the current one.
                if (ws === sock) ws = null;
                stopPing();
                settle(false, new Error('app-not-running'));
            };
        } catch (e) {
            settle(false, e);
        }
    });

    return _connecting;
}

function startPing() {
    stopPing();
    _pingTimer = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
        } else {
            stopPing();
        }
    }, 30000);
}

function stopPing() {
    if (_pingTimer) { clearInterval(_pingTimer); _pingTimer = null; }
}

// Send a message and wait for an ack from the desktop app.
function sendWithAck(payload) {
    return new Promise((resolve) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            resolve({ success: false, error: 'App not connected' });
            return;
        }
        const id = ++_ackId;
        _pendingAcks.set(id, resolve);
        try {
            ws.send(JSON.stringify({ ...payload, id }));
        } catch (e) {
            _pendingAcks.delete(id);
            resolve({ success: false, error: String(e) });
            return;
        }
        // Fail-safe: resolve after 5 s if the app never acks.
        setTimeout(() => {
            if (_pendingAcks.has(id)) {
                _pendingAcks.delete(id);
                resolve({ success: false, error: 'No response from app' });
            }
        }, 5000);
    });
}

// ─── App launch via Native Messaging host ─────────────────────────────────

// Content scripts can't call chrome.runtime.connectNative, so they ask us.
function launchAppViaNativeHost() {
    return new Promise((resolve) => {
        try {
            const port = chrome.runtime.connectNative('com.vibedownloader.host');
            port.onDisconnect.addListener(() => {
                const err = chrome.runtime.lastError?.message;
                if (err) console.warn('[VibeDownloader] Native host:', err);
                resolve({ launched: !chrome.runtime.lastError });
            });
            port.postMessage({ type: 'launch' });
            // Give the host a moment, then assume it launched.
            setTimeout(() => resolve({ launched: true }), 1500);
        } catch (e) {
            console.warn('[VibeDownloader] connectNative failed:', e.message);
            resolve({ launched: false });
        }
    });
}

// ─── Message handler ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

    // Content script asks us to launch the desktop app.
    if (message.type === 'launch-app') {
        launchAppViaNativeHost().then(sendResponse);
        return true;
    }

    // Content script wants to know if we're connected right now.
    if (message.type === 'check-connection') {
        sendResponse({ connected: !!(ws && ws.readyState === WebSocket.OPEN) });
        return true;
    }

    // Content script sends a download request (fallback path — normally the
    // content script talks directly to the app WebSocket itself).
    if (message.type === 'download-url') {
        connectWebSocket()
            .then(() => {
                ws.send(JSON.stringify({
                    type: 'download-url',
                    url: message.url,
                    title: message.title || '',
                    thumbnail: message.thumbnail || ''
                }));
                sendResponse({ success: true });
            })
            .catch(() => {
                sendResponse({ success: false, error: 'App not connected' });
            });
        return true;
    }

    // Save cookies through the ack-based protocol.
    if (message.type === 'save-cookies') {
        connectWebSocket()
            .then(() => sendWithAck({
                type: 'save-cookies',
                platform: message.platform || 'youtube',
                content: message.content
            }))
            .then((ack) => sendResponse({ success: !!ack.success, error: ack.error || '' }))
            .catch(() => sendResponse({ success: false, error: 'App not connected' }));
        return true;
    }
});
