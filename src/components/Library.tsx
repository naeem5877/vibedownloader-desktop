import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ArrowLeft, Search, RefreshCw, FolderPlus, FolderOpen, Folder, Play, Pause, Trash2,
    Film, Music, Image as ImageIcon, X, Loader2, AlertTriangle, LayoutGrid, Wand2, CheckCircle2, ChevronDown, Check,
} from 'lucide-react';
import { LibraryEditor } from './LibraryEditor';

/* ------------------------------------------------------------------ helpers */

const PLATFORM_COLORS: Record<string, string> = {
    YouTube: '#FF0000',
    Instagram: '#E4405F',
    TikTok: '#25F4EE',
    Facebook: '#1877F2',
    Spotify: '#1DB954',
    'X (Twitter)': '#E7E9EA',
    Pinterest: '#E60023',
    SoundCloud: '#FF5500',
    Twitch: '#9146FF',
    Other: '#94A3B8',
};

const mediaUrl = (kind: 'thumb' | 'file', id: string) => `vibe-media://${kind}/${id}`;

function formatBytes(n: number): string {
    if (!n) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    const v = n / Math.pow(1024, i);
    return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

function formatDuration(s?: number): string {
    if (!s || !isFinite(s)) return '';
    const t = Math.round(s);
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const sec = t % 60;
    return h > 0
        ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
        : `${m}:${String(sec).padStart(2, '0')}`;
}

function ago(ms: number): string {
    const days = Math.floor((Date.now() - ms) / 86400000);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: days > 330 ? 'numeric' : undefined });
}

function resolutionLabel(item: LibraryItem): string | null {
    if (item.kind !== 'video' || !item.width || !item.height) return null;
    const m = Math.min(item.width, item.height);
    if (m >= 2000) return '4K';
    if (m >= 1300) return '1440p';
    if (m >= 1000) return '1080p';
    if (m >= 700) return '720p';
    if (m >= 450) return '480p';
    return `${m}p`;
}

const hashHue = (id: string) => parseInt(id.slice(0, 6), 16) % 360;

const basename = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;

interface EditJob {
    jobId: string;
    label: string;
    name: string;
    pct: number; // 0-100, or -1 when the length is unknown
    status: 'running' | 'done' | 'error';
    result?: LibraryEditResult;
}

type KindFilter = 'all' | LibraryItem['kind'];
type SortKey = 'newest' | 'oldest' | 'largest' | 'longest' | 'name';

const KIND_TABS: { id: KindFilter; label: string; Icon: typeof Film }[] = [
    { id: 'all', label: 'All', Icon: LayoutGrid },
    { id: 'video', label: 'Videos', Icon: Film },
    { id: 'audio', label: 'Audio', Icon: Music },
    { id: 'image', label: 'Images', Icon: ImageIcon },
];

const PAGE = 120;

/* --------------------------------------------------------------------- card */

interface CardProps {
    item: LibraryItem;
    index: number;
    playing: boolean;
    confirming: boolean;
    onOpen: (id: string) => void;
    onReveal: (id: string) => void;
    onTrash: (id: string) => void;
    onConfirm: (id: string | null) => void;
    onToggleAudio: (id: string) => void;
    onEdit: (item: LibraryItem) => void;
}

