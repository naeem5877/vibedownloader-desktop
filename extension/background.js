// VibeDownloader Extension - Background Service Worker

const WS_URL = 'ws://127.0.0.1:13579';
let ws = null;
let reconnectTimer = null;

function connectWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) return;

    try {
        ws = new WebSocket(WS_URL);

        ws.onopen = () => {
            console.log('[VibeDownloader] Connected to desktop app');
            // Send extension ID so app can register native host
            ws.send(JSON.stringify({
                type: 'extension-info',
                extensionId: chrome.runtime.id
            }));
            // Ping every 30s to keep alive
            if (reconnectTimer) clearInterval(reconnectTimer);
            reconnectTimer = setInterval(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'ping' }));
                }
            }, 30000);
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'ack') {
                    console.log('[VibeDownloader] App acknowledged:', msg.success);
                }
            } catch (e) {}
        };

        ws.onclose = () => {
            console.log('[VibeDownloader] Disconnected from desktop app');
            ws = null;
            // Reconnect after 5s
            setTimeout(connectWebSocket, 5000);
        };

        ws.onerror = () => {
            ws = null;
        };
    } catch (e) {
        console.log('[VibeDownloader] WebSocket connection failed');
    }
}

// Connect on startup
connectWebSocket();

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'download-url') {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'download-url',
                url: message.url,
                title: message.title || '',
                thumbnail: message.thumbnail || ''
            }));
            sendResponse({ success: true });
        } else {
            // Try to reconnect and send
            connectWebSocket();
            sendResponse({ success: false, error: 'App not connected' });
        }
        return true; // Keep channel open for async response
    }

    if (message.type === 'check-connection') {
        sendResponse({ connected: ws && ws.readyState === WebSocket.OPEN });
        return true;
    }
});
