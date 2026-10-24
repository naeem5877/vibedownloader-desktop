import React, { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { motion, AnimatePresence, useReducedMotion, type Variants } from 'framer-motion';
import {
    Download, Loader, Eye, Music, Film, Check, Play, List, User, Search, X, CheckSquare, Square, Disc, Clipboard as ClipboardIcon, Sparkles, Key, Settings as SettingsIcon, Image as ImageIcon, FolderOpen, ShieldCheck, Globe, Monitor, Copy, ChevronRight, ArrowRight, Layers, Pause, PlayCircle, Trash2, CheckCircle2, Puzzle, Scissors, Timer, Radio, Captions, Loader2, Link2, LayoutGrid
} from 'lucide-react';
import { FaSpotify, FaXTwitter, FaYoutube, FaInstagram, FaFacebook, FaPinterest, FaSoundcloud, FaTwitch, FaDiscord } from 'react-icons/fa6';
import TikTokIcon from './ui/TikTokIcon';
import { Settings } from './Settings';
import { TutorialModal } from './TutorialModal';
import { CutTimeline } from './CutTimeline';
import { Library } from './Library';
import LyricsPanel, { type LyricsData } from './LyricsPanel';
import ShinyText from './ui/ShinyText';
import EmptyState from './ui/EmptyState';

// Types

interface Format {
    format_id: string;
    ext: string;
    height?: number;
    video_ext?: string;
    format_note?: string;
    filesize?: number;
}

interface PlaylistEntry {
    id: string;
    title: string;
    thumbnail: string;
    duration: number;
    url: string;
    artist?: string;
    searchQuery?: string;
    ext?: string;
    isIGStoryImage?: boolean;
}

// Subtitle track as reported by the main process (see electron/utils/subtitles.ts).
  interface SubtitleTrack {
      key: string;
      lang: string;
      label: string;
      langLabel: string;
      isAuto: boolean;
      formats: string[];
  }

// Audio language as reported by the main process (see electron/utils/audioTracks.ts).
// Only present when the video publishes more than one audio language, which is
// why the picker is hidden rather than showing a single useless row.
  interface AudioTrack {
      key: string;
      lang: string;
      langLabel: string;
      isOriginal: boolean;
      formatId: string;
      ext: string;
      acodec: string;
      abr: number;
  }

interface VideoMetadata {
    id: string;
    title: string;
    thumbnail: string;
    uploader: string;
    channel_follower_count?: number;
    view_count: number;
    duration: number;
    formats: Format[];
    webpage_url: string;
    contentType: 'video' | 'playlist' | 'story' | 'live' | 'vod' | 'clip';
    entries?: PlaylistEntry[];
    playlist_count?: number;
    isLive?: boolean;
    searchQuery?: string; // For Spotify single tracks
    album?: string;
    noStories?: boolean; // Instagram stories: the account has nothing posted
    noStoriesMessage?: string;
    /**
     * Facebook stories: a single URL resolves one story, which is one video.
     * Instagram returns a whole tray, so the two need different result cards.
     */
    singleStory?: boolean;
}

type PlatformId = 'youtube' | 'instagram' | 'tiktok' | 'facebook' | 'spotify' | 'x' | 'pinterest' | 'soundcloud' | 'twitch';

interface Platform {
    id: PlatformId;
    name: string;
    icon: React.ReactNode;
    color: string;
    bgClass: string;
}

const platforms: Platform[] = [
    { id: 'youtube', name: 'YouTube', icon: <FaYoutube size={22} />, color: '#FF0000', bgClass: 'bg-red-600' },
    { id: 'instagram', name: 'Instagram', icon: <FaInstagram size={22} />, color: '#E4405F', bgClass: 'bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400' },
    { id: 'tiktok', name: 'TikTok', icon: <TikTokIcon size={22} />, color: '#00F2EA', bgClass: 'bg-black' },
    { id: 'facebook', name: 'Facebook', icon: <FaFacebook size={22} />, color: '#1877F2', bgClass: 'bg-blue-600' },
    { id: 'spotify', name: 'Spotify', icon: <FaSpotify size={22} />, color: '#1DB954', bgClass: 'bg-green-500' },
    { id: 'x', name: 'X', icon: <FaXTwitter size={22} />, color: '#FFFFFF', bgClass: 'bg-white' },
    { id: 'twitch', name: 'Twitch', icon: <FaTwitch size={22} />, color: '#9146FF', bgClass: 'bg-purple-500' },
    { id: 'pinterest', name: 'Pinterest', icon: <FaPinterest size={22} />, color: '#E60023', bgClass: 'bg-red-700' },
    { id: 'soundcloud', name: 'SoundCloud', icon: <FaSoundcloud size={22} />, color: '#FF5500', bgClass: 'bg-orange-600' }
];

const PLATFORM_DOMAINS: Record<string, string[]> = {
    'youtube': ['youtube.com', 'youtu.be'],
    'instagram': ['instagram.com', 'instagr.am'],
    'tiktok': ['tiktok.com'],
    'facebook': ['facebook.com', 'fb.watch', 'fb.com', 'messenger.com'],
    'spotify': ['spotify.com'],
    'x': ['twitter.com', 'x.com'],
    'pinterest': ['pinterest.com', 'pin.it'],
    'soundcloud': ['soundcloud.com'],
    'twitch': ['twitch.tv']
};

/**
 * Instagram accepts a bare handle where the other platforms need a link.
 *
 * `nike` and `@nike` carry no domain, so the platform check in handleSubmit
 * rejects them before a request is ever made. Expanding the handle into the
 * canonical stories URL here means everything downstream - platform detection,
 * the backend branch, the tray UI - treats it like any other link, so this is
 * the only place that has to know a bare handle is allowed.
 *
 * This runs only when the Instagram tab is selected, because only then is a
 * bare word unambiguously a handle; on the YouTube tab the same text is a video
 * id. Instagram usernames may contain dots, so a dot disqualifies nothing.
 *
 * Returns null for anything that is not a bare Instagram handle.
 */
const normalizeInstagramHandle = (raw: string): string | null => {
    const value = (raw || '').trim();
    if (!value) return null;
    // A URL, or a path with a scheme or host: leave it for the usual flow.
    if (value.includes('/') || value.includes('\\') || /^[a-z]+:\/\//i.test(value)) return null;
    const handle = value.replace(/^@/, '');
    if (!/^[a-z0-9._]{1,30}$/i.test(handle)) return null;
    return `https://www.instagram.com/stories/${handle}/`;
};

const formatNumber = (num: number) => {
    if (!num) return '0';
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
    if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
    return num.toString();
};

const formatDuration = (s: number) => {
    if (!s) return '0:00';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}` : `${m}:${sec.toString().padStart(2, '0')}`;
};

const formatDurationWords = (s: number) => {
    const sec = Math.round(s);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s2 = sec % 60;
    const parts: string[] = [];
    if (h > 0) parts.push(`${h} hour${h !== 1 ? 's' : ''}`);
    if (m > 0) parts.push(`${m} minute${m !== 1 ? 's' : ''}`);
    if (s2 > 0 || parts.length === 0) parts.push(`${s2} second${s2 !== 1 ? 's' : ''}`);
    return parts.join(' ');
};

const formatBytes = (b?: number) => {
    if (!b || b <= 0) return '';
    const mb = b / (1024 * 1024);
    if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB';
    return Math.round(mb) + ' MB';
};

// yt-dlp reports speed, ETA and transferred size only on the progress lines
// that carry them, and the main process forwards every gap as the placeholder
// '...'. Storing that placeholder as if it were a value is what made a finished
// download read as "Starting...", so a gap keeps the last real number instead.
const orPrevious = (value: string | undefined, previous: string | undefined) =>
    (value && value !== '...' ? value : previous);

// `stage` names the step being worked on when it is not measurable as a
// percentage - the FFmpeg passes yt-dlp and this app run after the last byte of
// the source stream arrives.
interface DownloadProgress {
    percent: number;
    speed?: string;
    eta?: string;
    downloaded?: string;
    stage?: string | null;
    processing?: boolean;
    // Set only while a video is being re-encoded, which knows how far along it is.
    stagePercent?: number;
    stageSpeed?: string;
    stageEta?: string;
    encoder?: string;
    hardware?: boolean;
}

// What a re-encode says about itself, as one short line.
function encodeLine(p: { stagePercent?: number; stageSpeed?: string; stageEta?: string } | null | undefined): string {
    if (!p || p.stagePercent === undefined) return '';
    return [
        `${Math.round(p.stagePercent)}%`,
        p.stageSpeed,
        p.stageEta ? `${p.stageEta} left` : ''
    ].filter(Boolean).join(' · ');
}

// Circular Progress
function CircularProgress({ percent, color, processing = false, stagePercent }: { percent: number; color: string; processing?: boolean; stagePercent?: number }) {
    const radius = 45;
    const stroke = 5;
    const normalizedRadius = radius - stroke / 2;
    const circumference = normalizedRadius * 2 * Math.PI;
    // A re-encode measures its own progress, so the ring shows that instead of
    // sweeping. Every other processing step has no number and still sweeps.
    const measured = processing && stagePercent !== undefined;
    if (measured) { percent = stagePercent as number; processing = false; }
    const strokeDashoffset = circumference - (percent / 100) * circumference;

    return (
        <div className="relative w-28 h-28">
            <svg className="transform -rotate-90 w-28 h-28">
                <circle className="text-white/10" strokeWidth={stroke} stroke="currentColor" fill="transparent" r={normalizedRadius} cx={56} cy={56} />
                {processing ? (
                    // Transcoding and merging report no percentage of their own,
                    // so an arc that keeps the download's last number would claim
                    // a measurement nobody made. It sweeps instead.
                    <circle
                        strokeWidth={stroke}
                        strokeDasharray={`${circumference * 0.2} ${circumference}`}
                        strokeLinecap="round"
                        stroke={color}
                        fill="transparent"
                        r={normalizedRadius}
                        cx={56}
                        cy={56}
                        className="origin-center animate-spin"
                        style={{ animationDuration: '1.15s', filter: `drop-shadow(0 0 5px ${color}66)` }}
                    />
                ) : (
                    <circle strokeWidth={stroke} strokeDasharray={circumference} strokeDashoffset={strokeDashoffset} strokeLinecap="round" stroke={color} fill="transparent" r={normalizedRadius} cx={56} cy={56} style={{ transition: 'stroke-dashoffset 0.3s ease' }} />
                )}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
                {processing ? (
                    <>
                        <Loader2 className="w-6 h-6 animate-spin" style={{ color }} />
                        <span className="text-[10px] font-bold text-white/50 tabular-nums">{Math.round(percent)}%</span>
                    </>
                ) : (
                    <span className="text-2xl font-bold text-white">{Math.round(percent)}%</span>
                )}
            </div>
        </div>
    );
}

// Short eased scroll. The browser's own smooth scroll runs at one fixed, unhurried
// pace; this one scales with the distance, and gives way the moment the user
// scrolls themselves.
function animateScroll(container: HTMLElement, to: number, reduce: boolean) {
    const from = container.scrollTop;
    const target = Math.max(0, Math.min(to, container.scrollHeight - container.clientHeight));
    const dist = target - from;
    if (Math.abs(dist) < 4) return;
    if (reduce) { container.scrollTop = target; return; }

    const duration = Math.min(700, 280 + Math.abs(dist) * 0.35);
    const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
    const events = ['wheel', 'touchstart', 'keydown'] as const;
    let cancelled = false;
    const stop = () => { cancelled = true; };
    events.forEach(e => container.addEventListener(e, stop, { passive: true, once: true }));

    const startedAt = performance.now();
    const step = (now: number) => {
        if (cancelled) return;
        const x = Math.min(1, (now - startedAt) / duration);
        container.scrollTop = from + dist * ease(x);
        if (x < 1) requestAnimationFrame(step);
        else events.forEach(e => container.removeEventListener(e, stop));
    };
    requestAnimationFrame(step);
}

function scrollToElement(container: HTMLElement, el: HTMLElement, reduce: boolean) {
    const top = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 24;
    animateScroll(container, top, reduce);
}

const formatElapsed = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// Time since the component mounted, ticking twice a second.
function useElapsed(): number {
    const [ms, setMs] = useState(0);
    useEffect(() => {
        const start = Date.now();
        const id = setInterval(() => setMs(Date.now() - start), 500);
        return () => clearInterval(id);
    }, []);
    return ms;
}

type StepState = 'done' | 'active' | 'pending';

function StepIcon({ state, color }: { state: StepState; color: string }) {
    if (state === 'done') {
        return (
            <motion.span
                initial={{ scale: 0.4 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                className="w-[18px] h-[18px] shrink-0 rounded-full bg-white/90 flex items-center justify-center"
            >
                <Check className="w-3 h-3 text-black" strokeWidth={3.5} />
            </motion.span>
        );
    }
    if (state === 'active') {
        return <Loader2 className="w-[18px] h-[18px] shrink-0 animate-spin" style={{ color }} />;
    }
    return <span className="w-[18px] h-[18px] shrink-0 rounded-full border border-white/20" />;
}

function StepList({ steps, color }: { steps: { title: string; detail?: string; state: StepState }[]; color: string }) {
    return (
        <ol>
            {steps.map((s, i) => (
                <li key={s.title} className="relative flex gap-3 pb-3.5 last:pb-0">
                    {i < steps.length - 1 && (
                        <span aria-hidden="true" className={`absolute left-[8.5px] top-[22px] bottom-0 w-px transition-colors duration-300 ${s.state === 'done' ? 'bg-white/40' : 'bg-white/10'}`} />
                    )}
                    <StepIcon state={s.state} color={color} />
                    <div className="min-w-0 flex-1">
                        <p className={`text-[13px] font-semibold leading-[18px] transition-colors duration-300 ${s.state === 'pending' ? 'text-white/30' : 'text-white'}`}>{s.title}</p>
                        {s.detail && (
                            <p className={`mt-0.5 text-[11px] leading-snug truncate tabular-nums ${s.state === 'active' ? 'text-white/65' : 'text-white/35'}`}>{s.detail}</p>
                        )}
                    </div>
                </li>
            ))}
        </ol>
    );
}

// What the app is doing while a file downloads, in four steps. The main process names
// each post-download job (merging, converting, embedding cover art...), so the
// timeline can say exactly which one is running instead of sitting on a percentage.
const FINISHING_STAGE = /metadata|tags|cover art|album art|finaliz/i;

function progressPhase(p: DownloadProgress | null): number {
    if (!p) return 0;
    const stage = p.stage || '';
    if (stage) {
        if (!p.processing && /ffmpeg/i.test(stage)) return 0;
        return FINISHING_STAGE.test(stage) ? 3 : 2;
    }
    const speed = p.speed && p.speed !== '...' ? p.speed : '';
    if (/ffmpeg/i.test(speed)) return 0;
    if (/cutting|convert|merg|encod|finaliz/i.test(speed)) return 2;
    return p.percent > 0 || speed ? 1 : 0;
}

function DownloadActivity({ progress, color }: { progress: DownloadProgress | null; color: string }) {
    const elapsed = useElapsed();
    const phase = progressPhase(progress);
    // A step never un-completes: a late percentage must not drag the timeline back.
    const furthest = useRef(0);
    const labels = useRef<Record<number, string>>({});
    furthest.current = Math.max(furthest.current, phase);
    const current = furthest.current;

    const text = progress?.stage || (progress?.speed && progress.speed !== '...' ? progress.speed : '');
    if (text && phase === current) labels.current[current] = text;

    const transfer = [
        progress && progress.percent > 0 ? `${Math.round(progress.percent)}%` : '',
        progress?.speed && progress.speed !== '...' ? progress.speed : '',
        progress?.eta && progress.eta !== '...' ? `${progress.eta} left` : '',
        progress?.downloaded && progress.downloaded !== '...' ? progress.downloaded : ''
    ].filter(Boolean).join(' · ');

    const stateOf = (i: number): StepState => (i < current ? 'done' : i === current ? 'active' : 'pending');
    const steps = [
        { title: 'Preparing', detail: current === 0 ? (text || 'Getting things ready') : 'Ready' },
        { title: 'Downloading', detail: current === 1 ? (transfer || 'Starting') : current > 1 ? 'Downloaded' : '' },
        { title: 'Processing', detail: current === 2 ? [text, progress?.encoder ? `(${progress.encoder})` : '', encodeLine(progress)].filter(Boolean).join(' · ') : current > 2 ? (labels.current[2] || 'Not needed') : '' },
        { title: 'Finishing up', detail: current === 3 ? text : '' }
    ].map((s, i) => ({ ...s, state: stateOf(i) }));

    return (
        <div className="w-full" aria-live="polite">
            <div className="flex items-center justify-between mb-4 text-[10px] font-bold uppercase tracking-widest text-white/40">
                <span>Step {current + 1} of {steps.length}</span>
                <span className="tabular-nums">{formatElapsed(elapsed)}</span>
            </div>
            <StepList steps={steps} color={color} />
        </div>
    );
}

// The link lookup reports no stages of its own, so this timeline advances with time
// and says so honestly when a link takes longer than usual.
function FetchActivity({ platform, color }: { platform: string; color: string }) {
    const elapsed = useElapsed();
    const current = elapsed < 1500 ? 0 : elapsed < 4000 ? 1 : 2;
    const titles = [`Connecting to ${platform}`, 'Reading media details', 'Checking available qualities'];
    const steps = titles.map((title, i) => ({ title, state: (i < current ? 'done' : i === current ? 'active' : 'pending') as StepState }));

    return (
        <div className="w-full max-w-xs" role="status" aria-live="polite">
            <div className="flex items-center justify-between gap-3 mb-5">
                <ShinyText text="Fetching your link" disabled={false} speed={3} className="text-sm font-bold tracking-widest uppercase" />
                <span className="text-[11px] text-white/40 tabular-nums">{formatElapsed(elapsed)}</span>
            </div>
            <StepList steps={steps} color={color} />
            {elapsed > 9000 && (
                <p className="mt-4 text-[11px] leading-relaxed text-white/45">Taking longer than usual. Some links need extra steps to resolve, so hang tight.</p>
            )}
        </div>
    );
}

// Memoized Playlist Item for performance
const PlaylistItem = memo(({
    entry,
    isSelected,
    isDownloadingItem,
    downloading,
    progress,
    isSpotify,
    metadataUploader,
    metadataTitle,
    onToggle,
    onSpotifyDownload,
    onDownload,
    onImgError
}: {
    entry: PlaylistEntry;
    index: number;
    isSelected: boolean;
    isDownloadingItem: boolean;
    downloading: boolean;
    progress: any;
    isSpotify: boolean;
    metadataUploader: any;
    metadataTitle: any;
    onToggle: (id: string) => void;
    onSpotifyDownload: any;
    onDownload: any;
    onImgError: any;
}) => {
    return (
        <div
            className={`flex items-center gap-3 p-2.5 rounded-xl group transition cursor-pointer hardware-accelerated
                ${isSelected ? 'bg-white/8 border border-white/15' : 'bg-white/5 border border-transparent hover:bg-white/8'}`}
            onClick={() => onToggle(entry.id)}
        >
            {/* Checkbox */}
            <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 transition
                ${isSelected ? 'bg-white text-black' : 'bg-white/10'}`}>
                {isSelected && <Check className="w-3.5 h-3.5" />}
            </div>

            {/* Thumbnail */}
            <div className="w-12 h-12 rounded-lg bg-white/10 overflow-hidden shrink-0 relative">
                {entry.thumbnail ? (
                    <img src={entry.thumbnail} alt="" className="w-full h-full object-cover" onError={onImgError} referrerPolicy="no-referrer" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-green-900/30 to-green-600/20">
                        <Music className="w-5 h-5 text-green-500/50" />
                    </div>
                )}
                {isDownloadingItem && (
                    <div className="absolute inset-0 bg-black/85 optimized-blur flex flex-col items-center justify-center p-2 text-center rounded-lg">
                        <Loader className="w-4 h-4 animate-spin mb-1 text-blue-400" />
                        <p className="text-white font-bold text-[10px] mb-1">
                            {progress?.percent ? `${Math.round(progress.percent)}%` : 'Starting...'}
                        </p>
                        {progress?.percent !== undefined && (
                            <div className="w-[90%] h-1 bg-white/20 rounded-full overflow-hidden mb-1">
                                <div
                                    className="h-full bg-blue-500 transition-all duration-300"
                                    style={{ width: `${progress.percent}%` }}
                                />
                            </div>
                        )}
                        <div className="flex flex-col items-center justify-center text-[9px] text-white/60 leading-tight">
                            {progress?.speed && progress.speed !== '...' && <span>{progress.speed}</span>}
                            {progress?.eta && progress.eta !== '...' && <span>{progress.eta} left</span>}
                        </div>
                    </div>
                )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate" title={entry.title}>{entry.title}</p>
                <p className="text-xs text-white/40">
                    {entry.artist && <span>{entry.artist} • </span>}
                    {formatDuration(entry.duration)}
                </p>
            </div>

            {/* Quick Actions */}
            <div className="flex items-center gap-1 opacity-1 sm:opacity-0 group-hover:opacity-100 transition" onClick={(e) => e.stopPropagation()}>
                {isSpotify && entry.searchQuery ? (
                    <button
                        onClick={() => onSpotifyDownload(entry.searchQuery!, entry.title, entry.artist || (metadataUploader || 'Unknown'), entry.id, metadataTitle)}
                        disabled={downloading}
                        className="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center cursor-pointer hover:bg-green-500/30 transition disabled:opacity-40"
                        title="Download MP3"
                    >
                        <Music className="w-4 h-4 text-green-400" />
                    </button>
                ) : (
                    <>
                        <button
                            onClick={() => onDownload('audio_best', entry.url, entry.title, entry.id, metadataTitle)}
                            disabled={downloading}
                            className="w-7 h-7 rounded-lg bg-green-500/20 flex items-center justify-center cursor-pointer hover:bg-green-500/30 transition disabled:opacity-40"
                            title="Download Audio"
                        >
                            <Music className="w-3.5 h-3.5 text-green-400" />
                        </button>
                        <button
                            onClick={() => onDownload('best', entry.url, entry.title, entry.id, metadataTitle)}
                            disabled={downloading}
                            className="w-7 h-7 rounded-lg bg-blue-500/20 flex items-center justify-center cursor-pointer hover:bg-blue-500/30 transition disabled:opacity-40"
                            title="Download Video"
                        >
                            <Film className="w-3.5 h-3.5 text-blue-400" />
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}, (prev, next) => {
    // Performance optimization: prevent re-render if this item isn't downloading and its state hasn't changed
    return prev.isSelected === next.isSelected &&
        prev.isDownloadingItem === next.isDownloadingItem &&
        prev.progress?.percent === next.progress?.percent &&
        prev.progress?.speed === next.progress?.speed &&
        prev.entry.id === next.entry.id &&
        prev.downloading === next.downloading;
});

// Memoized Batch Queue Item for performance
const BatchQueueItem = memo(({
    item,
    index,
    onToggleMode,
    onRemove,
    onRetry
}: {
    item: any;
    index: number;
    onToggleMode: (id: string, mode: 'video' | 'audio') => void;
    onRemove: (id: string) => void;
    onRetry: (id: string) => void;
}) => {
    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className={`relative overflow-hidden group rounded-xl border transition-all duration-300 hardware-accelerated ${item.status === 'completed'
                ? 'bg-green-500/5 border-green-500/20'
                : item.status === 'failed'
                    ? 'bg-red-500/5 border-red-500/20'
                    : item.status === 'downloading' || item.status === 'processing'
                        ? 'bg-blue-500/5 border-blue-500/20 shadow-[0_0_15px_-5px_rgba(59,130,246,0.2)]'
                        : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.05]'
                }`}
        >
            {/* Progress Bar Background */}
            {(item.status === 'downloading' || item.status === 'processing') && (
                <div className="absolute inset-0 bg-blue-500/5 transition-all duration-500" style={{ width: `${item.progress}%` }} />
            )}

            <div className="relative p-4 flex items-center gap-4">
                {/* Status Icon */}
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border transition-all duration-300 ${item.status === 'completed' ? 'bg-green-500/10 border-green-500/20 text-green-400' :
                    item.status === 'failed' ? 'bg-red-500/10 border-red-500/20 text-red-400' :
                        item.status === 'downloading' || item.status === 'processing' ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' :
                            'bg-white/5 border-white/10 text-white/30'
                    }`}>
                    {item.status === 'completed' ? <CheckCircle2 className="w-5 h-5" /> :
                        item.status === 'failed' ? <X className="w-5 h-5" /> :
                            item.status === 'downloading' || item.status === 'processing' ? <Loader className="w-5 h-5 animate-spin" /> :
                                <span className="font-bold text-xs">{index + 1}</span>}
                </div>

                {/* Content Info */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <p className="font-bold text-sm text-white truncate">{item.title}</p>
                        {item.status === 'processing' && <span className="text-[10px] text-blue-400 animate-pulse">Fetching info...</span>}
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                        <p className="text-white/40 truncate max-w-[200px]">{item.url}</p>
                        {item.error && <span className="text-red-400 truncate max-w-[150px]">• {item.error}</span>}
                    </div>

                    {/* Progress Bar (Slim) */}
                    {(item.status === 'downloading' || item.status === 'processing') && (
                        <>
                            <div className="mt-3 w-full bg-white/10 rounded-full h-1 overflow-hidden">
                                <div
                                    className="h-full bg-blue-500 rounded-full transition-all duration-300"
                                    style={{ width: `${item.processing && item.stagePercent !== undefined ? item.stagePercent : item.progress}%` }}
                                />
                            </div>
                            <div className="flex justify-between items-center mt-2 text-[10px] text-white/50">
                                <span className="flex items-center gap-1.5 truncate max-w-[220px]">
                                    {item.processing && <Loader2 className="w-3 h-3 animate-spin shrink-0" />}
                                    {item.stage || (item.speed && item.speed !== '...' ? item.speed : 'Downloading...')}
                                    {item.processing && item.encoder && <span className="text-white/35 truncate">({item.encoder})</span>}
                                </span>
                                <div className="flex items-center gap-2">
                                    {item.processing && item.stagePercent !== undefined && <span className="tabular-nums">{encodeLine(item)}</span>}
                                    {item.downloaded && item.downloaded !== '...' && <span>{item.downloaded}</span>}
                                    {!item.processing && item.eta && item.eta !== '...' && <span>• {item.eta} left</span>}
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {/* Actions & Toggles */}
                <div className="flex items-center gap-2">
                    {/* A/V Toggle - Only active if pending */}
                    <div className={`flex bg-black/20 rounded-lg p-0.5 border border-white/5 ${item.status !== 'pending' ? 'opacity-50 pointer-events-none' : ''}`}>
                        <button
                            onClick={() => onToggleMode(item.id, 'video')}
                            className={`px-2 py-1.5 rounded-md text-[10px] font-bold uppercase transition-all cursor-pointer ${item.mode === 'video' ? 'bg-blue-500 text-white shadow-sm' : 'text-white/40 hover:text-white/60'
                                }`}
                        >
                            Video
                        </button>
                        <button
                            onClick={() => onToggleMode(item.id, 'audio')}
                            className={`px-2 py-1.5 rounded-md text-[10px] font-bold uppercase transition-all cursor-pointer ${item.mode === 'audio' ? 'bg-green-500 text-white shadow-sm' : 'text-white/40 hover:text-white/60'
                                }`}
                        >
                            Audio
                        </button>
                    </div>

                    {/* Retry button for failed */}
                    {item.status === 'failed' && (
                        <button
                            onClick={() => onRetry(item.id)}
                            className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-all flex items-center justify-center cursor-pointer border border-blue-500/10"
                            title="Retry Download"
                        >
                            <ArrowRight className="w-4 h-4" />
                        </button>
                    )}

                    {/* Remove button for pending/failed/completed */}
                    {item.status !== 'downloading' && item.status !== 'processing' && (
                        <button
                            onClick={() => onRemove(item.id)}
                            className="w-8 h-8 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all flex items-center justify-center cursor-pointer border border-red-500/10"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>
        </motion.div>
    );
}, (prev, next) => {
    return prev.item.status === next.item.status &&
        prev.item.progress === next.item.progress &&
        prev.item.mode === next.item.mode &&
        prev.item.speed === next.item.speed &&
        prev.item.error === next.item.error;
});

// Diagnostic readout for how long a metadata fetch took. Ticks while the fetch
// is in flight, then freezes on the final value when the result appears.
// Self-contained so the 10x/second tick does not re-render the whole downloader.
//
// TEST ONLY: this is hidden in normal builds so it never reaches users. It is on
// during `npm run dev`, and can be forced on in a production build with
// VITE_SHOW_FETCH_TIMER=true.
const SHOW_FETCH_TIMER =
    import.meta.env.DEV || import.meta.env.VITE_SHOW_FETCH_TIMER === 'true';

/* Entrance for a fetched result. Transform and opacity only, so it stays on the
   compositor. Children begin together with the card and are staggered by 50ms,
   so the whole thing settles in well under half a second and nothing waits for
   it: every control is live from the first frame. */
const RESULT_EASE = [0.22, 1, 0.36, 1] as const;
const resultContainer: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: 0.05 } }
};
const resultMedia: Variants = {
    hidden: { opacity: 0, scale: 0.965, y: 10 },
    show: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.45, ease: RESULT_EASE } }
};
const resultItem: Variants = {
    hidden: { opacity: 0, y: 14 },
    show: { opacity: 1, y: 0, transition: { duration: 0.38, ease: RESULT_EASE } }
};

const FetchTimer = memo(({ start, elapsed, failed }: { start: number | null; elapsed: number | null; failed: boolean }) => {
    const [, tick] = useState(0);

    useEffect(() => {
        if (elapsed !== null || start === null) return;
        const id = setInterval(() => tick(n => n + 1), 100);
        return () => clearInterval(id);
    }, [start, elapsed]);

    const ms = elapsed !== null ? elapsed : (start !== null ? performance.now() - start : 0);
    const done = elapsed !== null;
    const color = done ? (failed ? 'text-red-400/80' : 'text-green-400/80') : 'text-amber-400/80';

    return (
        <div className="mb-3 flex items-center justify-center gap-2 font-mono text-[11px] tracking-wider select-none">
            <span className="text-white/25">FETCH</span>
            <span className={color}>{(ms / 1000).toFixed(2)}s</span>
            <span className="text-white/20">
                {done ? (failed ? 'FAILED' : 'DONE') : elapsed === null ? '...' : ''}
            </span>
        </div>
    );
});
FetchTimer.displayName = 'FetchTimer';

// One selectable caption language. Memoized because the picker can render
// One selectable caption language. Memoized because the picker can render
// 150+ of these and a search keystroke would otherwise re-render every row.
const SubtitleChoice = memo(({
    track,
    active,
    disabled,
    onPick,
}: {
    track: SubtitleTrack;
    active: boolean;
    disabled: boolean;
    onPick: () => void;
}) => (
    <button
        onClick={onPick}
        disabled={disabled}
        aria-pressed={active}
        className={`group relative w-full flex items-center gap-3 h-10 px-3 text-left transition-all duration-150 cursor-pointer
            ${active
                ? 'bg-gradient-to-r from-blue-500/20 via-blue-500/10 to-transparent border-l-2 border-blue-400 text-white font-medium'
                : 'hover:bg-white/[0.05] text-white/80'}`}
    >
        <span className={`w-11 shrink-0 text-center text-[10px] font-mono font-bold uppercase tracking-wider rounded-md py-1 border transition
            ${active
                ? 'bg-blue-500/30 border-blue-400/40 text-blue-200 shadow-sm'
                : 'bg-white/[0.05] border-white/10 text-white/50 group-hover:text-white/80 group-hover:border-white/20'}`}>
            {track.lang}
        </span>
        <span className="text-[13px] truncate flex-1 leading-none">
            {track.langLabel}
        </span>
        {!track.isAuto ? (
            <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                Creator
            </span>
        ) : (
            <span className="shrink-0 text-[9px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/[0.04] text-white/30 group-hover:text-white/50">
                Auto
            </span>
        )}
        <div className="w-5 h-5 shrink-0 flex items-center justify-center">
            {active ? (
                <div className="w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center text-white shadow-sm shadow-blue-500/50">
                    <Check className="w-2.5 h-2.5 stroke-[3]" />
                </div>
            ) : (
                <div className="w-4 h-4 rounded-full border border-white/15 group-hover:border-white/35 transition-colors" />
            )}
        </div>
    </button>
));
SubtitleChoice.displayName = 'SubtitleChoice';

// Two of these sit on the same screen and mean different things, so the shape
// and the colour are part of the label: captions are a wide blue card, the
// audio language is a slim emerald strip. Sharing only the chevron keeps the
// "tap to expand" affordance identical without making the two look alike.
const TOGGLE_TONE = {
    blue: {
        open: 'bg-gradient-to-r from-blue-950/30 via-black/40 to-black/60 border-blue-500/30 shadow-blue-950/20',
        badge: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
        chip: 'bg-blue-500/20 text-blue-300',
    },
    emerald: {
        open: 'bg-gradient-to-r from-emerald-950/30 via-black/40 to-black/60 border-emerald-500/30 shadow-emerald-950/20',
        badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
        chip: 'bg-emerald-500/20 text-emerald-300',
    },
} as const;

/**
 * A collapsed summary row that expands into a track picker.
 */
function SectionToggle({
    open,
    onToggle,
    icon,
    title,
    meta,
    badge,
    accent = 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
    tone = 'blue',
    variant = 'card',
}: {
    open: boolean;
    onToggle: () => void;
    icon: React.ReactNode;
    title: string;
    meta?: string;
    badge?: string;
    accent?: string;
    tone?: keyof typeof TOGGLE_TONE;
    variant?: 'card' | 'compact';
}) {
    const palette = TOGGLE_TONE[tone];
    const compact = variant === 'compact';

    return (
        <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className={`w-full flex items-center justify-between gap-3 ${compact ? 'rounded-xl px-3.5 py-2' : 'rounded-2xl px-4 py-3'} border transition-all duration-200 text-left cursor-pointer group shadow-sm ${
                open ? palette.open : 'bg-white/[0.02] border-white/10 hover:border-white/20 hover:bg-white/[0.04]'
            }`}
        >
            <div className={`flex items-center ${compact ? 'gap-2' : 'gap-3'} min-w-0 flex-1`}>
                <div className={`${compact ? 'w-6 h-6 rounded-lg' : 'w-9 h-9 rounded-xl'} ${accent} flex items-center justify-center shadow-sm shrink-0 group-hover:scale-105 transition-transform`}>
                    {icon}
                </div>
                {compact ? (
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-white/70 shrink-0">{title}</span>
                        <span className="w-px h-3 bg-white/10 shrink-0" />
                        {meta && <p className="text-[11px] text-white/45 truncate">{meta}</p>}
                    </div>
                ) : (
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-white tracking-wide">{title}</span>
                            {badge && (
                                <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${palette.badge} whitespace-nowrap`}>
                                    {badge}
                                </span>
                            )}
                        </div>
                        {meta && <p className="text-[11px] text-white/45 truncate mt-0.5">{meta}</p>}
                    </div>
                )}
            </div>
            <div className={`${compact ? 'w-5 h-5' : 'w-7 h-7'} ${compact ? 'rounded-md' : 'rounded-lg'} flex items-center justify-center transition-all ${open ? `${palette.chip} rotate-90` : 'text-white/40 group-hover:text-white/70'}`}>
                <ChevronRight className={`${compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} transition-transform duration-200`} />
            </div>
        </button>
    );
}

