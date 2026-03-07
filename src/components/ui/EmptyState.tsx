import React, { useMemo, memo } from 'react';
import { motion } from 'framer-motion';
import {
    Sparkles,
    Download,
    Link2,
    Clipboard,
    Youtube,
    Instagram,
    Facebook,
    Twitter,
    Pin,
    Ghost
} from 'lucide-react';
import { FaSpotify, FaTiktok, FaSoundcloud } from 'react-icons/fa6';

interface EmptyStateProps {
    currentPlatform: {
        id: string;
        name: string;
        color: string;
    };
    hasCookies: boolean;
}

const EmptyState: React.FC<EmptyStateProps> = memo(({ currentPlatform, hasCookies }) => {
    // Platform Data Configuration
    const platformData: Record<string, any> = useMemo(() => ({
        youtube: {
            title: 'YouTube Downloader',
            subtitle: 'Shorts, Long Videos & Playlists',
            features: ['🎬 Videos', '🎞️ Shorts', '📋 Playlists', '🎵 Music'],
            icon: <Youtube className="w-12 h-12" />,
            color: '#FF0000'
        },
        spotify: {
            title: 'Spotify Downloader',
            subtitle: 'Music, Lossless & Hi-Res',
            features: ['🎵 Music', '📀 Lossless', '💎 Hi-Res', '📋 Playlists'],
            icon: <FaSpotify className="w-12 h-12" />,
            color: '#1DB954'
        },
        soundcloud: {
            title: 'SoundCloud Downloader',
            subtitle: 'Tracks & Playlists',
            features: ['🎵 Tracks', '📋 Playlists', '🔥 Artists', '🎧 HQ Stream'],
            icon: <FaSoundcloud className="w-12 h-12" />,
            color: '#FF5500'
        },
        instagram: {
            title: 'Instagram Downloader',
            subtitle: 'Reels, Posts & Stories',
            features: ['🎬 Reels', '📷 Posts', '📖 Stories', '🖼️ Photos'],
            icon: <Instagram className="w-12 h-12" />,
            color: '#E4405F'
        },
        tiktok: {
            title: 'TikTok Downloader',
            subtitle: 'Videos & Sounds',
            features: ['🎬 Videos', '🎵 Sounds', '🎥 No Mark', '🚀 Fast'],
            icon: <FaTiktok className="w-12 h-12" />,
            color: '#00F2EA'
        },
        facebook: {
            title: 'Facebook Downloader',
            subtitle: 'Videos & Stories',
            features: ['📹 Reels', '📖 Stories', '🔒 Private', '⚡ HD'],
            icon: <Facebook className="w-12 h-12" />,
            color: '#1877F2'
        },
        x: {
            title: 'X Downloader',
            subtitle: 'Videos & Photos',
            features: ['🎬 4K Video', '🖼️ HD Photos', '🏃 Fast Sync', '📂 GIFs'],
            icon: <Twitter className="w-12 h-12" />,
            color: '#FFFFFF'
        },
        pinterest: {
            title: 'Pinterest Downloader',
            subtitle: 'Pins & Videos',
            features: ['📌 Pins', '🎬 Videos', '🖼️ HD', '🎨 Save'],
            icon: <Pin className="w-12 h-12" />,
            color: '#E60023'
        },
        snapchat: {
            title: 'Snapchat Downloader',
            subtitle: 'Spotlights & Stories',
            features: ['👻 Stories', '🎬 Spotlights', '🖼️ Photos', '📂 Media'],
            icon: <Ghost className="w-12 h-12" />,
            color: '#FFFC00'
        }
    }), []);

    const data = useMemo(() => {
        return platformData[currentPlatform.id] || {
            title: 'VibeDownloader',
            subtitle: 'The Elite Downloader',
            features: ['🎬 Video', '🎵 Audio', '📸 Photos', '📂 Files'],
            icon: <Sparkles className="w-12 h-12" />,
            color: '#A855F7'
        };
    }, [currentPlatform.id, platformData]);

    const stepVariants: any = {
        hidden: { opacity: 0, y: 20, scale: 0.95 },
        visible: (i: number) => ({
            opacity: 1,
            y: 0,
            scale: 1,
            transition: {
                delay: i * 0.1,
                duration: 0.5
            }
        })
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="w-full max-w-xl mx-auto flex flex-col items-center py-4 hardware-accelerated"
        >
            {/* Hero Section */}
            <div className="relative mb-8 flex flex-col items-center w-full">
                {/* Optimized Background Gradient (No Blur Filter) */}
                <div
                    className="absolute inset-x-0 -top-20 h-64 pointer-events-none opacity-20 transition-all duration-500"
                    style={{
                        background: `radial-gradient(circle at center, ${data.color}20 0%, transparent 70%)`
                    }}
                />

                {/* Animated Display Area */}
                <div className="relative w-32 h-32 flex items-center justify-center mb-6">
                    {/* Pulsing Light */}
                    <motion.div
                        animate={{ opacity: [0.05, 0.12, 0.05] }}
                        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                        className="absolute inset-0 rounded-full"
                        style={{ backgroundColor: data.color }}
                    />

                    {/* Outer Rotating Ring */}
                    <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
                        className="absolute inset-0 rounded-full border border-dashed opacity-20 will-change-transform"
                        style={{ borderColor: data.color }}
                    />

                    {/* Inner Rotating Ring */}
                    <motion.div
                        animate={{ rotate: -360 }}
                        transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                        className="absolute inset-4 rounded-full border opacity-30 bg-white/[0.01] will-change-transform"
                        style={{ borderColor: data.color }}
                    />

                    {/* Static Center Icon (Not Tilted) */}
                    <div
                        className="relative z-10 flex items-center justify-center hardware-accelerated"
                        style={{ color: data.color }}
                    >
                        {data.icon}
                    </div>
                </div>

                <h2 className="text-2xl font-black text-white mb-2 tracking-tight">
                    {data.title}
                </h2>
                <p className="text-white/40 text-sm font-medium">
                    {data.subtitle}
                </p>
            </div>

            {/* How to Download Section */}
            <div className="w-full space-y-3 mb-8">
                <p className="text-white/20 text-[10px] font-black uppercase tracking-[0.2em] text-center mb-4">How to Download</p>

                {[
                    {
                        icon: <Link2 className="w-5 h-5 text-blue-400" />,
                        title: 'Copy the link',
                        desc: `Copy the media URL from ${currentPlatform.name}`,
                    },
                    {
                        icon: <Clipboard className="w-5 h-5 text-purple-400" />,
                        title: 'Paste it above',
                        desc: 'Use the Paste button or manual input',
                    },
                    {
                        icon: <Download className="w-5 h-5 text-green-400" />,
                        title: 'Choose & download',
                        desc: 'Select quality and start downloading',
                    }
                ].map((step, i) => (
                    <motion.div
                        key={i}
                        custom={i}
                        variants={stepVariants}
                        initial="hidden"
                        animate="visible"
                        className="flex items-center gap-4 p-4 bg-white/[0.03] border border-white/[0.06] rounded-2xl group hover:bg-white/[0.05] transition-all hardware-accelerated"
                    >
                        <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border border-white/5 bg-white/[0.02]">
                            <div className="opacity-80 group-hover:scale-110 transition-transform">
                                {step.icon}
                            </div>
                        </div>
                        <div className="flex-1">
                            <p className="font-bold text-sm text-white">{step.title}</p>
                            <p className="text-xs text-white/40">{step.desc}</p>
                        </div>
                        <div className="w-6 h-6 rounded-full bg-white/5 flex items-center justify-center text-white/20 text-[10px] font-black">
                            {i + 1}
                        </div>
                    </motion.div>
                ))}
            </div>

            {/* Supported Content Chips */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="w-full p-6 bg-white/[0.02] border border-white/[0.05] rounded-3xl"
            >
                <div className="flex items-center gap-2 mb-4">
                    <Sparkles className="w-3.5 h-3.5 text-yellow-400/60" />
                    <span className="text-[10px] font-black text-white/30 uppercase tracking-[0.15em]">Supported Content</span>
                </div>
                <div className="flex flex-wrap gap-2">
                    {data.features.map((feature: string, i: number) => (
                        <div key={i} className="px-3 py-2 bg-white/[0.04] border border-white/[0.06] rounded-xl text-[11px] font-bold text-white/50 hover:text-white/80 hover:bg-white/10 transition-all cursor-default">
                            {feature}
                        </div>
                    ))}
                </div>
                {['instagram', 'facebook', 'youtube', 'tiktok'].includes(currentPlatform.id) && !hasCookies && (
                    <div className="mt-4 pt-4 border-t border-white/[0.03] flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                        <p className="text-[10px] font-medium text-white/30 italic">
                            Stories & private content require login (Click key icon)
                        </p>
                    </div>
                )}
            </motion.div>
        </motion.div>
    );
});

export default EmptyState;
