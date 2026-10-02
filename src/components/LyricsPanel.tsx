/**
 * Lyrics panel component with support for Word-Sync, Line-by-Line Synced,
 * Plain text, and Translation modes.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Languages, Music2, Type, AlignLeft, Download, Loader2, Check, ChevronDown, Sparkles } from 'lucide-react';

export interface LyricWord {
    t: number;
    d: number;
    w: string;
}

export interface LyricLine {
    t: number;
    text: string;
    words?: LyricWord[];
}

export interface LyricsData {
    plain?: string;
    synced?: LyricLine[];
    words?: LyricLine[];
    translation?: LyricLine[];
    title: string;
    artist: string;
    displayTitle?: string;
    displayArtist?: string;
    duration?: number;
}

type Mode = 'words' | 'synced' | 'plain' | 'translation';

interface LyricsPanelProps {
    lyrics: LyricsData | null;
    currentTime?: number;
    isPlaying?: boolean;
    defaultCollapsed?: boolean;
}

const TABS: { id: Mode; label: string; icon: typeof Type }[] = [
    { id: 'words', label: 'Word-Sync', icon: Sparkles },
    { id: 'synced', label: 'Line Sync', icon: AlignLeft },
    { id: 'plain', label: 'Plain Text', icon: Type },
    { id: 'translation', label: 'Translation', icon: Languages }
];

function activeLineIndex(lines: LyricLine[] | undefined, timeMs: number): number {
    if (!lines?.length || timeMs < 0) return -1;
    let found = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].t <= timeMs) found = i;
        else break;
    }
    return found;
}

function formatStamp(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function plainLines(text: string): { text: string; gapBefore: boolean }[] {
    const out: { text: string; gapBefore: boolean }[] = [];
    let gap = false;

    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) {
            gap = out.length > 0;
            continue;
        }
        out.push({ text: line, gapBefore: gap });
        gap = false;
    }

    return out;
}

/**
 * Format raw word tokens with natural punctuation and spacing.
 * Eliminates artificial gaps before commas, periods, quotes, and parens.
 */
