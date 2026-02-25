import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Sparkles,
    FolderOpen,
    Youtube,
    Music,
    Video,
    ShieldCheck,
    Star,
    ArrowRight,
    ExternalLink,
    Zap,
    Download,
    Disc
} from 'lucide-react';

interface OnboardingProps {
    onComplete: () => void;
}

const steps = [
    {
        id: 'welcome',
        icon: <Sparkles className="w-16 h-16 text-purple-400" />,
        title: "VibeDownloader",
        subtitle: "The Elite Downloader",
        description: "Experience the most premium way to archive your digital life. Sleek, fast, and powerful.",
        color: "from-purple-500 via-indigo-500 to-blue-500",
        accent: "purple"
    },
    {
        id: 'features',
        icon: <Zap className="w-16 h-16 text-amber-400" />,
        title: "Supreme Quality",
        subtitle: "Uncompromised Resolution",
        description: "Download 4K HDR videos and Hi-Res audio from YouTube, Instagram, TikTok and 1000+ sites.",
        color: "from-amber-400 to-orange-600",
        accent: "amber",
        extra: (
            <div className="flex gap-6 mt-8 justify-center">
                <div className="flex flex-col items-center gap-3 group">
                    <div className="p-4 rounded-2xl bg-white/5 border border-white/10 group-hover:bg-white/10 group-hover:border-blue-400/30 transition-all duration-300">
                        <Video className="w-6 h-6 text-blue-400" />
                    </div>
                    <span className="text-[10px] uppercase tracking-widest text-white/40 font-bold">4K Video</span>
                </div>
                <div className="flex flex-col items-center gap-3 group">
                    <div className="p-4 rounded-2xl bg-white/5 border border-white/10 group-hover:bg-white/10 group-hover:border-green-400/30 transition-all duration-300">
                        <Music className="w-6 h-6 text-green-400" />
                    </div>
                    <span className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Hi-Res Audio</span>
                </div>
                <div className="flex flex-col items-center gap-3 group">
                    <div className="p-4 rounded-2xl bg-white/5 border border-white/10 group-hover:bg-white/10 group-hover:border-red-400/30 transition-all duration-300">
                        <Youtube className="w-6 h-6 text-red-500" />
                    </div>
                    <span className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Playlists</span>
                </div>
            </div>
        )
    },
    {
        id: 'spotify-lossless',
        icon: <Disc className="w-16 h-16 text-cyan-400" />,
        title: "Lossless Spotify",
        subtitle: "Audiophile-Grade Audio",
        description: "The ultimate music experience. Automatically fetch 1411kbps FLAC audio directly from Tidal and Qobuz for your Spotify tracks.",
        color: "from-cyan-500 via-blue-500 to-purple-600",
        accent: "cyan",
        extra: (
            <div className="mt-8 p-6 rounded-3xl bg-white/[0.03] border border-white/10 flex items-center gap-6 max-w-sm mx-auto">
                <div className="flex -space-x-3">
                    <div className="w-12 h-12 rounded-2xl bg-[#1DB954] flex items-center justify-center border-4 border-[#08090d] shadow-2xl relative z-10">
                        <Music className="w-6 h-6 text-white" />
                    </div>
                    <div className="w-12 h-12 rounded-2xl bg-cyan-500 flex items-center justify-center border-4 border-[#08090d] shadow-2xl relative z-20">
                        <Disc className="w-6 h-6 text-white" />
                    </div>
                </div>
                <div className="text-left">
                    <p className="text-white font-bold text-sm">Spotify → HI-RES FLAC</p>
                    <p className="text-white/40 text-[10px] uppercase tracking-widest font-bold">100% Raw & Untouched</p>
                </div>
            </div>
        )
    },
    {
        id: 'organization',
        icon: <FolderOpen className="w-16 h-16 text-blue-400" />,
        title: "Cloud-Like Order",
        subtitle: "Smart Sorting Engine",
        description: "Your files are automatically organized into beautiful, platform-specific folders. No more mess.",
        color: "from-blue-500 to-cyan-500",
        accent: "blue"
    },
    {
        id: 'cookies',
        icon: <ShieldCheck className="w-16 h-16 text-emerald-400" />,
        title: "Private Access",
        subtitle: "Secure Cookie Vault",
        description: "Access private Instagram stories and restricted content securely. Your login data never leaves your machine.",
        color: "from-emerald-500 to-teal-500",
        accent: "emerald"
    },
    {
        id: 'opensource',
        icon: <Star className="w-16 h-16 text-white" />,
        title: "Community First",
        subtitle: "Free & Open Source",
        description: "Built for the community, by the community. Spread the vibe by starring us on GitHub!",
        color: "from-gray-600 to-gray-900",
        accent: "gray",
        extra: (
            <button
                onClick={() => window.electron.openExternal("https://github.com/naeem5877/vibedownloader-desktop")}
                className="mt-8 px-8 py-4 rounded-2xl bg-white text-black font-extrabold flex items-center gap-3 hover:scale-105 active:scale-95 transition-all duration-300 shadow-xl shadow-white/10 cursor-pointer"
            >
                <Star className="w-5 h-5 fill-black" />
                Star on GitHub
                <ExternalLink className="w-4 h-4 opacity-50" />
            </button>
        )
    }
];

