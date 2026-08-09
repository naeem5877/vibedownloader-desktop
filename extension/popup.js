// VibeDownloader Extension - Popup Script

const statusEl = document.getElementById('status');
const statusText = document.getElementById('status-text');

chrome.runtime.sendMessage({ type: 'check-connection' }, (response) => {
    if (response && response.connected) {
        statusEl.className = 'status connected';
        statusText.textContent = 'Connected to VibeDownloader';
    } else {
        statusEl.className = 'status disconnected';
        statusText.textContent = 'VibeDownloader not running';
    }
});
