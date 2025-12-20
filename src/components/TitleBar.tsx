import { useState } from 'react';
import { Minus, Square, X, Github, Share2, Check } from 'lucide-react';
import './TitleBar.css';

export function TitleBar() {
    const [copied, setCopied] = useState(false);

    const handleShare = async () => {
        const url = "https://vibedownloader.me";
        await window.electron.copyToClipboard(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        // Also open in browser
        // window.electron.openExternal(url); 
        // User requested "copy link", so maybe just copy is enough? 
        // Or we can do both. The previous code did both. 
        // Let's just copy and show feedback, and maybe open if they want.
        // Actually, "share" usually implies opening a share sheet or copying.
        // Let's stick to Copy + Open for now, as it's the most robust "Share".
    };

    return (
        <div className="titlebar">
            <div className="titlebar-branding">
                VibeDownloader
            </div>

            <div className="flex items-center">
                {/* Social Actions */}
                <div className="titlebar-actions">
                    <button
                        onClick={() => window.electron.openExternal("https://github.com/naeem5877/vibedownloader-desktop")}
                        className="control-btn"
                        title="Star on GitHub"
                    >
                        <Github size={16} />
                    </button>

                    <button
                        onClick={handleShare}
                        className="control-btn"
                        title={copied ? "Link Copied!" : "Share VibeDownloader"}
                    >
                        {copied ? <Check size={16} className="text-green-400" /> : <Share2 size={16} />}
                    </button>
                </div>

                {/* Window Controls */}
                <div className="titlebar-controls">
                    <button onClick={() => window.electron.minimize()} className="control-btn" title="Minimize">
                        <Minus size={16} />
                    </button>
                    <button onClick={() => window.electron.maximize()} className="control-btn" title="Maximize">
                        <Square size={14} />
                    </button>
                    <button onClick={() => window.electron.close()} className="control-btn close" title="Close">
                        <X size={16} />
                    </button>
                </div>
            </div>
        </div>
    );
}