// One audio language. Same row shape as SubtitleChoice so the two lists stay
// easy to scan, but keyed to emerald where the caption rows are blue, and it
// shows the codec and bitrate that will actually be downloaded instead of the
// auto/generated badge captions carry.
const AudioTrackChoice = memo(({
    track,
    active,
    disabled,
    onPick,
}: {
    track: AudioTrack;
    active: boolean;
    disabled: boolean;
    onPick: () => void;
}) => (
    <button
        onClick={onPick}
        disabled={disabled}
        aria-pressed={active}
        className={`group relative w-full flex items-center gap-3 h-10 px-3.5 text-left transition-all duration-150 cursor-pointer
            ${active
                ? 'bg-gradient-to-r from-emerald-500/20 via-emerald-500/10 to-transparent border-l-2 border-emerald-400 text-white font-medium'
                : 'hover:bg-white/[0.05] text-white/80'}`}
    >
        <span className={`w-12 shrink-0 text-center text-[10px] font-mono font-bold uppercase tracking-wider rounded-md py-1 border transition
            ${active
                ? 'bg-emerald-500/30 border-emerald-400/40 text-emerald-200 shadow-sm'
                : 'bg-white/[0.05] border-white/10 text-white/50 group-hover:text-white/80 group-hover:border-white/20'}`}>
            {track.lang.split('-')[0]}
        </span>
        <span className="text-[13px] truncate flex-1 leading-none">
            {track.langLabel}
        </span>
        {track.isOriginal && (
            <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                Original
            </span>
        )}
        <span className="shrink-0 text-[10px] font-mono font-medium text-white/40 group-hover:text-white/60">
            {track.abr ? `${track.abr}kbps` : track.ext?.toUpperCase()}
        </span>
        <div className="w-5 h-5 shrink-0 flex items-center justify-center">
            {active ? (
                <div className="w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center text-white shadow-sm shadow-emerald-500/50">
                    <Check className="w-2.5 h-2.5 stroke-[3]" />
                </div>
            ) : (
                <div className="w-4 h-4 rounded-full border border-white/15 group-hover:border-white/35 transition-colors" />
            )}
        </div>
    </button>
));
AudioTrackChoice.displayName = 'AudioTrackChoice';

// Cut & Download modal: per-output accent colours (same palette idea as the Library editor)
const CUT_TABS = {
    video: { label: 'Video', Icon: Film, from: '#a855f7', to: '#d946ef' },
    audio: { label: 'Audio', Icon: Music, from: '#10b981', to: '#14b8a6' },
} as const;

const CutChip = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button
        type="button"
        aria-pressed={active}
        onClick={onClick}
        className={`w-full min-h-[44px] px-3.5 py-1.5 rounded-xl border text-xs font-semibold flex flex-col items-start justify-center leading-tight text-left transition-all active:scale-[0.97] cursor-pointer ${active
            ? 'bg-white/[0.12] border-white/30 text-white'
            : 'bg-white/[0.03] border-white/10 text-white/60 hover:text-white hover:border-white/20'}`}
    >
        {children}
    </button>
);