const IconBtn = ({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) => (
    <button
        type="button"
        aria-label={label}
        title={label}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        className="w-7 h-7 rounded-lg bg-black/70 border border-white/10 text-white/80 hover:text-white hover:bg-black/80 flex items-center justify-center transition-colors cursor-pointer"
    >
        {children}
    </button>
);

const Card = memo(function Card({ item, index, playing, confirming, onOpen, onReveal, onTrash, onConfirm, onToggleAudio, onEdit }: CardProps) {
    const [hover, setHover] = useState(false);
    const [preview, setPreview] = useState(false);
    const timer = useRef<number | undefined>(undefined);

    useEffect(() => () => window.clearTimeout(timer.current), []);

    const platformColor = PLATFORM_COLORS[item.platform] || PLATFORM_COLORS.Other;
    const accent = item.accent || platformColor;
    const portrait = !!item.width && !!item.height && item.height > item.width * 1.05;
    // Portrait clips and square album art are shown whole, over a blurred copy of
    // themselves, instead of being cropped to the card.
    const contain = portrait || item.kind === 'audio';
    const hue = hashHue(item.id);
    const KindIcon = item.kind === 'audio' ? Music : item.kind === 'image' ? ImageIcon : Film;
    const res = resolutionLabel(item);
    const duration = formatDuration(item.duration);

    const enter = () => {
        setHover(true);
        if (item.kind === 'video') {
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => setPreview(true), 350);
        }
    };
    const leave = () => {
        window.clearTimeout(timer.current);
        setHover(false);
        setPreview(false);
        if (confirming) onConfirm(null);
    };

    return (
        <motion.div
            initial={index < 16 ? { opacity: 0, y: 10 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: Math.min(index, 16) * 0.025 }}
            role="button"
            tabIndex={0}
            aria-label={`Open ${item.name}`}
            onClick={() => onOpen(item.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(item.id); } }}
            onMouseEnter={enter}
            onMouseLeave={leave}
            className="group relative [content-visibility:auto] [contain-intrinsic-size:auto_250px] rounded-2xl overflow-hidden bg-white/[0.03] border border-white/[0.07] cursor-pointer transition-[transform,border-color] duration-300 hover:-translate-y-0.5"
            style={{
                borderColor: hover ? `${accent}66` : undefined,
            }}
        >
            {/* Artwork */}
            <div className="relative aspect-video overflow-hidden bg-black/50">
                {item.hasThumb ? (
                    <>
                        {contain && (<div aria-hidden="true" className="absolute inset-0" style={{ background: `radial-gradient(90% 100% at 50% 35%, ${accent}73, ${accent}1f 65%, #0b0b0d)` }} />)}
                        <img
                            src={mediaUrl('thumb', item.id)}
                            alt=""
                            loading="lazy" decoding="async"
                            draggable={false}
                            className={`relative w-full h-full ${contain ? 'object-contain' : 'object-cover'} transition-transform duration-500 ${hover ? 'scale-[1.04]' : ''}`}
                        />
                    </>
                ) : (
                    <div
                        className="absolute inset-0 flex items-center justify-center"
                        style={{ background: `linear-gradient(135deg, hsl(${hue} 50% 22%), hsl(${(hue + 45) % 360} 55% 9%))` }}
                    >
                        {item.kind === 'audio' && (
                            <>
                                <span className="absolute w-36 h-36 rounded-full border border-white/[0.07]" />
                                <span className="absolute w-24 h-24 rounded-full border border-white/10" />
                            </>
                        )}
                        <KindIcon className="relative w-8 h-8 text-white/40" strokeWidth={1.5} />
                    </div>
                )}

                {preview && item.kind === 'video' && (
                    <video
                        src={mediaUrl('file', item.id)}
                        muted
                        loop
                        autoPlay
                        playsInline
                        preload="auto"
                        className={`absolute inset-0 w-full h-full bg-black ${contain ? 'object-contain' : 'object-cover'}`}
                    />
                )}

                {/* Soft vignette so the overlays stay readable on bright artwork */}
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/25" />

                <span className="absolute top-2 left-2 flex items-center gap-1.5 h-6 px-2 rounded-md bg-black/70 text-[10px] font-semibold text-white/85">
                    <i className="w-1.5 h-1.5 rounded-full" style={{ background: platformColor }} />
                    {item.platform}
                </span>

                {duration && (
                    <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/70 text-[10px] font-bold tabular-nums text-white">
                        {duration}
                    </span>
                )}

                {/* Audio: play in place, with a live equaliser while it plays */}
                {item.kind === 'audio' && (
                    <>
                        <button
                            type="button"
                            aria-label={playing ? 'Pause' : 'Play'}
                            onClick={(e) => { e.stopPropagation(); onToggleAudio(item.id); }}
                            className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-11 h-11 rounded-full flex items-center justify-center bg-black/70 border border-white/20 text-white transition-all duration-200 cursor-pointer hover:scale-110 ${playing || hover ? 'opacity-100' : 'opacity-0 group-focus-within:opacity-100'}`}
                        >
                            {playing ? <Pause className="w-4 h-4" fill="currentColor" /> : <Play className="w-4 h-4 ml-0.5" fill="currentColor" />}
                        </button>
                        {playing && (
                            <div className="absolute left-2 bottom-2 flex items-end gap-[3px] h-4" aria-hidden="true">
                                {[0, 1, 2, 3].map(i => (
                                    <span
                                        key={i}
                                        className="w-[3px] h-full rounded-full origin-bottom"
                                        style={{ background: accent, animation: `eq ${0.7 + i * 0.13}s ease-in-out ${i * 0.1}s infinite` }}
                                    />
                                ))}
                            </div>
                        )}
                    </>
                )}

                {item.kind === 'video' && !preview && (
                    <div className={`pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-11 h-11 rounded-full flex items-center justify-center bg-black/70 border border-white/20 text-white transition-opacity duration-200 ${hover ? 'opacity-100' : 'opacity-0'}`}>
                        <Play className="w-4 h-4 ml-0.5" fill="currentColor" />
                    </div>
                )}

                <div className={`absolute top-2 right-2 flex gap-1.5 transition-opacity duration-200 ${hover || confirming ? 'opacity-100' : 'opacity-0 group-focus-within:opacity-100'}`}>
                    {item.kind === 'video' && (
                        <IconBtn label="Edit: audio, convert, GIF" onClick={() => onEdit(item)}>
                            <Wand2 className="w-3.5 h-3.5" />
                        </IconBtn>
                    )}
                    <IconBtn label="Show in folder" onClick={() => onReveal(item.id)}>
                        <FolderOpen className="w-3.5 h-3.5" />
                    </IconBtn>
                    {confirming ? (
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onTrash(item.id); }}
                            className="h-7 px-2 rounded-lg bg-red-500 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer hover:bg-red-400 transition-colors"
                        >
                            <Trash2 className="w-3 h-3" /> Delete?
                        </button>
                    ) : (
                        <IconBtn label="Move to Recycle Bin" onClick={() => onConfirm(item.id)}>
                            <Trash2 className="w-3.5 h-3.5" />
                        </IconBtn>
                    )}
                </div>
            </div>

            {/* Details */}
            <div className="px-3.5 py-3">
                <p className="text-[13px] font-semibold text-white leading-snug truncate" title={item.name}>{item.name}</p>
                <p className="mt-1 text-[11px] text-white/45 truncate">
                    {[item.artist, item.ext.toUpperCase(), res, formatBytes(item.size), ago(item.mtime)].filter(Boolean).join(' · ')}
                </p>
            </div>
        </motion.div>
    );
});

/* ----------------------------------------------------------------- skeleton */

// A placeholder shaped like a real card (same artwork ratio, title and meta
// lines), so nothing jumps when the real card replaces it. The varying line
// widths keep a wall of them from looking like a repeated stamp.
const SkeletonCard = memo(function SkeletonCard({ index }: { index: number }) {
    const delay = `${(index % 12) * 90}ms`;
    const titleW = ['72%', '58%', '84%', '66%'][index % 4];
    const metaW = ['46%', '38%', '52%'][index % 3];
    return (
        <div
            className="lib-skeleton rounded-2xl bg-white/[0.025] border border-white/[0.06]"
            style={{ animationDelay: delay, ['--lib-d' as string]: delay }}
        >
            <div className="relative aspect-video bg-white/[0.035] flex items-center justify-center">
                <span className="w-9 h-9 rounded-full bg-white/[0.05]" />
            </div>
            <div className="px-3.5 py-3 space-y-2.5">
                <div className="h-3 rounded-md bg-white/[0.07]" style={{ width: titleW }} />
                <div className="h-2.5 rounded-md bg-white/[0.045]" style={{ width: metaW }} />
            </div>
        </div>
    );
});

/* ---------------------------------------------------------------- sort menu */

const SORT_OPTIONS: { id: SortKey; label: string }[] = [
    { id: 'newest', label: 'Newest first' },
    { id: 'oldest', label: 'Oldest first' },
    { id: 'largest', label: 'Largest first' },
    { id: 'longest', label: 'Longest first' },
    { id: 'name', label: 'Name (A–Z)' },
];

// Replaces the browser's own select element, whose popup cannot be styled and shows a
// system-blue highlight. Fully keyboard-driven: arrows, Enter/Space, Esc.
function SortMenu({ value, onChange }: { value: SortKey; onChange: (v: SortKey) => void }) {
    const [open, setOpen] = useState(false);
    const [cursor, setCursor] = useState(0);
    const selected = Math.max(0, SORT_OPTIONS.findIndex(o => o.id === value));

    const openMenu = () => { setCursor(selected); setOpen(true); };
    const pick = (i: number) => { onChange(SORT_OPTIONS[i].id); setOpen(false); };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (!open) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openMenu(); }
            return;
        }
        const n = SORT_OPTIONS.length;
        if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => (c + 1) % n); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => (c - 1 + n) % n); }
        else if (e.key === 'Home') { e.preventDefault(); setCursor(0); }
        else if (e.key === 'End') { e.preventDefault(); setCursor(n - 1); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(cursor); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
        else if (e.key === 'Tab') setOpen(false);
    };

    return (
        <div className="relative">
            <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label={`Sort: ${SORT_OPTIONS[selected].label}`}
                onClick={() => (open ? setOpen(false) : openMenu())}
                onKeyDown={onKeyDown}
                className={`h-10 pl-3.5 pr-3 rounded-xl border text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer ${open ? 'bg-white/10 border-white/25 text-white' : 'bg-white/[0.04] border-white/10 text-white/80 hover:bg-white/[0.07]'}`}
            >
                <span className="font-medium text-white/35">Sort</span>
                {SORT_OPTIONS[selected].label}
                <ChevronDown className={`w-3.5 h-3.5 text-white/45 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence>
                {open && (
                    <>
                        <button type="button" aria-label="Close sort menu" tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
                        <motion.ul
                            role="listbox"
                            initial={{ opacity: 0, y: -4, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -4, scale: 0.98 }}
                            transition={{ duration: 0.12, ease: 'easeOut' }}
                            className="absolute left-0 top-12 z-20 w-52 origin-top-left rounded-xl bg-[#131316] border border-white/10 shadow-xl shadow-black/60 p-1"
                        >
                            {SORT_OPTIONS.map((o, i) => {
                                const active = o.id === value;
                                return (
                                    <li key={o.id} role="option" aria-selected={active}>
                                        <button
                                            type="button"
                                            tabIndex={-1}
                                            onClick={() => pick(i)}
                                            onMouseEnter={() => setCursor(i)}
                                            className={`w-full h-9 px-3 rounded-lg text-xs flex items-center justify-between cursor-pointer transition-colors ${i === cursor ? 'bg-white/[0.08]' : ''} ${active ? 'font-semibold text-white' : 'font-medium text-white/65'}`}
                                        >
                                            {o.label}
                                            {active && <Check className="w-3.5 h-3.5 text-white/80" />}
                                        </button>
                                    </li>
                                );
                            })}
                        </motion.ul>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
}

/* ------------------------------------------------------------------ gallery */

export function Library({ onClose }: { onClose: () => void }) {
    const [items, setItems] = useState<Record<string, LibraryItem>>({});
    const [roots, setRoots] = useState<LibraryRoot[]>([]);
    const [ffmpeg, setFfmpeg] = useState<boolean | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [scanning, setScanning] = useState(false);
    const [progress, setProgress] = useState({ done: 0, total: 0 });

    const [query, setQuery] = useState('');
    const [kind, setKind] = useState<KindFilter>('all');
    const [platform, setPlatform] = useState('all');
    const [sort, setSort] = useState<SortKey>('newest');
    const [visible, setVisible] = useState(PAGE);

    const [showFolders, setShowFolders] = useState(false);
    const [playingId, setPlayingId] = useState<string | null>(null);
    const [confirmId, setConfirmId] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    // Editor: which video is open in the studio, and the one job that may run at a time.
    const [editItem, setEditItem] = useState<LibraryItem | null>(null);
    const [job, setJob] = useState<EditJob | null>(null);
    const jobRef = useRef<EditJob | null>(null);

    const scrollRef = useRef<HTMLDivElement>(null);
    const sentinelRef = useRef<HTMLDivElement>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const playingRef = useRef<string | null>(null);

    const setPlaying = (id: string | null) => { playingRef.current = id; setPlayingId(id); };

    const startScan = useCallback(async () => {
        setScanning(true);
        const res = await window.electron.libraryScan();
        if (!res.success) setNotice(res.error || 'The scan did not finish.');
        setScanning(false);
        try {
            const r = await window.electron.libraryList();
            setRoots(r.roots);
            setFfmpeg(r.ffmpeg);
        } catch { /* keep what we have */ }
    }, []);

    // Show the cached library straight away, then bring it up to date. Items are
    // buffered and applied a few times a second so a big first scan does not
    // re-render the grid once per file.
    useEffect(() => {
        let cancelled = false;
        const pendingItems: LibraryItem[] = [];
        let pendingRemoved: string[] = [];

        const flush = () => {
            if (!pendingItems.length && !pendingRemoved.length) return;
            const add = pendingItems.splice(0);
            const rem = pendingRemoved;
            pendingRemoved = [];
            setItems(prev => {
                const next = { ...prev };
                for (const id of rem) delete next[id];
                for (const it of add) next[it.id] = it;
                return next;
            });
        };
        const tick = window.setInterval(flush, 200);

        const off = window.electron.onLibraryScanProgress((p) => {
            if (cancelled) return;
            if (p.phase === 'scanning') {
                setScanning(true);
                setProgress({ done: 0, total: 0 });
            } else if (p.phase === 'processing') {
                setScanning(true);
                setProgress({ done: p.done, total: p.total });
                if (p.removed && p.removed.length) pendingRemoved.push(...p.removed);
                if (p.item) pendingItems.push(p.item);
            } else if (p.phase === 'done') {
                flush();
                setScanning(false);
            }
        });

        (async () => {
            try {
                const r = await window.electron.libraryList();
                if (cancelled) return;
                const rec: Record<string, LibraryItem> = {};
                for (const it of r.items) rec[it.id] = it;
                setItems(rec);
                setRoots(r.roots);
                setFfmpeg(r.ffmpeg);
            } catch { /* fall through to a scan */ }
            if (cancelled) return;
            setLoaded(true);
            startScan();
        })();

        return () => {
            cancelled = true;
            window.clearInterval(tick);
            off();
            audioRef.current?.pause();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            if (editItem) setEditItem(null);
            else if (showFolders) setShowFolders(false);
            else onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [showFolders, editItem, onClose]);

    // Progress from the running edit.
    useEffect(() => {
        const off = window.electron.onLibraryEditProgress(({ jobId, pct }) => {
            setJob(j => (j && j.jobId === jobId && j.status === 'running' ? { ...j, pct } : j));
        });
        return off;
    }, []);

    useEffect(() => {
        if (!notice) return;
        const t = window.setTimeout(() => setNotice(null), 4000);
        return () => window.clearTimeout(t);
    }, [notice]);

    useEffect(() => {
        if (!confirmId) return;
        const t = window.setTimeout(() => setConfirmId(null), 3500);
        return () => window.clearTimeout(t);
    }, [confirmId]);

    /* ---------------------------------------------------------- derived data */

    const all = useMemo(() => Object.values(items), [items]);

    const counts = useMemo(() => {
        const kinds: Record<KindFilter, number> = { all: all.length, video: 0, audio: 0, image: 0 };
        const platforms: Record<string, number> = {};
        for (const it of all) {
            kinds[it.kind]++;
            platforms[it.platform] = (platforms[it.platform] || 0) + 1;
        }
        return { kinds, platforms };
    }, [all]);

    const platformList = useMemo(
        () => Object.entries(counts.platforms).sort((a, b) => b[1] - a[1]),
        [counts]
    );

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        let list = all.filter(it =>
            (kind === 'all' || it.kind === kind) &&
            (platform === 'all' || it.platform === platform) &&
            (!q || it.name.toLowerCase().includes(q) || (it.artist || '').toLowerCase().includes(q) || it.platform.toLowerCase().includes(q))
        );
        list = [...list];
        switch (sort) {
            case 'oldest': list.sort((a, b) => a.mtime - b.mtime); break;
            case 'largest': list.sort((a, b) => b.size - a.size); break;
            case 'longest': list.sort((a, b) => (b.duration || 0) - (a.duration || 0)); break;
            case 'name': list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })); break;
            default: list.sort((a, b) => b.mtime - a.mtime);
        }
        return list;
    }, [all, query, kind, platform, sort]);

    const totalSize = useMemo(() => all.reduce((n, it) => n + it.size, 0), [all]);
    const shown = useMemo(() => filtered.slice(0, visible), [filtered, visible]);

    useEffect(() => { setVisible(PAGE); }, [query, kind, platform, sort]);

    // Render the grid in pages as the user scrolls.
    useEffect(() => {
        const el = sentinelRef.current;
        if (!el || visible >= filtered.length) return;
        const io = new IntersectionObserver((entries) => {
            if (entries.some(e => e.isIntersecting)) setVisible(v => v + PAGE);
        }, { root: scrollRef.current, rootMargin: '600px' });
        io.observe(el);
        return () => io.disconnect();
    }, [visible, filtered.length]);

    /* --------------------------------------------------------------- actions */

    const handleOpen = useCallback(async (id: string) => {
        const r = await window.electron.libraryOpen(id);
        if (!r.success) {
            if (r.error === 'missing') {
                setNotice('That file was moved or deleted. Refreshing your library…');
                startScan();
            } else {
                setNotice('Could not open that file.');
            }
        }
    }, [startScan]);

    const handleReveal = useCallback(async (id: string) => {
        const r = await window.electron.libraryReveal(id);
        if (!r.success) {
            setNotice('That file was moved or deleted. Refreshing your library…');
            startScan();
        }
    }, [startScan]);

    const handleTrash = useCallback(async (id: string) => {
        setConfirmId(null);
        if (playingRef.current === id) { audioRef.current?.pause(); setPlaying(null); }
        const r = await window.electron.libraryTrash(id);
        if (r.success) {
            setItems(prev => { const next = { ...prev }; delete next[id]; return next; });
        } else {
            setNotice(r.error || 'Could not move it to the Recycle Bin.');
        }
    }, []);

    const handleToggleAudio = useCallback((id: string) => {
        audioRef.current?.pause();
        if (playingRef.current === id) { setPlaying(null); return; }
        const a = new Audio(mediaUrl('file', id));
        a.onended = () => { if (playingRef.current === id) setPlaying(null); };
        // Formats the built-in player cannot decode (WMA, AIFF…) go to the system player.
        a.onerror = () => { if (playingRef.current === id) setPlaying(null); handleOpen(id); };
        audioRef.current = a;
        a.play().then(() => setPlaying(id)).catch(() => { setPlaying(null); handleOpen(id); });
    }, [handleOpen]);

    const startEdit = useCallback(async (it: LibraryItem, req: LibraryEditRequest, label: string) => {
        if (jobRef.current?.status === 'running') {
            setNotice('Finish or cancel the current edit first.');
            return;
        }
        const jobId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const start: EditJob = { jobId, label, name: it.name, pct: req.type === 'gif' || it.duration ? 0 : -1, status: 'running' };
        jobRef.current = start;
        setJob(start);
        setEditItem(null);

        const res = await window.electron.libraryEdit(jobId, it.id, req);
        if (jobRef.current?.jobId !== jobId) return; // dismissed while it ran

        if (res.cancelled) {
            jobRef.current = null;
            setJob(null);
            return;
        }
        const end: EditJob = { ...start, pct: 100, status: res.success ? 'done' : 'error', result: res };
        jobRef.current = end;
        setJob(end);
        if (res.item) {
            const made = res.item;
            setItems(prev => ({ ...prev, [made.id]: made }));
        }
    }, []);

    const cancelEdit = () => {
        const j = jobRef.current;
        if (j && j.status === 'running') window.electron.libraryEditCancel(j.jobId);
    };

    const dismissJob = () => { jobRef.current = null; setJob(null); };

    const addFolder = async () => {
        const r = await window.electron.libraryAddFolder();
        setRoots(r.roots);
        startScan();
    };

    const removeFolder = async (folder: string) => {
        const r = await window.electron.libraryRemoveFolder(folder);
        setRoots(r.roots);
        if (r.removedIds.length) {
            setItems(prev => { const next = { ...prev }; for (const id of r.removedIds) delete next[id]; return next; });
        }
    };

    const clearFilters = () => { setQuery(''); setKind('all'); setPlatform('all'); };

    const currentRoot = roots.find(r => r.current);
    const pct = progress.total > 0 ? Math.min(100, (progress.done / progress.total) * 100) : 0;
    const filtersActive = !!query || kind !== 'all' || platform !== 'all';

    /* ---------------------------------------------------------------- render */

    return (
        <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 14 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="fixed left-0 right-0 bottom-0 top-8 z-[60] bg-[#0a0a0a] text-white flex flex-col"
        >
            {/* Header */}
            <header className="relative shrink-0 border-b border-white/[0.06]">
                <div className="max-w-[1400px] mx-auto w-full px-6 pt-5 pb-4 space-y-4">
                    <div className="flex items-center gap-4">
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="Back to downloader"
                            title="Back (Esc)"
                            className="w-10 h-10 rounded-xl bg-white/[0.05] border border-white/10 hover:bg-white/10 flex items-center justify-center text-white/70 hover:text-white transition-colors cursor-pointer"
                        >
                            <ArrowLeft className="w-[18px] h-[18px]" />
                        </button>

                        <div className="min-w-0">
                            <h2 className="text-2xl font-black tracking-tight font-['Montserrat'] leading-none">Library</h2>
                            <p className="mt-1.5 text-xs text-white/45">
                                {all.length === 0 && !scanning
                                    ? 'Everything you download shows up here'
                                    : `${all.length.toLocaleString()} ${all.length === 1 ? 'item' : 'items'} · ${formatBytes(totalSize)}`}
                            </p>
                        </div>

                        <div className="ml-auto flex items-center gap-2">
                            {scanning && (
                                <span className="hidden sm:flex items-center gap-2 h-9 px-3 rounded-xl bg-white/[0.04] border border-white/10 text-xs text-white/60">
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    {progress.total > 0 ? `Indexing ${progress.done} / ${progress.total}` : 'Scanning folders…'}
                                </span>
                            )}
                            <button
                                type="button"
                                onClick={startScan}
                                disabled={scanning}
                                className="h-9 px-3.5 rounded-xl bg-white/[0.05] border border-white/10 hover:bg-white/10 text-xs font-semibold text-white/80 flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} /> Rescan
                            </button>
                            <div className="relative">
                                <button
                                    type="button"
                                    onClick={() => setShowFolders(v => !v)}
                                    aria-expanded={showFolders}
                                    className={`h-9 px-3.5 rounded-xl border text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer ${showFolders ? 'bg-white/10 border-white/20 text-white' : 'bg-white/[0.05] border-white/10 hover:bg-white/10 text-white/80'}`}
                                >
                                    <Folder className="w-3.5 h-3.5" /> Folders
                                    <span className="text-white/40 tabular-nums">{roots.length}</span>
                                </button>

                                {showFolders && (
                                    <>
                                        <button
                                            type="button"
                                            aria-label="Close folders"
                                            className="fixed inset-0 z-10 cursor-default"
                                            onClick={() => setShowFolders(false)}
                                        />
                                        <motion.div
                                            initial={{ opacity: 0, y: -6 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ duration: 0.15 }}
                                            className="absolute right-0 top-11 z-20 w-[380px] rounded-2xl bg-[#121214] border border-white/10 shadow-2xl shadow-black/60 p-2"
                                        >
                                            <p className="px-3 pt-2 pb-2 text-[10px] font-bold uppercase tracking-widest text-white/35">
                                                Scanned folders
                                            </p>
                                            <div className="max-h-64 overflow-y-auto">
                                                {roots.map(r => {
                                                    const n = all.filter(i => i.root === r.path).length;
                                                    return (
                                                        <div key={r.path} className="group/row flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/[0.04]">
                                                            <Folder className={`w-4 h-4 shrink-0 ${r.exists ? 'text-white/50' : 'text-amber-400/80'}`} />
                                                            <div className="min-w-0 flex-1">
                                                                <p className="text-xs font-semibold text-white/85 truncate flex items-center gap-2">
                                                                    {basename(r.path)}
                                                                    {r.current && <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-bold uppercase tracking-wider">Download folder</span>}
                                                                    {!r.exists && <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 font-bold uppercase tracking-wider">Not found</span>}
                                                                </p>
                                                                <p className="text-[10px] text-white/35 truncate" title={r.path}>{r.path}</p>
                                                            </div>
                                                            <span className="text-[11px] text-white/40 tabular-nums">{n}</span>
                                                            {!r.current && (
                                                                <button
                                                                    type="button"
                                                                    aria-label={`Stop scanning ${r.path}`}
                                                                    title="Stop scanning this folder"
                                                                    onClick={() => removeFolder(r.path)}
                                                                    className="w-6 h-6 rounded-md text-white/30 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors cursor-pointer"
                                                                >
                                                                    <X className="w-3.5 h-3.5" />
                                                                </button>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                            <button
                                                type="button"
                                                onClick={addFolder}
                                                className="mt-1 w-full h-10 rounded-xl border border-dashed border-white/15 hover:border-white/30 hover:bg-white/[0.04] text-xs font-semibold text-white/70 hover:text-white flex items-center justify-center gap-2 transition-colors cursor-pointer"
                                            >
                                                <FolderPlus className="w-4 h-4" /> Add a folder
                                            </button>
                                            <p className="px-3 pt-2.5 pb-1.5 text-[10px] leading-relaxed text-white/30">
                                                If you change your download location, the new folder is added automatically and the old one keeps being scanned.
                                            </p>
                                        </motion.div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Search / type / sort */}
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="relative flex-1 min-w-[220px] max-w-md">
                            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/25 pointer-events-none" />
                            <input
                                type="text"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Search titles, artists, platforms…"
                                className="w-full h-10 pl-10 pr-9 rounded-xl bg-white/[0.04] border border-white/10 focus:border-white/25 outline-none text-sm text-white placeholder-white/25 transition-colors"
                            />
                            {query && (
                                <button
                                    type="button"
                                    aria-label="Clear search"
                                    onClick={() => setQuery('')}
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md text-white/35 hover:text-white hover:bg-white/10 flex items-center justify-center cursor-pointer"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>

                        <div role="group" aria-label="Filter by type" className="inline-flex p-1 rounded-xl bg-white/[0.04] border border-white/10">
                            {KIND_TABS.map(({ id, label, Icon }) => {
                                const active = kind === id;
                                return (
                                    <button
                                        key={id}
                                        type="button"
                                        aria-pressed={active}
                                        onClick={() => setKind(id)}
                                        className={`h-8 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${active ? 'bg-white/10 text-white' : 'text-white/45 hover:text-white/80'}`}
                                    >
                                        <Icon className="w-3.5 h-3.5" />
                                        {label}
                                        <span className="text-white/35 tabular-nums">{counts.kinds[id]}</span>
                                    </button>
                                );
                            })}
                        </div>

                        <SortMenu value={sort} onChange={setSort} />
                    </div>

                    {platformList.length > 1 && (
                        <div className="flex items-center gap-2 overflow-x-auto scrollbar-none -mx-1 px-1">
                            {[['all', all.length] as [string, number], ...platformList].map(([name, n]) => {
                                const active = platform === name;
                                const color = PLATFORM_COLORS[name] || PLATFORM_COLORS.Other;
                                return (
                                    <button
                                        key={name}
                                        type="button"
                                        aria-pressed={active}
                                        onClick={() => setPlatform(name)}
                                        className={`shrink-0 h-8 px-3 rounded-full border text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer ${active ? 'bg-white/10 border-white/25 text-white' : 'bg-transparent border-white/10 text-white/50 hover:text-white/80 hover:border-white/20'}`}
                                    >
                                        {name !== 'all' && <i className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />}
                                        {name === 'all' ? 'All platforms' : name}
                                        <span className="text-white/35 tabular-nums">{n}</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Scan progress */}
                <div className={`absolute left-0 right-0 bottom-[-1px] h-[3px] overflow-hidden transition-opacity duration-300 ${scanning ? 'opacity-100' : 'opacity-0'}`}>
                    {progress.total > 0 ? (
                        <div
                            className="relative h-full overflow-hidden rounded-r-full bg-gradient-to-r from-sky-400 via-violet-400 to-fuchsia-400 shadow-[0_0_14px_rgba(167,139,250,0.7)] transition-[width] duration-500 ease-out"
                            style={{ width: `${Math.max(pct, 3)}%` }}
                        >
                            <span className="absolute inset-y-0 w-1/3 bg-white/60 blur-[2px]" style={{ animation: 'lib-slide 1.4s ease-in-out infinite' }} />
                        </div>
                    ) : (
                        <div
                            className="h-full w-1/4 rounded-full bg-gradient-to-r from-transparent via-violet-300 to-transparent"
                            style={{ animation: 'lib-slide 1.3s ease-in-out infinite' }}
                        />
                    )}
                </div>
            </header>

            {/* Body */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto [scrollbar-gutter:stable]">
                <div className="max-w-[1400px] mx-auto w-full px-6 pt-6 pb-16">
                    {ffmpeg === false && (
                        <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3 text-xs text-amber-200/85">
                            <AlertTriangle className="w-4 h-4 mt-px shrink-0 text-amber-400" />
                            <p className="leading-relaxed">
                                Video previews and album artwork need FFmpeg, which isn't ready yet. It downloads automatically in the background, so press Rescan in a minute and the covers will appear.
                            </p>
                        </div>
                    )}

                    {(!loaded || (all.length === 0 && scanning)) ? (
                        <div aria-busy="true" aria-live="polite" className="relative">
                            {/* Status line, so the wait has a reason and a number */}
                            <div className="flex items-center gap-2.5 mb-5 text-xs text-white/55">
                                <span className="relative flex w-2 h-2">
                                    <span className="absolute inline-flex w-full h-full rounded-full bg-violet-400/60 animate-ping" />
                                    <span className="relative inline-flex w-2 h-2 rounded-full bg-violet-400" />
                                </span>
                                {!loaded
                                    ? 'Opening your library…'
                                    : progress.total > 0
                                        ? `Building covers · ${progress.done} of ${progress.total}`
                                        : 'Looking through your folders…'}
                            </div>

                            {/* Beam sweeping down the grid */}
                            <div className="pointer-events-none absolute inset-x-0 top-0 h-full overflow-hidden" aria-hidden="true">
                                <div
                                    className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-transparent via-violet-400/[0.09] to-transparent"
                                    style={{ animation: 'lib-beam 2.6s ease-in-out infinite' }}
                                />
                            </div>

                            <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(230px,1fr))]">
                                {Array.from({ length: 12 }).map((_, i) => <SkeletonCard key={i} index={i} />)}
                            </div>
                        </div>
                    ) : all.length === 0 ? (
                        <div className="flex flex-col items-center text-center py-24">
                            <div className="w-20 h-20 rounded-3xl bg-white/[0.04] border border-white/10 flex items-center justify-center mb-6">
                                <LayoutGrid className="w-8 h-8 text-white/30" strokeWidth={1.5} />
                            </div>
                            <h3 className="text-lg font-bold">Nothing here yet</h3>
                            <p className="mt-2 max-w-sm text-sm text-white/45 leading-relaxed">
                                Download something and it will appear here, or add a folder that already has videos and music in it.
                            </p>
                            {currentRoot && (
                                <p className="mt-3 max-w-md text-[11px] text-white/30 break-all">Looking in {currentRoot.path}</p>
                            )}
                            <div className="mt-6 flex gap-2">
                                <button type="button" onClick={addFolder} className="h-10 px-4 rounded-xl bg-white text-black text-xs font-bold flex items-center gap-2 cursor-pointer hover:bg-white/90 transition-colors">
                                    <FolderPlus className="w-4 h-4" /> Add a folder
                                </button>
                                <button type="button" onClick={startScan} className="h-10 px-4 rounded-xl bg-white/[0.05] border border-white/10 text-xs font-semibold text-white/80 flex items-center gap-2 cursor-pointer hover:bg-white/10 transition-colors">
                                    <RefreshCw className="w-3.5 h-3.5" /> Rescan
                                </button>
                            </div>
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="flex flex-col items-center text-center py-24">
                            <Search className="w-8 h-8 text-white/25 mb-4" strokeWidth={1.5} />
                            <h3 className="text-base font-bold">No matches</h3>
                            <p className="mt-1.5 text-sm text-white/40">Nothing in your library fits those filters.</p>
                            {filtersActive && (
                                <button type="button" onClick={clearFilters} className="mt-5 h-9 px-4 rounded-xl bg-white/[0.05] border border-white/10 text-xs font-semibold text-white/80 hover:bg-white/10 cursor-pointer transition-colors">
                                    Clear filters
                                </button>
                            )}
                        </div>
                    ) : (
                        <>
                            <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(230px,1fr))]">
                                {shown.map((it, i) => (
                                    <Card
                                        key={it.id}
                                        item={it}
                                        index={i}
                                        playing={playingId === it.id}
                                        confirming={confirmId === it.id}
                                        onOpen={handleOpen}
                                        onReveal={handleReveal}
                                        onTrash={handleTrash}
                                        onConfirm={setConfirmId}
                                        onToggleAudio={handleToggleAudio}
                                        onEdit={setEditItem}
                                    />
                                ))}
                                {/* While a scan is still building covers, placeholders trail the
                                    real cards so the grid visibly fills in instead of just growing. */}
                                {scanning && progress.total > progress.done && visible >= filtered.length &&
                                    Array.from({ length: Math.min(progress.total - progress.done, 6) }).map((_, i) => (
                                        <SkeletonCard key={`sk-${i}`} index={i} />
                                    ))}
                            </div>
                            {visible < filtered.length && <div ref={sentinelRef} className="h-10" aria-hidden="true" />}
                        </>
                    )}
                </div>
            </div>

            <AnimatePresence>
                {editItem && (
                    <LibraryEditor
                        key={editItem.id}
                        item={editItem}
                        onClose={() => setEditItem(null)}
                        onRun={(req, label) => startEdit(editItem, req, label)}
                    />
                )}
            </AnimatePresence>

            {/* Progress dock: shows the running edit, then what it made */}
            <AnimatePresence>
                {job && (
                    <motion.div
                        key={job.jobId}
                        initial={{ opacity: 0, y: 16, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10 }}
                        transition={{ duration: 0.2 }}
                        role="status"
                        aria-live="polite"
                        className="absolute bottom-5 right-5 z-[75] w-[min(380px,calc(100%-2.5rem))] rounded-2xl bg-[#131316]/95 border border-white/10 shadow-2xl shadow-black/60 p-4"
                    >
                        {job.status === 'running' && (
                            <>
                                <div className="flex items-center gap-3">
                                    <Loader2 className="w-4 h-4 shrink-0 animate-spin text-violet-300" />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-[13px] font-semibold text-white truncate">{job.label}</p>
                                        <p className="text-[11px] text-white/40 truncate" title={job.name}>{job.name}</p>
                                    </div>
                                    <span className="text-xs font-semibold tabular-nums text-white/70">
                                        {job.pct >= 0 ? `${Math.floor(job.pct)}%` : '…'}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={cancelEdit}
                                        aria-label="Cancel"
                                        title="Cancel"
                                        className="w-7 h-7 rounded-lg text-white/40 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors cursor-pointer"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                                <div className="mt-3 h-1.5 rounded-full bg-white/10 overflow-hidden">
                                    {job.pct >= 0 ? (
                                        <div
                                            className="h-full rounded-full bg-gradient-to-r from-sky-400 via-violet-400 to-fuchsia-400 transition-[width] duration-200 ease-out"
                                            style={{ width: `${Math.max(job.pct, 3)}%` }}
                                        />
                                    ) : (
                                        <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-transparent via-violet-300 to-transparent" style={{ animation: 'lib-slide 1.3s ease-in-out infinite' }} />
                                    )}
                                </div>
                            </>
                        )}

                        {job.status === 'done' && (
                            <>
                                <div className="flex items-start gap-3">
                                    <CheckCircle2 className="w-5 h-5 mt-0.5 shrink-0 text-emerald-400" />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-[13px] font-semibold text-white">Saved to your library</p>
                                        <p className="text-[11px] text-white/45 truncate" title={job.result?.item?.name}>{job.result?.item?.name || job.name}</p>
                                        {job.result?.inBytes != null && job.result?.outBytes != null && (
                                            <p className="mt-1 text-[11px] text-white/55 tabular-nums">
                                                {formatBytes(job.result.inBytes)} → {formatBytes(job.result.outBytes)}
                                                {job.result.outBytes < job.result.inBytes && (
                                                    <span className="ml-1.5 text-emerald-300">
                                                        {Math.round((1 - job.result.outBytes / job.result.inBytes) * 100)}% smaller
                                                    </span>
                                                )}
                                            </p>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={dismissJob}
                                        aria-label="Dismiss"
                                        className="w-7 h-7 rounded-lg text-white/40 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors cursor-pointer"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                                {job.result?.item && (
                                    <div className="mt-3 flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => handleOpen(job.result!.item!.id)}
                                            className="flex-1 h-9 rounded-xl bg-white text-black text-xs font-bold hover:bg-white/90 transition-colors cursor-pointer"
                                        >
                                            Open
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleReveal(job.result!.item!.id)}
                                            className="flex-1 h-9 rounded-xl bg-white/[0.06] border border-white/10 text-xs font-semibold text-white/80 hover:bg-white/10 transition-colors cursor-pointer"
                                        >
                                            Show in folder
                                        </button>
                                    </div>
                                )}
                            </>
                        )}

                        {job.status === 'error' && (
                            <div className="flex items-start gap-3">
                                <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0 text-amber-400" />
                                <div className="min-w-0 flex-1">
                                    <p className="text-[13px] font-semibold text-white">That edit did not finish</p>
                                    <p className="mt-0.5 text-[11px] leading-relaxed text-white/55">{job.result?.error || 'Something went wrong.'}</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={dismissJob}
                                    aria-label="Dismiss"
                                    className="w-7 h-7 rounded-lg text-white/40 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors cursor-pointer"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>

            {notice && (
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    role="status"
                    className="absolute bottom-6 left-1/2 -translate-x-1/2 max-w-[90%] px-4 py-2.5 rounded-xl bg-[#1a1a1d] border border-white/10 shadow-xl shadow-black/50 text-xs text-white/85"
                >
                    {notice}
                </motion.div>
            )}
        </motion.div>
    );
}
