import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
    Download, Zap, ShieldCheck, MousePointerClick, ExternalLink,
    Loader2, PartyPopper, Check, Globe, RefreshCw, FolderOpen,
    CheckCircle2, CircleDashed, MonitorSmartphone, Flag, Clapperboard
} from 'lucide-react';
import { VideoTutorial } from './VideoTutorial';

interface BrowserStatus {
    id: string;
    name: string;
    present: boolean;
    installed: boolean;
    manual: boolean;
    needsRestart: boolean;
    note?: string;
}

interface ExtensionStatus {
    id: string;
    mode: 'unpacked';
    crxPath: string;
    xpiPath: string;
    extensionPath: string;
    unpackedDir: string;
    unpackedPrepared: boolean;
    keyExists: boolean;
    browsers: BrowserStatus[];
    isPackaged: boolean;
}

interface OnboardingProps {
    initialStatus?: ExtensionStatus | null;
    preview?: boolean;
    onComplete: () => void;
}

const FEATURES = [
    { icon: MousePointerClick, title: 'One-click downloads', desc: 'Download buttons appear right on the page.' },
    { icon: Zap, title: 'Works as you browse', desc: 'Auto-detects videos, reels, shorts & music instantly.' },
    { icon: ShieldCheck, title: 'Private by design', desc: 'Everything stays on your PC — nothing uploaded.' },
];

// Exact steps per browser for loading our bundled extension folder.
const BROWSER_STEPS: Record<string, { steps: string[]; crx?: boolean }> = {
    chrome: { steps: ['We\'ll open chrome://extensions for you', 'Turn on Developer mode (top-right toggle)', 'Click "Load unpacked" and pick the VibeDownloader folder'] },
    edge: { steps: ['We\'ll open edge://extensions for you', 'Turn on Developer mode (left sidebar)', 'Click "Load unpacked" and pick the VibeDownloader folder'] },
    brave: { steps: ['We\'ll open brave://extensions for you', 'Turn on Developer mode (top-right toggle)', 'Click "Load unpacked" and pick the VibeDownloader folder'] },
    vivaldi: { steps: ['We\'ll open vivaldi://extensions for you', 'Turn on Developer mode (top-right toggle)', 'Click "Load unpacked" and pick the VibeDownloader folder'] },
    chromium: { steps: ['We\'ll open chrome://extensions for you', 'Turn on Developer mode (top-right toggle)', 'Click "Load unpacked" and pick the VibeDownloader folder'] },
    firefox: { steps: ['We\'ll open about:debugging#/runtime/this-firefox for you', 'Click "Load Temporary Add-on…"', 'Pick the manifest.json inside the VibeDownloader folder'] },
    opera: { steps: ['We\'ll open opera://extensions for you', 'Turn on Developer mode (top-right)', 'Drag the VibeDownloader .crx file onto the page — we reveal it for you'], crx: true },
};

