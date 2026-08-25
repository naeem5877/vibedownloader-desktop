import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { X, Play, FolderOpen } from 'lucide-react';
import { VideoTutorial } from './VideoTutorial';

interface TutorialModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function TutorialModal({ isOpen, onClose }: TutorialModalProps) {
    const [error, setError] = useState<string | null>(null);

    const revealFolder = async () => {
        const res = await window.electron.revealExtensionFolder?.();
        if (res?.success) setError(null);
        else setError(res?.error || 'Could not open the extension folder.');
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
                    onClick={onClose}
                >
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        className="relative w-full max-w-3xl bg-[#111] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between p-4 border-b border-white/10">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 border border-violet-400/10 flex items-center justify-center">
                                    <Play className="w-5 h-5 text-violet-300" />
                                </div>
                                <div>
                                    <h2 className="font-bold text-white">How to install the extension</h2>
                                    <p className="text-xs text-white/40">Takes about 30 seconds — do it once per browser</p>
                                </div>
                            </div>
                            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition cursor-pointer">
                                <X className="w-5 h-5 text-white/60" />
                            </button>
                        </div>

                        <div className="p-5 space-y-4">
                            <VideoTutorial />

                            <div className="flex items-center gap-2">
                                <button
                                    onClick={revealFolder}
                                    className="flex-1 h-10 rounded-xl bg-gradient-to-r from-violet-500/30 to-fuchsia-500/30 hover:from-violet-500/40 hover:to-fuchsia-500/40 border border-violet-400/20 text-xs font-bold text-violet-200 transition cursor-pointer flex items-center justify-center gap-1.5"
                                >
                                    <FolderOpen className="w-3.5 h-3.5" /> Show extension folder
                                </button>
                            </div>

                            <p className="text-xs text-white/40 leading-relaxed">
                                In your browser: open the extensions page (<span className="font-mono text-white/60">chrome://extensions</span> or
                                equivalent), turn on <b>Developer mode</b>, click <b>"Load unpacked"</b> and pick the folder we reveal.
                                For Firefox use <b>about:debugging</b> → <b>Load Temporary Add-on</b>.
                            </p>

                            {error && <p className="text-xs text-red-400">{error}</p>}
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
