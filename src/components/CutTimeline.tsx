import { useEffect, useMemo, useRef, useState } from 'react';

interface CutTimelineProps {
    duration: number;
    start: number;
    end: number;
    onChange: (start: number, end: number) => void;
}

const MIN_GAP = 0.2;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const fmtTime = (s: number) => `${s.toFixed(1).replace(/\.0$/, '')}s`;

/**
 * Editor-style dual-range trimmer.
 * - Drag either handle (or click the track to snap the nearest handle).
 * - Uses pointer capture + rAF-throttled updates so it stays smooth even on long videos.
 * - Keyboard accessible: focus a handle and use ArrowLeft/ArrowRight (Shift = 5s steps).
 */
export function CutTimeline({ duration, start, end, onChange }: CutTimelineProps) {
    const trackRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<'start' | 'end' | null>(null);
    const rafRef = useRef<number | null>(null);
    const lastXRef = useRef(0);
    const latestRef = useRef({ duration, start, end });
    latestRef.current = { duration, start, end };

    const [dragging, setDragging] = useState(false);

    // Precompute a deterministic waveform for the duration of the modal
    const bars = useMemo(
        () => Array.from({ length: 48 }, (_, i) => ({
            key: i,
            height: 12 + Math.abs(Math.sin(i * 0.9) * 22) + (i % 7) * 2
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
        setDragging(false);
        if (rafRef.current != null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
    };

    const startDrag = (which: 'start' | 'end', clientX: number) => {
        if (duration <= 0) return;
        dragRef.current = which;
        setDragging(true);
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

    return (
        <div>
            <div
                ref={trackRef}
                className={`relative h-12 select-none touch-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                onPointerDown={onTrackPointerDown}
                onPointerMove={onTrackPointerMove}
                onPointerUp={stopDrag}
                onPointerCancel={stopDrag}
            >
                {/* Ticks (ruler feel) */}
                {Array.from({ length: 9 }).map((_, i) => (
                    <div
                        key={i}
                        className="absolute top-1/2 -translate-y-1/2 w-px h-[14px] bg-white/10"
                        style={{ left: `${(i / 8) * 100}%` }}
                    />
                ))}

                {/* Waveform */}
                <div className="absolute top-1/2 -translate-y-1/2 inset-x-0 px-[2px] h-8 flex items-center justify-between overflow-hidden rounded-md">
                    {bars.map((b) => {
                        const barT = (b.key + 0.5) / bars.length;
                        const inSelection = barT >= start / duration && barT <= end / duration;
                        return (
                            <div
                                key={b.key}
                                className={`w-[2px] rounded-full ${inSelection ? 'bg-purple-500/45' : 'bg-white/[0.09]'}`}
                                style={{ height: `${b.height}px` }}
                            />
                        );
                    })}
                </div>

                {/* Base track */}
                <div className="absolute top-1/2 -translate-y-1/2 inset-x-0 h-[4px] bg-white/[0.06] rounded-full border border-white/[0.06]" />

                {/* Selected range */}
                <div
                    className="absolute top-1/2 -translate-y-1/2 h-[5px] rounded-full bg-gradient-to-r from-purple-500 to-fuchsia-500 border border-white/25"
                    style={{
                        left: `${pct(start)}%`,
                        width: `${pct(end) - pct(start)}%`
                    }}
                />

                {/* Start handle */}
                <div
                    role="slider"
                    aria-label="Clip start"
                    aria-valuemin={0}
                    aria-valuemax={Math.round(end - MIN_GAP)}
                    aria-valuenow={Math.round(start)}
                    tabIndex={0}
                    onPointerDown={onHandlePointerDown('start')}
                    onKeyDown={onKeyDown('start')}
                    className="absolute top-1/2 -translate-y-1/2 z-10 -translate-x-1/2 w-[16px] h-[36px] outline-none cursor-grab focus-visible:ring-2 focus-visible:ring-purple-400/70 rounded-md"
                    style={{ left: `${pct(start)}%` }}
                >
                    <div className={`relative w-full h-full rounded-md bg-gradient-to-b from-[#2c2c33] to-[#141418] border pointer-events-none ${dragging ? 'border-purple-300' : 'border-white/25'}`}>
                        <div className="absolute top-1 left-1/2 -translate-x-1/2 w-[7px] h-[7px] rotate-45 bg-purple-400 rounded-[2px]" />
                        <div className="flex items-center justify-center gap-[2px] absolute inset-x-0 top-1/2 -translate-y-1/2">
                            <div className="w-px h-[10px] bg-white/25" />
                            <div className="w-px h-[10px] bg-white/25" />
                        </div>
                        <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-[7px] h-[7px] rotate-45 bg-purple-400 rounded-[2px]" />
                    </div>
                </div>

                {/* End handle */}
                <div
                    role="slider"
                    aria-label="Clip end"
                    aria-valuemin={Math.round(start + MIN_GAP)}
                    aria-valuemax={Math.round(duration)}
                    aria-valuenow={Math.round(end)}
                    tabIndex={0}
                    onPointerDown={onHandlePointerDown('end')}
                    onKeyDown={onKeyDown('end')}
                    className="absolute top-1/2 -translate-y-1/2 z-10 -translate-x-1/2 w-[16px] h-[36px] outline-none cursor-grab focus-visible:ring-2 focus-visible:ring-fuchsia-400/70 rounded-md"
                    style={{ left: `${pct(end)}%` }}
                >
                    <div className={`relative w-full h-full rounded-md bg-gradient-to-b from-[#2c2c33] to-[#141418] border pointer-events-none ${dragging ? 'border-fuchsia-300' : 'border-white/25'}`}>
                        <div className="absolute top-1 left-1/2 -translate-x-1/2 w-[7px] h-[7px] rotate-45 bg-fuchsia-400 rounded-[2px]" />
                        <div className="flex items-center justify-center gap-[2px] absolute inset-x-0 top-1/2 -translate-y-1/2">
                            <div className="w-px h-[10px] bg-white/25" />
                            <div className="w-px h-[10px] bg-white/25" />
                        </div>
                        <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-[7px] h-[7px] rotate-45 bg-fuchsia-400 rounded-[2px]" />
                    </div>
                </div>
            </div>

            {/* Timecode strip below the track */}
            <div className="relative h-6 mt-1">
                <div
                    className="absolute top-0 -translate-x-1/2 px-1.5 py-0.5 rounded-md bg-black/60 border border-white/10 font-mono text-[9px] font-bold text-purple-300 pointer-events-none"
                    style={{ left: `${pct(start)}%` }}
                >
                    {fmtTime(start)}
                </div>
                <div
                    className="absolute top-0 -translate-x-1/2 px-1.5 py-0.5 rounded-md bg-black/60 border border-white/10 font-mono text-[9px] font-bold text-fuchsia-300 pointer-events-none"
                    style={{ left: `${pct(end)}%` }}
                >
                    {fmtTime(end)}
                </div>
            </div>
        </div>
    );
}