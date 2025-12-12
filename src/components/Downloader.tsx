import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Download, Loader, Eye, Music, Film, Check, Play, List, User, Search, X, CheckSquare, Square, Disc, Clipboard, Sparkles, Key, Settings as SettingsIcon, Image, Link2
} from 'lucide-react';
import { FaTiktok, FaSpotify, FaXTwitter, FaYoutube, FaInstagram, FaFacebook, FaPinterest, FaSoundcloud } from 'react-icons/fa6';
import { Settings } from './Settings';

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
    contentType: 'video' | 'playlist' | 'story';
    entries?: PlaylistEntry[];
    playlist_count?: number;
    searchQuery?: string; // For Spotify single tracks
    album?: string;
}

type PlatformId = 'youtube' | 'instagram' | 'tiktok' | 'facebook' | 'spotify' | 'x' | 'pinterest' | 'soundcloud';

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
    { id: 'tiktok', name: 'TikTok', icon: <FaTiktok size={22} />, color: '#00F2EA', bgClass: 'bg-black' },
    { id: 'facebook', name: 'Facebook', icon: <FaFacebook size={22} />, color: '#1877F2', bgClass: 'bg-blue-600' },
    { id: 'spotify', name: 'Spotify', icon: <FaSpotify size={22} />, color: '#1DB954', bgClass: 'bg-green-500' },
    { id: 'x', name: 'X', icon: <FaXTwitter size={22} />, color: '#FFFFFF', bgClass: 'bg-white' },
    { id: 'pinterest', name: 'Pinterest', icon: <FaPinterest size={22} />, color: '#E60023', bgClass: 'bg-red-700' },
    { id: 'soundcloud', name: 'SoundCloud', icon: <FaSoundcloud size={22} />, color: '#FF5500', bgClass: 'bg-orange-600' }
];

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

// Circular Progress
function CircularProgress({ percent, color }: { percent: number; color: string }) {
    const radius = 45;
    const stroke = 5;
    const normalizedRadius = radius - stroke / 2;
    const circumference = normalizedRadius * 2 * Math.PI;
    const strokeDashoffset = circumference - (percent / 100) * circumference;

    return (
        <div className="relative w-28 h-28">
            <svg className="transform -rotate-90 w-28 h-28">
                <circle className="text-white/10" strokeWidth={stroke} stroke="currentColor" fill="transparent" r={normalizedRadius} cx={56} cy={56} />
                <circle strokeWidth={stroke} strokeDasharray={circumference} strokeDashoffset={strokeDashoffset} strokeLinecap="round" stroke={color} fill="transparent" r={normalizedRadius} cx={56} cy={56} style={{ transition: 'stroke-dashoffset 0.3s ease' }} />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-2xl font-bold text-white">{Math.round(percent)}%</span>
            </div>
        </div>
    );
}

