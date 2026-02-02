import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Download, Loader, Eye, Music, Film, Check, Play, List, User, Search, X, CheckSquare, Square, Disc, Clipboard as ClipboardIcon, Sparkles, Key, Settings as SettingsIcon, Image as ImageIcon, Link2, FolderOpen, ShieldCheck, Globe, Monitor, FileText, ChevronRight, ArrowRight, Layers, Pause, PlayCircle, Trash2, CheckCircle2
} from 'lucide-react';
import { FaTiktok, FaSpotify, FaXTwitter, FaYoutube, FaInstagram, FaFacebook, FaPinterest, FaSoundcloud, FaSnapchat } from 'react-icons/fa6';
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

type PlatformId = 'youtube' | 'instagram' | 'tiktok' | 'facebook' | 'spotify' | 'x' | 'pinterest' | 'soundcloud' | 'snapchat';

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
    { id: 'snapchat', name: 'Snapchat', icon: <FaSnapchat size={22} />, color: '#FFFC00', bgClass: 'bg-yellow-400' },
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


    // Initial load
    const [downloading, setDownloading] = useState(false);
    const [downloadingId, setDownloadingId] = useState<string | null>(null);
    const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
    const [progress, setProgress] = useState<{ percent: number; speed?: string; eta?: string; downloaded?: string } | null>(null);
    const [complete, setComplete] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [downloadedFilePath, setDownloadedFilePath] = useState<string | null>(null);

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

    // Batch download features
    const [batchMode, setBatchMode] = useState(false);
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
            mode: 'video' as const
        }));

        setDownloadQueue(queue);
        setCurrentBatchIndex(0);
        setBatchDownloading(true);
        batchStateRef.current = { downloading: true, index: 0 };
        setError(null);

        // Allow state to settle
        setTimeout(() => processBatchQueue(0), 0);
    };

    const toggleItemMode = (id: string, mode: 'video' | 'audio') => {
        setDownloadQueue(prev => prev.map(item =>
            item.id === id && item.status === 'pending'
                ? { ...item, mode }
                : item
        ));
    };

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
                                if (isSpotify && metadata.searchQuery) {
                                    await window.electron.downloadSpotifyTrack({
                                        searchQuery: metadata.searchQuery,
                                        title: metadata.title,
                                        artist: metadata.uploader || 'Unknown',
                                        thumbnail: metadata.thumbnail
                                    });
                                } else {
                                    await window.electron.downloadVideo({
                                        url: currentItem.url,
                                        formatId,
                                        title,
                                        platform: currentPlatform.id,
                                        thumbnail: metadata.thumbnail
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

    const removeFromQueue = (id: string) => {
        setDownloadQueue(prev => prev.filter(q => q.id !== id));
    };

    // Check cookies when platform changes
    useEffect(() => {
        setHasCookies(false);
        if (['instagram', 'facebook', 'youtube', 'tiktok', 'snapchat'].includes(currentPlatform.id)) {
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
                    if (data.path) setDownloadedFilePath(data.path);
                }
            } else if (data.status) {
                // Only show speed for single downloads or if specifically desired
                if (!isBatchActive && !downloading) {
                    setProgress(prev => ({ ...(prev || { percent: 0 }), speed: data.status }));
                }
            } else if (data.percent !== undefined) {
                if (isBatchActive) {
                    // Update current batch item progress
                    setDownloadQueue(prev => prev.map((q, idx) =>
                        idx === index ? { ...q, progress: data.percent } : q
                    ));
                } else {
                    setProgress({
                        percent: data.percent,
                        speed: data.currentSpeed,
                        eta: data.eta,
                        downloaded: data.downloaded
                    });
                }
            }
        };
        window.electron.onProgress(handler);
        return () => window.electron.offProgress?.();
    }, []); // Empty dependency array to prevent listener re-binding

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
            'soundcloud': ['soundcloud.com'],
            'snapchat': ['snapchat.com']
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
        setDownloadedFilePath(null);
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
    const handleDownload = useCallback(async (formatId: string, videoUrl?: string, videoTitle?: string, itemId?: string, playlistTitle?: string) => {
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
                title: targetTitle,
                thumbnail: metadata?.thumbnail,
                playlistTitle
            });
        } catch (err: any) {
            setError(err.message);
            setDownloading(false);
            setDownloadingId(null);
            setProgress(null);
        }
    }, [metadata, downloading, url]);

    // Spotify track download (via YouTube)
    const handleSpotifyDownload = useCallback(async (searchQuery: string, title: string, artist: string, itemId?: string, playlistTitle?: string) => {
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
                thumbnail: metadata?.thumbnail,
                playlistTitle
            });
        } catch (err: any) {
            setError(err.message);
            setDownloading(false);
            setDownloadingId(null);
            setProgress(null);
        }
    }, [downloading, metadata]);

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

    const isPlaylist = metadata &&
        (metadata.contentType === 'playlist' || (metadata.contentType === 'story' && (metadata.entries?.length || 0) > 1)) &&
        metadata.entries &&
        metadata.entries.length > 0;

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

                if (isSpotify) {
                    await window.electron.downloadSpotifyTrack({
                        searchQuery: item.searchQuery || `${item.title} ${item.artist || ''}`,
                        title: item.title,
                        artist: item.artist || '',
                        thumbnail: item.thumbnail,
                        playlistTitle // This will create the /playlists/{title}/ folder
                    });
                } else {
                    await window.electron.downloadVideo({
                        url: item.url,
                        formatId: formatId,
                        title: item.title,
                        platform: currentPlatform.id,
                        playlistTitle // This will create the /playlists/{title}/ folder
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

                {/* Batch Mode Toggle */}
                <div className="flex justify-center mb-6">
                    <button
                        onClick={() => {
                            setBatchMode(!batchMode);
                            if (batchMode) {
                                setBatchUrls('');
                                setDownloadQueue([]);
                            }
                        }}
                        className={`px-4 py-2 rounded-xl font-medium text-sm transition-all cursor-pointer flex items-center gap-2 ${batchMode
                            ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                            : 'bg-white/5 text-white/60 hover:bg-white/10 border border-white/10'
                            }`}
                    >
                        <Layers className="w-4 h-4" />
                        {batchMode ? 'Batch Mode' : 'Single Mode'}
                    </button>
                </div>

                {!batchMode ? (
                    <form onSubmit={handleSubmit} className="mb-8 w-full max-w-xl mx-auto">
                        <div className="flex flex-col sm:flex-row gap-2.5 relative z-20">
                            <div className="flex-1 relative group">
                                {/* Minimalism Premium Glow */}
                                <div className="absolute -inset-0.5 bg-gradient-to-r from-white/0 via-white/5 to-white/0 rounded-xl blur-lg opacity-0 group-hover:opacity-100 transition-all duration-500" />

                                <div className="relative">
                                    {/* The Glass Base */}
                                    <div className="absolute inset-0 bg-[#0a0a0b]/40 backdrop-blur-lg rounded-xl border border-white/5 group-hover:border-white/10 group-focus-within:border-white/20 transition-all duration-300" />

                                    <div className="relative flex items-center h-14 sm:h-15">
                                        <div className="pl-5 pointer-events-none">
                                            <Search className="w-4 h-4 text-white/20 group-focus-within:text-white/40 transition-all duration-300" />
                                        </div>

                                        <input
                                            type="text"
                                            value={url}
                                            onChange={(e) => setUrl(e.target.value)}
                                            placeholder={isSpotify ? 'Drop link...' : `Paste link here...`}
                                            disabled={loading || downloading}
                                            className="w-full h-full pl-3 pr-36 bg-transparent text-white placeholder-white/10 outline-none font-medium text-sm tracking-tight disabled:opacity-50 transition-all"
                                        />

                                        {/* Action Group Inside Input */}
                                        <div className="absolute right-2 flex items-center gap-1.5">
                                            {['instagram', 'facebook', 'youtube', 'tiktok', 'snapchat'].includes(currentPlatform.id) && (
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
                                                        setUrl(text);
                                                    } catch (e) {
                                                        console.log('Clipboard access denied');
                                                    }
                                                }}
                                                disabled={loading || downloading}
                                                className="h-9 px-4 bg-white/[0.02] hover:bg-white/[0.06] border border-white/5 rounded-lg text-[9px] font-bold uppercase tracking-wider text-white/30 hover:text-white transition-all cursor-pointer disabled:opacity-30 active:scale-95"
                                            >
                                                Paste
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={!url || loading || downloading}
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

                                <div className="space-y-3 max-h-[500px] overflow-y-auto custom-scrollbar pr-1">
                                    <AnimatePresence>
                                        {downloadQueue.map((item, index) => (
                                            <motion.div
                                                key={item.id}
                                                layout
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, scale: 0.95 }}
                                                className={`relative overflow-hidden group rounded-xl border transition-all duration-300 ${item.status === 'completed'
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
                                                            <div className="mt-3 w-full bg-white/10 rounded-full h-1 overflow-hidden">
                                                                <div
                                                                    className="h-full bg-blue-500 rounded-full transition-all duration-300"
                                                                    style={{ width: `${item.progress}%` }}
                                                                />
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Actions & Toggles */}
                                                    <div className="flex items-center gap-2">
                                                        {/* A/V Toggle - Only active if pending */}
                                                        <div className={`flex bg-black/20 rounded-lg p-0.5 border border-white/5 ${item.status !== 'pending' ? 'opacity-50 pointer-events-none' : ''}`}>
                                                            <button
                                                                onClick={() => toggleItemMode(item.id, 'video')}
                                                                className={`px-2 py-1.5 rounded-md text-[10px] font-bold uppercase transition-all cursor-pointer ${item.mode === 'video' ? 'bg-blue-500 text-white shadow-sm' : 'text-white/40 hover:text-white/60'
                                                                    }`}
                                                            >
                                                                Video
                                                            </button>
                                                            <button
                                                                onClick={() => toggleItemMode(item.id, 'audio')}
                                                                className={`px-2 py-1.5 rounded-md text-[10px] font-bold uppercase transition-all cursor-pointer ${item.mode === 'audio' ? 'bg-green-500 text-white shadow-sm' : 'text-white/40 hover:text-white/60'
                                                                    }`}
                                                            >
                                                                Audio
                                                            </button>
                                                        </div>

                                                        {/* Action Buttons */}
                                                        {item.status === 'failed' && (
                                                            <button
                                                                onClick={async () => {
                                                                    const itemIndex = downloadQueue.findIndex(q => q.id === item.id);
                                                                    if (itemIndex >= 0) {
                                                                        setDownloadQueue(prev => prev.map(q =>
                                                                            q.id === item.id ? { ...q, status: 'pending', error: undefined } : q
                                                                        ));
                                                                        if (!batchDownloading) {
                                                                            setBatchDownloading(true);
                                                                            // Small delay to ensure state updates before processing
                                                                            setTimeout(() => processBatchQueue(itemIndex), 50);
                                                                        }
                                                                    }
                                                                }}
                                                                className="p-2 rounded-lg bg-white/5 hover:bg-green-500/20 text-white/40 hover:text-green-400 transition ml-2 border border-transparent hover:border-green-500/20 cursor-pointer"
                                                                title="Retry"
                                                            >
                                                                <PlayCircle className="w-4 h-4" />
                                                            </button>
                                                        )}

                                                        {item.status !== 'downloading' && item.status !== 'processing' && (
                                                            <button
                                                                onClick={() => removeFromQueue(item.id)}
                                                                className="p-2 rounded-lg bg-white/5 hover:bg-red-500/20 text-white/40 hover:text-red-400 transition ml-1 border border-transparent hover:border-red-500/20 cursor-pointer"
                                                                title="Remove"
                                                            >
                                                                <Trash2 className="w-4 h-4" />
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            </motion.div>
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
                                    <div className="absolute inset-0 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center">
                                        <CircularProgress percent={progress?.percent || 0} color={currentPlatform.color} />
                                        <div className="mt-4 space-y-1">
                                            <p className="text-white font-bold text-base">
                                                {progress?.speed && progress.speed !== '...' ? progress.speed : 'Starting...'}
                                            </p>
                                            <div className="flex items-center justify-center gap-2 text-white/50 text-xs text-center">
                                                {progress?.downloaded && progress.downloaded !== '...' && <span>{progress.downloaded}</span>}
                                                {progress?.eta && progress.eta !== '...' && <span>• {progress.eta} left</span>}
                                            </div>
                                        </div>
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
                                        <ImageIcon className="w-5 h-5 text-white/60" />
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

                                    {/* Audio Options */}
                                    {!isSpotify && (
                                        <div className="mb-4">
                                            <h3 className="text-sm font-bold text-white/50 mb-2 pl-1 flex items-center gap-2">
                                                <Music className="w-4 h-4" /> Audio Only
                                            </h3>
                                            <div className="space-y-2">
                                                <button onClick={() => handleDownload('audio_best')} disabled={downloading} className="w-full flex items-center justify-between p-3.5 bg-white/5 border border-white/10 rounded-xl cursor-pointer hover:bg-white/8 transition group disabled:opacity-40">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-9 h-9 rounded-lg bg-green-500/20 flex items-center justify-center"><Music className="w-4 h-4 text-green-400" /></div>
                                                        <div className="text-left"><p className="font-medium text-sm">Audio (Best)</p><p className="text-xs text-white/40">~320kbps • High Quality</p></div>
                                                    </div>
                                                    <Download className="w-4 h-4 text-white/30 group-hover:text-white/60" />
                                                </button>
                                                <button onClick={() => handleDownload('audio_standard')} disabled={downloading} className="w-full flex items-center justify-between p-3.5 bg-white/5 border border-white/10 rounded-xl cursor-pointer hover:bg-white/8 transition group disabled:opacity-40">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-9 h-9 rounded-lg bg-green-500/10 flex items-center justify-center"><Music className="w-4 h-4 text-green-400/80" /></div>
                                                        <div className="text-left"><p className="font-medium text-sm">Audio (Standard)</p><p className="text-xs text-white/40">~128kbps • Balanced</p></div>
                                                    </div>
                                                    <Download className="w-4 h-4 text-white/30 group-hover:text-white/60" />
                                                </button>
                                                <button onClick={() => handleDownload('audio_low')} disabled={downloading} className="w-full flex items-center justify-between p-3.5 bg-white/5 border border-white/10 rounded-xl cursor-pointer hover:bg-white/8 transition group disabled:opacity-40">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-9 h-9 rounded-lg bg-yellow-500/10 flex items-center justify-center"><Music className="w-4 h-4 text-yellow-400" /></div>
                                                        <div className="text-left"><p className="font-medium text-sm">Audio (Low)</p><p className="text-xs text-white/40">~64kbps • Save Data</p></div>
                                                    </div>
                                                    <Download className="w-4 h-4 text-white/30 group-hover:text-white/60" />
                                                </button>
                                            </div>
                                        </div>
                                    )}


                                    {/* Video Options */}
                                    {!isSpotify && formats.length > 0 && (
                                        <div>
                                            <h3 className="text-sm font-bold text-white/50 mb-2 pl-1 flex items-center gap-2">
                                                <Film className="w-4 h-4" /> Video Quality
                                            </h3>
                                            <div className="space-y-2">
                                                {formats.map((f, i) => (
                                                    <button key={i} onClick={() => handleDownload(f.format_id)} disabled={downloading} className="w-full flex items-center justify-between p-3.5 bg-white/5 border border-white/10 rounded-xl cursor-pointer hover:bg-white/8 transition group disabled:opacity-40">
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
                                    )}
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
                                                        onClick={() => handleSpotifyDownload(entry.searchQuery!, entry.title, entry.artist || (metadata?.uploader || 'Unknown'), entry.id, metadata?.title)}
                                                        disabled={downloading}
                                                        className="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center cursor-pointer hover:bg-green-500/30 transition disabled:opacity-40"
                                                        title="Download MP3"
                                                    >
                                                        <Music className="w-4 h-4 text-green-400" />
                                                    </button>
                                                ) : (
                                                    <>
                                                        <button
                                                            onClick={() => handleDownload('audio_best', entry.url, entry.title, entry.id, metadata?.title)}
                                                            disabled={downloading}
                                                            className="w-7 h-7 rounded-lg bg-green-500/20 flex items-center justify-center cursor-pointer hover:bg-green-500/30 transition disabled:opacity-40"
                                                            title="Download Audio"
                                                        >
                                                            <Music className="w-3.5 h-3.5 text-green-400" />
                                                        </button>
                                                        <button
                                                            onClick={() => handleDownload('best', entry.url, entry.title, entry.id, metadata?.title)}
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
                            <div className="w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6 relative">
                                <div className="absolute inset-0 rounded-full animate-ping opacity-20" style={{ backgroundColor: currentPlatform.color }} />
                                <div className="relative w-full h-full rounded-full flex items-center justify-center" style={{ backgroundColor: currentPlatform.color }}>
                                    <Check className={`w-12 h-12 ${['x', 'tiktok'].includes(currentPlatform.id) ? 'text-black' : 'text-white'}`} />
                                </div>
                            </div>
                            <h2 className="text-3xl font-bold mb-2">Download Complete!</h2>
                            <p className="text-white/40 mb-8 max-w-sm mx-auto">
                                <span className="text-white">{metadata?.title}</span> has been saved to your {isSpotify ? 'Music' : 'Downloads'} folder.
                            </p>

                            <div className="flex flex-col sm:flex-row gap-3 justify-center mb-8">
                                <button
                                    onClick={() => {
                                        // Use the path from the progress event if available, or request it?
                                        // The backend sends 'path' in the 'complete' event. 
                                        // We need to store it in state.
                                        // Use specific downloaded path if available
                                        if (downloadedFilePath) {
                                            window.electron.openInFolder(downloadedFilePath);
                                        } else {
                                            window.electron.chooseDownloadFolder().then(res => {
                                                if (res.path) window.electron.openInFolder(res.path);
                                                else if (metadata) window.electron.openInFolder(metadata.title);
                                            });
                                        }
                                    }}
                                    className="h-12 px-6 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl font-semibold flex items-center justify-center gap-2 transition cursor-pointer"
                                >
                                    <FolderOpen className="w-5 h-5 text-blue-400" />
                                    Show in Folder
                                </button>

                                <button
                                    onClick={() => {
                                        // Logic to open/play the file directly?
                                        // For now, let's stick to "Download Another" as the primary "Reset" action,
                                        // and maybe a "Open" button if we know the path.
                                        setComplete(false); setMetadata(null); setUrl('');
                                    }}
                                    className="h-12 px-8 bg-white text-black rounded-xl font-bold cursor-pointer hover:bg-white/90 transition flex items-center justify-center gap-2"
                                >
                                    <Download className="w-5 h-5" />
                                    Download Another
                                </button>
                            </div>
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
                                        <ClipboardIcon className="w-5 h-5 text-purple-400" />
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
                                        <p className="mb-2 font-bold flex items-center gap-2">
                                            <ShieldCheck className="w-4 h-4" /> Secure & Local
                                        </p>
                                        <p className="opacity-80 leading-relaxed text-xs font-medium">
                                            Your privacy is our priority. Cookies are stored exclusively on your local machine and are used solely to authenticate downloads from restricted or private sources. We do not track, store, or transmit any sensitive data.
                                        </p>
                                    </div>

                                    {!hasCookies ? (
                                        <div className="space-y-6">
                                            <div className="grid grid-cols-1 gap-4">
                                                {/* Step 1 */}
                                                <div className="flex gap-4 p-4 rounded-2xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.05] transition-colors group">
                                                    <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0 border border-blue-500/20 group-hover:scale-110 transition-transform">
                                                        <Download className="w-5 h-5 text-blue-400" />
                                                    </div>
                                                    <div>
                                                        <h4 className="text-sm font-bold text-white mb-1">Step 1: Get Cookie Editor</h4>
                                                        <p className="text-[11px] text-white/40 mb-3 leading-relaxed">Install the editor for your browser to export login data.</p>
                                                        <div className="flex flex-wrap gap-2">
                                                            <button
                                                                onClick={() => window.electron.openExternal("https://chromewebstore.google.com/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm")}
                                                                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-[10px] font-bold text-white flex items-center gap-1.5 transition-colors cursor-pointer"
                                                            >
                                                                <Globe className="w-3 h-3" /> For Chrome
                                                            </button>
                                                            <button
                                                                onClick={() => window.electron.openExternal("https://microsoftedge.microsoft.com/addons/detail/cookieeditor/neaplmfkghagebokkhpjpoebhdledlfi")}
                                                                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-[10px] font-bold text-white flex items-center gap-1.5 transition-colors cursor-pointer"
                                                            >
                                                                <Monitor className="w-3 h-3" /> For Edge
                                                            </button>
                                                            <button
                                                                onClick={() => window.electron.openExternal("https://addons.mozilla.org/en-US/firefox/addon/cookie-editor/")}
                                                                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-[10px] font-bold text-white flex items-center gap-1.5 transition-colors cursor-pointer"
                                                            >
                                                                <Globe className="w-3 h-3" /> For Firefox
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Step 2 */}
                                                <div className="flex gap-4 p-4 rounded-2xl bg-white/[0.03] border border-white/5">
                                                    <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center shrink-0 border border-purple-500/20">
                                                        <Globe className="w-5 h-5 text-purple-400" />
                                                    </div>
                                                    <div>
                                                        <h4 className="text-sm font-bold text-white mb-1">Step 2: Sign In</h4>
                                                        <p className="text-[11px] text-white/40 leading-relaxed">Open <span className="text-white font-bold">{currentPlatform.name}</span> in your browser and ensure you are logged in.</p>
                                                    </div>
                                                </div>

                                                {/* Step 3 */}
                                                <div className="flex gap-4 p-4 rounded-2xl bg-white/[0.03] border border-white/5">
                                                    <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0 border border-amber-500/20">
                                                        <FileText className="w-5 h-5 text-amber-400" />
                                                    </div>
                                                    <div>
                                                        <h4 className="text-sm font-bold text-white mb-1">Step 3: Export as <span className="text-amber-400 uppercase tracking-wider">Netscape</span></h4>
                                                        <p className="text-[11px] text-white/40 leading-relaxed">Click extension &rsaquo; Export &rsaquo; Select <span className="text-white font-bold text-[12px]">Netscape</span> format.</p>
                                                    </div>
                                                    <div className="ml-auto animate-pulse">
                                                        <ChevronRight className="w-4 h-4 text-white/20" />
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="space-y-3">
                                                <div className="flex items-center justify-between ml-1">
                                                    <label className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">Paste Content Below</label>
                                                    <button
                                                        onClick={handleCookieFileUpload}
                                                        className="text-[10px] font-bold text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1 cursor-pointer"
                                                    >
                                                        <FolderOpen className="w-3 h-3" />
                                                        Upload .txt File
                                                    </button>
                                                </div>
                                                <textarea
                                                    value={cookieContent}
                                                    onChange={(e) => setCookieContent(e.target.value)}
                                                    placeholder="# Netscape HTTP Cookie File..."
                                                    className="w-full h-32 bg-white/[0.03] border border-white/10 rounded-2xl p-4 text-[11px] text-white/70 font-mono outline-none focus:border-blue-500/30 focus:bg-white/[0.05] transition-all resize-none shadow-inner"
                                                />
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="text-center py-6">
                                            <div className="relative w-20 h-20 mx-auto mb-6">
                                                <div className="absolute inset-0 bg-green-500/20 blur-2xl rounded-full animate-pulse" />
                                                <div className="relative w-20 h-20 bg-green-500/10 border border-green-500/20 rounded-3xl flex items-center justify-center mx-auto transition-transform hover:scale-110 duration-500">
                                                    <ShieldCheck className="w-10 h-10 text-green-400" />
                                                </div>
                                            </div>
                                            <h3 className="text-2xl font-black text-white mb-2 tracking-tight">Vault Secured</h3>
                                            <p className="text-white/40 text-sm max-w-xs mx-auto mb-8 font-medium">
                                                Your cookies are active. Stories and private content are now unlocked for <span className="text-white font-bold">{currentPlatform.name}</span>.
                                            </p>

                                            <div className="bg-white/[0.03] rounded-2xl p-5 border border-white/5 text-left group">
                                                <div className="flex items-center justify-between mb-4">
                                                    <p className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">Update Vault</p>
                                                    <button
                                                        onClick={handleCookieFileUpload}
                                                        className="text-[10px] font-bold text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1 cursor-pointer"
                                                    >
                                                        <FolderOpen className="w-3 h-3" />
                                                        Upload .txt File
                                                    </button>
                                                </div>
                                                <p className="text-[11px] text-white/40 mb-3 font-medium">If downloads fail, your session may have expired. Paste a new <span className="font-bold text-white/60">Netscape</span> file below:</p>
                                                <textarea
                                                    value={cookieContent}
                                                    onChange={(e) => setCookieContent(e.target.value)}
                                                    placeholder="Paste new Netscape content..."
                                                    className="w-full h-24 bg-black/40 border border-white/10 rounded-xl p-3 text-[11px] text-white/70 font-mono outline-none focus:border-white/20 resize-none transition-all group-focus-within:bg-black/60 shadow-inner"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="flex gap-4 sticky bottom-0 bg-[#111] pt-4 border-t border-white/5">
                                    {hasCookies && (
                                        <button
                                            onClick={handleDeleteCookies}
                                            className="px-6 h-12 border border-red-500/30 text-red-500 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-red-500/10 transition-all cursor-pointer active:scale-95"
                                        >
                                            Purge
                                        </button>
                                    )}
                                    <button
                                        onClick={handleSaveCookies}
                                        disabled={!cookieContent.trim()}
                                        className={`flex-1 h-12 rounded-2xl font-black text-xs uppercase tracking-[0.2em] transition-all cursor-pointer active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed
                                            ${hasCookies
                                                ? 'bg-white/10 text-white hover:bg-white/20 border border-white/10'
                                                : 'bg-white text-black shadow-xl shadow-white/5 hover:bg-white/90'
                                            }`}
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
