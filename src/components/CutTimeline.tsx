import { useEffect, useMemo, useRef, useState } from 'react';

interface CutTimelineProps {
    duration: number;
    start: number;
    end: number;
    onChange: (start: number, end: number) => void;
    /** Colour of the selected range and its handles (hex). */
    accent?: string;
}

const MIN_GAP = 1; // shortest clip the trimmer allows (seconds)
const BAR_COUNT = 72;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** m:ss.t (or h:mm:ss.t), rounded once so 59.96s never prints as 0:60.0 */
const clock = (s: number) => {
    const tenths = Math.round(Math.max(0, s) * 10);
    const total = Math.floor(tenths / 10);
    const frac = tenths % 10;
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = String(total % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}.${frac}` : `${m}:${sec}.${frac}`;
};

const Readout = ({ label, value, align = 'left' }: { label: string; value: string; align?: 'left' | 'right' }) => (
    <div className={align === 'right' ? 'text-right' : ''}>
        <p className="text-[10px] font-bold uppercase tracking-widest text-white/35">{label}</p>
        <p className="mt-0.5 text-xs font-semibold text-white/80 tabular-nums">{value}</p>
    </div>
);

/**
 * Editor-style dual-range trimmer.
 * - Drag either handle (or click the track to snap the nearest handle).
 * - Uses pointer capture + rAF-throttled updates so it stays smooth even on long videos.
 * - Keyboard accessible: focus a handle and use ArrowLeft/ArrowRight (Shift = 5s steps).
 */
export function CutTimeline({ duration, start, end, onChange, accent = '#a855f7' }: CutTimelineProps) {
    const trackRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<'start' | 'end' | null>(null);
    const rafRef = useRef<number | null>(null);
    const lastXRef = useRef(0);
    const latestRef = useRef({ duration, start, end });
    latestRef.current = { duration, start, end };

    const [dragging, setDragging] = useState<'start' | 'end' | null>(null);

    // Deterministic decorative waveform, so the track always looks the same
    const bars = useMemo(
        () => Array.from({ length: BAR_COUNT }, (_, i) => ({
            key: i,
            height: 20 + Math.abs(Math.sin(i * 0.9)) * 45 + ((i * 7) % 5) * 5
        })),
        []
    );

    const timeFromClientX = (clientX: number) => {
        const track = trackRef.current;
        if (!track || !duration) return 0;
        const rect = track.getBoundingClientRect();
        const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
        return ratio * duration;
    };

    const flush = () => {
        rafRef.current = null;
        const which = dragRef.current;
        if (!which || !duration) return;
        const { start: s, end: e } = latestRef.current;
        const t = timeFromClientX(lastXRef.current);
        if (which === 'start') onChange(Math.min(t, e - MIN_GAP), e);
        else onChange(s, Math.max(t, s + MIN_GAP));
    };

    const schedule = (clientX: number) => {
        lastXRef.current = clientX;
        if (rafRef.current == null) {
            rafRef.current = requestAnimationFrame(flush);
        }
    };

    const stopDrag = () => {
        dragRef.current = null;
        setDragging(null);
        if (rafRef.current != null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
    };

    const startDrag = (which: 'start' | 'end', clientX: number) => {
        if (duration <= 0) return;
        dragRef.current = which;
        setDragging(which);
        schedule(clientX);
    };

    useEffect(() => {
        return () => {
            if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
        };
    }, []);

    const onTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        const t = timeFromClientX(e.clientX);
        const { start: s, end: en } = latestRef.current;
        const which: 'start' | 'end' = Math.abs(t - s) <= Math.abs(en - t) ? 'start' : 'end';
        startDrag(which, e.clientX);
        (e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId);
    };

    const onTrackPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (dragRef.current) schedule(e.clientX);
    };

    const onHandlePointerDown = (which: 'start' | 'end') => (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        startDrag(which, e.clientX);
        (e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId);
    };

    const onKeyDown = (which: 'start' | 'end') => (e: React.KeyboardEvent<HTMLDivElement>) => {
        let delta = 0;
        if (e.key === 'ArrowLeft') delta = -1;
        else if (e.key === 'ArrowRight') delta = 1;
        else return;
        e.preventDefault();
        if (e.shiftKey) delta *= 5;
        if (which === 'start') onChange(clamp(start + delta, 0, end - MIN_GAP), end);
        else onChange(start, clamp(end + delta, start + MIN_GAP, duration));
    };

    const pct = (s: number) => (duration > 0 ? (s / duration) * 100 : 0);

    const handle = (which: 'start' | 'end') => {
        const value = which === 'start' ? start : end;
        return (
            <div
                role="slider"
                aria-label={which === 'start' ? 'Clip start' : 'Clip end'}
                aria-valuemin={which === 'start' ? 0 : Math.round(start + MIN_GAP)}
                aria-valuemax={which === 'start' ? Math.round(end - MIN_GAP) : Math.round(duration)}
                aria-valuenow={Math.round(value)}
                tabIndex={0}
                onPointerDown={onHandlePointerDown(which)}
                onKeyDown={onKeyDown(which)}
                className="absolute -top-2 -bottom-2 z-10 w-3.5 -translate-x-1/2 rounded-md outline-none cursor-ew-resize focus-visible:ring-2 focus-visible:ring-white/70"
                style={{ left: `${pct(value)}%` }}
            >
                <div
                    className={`h-full w-full rounded-md flex items-center justify-center shadow-lg shadow-black/50 pointer-events-none transition-[filter] duration-150 ${dragging === which ? 'brightness-125' : ''}`}
                    style={{ background: accent }}
                >
                    <div className="w-[2px] h-4 rounded-full bg-white/85" />
                </div>
            </div>
        );
    };

    return (
        <div>
            <div
                className={`relative h-16 rounded-2xl bg-white/[0.03] border border-white/10 select-none touch-none ${dragging ? 'cursor-grabbing' : 'cursor-pointer'}`}
                onPointerDown={onTrackPointerDown}
                onPointerMove={onTrackPointerMove}
                onPointerUp={stopDrag}
                onPointerCancel={stopDrag}
            >
                {/* Inner track: insets leave room so the handles never poke out of the card */}
                <div ref={trackRef} className="absolute inset-y-3 inset-x-4">
                    {/* Waveform */}
                    <div aria-hidden="true" className="absolute inset-0 flex items-center justify-between gap-[2px]">
                        {bars.map((b) => {
                            const barT = (b.key + 0.5) / bars.length;
                            const inSelection = duration > 0 && barT >= start / duration && barT <= end / duration;
                            return (
                                <div
                                    key={b.key}
                                    className="flex-1 rounded-full transition-colors duration-150"
                                    style={{
                                        height: `${b.height}%`,
                                        background: inSelection ? accent : 'rgba(255,255,255,0.1)',
                                        opacity: inSelection ? 0.8 : 1
                                    }}
                                />
                            );
                        })}
                    </div>

                    {/* Selected range frame */}
                    <div
                        aria-hidden="true"
                        className="absolute -inset-y-1 border-y-2 pointer-events-none"
                        style={{
                            left: `${pct(start)}%`,
                            width: `${Math.max(0, pct(end) - pct(start))}%`,
                            borderColor: accent,
                            background: `${accent}1f`
                        }}
                    />

                    {handle('start')}
                    {handle('end')}
                </div>
            </div>

            {/* Readout: fixed positions, so the two labels can never collide */}
            <div className="mt-2.5 flex items-end justify-between">
                <Readout label="Start" value={clock(start)} />
                <p className="text-[10px] text-white/30 tabular-nums pb-0.5">of {clock(duration)}</p>
                <Readout label="End" value={clock(end)} align="right" />
            </div>
        </div>
    );
}
