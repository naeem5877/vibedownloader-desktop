import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Sparkles, Download, RefreshCw, X, ExternalLink } from 'lucide-react';

type UpdateState = Awaited<ReturnType<Window['electron']['getUpdateState']>>;

const formatSpeed = (bytesPerSecond?: number) => {
    if (!bytesPerSecond || bytesPerSecond <= 0) return '';
    const mb = bytesPerSecond / 1024 / 1024;
    return mb >= 1 ? `${mb.toFixed(1)} MB/s` : `${Math.round(bytesPerSecond / 1024)} KB/s`;
};

/**
 * Dev preview: open the app with ?update=available | downloading | downloaded | error
 * to see each state without publishing a release.
 */
function previewState(): UpdateState | null {
    const mode = new URLSearchParams(window.location.search).get('update');
    if (!mode) return null;
    const base = { currentVersion: '2.1.0', version: '2.2.0', releaseUrl: 'https://github.com/naeem5877/vibedownloader-desktop/releases/latest' };
    if (mode === 'available') return { ...base, status: 'available' };
    if (mode === 'downloading') return { ...base, status: 'downloading', percent: 42, bytesPerSecond: 3.4 * 1024 * 1024 };
    if (mode === 'downloaded') return { ...base, status: 'downloaded', percent: 100 };
    if (mode === 'error') return { ...base, status: 'error', message: 'Update could not be installed' };
    return null;
}

export function UpdateBanner() {
    const [state, setState] = useState<UpdateState | null>(null);
    // "Later" hides the banner for the current stage of the current version only,
    // so it comes back when the download finishes and the update is ready.
    const [dismissedKey, setDismissedKey] = useState<string | null>(null);
    const [busyDownloads, setBusyDownloads] = useState<number | null>(null);
    const [restarting, setRestarting] = useState(false);
    const preview = useRef(previewState());

    useEffect(() => {
        if (preview.current) {
            setState(preview.current);
            return;
        }
        const api = window.electron;
        if (!api?.getUpdateState) return;

        // The window is reloaded after being hidden to the tray, so ask the main
        // process where the update stands instead of waiting for the next event.
        api.getUpdateState().then(setState).catch(() => null);
        const unsubscribe = api.onUpdateStatus?.((data: UpdateState) => setState(data));
        return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
    }, []);

    if (!state) return null;

    const { status, version, currentVersion } = state;
    // Only show something when there is something to act on. Checking, up-to-date
    // and failed checks with no known update stay silent.
    const visibleStatus =
        status === 'available' || status === 'downloading' || status === 'downloaded' ||
        (status === 'error' && !!version);
    const key = `${status}:${version ?? ''}`;
    const visible = visibleStatus && dismissedKey !== key;

    const restart = async (force = false) => {
        if (preview.current) return;
        setRestarting(true);
        const res = await window.electron.installUpdate({ force });
        if (res?.activeDownloads) {
            setRestarting(false);
            setBusyDownloads(res.activeDownloads);
            return;
        }
        if (!res?.success) setRestarting(false);
    };

    const openRelease = () => window.electron.openExternal(state.releaseUrl);

    let title = 'Update available';
    let subtitle = `v${currentVersion} → v${version}`;
    if (status === 'downloading') title = 'Downloading update';
    if (status === 'downloaded') title = `Update v${version} is ready`;
    if (status === 'error') {
        title = 'Update couldn\u2019t install automatically';
        subtitle = `v${version} is available to download`;
    }
    if (status === 'downloaded') subtitle = `You\u2019re on v${currentVersion}. Restart to get v${version}.`;

    const percent = Math.max(0, Math.min(100, Math.round(state.percent ?? 0)));

    return (
        <AnimatePresence>
            {visible && (
                <motion.div
                    key="update-banner"
                    initial={{ opacity: 0, y: 16, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 16, scale: 0.98 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                    className="fixed bottom-5 right-5 z-[60] w-[340px] rounded-2xl border border-white/10 bg-[#0e0f13]/95 p-4 shadow-2xl shadow-black/60 backdrop-blur-xl"
                    role="status"
                    aria-live="polite"
                >
                    <button
                        onClick={() => { setDismissedKey(key); setBusyDownloads(null); }}
                        className="absolute right-3 top-3 rounded-md p-1 text-white/40 transition hover:bg-white/5 hover:text-white/80"
                        title="Later"
                        aria-label="Dismiss"
                    >
                        <X size={14} />
                    </button>

                    <div className="flex items-start gap-3 pr-5">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-lg shadow-violet-500/20">
                            {status === 'downloading' ? <Download size={18} className="text-white" /> : <Sparkles size={18} className="text-white" />}
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm font-semibold leading-tight text-white">{title}</p>
                            <p className="mt-1 text-xs leading-snug text-white/50">{subtitle}</p>
                        </div>
                    </div>

                    {(status === 'downloading' || status === 'available') && (
                        <div className="mt-4">
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                                <motion.div
                                    className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500"
                                    initial={false}
                                    animate={{ width: `${status === 'available' ? 4 : Math.max(percent, 3)}%` }}
                                    transition={{ ease: 'easeOut', duration: 0.4 }}
                                />
                            </div>
                            <div className="mt-2 flex justify-between text-[11px] text-white/40">
                                <span>{status === 'available' ? 'Starting download\u2026' : `${percent}%`}</span>
                                <span>{status === 'downloading' ? formatSpeed(state.bytesPerSecond) : ''}</span>
                            </div>
                        </div>
                    )}

                    {status === 'downloaded' && busyDownloads === null && (
                        <div className="mt-4 flex gap-2">
                            <button
                                onClick={() => restart(false)}
                                disabled={restarting}
                                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-black transition hover:bg-white/90 disabled:opacity-60"
                            >
                                <RefreshCw size={13} className={restarting ? 'animate-spin' : ''} />
                                {restarting ? 'Restarting\u2026' : 'Restart & Update'}
                            </button>
                            <button
                                onClick={() => setDismissedKey(key)}
                                className="rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-white/70 transition hover:bg-white/5"
                            >
                                Later
                            </button>
                        </div>
                    )}

                    {status === 'downloaded' && busyDownloads !== null && (
                        <div className="mt-4">
                            <p className="text-xs leading-snug text-amber-300/90">
                                {busyDownloads} download{busyDownloads === 1 ? ' is' : 's are'} still running. Restarting now will cancel {busyDownloads === 1 ? 'it' : 'them'}.
                            </p>
                            <div className="mt-3 flex gap-2">
                                <button
                                    onClick={() => restart(true)}
                                    className="flex-1 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-black transition hover:bg-white/90"
                                >
                                    Restart anyway
                                </button>
                                <button
                                    onClick={() => setBusyDownloads(null)}
                                    className="rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-white/70 transition hover:bg-white/5"
                                >
                                    Wait
                                </button>
                            </div>
                        </div>
                    )}

                    {status === 'error' && (
                        <div className="mt-4 flex gap-2">
                            <button
                                onClick={openRelease}
                                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-black transition hover:bg-white/90"
                            >
                                <ExternalLink size={13} />
                                Download v{version}
                            </button>
                            <button
                                onClick={() => setDismissedKey(key)}
                                className="rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-white/70 transition hover:bg-white/5"
                            >
                                Later
                            </button>
                        </div>
                    )}
                </motion.div>
            )}
        </AnimatePresence>
    );
}