export function Onboarding({ initialStatus, preview, onComplete }: OnboardingProps) {
    const [status, setStatus] = useState<ExtensionStatus | null>(initialStatus ?? null);
    const [preparing, setPreparing] = useState(false);
    const [checking, setChecking] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedBrowser, setSelectedBrowser] = useState<string | null>(null);

    const presentBrowsers = status?.browsers?.filter(b => b.present) ?? [];
    const anyInstalled = !!status?.browsers?.some(b => b.installed);
    const installedBrowsers = presentBrowsers.filter(b => b.installed);

    // First present browser (or first installed one) is selected by default.
    useEffect(() => {
        if (!selectedBrowser && presentBrowsers.length > 0) {
            const preferred = presentBrowsers.find(b => b.installed) ?? presentBrowsers[0];
            setSelectedBrowser(preferred.id);
        }
    }, [presentBrowsers, selectedBrowser]);

    // Make sure the bundled extension folder + CRX are prepared once, so
    // "Show me the folder" and the Opera drag-drop just work.
    useEffect(() => {
        if (!status?.unpackedPrepared && !preparing) {
            setPreparing(true);
            window.electron.installExtension?.()
                .then(result => setStatus(prev => prev ? { ...prev, unpackedPrepared: true, crxPath: result?.crxPath ?? prev.crxPath } : prev))
                .catch(() => { /* revealed on demand */ })
                .finally(() => setPreparing(false));
        }
    }, [status?.unpackedPrepared]);

    const refreshStatus = async () => {
        setChecking(true);
        setError(null);
        try {
            const s = await window.electron.getExtensionStatus();
            setStatus(s);
        } catch {
            setError('Could not check the browser. Try again.');
        } finally {
            setChecking(false);
        }
    };

    const revealFolder = async () => {
        const res = await window.electron.revealExtensionFolder();
        if (!res?.success) setError(res?.error || 'Could not open the extension folder.');
    };

    const openBrowser = (browserId: string) => {
        window.electron.openBrowserExtensionsPage(browserId);
    };

    const selected = presentBrowsers.find(b => b.id === selectedBrowser) ?? null;
    const selectedSteps = selected ? BROWSER_STEPS[selected.id] : null;

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] overflow-hidden bg-[#0a0a0b] text-white"
        >
            {/* Ambient glows */}
            <div className="fixed inset-0 pointer-events-none">
                <div className="absolute -top-48 left-1/2 -translate-x-1/2 w-[760px] h-[560px] rounded-full bg-violet-600/20 blur-[140px]" />
                <div className="absolute -bottom-32 -right-24 w-[480px] h-[480px] rounded-full bg-fuchsia-600/10 blur-[140px]" />
                <div className="absolute -bottom-24 -left-24 w-[440px] h-[440px] rounded-full bg-blue-600/10 blur-[140px]" />
            </div>

            <div className="relative h-full flex items-center justify-center p-6 sm:p-10">
                <motion.div
                    initial={{ opacity: 0, y: 24, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ delay: 0.12, type: 'spring', stiffness: 220, damping: 26 }}
                    className="relative w-full max-w-7xl max-h-full flex flex-col bg-[#101013] border border-white/10 rounded-3xl shadow-2xl overflow-hidden"
                >
                    {/* Gradient strip */}
                    <div className="h-1.5 w-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-pink-500" />

                    <div className="grid md:grid-cols-[1.05fr_1fr] min-h-0 flex-1">
                        {/* ---- Left: intro ---- */}
                        <div className="min-h-0 overflow-y-auto p-8 sm:p-11 md:border-r md:border-white/5 flex flex-col">
                            <div className="flex items-start justify-between">
                                <div className="relative">
                                    <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-violet-500 to-pink-500 blur-xl opacity-50 animate-pulse" />
                                    <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center shadow-xl shadow-fuchsia-500/30">
                                        <Download className="w-7 h-7 text-white" strokeWidth={2.5} />
                                    </div>
                                </div>
                                {preview && (
                                    <span className="px-2.5 py-1 rounded-lg bg-white/10 border border-white/10 text-[10px] font-bold uppercase tracking-widest text-white/50">
                                        Preview
                                    </span>
                                )}
                            </div>

                            <h1 className="mt-6 text-3xl sm:text-[2.6rem] font-black tracking-tight leading-[1.05]">
                                Meet the{' '}
                                <span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-pink-400 bg-clip-text text-transparent">
                                    VibeDownloader
                                </span>{' '}
                                Extension
                            </h1>
                            <p className="mt-3 text-white/50 text-sm leading-relaxed">
                                Install it once and download videos, reels, shorts & music straight from your browser — with a single click.
                            </p>

                            <div className="mt-6">
                                <div className="flex items-center gap-1.5 mb-2">
                                    <Clapperboard className="w-3.5 h-3.5 text-white/30" />
                                    <p className="text-[10px] uppercase tracking-widest font-bold text-white/30">Introducing the extension</p>
                                </div>
                                <VideoTutorial />
                            </div>

                            <div className="mt-6 space-y-2.5">
                                {FEATURES.map((feature, i) => (
                                    <motion.div
                                        key={feature.title}
                                        initial={{ opacity: 0, x: -14 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: 0.2 + i * 0.08 }}
                                        className="flex items-start gap-3.5 p-3 rounded-2xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] transition-colors"
                                    >
                                        <div className="w-8 h-8 shrink-0 rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 border border-violet-400/10 flex items-center justify-center">
                                            <feature.icon className="w-4 h-4 text-violet-300" />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold">{feature.title}</p>
                                            <p className="text-xs text-white/40 mt-0.5 leading-relaxed">{feature.desc}</p>
                                        </div>
                                    </motion.div>
                                ))}
                            </div>

                            {status?.id && (
                                <p className="mt-auto pt-6 text-[10px] font-mono text-white/25">
                                    Extension ID · {status.id}
                                </p>
                            )}
                        </div>

                        {/* ---- Right: install steps ---- */}
                        <div className="min-h-0 overflow-y-auto p-8 sm:p-11">
                            <div className="space-y-6">
                                {/* Step 1 — pick your browser */}
                                <div>
                                    <div className="flex items-center gap-2.5">
                                        <div className="w-7 h-7 shrink-0 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-xs font-black text-white">
                                            1
                                        </div>
                                        <p className="text-sm font-bold flex items-center gap-1.5">
                                            <MonitorSmartphone className="w-4 h-4 text-violet-300" /> Choose your favorite browser
                                        </p>
                                    </div>

                                    {presentBrowsers.length > 0 ? (
                                        <div className="mt-3 grid grid-cols-2 gap-2">
                                            {presentBrowsers.map(browser => {
                                                const active = selectedBrowser === browser.id;
                                                return (
                                                    <button
                                                        key={browser.id}
                                                        onClick={() => setSelectedBrowser(browser.id)}
                                                        className={`h-11 px-3 rounded-xl border text-left transition cursor-pointer flex items-center gap-2.5 ${
                                                            active
                                                                ? 'bg-violet-500/15 border-violet-400/40'
                                                                : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.06]'
                                                        }`}
                                                    >
                                                        <Globe className={`w-4 h-4 shrink-0 ${active ? 'text-violet-300' : 'text-white/40'}`} />
                                                        <div className="min-w-0 flex-1">
                                                            <p className="text-xs font-bold truncate">{browser.name}</p>
                                                            <p className={`text-[10px] flex items-center gap-1 ${browser.installed ? 'text-emerald-400' : 'text-white/30'}`}>
                                                                {browser.installed ? (
                                                                    <><CheckCircle2 className="w-3 h-3" /> Running</>
                                                                ) : (
                                                                    <><CircleDashed className="w-3 h-3" /> Not set up</>
                                                                )}
                                                            </p>
                                                        </div>
                                                        {active && <Check className="w-4 h-4 text-violet-300 shrink-0" />}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <p className="mt-3 p-3 rounded-xl bg-white/[0.03] border border-white/10 text-xs text-white/40 leading-relaxed">
                                            We couldn't detect a browser on this PC. Install Chrome, Edge, Brave or Firefox, then come back here.
                                        </p>
                                    )}
                                </div>

                                {/* Step 2 — load the bundled folder */}
                                {selected && selectedSteps && (
                                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                                        <div className="flex items-center gap-2.5">
                                            <div className="w-7 h-7 shrink-0 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-xs font-black text-white">
                                                2
                                            </div>
                                            <p className="text-sm font-bold flex items-center gap-1.5">
                                                <FolderOpen className="w-4 h-4 text-violet-300" /> Load the extension we packed
                                            </p>
                                        </div>

                                        <div className="mt-3 space-y-2">
                                            {selectedSteps.steps.map((step, i) => (
                                                <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/5">
                                                    <div className="w-7 h-7 shrink-0 rounded-lg bg-violet-500/15 border border-violet-400/10 flex items-center justify-center text-[10px] font-bold text-violet-300">
                                                        {i + 1}
                                                    </div>
                                                    <p className="text-xs text-white/70 leading-relaxed mt-0.5">{step}</p>
                                                </div>
                                            ))}
                                        </div>

                                        <div className="mt-3 grid grid-cols-2 gap-2">
                                            <button
                                                onClick={() => openBrowser(selected.id)}
                                                className="h-10 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-white/70 hover:text-white transition cursor-pointer flex items-center justify-center gap-1.5"
                                            >
                                                <ExternalLink className="w-3.5 h-3.5" /> Open extensions
                                            </button>
                                            <button
                                                onClick={revealFolder}
                                                className="h-10 rounded-xl bg-gradient-to-r from-violet-500/30 to-fuchsia-500/30 hover:from-violet-500/40 hover:to-fuchsia-500/40 border border-violet-400/20 text-xs font-bold text-violet-200 transition cursor-pointer flex items-center justify-center gap-1.5"
                                            >
                                                <FolderOpen className="w-3.5 h-3.5" /> Show extension folder
                                            </button>
                                        </div>
                                        <p className="mt-2 text-[10px] text-white/30 text-center leading-relaxed">
                                            The folder ships inside the app — we reveal it and you pick it.
                                        </p>
                                    </motion.div>
                                )}

                                {/* Step 3 — confirm */}
                                <div>
                                    <div className="flex items-center gap-2.5">
                                        <div className="w-7 h-7 shrink-0 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-xs font-black text-white">
                                            3
                                        </div>
                                        <p className="text-sm font-bold flex items-center gap-1.5">
                                            <Flag className="w-4 h-4 text-violet-300" /> Confirm it's running
                                        </p>
                                    </div>

                                    {anyInstalled ? (
                                        <motion.div
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            className="mt-3 p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20"
                                        >
                                            <div className="flex items-center gap-2.5">
                                                <PartyPopper className="w-5 h-5 text-emerald-400 shrink-0" />
                                                <p className="text-sm font-semibold text-emerald-300">
                                                    Extension is running in {installedBrowsers.map(b => b.name.split(' ')[0]).join(', ')}!
                                                </p>
                                            </div>
                                            <p className="mt-1.5 text-xs text-white/50 leading-relaxed">
                                                Play a video on YouTube, Instagram or TikTok and the Download button appears instantly.
                                            </p>
                                        </motion.div>
                                    ) : (
                                        <button
                                            onClick={refreshStatus}
                                            disabled={checking || preparing}
                                            className="mt-3 w-full h-11 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-sm font-bold text-white/60 hover:text-white transition cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
                                        >
                                            {checking || preparing ? (
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                            ) : (
                                                <RefreshCw className="w-4 h-4" />
                                            )}
                                            {checking ? 'Checking…' : preparing ? 'Preparing extension…' : "I've done it — check now"}
                                        </button>
                                    )}

                                    {error && (
                                        <p className="mt-2 text-[11px] text-red-400 text-center leading-relaxed">{error}</p>
                                    )}
                                </div>
                            </div>

                            {/* Footer actions */}
                            <div className="mt-8 pt-5 border-t border-white/5">
                                {anyInstalled && (
                                    <button
                                        onClick={refreshStatus}
                                        disabled={checking}
                                        className="w-full mb-2 h-9 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/5 text-[11px] font-semibold text-white/40 hover:text-white/70 transition cursor-pointer flex items-center justify-center gap-1.5"
                                    >
                                        <RefreshCw className="w-3 h-3" /> Check again
                                    </button>
                                )}
                                <button
                                    onClick={onComplete}
                                    className="w-full h-12 rounded-2xl font-bold text-sm transition cursor-pointer flex items-center justify-center gap-2 bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:opacity-90 text-white shadow-lg shadow-fuchsia-500/20"
                                >
                                    Continue to VibeDownloader →
                                </button>
                            </div>
                        </div>
                    </div>
                </motion.div>
            </div>
        </motion.div>
    );
}
