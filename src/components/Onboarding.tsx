import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Sparkles,
    FolderOpen,
    ChevronRight,
    Check,
    Youtube,
    Music,
    Video,
    ShieldCheck
} from 'lucide-react';

interface OnboardingProps {
    onComplete: () => void;
}

const steps = [
    {
        id: 'welcome',
        icon: <Sparkles className="w-16 h-16 text-purple-400" />,
        title: "Vibe Check Passed ✅",
        description: "Welcome to VibeDownloader. The premium way to download your favorite content.",
        color: "from-purple-500 to-indigo-500"
    },
    {
        id: 'features',
        icon: <Youtube className="w-16 h-16 text-red-400" />,
        title: "All Your Platforms",
        description: "Download seamlessly from YouTube, Instagram, TikTok, and more. Audio or Video, in the highest quality.",
        color: "from-red-500 to-pink-500",
        extra: (
            <div className="flex gap-4 mt-6 justify-center">
                <div className="flex flex-col items-center gap-2">
                    <div className="p-3 rounded-2xl bg-white/5 border border-white/10">
                        <Video className="w-6 h-6 text-blue-400" />
                    </div>
                    <span className="text-xs text-white/50">4K Video</span>
                </div>
                <div className="flex flex-col items-center gap-2">
                    <div className="p-3 rounded-2xl bg-white/5 border border-white/10">
                        <Music className="w-6 h-6 text-green-400" />
                    </div>
                    <span className="text-xs text-white/50">Hi-Res Audio</span>
                </div>
            </div>
        )
    },
    {
        id: 'organization',
        icon: <FolderOpen className="w-16 h-16 text-blue-400" />,
        title: "Smart Organization",
        description: "Stop digging through folders. We automatically sort your downloads into 'Music' and 'Video' folders inside 'VibeDownloads'.",
        color: "from-blue-500 to-cyan-500"
    },
    {
        id: 'cookies',
        icon: <ShieldCheck className="w-16 h-16 text-emerald-400" />,
        title: "Private Content",
        description: "Downloading private Instagram reels or stories? Simply add your cookies in Settings. Your data stays local and secure.",
        color: "from-emerald-500 to-teal-500"
    },
    {
        id: 'opensource',
        icon: (
            <svg
                width="64"
                height="64"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-white"
            >
                <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
                <path d="M9 18c-4.51 2-5-2-7-2" />
            </svg>
        ),
        title: "Open Source & Free",
        description: "VibeDownloader is proudly open source. If you love it, please consider staring us on GitHub!",
        color: "from-gray-600 to-gray-800",
        extra: (
            <button
                onClick={() => window.electron.openExternal("https://github.com/naeem5877/vibedownloader-desktop")}
                className="mt-6 px-6 py-3 rounded-full bg-white text-black font-semibold flex items-center gap-2 hover:scale-105 transition-transform"
            >
                <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                Star on GitHub
            </button>
        )
    }
];

export const Onboarding: React.FC<OnboardingProps> = ({ onComplete }) => {
    const [currentStep, setCurrentStep] = useState(0);

    const handleNext = () => {
        if (currentStep < steps.length - 1) {
            setCurrentStep(prev => prev + 1);
        } else {
            onComplete();
        }
    };

    const step = steps[currentStep];

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4"
        >
            <div className="w-full max-w-lg bg-[#0F1117] border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col relative h-[500px]">
                {/* Background Gradients */}
                <div className={`absolute top-0 right-0 w-64 h-64 bg-gradient-to-br ${step.color} opacity-10 blur-[80px] rounded-full -translate-y-1/2 translate-x-1/2 transition-colors duration-700`} />
                <div className={`absolute bottom-0 left-0 w-64 h-64 bg-gradient-to-tr ${step.color} opacity-10 blur-[80px] rounded-full translate-y-1/2 -translate-x-1/2 transition-colors duration-700`} />

                {/* Content */}
                <div className="relative z-10 flex flex-col items-center justify-center flex-1 p-8 text-center">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={step.id}
                            initial={{ y: 20, opacity: 0, scale: 0.95 }}
                            animate={{ y: 0, opacity: 1, scale: 1 }}
                            exit={{ y: -20, opacity: 0, scale: 0.95 }}
                            transition={{ duration: 0.4, ease: "easeOut" }}
                            className="flex flex-col items-center max-w-sm"
                        >
                            <div className="mb-8 p-6 rounded-full bg-white/5 border border-white/10 shadow-xl backdrop-blur-sm">
                                {step.icon}
                            </div>

                            <h2 className="text-3xl font-bold text-white mb-4 tracking-tight">
                                {step.title}
                            </h2>

                            <p className="text-lg text-gray-400 leading-relaxed">
                                {step.description}
                            </p>

                            {step.extra && step.extra}
                        </motion.div>
                    </AnimatePresence>
                </div>

                {/* Footer / Controls */}
                <div className="relative z-10 p-8 pt-0 flex flex-col gap-6">
                    {/* Progress Indicators */}
                    <div className="flex justify-center gap-2">
                        {steps.map((_, index) => (
                            <div
                                key={index}
                                className={`h-1.5 rounded-full transition-all duration-300 ${index === currentStep ? 'w-8 bg-white' : 'w-2 bg-white/20'
                                    }`}
                            />
                        ))}
                    </div>

                    <button
                        onClick={handleNext}
                        className={`w-full group relative flex items-center justify-center gap-2 py-4 rounded-xl font-semibold text-white overflow-hidden transition-all duration-300
                            ${currentStep === steps.length - 1
                                ? 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:scale-[1.02] shadow-lg shadow-emerald-500/20'
                                : 'bg-white/10 hover:bg-white/15 hover:scale-[1.02] border border-white/10'
                            }`}
                    >
                        {currentStep === steps.length - 1 ? (
                            <>Get Started <Check className="w-5 h-5" /></>
                        ) : (
                            <>Next <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" /></>
                        )}
                    </button>
                </div>
            </div>
        </motion.div>
    );
};
