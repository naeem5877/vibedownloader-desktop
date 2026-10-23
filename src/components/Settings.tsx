import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Settings as SettingsIcon, X, RefreshCw, Loader2, FolderOpen, Check, HardDrive, Info, Monitor, CheckCircle2, AlertCircle,
} from 'lucide-react';

interface SettingsProps {
    isOpen: boolean;
    onClose: () => void;
}

// Asking yt-dlp for its version spawns a process, so it is remembered between
// openings. The panel then shows the last known value instantly and refreshes it
// in the background instead of flashing "Loading…" every time.
let cachedVersions: { app: string; ytdlp: string } | null = null;

type Status = { tone: 'ok' | 'err' | 'info'; text: string } | null;

const SectionLabel = ({ icon: Icon, children }: { icon: typeof Monitor; children: React.ReactNode }) => (
    <p className="text-[11px] font-bold text-white/45 uppercase tracking-widest flex items-center gap-2">
        <Icon className="w-3.5 h-3.5" /> {children}
    </p>
);

export function Settings({ isOpen, onClose }: SettingsProps) {
    const [ytdlpVersion, setYtdlpVersion] = useState<string | null>(cachedVersions?.ytdlp ?? null);
    const [appVersion, setAppVersion] = useState<string | null>(cachedVersions?.app ?? null);
    const [isUpdating, setIsUpdating] = useState(false);
    const [status, setStatus] = useState<Status>(null);
    const [downloadPath, setDownloadPath] = useState<string>('');
    const [minimizeToTray, setMinimizeToTray] = useState(true);
    const [loaded, setLoaded] = useState(false);

    const dialogRef = useRef<HTMLDivElement>(null);
    const statusTimer = useRef<number | undefined>(undefined);

    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;

        // Settings are a quick file read, so they land first; the version comes later.
        window.electron.getSettings?.().then((s: any) => {
            if (cancelled) return;
            setDownloadPath(s?.downloadBasePath || '');
            setMinimizeToTray(s?.minimizeToTray ?? true);
            setLoaded(true);
        });
        window.electron.getVersions?.().then((res: any) => {
            if (cancelled) return;
            cachedVersions = { app: res?.app || '', ytdlp: res?.ytdlp || '' };
            setYtdlpVersion(res?.ytdlp || 'Unknown');
            setAppVersion(res?.app || '');
        });

        dialogRef.current?.focus({ preventScroll: true });
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => { cancelled = true; window.removeEventListener('keydown', onKey); };
    }, [isOpen, onClose]);

    useEffect(() => () => window.clearTimeout(statusTimer.current), []);

    const flash = (s: Status, ms = 5000) => {
        setStatus(s);
        window.clearTimeout(statusTimer.current);
        statusTimer.current = window.setTimeout(() => setStatus(null), ms);
    };

    const handleToggleTray = async () => {
        const next = !minimizeToTray;
        setMinimizeToTray(next);
        const current = await window.electron.getSettings?.();
        await window.electron.saveSettings?.({ ...(current || {}), minimizeToTray: next });
    };

    const handleUpdateYtdlp = async () => {
        setIsUpdating(true);
        setStatus({ tone: 'info', text: 'Checking for updates…' });
        try {
            const result = await window.electron.updateYtdlp?.();
            if (result?.error) {
                flash({ tone: 'err', text: result.error }, 8000);
            } else if (result?.updated) {
                setYtdlpVersion(result.version ?? null);
                if (cachedVersions && result.version) cachedVersions.ytdlp = result.version;
                flash({ tone: 'ok', text: 'Updated successfully.' });
            } else {
                flash({ tone: 'ok', text: result?.message || 'Already up to date.' });
            }
        } catch (e: any) {
            flash({ tone: 'err', text: 'Update failed: ' + (e?.message || 'unknown error') }, 8000);
        } finally {
            setIsUpdating(false);
        }
    };

    const handleChooseFolder = async () => {
        const result = await window.electron.chooseDownloadFolder?.();
        if (result?.path) setDownloadPath(result.path);
    };

    const toneClass = status?.tone === 'err' ? 'text-red-300' : status?.tone === 'ok' ? 'text-emerald-300' : 'text-white/55';
    const ToneIcon = status?.tone === 'err' ? AlertCircle : status?.tone === 'ok' ? CheckCircle2 : Loader2;

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    key="settings"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    // Starts below the title bar so the window buttons stay usable.
                    className="fixed left-0 right-0 bottom-0 top-8 z-50 flex items-center justify-center p-4"
                >
                    {/* Plain dim: a blur over the whole window is costly to paint and made this panel laggy. */}
                    <div className="absolute inset-0 bg-black/80" onClick={onClose} />

                    <motion.div
                        ref={dialogRef}
                        tabIndex={-1}
                        role="dialog"
                        aria-modal="true"
                        aria-label="Settings"
                        initial={{ opacity: 0, scale: 0.97, y: 12 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.97, y: 8 }}
                        transition={{ duration: 0.18, ease: 'easeOut' }}
                        className="relative w-full max-w-md max-h-full overflow-y-auto bg-[#111] border border-white/10 rounded-2xl shadow-2xl shadow-black/60 outline-none"
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between p-4 border-b border-white/10">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
                                    <SettingsIcon className="w-5 h-5 text-white/60" />
                                </div>
                                <div>
                                    <h2 className="font-bold text-white leading-tight">Settings</h2>
                                    <p className="text-xs text-white/40">App &amp; Downloads</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={onClose}
                                aria-label="Close settings"
                                className="w-9 h-9 flex items-center justify-center hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
                            >
                                <X className="w-5 h-5 text-white/60" />
                            </button>
                        </div>

                        <div className="p-4 space-y-5">
                            {/* Download Location */}
                            <section className="space-y-3">
                                <SectionLabel icon={FolderOpen}>Download Location</SectionLabel>
                                <div className="flex gap-2">
                                    <div className="flex-1 min-w-0 h-11 px-4 bg-white/5 border border-white/10 rounded-xl flex items-center">
                                        <span className="text-sm text-white/65 truncate" title={downloadPath}>
                                            {loaded ? (downloadPath || 'Default Downloads') : <span className="inline-block h-3 w-40 rounded bg-white/10 animate-pulse align-middle" />}
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => downloadPath && window.electron.openInFolder?.(downloadPath)}
                                        disabled={!downloadPath}
                                        aria-label="Open download folder"
                                        title="Open folder"
                                        className="w-11 h-11 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-white/60 hover:text-white transition-colors cursor-pointer flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        <FolderOpen className="w-4 h-4" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleChooseFolder}
                                        className="h-11 px-4 bg-white/10 hover:bg-white/20 rounded-xl text-sm font-medium text-white transition-colors cursor-pointer"
                                    >
                                        Change
                                    </button>
                                </div>
                                <div className="flex items-start gap-2.5 p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                                    <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                                    <p className="text-xs text-blue-300/80 leading-relaxed">
                                        Files go in a <b>VibeDownloader</b> folder, sorted by platform and type. Your Library scans this folder automatically, and keeps scanning older ones if you change it.
                                    </p>
                                </div>
                            </section>

                            {/* System Tray */}
                            <section className="space-y-3">
                                <SectionLabel icon={Monitor}>System Tray</SectionLabel>
                                <div className="p-4 bg-white/[0.03] rounded-xl border border-white/5 flex items-center justify-between gap-4">
                                    <div>
                                        <p className="text-sm font-medium text-white">Minimize to Tray</p>
                                        <p className="text-xs text-white/40">Keep app running for instant access</p>
                                    </div>
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={minimizeToTray}
                                        aria-label="Minimize to Tray"
                                        onClick={handleToggleTray}
                                        className={`relative shrink-0 w-11 h-6 rounded-full transition-colors duration-200 cursor-pointer ${minimizeToTray ? 'bg-blue-500' : 'bg-white/15'}`}
                                    >
                                        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform duration-200 ease-out ${minimizeToTray ? 'translate-x-5' : ''}`} />
                                    </button>
                                </div>
                            </section>

                            {/* yt-dlp Update */}
                            <section className="space-y-3">
                                <SectionLabel icon={RefreshCw}>yt-dlp Engine</SectionLabel>
                                <div className="p-4 bg-white/[0.03] rounded-xl border border-white/5">
                                    <div className="flex items-center justify-between gap-4">
                                        <div>
                                            <p className="text-sm font-medium text-white">Version</p>
                                            <p className="text-xs text-white/45 font-mono mt-0.5">
                                                {ytdlpVersion || <span className="inline-block h-3 w-20 rounded bg-white/10 animate-pulse align-middle" />}
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleUpdateYtdlp}
                                            disabled={isUpdating}
                                            className="flex items-center gap-2 px-4 h-9 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-medium text-white transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                                        >
                                            {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                                            {isUpdating ? 'Updating…' : 'Update'}
                                        </button>
                                    </div>
                                    <AnimatePresence initial={false}>
                                        {status && (
                                            <motion.p
                                                key={status.text}
                                                initial={{ opacity: 0, height: 0 }}
                                                animate={{ opacity: 1, height: 'auto' }}
                                                exit={{ opacity: 0, height: 0 }}
                                                transition={{ duration: 0.15 }}
                                                role="status"
                                                className={`overflow-hidden text-xs flex items-start gap-1.5 ${toneClass}`}
                                            >
                                                <ToneIcon className={`w-3.5 h-3.5 mt-px shrink-0 ${status.tone === 'info' ? 'animate-spin' : ''}`} />
                                                <span className="pt-0.5">{status.text}</span>
                                            </motion.p>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </section>

                            {/* App Info */}
                            <div className="p-4 bg-gradient-to-br from-white/[0.04] to-transparent rounded-xl border border-white/5">
                                <div className="flex items-center gap-3">
                                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
                                        <HardDrive className="w-6 h-6 text-purple-400" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-bold text-white">VibeDownloader</p>
                                        <p className="text-xs text-white/40">
                                            {appVersion ? `Version ${appVersion}` : <span className="inline-block h-3 w-16 rounded bg-white/10 animate-pulse align-middle" />}
                                        </p>
                                    </div>
                                    <div className="ml-auto flex items-center gap-1.5 px-2 py-1 bg-green-500/15 rounded-lg">
                                        <Check className="w-3 h-3 text-green-400" />
                                        <span className="text-xs font-medium text-green-400">Active</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