export function Downloader() {
    const [url, setUrl] = useState('');
    const [currentPlatform, setCurrentPlatform] = useState<Platform>(platforms[0]);
    const [loading, setLoading] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [downloadingId, setDownloadingId] = useState<string | null>(null);
    const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
    const [progress, setProgress] = useState<{ percent: number; speed?: string; eta?: string } | null>(null);
    const [complete, setComplete] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Cookie features
    const [showCookieModal, setShowCookieModal] = useState(false);
    const [cookieContent, setCookieContent] = useState('');
    const [hasCookies, setHasCookies] = useState(false);

    // Playlist features
    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState('');

    const isSpotify = currentPlatform.id === 'spotify';

    // Settings modal
    const [showSettings, setShowSettings] = useState(false);

    // Check cookies when platform changes
    useEffect(() => {
        setHasCookies(false);
        if (['instagram', 'facebook', 'youtube', 'tiktok'].includes(currentPlatform.id)) {
            window.electron.getCookiesStatus?.(currentPlatform.id).then((res: any) => {
                setHasCookies(!!res?.exists);
            });
        }
    }, [currentPlatform.id]);

    useEffect(() => {
        const handler = (data: any) => {
            console.log('Progress:', data);
            if (data.error) {
                setError(data.error);
                setDownloading(false);
                setDownloadingId(null);
                setProgress(null);
            } else if (data.complete) {
                setComplete(true);
                setDownloading(false);
                setDownloadingId(null);
                setProgress(null);
            } else if (data.percent !== undefined) {
                setProgress({ percent: data.percent, speed: data.currentSpeed, eta: data.eta });
            }
        };
        window.electron.onProgress(handler);
        return () => window.electron.offProgress?.();
    }, []);

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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!url || loading) return;

        // Platform validation
        const u = url.toLowerCase();
        const domains: Record<string, string[]> = {
            'youtube': ['youtube.com', 'youtu.be'],
            'instagram': ['instagram.com', 'instagr.am'],
            'tiktok': ['tiktok.com'],
            'facebook': ['facebook.com', 'fb.watch', 'fb.com', 'messenger.com'],
            'spotify': ['spotify.com'],
            'x': ['twitter.com', 'x.com'],
            'pinterest': ['pinterest.com', 'pin.it'],
            'soundcloud': ['soundcloud.com']
        };

        const validDomains = domains[currentPlatform.id];
        if (validDomains && !validDomains.some(d => u.includes(d))) {
            const detectedId = Object.keys(domains).find(id => domains[id].some(d => u.includes(d)));
            const detectedName = detectedId ? platforms.find(p => p.id === detectedId)?.name : null;

            if (detectedName) {
                setError(`⚠️ This looks like a ${detectedName} link. Please switch to the ${detectedName} tab above.`);
            } else {
                setError(`Invalid URL for ${currentPlatform.name}. Please check your link.`);
            }
            return;
        }

        setLoading(true);
        setError(null);
        setMetadata(null);
        setComplete(false);
        setProgress(null);
        setSelectedItems(new Set());
        setSearchQuery('');

        try {
            // Use different handler for Spotify
            const res = isSpotify
                ? await window.electron.getSpotifyInfo(url)
                : await window.electron.getVideoInfo(url);

            console.log('Metadata response:', res);
            if (res.success && res.metadata) {
                let finalMetadata = res.metadata;

                // Proxy thumbnail for Instagram/Facebook (fbcdn.net has CORS issues)
                if (finalMetadata.thumbnail && finalMetadata.thumbnail.includes('fbcdn.net')) {
                    console.log('Proxying Instagram thumbnail...');
                    const proxyResult = await window.electron.getProxyImage(finalMetadata.thumbnail);
                    if (proxyResult) {
                        finalMetadata = { ...finalMetadata, thumbnail: proxyResult };
                    }
                }

                setMetadata(finalMetadata);
                // Auto-select all items in playlist
                if (finalMetadata.entries) {
                    setSelectedItems(new Set(finalMetadata.entries.map((e: PlaylistEntry) => e.id)));
                }
            } else {
                setError(res.error || 'Failed to fetch info');
            }
        } catch (err: any) {
            setError(err.message || 'Unknown error');
        } finally {
            setLoading(false);
        }
    };

    // Regular video download
    const handleDownload = useCallback(async (formatId: string, videoUrl?: string, videoTitle?: string, itemId?: string) => {
        if (downloading) return;
        const targetUrl = videoUrl || metadata?.webpage_url || url;
        const targetTitle = videoTitle || metadata?.title || 'video';

        setDownloading(true);
        setDownloadingId(itemId || null);
        setError(null);
        setProgress({ percent: 0 });

        try {
            await window.electron.downloadVideo({
                url: targetUrl,
                formatId,
                title: targetTitle
            });
        } catch (err: any) {
            setError(err.message);
            setDownloading(false);
            setDownloadingId(null);
            setProgress(null);
        }
    }, [metadata, downloading, url]);

    // Spotify track download (via YouTube)
    const handleSpotifyDownload = useCallback(async (searchQuery: string, title: string, artist: string, itemId?: string) => {
        if (downloading) return;

        setDownloading(true);
        setDownloadingId(itemId || null);
        setError(null);
        setProgress({ percent: 0 });

        try {
            await window.electron.downloadSpotifyTrack({
                searchQuery,
                title,
                artist
            });
        } catch (err: any) {
            setError(err.message);
            setDownloading(false);
            setDownloadingId(null);
            setProgress(null);
        }
    }, [downloading]);

    // Get all available video formats sorted by resolution - prioritize MP4 over WEBM
    const formats = useMemo(() => {
        if (!metadata?.formats) return [];

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
            .filter(f => f.video_ext !== 'none' && f.height && f.height >= 360)
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
        const res = ['maxresdefault', 'sddefault', 'hqdefault', 'mqdefault'];
        for (let i = 0; i < res.length - 1; i++) {
            if (src.includes(res[i])) {
                img.src = src.replace(res[i], res[i + 1]);
                return;
            }
        }
        img.style.display = 'none';
    }, []);

    const handlePlatformChange = (p: Platform) => {
        setCurrentPlatform(p);
        setUrl('');
        setMetadata(null);
        setError(null);
        setComplete(false);
        setProgress(null);
        setSelectedItems(new Set());
        setSearchQuery('');
    };

    // Playlist helpers
    const toggleItem = (id: string) => {
        setSelectedItems(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const selectAll = () => {
        if (metadata?.entries) {
            setSelectedItems(new Set(filteredEntries.map(e => e.id)));
        }
    };

    const deselectAll = () => {
        setSelectedItems(new Set());
    };

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

    const isPlaylist = (metadata?.contentType === 'playlist' || (metadata?.contentType === 'story' && (metadata?.entries?.length || 0) > 1)) && metadata?.entries && metadata.entries.length > 0;

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

                // For Spotify, we need special handling if we want to support it in bulk, 
                // but currently spotify is single track search mostly or playlist.
                // Assuming standard video download for now as Spotify logic is separate.
                if (isSpotify) {
                    await window.electron.downloadSpotifyTrack({
                        searchQuery: item.searchQuery || `${item.title} ${item.artist || ''}`,
                        title: item.title,
                        artist: item.artist || ''
                    });
                } else {
                    await window.electron.downloadVideo({
                        url: item.url,
                        formatId: formatId,
                        title: item.title,
                        platform: currentPlatform.id
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
            // We rely on main process notifications for success, but maybe a summary alert?
            // alert(`All ${successCount} items downloaded successfully!`);
        } else {
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
        <div className="w-full h-full bg-[#0a0a0a] text-white overflow-y-auto overflow-x-hidden relative">
            <div className="max-w-2xl mx-auto px-6 pt-10 pb-24 relative">
                {/* Settings Button - Top Right of Content Area */}
                <button
                    onClick={() => setShowSettings(true)}
                    className="absolute top-10 right-6 z-40 w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 flex items-center justify-center transition-all duration-200 cursor-pointer backdrop-blur-sm"
                    title="Settings"
                >
                    <SettingsIcon className="w-5 h-5 text-white/60 hover:text-white/80" />
                </button>

                {/* Title */}
                <div className="text-center mb-10">
                    <h1 className="text-4xl sm:text-5xl font-black tracking-tight mb-2">
                        VibeDownloader
                    </h1>
                    <p className="text-white/40">
                        Download from {currentPlatform.name}
                        {isSpotify && <span className="text-green-400 text-xs ml-2">• via YouTube</span>}
                    </p>
                </div>

                {/* Platform Selector */}
                <div className="flex flex-wrap justify-center gap-3 mb-10">
                    {platforms.map((p) => {
                        const isActive = currentPlatform.id === p.id;
                        return (
                            <button
                                key={p.id}
                                onClick={() => handlePlatformChange(p)}
                                className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-300 cursor-pointer
                                    ${isActive
                                        ? `${p.bgClass} scale-110 ${p.id === 'x' ? 'text-black' : p.id === 'tiktok' ? 'text-white' : 'text-white'}`
                                        : 'bg-white/[0.08] hover:bg-white/[0.12]'
                                    }`}
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

                {/* Search - Premium Design */}
                <form onSubmit={handleSubmit} className="mb-8">
                    <div className="flex gap-3 relative z-20">
                        <div className="flex-1 relative group">
                            {/* Input with enhanced styling */}
                            <div className="relative">
                                <div className="absolute -inset-0.5 bg-gradient-to-r from-white/5 via-white/10 to-white/5 rounded-2xl opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition duration-300 blur-sm" />
                                <div className="relative">
                                    <Link2 className="absolute left-4 sm:left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-white/30 group-focus-within:text-white/50 transition" />
                                    <input
                                        type="text"
                                        value={url}
                                        onChange={(e) => setUrl(e.target.value)}
                                        placeholder={isSpotify ? 'Paste Spotify link here...' : `Paste ${currentPlatform.name} link here...`}
                                        disabled={loading || downloading}
                                        className="w-full h-14 sm:h-16 pl-12 sm:pl-14 pr-28 sm:pr-36 bg-[#111] border-2 border-white/10 rounded-2xl text-white placeholder-white/30 outline-none focus:border-white/25 focus:bg-[#141414] transition-all duration-200 cursor-text disabled:opacity-50 text-sm sm:text-base truncate shadow-lg shadow-black/20"
                                    />

                                    {/* Fade Overlay */}
                                    <div className="absolute right-0 top-[2px] bottom-[2px] w-28 sm:w-36 bg-gradient-to-l from-[#111] via-[#111] to-transparent pointer-events-none rounded-r-2xl" />

                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2 z-10">
                                        {['instagram', 'facebook', 'youtube', 'tiktok'].includes(currentPlatform.id) && (
                                            <button
                                                type="button"
                                                onClick={() => setShowCookieModal(true)}
                                                className={`h-9 w-9 flex items-center justify-center rounded-xl transition cursor-pointer ${hasCookies
                                                    ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/30'
                                                    : 'bg-white/10 text-white/40 hover:text-white hover:bg-white/20 border border-white/10'}`}
                                                title={hasCookies ? "Cookies Active" : "Login Required for some content"}
                                            >
                                                <Key className="w-4 h-4" />
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                try {
                                                    const text = await navigator.clipboard.readText();
                                                    setUrl(text);
                                                } catch (e) {
                                                    console.log('Clipboard access denied');
                                                }
                                            }}
                                            disabled={loading || downloading}
                                            className="h-9 px-4 bg-white/10 hover:bg-white/20 rounded-xl text-xs font-semibold text-white/60 hover:text-white transition cursor-pointer disabled:opacity-40 whitespace-nowrap flex items-center gap-1.5 border border-white/10"
                                        >
                                            <Clipboard className="w-3.5 h-3.5" />
                                            Paste
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <button
                            type="submit"
                            disabled={!url || loading || downloading}
                            className="h-14 sm:h-16 px-7 sm:px-10 bg-white text-black rounded-2xl font-bold flex items-center gap-2 cursor-pointer hover:bg-white/90 active:scale-95 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed text-sm sm:text-base shrink-0 shadow-lg shadow-white/10"
                        >
                            {loading ? <Loader className="w-5 h-5 animate-spin" /> : 'Go'}
                        </button>
                    </div>
                </form>

                {/* Error */}
                <AnimatePresence>
                    {error && (
                        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-center text-sm">
                            {error}
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Content */}
                <AnimatePresence mode="wait">
                    {/* Loading Skeleton */}
                    {loading && (
                        <motion.div
                            key="skeleton"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                        >
                            <div className="animate-pulse">
                                {/* Thumbnail */}
                                <div className="w-full aspect-video bg-white/5 rounded-2xl mb-5 border border-white/5" />

                                {/* Info */}
                                <div className="space-y-3 mb-6">
                                    <div className="h-7 bg-white/5 rounded-lg w-3/4" />
                                    <div className="flex gap-4">
                                        <div className="h-4 bg-white/5 rounded w-24" />
                                        <div className="h-4 bg-white/5 rounded w-16" />
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="border-t border-white/10 pt-5 space-y-3">
                                    <div className="h-3 bg-white/5 rounded w-32" />
                                    <div className="space-y-2">
                                        <div className="h-14 bg-white/5 rounded-xl border border-white/5" />
                                        <div className="h-14 bg-white/5 rounded-xl border border-white/5" />
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    )}
                    {/* Single Video/Track Result */}
                    {metadata && !complete && !isPlaylist && (
                        <motion.div key="video" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
                            {/* Thumbnail */}
                            <div className="relative rounded-2xl overflow-hidden bg-gradient-to-br from-white/5 to-white/10 mb-5">
                                {metadata.thumbnail ? (
                                    <img src={metadata.thumbnail} alt="" onError={handleImgError} className="w-full aspect-video object-cover" />
                                ) : (
                                    <div className="w-full aspect-video flex items-center justify-center bg-gradient-to-br from-green-900/30 to-green-600/20">
                                        <Disc className="w-20 h-20 text-green-500/50" />
                                    </div>
                                )}

                                {/* Resolution Badge */}
                                {maxResolution && (
                                    <div className="absolute top-3 left-3 px-2 py-1 bg-black/80 backdrop-blur rounded text-xs font-bold" style={{ color: currentPlatform.color }}>
                                        {maxResolution}
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
                                    <div className="absolute inset-0 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center">
                                        <CircularProgress percent={progress?.percent || 0} color={currentPlatform.color} />
                                        <p className="text-white/60 mt-4 text-sm">{progress?.speed || 'Starting...'} {progress?.eta && `• ${progress.eta}`}</p>
                                    </div>
                                )}
                            </div>

                            {/* Info */}
                            <div className="flex items-start justify-between mb-5">
                                <div className="flex-1">
                                    <h2 className="text-lg font-bold leading-snug mb-2">{metadata.title}</h2>
                                    <div className="flex items-center gap-4 text-white/40 text-sm">
                                        <span className="flex items-center gap-1.5"><User className="w-4 h-4" /> {metadata.uploader}</span>
                                        {!isSpotify && <span className="flex items-center gap-1.5"><Eye className="w-4 h-4" /> {formatNumber(metadata.view_count)}</span>}
                                        {isSpotify && metadata.view_count > 0 && <span>Popularity: {metadata.view_count}</span>}
                                    </div>
                                </div>
                                {metadata.thumbnail && (
                                    <button
                                        onClick={async () => {
                                            const result = await window.electron.saveThumbnail({
                                                url: metadata.thumbnail,
                                                title: metadata.title
                                            });
                                            if (result?.success) {
                                                alert('Thumbnail saved to Downloads!');
                                            } else {
                                                alert('Failed to save thumbnail');
                                            }
                                        }}
                                        className="shrink-0 w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center transition cursor-pointer"
                                        title="Save Thumbnail"
                                    >
                                        <Image className="w-5 h-5 text-white/60" />
                                    </button>
                                )}
                            </div>

                            {/* Download Options */}
                            <div className="border-t border-white/10 pt-5">
                                <p className="text-white/30 text-xs uppercase tracking-widest mb-3">Download Options</p>
                                <div className="grid gap-2">
                                    {/* Spotify Download */}
                                    {isSpotify && metadata.searchQuery && (
                                        <button
                                            onClick={() => handleSpotifyDownload(metadata.searchQuery!, metadata.title, metadata.uploader)}
                                            disabled={downloading}
                                            className="flex items-center justify-between p-3.5 bg-green-500/10 border border-green-500/20 rounded-xl cursor-pointer hover:bg-green-500/20 transition group disabled:opacity-40"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="w-9 h-9 rounded-lg bg-green-500/30 flex items-center justify-center"><Music className="w-4 h-4 text-green-400" /></div>
                                                <div className="text-left"><p className="font-medium text-sm text-green-400">Download MP3</p><p className="text-xs text-white/40">via YouTube Audio</p></div>
                                            </div>
                                            <Download className="w-4 h-4 text-green-400/50 group-hover:text-green-400" />
                                        </button>
                                    )}

                                    {!isSpotify && (
                                        <>
                                            <button onClick={() => handleDownload('audio_best')} disabled={downloading} className="flex items-center justify-between p-3.5 bg-white/5 border border-white/10 rounded-xl cursor-pointer hover:bg-white/8 transition group disabled:opacity-40">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-9 h-9 rounded-lg bg-green-500/20 flex items-center justify-center"><Music className="w-4 h-4 text-green-400" /></div>
                                                    <div className="text-left"><p className="font-medium text-sm">Audio (Best)</p><p className="text-xs text-white/40">~320kbps • High Quality</p></div>
                                                </div>
                                                <Download className="w-4 h-4 text-white/30 group-hover:text-white/60" />
                                            </button>
                                            <button onClick={() => handleDownload('audio_standard')} disabled={downloading} className="flex items-center justify-between p-3.5 bg-white/5 border border-white/10 rounded-xl cursor-pointer hover:bg-white/8 transition group disabled:opacity-40">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-9 h-9 rounded-lg bg-green-500/10 flex items-center justify-center"><Music className="w-4 h-4 text-green-400/80" /></div>
                                                    <div className="text-left"><p className="font-medium text-sm">Audio (Standard)</p><p className="text-xs text-white/40">~128kbps • Balanced</p></div>
                                                </div>
                                                <Download className="w-4 h-4 text-white/30 group-hover:text-white/60" />
                                            </button>
                                            <button onClick={() => handleDownload('audio_low')} disabled={downloading} className="flex items-center justify-between p-3.5 bg-white/5 border border-white/10 rounded-xl cursor-pointer hover:bg-white/8 transition group disabled:opacity-40">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-9 h-9 rounded-lg bg-yellow-500/10 flex items-center justify-center"><Music className="w-4 h-4 text-yellow-400" /></div>
                                                    <div className="text-left"><p className="font-medium text-sm">Audio (Low)</p><p className="text-xs text-white/40">~64kbps • Save Data</p></div>
                                                </div>
                                                <Download className="w-4 h-4 text-white/30 group-hover:text-white/60" />
                                            </button>
                                        </>
                                    )}

                                    {/* All video formats */}
                                    {!isSpotify && formats.map((f, i) => (
                                        <button key={i} onClick={() => handleDownload(f.format_id)} disabled={downloading} className="flex items-center justify-between p-3.5 bg-white/5 border border-white/10 rounded-xl cursor-pointer hover:bg-white/8 transition group disabled:opacity-40">
                                            <div className="flex items-center gap-3">
                                                <div className="w-9 h-9 rounded-lg bg-blue-500/20 flex items-center justify-center"><Film className="w-4 h-4 text-blue-400" /></div>
                                                <div className="text-left">
                                                    <p className="font-medium text-sm flex items-center gap-2">
                                                        {f.height}p
                                                        {i === 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/60">Best</span>}
                                                        {f.height && f.height >= 2160 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/30 text-purple-300">4K</span>}
                                                        {f.height && f.height >= 1440 && f.height < 2160 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/30 text-blue-300">2K</span>}
                                                    </p>
                                                    <p className="text-xs text-white/40">{f.ext?.toUpperCase() || 'MP4'} {f.format_note && `• ${f.format_note}`}</p>
                                                </div>
                                            </div>
                                            <Download className="w-4 h-4 text-white/30 group-hover:text-white/60" />
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {/* Playlist/Album Result */}
                    {metadata && !complete && isPlaylist && (
                        <motion.div key="playlist" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
                            {/* Playlist Header */}
                            <div className="flex items-start gap-4 mb-4 p-4 bg-white/5 rounded-2xl border border-white/10">
                                <div className="w-16 h-16 rounded-xl overflow-hidden shrink-0">
                                    {metadata.thumbnail ? (
                                        <img src={metadata.thumbnail} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center" style={{ backgroundColor: `${currentPlatform.color}20` }}>
                                            <List className="w-7 h-7" style={{ color: currentPlatform.color }} />
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h2 className="font-bold text-base leading-tight mb-1 truncate">{metadata.title}</h2>
                                    <p className="text-white/50 text-sm mb-1">{metadata.uploader}</p>
                                    <div className="flex items-center gap-3 text-xs text-white/40">
                                        <span className="flex items-center gap-1"><Play className="w-3 h-3" /> {metadata.playlist_count} {isSpotify ? 'tracks' : 'videos'}</span>
                                        <span>{selectedItems.size} selected</span>
                                    </div>
                                </div>
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
                            <div className="space-y-1.5 max-h-[400px] overflow-y-auto pr-1">
                                {filteredEntries.map((entry, index) => {
                                    const isSelected = selectedItems.has(entry.id);
                                    const isDownloadingItem = downloadingId === entry.id;

                                    return (
                                        <div
                                            key={entry.id || index}
                                            className={`flex items-center gap-3 p-2.5 rounded-xl group transition cursor-pointer
                                                ${isSelected ? 'bg-white/8 border border-white/15' : 'bg-white/5 border border-transparent hover:bg-white/8'}`}
                                            onClick={() => toggleItem(entry.id)}
                                        >
                                            {/* Checkbox */}
                                            <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 transition
                                                ${isSelected ? 'bg-white text-black' : 'bg-white/10'}`}>
                                                {isSelected && <Check className="w-3.5 h-3.5" />}
                                            </div>

                                            {/* Thumbnail */}
                                            <div className="w-12 h-12 rounded-lg bg-white/10 overflow-hidden shrink-0 relative">
                                                {entry.thumbnail ? (
                                                    <img src={entry.thumbnail} alt="" className="w-full h-full object-cover" onError={handleImgError} />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-green-900/30 to-green-600/20">
                                                        <Music className="w-5 h-5 text-green-500/50" />
                                                    </div>
                                                )}
                                                {isDownloadingItem && (
                                                    <div className="absolute inset-0 bg-black/80 flex items-center justify-center">
                                                        <Loader className="w-4 h-4 animate-spin" />
                                                    </div>
                                                )}
                                            </div>

                                            {/* Info */}
                                            <div className="flex-1 min-w-0">
                                                <p className="font-medium text-sm truncate">{entry.title}</p>
                                                <p className="text-xs text-white/40">
                                                    {entry.artist && <span>{entry.artist} • </span>}
                                                    {formatDuration(entry.duration)}
                                                </p>
                                            </div>

                                            {/* Quick Actions */}
                                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition" onClick={(e) => e.stopPropagation()}>
                                                {isSpotify && entry.searchQuery ? (
                                                    <button
                                                        onClick={() => handleSpotifyDownload(entry.searchQuery!, entry.title, entry.artist || metadata.uploader, entry.id)}
                                                        disabled={downloading}
                                                        className="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center cursor-pointer hover:bg-green-500/30 transition disabled:opacity-40"
                                                        title="Download MP3"
                                                    >
                                                        <Music className="w-4 h-4 text-green-400" />
                                                    </button>
                                                ) : (
                                                    <>
                                                        <button
                                                            onClick={() => handleDownload('audio', entry.url, entry.title, entry.id)}
                                                            disabled={downloading}
                                                            className="w-7 h-7 rounded-lg bg-green-500/20 flex items-center justify-center cursor-pointer hover:bg-green-500/30 transition disabled:opacity-40"
                                                            title="Download Audio"
                                                        >
                                                            <Music className="w-3.5 h-3.5 text-green-400" />
                                                        </button>
                                                        <button
                                                            onClick={() => handleDownload('best', entry.url, entry.title, entry.id)}
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
                                })}

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

                    {/* Success */}
                    {complete && (
                        <motion.div key="success" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="text-center py-16">
                            <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6" style={{ backgroundColor: currentPlatform.color }}>
                                <Check className={`w-10 h-10 ${currentPlatform.id === 'x' || currentPlatform.id === 'tiktok' ? 'text-black' : 'text-white'}`} />
                            </div>
                            <h2 className="text-2xl font-bold mb-2">Download Complete!</h2>
                            <p className="text-white/40 mb-8">Saved to Downloads folder</p>
                            <button onClick={() => { setComplete(false); setMetadata(null); setUrl(''); }} className="h-12 px-8 bg-white text-black rounded-xl font-bold cursor-pointer hover:bg-white/90 transition">
                                Download Another
                            </button>
                        </motion.div>
                    )}

                    {/* Empty State */}
                    {!metadata && !loading && !complete && (
                        <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-8">
                            {/* Hero Icon */}
                            <div className="text-center mb-10">
                                <motion.div
                                    className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-4"
                                    style={{
                                        background: `linear-gradient(135deg, ${currentPlatform.color}20, ${currentPlatform.color}10)`,
                                        boxShadow: `0 0 60px ${currentPlatform.color}20`
                                    }}
                                    animate={{ scale: [1, 1.05, 1] }}
                                    transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                                >
                                    <div style={{ color: currentPlatform.color }}>
                                        {currentPlatform.icon}
                                    </div>
                                </motion.div>
                                <h2 className="text-xl font-bold text-white mb-2">
                                    Ready to Download
                                </h2>
                                <p className="text-white/40 text-sm">
                                    {isSpotify ? 'Tracks, albums & playlists' : 'Videos, reels & playlists'}
                                </p>
                            </div>

                            {/* How to Download Steps */}
                            <div className="space-y-3 mb-8">
                                <p className="text-white/30 text-xs uppercase tracking-widest text-center mb-4">How to Download</p>

                                {/* Step 1 */}
                                <motion.div
                                    className="flex items-center gap-4 p-4 bg-white/[0.03] border border-white/[0.06] rounded-2xl"
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: 0.1 }}
                                >
                                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/20 to-blue-600/10 flex items-center justify-center shrink-0">
                                        <Link2 className="w-5 h-5 text-blue-400" />
                                    </div>
                                    <div className="flex-1">
                                        <p className="font-medium text-sm text-white">Copy the link</p>
                                        <p className="text-xs text-white/40">Copy the video or playlist URL from {currentPlatform.name}</p>
                                    </div>
                                    <div className="w-6 h-6 rounded-full bg-white/5 flex items-center justify-center text-white/20 text-xs font-bold">1</div>
                                </motion.div>

                                {/* Step 2 */}
                                <motion.div
                                    className="flex items-center gap-4 p-4 bg-white/[0.03] border border-white/[0.06] rounded-2xl"
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: 0.2 }}
                                >
                                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-purple-600/10 flex items-center justify-center shrink-0">
                                        <Clipboard className="w-5 h-5 text-purple-400" />
                                    </div>
                                    <div className="flex-1">
                                        <p className="font-medium text-sm text-white">Paste it above</p>
                                        <p className="text-xs text-white/40">Use the Paste button or press Ctrl+V</p>
                                    </div>
                                    <div className="w-6 h-6 rounded-full bg-white/5 flex items-center justify-center text-white/20 text-xs font-bold">2</div>
                                </motion.div>

                                {/* Step 3 */}
                                <motion.div
                                    className="flex items-center gap-4 p-4 bg-white/[0.03] border border-white/[0.06] rounded-2xl"
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: 0.3 }}
                                >
                                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500/20 to-green-600/10 flex items-center justify-center shrink-0">
                                        <Download className="w-5 h-5 text-green-400" />
                                    </div>
                                    <div className="flex-1">
                                        <p className="font-medium text-sm text-white">Choose & download</p>
                                        <p className="text-xs text-white/40">Select quality and start downloading</p>
                                    </div>
                                    <div className="w-6 h-6 rounded-full bg-white/5 flex items-center justify-center text-white/20 text-xs font-bold">3</div>
                                </motion.div>
                            </div>

                            {/* Supported Content */}
                            <motion.div
                                className="p-4 bg-gradient-to-br from-white/[0.02] to-transparent border border-white/[0.05] rounded-2xl"
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.4 }}
                            >
                                <div className="flex items-center gap-2 mb-3">
                                    <Sparkles className="w-4 h-4 text-yellow-400" />
                                    <span className="text-xs font-medium text-white/60">Supported Content</span>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {isSpotify ? (
                                        <>
                                            <span className="px-3 py-1.5 bg-white/5 rounded-lg text-xs text-white/50">🎵 Tracks</span>
                                            <span className="px-3 py-1.5 bg-white/5 rounded-lg text-xs text-white/50">💿 Albums</span>
                                            <span className="px-3 py-1.5 bg-white/5 rounded-lg text-xs text-white/50">📋 Playlists</span>
                                        </>
                                    ) : currentPlatform.id === 'youtube' ? (
                                        <>
                                            <span className="px-3 py-1.5 bg-white/5 rounded-lg text-xs text-white/50">🎬 Videos</span>
                                            <span className="px-3 py-1.5 bg-white/5 rounded-lg text-xs text-white/50">💎 Premium</span>
                                            <span className="px-3 py-1.5 bg-white/5 rounded-lg text-xs text-white/50">🎵 Music</span>
                                            <span className="px-3 py-1.5 bg-white/5 rounded-lg text-xs text-white/50">📺 Shorts</span>
                                        </>
                                    ) : currentPlatform.id === 'instagram' ? (
                                        <>
                                            <span className="px-3 py-1.5 bg-white/5 rounded-lg text-xs text-white/50">🎬 Reels</span>
                                            <span className="px-3 py-1.5 bg-white/5 rounded-lg text-xs text-white/50">📷 Posts</span>
                                            <span className="px-3 py-1.5 bg-white/5 rounded-lg text-xs text-white/50">📖 Stories*</span>
                                        </>
                                    ) : currentPlatform.id === 'tiktok' ? (
                                        <>
                                            <span className="px-3 py-1.5 bg-white/5 rounded-lg text-xs text-white/50">🎬 Videos</span>
                                            <span className="px-3 py-1.5 bg-white/5 rounded-lg text-xs text-white/50">🎵 Sounds</span>
                                        </>
                                    ) : currentPlatform.id === 'soundcloud' ? (
                                        <>
                                            <span className="px-3 py-1.5 bg-white/5 rounded-lg text-xs text-white/50">🎵 Tracks</span>
                                            <span className="px-3 py-1.5 bg-white/5 rounded-lg text-xs text-white/50">📋 Playlists</span>
                                        </>
                                    ) : currentPlatform.id === 'pinterest' ? (
                                        <>
                                            <span className="px-3 py-1.5 bg-white/5 rounded-lg text-xs text-white/50">📌 Pins</span>
                                            <span className="px-3 py-1.5 bg-white/5 rounded-lg text-xs text-white/50">🎬 Videos</span>
                                        </>
                                    ) : (
                                        <>
                                            <span className="px-3 py-1.5 bg-white/5 rounded-lg text-xs text-white/50">🎬 Videos</span>
                                            <span className="px-3 py-1.5 bg-white/5 rounded-lg text-xs text-white/50">📷 Posts</span>
                                        </>
                                    )}
                                </div>
                                {['instagram', 'facebook'].includes(currentPlatform.id) && !hasCookies && (
                                    <p className="text-[10px] text-white/30 mt-2">*Stories & private content require login (Click key icon)</p>
                                )}
                                {['youtube', 'tiktok'].includes(currentPlatform.id) && !hasCookies && (
                                    <p className="text-[10px] text-white/30 mt-2">*Premium/Age-gated content requires login (Click key icon)</p>
                                )}
                            </motion.div>
                        </motion.div>
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
                                onClick={() => setShowCookieModal(false)}
                                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
                            />
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto bg-[#111] border border-white/10 rounded-2xl p-6 shadow-2xl custom-scrollbar"
                            >
                                <div className="flex items-center gap-3 mb-6 sticky top-0 bg-[#111] z-10 pb-2 border-b border-white/5">
                                    <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
                                        <Key className="w-5 h-5 text-blue-400" />
                                    </div>
                                    <div>
                                        <h2 className="text-lg font-bold">Login for {currentPlatform.name}</h2>
                                        <p className="text-white/40 text-xs">Unlock premium features</p>
                                    </div>
                                    <button onClick={() => setShowCookieModal(false)} className="ml-auto w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition cursor-pointer">
                                        <X className="w-5 h-5 text-white/60" />
                                    </button>
                                </div>

                                <div className="space-y-4 mb-6">
                                    {/* Benefits List */}
                                    <div className="p-4 bg-white/5 border border-white/10 rounded-xl">
                                        <h3 className="text-sm font-bold text-white mb-3">Why add cookies?</h3>
                                        <ul className="space-y-2 text-xs text-white/60">
                                            <li className="flex items-center gap-2">
                                                <Check className="w-3.5 h-3.5 text-green-400" />
                                                {currentPlatform.id === 'youtube' ? (
                                                    <span>Access <b>Premium</b> & Age-restricted videos</span>
                                                ) : currentPlatform.id === 'tiktok' ? (
                                                    <span>Download <b>Private</b> videos</span>
                                                ) : (
                                                    <span>Download <b>Stories</b> and Highlights</span>
                                                )}
                                            </li>
                                            <li className="flex items-center gap-2">
                                                <Check className="w-3.5 h-3.5 text-green-400" />
                                                <span>Access contents from <b>Private Accounts</b> you follow</span>
                                            </li>
                                            <li className="flex items-center gap-2">
                                                <Check className="w-3.5 h-3.5 text-green-400" />
                                                <span>Download high-quality <b>original audio</b></span>
                                            </li>
                                            <li className="flex items-center gap-2">
                                                <Check className="w-3.5 h-3.5 text-green-400" />
                                                <span>Bypass age restrictions</span>
                                            </li>
                                        </ul>
                                    </div>

                                    <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl text-sm text-blue-300">
                                        <p className="mb-2 font-semibold flex items-center gap-2">
                                            <Eye className="w-4 h-4" /> Privacy Promise
                                        </p>
                                        <p className="opacity-80 leading-relaxed">
                                            Look, you don't want to upload your cookie, that's okay, fine. But we don't leak any of your personal details. It's all your choice. Cookies are stored locally on your machine.
                                        </p>
                                    </div>

                                    {!hasCookies ? (
                                        <div className="space-y-4">
                                            <div className="text-sm text-white/60 space-y-2">
                                                <p>1. Install this recommended extension:</p>
                                                <a
                                                    href="https://chromewebstore.google.com/detail/hlkenndednhfkekhgcdicdfddnkalmdm?utm_source=item-share-cb"
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 underline"
                                                >
                                                    <Link2 className="w-3 h-3" /> Get Cookie Editor Extension
                                                </a>
                                                <p>2. Open {currentPlatform.name} in your browser.</p>
                                                <p>3. Click the extension → Export → select "Netscape" format.</p>
                                                <p>4. Paste the content below:</p>
                                            </div>
                                            <textarea
                                                value={cookieContent}
                                                onChange={(e) => setCookieContent(e.target.value)}
                                                placeholder="# Netscape HTTP Cookie File..."
                                                className="w-full h-32 bg-white/5 border border-white/10 rounded-xl p-3 text-xs text-white/70 font-mono outline-none focus:border-white/20 resize-none"
                                            />
                                        </div>
                                    ) : (
                                        <div className="text-center py-6">
                                            <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                                                <Check className="w-8 h-8 text-green-400" />
                                            </div>
                                            <h3 className="text-lg font-bold text-green-400 mb-2">Cookies Active</h3>
                                            <p className="text-white/40 text-sm max-w-xs mx-auto mb-6">
                                                You can now download stories and private content. If downloads stop working, your cookies may have expired.
                                            </p>

                                            <div className="bg-white/5 rounded-xl p-4 mb-4 text-left">
                                                <p className="text-xs font-bold text-white/60 mb-2 uppercase tracking-wider">Update Cookies</p>
                                                <p className="text-xs text-white/40 mb-3">If cookies expired, upload a new one here:</p>
                                                <textarea
                                                    value={cookieContent}
                                                    onChange={(e) => setCookieContent(e.target.value)}
                                                    placeholder="Paste new Netscape cookie content..."
                                                    className="w-full h-20 bg-black/20 border border-white/10 rounded-lg p-3 text-xs text-white/70 font-mono outline-none focus:border-white/20 resize-none"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="flex gap-3">
                                    {hasCookies && (
                                        <button
                                            onClick={handleDeleteCookies}
                                            className="px-5 h-11 border border-red-500/30 text-red-400 rounded-xl font-medium hover:bg-red-500/10 transition cursor-pointer"
                                        >
                                            Delete
                                        </button>
                                    )}
                                    <button
                                        onClick={handleSaveCookies}
                                        disabled={!cookieContent.trim()}
                                        className="flex-1 h-11 bg-white text-black rounded-xl font-bold hover:bg-white/90 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {hasCookies ? 'Update Cookie' : 'Save Cookie'}
                                    </button>
                                </div>
                            </motion.div>
                        </div>
                    )}
                </AnimatePresence>
            </div >

            {/* Footer */}
            <div className="fixed bottom-0 left-0 right-0 py-3 px-6 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/95 to-transparent pointer-events-none">
                <div className="max-w-2xl mx-auto flex items-center justify-between pointer-events-auto">
                    <a
                        href="https://vibedownloader.me"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-white/30 hover:text-white/60 transition-colors cursor-pointer flex items-center gap-1.5"
                    >
                        <Sparkles className="w-3 h-3" />
                        vibedownloader.me
                    </a>
                    <div className="flex items-center gap-1.5 text-xs text-white/25">
                        <span>Powered by</span>
                        <a
                            href="https://github.com/yt-dlp/yt-dlp"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold text-white/40 hover:text-white/70 transition-colors cursor-pointer"
                        >
                            yt-dlp
                        </a>
                    </div>
                </div>
            </div>

            {/* Settings Modal */}
            <Settings
                isOpen={showSettings}
                onClose={() => setShowSettings(false)}
            />
        </div >
    );
}