function formatWordsWithNaturalSpacing(rawWords: LyricWord[]): { word: LyricWord; spaceBefore: boolean }[] {
    const trailingPunct = /^[,.!?:;)\]}"'\u2019\u201d]+$/;
    const leadingPunct = /^[({\["'\u2018\u201c]+$/;
    const isCjk = /[\u4e00-\u9fa5\u3040-\u30ff]/;

    return rawWords.map((curr, i) => {
        if (i === 0) return { word: curr, spaceBefore: false };
        const prev = rawWords[i - 1];

        // If the token already has an explicit space from parser
        if (prev.w.endsWith(' ') || curr.w.startsWith(' ')) {
            return { word: curr, spaceBefore: false };
        }

        const prevW = prev.w.trim();
        const currW = curr.w.trim();

        if (trailingPunct.test(currW)) {
            return { word: curr, spaceBefore: false };
        }
        if (leadingPunct.test(prevW) && !trailingPunct.test(prevW)) {
            return { word: curr, spaceBefore: false };
        }
        if (isCjk.test(prevW) && isCjk.test(currW)) {
            return { word: curr, spaceBefore: false };
        }
        return { word: curr, spaceBefore: true };
    });
}

export default function LyricsPanel({ lyrics, currentTime, isPlaying, defaultCollapsed = false }: LyricsPanelProps) {
    const [mode, setMode] = useState<Mode>('words');
    const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [saveError, setSaveError] = useState('');
    const [collapsed, setCollapsed] = useState(defaultCollapsed);
    const saveResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Compute all available modes (deriving synced and plain if word-sync exists)
    const available = useMemo<Mode[]>(() => {
        if (!lyrics) return [];
        const out: Mode[] = [];
        if (lyrics.words?.length) out.push('words');
        if (lyrics.synced?.length || lyrics.words?.length) out.push('synced');
        if (lyrics.plain?.trim() || lyrics.synced?.length || lyrics.words?.length) out.push('plain');
        if (lyrics.translation?.length) out.push('translation');
        return out;
    }, [lyrics]);

    const active: Mode = useMemo(() => {
        if (available.includes(mode)) return mode;
        return available[0] || 'plain';
    }, [available, mode]);

    const timeMs = typeof currentTime === 'number' && Number.isFinite(currentTime)
        ? Math.max(0, currentTime) * 1000
        : -1;

    const isTimelineActive = timeMs >= 0;

    // Line datasets with fallbacks
    const wordLines = active === 'words' ? lyrics?.words : undefined;

    const syncedLines = useMemo(() => {
        if (active !== 'synced') return undefined;
        if (lyrics?.synced?.length) return lyrics.synced;
        if (lyrics?.words?.length) return lyrics.words.map((l) => ({ t: l.t, text: l.text }));
        return undefined;
    }, [active, lyrics]);

    const translationLines = active === 'translation' ? lyrics?.translation : undefined;

    const plainText = useMemo(() => {
        if (lyrics?.plain?.trim()) return lyrics.plain;
        const fallback = lyrics?.synced || lyrics?.words;
        if (fallback?.length) return fallback.map((l) => l.text).join('\n');
        return '';
    }, [lyrics]);

    const syncedIndex = activeLineIndex(syncedLines, timeMs);
    const wordIndex = activeLineIndex(wordLines, timeMs);
    const translationIndex = activeLineIndex(translationLines, timeMs);

    useEffect(() => {
        setSaveState('idle');
        setSaveError('');
    }, [lyrics?.title, lyrics?.artist]);

    useEffect(() => {
        setCollapsed(defaultCollapsed);
    }, [lyrics?.title, lyrics?.artist, defaultCollapsed]);

    useEffect(() => () => {
        if (saveResetRef.current) clearTimeout(saveResetRef.current);
    }, []);

    const showTitle = lyrics?.displayTitle || lyrics?.title || '';
    const showArtist = lyrics?.displayArtist ?? lyrics?.artist ?? '';

    const handleSave = async () => {
        if (!lyrics || saveState === 'saving') return;

        setSaveState('saving');
        setSaveError('');

        try {
            const res = await window.electron.saveLyrics({
                title: lyrics.title,
                artist: lyrics.artist,
                displayTitle: showTitle,
                displayArtist: showArtist,
                duration: lyrics.duration,
                isMusic: true,
                mode: active
            });

            if (res?.cancelled) {
                setSaveState('idle');
                return;
            }

            if (res?.success) {
                setSaveState('saved');
            } else {
                setSaveState('error');
                setSaveError(res?.error || 'Could not save the lyrics.');
            }
        } catch (e: any) {
            setSaveState('error');
            setSaveError(e?.message || 'Could not save the lyrics.');
        }

        if (saveResetRef.current) clearTimeout(saveResetRef.current);
        saveResetRef.current = setTimeout(() => {
            setSaveState('idle');
            setSaveError('');
        }, 4000);
    };

    const scrollRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const container = scrollRef.current;
        if (!container || timeMs < 0) return;
        const el = container.querySelector<HTMLElement>('[data-active="true"]');
        if (!el) return;
        const target = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
        container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    }, [timeMs, active]);

    if (!lyrics || available.length === 0) return null;

    const timeline = wordLines || syncedLines || translationLines;

    return (
        <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="rounded-2xl border border-purple-500/25 bg-gradient-to-b from-purple-950/30 via-black/50 to-black/70 backdrop-blur-xl overflow-hidden shadow-2xl shadow-purple-950/30 transition-all duration-300"
            aria-label="Lyrics"
        >
            {/* Header: Title, Artist, Badges, Save, and Toggle */}
            <header className={`flex items-center justify-between gap-3 px-4 py-3 ${collapsed ? '' : 'border-b border-white/10 bg-white/[0.02]'}`}>
                <button
                    type="button"
                    onClick={() => setCollapsed((v) => !v)}
                    aria-expanded={!collapsed}
                    aria-label={collapsed ? 'Expand lyrics' : 'Collapse lyrics'}
                    className="flex items-center gap-2.5 min-w-0 flex-1 text-left group cursor-pointer"
                >
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-purple-500/30 to-pink-500/20 border border-purple-500/40 flex items-center justify-center text-purple-300 shadow-sm shrink-0 group-hover:scale-105 transition-transform">
                        <Music2 className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex items-center gap-2 overflow-hidden">
                        <span className="text-xs font-bold text-white tracking-wide shrink-0">Lyrics</span>
                        {available.includes('words') && (
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-purple-500/25 text-purple-300 border border-purple-500/35 whitespace-nowrap shrink-0 flex items-center gap-1">
                                <Sparkles className="w-2.5 h-2.5" />
                                Word-Sync
                            </span>
                        )}
                        {available.includes('synced') && !available.includes('words') && (
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-blue-500/25 text-blue-300 border border-blue-500/35 whitespace-nowrap shrink-0">
                                Synced
                            </span>
                        )}
                        <span className="text-[11px] text-white/50 truncate min-w-0 hidden sm:inline" title={showTitle}>
                            • {showTitle}{showArtist && ` (${showArtist})`}
                        </span>
                    </div>
                </button>

                {/* Right Header Action Controls */}
                <div className="flex items-center gap-2 shrink-0">
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={saveState === 'saving'}
                        title={`Save ${TABS.find((t) => t.id === active)?.label.toLowerCase() || 'lyrics'} to a file`}
                        aria-label="Save lyrics"
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold uppercase text-white/70 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-50 transition-all cursor-pointer shadow-sm hover:border-purple-400/30"
                    >
                        {saveState === 'saving' ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" />
                        ) : saveState === 'saved' ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : saveState === 'error' ? (
                            <span className="text-red-400 font-bold" title={saveError}>!</span>
                        ) : (
                            <Download className="w-3.5 h-3.5 text-purple-300" />
                        )}
                        <span className="hidden sm:inline whitespace-nowrap">
                            {saveState === 'saved' ? 'Saved' : 'Save'}
                        </span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setCollapsed((v) => !v)}
                        aria-label={collapsed ? 'Expand lyrics' : 'Collapse lyrics'}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-white hover:bg-white/5 transition-all cursor-pointer"
                    >
                        <ChevronDown
                            className={`w-4 h-4 transition-transform duration-200 ${collapsed ? '' : 'rotate-180 text-white/70'}`}
                        />
                    </button>
                </div>
            </header>

            {/* Expanded Body: Segmented Tab Bar & Lyrics Content */}
            {!collapsed && (
                <React.Fragment>
                    {/* Segmented Control Bar */}
                    <div className="px-4 pt-3 pb-2 border-b border-white/5 bg-white/[0.01] flex items-center justify-between gap-2 flex-wrap">
                        <div className="inline-flex p-1 rounded-xl bg-white/[0.04] border border-white/10 shadow-inner">
                            {TABS.filter((t) => available.includes(t.id)).map((tab) => {
                                const Icon = tab.icon;
                                const isActive = active === tab.id;
                                return (
                                    <button
                                        key={tab.id}
                                        type="button"
                                        onClick={() => setMode(tab.id)}
                                        title={`${tab.label} lyrics`}
                                        aria-pressed={isActive}
                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                                            isActive
                                                ? 'bg-gradient-to-r from-purple-500 to-indigo-500 text-white shadow-md shadow-purple-500/25 border border-purple-400/40'
                                                : 'text-white/55 hover:text-white hover:bg-white/5 border border-transparent'
                                        }`}
                                    >
                                        <Icon className="w-3.5 h-3.5" />
                                        <span>{tab.label}</span>
                                    </button>
                                );
                            })}
                        </div>

                        {/* Format Indicator / Timing info */}
                        <div className="text-[11px] text-white/40 hidden md:block">
                            {active === 'words' && `${wordLines?.length ?? 0} word-timed lines`}
                            {active === 'synced' && `${syncedLines?.length ?? 0} synced lines`}
                            {active === 'plain' && 'Full plain lyrics'}
                            {active === 'translation' && `${translationLines?.length ?? 0} translated lines`}
                        </div>
                    </div>

                    {saveState === 'error' && saveError && (
                        <p role="alert" className="px-4 py-2 text-xs text-red-400 bg-red-500/10 border-b border-red-500/20">
                            {saveError}
                        </p>
                    )}

                    {/* Scrollable Lyrics Container with expanded height */}
                    <div
                        ref={scrollRef}
                        className="max-h-[380px] min-h-[220px] overflow-y-auto px-4 py-3 custom-scrollbar"
                    >
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={active}
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -4 }}
                                transition={{ duration: 0.15 }}
                            >
                                {/* Plain Lyrics */}
                                {active === 'plain' && plainText && (
                                    <div className="text-[14px] leading-loose text-white/80 space-y-1">
                                        {plainLines(plainText).map((line, i) => (
                                            <p key={i} className={line.gapBefore ? 'pt-3' : undefined}>
                                                {line.text}
                                            </p>
                                        ))}
                                    </div>
                                )}

                                {/* Line-by-Line Synced Lyrics */}
                                {active === 'synced' && (
                                    <ol className="space-y-1.5 text-[14px] leading-relaxed">
                                        {(syncedLines || []).map((line, i) => {
                                            const isActive = i === syncedIndex && isPlaying !== false;
                                            return (
                                                <li
                                                    key={`${line.t}-${i}`}
                                                    data-active={isActive}
                                                    className={`flex items-start gap-3 rounded-xl px-2.5 py-1.5 transition-all duration-200 ${
                                                        isActive
                                                            ? 'text-purple-300 bg-purple-500/20 border border-purple-500/35 font-semibold shadow-sm'
                                                            : isTimelineActive
                                                                ? 'text-white/40'
                                                                : 'text-white/80 hover:text-white'
                                                    }`}
                                                >
                                                    <span className="text-[11px] tabular-nums text-white/35 pt-0.5 shrink-0 w-9 text-right font-mono">
                                                        {formatStamp(line.t)}
                                                    </span>
                                                    <span className="flex-1">{line.text}</span>
                                                </li>
                                            );
                                        })}
                                    </ol>
                                )}

                                {/* Word-by-Word Synced Lyrics */}
                                {active === 'words' && (
                                    <ol className="space-y-1.5 text-[14.5px] leading-relaxed">
                                        {(wordLines || []).map((line, i) => {
                                            const isActive = i === wordIndex && isPlaying !== false;
                                            return (
                                                <li
                                                    key={`${line.t}-${i}`}
                                                    data-active={isActive}
                                                    className={`rounded-xl px-2.5 py-1.5 transition-all duration-200 ${
                                                        isActive
                                                            ? 'bg-purple-500/20 border border-purple-500/35 text-white font-medium shadow-sm'
                                                            : isTimelineActive
                                                                ? 'text-white/40'
                                                                : 'text-white/80 hover:text-white'
                                                    }`}
                                                >
                                                    {line.words?.length ? (
                                                        <span className="inline whitespace-pre-wrap">
                                                            {formatWordsWithNaturalSpacing(line.words).map(
                                                                ({ word, spaceBefore }, wi) => {
                                                                    const wordActive =
                                                                        isActive &&
                                                                        timeMs >= word.t &&
                                                                        timeMs < word.t + Math.max(word.d, 120);
                                                                    return (
                                                                        <React.Fragment key={`${word.t}-${wi}`}>
                                                                            {spaceBefore && ' '}
                                                                            <span
                                                                                className={`transition-colors duration-150 ${
                                                                                    wordActive
                                                                                        ? 'text-purple-300 font-bold drop-shadow-[0_0_10px_rgba(192,132,252,0.7)]'
                                                                                        : ''
                                                                                }`}
                                                                            >
                                                                                {word.w.trim()}
                                                                            </span>
                                                                        </React.Fragment>
                                                                    );
                                                                }
                                                            )}
                                                        </span>
                                                    ) : (
                                                        <span>{line.text}</span>
                                                    )}
                                                </li>
                                            );
                                        })}
                                    </ol>
                                )}

                                {/* Translation Lyrics */}
                                {active === 'translation' && (
                                    <ol className="space-y-1.5 text-[14px] leading-relaxed">
                                        {(translationLines || []).map((line, i) => {
                                            const isActive = i === translationIndex && isPlaying !== false;
                                            return (
                                                <li
                                                    key={`${line.t}-${i}`}
                                                    data-active={isActive}
                                                    className={`rounded-xl px-2.5 py-1.5 transition-all duration-200 ${
                                                        isActive
                                                            ? 'text-purple-300 bg-purple-500/20 border border-purple-500/35 font-semibold'
                                                            : isTimelineActive
                                                                ? 'text-white/40'
                                                                : 'text-white/80 hover:text-white'
                                                    }`}
                                                >
                                                    {line.text}
                                                </li>
                                            );
                                        })}
                                    </ol>
                                )}
                            </motion.div>
                        </AnimatePresence>

                        {/* Simultaneous original lyric hint in translation tab */}
                        {active === 'translation' && syncedIndex >= 0 && syncedLines?.[syncedIndex] && (
                            <p className="mt-3 pt-2.5 border-t border-white/10 text-xs text-white/40 italic">
                                {syncedLines[syncedIndex].text}
                            </p>
                        )}
                    </div>

                    {/* Footer Info */}
                    {timeline && timeline.length > 0 && (
                        <footer className="px-4 py-2 border-t border-white/5 text-[11px] text-white/30 flex items-center justify-between bg-black/20">
                            <span>
                                {active === 'words'
                                    ? `${wordLines?.length ?? 0} word-timed lines`
                                    : `${timeline.length} lines`}
                            </span>
                            {timeMs >= 0 && (
                                <span className="tabular-nums font-mono text-purple-300/70">{formatStamp(timeMs)}</span>
                            )}
                        </footer>
                    )}
                </React.Fragment>
            )}
        </motion.section>
    );
}
