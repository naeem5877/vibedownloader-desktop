import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Settings as SettingsIcon, X, RefreshCw, Loader, FolderOpen, Check, HardDrive, Info
} from 'lucide-react';

interface SettingsProps {
    isOpen: boolean;
    onClose: () => void;
}

export function Settings({ isOpen, onClose }: SettingsProps) {
    const [ytdlpVersion, setYtdlpVersion] = useState<string | null>(null);
    const [appVersion, setAppVersion] = useState<string | null>(null);
    const [isUpdating, setIsUpdating] = useState(false);
    const [updateStatus, setUpdateStatus] = useState<string | null>(null);
    const [downloadPath, setDownloadPath] = useState<string>('');

    useEffect(() => {
        if (isOpen) {
            // Get versions
            window.electron.getVersions?.().then((res: any) => {
                setYtdlpVersion(res?.ytdlp || 'Unknown');
                setAppVersion(res?.app || '1.0.0');
            });
            // Get current download path
            window.electron.getDownloadPath?.().then((res: any) => {
                setDownloadPath(res?.path || '');
            });
        }
    }, [isOpen]);

    const handleUpdateYtdlp = async () => {
        setIsUpdating(true);
        setUpdateStatus('Checking for updates...');
        try {
            const result = await window.electron.updateYtdlp?.();
            if (result?.updated) {
                setUpdateStatus('✅ Updated successfully!');
                setYtdlpVersion(result.version ?? null);
            } else {
                setUpdateStatus(result?.message || '✅ Already up to date');
            }
        } catch (e: any) {
            setUpdateStatus('❌ Update failed: ' + e.message);
        } finally {
            setIsUpdating(false);
            setTimeout(() => setUpdateStatus(null), 5000);
        }
    };

    const handleChooseFolder = async () => {
        const result = await window.electron.chooseDownloadFolder?.();
        if (result?.path) {
            setDownloadPath(result.path);
        }
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
                {/* Backdrop */}
                <div
                    className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                    onClick={onClose}
                />

                {/* Modal */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="relative w-full max-w-md bg-[#111] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between p-4 border-b border-white/10">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
                                <SettingsIcon className="w-5 h-5 text-white/60" />
                            </div>
                            <div>
                                <h2 className="font-bold text-white">Settings</h2>
                                <p className="text-xs text-white/40">App & Downloads</p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-white/10 rounded-lg transition cursor-pointer"
                        >
                            <X className="w-5 h-5 text-white/60" />
                        </button>
                    </div>

                    <div className="p-4 space-y-4">
                        {/* Download Location */}
                        <div className="space-y-3">
                            <label className="text-xs font-bold text-white/50 uppercase tracking-wider flex items-center gap-2">
                                <FolderOpen className="w-3.5 h-3.5" /> Download Location
                            </label>
                            <div className="flex gap-2">
                                <div className="flex-1 h-11 px-4 bg-white/5 border border-white/10 rounded-xl flex items-center overflow-hidden">
                                    <span className="text-sm text-white/60 truncate">{downloadPath || 'Default Downloads'}</span>
                                </div>
                                <button
                                    onClick={handleChooseFolder}
                                    className="h-11 px-4 bg-white/10 hover:bg-white/20 rounded-xl text-sm font-medium text-white transition cursor-pointer flex items-center gap-2"
                                >
                                    <FolderOpen className="w-4 h-4" />
                                    Change
                                </button>
                            </div>
                            <div className="flex items-start gap-2 p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                                <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                                <p className="text-xs text-blue-300/80 leading-relaxed">
                                    Files are organized in <b>VibeDownloader</b> folder with subfolders for each platform and content type (videos, reels, stories, playlists, thumbnails, and music).
                                </p>
                            </div>
                        </div>

                        {/* yt-dlp Update */}
                        <div className="space-y-3">
                            <label className="text-xs font-bold text-white/50 uppercase tracking-wider flex items-center gap-2">
                                <RefreshCw className="w-3.5 h-3.5" /> yt-dlp Engine
                            </label>

                            <div className="p-4 bg-white/[0.03] rounded-xl border border-white/5">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-white">Version</p>
                                        <p className="text-xs text-white/40 font-mono">{ytdlpVersion || 'Loading...'}</p>
                                    </div>
                                    <button
                                        onClick={handleUpdateYtdlp}
                                        disabled={isUpdating}
                                        className="flex items-center gap-2 px-4 h-9 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-medium text-white transition cursor-pointer disabled:opacity-50"
                                    >
                                        {isUpdating ? (
                                            <Loader className="w-4 h-4 animate-spin" />
                                        ) : (
                                            <RefreshCw className="w-4 h-4" />
                                        )}
                                        {isUpdating ? 'Updating...' : 'Update'}
                                    </button>
                                </div>
                                {updateStatus && (
                                    <p className="text-xs text-green-400 mt-2">{updateStatus}</p>
                                )}
                            </div>
                        </div>

                        {/* App Info */}
                        <div className="p-4 bg-gradient-to-br from-white/[0.03] to-transparent rounded-xl border border-white/5">
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
                                    <HardDrive className="w-6 h-6 text-purple-400" />
                                </div>
                                <div>
                                    <p className="text-sm font-bold text-white">VibeDownloader</p>
                                    <p className="text-xs text-white/40">Version {appVersion}</p>
                                </div>
                                <div className="ml-auto flex items-center gap-1.5 px-2 py-1 bg-green-500/20 rounded-lg">
                                    <Check className="w-3 h-3 text-green-400" />
                                    <span className="text-xs font-medium text-green-400">Active</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}
