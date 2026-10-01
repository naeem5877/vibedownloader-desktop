/**
 * Lyrics panel.
 *
 * Only mount this when `lyrics` is non-null - the parent enforces that, and
 * this component renders nothing at all for null. That is the whole point of
 * the rule: no match means no panel, no badge, no placeholder, because an
 * empty lyrics box is worse than no lyrics box.
 *
 * Four formats arrive independently, so each tab is shown only when its data
 * exists. The common case is LRCLIB's plain plus line-synced with no
 * word-level data, since NetEase publishes `yrc` for only about three quarters
 * of popular tracks.
 *
 * Synced lyrics highlight the current line while audio plays, and word-level
 * lyrics highlight the current word inside it. The caller passes the playback
 * position in seconds; nothing here reads the audio itself, so the panel stays
 * usable in preview and after download alike.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Languages, Music2, Type, AlignLeft, Download, Loader2, Check } from 'lucide-react';

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
    /**
     * What the header shows. `title`/`artist` are the strings that matched, so
     * they are normalized and may be a credit line - not display-ready.
     */
    displayTitle?: string;
    displayArtist?: string;
    /** Track length in seconds. Sent with a save so the main process can re-resolve. */
    duration?: number;
}

type Mode = 'plain' | 'synced' | 'words' | 'translation';

interface LyricsPanelProps {
    lyrics: LyricsData | null;
    /** Playback position in seconds. Omit to disable the highlight. */
    currentTime?: number;
    isPlaying?: boolean;
}

const TABS: { id: Mode; label: string; icon: typeof Type }[] = [
    { id: 'words', label: 'Words', icon: Music2 },
    { id: 'synced', label: 'Synced', icon: AlignLeft },
    { id: 'plain', label: 'Plain', icon: Type },
    { id: 'translation', label: 'Translation', icon: Languages }
];

/**
 * Index of the last line at or before `time`, or -1.
 *
 * Scans rather than binary-searching because lyrics lists are short (typically
 * under 100 lines) and this runs on every time update.
 */
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

/**
 * Plain lyrics split into display rows, one per line.
 *
 * The payload is already structured one lyric per line, so it is rendered that
 * way. Collapsing it into paragraphs - which is what this used to do - ran 90
 * lines of `Shape of You` together into an unreadable wall of text and threw
 * away the verse/chorus breaks the provider supplied.
 *
 * A blank line becomes `gapBefore` rather than an empty row, so stanza breaks
 * read as space instead of adding stray vertical rhythm.
 */
function plainLines(text: string): { text: string; gapBefore: boolean }[] {
    const out: { text: string; gapBefore: boolean }[] = [];
    let gap = false;

    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) {
            // Only a separator if some text has already been emitted, so leading
            // blank lines do not indent the first lyric.
            gap = out.length > 0;
            continue;
        }
        out.push({ text: line, gapBefore: gap });
        gap = false;
    }

    return out;
}

