import { useEffect, useRef, useState } from 'react';
import { Github, Share2, Check } from 'lucide-react';
import './TitleBar.css';

// `base` is './' so the packaged app (file://) needs a relative URL, never '/logo.png'.
const LOGO_SRC = `${import.meta.env.BASE_URL}logo.png`;
const SITE_URL = 'https://vibedownloader.vercel.app';
const REPO_URL = 'https://github.com/naeem5877/vibedownloader-desktop';

/* Window glyphs drawn on a 10px grid with 1px strokes, the way Windows draws
   them. Scaled icon-font glyphs blur on a 1x display; these stay sharp. */
const Glyph = ({ children }: { children: React.ReactNode }) => (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
        {children}
    </svg>
);
const MinimizeGlyph = () => <Glyph><path d="M0 5.5h10" /></Glyph>;
const MaximizeGlyph = () => <Glyph><rect x="0.5" y="0.5" width="9" height="9" rx="1.25" /></Glyph>;
const RestoreGlyph = () => (
    <Glyph>
        <path d="M2.5 2.5v-1a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" />
        <rect x="0.5" y="2.5" width="7" height="7" rx="1.25" />
    </Glyph>
);
const CloseGlyph = () => <Glyph><path d="M0.5 0.5l9 9M9.5 0.5l-9 9" /></Glyph>;

export function TitleBar() {
    const [copied, setCopied] = useState(false);
    const [maximized, setMaximized] = useState(false);
    const [logoOk, setLogoOk] = useState(true);
    const copiedTimer = useRef<number | undefined>(undefined);

    // The window launches maximised and the main process emits no state event, so
    // the Maximize/Restore glyph follows the window's size instead.
    useEffect(() => {
        const sync = () =>
            setMaximized(
                window.outerWidth >= window.screen.availWidth - 2 &&
                window.outerHeight >= window.screen.availHeight - 2
            );
        sync();
        window.addEventListener('resize', sync);
        return () => window.removeEventListener('resize', sync);
    }, []);

    useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

    const handleShare = async () => {
        await window.electron.copyToClipboard(SITE_URL);
        setCopied(true);
        window.clearTimeout(copiedTimer.current);
        copiedTimer.current = window.setTimeout(() => setCopied(false), 2000);
    };

    return (
        <header className="titlebar">
            <div className="titlebar-brand">
                {logoOk && (
                    <img src={LOGO_SRC} alt="" draggable={false} className="titlebar-logo" onError={() => setLogoOk(false)} />
                )}
                <span className="titlebar-name">
                    Vibe<em>Downloader</em>
                </span>
            </div>

            <div className="titlebar-right">
                <div className="titlebar-actions">
                    <button
                        type="button"
                        onClick={() => window.electron.openExternal(REPO_URL)}
                        className="tb-icon"
                        title="Star on GitHub"
                        aria-label="Star on GitHub"
                    >
                        <Github size={15} strokeWidth={1.75} />
                    </button>
                    <button
                        type="button"
                        onClick={handleShare}
                        className={`tb-icon${copied ? ' is-done' : ''}`}
                        title={copied ? 'Link copied!' : 'Copy link to share VibeDownloader'}
                        aria-label="Copy share link"
                    >
                        {copied ? <Check size={15} strokeWidth={2} /> : <Share2 size={15} strokeWidth={1.75} />}
                    </button>
                </div>

                <span className="titlebar-sep" aria-hidden="true" />

                <div className="titlebar-controls">
                    <button type="button" onClick={() => window.electron.minimize()} className="win-btn" title="Minimize" aria-label="Minimize">
                        <MinimizeGlyph />
                    </button>
                    <button
                        type="button"
                        onClick={() => window.electron.maximize()}
                        className="win-btn"
                        title={maximized ? 'Restore' : 'Maximize'}
                        aria-label={maximized ? 'Restore' : 'Maximize'}
                    >
                        {maximized ? <RestoreGlyph /> : <MaximizeGlyph />}
                    </button>
                    <button type="button" onClick={() => window.electron.close()} className="win-btn close" title="Close" aria-label="Close">
                        <CloseGlyph />
                    </button>
                </div>
            </div>
        </header>
    );
}