export const Onboarding: React.FC<OnboardingProps> = ({ onComplete }) => {
    const [currentStep, setCurrentStep] = useState(0);
    const [direction, setDirection] = useState(1);

    const handleNext = () => {
        if (currentStep < steps.length - 1) {
            setDirection(1);
            setCurrentStep(prev => prev + 1);
        } else {
            onComplete();
        }
    };

    const handleBack = () => {
        if (currentStep > 0) {
            setDirection(-1);
            setCurrentStep(prev => prev - 1);
        }
    };

    const step = steps[currentStep];

    const variants = {
        enter: (direction: number) => ({
            x: direction > 0 ? 100 : -100,
            opacity: 0,
            scale: 0.95
        }),
        center: {
            zIndex: 1,
            x: 0,
            opacity: 1,
            scale: 1
        },
        exit: (direction: number) => ({
            zIndex: 0,
            x: direction < 0 ? 100 : -100,
            opacity: 0,
            scale: 0.95
        })
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#050505]/95 backdrop-blur-xl p-4 md:p-8 overflow-hidden"
        >
            {/* Ambient Background Glow - Simplified for performance */}
            <div className={`fixed inset-0 opacity-10 transition-all duration-1000 bg-gradient-to-br ${step.color} blur-[100px] pointer-events-none`} />

            <div className="w-full max-w-2xl bg-[#0a0b10] border border-white/10 rounded-[40px] shadow-[0_0_100px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col relative max-h-[90vh] transition-all duration-500">
                {/* Visual Accent Line */}
                <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${step.color} transition-all duration-500 z-50`} />

                {/* Main Content Area - Scrollable if content exceeds height */}
                <div className="relative z-10 flex flex-col flex-1 overflow-y-auto overflow-x-hidden scrollbar-none py-8 md:py-12">
                    <AnimatePresence mode="wait" custom={direction}>
                        <motion.div
                            key={step.id}
                            custom={direction}
                            variants={variants}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={{
                                x: { type: "spring", stiffness: 400, damping: 35 },
                                opacity: { duration: 0.25 },
                                scale: { duration: 0.25 }
                            }}
                            className="flex flex-col items-center justify-center min-h-full px-6 md:px-16 text-center will-change-transform"
                        >
                            {/* Icon Container with multi-layered glow */}
                            <div className="relative mb-8 md:mb-10 group shrink-0">
                                <div className={`absolute inset-0 bg-gradient-to-br ${step.color} opacity-30 blur-2xl group-hover:opacity-50 transition-opacity duration-700`} />
                                <div className="relative p-6 md:p-8 rounded-[32px] bg-white/[0.03] border border-white/10 shadow-2xl overflow-hidden">
                                    <div className="absolute inset-0 bg-white/5 opacity-50 group-hover:opacity-100 transition-opacity" />
                                    <div className="relative z-10 scale-90 md:scale-100">
                                        {step.icon}
                                    </div>
                                </div>
                                <div className="absolute -bottom-2 -right-2 bg-white/10 backdrop-blur-md border border-white/10 p-2 rounded-xl shadow-lg z-20">
                                    <Zap className={`w-3 h-3 md:w-4 md:h-4 text-white opacity-80`} />
                                </div>
                            </div>

                            <div className="space-y-1 mb-6 shrink-0">
                                <span className={`text-[9px] md:text-[10px] uppercase tracking-[0.3em] font-black text-white/30`}>
                                    {step.subtitle}
                                </span>
                                <h2 className="text-4xl md:text-6xl font-black text-white tracking-tighter leading-none py-1">
                                    {step.title}
                                </h2>
                            </div>

                            <p className="text-lg md:text-xl text-white/50 leading-relaxed font-medium max-w-md mb-2">
                                {step.description}
                            </p>

                            {step.extra && (
                                <motion.div
                                    initial={{ opacity: 0, y: 15 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.3, duration: 0.4 }}
                                    className="w-full"
                                >
                                    {step.extra}
                                </motion.div>
                            )}
                        </motion.div>
                    </AnimatePresence>
                </div>

                {/* Modern Navigation Controls - Fixed at bottom */}
                <div className="relative z-20 p-6 md:p-12 pt-0 bg-gradient-to-t from-[#0a0b10] via-[#0a0b10]/95 to-transparent flex flex-col gap-6 md:gap-8 shrink-0">
                    {/* Detailed Progress Bar */}
                    <div className="flex justify-center items-center gap-2.5">
                        {steps.map((s, index) => {
                            const isActive = index === currentStep;
                            const isPast = index < currentStep;
                            return (
                                <button
                                    key={s.id}
                                    onClick={() => {
                                        setDirection(index > currentStep ? 1 : -1);
                                        setCurrentStep(index);
                                    }}
                                    className={`relative h-1.5 rounded-full transition-all duration-500 group overflow-hidden ${isActive ? 'w-10 md:w-12 bg-white' : 'w-3 md:w-4 bg-white/10 hover:bg-white/30'
                                        }`}
                                >
                                    {isPast && (
                                        <div className="absolute inset-0 bg-white/20" />
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    <div className="flex gap-3 md:gap-4">
                        {currentStep > 0 && (
                            <button
                                onClick={handleBack}
                                className="h-14 md:h-16 px-6 md:px-8 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/5 text-white/60 font-bold transition-all duration-300 active:scale-95 flex items-center justify-center cursor-pointer text-sm md:text-base"
                            >
                                Back
                            </button>
                        )}

                        <button
                            onClick={handleNext}
                            className={`flex-1 group relative h-14 md:h-16 rounded-2xl flex items-center justify-center gap-2 md:gap-3 font-black text-base md:text-lg transition-all duration-300 active:scale-[0.98] cursor-pointer overflow-hidden
                                ${currentStep === steps.length - 1
                                    ? 'bg-white text-black shadow-[0_10px_30px_rgba(255,255,255,0.2)] hover:bg-white/90'
                                    : 'bg-white/[0.07] hover:bg-white/[0.12] text-white border border-white/10 shadow-xl'
                                }`}
                        >
                            <span className="relative z-10 flex items-center gap-2">
                                {currentStep === steps.length - 1 ? (
                                    <>Enter VibeDownloader <Download className="w-5 h-5" /></>
                                ) : (
                                    <>Continue <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" /></>
                                )}
                            </span>

                            {/* Animated Shine Effect - Simplified */}
                            <div
                                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full animate-shine"
                            />
                        </button>
                    </div>
                </div>
            </div>

            {/* Subtle Floating Elements - Hardware accelerated */}
            <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
                <motion.div
                    animate={{
                        y: [0, -30, 0],
                        x: [0, 20, 0],
                        opacity: [0.05, 0.1, 0.05]
                    }}
                    transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
                    className="absolute top-1/4 -left-20 w-[400px] h-[400px] rounded-full bg-blue-500/10 blur-[120px] will-change-transform"
                />
                <motion.div
                    animate={{
                        y: [0, 30, 0],
                        x: [0, -20, 0],
                        opacity: [0.05, 0.1, 0.05]
                    }}
                    transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
                    className="absolute bottom-1/4 -right-20 w-[400px] h-[400px] rounded-full bg-purple-500/10 blur-[120px] will-change-transform"
                />
            </div>
        </motion.div>
    );
};
