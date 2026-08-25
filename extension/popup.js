// VibeDownloader Extension - Popup Script

const loginBadge = document.getElementById('login-badge');
const loginBadgeText = document.getElementById('login-badge-text');

const accountSection = document.getElementById('account-section');
const accountTitle = document.getElementById('account-title');
const accountDesc = document.getElementById('account-desc');
const accountBtnLabel = document.getElementById('account-btn-label');
const addAccountBtn = document.getElementById('add-account-btn');
const accountStatus = document.getElementById('account-status');

const WS_URL = 'ws://127.0.0.1:13579';

const COOKIE_PLATFORMS = {
    youtube: {
        name: 'YouTube',
        hostPattern: /(^|\.)(youtube\.com|youtu\.be)$/i,
        cookieDomain: '.youtube.com',
        loginCookies: ['LOGIN_INFO'],
        desc: 'Sign in to your YouTube session so VibeDownloader can download age-restricted and members-only videos.'
    },
    instagram: {
        name: 'Instagram',
        hostPattern: /(^|\.)instagram\.com$/i,
        cookieDomain: '.instagram.com',
        loginCookies: ['sessionid', 'ds_user_id'],
        desc: 'Share your Instagram session so VibeDownloader can fetch private profiles and Stories.'
    },
    facebook: {
        name: 'Facebook',
        hostPattern: /(^|\.)facebook\.com$/i,
        cookieDomain: '.facebook.com',
        loginCookies: ['c_user', 'xs', 'fr'],
        desc: 'Share your Facebook session so VibeDownloader can download Stories and private content.'
    },
    tiktok: {
        name: 'TikTok',
        hostPattern: /(^|\.)tiktok\.com$/i,
        cookieDomain: '.tiktok.com',
        loginCookies: ['sessionid', 'uid_tt'],
        desc: 'Share your TikTok session so VibeDownloader can download private or restricted videos.'
    }
};

function detectPlatform(url) {
    if (!url) return null;
    try {
        const host = new URL(url).hostname;
        for (const [id, cfg] of Object.entries(COOKIE_PLATFORMS)) {
            if (cfg.hostPattern.test(host)) return { id, ...cfg };
        }
    } catch (e) {}
    return null;
}

let ws = null;
let wsPendings = new Map();
let wsAckId = 0;

function connectWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve(ws);
    if (ws && ws.readyState === WebSocket.CONNECTING) {
        return new Promise((resolve, reject) => {
            ws.addEventListener('open', () => resolve(ws), { once: true });
            ws.addEventListener('error', () => reject(new Error('App is not running')), { once: true });
        });
    }

    return new Promise((resolve, reject) => {
        try {
            ws = new WebSocket(WS_URL);

            ws.onopen = () => {
                ws.send(JSON.stringify({ type: 'extension-info', extensionId: chrome.runtime.id }));
                resolve(ws);
            };
            ws.onerror = () => {
                ws = null;
                reject(new Error('App is not running'));
            };
            ws.onclose = () => {
                ws = null;
            };
            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'ack' && msg.id && wsPendings.has(msg.id)) {
                        const cb = wsPendings.get(msg.id);
                        wsPendings.delete(msg.id);
                        cb(msg);
                    }
                } catch (e) {}
            };
        } catch (e) {
            ws = null;
            reject(e);
        }
    });
}

function disconnectWebSocket() {
    if (ws) {
        try { ws.close(); } catch (e) {}
        ws = null;
    }
    wsPendings.clear();
}

function sendWithAck(payload) {
    return connectWebSocket().then((sock) => {
        return new Promise((resolve, reject) => {
            const id = ++wsAckId;
            wsPendings.set(id, resolve);
            sock.send(JSON.stringify({ ...payload, id }));
            setTimeout(() => {
                if (wsPendings.has(id)) {
                    wsPendings.delete(id);
                    reject(new Error('No response from app.'));
                }
            }, 5000);
        });
    });
}

function launchAppViaNativeHost() {
    return new Promise((resolve) => {
        try {
            const port = chrome.runtime.connectNative('com.vibedownloader.host');
            port.onDisconnect.addListener(() => {
                resolve({ launched: !chrome.runtime.lastError });
            });
            port.postMessage({ type: 'launch' });
            setTimeout(() => resolve({ launched: true }), 1500);
        } catch (e) {
            // Fallback to protocol
            try {
                const f = document.createElement('iframe');
                f.style.display = 'none';
                f.src = 'vibedownloader://launch';
                document.body.appendChild(f);
                setTimeout(() => f.remove(), 5000);
                resolve({ launched: true });
            } catch (e2) {
                resolve({ launched: false });
            }
        }
    });
}

