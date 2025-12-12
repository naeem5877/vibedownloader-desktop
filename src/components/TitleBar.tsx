import { Minus, Square, X } from 'lucide-react';
import './TitleBar.css';

export function TitleBar() {
    return (
        <div className="titlebar">
            <div className="titlebar-branding">
                VibeDownloader
            </div>
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
    );
}
