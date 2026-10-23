import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { EditorPlayer } from './EditorPlayer';
import { X, Music, Zap, Image as ImageIcon, ArrowRight, Wand2, Sparkles } from 'lucide-react';

/* ------------------------------------------------------------------ helpers */

function formatBytes(n: number): string {
    if (!n) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    const v = n / Math.pow(1024, i);
    return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

function clock(s: number): string {
    const t = Math.max(0, s);
    const m = Math.floor(t / 60);
    const sec = t - m * 60;
    return `${m}:${sec.toFixed(1).padStart(4, '0')}`;
}

type Tab = 'audio' | 'convert' | 'gif';

const TABS: { id: Tab; label: string; blurb: string; Icon: typeof Music; from: string; to: string }[] = [
    { id: 'audio', label: 'Audio', blurb: 'Pull the soundtrack out', Icon: Music, from: '#10b981', to: '#14b8a6' },
    { id: 'convert', label: 'Convert', blurb: 'Change format or shrink', Icon: Zap, from: '#38bdf8', to: '#8b5cf6' },
    { id: 'gif', label: 'GIF', blurb: 'Loop a short moment', Icon: ImageIcon, from: '#d946ef', to: '#fb923c' },
];

/* --------------------------------------------------------------- small bits */

interface Opt<T> { id: T; label: string; sub?: string; disabled?: boolean }

function Chips<T extends string | number>({ label, value, options, onChange }: {
    label: string;
    value: T;
    options: Opt<T>[];
    onChange: (v: T) => void;
}) {
    return (
        <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-white/35">{label}</p>
            <div role="group" aria-label={label} className="flex flex-wrap gap-2">
                {options.map(o => {
                    const active = o.id === value;
                    return (
                        <button
                            key={String(o.id)}
                            type="button"
                            aria-pressed={active}
                            disabled={o.disabled}
                            onClick={() => onChange(o.id)}
                            className={`h-10 px-3.5 rounded-xl border text-xs font-semibold flex flex-col items-start justify-center leading-tight transition-all active:scale-[0.97] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${active
                                ? 'bg-white/[0.12] border-white/30 text-white'
                                : 'bg-white/[0.03] border-white/10 text-white/60 hover:text-white hover:border-white/20'}`}
                        >
                            {o.label}
                            {o.sub && <span className="text-[9px] font-medium text-white/40">{o.sub}</span>}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

const Slider = ({ label, value, min, max, step, onChange, display }: {
    label: string; value: number; min: number; max: number; step: number; display: string; onChange: (v: number) => void;
}) => (
    <label className="block">
        <span className="mb-1.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-white/35">
            {label}
            <span className="text-xs font-semibold normal-case tracking-normal text-white/80 tabular-nums">{display}</span>
        </span>
        <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-full h-1.5 rounded-full appearance-none bg-white/10 accent-fuchsia-400 cursor-pointer"
        />
    </label>
);

/* ------------------------------------------------------------------- editor */

export function LibraryEditor({ item, onClose, onRun }: {
    item: LibraryItem;
    onClose: () => void;
    onRun: (req: LibraryEditRequest, label: string) => void;
}) {
    const dur = item.duration && item.duration > 0 ? item.duration : 30;
    const srcMin = item.width && item.height ? Math.min(item.width, item.height) : 0;
    const srcMax = item.width && item.height ? Math.max(item.width, item.height) : 0;

    const [tab, setTab] = useState<Tab>('audio');

    // Audio
    const [aFormat, setAFormat] = useState<'mp3' | 'm4a'>('mp3');
    const [aQuality, setAQuality] = useState<'best' | 'standard'>('best');

    // Convert
    const [cFormat, setCFormat] = useState<'mp4' | 'webm' | 'mkv'>('mp4');
    const [cHeight, setCHeight] = useState(0);
    const [cQuality, setCQuality] = useState<'high' | 'balanced' | 'small'>('balanced');

    // GIF
    const [gLen, setGLen] = useState(Math.min(5, dur));
    const [gStart, setGStart] = useState(0);
    const [gWidth, setGWidth] = useState(480);
    const [gFps, setGFps] = useState(15);

    const videoRef = useRef<HTMLVideoElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);

    // Focus the dialog itself (not the first button), so no stray focus ring shows on open.
    useEffect(() => { dialogRef.current?.focus({ preventScroll: true }); }, []);
    const meta = TABS.find(t => t.id === tab)!;

    // Typed values are clamped here too, so the sliders can never disagree.
    const maxLen = Math.min(15, dur);
    const len = Math.min(gLen, maxLen);
    const start = Math.min(gStart, Math.max(0, dur - len));

    // GIF tab: loop the chosen range in the preview, so what you see is what you get.
    useEffect(() => {
        const v = videoRef.current;
        if (!v) return;
        if (tab !== 'gif') { v.pause(); return; }
        v.muted = true;
        v.currentTime = start;
        v.play().catch(() => { /* autoplay can be refused; the user can still press play */ });
        let raf = 0;
        const loop = () => {
            if (v.currentTime >= start + len || v.currentTime < start - 0.3) v.currentTime = start;
            raf = requestAnimationFrame(loop);
        };
        loop();
        return () => cancelAnimationFrame(raf);
    }, [tab, start, len]);

    const heights = useMemo(
        () => [
            { id: 0, label: 'Original', sub: srcMin ? `${srcMin}p` : undefined, disabled: false },
            ...[1080, 720, 480, 360].map(h => ({ id: h, label: `${h}p`, sub: undefined as string | undefined, disabled: !!srcMin && h >= srcMin })),
        ],
        [srcMin]
    );

    const outDims = useMemo(() => {
        if (!srcMin || !srcMax) return null;
        const scale = cHeight && cHeight < srcMin ? cHeight / srcMin : 1;
        const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
        const portrait = (item.height || 0) > (item.width || 0);
        return portrait ? `${even(srcMin)}×${even(srcMax)}` : `${even(srcMax)}×${even(srcMin)}`;
    }, [srcMin, srcMax, cHeight, item.width, item.height]);

    const audioEstimate = (aQuality === 'best' ? (aFormat === 'mp3' ? 320 : 256) : (aFormat === 'mp3' ? 192 : 128)) * 125 * dur;

    const presets: { name: string; sub: string; apply: () => void }[] = [
        { name: 'Share anywhere', sub: '720p MP4 · small', apply: () => { setCFormat('mp4'); setCHeight(srcMin && srcMin <= 720 ? 0 : 720); setCQuality('small'); } },
        { name: 'Smallest file', sub: '480p MP4 · smallest', apply: () => { setCFormat('mp4'); setCHeight(srcMin && srcMin <= 480 ? 0 : 480); setCQuality('small'); } },
        { name: 'Universal', sub: 'MP4 · keep size', apply: () => { setCFormat('mp4'); setCHeight(0); setCQuality('balanced'); } },
    ];

    const run = () => {
        if (tab === 'audio') {
            onRun({ type: 'audio', format: aFormat, quality: aQuality }, `Extracting ${aFormat.toUpperCase()}`);
        } else if (tab === 'convert') {
            const res = cHeight ? ` · ${cHeight}p` : '';
            onRun({ type: 'convert', format: cFormat, height: cHeight, quality: cQuality }, `Converting to ${cFormat.toUpperCase()}${res}`);
        } else {
            onRun({ type: 'gif', start, length: len, width: gWidth, fps: gFps }, 'Making GIF');
        }
    };

    const actionLabel = tab === 'audio' ? `Extract ${aFormat.toUpperCase()}` : tab === 'convert' ? `Convert to ${cFormat.toUpperCase()}` : 'Create GIF';
    const gifHeavy = len > 8 && gWidth >= 480 && gFps >= 15;

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed left-0 right-0 bottom-0 top-8 z-[70] flex items-center justify-center p-4 sm:p-8 bg-black/80"
            onClick={onClose}
        >
            <motion.div
                role="dialog"
                ref={dialogRef}
                tabIndex={-1}
                aria-modal="true"
                aria-label={`Edit ${item.name}`}
                initial={{ opacity: 0, y: 18, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.98 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
                onClick={(e) => e.stopPropagation()}
                className="relative w-full max-w-5xl max-h-full overflow-y-auto rounded-3xl outline-none bg-[#0f0f11] border border-white/10 shadow-2xl shadow-black/70"
            >
                {/* Colour wash that follows the active tab */}
                <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 top-0 h-64 opacity-[0.16]"
                    style={{ background: `radial-gradient(60% 100% at 70% 0%, ${meta.from}, transparent)` }}
                />

                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close editor"
                    className="absolute top-4 right-4 z-10 w-9 h-9 rounded-xl bg-white/[0.05] border border-white/10 hover:bg-white/10 text-white/60 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                >
                    <X className="w-4 h-4" />
                </button>

                <div className="relative grid md:grid-cols-[1.1fr_1fr] gap-0 md:min-h-[620px]">
                    {/* Preview */}
                    <div className="p-6 md:p-8 md:border-r border-white/[0.06]">
                        <div className="flex items-center gap-2 mb-4 text-[10px] font-bold uppercase tracking-widest text-white/40">
                            <Wand2 className="w-3.5 h-3.5" /> Editor
                        </div>

                        <div className="relative rounded-2xl overflow-hidden bg-black border border-white/10 h-[clamp(240px,42vh,400px)]">
                            {/* Blurred copy of the frame fills the sides, so portrait clips do not sit in a black box */}
                            <div aria-hidden="true" className="absolute inset-0" style={{ background: `radial-gradient(90% 100% at 50% 35%, ${(item.accent || '#6d5bd0')}66, ${(item.accent || '#6d5bd0')}1a 65%, #0b0b0d)` }} />
                            <EditorPlayer
                                src={`vibe-media://file/${item.id}`}
                                poster={item.hasThumb ? `vibe-media://thumb/${item.id}` : undefined}
                                videoRef={videoRef}
                                gifRange={tab === 'gif' ? { start, length: len } : null}
                                fallbackDuration={item.duration}
                            />
                            {tab === 'gif' && (
                                <span className="absolute z-10 top-2.5 left-2.5 flex items-center gap-1.5 h-6 px-2 rounded-md bg-black/70 text-[10px] font-bold text-white/85">
                                    <i className="w-1.5 h-1.5 rounded-full bg-fuchsia-400 animate-pulse" /> LOOP PREVIEW
                                </span>
                            )}
                        </div>

                        <p className="mt-4 text-sm font-semibold text-white truncate" title={item.name}>{item.name}</p>
                        <p className="mt-1 text-xs text-white/40">
                            {[item.ext.toUpperCase(), srcMax ? `${item.width}×${item.height}` : '', formatBytes(item.size), item.duration ? clock(item.duration) : ''].filter(Boolean).join(' · ')}
                        </p>
                        <p className="mt-4 flex items-start gap-2 text-[11px] leading-relaxed text-white/35">
                            <Sparkles className="w-3.5 h-3.5 mt-px shrink-0" />
                            Your original is never changed. Each edit is saved as a new file beside it.
                        </p>
                    </div>

                    {/* Controls */}
                    <div className="p-6 md:p-8 flex flex-col">
                        <div role="tablist" aria-label="Edit type" className="relative grid grid-cols-3 gap-1 p-1 rounded-2xl bg-white/[0.04] border border-white/10 mr-12">
                            {TABS.map(t => {
                                const active = tab === t.id;
                                return (
                                    <button
                                        key={t.id}
                                        type="button"
                                        role="tab"
                                        aria-selected={active}
                                        onClick={() => setTab(t.id)}
                                        className={`outline-offset-[-2px] relative h-14 rounded-xl flex flex-col items-center justify-center gap-0.5 text-xs font-semibold transition-colors cursor-pointer ${active ? 'text-white' : 'text-white/45 hover:text-white/80'}`}
                                    >
                                        {active && (
                                            <motion.span
                                                layoutId="editor-tab"
                                                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                                                className="absolute inset-0 rounded-xl bg-white/[0.09] border border-white/15"
                                            />
                                        )}
                                        <span className="relative flex items-center gap-1.5">
                                            <t.Icon className="w-3.5 h-3.5" style={{ color: active ? t.from : undefined }} />
                                            {t.label}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                        <p className="mt-3 text-xs text-white/40">{meta.blurb}</p>

                        <div key={tab} className="lib-fade mt-5 flex-1 space-y-5">
                            {tab === 'audio' && (
                                <>
                                    <Chips
                                        label="Format"
                                        value={aFormat}
                                        onChange={setAFormat}
                                        options={[
                                            { id: 'mp3', label: 'MP3', sub: 'plays everywhere' },
                                            { id: 'm4a', label: 'M4A', sub: 'AAC · smaller' },
                                        ]}
                                    />
                                    <Chips
                                        label="Quality"
                                        value={aQuality}
                                        onChange={setAQuality}
                                        options={[
                                            { id: 'best', label: 'Best', sub: aFormat === 'mp3' ? '320 kbps' : '256 kbps' },
                                            { id: 'standard', label: 'Standard', sub: aFormat === 'mp3' ? '192 kbps' : '128 kbps' },
                                        ]}
                                    />
                                    <p className="text-xs text-white/45">
                                        About <span className="font-semibold text-white/80">{formatBytes(audioEstimate)}</span>, from a {formatBytes(item.size)} video. Tags carry over.
                                    </p>
                                </>
                            )}

                            {tab === 'convert' && (
                                <>
                                    <div>
                                        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-white/35">Quick presets</p>
                                        <div className="grid grid-cols-3 gap-2">
                                            {presets.map(p => (
                                                <button
                                                    key={p.name}
                                                    type="button"
                                                    onClick={p.apply}
                                                    className="rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.07] hover:border-white/25 px-3 py-2.5 text-left transition-colors cursor-pointer"
                                                >
                                                    <span className="block text-xs font-semibold text-white">{p.name}</span>
                                                    <span className="block mt-0.5 text-[10px] text-white/40">{p.sub}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <Chips
                                        label="Format"
                                        value={cFormat}
                                        onChange={setCFormat}
                                        options={[
                                            { id: 'mp4', label: 'MP4', sub: 'universal' },
                                            { id: 'webm', label: 'WebM', sub: 'slower, smaller' },
                                            { id: 'mkv', label: 'MKV', sub: 'flexible' },
                                        ]}
                                    />
                                    <Chips label="Resolution" value={cHeight} onChange={setCHeight} options={heights} />
                                    {heights.every(h => h.id === 0 || h.disabled) && (
                                        <p className="-mt-2 text-[11px] text-white/35">
                                            Already {srcMin}p, so there is nothing smaller to shrink to. Format and quality still apply.
                                        </p>
                                    )}
                                    <Chips
                                        label="Quality"
                                        value={cQuality}
                                        onChange={setCQuality}
                                        options={[
                                            { id: 'high', label: 'High', sub: 'bigger file' },
                                            { id: 'balanced', label: 'Balanced' },
                                            { id: 'small', label: 'Small', sub: 'smaller file' },
                                        ]}
                                    />
                                    <p className="text-xs text-white/45">
                                        Output <span className="font-semibold text-white/80">{cFormat.toUpperCase()}{outDims ? ` · ${outDims}` : ''}</span>
                                        {cFormat === 'webm' && ' · WebM can take a while on long videos'}
                                    </p>
                                </>
                            )}

                            {tab === 'gif' && (
                                <>
                                    {/* Timeline with the chosen window highlighted */}
                                    <div>
                                        <div className="relative h-2.5 rounded-full bg-white/10 overflow-hidden" aria-hidden="true">
                                            <div
                                                className="absolute inset-y-0 rounded-full bg-gradient-to-r from-fuchsia-400 to-orange-400 transition-[left,width] duration-150"
                                                style={{ left: `${(start / dur) * 100}%`, width: `${Math.max(1.5, (len / dur) * 100)}%` }}
                                            />
                                        </div>
                                        <div className="mt-1.5 flex justify-between text-[10px] text-white/30 tabular-nums">
                                            <span>0:00</span><span>{clock(dur)}</span>
                                        </div>
                                    </div>
                                    <Slider label="Start" value={start} min={0} max={Math.max(0, dur - len)} step={0.1} onChange={setGStart} display={clock(start)} />
                                    <Slider label="Length" value={len} min={0.5} max={maxLen} step={0.5} onChange={setGLen} display={`${len.toFixed(1)}s`} />
                                    <div className="grid grid-cols-2 gap-4">
                                        <Chips
                                            label="Width"
                                            value={gWidth}
                                            onChange={setGWidth}
                                            options={[{ id: 320, label: '320' }, { id: 480, label: '480' }, { id: 640, label: '640' }]}
                                        />
                                        <Chips
                                            label="Smoothness"
                                            value={gFps}
                                            onChange={setGFps}
                                            options={[{ id: 10, label: '10 fps' }, { id: 15, label: '15 fps' }, { id: 20, label: '20 fps' }]}
                                        />
                                    </div>
                                    <p className={`text-xs ${gifHeavy ? 'text-amber-300/80' : 'text-white/45'}`}>
                                        {gifHeavy
                                            ? 'This one will be a big file. Shorter, narrower or 10 fps keeps it small enough to share.'
                                            : 'Up to 15 seconds. Short and narrow GIFs stay small.'}
                                    </p>
                                </>
                            )}
                        </div>

                        <button
                            type="button"
                            onClick={run}
                            className="mt-7 h-12 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 cursor-pointer transition-[filter,transform] duration-150 hover:brightness-110 active:scale-[0.98]"
                            style={{ background: `linear-gradient(90deg, ${meta.from}, ${meta.to})`, boxShadow: `0 12px 30px -12px ${meta.from}` }}
                        >
                            {actionLabel} <ArrowRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </motion.div>
        </motion.div>
    );
}