export default function LyricsPanel({ lyrics, currentTime, isPlaying }: LyricsPanelProps) {
    // The translation toggle is only relevant when a translation exists, and it
    // starts off so it never changes the panel height until asked for.
    const [mode, setMode] = useState<Mode>('words');
    const [showTranslation, setShowTranslation] = useState(false);

    // Save state is per-panel and self-clearing: a confirmation that lingers
    // would be reporting a file that was written seconds or minutes ago.
    const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [saveError, setSaveError] = useState('');
    const saveResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const available = useMemo<Mode[]>(() => {
        if (!lyrics) return [];
        const out: Mode[] = [];
        if (lyrics.words?.length) out.push('words');
        if (lyrics.synced?.length) out.push('synced');
        if (lyrics.plain?.trim()) out.push('plain');
        if (lyrics.translation?.length) out.push('translation');
        return out;
    }, [lyrics]);

    // Fall back to whatever this track actually has, so a lyrics-only track
    // never opens on an empty tab.
    const active: Mode = useMemo(() => {
        if (showTranslation && available.includes('translation')) return 'translation';
        if (available.includes(mode)) return mode;
        return available[0] || 'plain';
    }, [available, mode, showTranslation]);

    const timeMs = typeof currentTime === 'number' && Number.isFinite(currentTime)
        ? Math.max(0, currentTime) * 1000
        : -1;

    const syncedLines = active === 'synced' ? lyrics?.synced : undefined;
    const wordLines = active === 'words' ? lyrics?.words : undefined;
    const translationLines = active === 'translation' ? lyrics?.translation : undefined;

    const syncedIndex = activeLineIndex(syncedLines, timeMs);
    const wordIndex = activeLineIndex(wordLines, timeMs);
    const translationIndex = activeLineIndex(translationLines, timeMs);

    // A new track invalidates any previous save confirmation.
    useEffect(() => {
        setSaveState('idle');
        setSaveError('');
    }, [lyrics?.title, lyrics?.artist]);

    useEffect(() => () => {
        if (saveResetRef.current) clearTimeout(saveResetRef.current);
    }, []);

    /**
     * Save whichever tab is on screen.
     *
     * The panel hands over only what identifies the track and which format the
     * user is looking at; the main process re-runs the lookup so the file always
     * matches what was displayed. A dismissed dialog reports `cancelled`, which
     * is not an error and must not leave an error message on screen.
     */
    const handleSave = async () => {
        if (!lyrics || saveState === 'saving') return;

        setSaveState('saving');
        setSaveError('');

        try {
            // `title`/`artist` are the strings that matched, which is what the main
            // process needs to re-resolve the track. The display strings travel
            // alongside so the file is named for the track rather than for the
            // raw upload title.
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

    // Keep the active line in view without yanking the page around.
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

    const hasTranslation = Boolean(lyrics.translation?.length);
    const timeline = wordLines || syncedLines || translationLines;

    // The match strings are normalized and may be a credit line; these are the
    // cleaned ones the main process derived from the original metadata.
    const showTitle = lyrics.displayTitle || lyrics.title;
    const showArtist = lyrics.displayArtist ?? lyrics.artist;

    return (
        <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="rounded-xl border border-white/10 bg-black/20 backdrop-blur-sm overflow-hidden"
            aria-label="Lyrics"
        >
            <header className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
                <Type className="w-3.5 h-3.5 text-white/50 shrink-0" />
                <span className="text-[11px] font-semibold text-white/70 truncate" title={showTitle}>
                    {showTitle}
                </span>
                {showArtist && (
                    <span className="text-[11px] text-white/35 truncate" title={showArtist}>
                        - {showArtist}
                    </span>
                )}

                <div className="ml-auto flex items-center gap-1">
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={saveState === 'saving'}
                        title={`Save ${TABS.find((t) => t.id === active)?.label.toLowerCase() || 'plain'} lyrics to a file`}
                        aria-label="Save lyrics"
                        className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold uppercase text-white/40 hover:text-white/70 disabled:opacity-50 transition-all"
                    >
                        {saveState === 'saving' ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                        ) : saveState === 'saved' ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                        ) : saveState === 'error' ? (
                            <span className="text-red-400" title={saveError}>!</span>
                        ) : (
                            <Download className="w-3 h-3" />
                        )}
                        <span className="hidden sm:inline">
                            {saveState === 'saved' ? 'Saved' : 'Save'}
                        </span>
                    </button>

                    {TABS.filter((t) => available.includes(t.id)).map((tab) => {
                        const Icon = tab.icon;
                        const isActive = active === tab.id;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => {
                                    setShowTranslation(tab.id === 'translation');
                                    setMode(tab.id);
                                }}
                                title={`${tab.label} lyrics`}
                                aria-pressed={isActive}
                                className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold uppercase transition-all ${
                                    isActive
                                        ? 'bg-blue-500 text-white shadow-sm'
                                        : 'text-white/40 hover:text-white/70'
                                }`}
                            >
                                <Icon className="w-3 h-3" />
                                <span className="hidden sm:inline">{tab.label}</span>
                            </button>
                        );
                    })}
                </div>
            </header>

            {hasTranslation && active !== 'translation' && (
                <button
                    type="button"
                    onClick={() => setShowTranslation((v) => !v)}
                    className="w-full text-left px-3 py-1.5 text-[10px] font-semibold uppercase text-white/40 hover:text-white/70 border-b border-white/5 transition-colors"
                >
                    {showTranslation ? 'Hide translation' : 'Show translation'}
                </button>
            )}

            {saveState === 'error' && saveError && (
                <p
                    role="alert"
                    className="px-3 py-1.5 text-[11px] text-red-400 border-b border-white/5"
                >
                    {saveError}
                </p>
            )}

            <div ref={scrollRef} className="max-h-64 overflow-y-auto px-3 py-2.5">
                <AnimatePresence mode="wait">
                    <motion.div
                        key={active}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                    >
                        {active === 'plain' && lyrics.plain && (
                            <div className="text-[13px] leading-relaxed text-white/70">
                                {plainLines(lyrics.plain).map((line, i) => (
                                    <p
                                        key={i}
                                        className={line.gapBefore ? 'mt-3' : undefined}
                                    >
                                        {line.text}
                                    </p>
                                ))}
                            </div>
                        )}

                        {active === 'synced' && (
                            <ol className="space-y-1 text-[13px] leading-relaxed">
                                {(syncedLines || []).map((line, i) => {
                                    const isActive = i === syncedIndex && isPlaying !== false;
                                    return (
                                        <li
                                            key={`${line.t}-${i}`}
                                            data-active={isActive}
                                            className={`flex gap-2.5 rounded px-1.5 py-0.5 transition-colors duration-200 ${
                                                isActive
                                                    ? 'text-blue-400 bg-blue-500/10 font-semibold'
                                                    : 'text-white/45'
                                            }`}
                                        >
                                            <span className="text-[10px] tabular-nums text-white/25 pt-0.5 shrink-0 w-8 text-right">
                                                {formatStamp(line.t)}
                                            </span>
                                            <span>{line.text}</span>
                                        </li>
                                    );
                                })}
                            </ol>
                        )}

                        {active === 'words' && (
                            <ol className="space-y-1.5 text-[14px] leading-relaxed">
                                {(wordLines || []).map((line, i) => {
                                    const isActive = i === wordIndex && isPlaying !== false;
                                    return (
                                        <li
                                            key={`${line.t}-${i}`}
                                            data-active={isActive}
                                            className={`rounded px-1.5 py-0.5 transition-colors duration-200 ${
                                                isActive
                                                    ? 'bg-blue-500/10 text-white'
                                                    : 'text-white/45'
                                            }`}
                                        >
                                            {line.words?.length ? (
                                                <span className="flex flex-wrap gap-x-1.5">
                                                    {line.words.map((word, wi) => {
                                                        const wordActive =
                                                            isActive &&
                                                            timeMs >= word.t &&
                                                            timeMs < word.t + Math.max(word.d, 120);
                                                        return (
                                                            <span
                                                                key={`${word.t}-${wi}`}
                                                                className={`transition-colors duration-150 ${
                                                                    wordActive
                                                                        ? 'text-blue-400 font-semibold'
                                                                        : ''
                                                                }`}
                                                            >
                                                                {word.w}
                                                            </span>
                                                        );
                                                    })}
                                                </span>
                            ) : (
                                                <span>{line.text}</span>
                                            )}
                                        </li>
                                    );
                                })}
                            </ol>
                        )}

                        {active === 'translation' && (
                            <ol className="space-y-1 text-[13px] leading-relaxed">
                                {(translationLines || []).map((line, i) => {
                                    const isActive = i === translationIndex && isPlaying !== false;
                                    return (
                                        <li
                                            key={`${line.t}-${i}`}
                                            data-active={isActive}
                                            className={`rounded px-1.5 py-0.5 transition-colors duration-200 ${
                                                isActive
                                                    ? 'text-blue-400 bg-blue-500/10'
                                                    : 'text-white/45'
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

                {active === 'translation' && syncedIndex >= 0 && syncedLines?.[syncedIndex] && (
                    <p className="mt-3 pt-2.5 border-t border-white/5 text-[12px] text-white/35 italic">
                        {syncedLines[syncedIndex].text}
                    </p>
                )}
            </div>

            {timeline && timeline.length > 0 && timeMs >= 0 && (
                <footer className="px-3 py-1.5 border-t border-white/5 text-[10px] text-white/25 flex items-center justify-between">
                    <span>
                        {active === 'words'
                            ? `${wordLines?.length ?? 0} word-timed lines`
                            : `${timeline.length} lines`}
                    </span>
                    <span className="tabular-nums">{formatStamp(timeMs)}</span>
                </footer>
            )}
        </motion.section>
    );
}
