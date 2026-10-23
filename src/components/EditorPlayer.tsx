import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, RotateCcw, RotateCw } from 'lucide-react';

/**
 * Custom video player for the library editor (replaces the browser's native controls).
 * Space/K play, ←/→ seek 5s, J/L seek 10s, M mute, F fullscreen, ↑/↓ volume, click the
 * video to toggle. In GIF mode the transport is hidden and the chosen range is shown.
 */

function fmt(s: number): string {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function EditorPlayer({ src, poster, videoRef, gifRange, fallbackDuration }: {
    src: string;
    poster?: string;
    videoRef: RefObject<HTMLVideoElement | null>;
    /** When set, the player is in GIF loop-preview mode: no transport, range shown on the bar. */
    gifRange?: { start: number; length: number } | null;
    fallbackDuration?: number;
}) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const barRef = useRef<HTMLDivElement>(null);
    const hideTimer = useRef<number>(0);

    const [playing, setPlaying] = useState(false);
    const [time, setTime] = useState(0);
    const [dur, setDur] = useState(fallbackDuration || 0);
    const [buffered, setBuffered] = useState(0);
    const [volume, setVolume] = useState(1);
    const [muted, setMuted] = useState(false);
    const [speed, setSpeed] = useState(1);
    const [speedOpen, setSpeedOpen] = useState(false);
    const [full, setFull] = useState(false);
    const [show, setShow] = useState(true);
    const [dragging, setDragging] = useState(false);
    const [hover, setHover] = useState<number | null>(null);

    const gif = !!gifRange;

    // Mirror the video element's state into React.
    useEffect(() => {
        const v = videoRef.current;
        if (!v) return;
        const onTime = () => {
            if (!dragging) setTime(v.currentTime);
            if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1));
        };
        const onMeta = () => { if (isFinite(v.duration) && v.duration > 0) setDur(v.duration); };
        const onPlay = () => setPlaying(true);
        const onPause = () => setPlaying(false);
        const onVol = () => { setVolume(v.volume); setMuted(v.muted); };
        const onRate = () => setSpeed(v.playbackRate);
        v.addEventListener('timeupdate', onTime);
        v.addEventListener('progress', onTime);
        v.addEventListener('loadedmetadata', onMeta);
        v.addEventListener('durationchange', onMeta);
        v.addEventListener('play', onPlay);
        v.addEventListener('pause', onPause);
        v.addEventListener('volumechange', onVol);
        v.addEventListener('ratechange', onRate);
        onMeta(); onVol();
        setPlaying(!v.paused);
        return () => {
            v.removeEventListener('timeupdate', onTime);
            v.removeEventListener('progress', onTime);
            v.removeEventListener('loadedmetadata', onMeta);
            v.removeEventListener('durationchange', onMeta);
            v.removeEventListener('play', onPlay);
            v.removeEventListener('pause', onPause);
            v.removeEventListener('volumechange', onVol);
            v.removeEventListener('ratechange', onRate);
        };
    }, [videoRef, dragging]);

    // GIF preview scrubs from an rAF loop in the editor; keep our bar moving smoothly too.
    useEffect(() => {
        if (!gif) return;
        let raf = 0;
        const tick = () => {
            const v = videoRef.current;
            if (v) setTime(v.currentTime);
            raf = requestAnimationFrame(tick);
        };
        tick();
        return () => cancelAnimationFrame(raf);
    }, [gif, videoRef]);

    useEffect(() => {
        const onFs = () => setFull(document.fullscreenElement === wrapRef.current);
        document.addEventListener('fullscreenchange', onFs);
        return () => document.removeEventListener('fullscreenchange', onFs);
    }, []);

    // Controls fade out while playing and the pointer is idle.
    const poke = useCallback(() => {
        setShow(true);
        window.clearTimeout(hideTimer.current);
        hideTimer.current = window.setTimeout(() => {
            const v = videoRef.current;
            if (v && !v.paused) { setShow(false); setSpeedOpen(false); }
        }, 2400);
    }, [videoRef]);
    useEffect(() => () => window.clearTimeout(hideTimer.current), []);
    useEffect(() => { if (!playing) setShow(true); else poke(); }, [playing, poke]);

    const toggle = () => {
        const v = videoRef.current;
        if (!v) return;
        if (v.paused) v.play().catch(() => { /* refused */ }); else v.pause();
    };
    const seekBy = (d: number) => {
        const v = videoRef.current;
        if (!v) return;
        v.currentTime = Math.min(Math.max(0, v.currentTime + d), dur || v.duration || 0);
        setTime(v.currentTime);
    };
    const setVol = (n: number) => {
        const v = videoRef.current;
        if (!v) return;
        v.volume = Math.min(1, Math.max(0, n));
        v.muted = v.volume === 0;
    };
    const toggleMute = () => { const v = videoRef.current; if (v) v.muted = !v.muted; };
    const setRate = (r: number) => { const v = videoRef.current; if (v) v.playbackRate = r; setSpeedOpen(false); };
    const toggleFull = () => {
        const el = wrapRef.current;
        if (!el) return;
        if (document.fullscreenElement) void document.exitFullscreen();
        else void el.requestFullscreen?.();
    };

    // Seek bar: pointer capture so dragging keeps working outside the bar.
    const posToTime = (clientX: number) => {
        const r = barRef.current!.getBoundingClientRect();
        return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * dur;
    };
    const onBarDown = (e: React.PointerEvent) => {
        if (gif || !dur) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setDragging(true);
        setTime(posToTime(e.clientX));
    };
    const onBarMove = (e: React.PointerEvent) => {
        if (!dur) return;
        const t = posToTime(e.clientX);
        setHover(t);
        if (dragging) setTime(t);
    };
    const onBarUp = (e: React.PointerEvent) => {
        if (!dragging) return;
        const v = videoRef.current;
        const t = posToTime(e.clientX);
        if (v) v.currentTime = t;
        setTime(t);
        setDragging(false);
    };

    const onKey = (e: React.KeyboardEvent) => {
        if (gif) return;
        const k = e.key.toLowerCase();
        if (k === ' ' || k === 'k') { e.preventDefault(); toggle(); }
        else if (k === 'arrowleft') { e.preventDefault(); seekBy(-5); }
        else if (k === 'arrowright') { e.preventDefault(); seekBy(5); }
        else if (k === 'j') seekBy(-10);
        else if (k === 'l') seekBy(10);
        else if (k === 'arrowup') { e.preventDefault(); setVol((muted ? 0 : volume) + 0.1); }
        else if (k === 'arrowdown') { e.preventDefault(); setVol(volume - 0.1); }
        else if (k === 'm') toggleMute();
        else if (k === 'f') toggleFull();
        poke();
    };

    const pct = (n: number) => (dur ? `${Math.min(100, Math.max(0, (n / dur) * 100))}%` : '0%');
    const vis = muted ? 0 : volume;

    return (
        <div
            ref={wrapRef}
            tabIndex={0}
            onKeyDown={onKey}
            onMouseMove={poke}
            onMouseLeave={() => { if (playing) setShow(false); setHover(null); }}
            className="group/player absolute inset-0 outline-none select-none bg-transparent"
            style={{ cursor: playing && !show ? 'none' : 'default' }}
        >
            <video
                ref={videoRef}
                src={src}
                poster={poster}
                preload="metadata"
                playsInline
                onClick={() => { if (!gif) toggle(); }}
                className="relative w-full h-full object-contain"
            />

            {/* Big centre button while paused */}
            {!gif && !playing && (
                <button
                    type="button"
                    aria-label="Play"
                    onClick={toggle}
                    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 rounded-full bg-white/15 backdrop-blur-md border border-white/25 text-white flex items-center justify-center hover:bg-white/25 hover:scale-105 active:scale-95 transition-all cursor-pointer"
                >
                    <Play className="w-7 h-7 ml-1 fill-white" />
                </button>
            )}

            {/* Control bar */}
            <div
                className={`absolute inset-x-0 bottom-0 pt-10 px-3 pb-2.5 bg-gradient-to-t from-black/85 via-black/45 to-transparent transition-opacity duration-200 ${show || gif ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            >
                {/* Seek bar */}
                <div
                    ref={barRef}
                    role="slider"
                    aria-label="Seek"
                    aria-valuemin={0}
                    aria-valuemax={Math.round(dur)}
                    aria-valuenow={Math.round(time)}
                    onPointerDown={onBarDown}
                    onPointerMove={onBarMove}
                    onPointerUp={onBarUp}
                    onPointerLeave={() => setHover(null)}
                    className={`relative h-4 flex items-center ${gif ? '' : 'cursor-pointer'}`}
                >
                    <div className="relative w-full h-1 group-hover/player:h-1.5 rounded-full bg-white/20 transition-all">
                        <div className="absolute inset-y-0 left-0 rounded-full bg-white/25" style={{ width: pct(buffered) }} />
                        {gifRange && (
                            <div
                                className="absolute inset-y-0 rounded-full bg-fuchsia-400/45"
                                style={{ left: pct(gifRange.start), width: pct(gifRange.length) }}
                            />
                        )}
                        <div className="absolute inset-y-0 left-0 rounded-full bg-fuchsia-400" style={{ width: pct(time) }} />
                        {!gif && (
                            <div
                                className="absolute top-1/2 w-3 h-3 -translate-y-1/2 -translate-x-1/2 rounded-full bg-white shadow scale-0 group-hover/player:scale-100 transition-transform"
                                style={{ left: pct(time) }}
                            />
                        )}
                    </div>
                    {hover !== null && !gif && (
                        <span
                            className="absolute -top-6 -translate-x-1/2 px-1.5 py-0.5 rounded bg-black/80 text-[10px] font-semibold text-white tabular-nums pointer-events-none"
                            style={{ left: pct(hover) }}
                        >
                            {fmt(hover)}
                        </span>
                    )}
                </div>

                {!gif && (
                    <div className="mt-1 flex items-center gap-1 text-white">
                        <Btn label={playing ? 'Pause' : 'Play'} onClick={toggle}>
                            {playing ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white" />}
                        </Btn>
                        <Btn label="Back 10 seconds" onClick={() => seekBy(-10)}><RotateCcw className="w-4 h-4" /></Btn>
                        <Btn label="Forward 10 seconds" onClick={() => seekBy(10)}><RotateCw className="w-4 h-4" /></Btn>

                        <div className="flex items-center group/vol">
                            <Btn label={muted || volume === 0 ? 'Unmute' : 'Mute'} onClick={toggleMute}>
                                {vis === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                            </Btn>
                            <input
                                type="range"
                                aria-label="Volume"
                                min={0}
                                max={1}
                                step={0.05}
                                value={vis}
                                onChange={(e) => setVol(Number(e.target.value))}
                                className="w-0 opacity-0 group-hover/vol:w-16 group-hover/vol:opacity-100 focus:w-16 focus:opacity-100 transition-all h-1 rounded-full appearance-none bg-white/25 accent-white cursor-pointer"
                            />
                        </div>

                        <span className="ml-1 text-[11px] font-semibold tabular-nums text-white/85">
                            {fmt(time)} <span className="text-white/45">/ {fmt(dur)}</span>
                        </span>

                        <div className="ml-auto flex items-center gap-1">
                            <div className="relative">
                                <button
                                    type="button"
                                    aria-label="Playback speed"
                                    onClick={() => setSpeedOpen(o => !o)}
                                    className="h-8 px-2 rounded-lg text-[11px] font-bold tabular-nums hover:bg-white/15 transition-colors cursor-pointer"
                                >
                                    {speed}×
                                </button>
                                {speedOpen && (
                                    <div className="absolute bottom-9 right-0 p-1 rounded-xl bg-black/90 border border-white/15 flex flex-col min-w-[64px]">
                                        {SPEEDS.map(r => (
                                            <button
                                                key={r}
                                                type="button"
                                                onClick={() => setRate(r)}
                                                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold text-left tabular-nums cursor-pointer hover:bg-white/15 ${r === speed ? 'text-fuchsia-300' : 'text-white/80'}`}
                                            >
                                                {r}×
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <Btn label={full ? 'Exit fullscreen' : 'Fullscreen'} onClick={toggleFull}>
                                {full ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                            </Btn>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function Btn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            onClick={onClick}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/15 active:scale-95 transition-all cursor-pointer"
        >
            {children}
        </button>
    );
}