export function Downloader() {
    const [url, setUrl] = useState('');
    const [currentPlatform, setCurrentPlatform] = useState<Platform>(platforms[0]);
    const [loading, setLoading] = useState(false);
    // Honour the OS "reduce motion" setting: the result simply appears.
    const reduceMotion = useReducedMotion();


    // Initial load
    const [downloading, setDownloading] = useState(false);
    const [downloadingId, setDownloadingId] = useState<string | null>(null);
    const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
    const [progress, setProgress] = useState<DownloadProgress | null>(null);
    const [complete, setComplete] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [downloadedFilePath, setDownloadedFilePath] = useState<string | null>(null);
    const [pathCopied, setPathCopied] = useState(false);
    const scrollRootRef = useRef<HTMLDivElement>(null);
    const previewRef = useRef<HTMLDivElement>(null);
    const successRef = useRef<HTMLDivElement>(null);
    const [activeJobId, setActiveJobId] = useState<string | null>(null);

    // Test instrumentation: metadata fetch timing (ms). `fetchStart` is the
    // performance.now() captured when Fetch was pressed; `fetchElapsed` is
    // frozen once the fetch settles.
    const [fetchStart, setFetchStart] = useState<number | null>(null);
    const [fetchElapsed, setFetchElapsed] = useState<number | null>(null);

    // Cookie features
    const [showCookieModal, setShowCookieModal] = useState(false);
    const [cookieContent, setCookieContent] = useState('');
    const [hasCookies, setHasCookies] = useState(false);

    // Playlist features
    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState('');

    // Subtitle sidecar choice. null = don't save subtitles. Reset on every new
    // fetch, because the available tracks belong to the video just loaded.
    // Keyed by track key rather than language, because a language can be
    // published both by the author and by YouTube's auto-captions.
    const [subtitleKey, setSubtitleKey] = useState<string | null>(null);
    const [subtitleFormat, setSubtitleFormat] = useState<'srt' | 'vtt'>('srt');
    const [subtitleSearch, setSubtitleSearch] = useState('');
    // Starts closed. The picker sits above the download options, so an expanded
    // panel would push the formats the user opened the result for off-screen.
    const [tracksOpen, setTracksOpen] = useState(false);
    // A caption download is its own action with its own outcome, so it gets its
    // own status rather than borrowing the media download's progress or error.
    const [subtitleDownloading, setSubtitleDownloading] = useState(false);
    const [subtitleNotice, setSubtitleNotice] = useState<string | null>(null);
    const [subtitleResult, setSubtitleResult] = useState<string | null>(null);

    // Lyrics for a music track. Stays null unless a provider actually matched,
    // which is the signal LyricsPanel uses to render nothing at all - a track
    // with no lyrics must not leave an empty box behind.
    const [lyrics, setLyrics] = useState<LyricsData | null>(null);
    const [lyricsLoading, setLyricsLoading] = useState(false);

    // Audio language choice. Only dubbed videos offer a choice at all, and the
    // selection applies to both audio-only downloads and the audio muxed into a
    // video, so it is held here once and read by both paths.
    const [audioTrackKey, setAudioTrackKey] = useState<string | null>(null);
    // Starts closed, like the caption picker. A dubbed video's language list
    // sits above the download formats, so leaving it open pushes the formats
    // the user actually came for off-screen.
    const [audioLangOpen, setAudioLangOpen] = useState(false);

    const audioTracks = useMemo<AudioTrack[]>(
        () => ((metadata as any)?.audioTracks as AudioTrack[]) || [],
        [metadata]
    );

    // A video with one audio language has nothing to choose, so the whole
    // section stays out of the UI rather than offering a single row.
    const hasAudioChoice = audioTracks.length > 1;

    const selectedAudioTrack = useMemo<AudioTrack | null>(
        () => audioTracks.find((t) => t.key === audioTrackKey) || null,
        [audioTracks, audioTrackKey]
    );

    // The chosen language has to stay readable while the list is folded, since
    // folding it hides the row that was picked.
    const audioLangMeta = selectedAudioTrack
        ? `${selectedAudioTrack.langLabel || selectedAudioTrack.lang}${selectedAudioTrack.isOriginal ? ' · original' : ''} · ${audioTracks.length} tracks`
        : `${audioTracks.length} audio tracks`;

    // Default to the language the video was recorded in. The owning video id is
    // remembered separately because a fetch clears metadata before it starts, so
    // without this a re-fetch of the same video would silently drop the choice
    // while a genuinely new video still starts from its own original language.
    const audioChoiceOwner = useRef<string | null>(null);

    useEffect(() => {
        // Nothing to choose: single-audio video, or metadata still loading.
        if (!hasAudioChoice) return;

        const owner = (metadata as any)?.id ?? null;
        const keepCurrent =
            audioChoiceOwner.current === owner &&
            audioTrackKey !== null &&
            audioTracks.some((t) => t.key === audioTrackKey);
        if (keepCurrent) return;

        const original = audioTracks.find((t) => t.isOriginal) || audioTracks[0];
        audioChoiceOwner.current = owner;
        setAudioTrackKey(original ? original.key : null);
    }, [hasAudioChoice, audioTracks, metadata, audioTrackKey]);

    // Every caption language the video publishes, author-uploaded and automatic.
    const subtitleTracks = useMemo<SubtitleTrack[]>(
        () => ((metadata as any)?.subtitles as SubtitleTrack[]) || [],
        [metadata]
    );

    // Filter on language name/code as well as creator vs auto category
    const subtitleVisibleTracks = useMemo(() => {
        const q = subtitleSearch.trim().toLowerCase();
        if (!q) return subtitleTracks;
        return subtitleTracks.filter((t) =>
            t.langLabel.toLowerCase().includes(q) || t.lang.toLowerCase().includes(q)
        );
    }, [subtitleTracks, subtitleSearch]);

    const subtitleAuthored = useMemo(
        () => subtitleVisibleTracks.filter((t) => !t.isAuto),
        [subtitleVisibleTracks]
    );
    const subtitleAutomatic = useMemo(
        () => subtitleVisibleTracks.filter((t) => t.isAuto),
        [subtitleVisibleTracks]
    );

    // The list is sized from its contents instead of being left to flexbox. A
    // scroll container is allowed to shrink below its content, so a
    // max-height alone collapses this to its borders and 159 rows vanish. The
    // height is therefore derived from the real row and header sizes, which
    // also lets a two-track video stay short.
    const SUBTITLE_ROW_H = 40;
    const SUBTITLE_GROUP_H = 32;
    const subtitleListHeight = useMemo(() => {
        const groups = (subtitleAuthored.length ? 1 : 0) + (subtitleAutomatic.length ? 1 : 0);
        const natural = subtitleVisibleTracks.length * SUBTITLE_ROW_H + groups * SUBTITLE_GROUP_H;
        return Math.min(320, natural);
    }, [subtitleVisibleTracks.length, subtitleAuthored.length, subtitleAutomatic.length]);

    // A track is only offered if the format we would ask for is actually
    // published for it, so a choice can never be made that yt-dlp cannot fill.
    const subtitleSelection = useMemo(() => {
        if (!subtitleKey) return null;
        const track = subtitleTracks.find((t) => t.key === subtitleKey);
        if (!track) return null;
        const wanted = subtitleFormat === 'srt' ? 'srt' : 'vtt';
        // Mirrors what downloadHandler actually asks yt-dlp for: srt is
        // converted from whatever the track publishes, while vtt is requested
        // directly and so must be published. Offering an srt that the handler
        // could not fill would silently drop the user's choice.
        const usable = wanted === 'srt'
            ? track.formats.length > 0
            : track.formats.includes('vtt');
        if (!usable) return null;
        return { lang: track.lang, langLabel: track.langLabel, isAuto: track.isAuto, format: subtitleFormat };
    }, [subtitleKey, subtitleFormat, subtitleTracks]);

    // Changing the track or format invalidates any previous caption warning,
    // which would otherwise describe a language the user no longer picked.
    const pickSubtitle = useCallback((key: string | null) => {
        setSubtitleKey(key);
        setSubtitleNotice(null);
    }, []);

    const pickSubtitleFormat = useCallback((fmt: 'srt' | 'vtt') => {
        setSubtitleFormat(fmt);
        setSubtitleNotice(null);
    }, []);

    // Auto-select English or top subtitle track if available and none selected
    useEffect(() => {
        if (!subtitleTracks.length) {
            setSubtitleKey(null);
            return;
        }
        if (!subtitleKey || !subtitleTracks.some((t) => t.key === subtitleKey)) {
            const bestDefault =
                subtitleTracks.find((t) => !t.isAuto && t.lang.toLowerCase().startsWith('en')) ||
                subtitleTracks.find((t) => t.lang.toLowerCase().startsWith('en')) ||
                subtitleTracks.find((t) => !t.isAuto) ||
                subtitleTracks[0];
            if (bestDefault) {
                setSubtitleKey(bestDefault.key);
            }
        }
    }, [subtitleTracks, subtitleKey]);

    const isSpotify = currentPlatform.id === 'spotify';

    // Whether the loaded item is a music track. Spotify is always one; YouTube
    // depends on the detection that runs in the main process. Shared by the
    // lyrics lookup and the subtitle picker so the two can never disagree about
    // what kind of thing this is.
    const isMusicTrack = isSpotify || Boolean((metadata as any)?.isMusic);

    // Lyrics lookup identity. Keyed on the track rather than re-run on every
    // render, and guarded by a cancel flag so a slow response for a track the
    // user has already navigated away from cannot overwrite the current one.
    const lyricsTarget = useMemo(() => {
        const m = metadata as any;
        if (!m) return null;

        // A live stream has no end, so it has no track to match lyrics against.
        if (m.isLive) return null;

        const title = String(m.title || '').trim();
        // A `-Topic` suffixed uploader names the artist plus a marker, it is not
        // a collaboration, so the marker is stripped before matching.
        const artist = String(m.artist || m.uploader || '')
            .replace(/\s*[–—-]\s*Topic\s*$/i, '')
            .trim();

        if (!title) return null;
        if (!artist && !title.includes(' - ') && !title.includes(' – ')) return null;

        return { id: `${m.id}|${title}|${artist}`, title, artist: artist || title, duration: m.duration };
    }, [metadata]);

    useEffect(() => {
        setLyrics(null);
        if (!lyricsTarget) {
            console.log('[Lyrics] No target, skipping. metadata title=', (metadata as any)?.title);
            setLyricsLoading(false);
            return;
        }
        console.log('[Lyrics] Fetching for:', lyricsTarget.title, '/', lyricsTarget.artist);
        let cancelled = false;
        setLyricsLoading(true);
        window.electron
            .getLyrics({ title: lyricsTarget.title, artist: lyricsTarget.artist, duration: lyricsTarget.duration, isMusic: true })
            .then((result) => {
                console.log('[Lyrics] Result:', result ? result.title + ' / ' + result.artist : 'null', 'cancelled=', cancelled);
                if (cancelled) return;
                setLyricsLoading(false);
                if (!result) { console.warn('[Lyrics] No match found'); return; }
                setLyrics({ ...result, duration: lyricsTarget.duration });
                console.log('[Lyrics] Set! synced=', result.synced?.length, 'plain=', !!result.plain);
            })
            .catch((e) => {
                console.error('[Lyrics] Error:', e?.message || e);
                if (!cancelled) setLyricsLoading(false);
            });
        return () => { cancelled = true; };
    }, [lyricsTarget]);

    // Listen for URLs from browser extension via WebSocket
    useEffect(() => {
        const handler = (data: { url: string; title: string; thumbnail: string }) => {
            if (data.url) {
                setUrl(data.url);
                // Auto-fetch after setting URL
                setTimeout(() => {
                    handleSubmit(undefined, data.url);
                }, 100);
            }
        };
        window.electron.onExternalDownloadUrl(handler);
        return () => {
            window.electron.offExternalDownloadUrl?.();
        };
    }, []);

    // Settings modal
    const [showSettings, setShowSettings] = useState(false);
    const [showLibrary, setShowLibrary] = useState(false);
    const [showDiscordModal, setShowDiscordModal] = useState(false);
    const [showTutorial, setShowTutorial] = useState(false);
    const [showCutModal, setShowCutModal] = useState(false);
    const [cutStart, setCutStart] = useState(0);
    const [cutEnd, setCutEnd] = useState(0);
    const [cutType, setCutType] = useState<'video' | 'audio'>('video');
    const [cutVideoFormat, setCutVideoFormat] = useState<string>('best');
    const [cutAudioFormat, setCutAudioFormat] = useState<string>('audio_best');

    // Batch download features
    const [batchMode, setBatchMode] = useState(false);
    const modeReduce = useReducedMotion();
    const [batchUrls, setBatchUrls] = useState('');
    const [downloadQueue, setDownloadQueue] = useState<Array<{
        id: string;
        url: string;
        title: string;
        status: 'pending' | 'processing' | 'downloading' | 'completed' | 'failed';
        progress: number;
        mode: 'video' | 'audio';
        error?: string;
        formatId?: string;
        platform?: string;
        speed?: string;
        eta?: string;
        downloaded?: string;
        // Set while the item is being converted rather than transferred, where
        // there is a stage to name but no percentage to draw.
        stage?: string | null;
        processing?: boolean;
        stagePercent?: number;
        stageSpeed?: string;
        stageEta?: string;
        encoder?: string;
        ext?: string;
    }>>([]);
    const [currentBatchIndex, setCurrentBatchIndex] = useState(0);
    const [batchDownloading, setBatchDownloading] = useState(false);
    const batchCompletionRef = useRef<{ resolve: () => void; reject: (err: Error) => void } | null>(null);

    // Ref to access the latest queue state inside async operations
    const queueRef = useRef(downloadQueue);
    useEffect(() => { queueRef.current = downloadQueue; }, [downloadQueue]);

    const isBatchComplete = downloadQueue.length > 0 && downloadQueue.every(q => q.status === 'completed');

    // ... (keep cookie useEffects and refs)

    const handleBatchSubmit = async () => {
        const urls = parseBatchUrls(batchUrls);
        if (urls.length === 0) {
            setError('Please enter at least one valid URL');
            return;
        }

        const queue = urls.map((url, index) => ({
            id: `batch-${Date.now()}-${index}`,
            url,
            title: `Item ${index + 1}`,
            status: 'pending' as const,
            progress: 0,
            mode: isSpotify ? 'audio' as const : 'video' as const
        }));

        setDownloadQueue(queue);
        setCurrentBatchIndex(0);
        setBatchDownloading(true);
        batchStateRef.current = { downloading: true, index: 0 };
        setError(null);

        // Allow state to settle
        setTimeout(() => processBatchQueue(0), 0);
    };

    const toggleItemMode = useCallback((id: string, mode: 'video' | 'audio') => {
        setDownloadQueue(prev => prev.map(item =>
            item.id === id && item.status === 'pending'
                ? { ...item, mode }
                : item
        ));
    }, []);

    const removeFromQueue = useCallback((id: string) => {
        setDownloadQueue(prev => prev.filter(q => q.id !== id));
    }, []);
    const handleRetryBatchItem = useCallback(async (id: string) => {
        const itemIndex = queueRef.current.findIndex(q => q.id === id);
        if (itemIndex >= 0) {
            setDownloadQueue(prev => prev.map(q =>
                q.id === id ? { ...q, status: 'pending', error: undefined } : q
            ));
            if (!batchDownloading) {
                setBatchDownloading(true);
                batchStateRef.current.downloading = true;
                // Small delay to ensure state updates before processing
                setTimeout(() => processBatchQueue(itemIndex), 50);
            }
        }
    }, [batchDownloading]);

    const processBatchQueue = async (startIndex: number) => {
        // We use queueRef to get the total count, but we must be careful about concurrency
        // We will iterate based on index
        const totalItems = queueRef.current.length;

        for (let i = startIndex; i < totalItems; i++) {
            if (!batchStateRef.current.downloading) {
                setCurrentBatchIndex(i);
                break;
            }

            // Get the latest item state from ref
            const currentItem = queueRef.current[i];
            if (!currentItem) break;

            setCurrentBatchIndex(i);

            // Update status to processing
            setDownloadQueue(prev => prev.map(q =>
                q.id === currentItem.id ? { ...q, status: 'processing' } : q
            ));

            try {
                // Fetch metadata first
                const isSpotify = currentItem.url.includes('spotify.com');
                const res = isSpotify
                    ? await window.electron.getSpotifyInfo(currentItem.url)
                    : await window.electron.getVideoInfo(currentItem.url);

                if (res.success && res.metadata) {
                    const metadata = res.metadata;
                    const title = metadata.title || `Item ${i + 1}`;

                    // Update queue item with title
                    setDownloadQueue(prev => prev.map(q =>
                        q.id === currentItem.id ? { ...q, title, status: 'downloading', progress: 0 } : q
                    ));

                    // Determine format based on the item's mode
                    // We must read the mode again from the ref in case it changed
                    const latestItem = queueRef.current[i];
                    const mode = latestItem.mode;
                    const formatId = isSpotify ? 'audio_best' : (mode === 'audio' ? 'audio_best' : 'best');

                    // Create a promise that resolves when download completes
                    const downloadPromise = new Promise<void>((resolve, reject) => {
                        // Update ref index for the listener
                        batchStateRef.current.index = i;
                        batchCompletionRef.current = { resolve, reject };

                        // Timeout after 10 minutes per download
                        const timeout = setTimeout(() => {
                            if (batchCompletionRef.current) {
                                batchCompletionRef.current.reject(new Error('Download timeout'));
                                batchCompletionRef.current = null;
                            }
                        }, 600000);

                        // Clear timeout when resolved
                        const originalResolve = resolve;
                        const originalReject = reject;
                        batchCompletionRef.current.resolve = () => {
                            clearTimeout(timeout);
                            originalResolve();
                        };
                        batchCompletionRef.current.reject = (err: Error) => {
                            clearTimeout(timeout);
                            originalReject(err);
                        };

                        // Start download
                        (async () => {
                            try {
                                if (isSpotify) {
                                    await window.electron.downloadSpotifyTrack({
                                        searchQuery: metadata.searchQuery || '',
                                        title: metadata.title,
                                        artist: metadata.uploader || 'Unknown',
                                        thumbnail: metadata.thumbnail,
                                        suppressNotifications: true
                                    });
                                } else {
                                    await window.electron.downloadVideo({
                                        url: currentItem.url,
                                        formatId,
                                        title,
                                        platform: currentPlatform.id,
contentType: metadata.contentType === 'story' ? 'story' : undefined,
    mediaExt: currentItem.ext as 'jpg' | 'mp4' | undefined,
    thumbnail: metadata.thumbnail,
                                        suppressNotifications: true
                                    });
                                }
                            } catch (err: any) {
                                if (batchCompletionRef.current) {
                                    batchCompletionRef.current.reject(err);
                                    batchCompletionRef.current = null;
                                }
                            }
                        })();
                    });

                    // Wait for download to complete
                    await downloadPromise;

                    // Mark as completed
                    setDownloadQueue(prev => prev.map(q =>
                        q.id === currentItem.id ? { ...q, status: 'completed', progress: 100 } : q
                    ));

                    // Wait a bit before next download
                    await new Promise(r => setTimeout(r, 500));
                } else {
                    throw new Error(res.error || 'Failed to fetch info');
                }
            } catch (err: any) {
                console.error(`Batch download error for ${currentItem.url}:`, err);
                setDownloadQueue(prev => prev.map(q =>
                    q.id === currentItem.id ? {
                        ...q,
                        status: 'failed',
                        error: err.message || 'Download failed',
                        progress: 0
                    } : q
                ));
                // Continue with next item even if this one failed
                await new Promise(r => setTimeout(r, 500));
            }
        }

        if (batchStateRef.current.downloading) {
            setBatchDownloading(false);
            batchStateRef.current.downloading = false;
        }
    };

    const pauseBatchDownload = () => {
        setBatchDownloading(false);
        batchStateRef.current.downloading = false;
    };

    const resumeBatchDownload = async () => {
        // Use queueRef length
        if (currentBatchIndex < queueRef.current.length) {
            setBatchDownloading(true);
            batchStateRef.current = { downloading: true, index: currentBatchIndex };
            await processBatchQueue(currentBatchIndex);
        }
    };

    const cancelBatchDownload = () => {
        setBatchDownloading(false);
        batchStateRef.current.downloading = false;
        setDownloadQueue([]);
        setCurrentBatchIndex(0);
    };


    // Check cookies when platform changes
    useEffect(() => {
        setHasCookies(false);
        if (['instagram', 'facebook', 'youtube', 'tiktok'].includes(currentPlatform.id)) {
            window.electron.getCookiesStatus?.(currentPlatform.id).then((res: any) => {
                setHasCookies(!!res?.exists);
            });
        }
    }, [currentPlatform.id]);

    // Refs for accessing state inside event listeners without re-binding
    const batchStateRef = useRef({ downloading: false, index: 0 });

    useEffect(() => {
        batchStateRef.current = { downloading: batchDownloading, index: currentBatchIndex };
    }, [batchDownloading, currentBatchIndex]);

    useEffect(() => {
        const handler = (data: any) => {
            const { downloading, index } = batchStateRef.current;
            // Check if we have an active batch item promise waiting for this event
            const isBatchActive = !!batchCompletionRef.current;

            console.log('Progress:', data, 'BatchActive:', isBatchActive, 'BatchMode:', downloading);

            if (data.error) {
                if (isBatchActive) {
                    // Update current batch item
                    setDownloadQueue(prev => prev.map((q, idx) =>
                        idx === index ? { ...q, status: 'failed', error: data.error } : q
                    ));
                    // Check if we have a promise to reject
                    if (batchCompletionRef.current) {
                        batchCompletionRef.current.reject(new Error(data.error));
                        batchCompletionRef.current = null;
                    }
                } else {
                    setError(data.error);
                    setDownloading(false);
                    setDownloadingId(null);
                    setProgress(null);
                    setActiveJobId(null);
                }
            } else if (data.complete) {
                if (isBatchActive) {
                    // Mark current batch item as completed
                    setDownloadQueue(prev => prev.map((q, idx) =>
                        idx === index ? { ...q, status: 'completed', progress: 100 } : q
                    ));
                    // Resolve the batch promise
                    if (batchCompletionRef.current) {
                        batchCompletionRef.current.resolve();
                        batchCompletionRef.current = null;
                    }
                } else {
                    setComplete(true);
                    setDownloading(false);
                    setDownloadingId(null);
                    setProgress(null);
                    setActiveJobId(null);
                    if (data.path) setDownloadedFilePath(data.path);
                }
            } else if (data.status) {
                // Only show speed for single downloads or if specifically desired
                if (!isBatchActive && !downloading) {
                    // An explicit status is the most recent and most specific
                    // thing said about this download, so it takes the headline
                    // back from any stage label that was showing before.
                    setProgress(prev => ({ ...(prev || { percent: 0 }), speed: data.status, stage: null, processing: false, stagePercent: undefined, stageSpeed: undefined, stageEta: undefined, encoder: undefined, hardware: undefined }));
                }
            } else if (data.percent !== undefined) {
                if (isBatchActive) {
                    // Update current batch item progress
                    setDownloadQueue(prev => prev.map((q, idx) =>
                        idx === index ? {
                            ...q,
                            progress: data.percent,
                            speed: orPrevious(data.currentSpeed, q.speed),
                            eta: orPrevious(data.eta, q.eta),
                            downloaded: orPrevious(data.downloaded, q.downloaded),
                            stage: data.stage ?? null,
                            processing: !!data.processing,
                            stagePercent: data.stagePercent,
                            stageSpeed: data.stageSpeed,
                            stageEta: data.stageEta,
                            encoder: data.encoder
                        } : q
                    ));
                } else {
                    setProgress(prev => ({
                        ...(prev || { percent: 0 }),
                        percent: data.percent,
                        speed: orPrevious(data.currentSpeed, prev?.speed),
                        eta: orPrevious(data.eta, prev?.eta),
                        downloaded: orPrevious(data.downloaded, prev?.downloaded),
                        stage: data.stage ?? null,
                        processing: !!data.processing,
                        // Always set, so a finished encode never leaves stale numbers behind.
                        stagePercent: data.stagePercent,
                        stageSpeed: data.stageSpeed,
                        stageEta: data.stageEta,
                        encoder: data.encoder,
                        hardware: data.hardware
                    }));
                }
            } else if (data.stage) {
                // A stage update without a percentage: keep whatever the
                // download last reported rather than resetting the ring.
                setProgress(prev => ({ ...(prev || { percent: 0 }), stage: data.stage, processing: !!data.processing, stagePercent: undefined, stageSpeed: undefined, stageEta: undefined, encoder: undefined, hardware: undefined }));
            }
        };
        window.electron.onProgress(handler);
        return () => window.electron.offProgress?.();
    }, []); // Empty dependency array to prevent listener re-binding

    // The progress timeline lives on the preview at the top of the result. Starting a
    // download from far down the format list would leave it out of sight, so glide up
    // to it (only when it isn't already fully visible).
    useEffect(() => {
        if (!downloading || downloadingId) return;
        const root = scrollRootRef.current;
        const el = previewRef.current;
        if (!root || !el) return;
        const r = el.getBoundingClientRect();
        const c = root.getBoundingClientRect();
        if (r.top < c.top || r.bottom > c.bottom) scrollToElement(root, el, !!reduceMotion);
    }, [downloading, downloadingId, reduceMotion]);

    // Same for the completion screen.
    useEffect(() => {
        const root = scrollRootRef.current;
        const el = successRef.current;
        if (complete && root && el) scrollToElement(root, el, !!reduceMotion);
    }, [complete, reduceMotion]);

    // Escape key to close modals
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (showCookieModal) setShowCookieModal(false);
                if (showSettings) setShowSettings(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [showCookieModal, showSettings]);

    // Batch Completion Notification
    useEffect(() => {
        if (isBatchComplete) {
            window.electron.showNotification('Batch Download Complete', `All ${downloadQueue.length} media downloaded successfully.`);
        }
    }, [isBatchComplete, downloadQueue.length]);


    const handleSaveCookies = async () => {
        if (!cookieContent.trim()) return;
        try {
            const res = await window.electron.saveCookies(cookieContent, currentPlatform.id);
            if (res.success) {
                setHasCookies(true);
                setShowCookieModal(false);
                setCookieContent('');
                alert("Cookies saved successfully!");
            } else {
                alert("Failed to save cookies: " + res.error);
            }
        } catch (e: any) {
            alert("Error saving cookies: " + e.message);
        }
    };

    const handleDeleteCookies = async () => {
        if (!confirm("Are you sure you want to delete your saved cookies?")) return;
        try {
            const res = await window.electron.deleteCookies(currentPlatform.id);
            if (res.success) {
                setHasCookies(false);
                setShowCookieModal(false);
            }
        } catch (e: any) {
            alert("Error deleting cookies: " + e.message);
        }
    };

    const handleCookieFileUpload = async () => {
        try {
            const res = await window.electron.chooseCookieFile();
            if (res.success && res.content) {
                setCookieContent(res.content);
            } else if (res.error) {
                alert("Failed to read file: " + res.error);
            }
        } catch (e: any) {
            alert("Error selecting file: " + e.message);
        }
    };

    const handleSubmit = async (e?: React.FormEvent, manualUrl?: string) => {
        if (e) e.preventDefault();
        const rawTarget = manualUrl || url;
        if (!rawTarget || loading) return;

        // Instagram accepts a bare handle; every other platform needs a link.
        // The selected tab is what makes a bare word unambiguous.
        const targetUrl = (currentPlatform.id === 'instagram' && normalizeInstagramHandle(rawTarget))
            || rawTarget;

        // Platform validation
        const u = targetUrl.toLowerCase();
        const validDomains = PLATFORM_DOMAINS[currentPlatform.id];
        if (validDomains && !validDomains.some(d => u.includes(d))) {
            const detectedId = Object.keys(PLATFORM_DOMAINS).find(id => PLATFORM_DOMAINS[id].some(d => u.includes(d)));
            const detectedName = detectedId ? platforms.find(p => p.id === detectedId)?.name : null;

            if (detectedName && detectedId) {
                // Auto-switch platform if it's the wrong one
                const newPlatform = platforms.find(p => p.id === detectedId);
                if (newPlatform) {
                    setCurrentPlatform(newPlatform);
                    // The state won't update immediately, so we continue with detected logic
                }
            } else {
                setError(`Invalid URL for ${currentPlatform.name}. Please check your link.`);
                return;
            }
        }

        setLoading(true);
        setError(null);
        setMetadata(null);
        setComplete(false);
        setDownloadedFilePath(null);
        setProgress(null);
        setSelectedItems(new Set());
        setSearchQuery('');

        // Test instrumentation: time the metadata fetch from the moment Fetch is
        // pressed until the result (or the error) is available to render.
        const fetchStartedAt = performance.now();
        setFetchStart(fetchStartedAt);
        setFetchElapsed(null);

        try {
            // Determine platform for fetch logic
            const detectedId = Object.keys(PLATFORM_DOMAINS).find(id => PLATFORM_DOMAINS[id].some(d => u.includes(d))) as PlatformId;
            const finalPlatformId = detectedId || currentPlatform.id;
            const isTargetSpotify = finalPlatformId === 'spotify';

            // Reuse a background prefetch for this exact URL when one is already
            // A fetch always goes to the platform now. There is no background prefetch and
            // no cached extraction to reuse, so the click pays the full network
            // cost and the result always reflects what the platform is serving at
            // that moment.
            const pending = isTargetSpotify
                ? window.electron.getSpotifyInfo(targetUrl)
                : window.electron.getVideoInfo(targetUrl);

            const res = await pending;

            console.log('Metadata response:', res);
            if (res.success && res.metadata) {
                const finalMetadata = res.metadata;

                // Auto-select all items in playlist
                if (finalMetadata.entries) {
                    setSelectedItems(new Set(finalMetadata.entries.map((e: PlaylistEntry) => e.id)));
                }

                // Subtitle tracks belong to the video just loaded, so drop any
                // previous choice rather than carry it onto unrelated content.
                setSubtitleKey(null);
                setSubtitleSearch('');
                setSubtitleNotice(null);
                setTracksOpen(false);

                // Show the result first, then swap in the proxied thumbnail when
                // it lands. Awaiting the proxy used to add 100-600ms of dead time
                // before anything appeared on screen.
                setMetadata(finalMetadata);

                // Proxy thumbnail for Instagram/Facebook/Spotify (improves CORS/Referer reliability)
                const useProxy = finalMetadata.thumbnail && (
                    finalMetadata.thumbnail.includes('fbcdn.net') ||
                    finalMetadata.thumbnail.includes('scdn.co') ||
                    finalMetadata.thumbnail.includes('spotifycdn.com') ||
                    finalMetadata.thumbnail.includes('googleusercontent.com')
                );

                if (useProxy) {
                    const thumbSrc = finalMetadata.thumbnail;
                    console.log('Proxying thumbnail for stability:', thumbSrc.slice(0, 50));
                    window.electron.getProxyImage(thumbSrc)
                        .then((proxyResult) => {
                            if (!proxyResult) return;
                            setMetadata(prev => (prev && prev.id === finalMetadata.id
                                ? { ...prev, thumbnail: proxyResult }
                                : prev));
                        })
                        .catch((proxyErr) => console.warn('Thumbnail proxy failed:', proxyErr));
                }
            } else {
                setError(res.error || 'Failed to fetch info');
            }
        } catch (err: any) {
            setError(err.message || 'Unknown error');
        } finally {
            setFetchElapsed(performance.now() - fetchStartedAt);
            setLoading(false);
        }
    };

    // Regular video download
    const handleDownload = useCallback(async (formatId: string, videoUrl?: string, videoTitle?: string, itemId?: string, playlistTitle?: string, cut?: { start: number, end: number }) => {
        if (downloading) return;
        const targetUrl = videoUrl || metadata?.webpage_url || url;
        const targetTitle = videoTitle || metadata?.title || 'video';

        const isLiveDownload = !!(metadata?.isLive);
        const jobId = isLiveDownload ? `live-${Date.now()}` : undefined;
        setActiveJobId(jobId || null);

        setDownloading(true);
        setDownloadingId(itemId || null);
        setError(null);
        setProgress({ percent: 0 });

        try {
            await window.electron.downloadVideo({
                url: targetUrl,
                formatId,
                title: targetTitle,
                thumbnail: metadata?.thumbnail,
                playlistTitle,
                jobId: jobId || undefined,
                cutStart: cut?.start,
                cutEnd: cut?.end,
                audioTrack: selectedAudioTrack?.formatId,
                audioLangLabel: selectedAudioTrack?.langLabel,
                // Needed for CDN media: a story tray hands over a bare
                // fbcdn.net URL with no trace of where it came from, and without
                // this the backend files a Facebook story under Instagram.
                platform: currentPlatform.id,
                mediaExt: itemId
                    ? (metadata?.entries?.find((e: PlaylistEntry) => e.id === itemId)?.ext as 'jpg' | 'mp4' | undefined)
                    : undefined
            });
        } catch (err: any) {
            setError(err.message);
            setDownloading(false);
            setDownloadingId(null);
            setProgress(null);
            setActiveJobId(null);
        }
    }, [metadata, downloading, url, selectedAudioTrack]);

    // Subtitles download on their own - no media is fetched, and nothing is
    // attached to a video download.
    const handleSubtitleDownload = useCallback(async () => {
        if (!subtitleSelection || subtitleDownloading) return;
        const targetUrl = metadata?.webpage_url || url;
        if (!targetUrl) return;

        setSubtitleDownloading(true);
        setSubtitleNotice(null);
        setSubtitleResult(null);
        try {
            const result = await window.electron.downloadSubtitles({
                url: targetUrl,
                title: metadata?.title || 'video',
                platform: currentPlatform.id,
                contentType: metadata?.contentType,
                playlistTitle: metadata?.entries?.length ? metadata?.title : undefined,
                thumbnail: metadata?.thumbnail,
                subtitle: subtitleSelection
            });
            if (result?.success) {
                setSubtitleResult(result.path || '');
            } else {
                setSubtitleNotice(result?.error || 'Could not download the subtitles');
            }
        } catch (err: any) {
            setSubtitleNotice(err.message || 'Could not download the subtitles');
        } finally {
            setSubtitleDownloading(false);
        }
    }, [subtitleSelection, subtitleDownloading, metadata, url, currentPlatform.id]);

    const handleStopLiveRecording = useCallback(async () => {
        if (!activeJobId) return;
        await window.electron.cancelDownload(activeJobId);
        setActiveJobId(null);
    }, [activeJobId]);

    const handleCoverDownload = useCallback(async () => {
        if (!metadata?.thumbnail) return;
        const result = await window.electron.saveThumbnail({
            url: metadata.thumbnail,
            title: metadata.title
        });
        if (result?.success) {
            alert('Thumbnail saved to Downloads!');
        } else {
            alert('Failed to save thumbnail');
        }
    }, [metadata]);

    const handleShowInFolder = useCallback(() => {
        if (downloadedFilePath) {
            window.electron.openInFolder(downloadedFilePath);
        } else {
            window.electron.chooseDownloadFolder().then(res => {
                if (res.path) window.electron.openInFolder(res.path);
                else if (metadata) window.electron.openInFolder(metadata.title);
            });
        }
    }, [downloadedFilePath, metadata]);

    const handleOpenFile = useCallback(async () => {
        if (!downloadedFilePath) return;
        const res = await window.electron.openFile(downloadedFilePath);
        // Couldn't open it (no default player, blocked type...): reveal it instead.
        if (!res?.success) window.electron.openInFolder(downloadedFilePath);
    }, [downloadedFilePath]);

    const openCutModal = useCallback(() => {
        if (!metadata?.duration || metadata.duration <= 0) return;
        setCutStart(0);
        setCutEnd(metadata.duration);
        setCutType('video');
        setCutVideoFormat('best');
        setCutAudioFormat('audio_best');
        setShowCutModal(true);
    }, [metadata]);

    const handleCutDownload = useCallback(async (formatId: string) => {
        setShowCutModal(false);
        await handleDownload(formatId, undefined, undefined, undefined, undefined, { start: cutStart, end: cutEnd });
    }, [handleDownload, cutStart, cutEnd]);

    const handleCutTimelineChange = useCallback((s: number, e: number) => {
        setCutStart(s);
        setCutEnd(e);
    }, []);

    // Spotify track download (via YouTube). The format id decides the container
    // and bitrate the matched YouTube stream is converted to, and defaults to
    // the 320k MP3 that playlist rows and the queue have always sent.
    const handleSpotifyDownload = useCallback(async (searchQuery: string, title: string, artist: string, itemId?: string, playlistTitle?: string, externalThumbnail?: string, formatId: 'audio_wav' | 'audio_best' | 'audio_standard' | 'audio_low' = 'audio_best') => {
        if (downloading) return;

        setDownloading(true);
        setDownloadingId(itemId || null);
        setError(null);
        setProgress({ percent: 0 });

        try {
            await window.electron.downloadSpotifyTrack({
                searchQuery,
                title,
                artist,
                thumbnail: externalThumbnail || metadata?.thumbnail,
                playlistTitle,
                formatId
            });
        } catch (err: any) {
            setError(err.message);
            setDownloading(false);
            setDownloadingId(null);
            setProgress(null);
        }
    }, [downloading, metadata]);

    // Listen for Spotify search from browser extension (title/artist → YouTube download).
    // NOTE: this does NOT auto-start the download → it opens the app and shows the
    // track card (like the URL flow) so the user clicks the Download button manually.
    useEffect(() => {
        const handler = (data: { searchQuery: string; title: string; artist: string; thumbnail: string }) => {
            if (!data.searchQuery) return;

            const spotifyPlatform = platforms.find(p => p.id === 'spotify');
            if (spotifyPlatform) setCurrentPlatform(spotifyPlatform);

            setUrl('');
            setMetadata({
                id: `spotify-search-${Date.now()}`,
                title: data.title || 'Spotify Track',
                uploader: data.artist || 'Unknown Artist',
                thumbnail: data.thumbnail || '',
                view_count: 0,
                duration: 0,
                formats: [],
                webpage_url: '',
                contentType: 'video',
                searchQuery: data.searchQuery,
            });
            setComplete(false);
            setError(null);
            setLoading(false);
            setDownloading(false);
            setDownloadingId(null);
            setProgress(null);
            setSelectedItems(new Set());
            setSearchQuery('');
        };
        window.electron.onExternalSpotifyDownload(handler);
        return () => {
            window.electron.offExternalSpotifyDownload?.();
        };
    }, []);

    // Get all available video formats sorted by resolution - prioritize MP4 over WEBM
    const formats = useMemo(() => {        if (!metadata?.formats) return [];

        // Priority order for video extensions (lower index = higher priority)
        const extPriority: Record<string, number> = {
            'mp4': 1,
            'm4v': 2,
            'mov': 3,
            'webm': 4,
            'mkv': 5,
            'avi': 6,
            'flv': 7
        };

        const getExtPriority = (ext: string | undefined) => {
            if (!ext) return 999;
            return extPriority[ext.toLowerCase()] || 10;
        };

        const videoFormats = metadata.formats
            .filter(f => f.video_ext !== 'none' && (f.height || f.format_note?.includes('video') || f.format_id.includes('video')))
            .reduce((acc: Format[], cur) => {
                const existing = acc.find(x => x.height === cur.height);
                if (!existing) {
                    acc.push(cur);
                } else {
                    // Prefer MP4 over other formats, then compare by filesize
                    const curExtPriority = getExtPriority(cur.ext);
                    const existingExtPriority = getExtPriority(existing.ext);

                    if (curExtPriority < existingExtPriority) {
                        // Current format has better extension (MP4 preferred)
                        const index = acc.indexOf(existing);
                        acc[index] = cur;
                    } else if (curExtPriority === existingExtPriority && (cur.filesize || 0) > (existing.filesize || 0)) {
                        // Same extension, pick larger file
                        const index = acc.indexOf(existing);
                        acc[index] = cur;
                    }
                }
                return acc;
            }, [])
            .sort((a, b) => (b.height || 0) - (a.height || 0));

        return videoFormats;
    }, [metadata]);

    const maxResolution = useMemo(() => {
        if (formats.length === 0) return null;
        const max = formats[0].height || 0;
        if (max >= 2160) return '4K';
        if (max >= 1440) return '2K';
        if (max >= 1080) return 'Full HD';
        if (max >= 720) return 'HD';
        return 'SD';
    }, [formats]);

    const handleImgError = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
        const img = e.currentTarget;
        const src = img.src;
        // Attempt to fall back to lower resolution YouTube thumbnails if applicable
        const res = ['maxresdefault', 'sddefault', 'hqdefault', 'mqdefault'];
        for (let i = 0; i < res.length - 1; i++) {
            if (src.includes(res[i])) {
                img.src = src.replace(res[i], res[i + 1]);
                return;
            }
        }
        
        // If it's an external image (like lh3.googleusercontent) and fails, avoid breaking the layout
        if (src.includes('googleusercontent.com') || src.includes('ggpht.com')) {
            // Keep the container size but maybe show a broken state or a generic icon
            // For now, we'll let the user see a broken image icon rather than shrinking the entire div to 0 height
            // We ensure it doesn't loop infinitely
            img.onerror = null;
        } else {
            img.style.display = 'none';
        }
    }, []);

    const handlePlatformChange = (p: Platform) => {
        if (loading || downloading || batchDownloading) return;
        setCurrentPlatform(p);
        setUrl('');
        setMetadata(null);
        setError(null);
        setComplete(false);
        setFetchStart(null);
        setFetchElapsed(null);
        setDownloadedFilePath(null);
        setProgress(null);
        setSelectedItems(new Set());
        setSearchQuery('');
        setBatchUrls('');
        setDownloadQueue([]);
    };

    // Batch download functions
    const parseBatchUrls = (text: string): string[] => {
        return text
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line.length > 0 && (line.startsWith('http://') || line.startsWith('https://')));
    };



    // Playlist helpers
    const toggleItem = useCallback((id: string) => {
        setSelectedItems(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    // Filter entries by search
    const filteredEntries = useMemo(() => {
        if (!metadata?.entries) return [];
        if (!searchQuery.trim()) return metadata.entries;
        const q = searchQuery.toLowerCase();
        return metadata.entries.filter(e =>
            e.title.toLowerCase().includes(q) ||
            (e.artist && e.artist.toLowerCase().includes(q))
        );
    }, [metadata?.entries, searchQuery]);

    const selectAll = useCallback(() => {
        if (metadata?.entries) {
            setSelectedItems(new Set(filteredEntries.map(e => e.id)));
        }
    }, [metadata?.entries, filteredEntries]);

    const deselectAll = useCallback(() => {
        setSelectedItems(new Set());
    }, []);

    const hasEntries = metadata && metadata.entries && metadata.entries.length > 0;
    const isPlaylist = hasEntries && metadata?.contentType === 'playlist';
    // A story tray can legitimately be empty - "nike has no stories right
    // now" is a result, and it still belongs in the stories card, not in the
    // single-video card that would read as a 0-second video.
    const isStory = !!metadata && metadata?.contentType === 'story';
    // Facebook resolves one URL to one story, which is one video, so it gets the
    // ordinary single-video card. Only a tray of several stories is a tray.
    const isSingleStory = isStory && !!metadata?.singleStory;
    const storyCount = metadata?.entries?.length ?? 0;
    const isLive = !hasEntries && !!metadata?.isLive && metadata.duration === 0;

    // Subtitle tracks are hidden for music tracks (pure audio or music videos):
    // YouTube auto-generates captions from the vocal which read worse than the
    // lyrics panel, so showing both only splits attention. Live streams have no
    // static caption list to speak of.
    const hasTracksPanel = !isLive && !isMusicTrack && subtitleTracks.length > 0;

    // Summary for the collapsed subtitle row: the current pick if there is one,
    // otherwise the shape of what is on offer.
    const tracksMeta = subtitleSelection
        ? `${subtitleSelection.langLabel || subtitleSelection.lang} · ${subtitleFormat.toUpperCase()}`
        : `${subtitleTracks.length} language${subtitleTracks.length === 1 ? '' : 's'} · ${subtitleTracks.filter((t) => !t.isAuto).length} by creator · ${subtitleTracks.filter((t) => t.isAuto).length} auto`;

    // Bulk download (Playlist)
    const handleBulkDownload = async (type: 'video' | 'audio_best' | 'audio_standard' | 'audio_low') => {
        if (downloading || selectedItems.size === 0) return;

        setDownloading(true);
        setError(null);

        const itemsToDownload = filteredEntries.filter(e => selectedItems.has(e.id));
        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < itemsToDownload.length; i++) {
            const item = itemsToDownload[i];
            setDownloadingId(item.id);
            // Update checking status
            setProgress({ percent: 0, speed: `Processing ${i + 1}/${itemsToDownload.length}` });

            try {
                // Determine format
                const formatId = type === 'video' ? 'best' : type;

                // Pass the playlist title to organize files into a subfolder
                const playlistTitle = metadata?.title;

                // A chosen bulk bitrate has to reach the Spotify path, which converts the
                // matched stream itself instead of going through downloadVideo.
                if (isSpotify) {
                    await window.electron.downloadSpotifyTrack({
                        searchQuery: item.searchQuery || `${item.title} ${item.artist || ''}`,
                        title: item.title,
                        artist: item.artist || '',
                        thumbnail: item.thumbnail,
                        playlistTitle, // This will create the /playlists/{title}/ folder
                        suppressNotifications: true,
                        formatId: (formatId === 'best' ? 'audio_best' : formatId) as 'audio_wav' | 'audio_best' | 'audio_standard' | 'audio_low'
                    });
                } else {
                    await window.electron.downloadVideo({
                        url: item.url,
                        formatId: formatId,
                        title: item.title,
                        platform: currentPlatform.id,
contentType: metadata?.contentType || (isStory ? 'story' : undefined),
        mediaExt: item.ext as 'jpg' | 'mp4' | undefined,
        playlistTitle, // This will create the /playlists/{title}/ folder
                        suppressNotifications: true
                    });
                }
                successCount++;
            } catch (e: any) {
                console.error(`Failed to download ${item.title}`, e);
                failCount++;
            }
        }

        setDownloading(false);
        setDownloadingId(null);
        setProgress(null);

        // Show summary notification
        if (failCount === 0) {
            window.electron.showNotification('Playlist Download Complete', `All ${successCount} media downloaded successfully.`);
        } else {
            window.electron.showNotification('Download Complete', `Success: ${successCount}, Failed: ${failCount}`);
            alert(`Download complete. Success: ${successCount}, Failed: ${failCount}`);
        }
    };

    // Download buttons component for reuse
    const DownloadActions = ({ showLabels = true }: { showLabels?: boolean }) => (
        <div className="flex flex-col gap-2">
            <div className="flex gap-2">
                <button
                    onClick={() => handleBulkDownload('audio_best')}
                    disabled={selectedItems.size === 0 || downloading}
                    className="flex-1 h-10 bg-green-500/20 border border-green-500/30 rounded-xl font-medium text-xs text-green-400 flex items-center justify-center gap-1.5 cursor-pointer hover:bg-green-500/30 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    <Music className="w-3.5 h-3.5" /> Best
                </button>
                <button
                    onClick={() => handleBulkDownload('audio_standard')}
                    disabled={selectedItems.size === 0 || downloading}
                    className="flex-1 h-10 bg-green-500/20 border border-green-500/30 rounded-xl font-medium text-xs text-green-400 flex items-center justify-center gap-1.5 cursor-pointer hover:bg-green-500/30 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    <Music className="w-3.5 h-3.5" /> Std
                </button>
                <button
                    onClick={() => handleBulkDownload('audio_low')}
                    disabled={selectedItems.size === 0 || downloading}
                    className="flex-1 h-10 bg-green-500/20 border border-green-500/30 rounded-xl font-medium text-xs text-green-400 flex items-center justify-center gap-1.5 cursor-pointer hover:bg-green-500/30 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    <Music className="w-3.5 h-3.5" /> Low
                </button>
            </div>
            {!isSpotify && (
                <button
                    onClick={() => handleBulkDownload('video')}
                    disabled={selectedItems.size === 0 || downloading}
                    className="w-full h-10 bg-blue-500/20 border border-blue-500/30 rounded-xl font-medium text-sm text-blue-400 flex items-center justify-center gap-2 cursor-pointer hover:bg-blue-500/30 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    <Film className="w-4 h-4" /> {showLabels && `Download Video (${selectedItems.size})`}
                </button>
            )}
        </div>
    );

    return (
        <div ref={scrollRootRef} className="w-full h-full bg-[#0a0a0a] text-white overflow-y-auto overflow-x-hidden relative isolate [scrollbar-gutter:stable]">
            {/* Ambient glow: a faint wash of the selected platform's colour behind the
                header. It sits behind the content (-z-10 inside the isolated stacking
                context) and cross-fades whenever the platform changes. */}
            <motion.div
                key={currentPlatform.id}
                aria-hidden="true"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
                className="pointer-events-none absolute inset-x-0 top-0 h-[460px] -z-10"
                style={{ background: `radial-gradient(60% 100% at 50% 0%, ${currentPlatform.color}1a, transparent 100%)` }}
            />

            {/* Header controls: one grouped cluster instead of three separate floating
                buttons, drawn in the same ghost-icon style as the title bar. */}
            <div
                role="toolbar"
                aria-label="App shortcuts"
                className="absolute top-4 right-4 z-50 flex items-center gap-0.5 p-1 rounded-xl bg-white/[0.04] border border-white/10"
            >
                <button
                    type="button"
                    onClick={() => setShowLibrary(true)}
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-white/55 hover:text-white hover:bg-white/10 transition-colors duration-150 cursor-pointer"
                    title="Library"
                    aria-label="Open Library"
                >
                    <LayoutGrid className="w-[18px] h-[18px]" />
                </button>

                <span className="w-px h-4 mx-0.5 bg-white/10" aria-hidden="true" />

                <button
                    type="button"
                    onClick={() => setShowDiscordModal(true)}
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-[#5865F2] hover:bg-[#5865F2]/15 transition-colors duration-150 cursor-pointer"
                    title="Join Discord"
                    aria-label="Join Discord"
                >
                    <FaDiscord className="w-[18px] h-[18px]" />
                </button>

                <button
                    type="button"
                    onClick={() => setShowTutorial(true)}
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-purple-400 hover:bg-purple-500/15 transition-colors duration-150 cursor-pointer"
                    title="Install browser extension"
                    aria-label="Install browser extension"
                >
                    <Puzzle className="w-[18px] h-[18px]" />
                </button>

                <span className="w-px h-4 mx-0.5 bg-white/10" aria-hidden="true" />

                <button
                    type="button"
                    onClick={() => setShowSettings(true)}
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-white/55 hover:text-white hover:bg-white/10 transition-colors duration-150 cursor-pointer"
                    title="Settings"
                    aria-label="Settings"
                >
                    <SettingsIcon className="w-[18px] h-[18px]" />
                </button>
            </div>

            <div className="max-w-2xl mx-auto px-6 pt-12 pb-24 relative">

                {/* Title */}
                <div className="text-center mb-10">
                    <h1 className="text-4xl sm:text-6xl font-black tracking-tighter mb-2 font-['Montserrat']">
                        VibeDownloader
                    </h1>
                    <p className="text-white/40">
                        Download from {currentPlatform.name}
                        {isSpotify && <span className="text-green-400 text-xs ml-2">• via YouTube</span>}
                    </p>
                </div>

                {/* Platform Selector */}
                <div className="flex flex-wrap justify-center gap-3 mb-6">
                    {platforms.map((p) => {
                        const isActive = currentPlatform.id === p.id;
                        const isBusy = loading || downloading || batchDownloading;
                        const isDisabled = isBusy && !isActive;

                        return (
                            <button
                                key={p.id}
                                onClick={() => handlePlatformChange(p)}
                                disabled={isDisabled}
                                className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-300
                                    ${isActive
                                        ? `${p.bgClass} scale-110 ${p.id === 'x' ? 'text-black' : 'text-white'}`
                                        : 'bg-white/[0.08] hover:bg-white/[0.12]'
                                    }
                                    ${isDisabled ? 'opacity-20 cursor-not-allowed grayscale scale-90' : 'cursor-pointer'}
                                `}
                                style={{
                                    color: isActive ? undefined : p.color,
                                    boxShadow: isActive ? `0 8px 32px -4px ${p.color}50, 0 0 0 2px ${p.color}` : 'none'
                                }}
                            >
                                {p.icon}
                            </button>
                        );
                    })}
                </div>

                {/* Single / Batch switch. Both options are always visible, so it is clear
                    which mode is active and what the other one is. */}
                <div className="flex justify-center mb-6">
                    <div
                        role="group"
                        aria-label="Download mode"
                        className={`relative inline-grid grid-cols-[6rem_6rem] p-1 rounded-xl bg-white/[0.04] border border-white/10 transition-opacity ${loading || downloading || batchDownloading ? 'opacity-40' : ''}`}
                    >
                        {/* Sliding highlight: transform + colour only, so it stays on the GPU and never reflows. */}
                        <span
                            aria-hidden="true"
                            className="absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded-lg will-change-transform pointer-events-none transition-[transform,background-color] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none"
                            style={{
                                transform: batchMode ? 'translateX(100%)' : 'translateX(0)',
                                backgroundColor: batchMode ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.10)',
                            }}
                        />
                        {([
                            { batch: false, label: 'Single', Icon: Link2, from: { scale: 0.5, rotate: -60, opacity: 0.4 } },
                            { batch: true, label: 'Batch', Icon: Layers, from: { scale: 0.6, y: 6, opacity: 0.4 } },
                        ] as const).map(({ batch, label, Icon, from }) => {
                            const active = batchMode === batch;
                            const busy = loading || downloading || batchDownloading;
                            return (
                                <button
                                    key={label}
                                    type="button"
                                    aria-pressed={active}
                                    disabled={busy}
                                    onClick={() => {
                                        if (active) return;
                                        setBatchMode(batch);
                                        // Leaving batch mode clears what was queued, as before.
                                        if (batchMode) {
                                            setBatchUrls('');
                                            setDownloadQueue([]);
                                        }
                                    }}
                                    className={`relative z-10 h-8 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors duration-200 ${busy ? 'cursor-not-allowed' : 'cursor-pointer'} ${active
                                        ? (batch ? 'text-blue-300' : 'text-white')
                                        : 'text-white/45 hover:text-white/80'
                                        }`}
                                >
                                    {/* The icon pops when its mode becomes active (transform/opacity only). */}
                                    <motion.span
                                        key={`${label}-${active}`}
                                        className="flex will-change-transform"
                                        initial={active && !modeReduce ? from : false}
                                        animate={{ scale: 1, rotate: 0, y: 0, opacity: 1 }}
                                        transition={{ type: 'spring', stiffness: 520, damping: 16, mass: 0.6 }}
                                    >
                                        <Icon className="w-3.5 h-3.5" />
                                    </motion.span>
                                    {label}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <motion.div
                    key={batchMode ? 'batch' : 'single'}
                    initial={modeReduce ? false : { opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.22, ease: 'easeOut' }}
                >
                {!batchMode ? (
                    <form onSubmit={handleSubmit} className="mb-8 w-full max-w-xl mx-auto">
                        <div className="flex flex-col sm:flex-row gap-2.5 relative z-20">
                            <div className="flex-1 relative group">
                                {/* Minimalism Premium Glow */}
                                <div className="absolute -inset-0.5 bg-gradient-to-r from-white/0 via-white/5 to-white/0 rounded-xl blur-lg opacity-0 group-hover:opacity-100 transition-all duration-500" />

                                <div className="relative">
                                    {/* The Glass Base */}
                                    <div
                                        className="absolute inset-0 bg-[#0a0a0b]/60 backdrop-blur-xl rounded-xl border border-white/5 group-hover:border-white/10 transition-all duration-300"
                                    />
                                    <div
                                        className="absolute inset-0 rounded-xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-500 pointer-events-none"
                                        style={{
                                            boxShadow: `0 0 25px ${currentPlatform.color}15`,
                                            border: `1px solid ${currentPlatform.color}50`,
                                            background: `linear-gradient(to right, ${currentPlatform.color}05, transparent)`
                                        }}
                                    />

                                    <div className="relative flex items-center h-14 sm:h-15">
                                        <div className="pl-5 pointer-events-none">
                                            <Search className="w-4 h-4 text-white/20 group-focus-within:text-white/40 transition-all duration-300" />
                                        </div>

                                        <input
                                            type="text"
                                            value={url}
                                            onChange={(e) => setUrl(e.target.value)}
                                            placeholder={isSpotify ? 'Drop link...' : currentPlatform.id === 'instagram' ? 'Paste link or @username...' : 'Paste link here...'}
                                            disabled={loading || downloading || batchDownloading}
                                            className="w-full h-full pl-3 pr-40 bg-transparent text-white placeholder-white/20 outline-none font-bold text-sm tracking-tight disabled:opacity-50 transition-all"
                                        />

                                        {/* Action Group Inside Input */}
                                        <div className="absolute right-2 flex items-center gap-1.5">
                                            {['instagram', 'facebook', 'youtube', 'tiktok'].includes(currentPlatform.id) && (
                                                <button
                                                    type="button"
                                                    onClick={() => setShowCookieModal(true)}
                                                    className={`h-9 w-9 flex items-center justify-center rounded-lg transition-all duration-300 cursor-pointer ${hasCookies
                                                        ? 'bg-green-500/10 text-green-400 border border-green-500/15'
                                                        : 'bg-white/[0.03] text-white/20 hover:text-white hover:bg-white/10 border border-white/5'}`}
                                                    title={hasCookies ? "Active session" : "Login required"}
                                                >
                                                    <Key className={`w-3.5 h-3.5 ${hasCookies ? 'animate-pulse' : ''}`} />
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={async () => {
                                                    try {
                                                        const text = await navigator.clipboard.readText();
                                                        if (!text) return;

                                                        setUrl(text);

                                                        // Detect platform
                                                        const u = text.toLowerCase();
                                                        const detectedId = Object.keys(PLATFORM_DOMAINS).find(id => PLATFORM_DOMAINS[id].some(d => u.includes(d)));

                                                        // A pasted bare handle has no domain, so fall back to
                                                        // the selected tab rather than rejecting it.
                                                        if (!detectedId && currentPlatform.id === 'instagram' && normalizeInstagramHandle(text)) {
                                                            setUrl(text);
                                                            handleSubmit(undefined, text);
                                                            return;
                                                        }

                                                        if (detectedId) {
                                                            const newPlatform = platforms.find(p => p.id === detectedId);
                                                            if (newPlatform) {
                                                                setCurrentPlatform(newPlatform);
                                                                // Trigger fetch with manual URL
                                                                handleSubmit(undefined, text);
                                                            }
                                                        } else {
                                                            setError("URL not recognized or platform not supported. Please try again.");
                                                            setTimeout(() => setError(null), 5000);
                                                        }
                                                    } catch (e) {
                                                        console.log('Clipboard access denied');
                                                    }
                                                }}
                                                disabled={loading || downloading || batchDownloading}
                                                className={`h-9 px-4 bg-white/[0.03] hover:bg-white/[0.08] border border-white/10 rounded-lg text-[10px] font-black uppercase tracking-widest text-white/40 hover:text-white transition-all active:scale-95 flex items-center gap-2 group/paste ${loading || downloading || batchDownloading ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}
                                            >
                                                <ClipboardIcon className="w-3.5 h-3.5 opacity-50 group-hover/paste:opacity-100 transition-opacity" />
                                                Paste
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={!url || loading || downloading || batchDownloading}
                                className={`h-14 sm:h-15 px-8 rounded-xl font-bold text-[10px] uppercase tracking-widest transition-all duration-500 cursor-pointer active:scale-95 disabled:opacity-20 disabled:cursor-not-allowed group/btn overflow-hidden relative
                                    ${loading
                                        ? 'bg-white/5 text-white/30 border border-white/5'
                                        : 'bg-white text-black hover:shadow-lg hover:shadow-white/5'}`}
                            >
                                {/* Button Shine Effect */}
                                {!loading && (
                                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-black/5 to-transparent -translate-x-full group-hover/btn:animate-[shine_1.5s_ease-in-out_infinite] pointer-events-none" />
                                )}

                                <span className="relative z-10 flex items-center gap-2">
                                    {loading ? (
                                        <Loader className="w-4 h-4 animate-spin mx-auto" />
                                    ) : (
                                        <>
                                            FETCH
                                            <ArrowRight className="w-3.5 h-3.5 transition-transform duration-300 group-hover/btn:translate-x-0.5" />
                                        </>
                                    )}
                                </span>
                            </button>
                        </div>
                    </form>
                ) : (
                    <div className="mb-8 w-full max-w-2xl mx-auto">
                        <div className="relative group">
                            <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500/20 to-purple-500/20 rounded-xl blur-lg opacity-0 group-hover:opacity-100 transition-all duration-500" />
                            <div className="relative">
                                <div className="absolute inset-0 bg-[#0a0a0b]/60 backdrop-blur-lg rounded-xl border border-white/5 group-hover:border-white/10 transition-all duration-300" />
                                <div className="relative p-1">
                                    <textarea
                                        value={batchUrls}
                                        onChange={(e) => setBatchUrls(e.target.value)}
                                        placeholder={`Paste links here (one per line)...\nExample:\nhttps://youtube.com/watch?v=...\nhttps://instagram.com/p/...`}
                                        className="w-full h-32 bg-transparent text-white placeholder-white/20 p-4 outline-none font-mono text-xs resize-none rounded-lg custom-scrollbar"
                                        disabled={batchDownloading || downloadQueue.length > 0}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Batch Controls */}
                        {!batchDownloading && downloadQueue.length === 0 && (
                            <button
                                onClick={handleBatchSubmit}
                                disabled={!batchUrls.trim()}
                                className="mt-4 w-full h-12 bg-white text-black font-bold rounded-xl uppercase tracking-widest text-xs hover:bg-white/90 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-[0_0_20px_-5px_rgba(255,255,255,0.3)] hover:shadow-[0_0_25px_-5px_rgba(255,255,255,0.5)] transform active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer"
                            >
                                <PlayCircle className="w-4 h-4" />
                                Start Batch Download
                            </button>
                        )}

                        {/* Batch Progress Controls */}
                        {downloadQueue.length > 0 && !isBatchComplete && (
                            <div className="mt-4 flex gap-3">
                                {!batchDownloading ? (
                                    <button
                                        onClick={resumeBatchDownload}
                                        className="flex-1 h-12 bg-green-500 text-black font-bold rounded-xl uppercase tracking-widest text-xs hover:bg-green-400 transition-all flex items-center justify-center gap-2 cursor-pointer"
                                    >
                                        <Play className="w-4 h-4" /> Resume
                                    </button>
                                ) : (
                                    <button
                                        onClick={pauseBatchDownload}
                                        className="flex-1 h-12 bg-yellow-500 text-black font-bold rounded-xl uppercase tracking-widest text-xs hover:bg-yellow-400 transition-all flex items-center justify-center gap-2 cursor-pointer"
                                    >
                                        <Pause className="w-4 h-4" /> Pause
                                    </button>
                                )}
                                <button
                                    onClick={cancelBatchDownload}
                                    className="px-6 h-12 bg-white/5 text-white/60 font-bold rounded-xl uppercase tracking-widest text-xs hover:bg-red-500/20 hover:text-red-400 border border-white/5 hover:border-red-500/20 transition-all cursor-pointer"
                                >
                                    Cancel
                                </button>
                            </div>
                        )}

                        {/* Download Queue with Premium UI */}
                        {downloadQueue.length > 0 && (
                            <div className="mt-8 space-y-4">
                                <div className="flex items-center justify-between mb-4 px-1">
                                    <h3 className="text-sm font-bold text-white/60 uppercase tracking-widest">Download Queue</h3>
                                    <span className="text-xs font-medium text-white/40 bg-white/5 px-2 py-1 rounded-lg border border-white/5">
                                        {downloadQueue.filter(q => q.status === 'completed').length} / {downloadQueue.length} Done
                                    </span>
                                </div>

                                <div className="space-y-3 max-h-[500px] smooth-scroll custom-scrollbar pr-1 hardware-accelerated">
                                    <AnimatePresence initial={false}>
                                        {downloadQueue.map((item, index) => (
                                            <BatchQueueItem
                                                key={item.id}
                                                item={item}
                                                index={index}
                                                onToggleMode={toggleItemMode}
                                                onRemove={removeFromQueue}
                                                onRetry={handleRetryBatchItem}
                                            />
                                        ))}
                                    </AnimatePresence>
                                </div>
                            </div>
                        )}

                        {/* Batch Success Message */}
                        <AnimatePresence>
                            {isBatchComplete && (
                                <motion.div
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0 }}
                                    className="mt-6 p-6 rounded-2xl bg-gradient-to-br from-green-500/20 to-emerald-600/10 border border-green-500/20 text-center relative overflow-hidden"
                                >
                                    <div className="absolute inset-0 bg-green-500/5 animate-pulse" />
                                    <div className="relative z-10">
                                        <div className="w-12 h-12 bg-green-500 text-white rounded-full flex items-center justify-center mx-auto mb-3 shadow-[0_0_20px_rgba(34,197,94,0.4)]">
                                            <Check className="w-6 h-6" />
                                        </div>
                                        <h3 className="text-xl font-bold text-white mb-1">Batch Completed!</h3>
                                        <p className="text-white/60 text-sm mb-6">All {downloadQueue.length} files have been downloaded successfully.</p>

                                        <div className="flex gap-3 justify-center">
                                            <button
                                                onClick={() => {
                                                    setDownloadQueue([]);
                                                    setBatchUrls('');
                                                    setBatchDownloading(false);
                                                }}
                                                className="px-6 py-2.5 bg-white text-black font-bold rounded-xl text-xs uppercase tracking-wider hover:bg-white/90 transition shadow-lg shadow-white/10 cursor-pointer"
                                            >
                                                Start New Batch
                                            </button>
                                            <button
                                                onClick={() => setBatchMode(false)}
                                                className="px-6 py-2.5 bg-white/10 text-white font-bold rounded-xl text-xs uppercase tracking-wider hover:bg-white/20 transition border border-white/5 cursor-pointer"
                                            >
                                                Exit
                                            </button>
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                )}
                </motion.div>

                {/* Error */}
                <AnimatePresence>
                    {error && (
                        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-center text-sm">
                            {error}
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Fetch timing (diagnostic, test builds only) */}
                {SHOW_FETCH_TIMER && fetchStart !== null && (loading || fetchElapsed !== null) && (
                    <FetchTimer
                        start={fetchStart}
                        elapsed={fetchElapsed}
                        failed={!!fetchElapsed && !!error}
                    />
                )}

                {/* Content */}
                <AnimatePresence mode="wait">
                    {/* Loading Skeleton */}
                    {loading && (
                        <motion.div
                            key="skeleton"
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0, transition: { duration: 0.18 } }}
                            exit={{ opacity: 0, transition: { duration: 0 } }}
                        >
                            <div className="relative">
                                {/* What the app is doing while it looks the link up */}
                                <div className="w-full aspect-video bg-white/[0.03] rounded-2xl mb-5 border border-white/5 flex items-center justify-center p-6">
                                    <FetchActivity platform={currentPlatform.name} color={currentPlatform.color} />
                                </div>

                                {/* Info */}
                                <div className="animate-pulse space-y-3 mb-6 px-2">
                                    <div className="h-6 bg-white/5 rounded-lg w-3/4" />
                                    <div className="flex gap-4">
                                        <div className="h-3 bg-white/5 rounded w-24" />
                                        <div className="h-3 bg-white/5 rounded w-16" />
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    )}
                    {/* Single Video/Track Result */}
                    {metadata && !loading && !complete && !isPlaylist && (!isStory || isSingleStory) && (
                        <motion.div key="video" variants={resultContainer} initial={reduceMotion ? false : 'hidden'} animate="show" exit={{ opacity: 0, transition: { duration: 0.1 } }}>
                            {/* Thumbnail */}
                            <motion.div ref={previewRef} variants={resultMedia} className={`relative rounded-2xl overflow-hidden mb-5 ${isSingleStory ? 'bg-black' : 'bg-gradient-to-br from-white/5 to-white/10'}`}>
                                {!reduceMotion && (
                                    <motion.div
                                        aria-hidden
                                        className="pointer-events-none absolute inset-y-0 -inset-x-1/4 z-10 bg-gradient-to-r from-transparent via-white/[0.14] to-transparent"
                                        style={{ skewX: -14 }}
                                        initial={{ x: '-110%' }}
                                        animate={{ x: '110%' }}
                                        transition={{ duration: 0.85, delay: 0.12, ease: 'easeInOut' }}
                                    />
                                )}
                                {metadata.thumbnail ? (
                                    /* A story is a portrait frame. Cropping it to 16:9 the way a
                                       landscape thumbnail is cropped would show a letterbox slit
                                       of the middle of the video, so it is fitted whole instead. */
                                    <motion.img
                                        src={metadata.thumbnail}
                                        alt=""
                                        initial={reduceMotion ? false : { scale: 1.07 }}
                                        animate={{ scale: 1 }}
                                        transition={{ duration: 0.9, ease: RESULT_EASE }}
                                        onError={handleImgError}
                                        className={isSingleStory ? 'max-h-[60vh] w-auto max-w-full mx-auto object-contain block' : 'w-full aspect-video object-cover'}
                                        referrerPolicy="no-referrer"
                                    />
                                ) : (
                                    <div className="w-full aspect-video flex items-center justify-center bg-gradient-to-br from-green-900/30 to-green-600/20">
                                        <Disc className="w-20 h-20 text-green-500/50" />
                                    </div>
                                )}

                                {/* Resolution Badge */}
                                {!isLive && maxResolution && (
                                    <div className="absolute top-3 left-3 px-2 py-1 bg-black/80 backdrop-blur rounded text-xs font-bold" style={{ color: currentPlatform.color }}>
                                        {maxResolution}
                                    </div>
                                )}

                                {/* LIVE badge */}
                                {isLive && (
                                    <div className="absolute top-3 left-3 px-2 py-1 bg-red-500/95 rounded text-xs font-bold text-white flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> LIVE
                                    </div>
                                )}

                                {metadata.duration > 0 && (
                                    <div className="absolute bottom-3 right-3 px-2 py-1 bg-black/80 backdrop-blur rounded text-xs font-semibold">
                                        {formatDuration(metadata.duration)}
                                    </div>
                                )}

                                {/* Spotify badge */}
                                {isSpotify && metadata.album && (
                                    <div className="absolute top-3 right-3 px-2 py-1 bg-green-500/90 rounded text-xs font-semibold text-black">
                                        {metadata.album}
                                    </div>
                                )}

                                {downloading && !downloadingId && (
                                    <div className="absolute inset-0 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center">
                                        {!reduceMotion && (
                                            <motion.span
                                                aria-hidden="true"
                                                className="pointer-events-none absolute inset-0 rounded-2xl border-2"
                                                style={{ borderColor: currentPlatform.color }}
                                                initial={{ opacity: 0 }}
                                                animate={{ opacity: [0, 0.9, 0] }}
                                                transition={{ duration: 0.9, delay: 0.25, ease: 'easeOut' }}
                                            />
                                        )}
                                        {isLive ? (
                                            <>
                                                <div className="flex items-center gap-2">
                                                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                                                    <p className="text-white font-bold text-base">Recording live...</p>
                                                </div>
                                                <p className="mt-2 text-white/50 text-xs text-center">
                                                    Recording from the current stream position.
                                                </p>
                                                <button
                                                    onClick={handleStopLiveRecording}
                                                    className="mt-5 px-5 py-2 rounded-lg bg-red-500/90 hover:bg-red-500 text-white text-sm font-bold transition cursor-pointer flex items-center gap-2"
                                                >
                                                    <Pause className="w-4 h-4" /> Stop recording
                                                </button>
                                            </>
                                        ) : (
                                            <div className="relative w-full max-w-md flex flex-col sm:flex-row items-center gap-6 sm:gap-9 text-left">
                                                <div className="shrink-0">
                                                    <CircularProgress percent={progress?.percent || 0} color={currentPlatform.color} processing={!!progress?.processing} stagePercent={progress?.stagePercent} />
                                                </div>
                                                <div className="flex-1 min-w-0 w-full">
                                                    <DownloadActivity progress={progress} color={currentPlatform.color} />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </motion.div>

                            {/* Info */}
                            <motion.div variants={resultItem} className="flex items-start justify-between mb-5">
                                <div className="flex-1">
                                    <h2 className="text-lg font-bold leading-snug mb-2">{metadata.title}</h2>
                                    <div className="flex items-center gap-4 text-white/40 text-sm">
                                        <span className="flex items-center gap-1.5"><User className="w-4 h-4" /> {metadata.uploader}</span>
                                        {/* A story has no view count to report. Showing "0" would read as
                                            "nobody has watched this" rather than "this number is not a thing
                                            we know", so it is left out entirely. */}
                                        {!isSpotify && !isSingleStory && metadata.view_count > 0 && <span className="flex items-center gap-1.5"><Eye className="w-4 h-4" /> {formatNumber(metadata.view_count)}</span>}
                                        {isSpotify && metadata.view_count > 0 && <span>Popularity: {metadata.view_count}</span>}
                                    </div>
                                </div>
                                <div className="flex items-center gap-3 shrink-0 ml-4">
                                    {metadata.thumbnail && (
                                        <button
                                            onClick={() => handleCoverDownload()}
                                            className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center transition cursor-pointer"
                                            title="Save Thumbnail"
                                        >
                                            <ImageIcon className="w-5 h-5 text-white/60" />
                                        </button>
                                    )}
                                    {!isSpotify && metadata.duration > 0 && (
                                        <button
                                            onClick={openCutModal}
                                            disabled={downloading}
                                            className="w-10 h-10 rounded-xl bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 hover:border-purple-500/40 flex items-center justify-center transition cursor-pointer disabled:opacity-40"
                                            title="Cut & Download"
                                        >
                                            <Scissors className="w-5 h-5 text-purple-400" />
                                        </button>
                                    )}
                                </div>
                            </motion.div>

                            <motion.div variants={resultItem}>
                            {/* Lyrics and subtitle tracks sit above the download
                                options, each folded to a single row. They are the
                                reason to come back to a result after the file is
                                already saved, not the reason to open one, so neither
                                takes space until asked. */}
                            <div className="grid gap-2 mb-4">
                                {lyricsLoading && (
                                    <div className="flex items-center gap-2.5 px-3.5 py-3 rounded-2xl bg-purple-500/10 border border-purple-500/20 text-purple-200 text-xs backdrop-blur-md animate-pulse">
                                        <Loader2 className="w-4 h-4 animate-spin text-purple-400 shrink-0" />
                                        <div className="min-w-0 flex-1">
                                            <p className="font-semibold text-purple-200">Finding synchronized lyrics...</p>
                                            <p className="text-[10px] text-purple-300/60 truncate">Looking up LRCLIB &amp; NetEase</p>
                                        </div>
                                    </div>
                                )}
                                {/* Collapsed on arrival, like the subtitles row below it. The panel
                                re-collapses whenever a new track's lyrics land
                                (LyricsPanel resets itself on a title change),
                                so fetching a result never shoves the page down
                                with several hundred pixels of lyrics nobody
                                asked to read yet. */}
                                {lyrics && <LyricsPanel lyrics={lyrics} defaultCollapsed={true} />}
                                {hasTracksPanel && (
                                    <SectionToggle
                                        open={tracksOpen}
                                        onToggle={() => setTracksOpen((v) => !v)}
                                        icon={<Captions className="w-4 h-4" />}
                                        title="Subtitles"
                                        meta={tracksMeta}
                                        accent="bg-blue-500/20"
                                    />
                                )}
                                {/* Subtitle picker body. It lives with its header so
                                    expanding the card grows the list downward from
                                    here, instead of dropping it to the bottom of
                                    the download options. */}
                                {hasTracksPanel && tracksOpen && (
                                    <div>
                                        <div data-subtitle-panel className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
                                            <div className="p-2.5">
                                                <div className="relative">
                                                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
                                                    <input
                                                        type="text"
                                                        value={subtitleSearch}
                                                        onChange={(e) => setSubtitleSearch(e.target.value)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter' && subtitleVisibleTracks.length) {
                                                                pickSubtitle(subtitleVisibleTracks[0].key);
                                                            } else if (e.key === 'Escape') {
                                                                setSubtitleSearch('');
                                                            }
                                                        }}
                                                        placeholder={`Search ${subtitleTracks.length} languages...`}
                                                        disabled={downloading}
                                                        className="w-full h-9 pl-9 pr-9 rounded-lg bg-white/5 border border-white/10 text-white text-[13px] placeholder-white/25 outline-none transition focus:border-blue-400/40 focus:bg-white/[0.07] disabled:opacity-50"
                                                    />
                                                    {subtitleSearch && (
                                                        <button
                                                            onClick={() => setSubtitleSearch('')}
                                                            aria-label="Clear language search"
                                                            className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-md flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition"
                                                        >
                                                            <X className="w-3 h-3" />
                                                        </button>
                                                    )}
                                                </div>
                                                <div className="mt-2 flex items-center justify-between gap-2 px-1 text-[10px] text-white/35">
                                                    <span className="truncate">
                                                        {subtitleSearch.trim()
                                                            ? `${subtitleVisibleTracks.length} of ${subtitleTracks.length} languages`
                                                            : `${subtitleTracks.filter((t) => !t.isAuto).length} by creator · ${subtitleTracks.filter((t) => t.isAuto).length} auto-generated`}
                                                    </span>
                                                    {subtitleSearch.trim() && subtitleVisibleTracks.length === 0 && (
                                                        <span className="shrink-0 text-white/50">No match</span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Deliberately not .smooth-scroll: that class
                                                sets content-visibility: auto, which
                                                lets Chromium skip the offscreen rows
                                                while the group headers inside are
                                                position: sticky. The list is long
                                                enough that keeping it rendered is
                                                cheaper than debugging sticky
                                                headers that land in the wrong place. */}
                                            <div
                                                data-subtitle-list
                                                className="overflow-y-auto custom-scrollbar border-y border-white/10 bg-[#0d0d0f]"
                                                // With no visible rows there is nothing to cap,
                                                // and a derived height of 0 would clip the
                                                // empty-state message, so let the message size
                                                // the box instead.
                                                style={{ height: subtitleVisibleTracks.length > 0 ? subtitleListHeight : undefined }}
                                            >
                                                {subtitleVisibleTracks.length === 0 ? (
                                                    <p className="px-4 py-10 text-center text-xs text-white/40">
                                                        {subtitleSearch.trim()
                                                            ? <>No language matches &ldquo;{subtitleSearch.trim()}&rdquo;.</>
                                                            : <>No track offers a {subtitleFormat.toUpperCase()} file.</>}
                                                    </p>
                                                ) : (
                                                    <>
                                                        {subtitleAuthored.length > 0 && (
                                                            <div>
                                                                <div className="sticky top-0 z-10 flex items-center gap-2 h-7 px-3 bg-[#0d0d0f]/95 backdrop-blur-sm border-b border-white/[0.06]">
                                                                    <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-300/70">By creator</span>
                                                                    <span className="text-[10px] text-white/25">{subtitleAuthored.length}</span>
                                                                </div>
                                                                <div className="divide-y divide-white/[0.04]">
                                                                    {subtitleAuthored.map((t) => (
                                                                        <SubtitleChoice
                                                                            key={t.key}
                                                                            track={t}
                                                                            active={subtitleKey === t.key}
                                                                            disabled={downloading}
                                                                            onPick={() => pickSubtitle(subtitleKey === t.key ? null : t.key)}
                                                                        />
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                        {subtitleAutomatic.length > 0 && (
                                                            <div>
                                                                <div className="sticky top-0 z-10 flex items-center gap-2 h-7 px-3 bg-[#0d0d0f]/95 backdrop-blur-sm border-b border-white/[0.06]">
                                                                    <span className="text-[10px] font-semibold uppercase tracking-wider text-white/45">Auto-generated &amp; translated</span>
                                                                    <span className="text-[10px] text-white/25">{subtitleAutomatic.length}</span>
                                                                </div>
                                                                <div className="divide-y divide-white/[0.04]">
                                                                    {subtitleAutomatic.map((t) => (
                                                                        <SubtitleChoice
                                                                            key={t.key}
                                                                            track={t}
                                                                            active={subtitleKey === t.key}
                                                                            disabled={downloading}
                                                                            onPick={() => pickSubtitle(subtitleKey === t.key ? null : t.key)}
                                                                        />
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </>
                                                )}
                                            </div>

                                            {/* Pinned action bar. It is always present at a
                                                fixed height, so choosing a
                                                language never reflows the
                                                page under the pointer. */}
                                            <div className="p-2.5">
                                                <div className="flex items-center gap-2">
                                                    <div className={`flex h-10 p-0.5 rounded-lg bg-white/5 border border-white/10 transition-opacity ${subtitleSelection ? '' : 'opacity-40'}`}>
                                                        {(['srt', 'vtt'] as const).map((fmt) => (
                                                            <button
                                                                key={fmt}
                                                                onClick={() => pickSubtitleFormat(fmt)}
                                                                disabled={!subtitleSelection || subtitleDownloading}
                                                                title={fmt === 'srt' ? 'Converted to SRT with FFmpeg' : 'Saved exactly as published'}
                                                                className={`h-full px-3 rounded-md text-xs font-medium transition disabled:cursor-not-allowed ${
                                                                    subtitleFormat === fmt
                                                                        ? 'bg-white/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                                                                        : 'text-white/45 hover:text-white/80'
                                                                }`}
                                                            >
                                                                {fmt.toUpperCase()}
                                                            </button>
                                                        ))}
                                                    </div>
                                                    <button
                                                        onClick={handleSubtitleDownload}
                                                        disabled={!subtitleSelection || subtitleDownloading}
                                                        className="flex-1 h-10 rounded-xl bg-blue-500/20 border border-blue-500/30 text-blue-400 font-medium text-[13px] flex items-center justify-center gap-2 transition hover:bg-blue-500/30 active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
                                                    >
                                                        {subtitleDownloading ? (
                                                            <>
                                                                <span className="w-3.5 h-3.5 rounded-full border-2 border-blue-400/30 border-t-blue-400 animate-spin shrink-0" />
                                                                Downloading
                                                            </>
                                                        ) : subtitleSelection ? (
                                                            <>
                                                                <Download className="w-4 h-4 shrink-0" />
                                                                <span className="truncate">Download {subtitleSelection.langLabel || subtitleSelection.lang}</span>
                                                            </>
                                                        ) : (
                                                            'Select a language'
                                                        )}
                                                    </button>
                                                </div>
                                                <p className="mt-2 px-1 text-[10px] leading-relaxed text-white/30 text-center">
                                                    {subtitleSelection
                                                        ? `${subtitleSelection.lang} saved to ${currentPlatform.name} › Subtitles${subtitleFormat === 'srt' ? ' · converted with FFmpeg' : ' · no conversion'}`
                                                        : `Saved on its own to ${currentPlatform.name} › Subtitles`}
                                                </p>
                                            </div>
                                        </div>

                                        {subtitleNotice && (
                                            <p className="mt-2 flex items-start gap-2 text-[11px] leading-relaxed text-amber-300/90 bg-amber-500/10 border border-amber-500/25 rounded-xl px-3 py-2">
                                                <span className="w-1 h-1 rounded-full bg-amber-400/70 mt-[6px] shrink-0" />
                                                {subtitleNotice}
                                            </p>
                                        )}

                                        {subtitleResult && (
                                            <p className="mt-2 flex items-center gap-2 text-[11px] text-emerald-300/90 bg-emerald-500/10 border border-emerald-500/25 rounded-xl px-3 py-2">
                                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                                <span className="truncate" title={subtitleResult}>{subtitleResult}</span>
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Download Options */}
                            <div className="border-t border-white/10 pt-5">
                                <div className="flex items-center justify-between mb-3.5">
                                    <p className="text-white/40 text-xs font-bold uppercase tracking-wider">Download Options</p>
                                    <span className="text-[10px] text-white/30 font-medium">
                                        {isSingleStory ? 'One video, nothing to choose' : 'Select format & quality'}
                                    </span>
                                </div>
                                <div className="grid gap-3">
                                    {/* Facebook story: the media is already resolved, so there is
                                        no format list to pick from and no reason to offer audio
                                        renditions of a clip the user came here to watch whole. */}
                                    {isSingleStory && (
                                        <>
                                            <button
                                                onClick={() => handleDownload('best')}
                                                disabled={downloading}
                                                className="group relative w-full flex items-center justify-between p-4 rounded-2xl border transition-all duration-200 cursor-pointer shadow-sm hover:shadow-lg active:translate-y-0 disabled:opacity-40 disabled:cursor-not-allowed text-left"
                                                style={{
                                                    background: `linear-gradient(to right, ${currentPlatform.color}22, transparent)`,
                                                    borderColor: `${currentPlatform.color}55`
                                                }}
                                            >
                                                <div className="flex items-center gap-3.5">
                                                    <div
                                                        className="w-11 h-11 rounded-xl border flex items-center justify-center shadow-md group-hover:scale-105 transition-transform shrink-0"
                                                        style={{ background: `${currentPlatform.color}33`, borderColor: `${currentPlatform.color}66` }}
                                                    >
                                                        <Film className="w-5 h-5" style={{ color: currentPlatform.color }} />
                                                    </div>
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <p className="font-semibold text-sm text-white">Download Story</p>
                                                            <span
                                                                className="text-[9px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wider border"
                                                                style={{ background: `${currentPlatform.color}26`, color: currentPlatform.color, borderColor: `${currentPlatform.color}59` }}
                                                            >
                                                                MP4
                                                            </span>
                                                        </div>
                                                        <p className="text-xs text-white/40 mt-0.5">
                                                            Saved as-is to your {currentPlatform.name} folder
                                                        </p>
                                                    </div>
                                                </div>
                                                <div
                                                    className="w-9 h-9 rounded-xl border border-white/10 bg-white/5 flex items-center justify-center text-white/40 group-hover:text-white transition-all group-hover:scale-110 shrink-0"
                                                    style={{ background: `${currentPlatform.color}00` }}
                                                >
                                                    <Download className="w-4 h-4" />
                                                </div>
                                            </button>
                                            <p className="flex items-start gap-2 text-[11px] leading-relaxed text-white/40 bg-white/[0.03] border border-white/10 rounded-xl px-3 py-2">
                                                <Timer className="w-3.5 h-3.5 mt-[1px] shrink-0" />
                                                Stories are deleted by Facebook 24 hours after they are posted, so
                                                the link stops working after that. A link can only ever resolve
                                                the one story it points at.
                                            </p>
                                        </>
                                    )}

                                    {/* Spotify Audio */}
                                    {isSpotify && metadata.searchQuery && (
                                        <div className="mb-2">
                                            <h3 className="text-xs font-bold uppercase tracking-wider text-white/50 mb-2 pl-1 flex items-center gap-2">
                                                <Music className="w-3.5 h-3.5 text-[#1DB954]" /> Spotify Audio
                                            </h3>
                                            <div className="space-y-2">
                                                {/* Spotify WAV */}
                                                <button
                                                    onClick={() => handleSpotifyDownload(metadata.searchQuery!, metadata.title, metadata.uploader, undefined, undefined, undefined, 'audio_wav')}
                                                    disabled={downloading}
                                                    className="group relative w-full flex items-center justify-between p-3.5 rounded-2xl bg-gradient-to-r from-sky-500/[0.07] via-white/[0.02] to-transparent border border-sky-500/20 hover:border-sky-500/40 hover:bg-sky-500/[0.12] transition-all duration-200 cursor-pointer shadow-sm hover:shadow-lg hover:shadow-sky-500/10 hover:-translate-y-0.5 active:translate-y-0 text-left disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                                                >
                                                    <div className="flex items-center gap-3.5">
                                                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500/25 to-indigo-500/10 border border-sky-500/30 flex items-center justify-center shadow-md shadow-sky-500/10 group-hover:scale-105 transition-transform shrink-0">
                                                            <Music className="w-5 h-5 text-sky-400" />
                                                        </div>
                                                        <div>
                                                            <div className="flex items-center gap-2">
                                                                <p className="font-semibold text-sm text-white group-hover:text-sky-300 transition-colors">Spotify Audio (WAV)</p>
                                                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-sky-500/20 text-sky-300 border border-sky-500/30 uppercase tracking-wider">Uncompressed</span>
                                                            </div>
                                                            {/* No cover art: a WAV container has nowhere to put it, which is
                                                                why the MP3 cards are the ones that carry artwork. */}
                                                            <p className="text-xs text-white/40 mt-0.5">Uncompressed PCM • Full artist, album & year tags • No cover art</p>
                                                        </div>
                                                    </div>
                                                    <div className="w-8 h-8 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/40 group-hover:text-black group-hover:bg-sky-400 group-hover:border-sky-300 transition-all shrink-0">
                                                        <Download className="w-4 h-4 transition-transform group-hover:scale-110" />
                                                    </div>
                                                </button>

                                                {/* Spotify Best */}
                                                <button
                                                    onClick={() => handleSpotifyDownload(metadata.searchQuery!, metadata.title, metadata.uploader, undefined, undefined, undefined, 'audio_best')}
                                                    disabled={downloading}
                                                    className="group relative w-full flex items-center justify-between p-3.5 rounded-2xl bg-gradient-to-r from-[#1DB954]/[0.08] via-white/[0.02] to-transparent border border-[#1DB954]/20 hover:border-[#1DB954]/40 hover:bg-[#1DB954]/[0.12] transition-all duration-200 cursor-pointer shadow-sm hover:shadow-lg hover:shadow-[#1DB954]/10 hover:-translate-y-0.5 active:translate-y-0 text-left disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                                                >
                                                    <div className="flex items-center gap-3.5">
                                                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#1DB954]/25 to-emerald-500/10 border border-[#1DB954]/30 flex items-center justify-center shadow-md shadow-[#1DB954]/10 group-hover:scale-105 transition-transform shrink-0">
                                                            <Music className="w-5 h-5 text-[#1DB954]" />
                                                        </div>
                                                        <div>
                                                            <div className="flex items-center gap-2">
                                                                <p className="font-semibold text-sm text-white group-hover:text-[#1DB954] transition-colors">Spotify Audio (Best)</p>
                                                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-[#1DB954]/20 text-[#1DB954] border border-[#1DB954]/30 uppercase tracking-wider">320kbps MP3</span>
                                                            </div>
                                                            <p className="text-xs text-white/40 mt-0.5">~320kbps • High Bitrate MP3 from the matched stream</p>
                                                        </div>
                                                    </div>
                                                    <div className="w-8 h-8 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/40 group-hover:text-black group-hover:bg-[#1DB954] group-hover:border-[#1DB954] transition-all shrink-0">
                                                        <Download className="w-4 h-4 transition-transform group-hover:scale-110" />
                                                    </div>
                                                </button>

                                                {/* Spotify Standard */}
                                                <button
                                                    onClick={() => handleSpotifyDownload(metadata.searchQuery!, metadata.title, metadata.uploader, undefined, undefined, undefined, 'audio_standard')}
                                                    disabled={downloading}
                                                    className="group relative w-full flex items-center justify-between p-3.5 rounded-2xl bg-gradient-to-r from-teal-500/[0.05] via-white/[0.02] to-transparent border border-white/10 hover:border-teal-500/30 hover:bg-teal-500/[0.08] transition-all duration-200 cursor-pointer shadow-sm hover:shadow-lg hover:shadow-teal-500/10 hover:-translate-y-0.5 active:translate-y-0 text-left disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                                                >
                                                    <div className="flex items-center gap-3.5">
                                                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500/20 to-cyan-500/10 border border-teal-500/25 flex items-center justify-center shadow-md shadow-teal-500/10 group-hover:scale-105 transition-transform shrink-0">
                                                            <Music className="w-5 h-5 text-teal-400" />
                                                        </div>
                                                        <div>
                                                            <div className="flex items-center gap-2">
                                                                <p className="font-semibold text-sm text-white group-hover:text-teal-300 transition-colors">Spotify Audio (Standard)</p>
                                                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-teal-500/15 text-teal-300 border border-teal-500/25 uppercase tracking-wider">128kbps</span>
                                                            </div>
                                                            <p className="text-xs text-white/40 mt-0.5">~128kbps • Balanced Size &amp; Quality</p>
                                                        </div>
                                                    </div>
                                                    <div className="w-8 h-8 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/40 group-hover:text-black group-hover:bg-teal-400 group-hover:border-teal-400 transition-all shrink-0">
                                                        <Download className="w-4 h-4 transition-transform group-hover:scale-110" />
                                                    </div>
                                                </button>

                                                {/* Spotify Low */}
                                                <button
                                                    onClick={() => handleSpotifyDownload(metadata.searchQuery!, metadata.title, metadata.uploader, undefined, undefined, undefined, 'audio_low')}
                                                    disabled={downloading}
                                                    className="group relative w-full flex items-center justify-between p-3.5 rounded-2xl bg-gradient-to-r from-amber-500/[0.04] via-white/[0.02] to-transparent border border-white/10 hover:border-amber-500/30 hover:bg-amber-500/[0.08] transition-all duration-200 cursor-pointer shadow-sm hover:shadow-lg hover:shadow-amber-500/10 hover:-translate-y-0.5 active:translate-y-0 text-left disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                                                >
                                                    <div className="flex items-center gap-3.5">
                                                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-yellow-500/10 border border-amber-500/25 flex items-center justify-center shadow-md shadow-amber-500/10 group-hover:scale-105 transition-transform shrink-0">
                                                            <Music className="w-5 h-5 text-amber-400" />
                                                        </div>
                                                        <div>
                                                            <div className="flex items-center gap-2">
                                                                <p className="font-semibold text-sm text-white group-hover:text-amber-300 transition-colors">Spotify Audio (Low)</p>
                                                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/25 uppercase tracking-wider">64kbps</span>
                                                            </div>
                                                            <p className="text-xs text-white/40 mt-0.5">~64kbps • Save Data &amp; Storage</p>
                                                        </div>
                                                    </div>
                                                    <div className="w-8 h-8 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/40 group-hover:text-black group-hover:bg-amber-400 group-hover:border-amber-400 transition-all shrink-0">
                                                        <Download className="w-4 h-4 transition-transform group-hover:scale-110" />
                                                    </div>
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* Live recording */}
                                    {!isSpotify && isLive && (
                                        <button
                                            onClick={() => handleDownload('best')}
                                            disabled={downloading}
                                            className="group relative w-full flex items-center justify-between p-4 bg-gradient-to-r from-red-500/15 via-white/[0.03] to-transparent border border-red-500/30 hover:border-red-500/60 hover:bg-red-500/20 rounded-2xl cursor-pointer transition-all duration-200 shadow-sm hover:shadow-xl hover:shadow-red-500/10 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 text-left"
                                        >
                                            <div className="flex items-center gap-3.5">
                                                <div className="w-11 h-11 rounded-xl bg-red-500/25 border border-red-500/40 flex items-center justify-center shadow-lg shadow-red-500/15 group-hover:scale-105 transition-transform shrink-0">
                                                    <Radio className="w-5 h-5 text-red-400 animate-pulse" />
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <p className="font-semibold text-sm text-white group-hover:text-red-300 transition-colors">Record Live Stream</p>
                                                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-red-500/20 text-red-300 border border-red-500/30 uppercase tracking-wider">Broadcast</span>
                                                    </div>
                                                    <p className="text-xs text-white/40 mt-0.5">Captures the ongoing broadcast until you stop it</p>
                                                </div>
                                            </div>
                                            <div className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/40 group-hover:text-white group-hover:bg-red-500 group-hover:border-red-400 transition-all shrink-0">
                                                <Download className="w-4 h-4 transition-transform group-hover:scale-110" />
                                            </div>
                                        </button>
                                    )}

                                    {/* Audio Options */}
                                    {hasAudioChoice && !isSpotify && !isLive && (
                                        <>
                                            <SectionToggle
                                                open={audioLangOpen}
                                                onToggle={() => setAudioLangOpen((v) => !v)}
                                                icon={<Globe className="w-3 h-3" />}
                                                title="Audio Language"
                                                meta={audioLangMeta}
                                                accent="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                                                tone="emerald"
                                                variant="compact"
                                            />
                                            {audioLangOpen && (
                                                <div data-audio-language-panel className="mb-2 rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
                                                    <div data-audio-language-list className="max-h-[220px] overflow-y-auto">
                                                        {audioTracks.map((track) => (
                                                            <AudioTrackChoice
                                                                key={track.key}
                                                                track={track}
                                                                active={audioTrackKey === track.key}
                                                                disabled={downloading}
                                                                onPick={() => setAudioTrackKey(track.key)}
                                                            />
                                                        ))}
                                                    </div>
                                                    <div className="px-3.5 py-2 border-t border-white/10 bg-white/[0.02]">
                                                        <p className="text-[10px] leading-snug text-white/40">
                                                            Used for audio-only downloads and for the audio merged into video downloads.
                                                        </p>
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    )}

                                    {/* Audio Only Section */}
                                    {!isSpotify && !isLive && !isSingleStory && (
                                        <div className="mb-2">
                                            <h3 className="text-xs font-bold uppercase tracking-wider text-white/50 mb-2 pl-1 flex items-center gap-2">
                                                <Music className="w-3.5 h-3.5 text-emerald-400" /> Audio Only
                                            </h3>
                                            <div className="space-y-2">
                                                {/* Audio WAV */}
                                                <button
                                                    onClick={() => handleDownload('audio_wav')}
                                                    disabled={downloading}
                                                    className="group relative w-full flex items-center justify-between p-3.5 rounded-2xl bg-gradient-to-r from-sky-500/[0.07] via-white/[0.02] to-transparent border border-sky-500/20 hover:border-sky-500/40 hover:bg-sky-500/[0.12] transition-all duration-200 cursor-pointer shadow-sm hover:shadow-lg hover:shadow-sky-500/10 hover:-translate-y-0.5 active:translate-y-0 text-left disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                                                >
                                                    <div className="flex items-center gap-3.5">
                                                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500/25 to-indigo-500/10 border border-sky-500/30 flex items-center justify-center shadow-md shadow-sky-500/10 group-hover:scale-105 transition-transform shrink-0">
                                                            <Music className="w-5 h-5 text-sky-400" />
                                                        </div>
                                                        <div>
                                                            <div className="flex items-center gap-2">
                                                                <p className="font-semibold text-sm text-white group-hover:text-sky-300 transition-colors">Audio (WAV)</p>
                                                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-sky-500/20 text-sky-300 border border-sky-500/30 uppercase tracking-wider">Uncompressed</span>
                                                            </div>
                                                            <p className="text-xs text-white/40 mt-0.5">Uncompressed PCM • Full artist, album & year tags • No cover art</p>
                                                        </div>
                                                    </div>
                                                    <div className="w-8 h-8 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/40 group-hover:text-black group-hover:bg-sky-400 group-hover:border-sky-300 transition-all shrink-0">
                                                        <Download className="w-4 h-4 transition-transform group-hover:scale-110" />
                                                    </div>
                                                </button>

                                                {/* Audio Best */}
                                                <button
                                                    onClick={() => handleDownload('audio_best')}
                                                    disabled={downloading}
                                                    className="group relative w-full flex items-center justify-between p-3.5 rounded-2xl bg-gradient-to-r from-emerald-500/[0.08] via-white/[0.02] to-transparent border border-emerald-500/20 hover:border-emerald-500/40 hover:bg-emerald-500/[0.12] transition-all duration-200 cursor-pointer shadow-sm hover:shadow-lg hover:shadow-emerald-500/10 hover:-translate-y-0.5 active:translate-y-0 text-left disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                                                >
                                                    <div className="flex items-center gap-3.5">
                                                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/25 to-teal-500/10 border border-emerald-500/30 flex items-center justify-center shadow-md shadow-emerald-500/10 group-hover:scale-105 transition-transform shrink-0">
                                                            <Music className="w-5 h-5 text-emerald-400" />
                                                        </div>
                                                        <div>
                                                            <div className="flex items-center gap-2">
                                                                <p className="font-semibold text-sm text-white group-hover:text-emerald-300 transition-colors">Audio (Best Quality)</p>
                                                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 uppercase tracking-wider">320kbps MP3</span>
                                                            </div>
                                                            <p className="text-xs text-white/40 mt-0.5">~320kbps • Studio Grade High Bitrate MP3</p>
                                                        </div>
                                                    </div>
                                                    <div className="w-8 h-8 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/40 group-hover:text-black group-hover:bg-emerald-400 group-hover:border-emerald-300 transition-all shrink-0">
                                                        <Download className="w-4 h-4 transition-transform group-hover:scale-110" />
                                                    </div>
                                                </button>

                                                {/* Audio Standard */}
                                                <button
                                                    onClick={() => handleDownload('audio_standard')}
                                                    disabled={downloading}
                                                    className="group relative w-full flex items-center justify-between p-3.5 rounded-2xl bg-gradient-to-r from-teal-500/[0.05] via-white/[0.02] to-transparent border border-white/10 hover:border-teal-500/30 hover:bg-teal-500/[0.08] transition-all duration-200 cursor-pointer shadow-sm hover:shadow-lg hover:shadow-teal-500/10 hover:-translate-y-0.5 active:translate-y-0 text-left disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                                                >
                                                    <div className="flex items-center gap-3.5">
                                                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500/20 to-cyan-500/10 border border-teal-500/25 flex items-center justify-center shadow-md shadow-teal-500/10 group-hover:scale-105 transition-transform shrink-0">
                                                            <Music className="w-5 h-5 text-teal-400" />
                                                        </div>
                                                        <div>
                                                            <div className="flex items-center gap-2">
                                                                <p className="font-semibold text-sm text-white group-hover:text-teal-300 transition-colors">Audio (Standard)</p>
                                                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-teal-500/15 text-teal-300 border border-teal-500/25 uppercase tracking-wider">128kbps</span>
                                                            </div>
                                                            <p className="text-xs text-white/40 mt-0.5">~128kbps • Balanced Size &amp; Quality</p>
                                                        </div>
                                                    </div>
                                                    <div className="w-8 h-8 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/40 group-hover:text-black group-hover:bg-teal-400 group-hover:border-teal-300 transition-all shrink-0">
                                                        <Download className="w-4 h-4 transition-transform group-hover:scale-110" />
                                                    </div>
                                                </button>

                                                {/* Audio Low */}
                                                <button
                                                    onClick={() => handleDownload('audio_low')}
                                                    disabled={downloading}
                                                    className="group relative w-full flex items-center justify-between p-3.5 rounded-2xl bg-gradient-to-r from-amber-500/[0.04] via-white/[0.02] to-transparent border border-white/10 hover:border-amber-500/30 hover:bg-amber-500/[0.08] transition-all duration-200 cursor-pointer shadow-sm hover:shadow-lg hover:shadow-amber-500/10 hover:-translate-y-0.5 active:translate-y-0 text-left disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                                                >
                                                    <div className="flex items-center gap-3.5">
                                                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-yellow-500/10 border border-amber-500/25 flex items-center justify-center shadow-md shadow-amber-500/10 group-hover:scale-105 transition-transform shrink-0">
                                                            <Music className="w-5 h-5 text-amber-400" />
                                                        </div>
                                                        <div>
                                                            <div className="flex items-center gap-2">
                                                                <p className="font-semibold text-sm text-white group-hover:text-amber-300 transition-colors">Audio (Low)</p>
                                                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/25 uppercase tracking-wider">64kbps</span>
                                                            </div>
                                                            <p className="text-xs text-white/40 mt-0.5">~64kbps • Save Data &amp; Storage</p>
                                                        </div>
                                                    </div>
                                                    <div className="w-8 h-8 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/40 group-hover:text-black group-hover:bg-amber-400 group-hover:border-amber-300 transition-all shrink-0">
                                                        <Download className="w-4 h-4 transition-transform group-hover:scale-110" />
                                                    </div>
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* Video Quality Section */}
                                    {!isSpotify && !isLive && formats.length > 0 && (
                                        <div className="mb-2">
                                            <h3 className="text-xs font-bold uppercase tracking-wider text-white/50 mb-2 pl-1 flex items-center justify-between">
                                                <span className="flex items-center gap-2">
                                                    <Film className="w-3.5 h-3.5 text-blue-400" /> Video Quality
                                                </span>
                                                <span className="text-[10px] text-white/30 uppercase tracking-wider">{formats.length} options</span>
                                            </h3>
                                            <div className="space-y-2">
                                                {formats.map((f, i) => {
                                                    const is4K = f.height && f.height >= 2160;
                                                    const is2K = f.height && f.height >= 1440 && f.height < 2160;
                                                    const is1080 = f.height && f.height >= 1080 && f.height < 1440;
                                                    const is720 = f.height && f.height >= 720 && f.height < 1080;

                                                    const colorClass = is4K
                                                        ? 'border-purple-500/30 hover:border-purple-400/60 bg-gradient-to-r from-purple-500/[0.10] via-purple-500/[0.04] to-transparent hover:bg-purple-500/[0.16] shadow-purple-500/5'
                                                        : is2K
                                                        ? 'border-indigo-500/25 hover:border-indigo-400/50 bg-gradient-to-r from-indigo-500/[0.08] via-indigo-500/[0.03] to-transparent hover:bg-indigo-500/[0.14] shadow-indigo-500/5'
                                                        : is1080
                                                        ? 'border-blue-500/20 hover:border-blue-400/50 bg-gradient-to-r from-blue-500/[0.07] via-blue-500/[0.02] to-transparent hover:bg-blue-500/[0.12] shadow-blue-500/5'
                                                        : 'border-white/10 hover:border-white/25 bg-gradient-to-r from-white/[0.03] to-transparent hover:bg-white/[0.07]';

                                                    const iconColor = is4K ? 'text-purple-400' : is2K ? 'text-indigo-400' : is1080 ? 'text-blue-400' : 'text-cyan-400';
                                                    const hoverBtnColor = is4K
                                                        ? 'group-hover:bg-purple-400 group-hover:text-black group-hover:border-purple-300'
                                                        : is2K
                                                        ? 'group-hover:bg-indigo-400 group-hover:text-black group-hover:border-indigo-300'
                                                        : 'group-hover:bg-blue-400 group-hover:text-black group-hover:border-blue-300';

                                                    return (
                                                        <button
                                                            key={i}
                                                            onClick={() => handleDownload(f.format_id)}
                                                            disabled={downloading}
                                                            className={`group relative w-full flex items-center justify-between p-3.5 rounded-2xl border transition-all duration-200 cursor-pointer shadow-sm hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 text-left disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 ${colorClass}`}
                                                        >
                                                            <div className="flex items-center gap-3.5">
                                                                <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shadow-md group-hover:scale-105 transition-transform shrink-0">
                                                                    <Film className={`w-5 h-5 ${iconColor}`} />
                                                                </div>
                                                                <div>
                                                                    <div className="flex items-center gap-2">
                                                                        <p className="font-semibold text-sm text-white group-hover:text-white transition-colors">
                                                                            {f.height ? `${f.height}p` : 'Standard'}
                                                                        </p>
                                                                        {i === 0 && (
                                                                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-white/15 text-white/90 border border-white/20 uppercase tracking-wider">
                                                                                Best Quality
                                                                            </span>
                                                                        )}
                                                                        {is4K && (
                                                                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-purple-500/25 text-purple-300 border border-purple-500/40 uppercase tracking-wider">
                                                                                4K Ultra HD
                                                                            </span>
                                                                        )}
                                                                        {is2K && (
                                                                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-indigo-500/25 text-indigo-300 border border-indigo-500/40 uppercase tracking-wider">
                                                                                2K QHD
                                                                            </span>
                                                                        )}
                                                                        {is1080 && (
                                                                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-blue-500/20 text-blue-300 border border-blue-500/30 uppercase tracking-wider">
                                                                                1080p FHD
                                                                            </span>
                                                                        )}
                                                                        {is720 && (
                                                                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 uppercase tracking-wider">
                                                                                720p HD
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <p className="text-xs text-white/40 mt-0.5">
                                                                        {f.ext?.toUpperCase() || 'MP4'} {f.format_note && `• ${f.format_note}`}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                            <div className={`w-8 h-8 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/40 transition-all shrink-0 ${hoverBtnColor}`}>
                                                                <Download className="w-4 h-4 transition-transform group-hover:scale-110" />
                                                            </div>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                            </motion.div>
                        </motion.div>
                    )}

                    {/* Playlist/Album Result */}
                    {metadata && !loading && !complete && isPlaylist && (
                        <motion.div key="playlist" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
                            {/* Playlist Header */}
                            <div className="flex items-start gap-4 mb-4 p-4 bg-white/5 rounded-2xl border border-white/10">
                                <div className="w-16 h-16 rounded-xl overflow-hidden shrink-0">
                                    {metadata.thumbnail ? (
                                        <img src={metadata.thumbnail} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center" style={{ backgroundColor: `${currentPlatform.color}20` }}>
                                            <List className="w-7 h-7" style={{ color: currentPlatform.color }} />
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h2 className="font-bold text-base leading-tight mb-1 truncate" title={metadata.title}>{metadata.title}</h2>
                                    <p className="text-white/50 text-sm mb-1 truncate">{metadata.uploader}</p>
                                    <div className="flex items-center gap-3 text-xs text-white/40">
                                        <span className="flex items-center gap-1"><Play className="w-3 h-3" /> {metadata.playlist_count || 0} {isSpotify ? 'tracks' : 'videos'}</span>
                                        <span>{selectedItems.size} selected</span>
                                    </div>
                                </div>
                                <button
                                    onClick={() => {
                                        selectAll();
                                        handleBulkDownload(isSpotify ? 'audio_best' : 'video');
                                    }}
                                    disabled={downloading}
                                    className="px-4 py-2 bg-white text-black rounded-lg font-bold text-xs hover:bg-white/90 transition cursor-pointer flex items-center gap-2"
                                >
                                    <Download className="w-3.5 h-3.5" />
                                    Download All
                                </button>
                            </div>

                            {/* Download Actions (TOP) */}
                            <div className="mb-4">
                                <DownloadActions />
                            </div>

                            {/* Search & Select Controls */}
                            <div className="flex gap-2 mb-4">
                                <div className="flex-1 relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                                    <input
                                        type="text"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder={isSpotify ? "Search tracks..." : "Search in playlist..."}
                                        className="w-full h-10 pl-9 pr-4 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-white/30 outline-none focus:border-white/20"
                                    />
                                    {searchQuery && (
                                        <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer">
                                            <X className="w-4 h-4 text-white/40 hover:text-white" />
                                        </button>
                                    )}
                                </div>
                                <button onClick={selectAll} className="h-10 px-3 bg-white/5 border border-white/10 rounded-xl text-xs text-white/60 hover:bg-white/10 cursor-pointer flex items-center gap-1.5">
                                    <CheckSquare className="w-3.5 h-3.5" /> All
                                </button>
                                <button onClick={deselectAll} className="h-10 px-3 bg-white/5 border border-white/10 rounded-xl text-xs text-white/60 hover:bg-white/10 cursor-pointer flex items-center gap-1.5">
                                    <Square className="w-3.5 h-3.5" /> None
                                </button>
                            </div>

                            {/* Playlist Items */}
                            <div className="space-y-1.5 max-h-[400px] smooth-scroll pr-1 hardware-accelerated">
                                {filteredEntries.map((entry, index) => (
                                    <PlaylistItem
                                        key={entry.id || index}
                                        entry={entry}
                                        index={index}
                                        isSelected={selectedItems.has(entry.id)}
                                        isDownloadingItem={downloadingId === entry.id}
                                        downloading={downloading}
                                        progress={downloadingId === entry.id ? progress : null}
                                        isSpotify={isSpotify}
                                        metadataUploader={metadata?.uploader}
                                        metadataTitle={metadata?.title}
                                        onToggle={toggleItem}
                                        onSpotifyDownload={handleSpotifyDownload}
                                        onDownload={handleDownload}
                                        onImgError={handleImgError}
                                    />
                                ))}

                                {filteredEntries.length === 0 && searchQuery && (
                                    <div className="text-center py-8 text-white/30 text-sm">
                                        No {isSpotify ? 'tracks' : 'videos'} found for "{searchQuery}"
                                    </div>
                                )}
                            </div>

                            {/* Download Actions (BOTTOM) */}
                            <div className="mt-4 pt-4 border-t border-white/10">
                                <DownloadActions />
                            </div>
                        </motion.div>
                    )}

                    {/* Story Result (Instagram) */}
                    {metadata && !loading && !complete && isStory && !isSingleStory && (
                        <motion.div key="story" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
                            <div className="mb-4 p-5 bg-gradient-to-br from-[#E4405F]/10 via-[#F56040]/10 to-[#FCAF45]/10 rounded-3xl border border-[#E4405F]/20 backdrop-blur-sm">
                                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
                                    <div className="flex items-center gap-4">
                                        <div className="w-16 h-16 rounded-full p-[2px] bg-gradient-to-tr from-[#FCAF45] via-[#F56040] to-[#C13584] shadow-lg shrink-0">
                                            <div className="w-full h-full rounded-full border-2 border-[#0a0a0a] overflow-hidden bg-white/5 relative">
                                                {metadata.thumbnail ? (
                                                    <img src={metadata.thumbnail} className="w-full h-full object-cover" alt="" referrerPolicy="no-referrer" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center bg-black">
                                                        <User className="w-6 h-6 text-white/50" />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div>
                                            <h2 className="font-bold text-xl text-white tracking-tight">{metadata.uploader}'s Stories</h2>
                                            <p className="text-white/60 text-sm font-medium">{storyCount > 0 ? `${storyCount} ${storyCount === 1 ? 'story' : 'stories'} available • ${selectedItems.size} selected` : 'No active stories'}</p>
                                        </div>
                                    </div>
                                    {storyCount > 0 && (
                                        <button
                                            onClick={() => {
                                                selectAll();
                                                handleBulkDownload('video');
                                            }}
                                            disabled={downloading}
                                            className="w-full sm:w-auto px-6 py-3 bg-gradient-to-r from-[#E4405F] to-[#F58529] text-white rounded-xl font-bold text-sm hover:opacity-90 transition transform active:scale-95 cursor-pointer flex items-center justify-center gap-2 shadow-xl shadow-[#E4405F]/20 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <Download className="w-4 h-4" />
                                            Download All
                                        </button>
                                    )}
                                </div>

                                {storyCount > 0 && (
                                    <div className="flex gap-2 mb-4">
                                    <button onClick={selectAll} className="flex-1 h-10 bg-white/10 rounded-xl text-xs font-bold text-white hover:bg-white/20 transition cursor-pointer border border-white/5 flex items-center justify-center gap-2">
                                        <CheckSquare className="w-4 h-4" /> Select All
                                    </button>
                                    <button onClick={deselectAll} className="flex-1 h-10 bg-white/5 rounded-xl text-xs font-bold text-white/60 hover:bg-white/10 hover:text-white transition cursor-pointer border border-white/5 flex items-center justify-center gap-2">
                                            <Square className="w-4 h-4" /> Deselect All
                                        </button>
                                    </div>
                                )}

                                {/* Story Grid, or the reason there isn't one */}
                                {storyCount > 0 ? (
                                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 max-h-[500px] overflow-y-auto custom-scrollbar pr-1 pb-2 hardware-accelerated">
                                        {(metadata.entries ?? []).map((entry: any, index: number) => {
                                        const selected = selectedItems.has(entry.id);
                                        const isDl = downloadingId === entry.id;
                                        return (
                                            <div 
                                                key={entry.id || index}
                                                onClick={() => toggleItem(entry.id)}
                                                className={`relative aspect-[9/16] rounded-2xl overflow-hidden cursor-pointer transition-all duration-300 group
                                                    ${selected ? 'ring-2 ring-white scale-[0.98]' : 'hover:ring-2 hover:ring-white/50'}
                                                `}
                                            >
                                                {/* Background */}
                                                {entry.thumbnail ? (
                                                    <img src={entry.thumbnail} className="absolute inset-0 w-full h-full object-cover" alt="" onError={handleImgError} referrerPolicy="no-referrer" />
                                                ) : (
                                                    <div className="absolute inset-0 bg-white/10 flex items-center justify-center">
                                                        <Film className="w-8 h-8 text-white/20" />
                                                    </div>
                                                )}

                                                {/* Top gradient & Text */}
                                                <div className="absolute top-0 left-0 right-0 h-16 bg-gradient-to-b from-black/80 to-transparent p-2 z-10">
                                                    <div className="flex gap-[2px]">
                                                        {(metadata.entries ?? []).map((_: any, i: number) => (
                                                            <div key={i} className={`h-[3px] flex-1 rounded-full ${i <= index ? 'bg-white' : 'bg-white/30'}`} />
                                                        ))}
                                                    </div>
                                                    <p className="text-[10px] items-center flex gap-1 font-medium text-white/80 mt-1.5 pl-1 truncate">
                                                        <User className="w-3 h-3" /> {metadata.uploader}
                                                    </p>
                                                </div>

                                                {/* Checkbox */}
                                                <div className={`absolute bottom-2 right-2 w-6 h-6 rounded-full flex items-center justify-center transition-all duration-300 z-10
                                                    ${selected ? 'bg-white text-black' : 'bg-black/50 border border-white/50 text-transparent group-hover:bg-black/80 group-hover:text-white'}
                                                `}>
                                                    <Check className="w-3.5 h-3.5" />
                                                </div>

                                                {/* Download Quick Action */}
                                                {!selected && (
                                                    <button 
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleDownload('best', entry.url, `Story Part ${index+1}`, entry.id, metadata.title);
                                                        }}
                                                        disabled={downloading}
                                                        className="absolute bottom-2 left-2 w-8 h-8 rounded-full bg-white/20 text-white backdrop-blur flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:bg-white hover:text-black cursor-pointer z-20"
                                                    >
                                                        <Download className="w-4 h-4" />
                                                    </button>
                                                )}

                                                <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />

                                                {isDl && (
                                                    <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center text-center p-2 z-30 backdrop-blur-sm">
                                                        <Loader className="w-6 h-6 animate-spin mb-2 text-white" />
                                                        <span className="text-xs font-bold">{progress?.percent ? `${Math.round(progress.percent)}%` : 'Starting'}</span>
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
                                        <div className="w-14 h-14 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-4">
                                            <Timer className="w-6 h-6 text-white/30" />
                                        </div>
                                        <p className="text-white/70 text-sm font-medium">
                                            {metadata.noStoriesMessage || `@${metadata.uploader} has no stories right now.`}
                                        </p>
                                        <p className="text-white/40 text-xs mt-2 max-w-[300px] leading-relaxed">
                                            Stories only live for 24 hours, so an account goes quiet at any time. Check back later.
                                        </p>
                                    </div>
                                )}

                                {/* Bottom Download Action */}
                                {storyCount > 0 && (
                                    <div className="mt-4 pt-4 border-t border-white/10">
                                        <button
                                            onClick={() => handleBulkDownload('video')}
                                            disabled={selectedItems.size === 0 || downloading}
                                            className="w-full h-14 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl font-bold text-sm text-white transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
                                        >
                                            <Film className="w-5 h-5" /> Download Selected Stories ({selectedItems.size})
                                        </button>
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    )}

                    {/* Success */}
                    {complete && !loading && (
                        <motion.div
                            key="success"
                            ref={successRef}
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.3, ease: 'easeOut' }}
                            className="py-8"
                        >
                            {/* Animated check */}
                            <div className="flex flex-col items-center text-center mb-7">
                                <div className="relative w-20 h-20 mb-5">
                                    <motion.span
                                        aria-hidden="true"
                                        className="absolute inset-0 rounded-full"
                                        style={{ backgroundColor: currentPlatform.color }}
                                        initial={{ scale: 0.7, opacity: 0.45 }}
                                        animate={{ scale: 1.6, opacity: 0 }}
                                        transition={{ duration: 1.1, ease: 'easeOut' }}
                                    />
                                    <motion.div
                                        className={`relative w-full h-full rounded-full flex items-center justify-center ${['x', 'tiktok'].includes(currentPlatform.id) ? 'text-black' : 'text-white'}`}
                                        style={{ backgroundColor: currentPlatform.color, boxShadow: `0 16px 40px -12px ${currentPlatform.color}` }}
                                        initial={{ scale: 0.7 }}
                                        animate={{ scale: 1 }}
                                        transition={{ type: 'spring', stiffness: 380, damping: 18 }}
                                    >
                                        <svg viewBox="0 0 24 24" className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                            <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.15, duration: 0.4, ease: 'easeOut' }} />
                                        </svg>
                                    </motion.div>
                                </div>
                                <h2 className="text-2xl font-bold tracking-tight">Download complete</h2>
                                <p className="mt-1.5 text-sm text-white/45">Saved to your {isSpotify ? 'Music' : 'Downloads'} folder</p>
                            </div>

                            {/* What was saved */}
                            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 flex gap-4">
                                <div className="w-32 sm:w-44 shrink-0 aspect-video rounded-xl overflow-hidden bg-white/5">
                                    {metadata?.thumbnail ? (
                                        <img src={metadata.thumbnail} alt="" onError={handleImgError} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center">
                                            <Film className="w-8 h-8 text-white/20" />
                                        </div>
                                    )}
                                </div>
                                <div className="min-w-0 flex-1 flex flex-col justify-center">
                                    <p className="text-sm font-semibold leading-snug line-clamp-2" title={metadata?.title}>{metadata?.title}</p>
                                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-white/50">
                                        <span className="px-2 py-0.5 rounded-md bg-white/[0.06] border border-white/10 font-medium">{currentPlatform.name}</span>
                                        {!!metadata?.duration && metadata.duration > 0 && (
                                            <span className="px-2 py-0.5 rounded-md bg-white/[0.06] border border-white/10 font-medium tabular-nums">{formatDuration(metadata.duration)}</span>
                                        )}
                                        {metadata?.uploader && (
                                            <span className="flex items-center gap-1 min-w-0"><User className="w-3 h-3 shrink-0" /><span className="truncate">{metadata.uploader}</span></span>
                                        )}
                                    </div>
                                    {downloadedFilePath && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                window.electron.copyToClipboard(downloadedFilePath);
                                                setPathCopied(true);
                                                setTimeout(() => setPathCopied(false), 1800);
                                            }}
                                            title="Copy file path"
                                            className="mt-3 group flex items-center gap-2 h-8 max-w-full px-2.5 rounded-lg bg-black/30 border border-white/5 hover:border-white/15 transition-colors cursor-pointer text-left"
                                        >
                                            <span className="truncate text-[11px] text-white/45 font-mono">{downloadedFilePath}</span>
                                            {pathCopied
                                                ? <Check className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                                                : <Copy className="w-3.5 h-3.5 shrink-0 text-white/30 group-hover:text-white/70" />}
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                                {downloadedFilePath ? (
                                    <button
                                        type="button"
                                        onClick={handleOpenFile}
                                        className="h-12 rounded-xl bg-white text-black font-bold text-sm flex items-center justify-center gap-2 hover:bg-white/90 active:scale-[0.98] transition cursor-pointer"
                                    >
                                        <Play className="w-4 h-4" /> Open file
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={handleShowInFolder}
                                        className="h-12 rounded-xl bg-white text-black font-bold text-sm flex items-center justify-center gap-2 hover:bg-white/90 active:scale-[0.98] transition cursor-pointer"
                                    >
                                        <FolderOpen className="w-4 h-4" /> Show in folder
                                    </button>
                                )}
                                {downloadedFilePath && (
                                    <button
                                        type="button"
                                        onClick={handleShowInFolder}
                                        className="h-12 rounded-xl bg-white/[0.06] hover:bg-white/10 border border-white/10 text-white font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition cursor-pointer"
                                    >
                                        <FolderOpen className="w-4 h-4 text-white/60" /> Show in folder
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => {
                                        setComplete(false); setMetadata(null); setUrl('');
                                        setDownloadedFilePath(null);
                                        setFetchStart(null); setFetchElapsed(null);
                                    }}
                                    className={`h-12 rounded-xl bg-white/[0.06] hover:bg-white/10 border border-white/10 text-white font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition cursor-pointer ${downloadedFilePath ? '' : 'sm:col-span-2'}`}
                                >
                                    <Download className="w-4 h-4 text-white/60" /> New download
                                </button>
                            </div>

                            {/* Keep the fetched video: pick another quality without fetching it again */}
                            <button
                                type="button"
                                onClick={() => { setComplete(false); setDownloadedFilePath(null); }}
                                className="mt-3 w-full h-10 rounded-xl text-xs font-medium text-white/40 hover:text-white/80 transition-colors cursor-pointer"
                            >
                                ← Download another quality of this video
                            </button>
                        </motion.div>
                    )}

                    {/* Empty State */}
                    {!metadata && !loading && !complete && (
                        <EmptyState currentPlatform={currentPlatform} hasCookies={hasCookies} />
                    )}
                </AnimatePresence>

                {/* Cookie Modal */}
                <AnimatePresence>
                    {showCookieModal && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.2 }}
                                onClick={() => setShowCookieModal(false)}
                                className="absolute inset-0 bg-black/70 backdrop-blur-md"
                            />
                            <motion.div
                                initial={{ opacity: 0, y: 14, scale: 0.98 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                                transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                                className="relative w-full max-w-[480px] max-h-[86vh] flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#111] shadow-2xl"
                            >
                                {/* Header */}
                                <div className="relative flex items-center gap-3.5 px-6 pt-5 pb-4 border-b border-white/10">
                                    <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                                        <Key className="w-[18px] h-[18px] text-white/70" strokeWidth={1.75} />
                                    </div>
                                    <div className="min-w-0">
                                        <h2 className="text-[15px] font-semibold tracking-tight text-white leading-tight">Sign in to {currentPlatform.name}</h2>
                                        <p className="text-[11.5px] text-white/40 mt-0.5">Unlock premium access</p>
                                    </div>
                                    <button
                                        onClick={() => setShowCookieModal(false)}
                                        className="ml-auto w-8 h-8 flex items-center justify-center rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                                    >
                                        <X className="w-[18px] h-[18px]" strokeWidth={1.75} />
                                    </button>
                                </div>

                                {/* Body */}
                                <div className="relative flex-1 overflow-y-auto custom-scrollbar px-6 py-5 space-y-5">
                                    {/* Included */}
                                    <section>
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/40 mb-3">Included</p>
                                        <ul className="space-y-2.5 text-[12.5px] text-white/55 [&_b]:font-medium [&_b]:text-white/90">
                                            <li className="flex items-center gap-3">
                                                <span className="w-4 h-4 rounded-full border border-white/15 bg-white/5 flex items-center justify-center shrink-0">
                                                    <Check className="w-2.5 h-2.5 text-white/80" strokeWidth={2.5} />
                                                </span>
                                                {currentPlatform.id === 'youtube' ? (
                                                    <span>Access <b>Premium</b> &amp; age-restricted videos</span>
                                                ) : currentPlatform.id === 'tiktok' ? (
                                                    <span>Download <b>Private</b> videos</span>
                                                ) : (
                                                    <span>Download <b>Stories</b> and Highlights</span>
                                                )}
                                            </li>
                                            <li className="flex items-center gap-3">
                                                <span className="w-4 h-4 rounded-full border border-white/15 bg-white/5 flex items-center justify-center shrink-0">
                                                    <Check className="w-2.5 h-2.5 text-white/80" strokeWidth={2.5} />
                                                </span>
                                                <span>Content from <b>private accounts</b> you follow</span>
                                            </li>
                                            <li className="flex items-center gap-3">
                                                <span className="w-4 h-4 rounded-full border border-white/15 bg-white/5 flex items-center justify-center shrink-0">
                                                    <Check className="w-2.5 h-2.5 text-white/80" strokeWidth={2.5} />
                                                </span>
                                                <span>High-quality <b>original audio</b></span>
                                            </li>
                                            <li className="flex items-center gap-3">
                                                <span className="w-4 h-4 rounded-full border border-white/15 bg-white/5 flex items-center justify-center shrink-0">
                                                    <Check className="w-2.5 h-2.5 text-white/80" strokeWidth={2.5} />
                                                </span>
                                                <span>Bypass age restrictions</span>
                                            </li>
                                        </ul>
                                    </section>

                                    {/* Privacy */}
                                    <div className="flex gap-3.5 rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3.5">
                                        <ShieldCheck className="w-4 h-4 text-white/60 shrink-0 mt-0.5" strokeWidth={1.75} />
                                        <div>
                                            <p className="text-[12px] font-medium text-white/80 mb-1">Private by design</p>
                                            <p className="text-[11.5px] leading-relaxed text-white/40">
                                                Cookies stay on your machine and are only used to authenticate downloads from restricted or private sources. Nothing is tracked, stored, or transmitted.
                                            </p>
                                        </div>
                                    </div>

                                    {/* Instagram Stories - Instagram only.
                                        Stories are read by the built-in downloader that ships
                                        with the app. No Instagram login, no cookies, no API key,
                                        and nothing is billed per lookup. */}
                                    {currentPlatform.id === 'instagram' && (
                                        <div className="rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3.5">
                                            <h3 className="text-[12px] font-medium text-white/80 mb-1">Read Stories without logging in</h3>
                                            <p className="text-[11.5px] text-white/40 leading-relaxed">
                                                Instagram serves no story data to anonymous clients, so the app uses its
                                                own built-in downloader instead. No Instagram login, no cookies, no
                                                API key, and no credits are involved. On the Instagram tab you can
                                                paste a bare username such as <code className="text-white/70 font-mono">nike</code>.
                                            </p>
                                        </div>
                                    )}

                                    {!hasCookies ? (
                                        <div className="space-y-5">
                                            <div className="h-px bg-white/10" />

                                            {/* Extension */}
                                            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                                                <div className="flex items-center gap-3.5 mb-3.5">
                                                    <div className="w-9 h-9 rounded-lg bg-white/10 border border-white/10 flex items-center justify-center shrink-0">
                                                        <Puzzle className="w-4 h-4 text-white/80" strokeWidth={1.75} />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <h4 className="text-[13px] font-semibold text-white leading-tight">The easier way</h4>
                                                        <p className="text-[11.5px] text-white/40 mt-0.5">Sync your session automatically with the extension.</p>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => { setShowCookieModal(false); setShowTutorial(true); }}
                                                    className="w-full h-10 rounded-xl bg-white text-black hover:bg-white/90 text-[11px] font-bold uppercase tracking-[0.14em] transition-all cursor-pointer flex items-center justify-center gap-2 active:scale-[0.99]"
                                                >
                                                    Get the Extension
                                                    <ArrowRight className="w-3.5 h-3.5" strokeWidth={2} />
                                                </button>
                                            </div>

                                            {/* Manual steps */}
                                            <section>
                                                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/40 mb-1">Or do it manually</p>
                                                <ol>
                                                    <li className="flex gap-4 py-4 border-b border-white/5">
                                                        <span className="w-5 text-[11px] font-mono tabular-nums text-white/35 pt-0.5">01</span>
                                                        <div className="min-w-0">
                                                            <h4 className="text-[13px] font-medium text-white mb-1">Get Cookie Editor</h4>
                                                            <p className="text-[11.5px] text-white/40 mb-3 leading-relaxed">Install it for your browser to export your login data.</p>
                                                            <div className="flex flex-wrap gap-2">
                                                                <button
                                                                    onClick={() => window.electron.openExternal("https://chromewebstore.google.com/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm")}
                                                                    className="px-3 h-7 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 text-[10.5px] font-medium text-white/70 hover:text-white flex items-center gap-1.5 transition-all cursor-pointer"
                                                                >
                                                                    <Globe className="w-3 h-3" strokeWidth={1.75} /> Chrome
                                                                </button>
                                                                <button
                                                                    onClick={() => window.electron.openExternal("https://microsoftedge.microsoft.com/addons/detail/cookieeditor/neaplmfkghagebokkhpjpoebhdledlfi")}
                                                                    className="px-3 h-7 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 text-[10.5px] font-medium text-white/70 hover:text-white flex items-center gap-1.5 transition-all cursor-pointer"
                                                                >
                                                                    <Monitor className="w-3 h-3" strokeWidth={1.75} /> Edge
                                                                </button>
                                                                <button
                                                                    onClick={() => window.electron.openExternal("https://addons.mozilla.org/en-US/firefox/addon/cookie-editor/")}
                                                                    className="px-3 h-7 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 text-[10.5px] font-medium text-white/70 hover:text-white flex items-center gap-1.5 transition-all cursor-pointer"
                                                                >
                                                                    <Globe className="w-3 h-3" strokeWidth={1.75} /> Firefox
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </li>
                                                    <li className="flex gap-4 py-4 border-b border-white/5">
                                                        <span className="w-5 text-[11px] font-mono tabular-nums text-white/35 pt-0.5">02</span>
                                                        <div>
                                                            <h4 className="text-[13px] font-medium text-white mb-1">Sign in</h4>
                                                            <p className="text-[11.5px] text-white/40 leading-relaxed">Open <span className="text-white/85 font-medium">{currentPlatform.name}</span> in your browser and make sure you are logged in.</p>
                                                        </div>
                                                    </li>
                                                    <li className="flex gap-4 py-4">
                                                        <span className="w-5 text-[11px] font-mono tabular-nums text-white/35 pt-0.5">03</span>
                                                        <div>
                                                            <h4 className="text-[13px] font-medium text-white mb-1">Export as Netscape</h4>
                                                            <p className="text-[11.5px] text-white/40 leading-relaxed">Click the extension &rsaquo; Export &rsaquo; choose the <span className="text-white/85 font-medium">Netscape</span> format.</p>
                                                        </div>
                                                    </li>
                                                </ol>
                                            </section>

                                            {/* Paste */}
                                            <div className="space-y-2.5">
                                                <div className="flex items-center justify-between">
                                                    <label className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/40">Paste content</label>
                                                    <button
                                                        onClick={handleCookieFileUpload}
                                                        className="text-[11px] font-medium text-white/50 hover:text-white transition-colors flex items-center gap-1.5 cursor-pointer"
                                                    >
                                                        <FolderOpen className="w-3 h-3" strokeWidth={1.75} />
                                                        Upload .txt file
                                                    </button>
                                                </div>
                                                <textarea
                                                    value={cookieContent}
                                                    onChange={(e) => setCookieContent(e.target.value)}
                                                    placeholder="# Netscape HTTP Cookie File..."
                                                    className="w-full h-28 bg-white/5 border border-white/10 rounded-xl p-3.5 text-[11px] leading-relaxed text-white/70 placeholder:text-white/25 font-mono outline-none focus:border-white/30 focus:bg-white/[0.07] transition-all resize-none"
                                                />
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-5">
                                            <div className="h-px bg-white/10" />

                                            <div className="text-center pt-2">
                                                <div className="relative w-16 h-16 mx-auto mb-5">
                                                    <div className="absolute inset-0 rounded-full bg-emerald-400/10 blur-2xl" />
                                                    <div className="relative w-16 h-16 rounded-full border border-white/10 bg-white/5 flex items-center justify-center">
                                                        <ShieldCheck className="w-7 h-7 text-emerald-400" strokeWidth={1.5} />
                                                    </div>
                                                </div>
                                                <div className="inline-flex items-center gap-2 px-3 h-6 rounded-full border border-emerald-400/20 bg-emerald-400/10 mb-3.5">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                                    <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300">Session active</span>
                                                </div>
                                                <h3 className="text-xl font-semibold text-white tracking-tight mb-1.5">Vault Secured</h3>
                                                <p className="text-white/40 text-[12.5px] leading-relaxed max-w-[300px] mx-auto">
                                                    Your cookies are active. Stories and private content are unlocked for <span className="text-white/90 font-medium">{currentPlatform.name}</span>.
                                                </p>
                                            </div>

                                            <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4">
                                                <div className="flex items-center justify-between mb-2.5">
                                                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/40">Update vault</p>
                                                    <button
                                                        onClick={handleCookieFileUpload}
                                                        className="text-[11px] font-medium text-white/50 hover:text-white transition-colors flex items-center gap-1.5 cursor-pointer"
                                                    >
                                                        <FolderOpen className="w-3 h-3" strokeWidth={1.75} />
                                                        Upload .txt file
                                                    </button>
                                                </div>
                                                <p className="text-[11.5px] text-white/40 mb-3 leading-relaxed">If downloads fail, your session may have expired. Paste a new <span className="font-medium text-white/70">Netscape</span> file below.</p>
                                                <textarea
                                                    value={cookieContent}
                                                    onChange={(e) => setCookieContent(e.target.value)}
                                                    placeholder="Paste new Netscape content..."
                                                    className="w-full h-20 bg-white/5 border border-white/10 rounded-xl p-3.5 text-[11px] leading-relaxed text-white/70 placeholder:text-white/25 font-mono outline-none focus:border-white/30 focus:bg-white/[0.07] transition-all resize-none"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Footer */}
                                <div className="relative flex gap-3 px-6 py-4 border-t border-white/10 bg-[#111]">
                                    {hasCookies && (
                                        <button
                                            onClick={handleDeleteCookies}
                                            className="px-5 h-11 rounded-xl border border-white/10 text-white/50 text-[11px] font-semibold uppercase tracking-[0.16em] hover:text-red-300 hover:border-red-400/30 hover:bg-red-500/[0.06] transition-all cursor-pointer active:scale-[0.98]"
                                        >
                                            Purge
                                        </button>
                                    )}
                                    <button
                                        onClick={handleSaveCookies}
                                        disabled={!cookieContent.trim()}
                                        className="flex-1 h-11 rounded-xl text-[11px] font-bold uppercase tracking-[0.18em] transition-all cursor-pointer active:scale-[0.99] bg-white text-black hover:bg-white/90 disabled:bg-white/5 disabled:text-white/30 disabled:border disabled:border-white/10 disabled:cursor-not-allowed"
                                    >
                                        {hasCookies ? 'Update Session' : 'Activate Vault'}
                                    </button>
                                </div>
                            </motion.div>
                        </div>
                    )}
                </AnimatePresence>
            </div >

            {/* Footer */}
            < div className="fixed bottom-0 left-0 right-1.5 py-3 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/95 to-transparent pointer-events-none" >
                <div className="max-w-2xl mx-auto px-6 flex items-center justify-between pointer-events-auto">
                    <a
                        href="https://vibedownloader.vercel.app"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-white/45 hover:text-white/75 transition-colors cursor-pointer flex items-center gap-1.5"
                    >
                        <Sparkles className="w-3 h-3" />
                        vibedownloader.vercel.app
                    </a>
                    <div className="flex items-center gap-1.5 text-xs text-white/40">
                        <span>Powered by</span>
                        <a
                            href="https://github.com/yt-dlp/yt-dlp"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold text-white/60 hover:text-white/85 transition-colors cursor-pointer"
                        >
                            yt-dlp
                        </a>
                    </div>
                </div>
            </div >

            {/* Discord Modal */}
            <AnimatePresence>
                {
                    showDiscordModal && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                            onClick={() => setShowDiscordModal(false)}
                        >
                            <motion.div
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.9, opacity: 0 }}
                                className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-[#5865F2]/50 shadow-[0_0_50px_-10px_rgba(88,101,242,0.3)] bg-[#0f1016]"
                                onClick={(e) => e.stopPropagation()}
                            >
                                {/* Background Gradient */}
                                <div className="absolute inset-0 bg-gradient-to-b from-[#1a1c4b] to-[#0f1016]" />
                                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-[#5865F2]/20 via-transparent to-transparent opacity-50" />

                                {/* Content */}
                                <div className="relative p-8 flex flex-col items-center text-center z-10">
                                    <div className="w-20 h-20 rounded-2xl bg-[#5865F2] shadow-[0_10px_30px_-5px_rgba(88,101,242,0.5)] flex items-center justify-center mb-6 transform hover:scale-105 transition-transform duration-300">
                                        <FaDiscord className="w-12 h-12 text-white" />
                                    </div>

                                    <h3 className="text-2xl font-bold text-white mb-2">Join Community</h3>
                                    <p className="text-white/60 text-sm mb-8 leading-relaxed">
                                        Join our Discord server to get help, suggest features, and chat with other users!
                                    </p>

                                    <div className="flex flex-col gap-3 w-full">
                                        <button
                                            onClick={() => window.electron.openExternal('https://discord.com/invite/xev4Jgqz5t')}
                                            className="w-full h-12 bg-[#5865F2] hover:bg-[#4752C4] text-white font-bold rounded-xl transition-all shadow-lg shadow-[#5865F2]/20 hover:shadow-[#5865F2]/40 active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer"
                                        >
                                            <FaDiscord className="w-5 h-5" />
                                            Join Server
                                        </button>
                                        <button
                                            onClick={() => setShowDiscordModal(false)}
                                            className="w-full h-12 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white font-semibold rounded-xl transition-all border border-white/5 hover:border-white/10 cursor-pointer"
                                        >
                                            Maybe Later
                                        </button>
                                    </div>
                                </div>
                            </motion.div>
                        </motion.div>
                    )
                }
            </AnimatePresence >

            {/* Cut & Download Modal */}
            <AnimatePresence>
                {showCutModal && metadata && (
                    <div className="fixed left-0 right-0 bottom-0 top-8 z-50 flex items-center justify-center p-4 sm:p-8">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.18 }}
                            onClick={() => setShowCutModal(false)}
                            className="absolute inset-0 bg-black/80"
                        />
                        <motion.div
                            role="dialog"
                            aria-modal="true"
                            aria-label="Cut and download"
                            initial={{ opacity: 0, y: 18, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 12, scale: 0.98 }}
                            transition={{ duration: 0.22, ease: 'easeOut' }}
                            className="relative w-full max-w-5xl max-h-full overflow-y-auto custom-scrollbar rounded-3xl outline-none bg-[#0f0f11] border border-white/10 shadow-2xl shadow-black/70"
                        >
                            {/* Colour wash that follows the output type */}
                            <div
                                aria-hidden="true"
                                className="pointer-events-none absolute inset-x-0 top-0 h-64 opacity-[0.16]"
                                style={{ background: `radial-gradient(60% 100% at 70% 0%, ${CUT_TABS[cutType].from}, transparent)` }}
                            />

                            <button
                                type="button"
                                onClick={() => setShowCutModal(false)}
                                aria-label="Close"
                                className="absolute top-4 right-4 z-20 w-9 h-9 rounded-xl bg-white/[0.05] border border-white/10 hover:bg-white/10 text-white/60 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                            >
                                <X className="w-4 h-4" />
                            </button>

                            <div className="relative grid md:grid-cols-[1.1fr_1fr] gap-0">
                                {/* Preview */}
                                <div className="p-6 md:p-8 md:border-r border-white/[0.06]">
                                    <div className="flex items-center gap-2 mb-4 text-[10px] font-bold uppercase tracking-widest text-white/40">
                                        <Scissors className="w-3.5 h-3.5" /> Cut &amp; Download
                                    </div>

                                    <div className="relative rounded-2xl overflow-hidden bg-black border border-white/10">
                                        {metadata.thumbnail ? (
                                            <img src={metadata.thumbnail} alt="" onError={handleImgError} className="w-full aspect-video object-cover" referrerPolicy="no-referrer" />
                                        ) : (
                                            <div className="w-full aspect-video bg-gradient-to-br from-white/5 to-white/10 flex items-center justify-center">
                                                <Film className="w-10 h-10 text-white/20" />
                                            </div>
                                        )}
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />
                                        <span className="absolute top-2.5 right-2.5 flex items-center gap-1.5 h-6 px-2 rounded-md bg-black/70 text-[10px] font-bold text-white/85 tabular-nums">
                                            <Timer className="w-3 h-3" /> {formatDuration(metadata.duration)}
                                        </span>
                                    </div>

                                    <p className="mt-4 text-sm font-semibold text-white line-clamp-2" title={metadata.title}>{metadata.title}</p>
                                    {!isSpotify && (
                                        <p className="mt-1 flex items-center gap-1.5 text-xs text-white/40 truncate">
                                            <User className="w-3.5 h-3.5 shrink-0" /> {metadata.uploader}
                                        </p>
                                    )}

                                    {/* Clip summary */}
                                    <dl className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] divide-y divide-white/[0.06]">
                                        <div className="flex items-center justify-between gap-4 px-4 py-3">
                                            <dt className="text-[10px] font-bold uppercase tracking-widest text-white/35">Clip</dt>
                                            <dd className="text-right">
                                                <span className="block text-sm font-semibold text-white tabular-nums">{formatDuration(cutEnd - cutStart)}</span>
                                                <span className="block text-[10px] text-white/40">{formatDurationWords(cutEnd - cutStart)}</span>
                                            </dd>
                                        </div>
                                        <div className="flex items-center justify-between gap-4 px-4 py-3">
                                            <dt className="text-[10px] font-bold uppercase tracking-widest text-white/35">Range</dt>
                                            <dd className="text-xs font-semibold text-white/80 tabular-nums">
                                                {formatDuration(cutStart)} → {formatDuration(cutEnd)}
                                            </dd>
                                        </div>
                                        <div className="flex items-center justify-between gap-4 px-4 py-3">
                                            <dt className="text-[10px] font-bold uppercase tracking-widest text-white/35">Saved</dt>
                                            <dd className="text-xs font-semibold text-white/80 tabular-nums">
                                                {metadata.duration > 0 ? Math.max(0, Math.round((1 - (cutEnd - cutStart) / metadata.duration) * 100)) : 0}%
                                            </dd>
                                        </div>
                                    </dl>

                                    <p className="mt-4 flex items-start gap-2 text-[11px] leading-relaxed text-white/35">
                                        <Sparkles className="w-3.5 h-3.5 mt-px shrink-0" />
                                        Your clip will be saved as a separate {cutType === 'video' ? 'video' : 'audio'} file in your Downloads folder.
                                    </p>
                                </div>

                                {/* Controls */}
                                <div className="p-6 md:p-8 pb-0 md:pb-0 flex flex-col">
                                    <div role="tablist" aria-label="Output type" className="relative grid grid-cols-2 gap-1 p-1 rounded-2xl bg-white/[0.04] border border-white/10 mr-12">
                                        {(['video', 'audio'] as const).map(id => {
                                            const t = CUT_TABS[id];
                                            const active = cutType === id;
                                            return (
                                                <button
                                                    key={id}
                                                    type="button"
                                                    role="tab"
                                                    aria-selected={active}
                                                    onClick={() => setCutType(id)}
                                                    className={`outline-offset-[-2px] relative h-12 rounded-xl flex items-center justify-center text-xs font-semibold transition-colors cursor-pointer ${active ? 'text-white' : 'text-white/45 hover:text-white/80'}`}
                                                >
                                                    {active && (
                                                        <motion.span
                                                            layoutId="cut-tab"
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
                                    <p className="mt-3 text-xs text-white/40">Drag the handles, or click the track to trim</p>

                                    <div className="mt-5 flex-1 space-y-6">
                                        {/* Timeline */}
                                        <div>
                                            <div className="mb-3 flex items-center justify-between">
                                                <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-white/35">
                                                    <Layers className="w-3.5 h-3.5" /> Timeline
                                                </span>
                                                <span
                                                    className="flex items-center gap-1.5 h-6 px-2.5 rounded-lg border text-[11px] font-semibold tabular-nums"
                                                    style={{ color: CUT_TABS[cutType].from, borderColor: `${CUT_TABS[cutType].from}40`, background: `${CUT_TABS[cutType].from}14` }}
                                                >
                                                    <Scissors className="w-3 h-3" /> {formatDuration(cutEnd - cutStart)}
                                                </span>
                                            </div>

                                            <CutTimeline
                                                duration={metadata.duration}
                                                start={cutStart}
                                                end={cutEnd}
                                                onChange={handleCutTimelineChange}
                                                accent={CUT_TABS[cutType].from}
                                            />

                                            {/* Quick presets */}
                                            <div className="mt-4 grid grid-cols-4 gap-2">
                                                {[
                                                    { label: 'First 15s', calc: (d: number) => [0, Math.min(15, d)] },
                                                    { label: 'First 30s', calc: (d: number) => [0, Math.min(30, d)] },
                                                    { label: 'Last 15s', calc: (d: number) => [Math.max(0, d - 15), d] },
                                                    { label: 'Middle', calc: (d: number) => [d / 3, (d / 3) * 2] }
                                                ].map(p => (
                                                    <button
                                                        key={p.label}
                                                        type="button"
                                                        onClick={() => {
                                                            const [s, e] = p.calc(metadata.duration);
                                                            setCutStart(Math.max(0, Math.min(s, metadata.duration)));
                                                            setCutEnd(Math.min(metadata.duration, Math.max(e, s + 1)));
                                                        }}
                                                        className="h-10 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.07] hover:border-white/25 text-xs font-semibold text-white/60 hover:text-white transition-colors active:scale-[0.97] cursor-pointer"
                                                    >
                                                        {p.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Quality */}
                                        {cutType === 'video' ? (
                                            <div>
                                                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-white/35">Video quality</p>
                                                <div role="group" aria-label="Video quality" className="grid grid-cols-3 gap-2">
                                                    {formats.length > 0 && (
                                                        <CutChip active={cutVideoFormat === 'best'} onClick={() => setCutVideoFormat('best')}>
                                                            <span className="flex items-center gap-1.5">
                                                                Best
                                                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-white/10 text-white/70">Auto</span>
                                                            </span>
                                                            <span className="text-[9px] font-medium text-white/40">Highest available</span>
                                                        </CutChip>
                                                    )}
                                                    {formats.map((f, i) => (
                                                        <CutChip key={i} active={cutVideoFormat === f.format_id} onClick={() => setCutVideoFormat(f.format_id)}>
                                                            <span className="flex items-center gap-1.5">
                                                                {f.height}p
                                                                {f.height && f.height >= 2160 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-fuchsia-500/20 text-fuchsia-300">4K</span>}
                                                                {f.height && f.height >= 1440 && f.height < 2160 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300">2K</span>}
                                                            </span>
                                                            <span className="text-[9px] font-medium text-white/40">
                                                                {f.ext?.toUpperCase() || 'MP4'}{f.filesize ? ` · ${formatBytes(f.filesize)}` : f.format_note ? ` · ${f.format_note}` : ''}
                                                            </span>
                                                        </CutChip>
                                                    ))}
                                                </div>
                                            </div>
                                        ) : (
                                            <div>
                                                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-white/35">Audio quality</p>
                                                <div role="group" aria-label="Audio quality" className="grid grid-cols-3 gap-2">
                                                    {[
                                                        { id: 'audio_best', label: 'Best', desc: '~320 kbps' },
                                                        { id: 'audio_standard', label: 'Standard', desc: '~128 kbps' },
                                                        { id: 'audio_low', label: 'Low', desc: '~64 kbps' }
                                                    ].map(q => (
                                                        <CutChip key={q.id} active={cutAudioFormat === q.id} onClick={() => setCutAudioFormat(q.id)}>
                                                            {q.label}
                                                            <span className="text-[9px] font-medium text-white/40">{q.desc}</span>
                                                        </CutChip>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Action (stays visible when the window is short) */}
                                    <div className="sticky bottom-0 -mx-6 md:-mx-8 mt-6 px-6 md:px-8 pt-4 pb-6 md:pb-8 bg-gradient-to-t from-[#0f0f11] via-[#0f0f11] to-transparent">
                                        {cutEnd - cutStart < 1 && (
                                            <p className="mb-3 text-center text-[11px] text-amber-300/80">Select at least 1 second to cut.</p>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => handleCutDownload(cutType === 'video' ? (cutVideoFormat || 'best') : (cutAudioFormat || 'audio_best'))}
                                            disabled={downloading || cutEnd - cutStart < 1}
                                            className="w-full h-12 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 cursor-pointer transition-[filter,transform] duration-150 hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                                            style={{
                                                background: `linear-gradient(90deg, ${CUT_TABS[cutType].from}, ${CUT_TABS[cutType].to})`,
                                                boxShadow: `0 12px 30px -12px ${CUT_TABS[cutType].from}`
                                            }}
                                        >
                                            <Scissors className="w-4 h-4" /> Cut &amp; Download
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Settings Modal */}
            < Settings
                isOpen={showSettings}
                onClose={() => setShowSettings(false)}
            />

            {/* Extension Tutorial Modal */}
            <TutorialModal
                isOpen={showTutorial}
                onClose={() => setShowTutorial(false)}
            />

            {/* Library: gallery of everything downloaded (and anything already on disk) */}
            <AnimatePresence>
                {showLibrary && <Library onClose={() => setShowLibrary(false)} />}
            </AnimatePresence>

        </div >
    );
}