function waitForAppConnection(timeoutMs) {
    return new Promise((resolve) => {
        const start = Date.now();
        const attempt = () => {
            connectWebSocket()
                .then(() => resolve(true))
                .catch(() => {
                    if (Date.now() - start >= timeoutMs) resolve(false);
                    else setTimeout(attempt, 700);
                });
        };
        attempt();
    });
}

function getPlatformCookies(platform) {
    return new Promise((resolve, reject) => {
        try {
            chrome.cookies.getAll({ domain: platform.cookieDomain }, (cookies) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(cookies || []);
                }
            });
        } catch (e) {
            reject(e);
        }
    });
}

function hasLoggedInCookies(cookies, platform) {
    const names = new Set(cookies.map((c) => c.name));
    return platform.loginCookies.every((n) => names.has(n));
}

function toNetscape(cookies) {
    const lines = [
        '# Netscape HTTP Cookie File',
        '# This file was generated by VibeDownloader. Do not edit.',
        ''
    ];
    for (const c of cookies) {
        if (!c.name) continue;
        const domain = c.domain.startsWith('.') ? c.domain : '.' + c.domain;
        const includeSub = c.domain.startsWith('.') ? 'TRUE' : 'FALSE';
        const secure = c.secure ? 'TRUE' : 'FALSE';
        const expires = c.expirationDate ? Math.floor(c.expirationDate) : 0;
        const value = (c.value || '').replace(/\s/g, '');
        lines.push([domain, includeSub, c.path, secure, expires, c.name, value].join('\t'));
    }
    return lines.join('\n');
}

function setStatus(text, kind) {
    accountStatus.textContent = text;
    accountStatus.className = 'account-status' + (kind ? ' ' + kind : '');
}

function setLoading(loading) {
    addAccountBtn.disabled = loading;
    addAccountBtn.classList.toggle('loading', loading);
}

let activePlatform = null;

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    const platform = detectPlatform(tab && tab.url);
    if (!platform) return;

    activePlatform = platform;
    accountTitle.textContent = platform.name + ' account';
    accountDesc.textContent = platform.desc;
    accountBtnLabel.textContent = 'Add account to VibeDownloader';
    accountSection.classList.add('visible');

    getPlatformCookies(platform).then((cookies) => {
        if (cookies.length === 0) {
            setStatus('No cookies found — are you logged in to ' + platform.name + '?', 'err');
        } else if (!hasLoggedInCookies(cookies, platform)) {
            setStatus('You are not signed in to ' + platform.name + '. Sign in and reopen this popup.', 'err');
        } else {
            loginBadge.classList.add('visible');
            loginBadgeText.textContent = 'Logged in to ' + platform.name;
            setStatus('Signed in — ready to add your account.', 'ok');
        }
    }).catch((e) => {
        setStatus('Could not read cookies: ' + e.message, 'err');
    });
});

addAccountBtn.addEventListener('click', async () => {
    const platform = activePlatform;
    if (!platform) return;

    setLoading(true);
    setStatus('Extracting cookies...');

    try {
        const cookies = await getPlatformCookies(platform);
        if (!hasLoggedInCookies(cookies, platform)) {
            setStatus('No signed-in ' + platform.name + ' session found. Sign in and try again.', 'err');
            setLoading(false);
            return;
        }

        const content = toNetscape(cookies);
        setStatus('Sending to VibeDownloader...');

        let ack = null;
        try {
            ack = await sendWithAck({ type: 'save-cookies', platform: platform.id, content });
        } catch (e) {
            // App not running — launch and retry
            disconnectWebSocket();
            const res = await launchAppViaNativeHost();
            if (res && res.launched) {
                const ok = await waitForAppConnection(12000);
                if (ok) {
                    try {
                        ack = await sendWithAck({ type: 'save-cookies', platform: platform.id, content });
                    } catch (e2) {}
                }
            }
        }

        setLoading(false);
        if (ack && ack.success) {
            setStatus('Account added! Downloads now use your ' + platform.name + ' session.', 'ok');
        } else {
            setStatus('Could not connect to app. Make sure VibeDownloader is running.', 'err');
        }
    } catch (e) {
        setLoading(false);
        setStatus('Failed: ' + e.message, 'err');
    }
});

document.querySelectorAll('.js-open-tab').forEach((a) => {
    a.addEventListener('click', (e) => {
        e.preventDefault();
        const href = a.getAttribute('href');
        if (href) chrome.tabs.create({ url: href });
    });
});
