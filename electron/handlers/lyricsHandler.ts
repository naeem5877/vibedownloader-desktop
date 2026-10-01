/**
 * IPC handler for lyric lookups.
 *
 * The handler is the only place that decides *whether* to look at all, and it
 * deliberately returns `null` for anything that is not a music track. That
 * keeps the "no lyrics = no UI" rule enforceable in one place instead of
 * relying on every caller to check.
 *
 * The lookup itself is best-effort and never throws: a provider outage, a
 * timeout, or malformed input all resolve to `null`, because the renderer asks
 * a question it is happy to get no answer to.
 */

import { ipcMain, dialog, app, shell, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import { getLyrics } from '../utils/lyrics';
import { buildLyricsFile } from '../utils/lyrics/format';
import type { ExportMode } from '../utils/lyrics/format';
import type { LyricsResult } from '../utils/lyrics/types';

/** Providers are budgeted internally; this only bounds the whole IPC call. */
const TOTAL_TIMEOUT_MS = 12_000;

/**
 * A caller-supplied title can be anything the user pasted, so it is bounded
 * before it reaches a URL or a scoring loop.
 */
const MAX_FIELD = 300;

function cleanField(value: unknown, max = MAX_FIELD): string {
    if (typeof value !== 'string') return '';
    return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function toDuration(value: unknown): number | undefined {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return Math.min(n, 24 * 3600);
}

/**
 * True when the metadata represents something with lyrics worth looking up.
 *
 * Mirrors the detection in `infoHandler.ts` rather than replacing it: a
 * `music.youtube.com` host, a `Music` category, or a `-Topic` uploader. The
 * caller passes the already-computed flag so the two cannot drift, and this
 * guards the shape in case a caller sends raw values instead.
 */
function isMusicCandidate(payload: any): boolean {
    if (payload?.isMusic === true) return true;
    if (payload?.isMusic === false) return false;

    const uploader = cleanField(payload?.uploader);
    const categories = Array.isArray(payload?.categories) ? payload.categories : [];
    return (
        uploader.endsWith('-Topic') ||
        categories.some((c: unknown) => String(c).toLowerCase() === 'music')
    );
}

/** The four formats a tab can export, so an unexpected value is rejected. */
function isExportMode(value: unknown): value is ExportMode {
    return value === 'plain' || value === 'synced' || value === 'words' || value === 'translation';
}

/** Resolves with a value, or `null` if the whole call overruns its budget. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
    return new Promise<T | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), ms);
        work
            .then((v) => {
                clearTimeout(timer);
                resolve(v);
            })
            .catch(() => {
                clearTimeout(timer);
                resolve(null);
            });
    });
}

export function registerLyricsHandlers() {
    ipcMain.handle(
        'get-lyrics',
        async (_event: any, payload: any): Promise<LyricsResult | null> => {
            try {
                if (!isMusicCandidate(payload)) return null;

                const title = cleanField(payload?.title);
                const artist = cleanField(payload?.artist);
                if (!title || !artist) return null;

                const duration = toDuration(payload?.duration);

                return await withTimeout(getLyrics({ title, artist, duration }), TOTAL_TIMEOUT_MS);
            } catch (e: any) {
                // A lyrics lookup must never surface an error to the user.
                console.error('lyrics lookup failed:', e?.message || e);
                return null;
            }
        }
    );

    /**
     * Write the lyrics the user is currently looking at to a file.
     *
     * The payload is re-resolved here rather than trusted from the renderer: a
     * save request can arrive for a track the user has already navigated away
     * from, and the cached result in the renderer would then write the wrong
     * lyrics to disk. Re-running the lookup is one request, and it guarantees
     * the file matches what the panel was showing when they pressed the button.
     *
     * A save dialog is used rather than a fixed folder, because lyrics are a
     * personal artefact and people keep them wherever they keep their notes.
     */
    ipcMain.handle(
        'save-lyrics',
        async (event: any, payload: any): Promise<{ success: boolean; path?: string; cancelled?: boolean; error?: string }> => {
            try {
                if (!isMusicCandidate(payload)) {
                    return { success: false, error: 'These are not lyrics for a music track.' };
                }

                const title = cleanField(payload?.title);
                const artist = cleanField(payload?.artist);
                if (!title || !artist) {
                    return { success: false, error: 'Missing the track title or artist.' };
                }

                const mode = payload?.mode;
                if (!isExportMode(mode)) {
                    return { success: false, error: 'Unknown lyrics format.' };
                }

                const duration = toDuration(payload?.duration);
                const result = await withTimeout(getLyrics({ title, artist, duration }), TOTAL_TIMEOUT_MS);
                if (!result) {
                    return { success: false, error: 'No lyrics were found for this track.' };
                }

                // Name the file after the track as the panel displays it. `displayTitle`
                // carries the credits and channel cut ("Ae Ajnabee", not "Ae
                // Ajnabee (Official Music Video) - Aditya Rikhari, Ravator |
                // Coke Studio Bharat") and `displayArtist` restores the original
                // casing that normalization lowercased, so a save yields
                // "Aditya Rikhari - Ae Ajnabee.lrc" rather than
                // "aditya rikhari, ravator, kutle khan - Ae Ajnabee.lrc".
                const shownTitle = cleanField(payload?.displayTitle) || title;
                const shownArtist = cleanField(payload?.displayArtist) || artist;
                const file = buildLyricsFile(result, mode, shownTitle, shownArtist);
                if (!file) {
                    return { success: false, error: `This track has no ${mode} lyrics to save.` };
                }

                const win = BrowserWindow.fromWebContents(event?.sender) ?? undefined;
                const chosen = await dialog.showSaveDialog(win as any, {
                    title: 'Save lyrics',
                    defaultPath: path.join(app.getPath('downloads'), file.filename),
                    filters: file.filename.endsWith('.lrc')
                        ? [{ name: 'LRC lyrics', extensions: ['lrc'] }]
                        : [{ name: 'Text', extensions: ['txt'] }]
                });

                if (chosen.canceled || !chosen.filePath) {
                    return { success: true, cancelled: true };
                }

                fs.writeFileSync(chosen.filePath, file.content, 'utf-8');
                shell.showItemInFolder(chosen.filePath);

                return { success: true, path: chosen.filePath };
            } catch (e: any) {
                console.error('lyrics save failed:', e?.message || e);
                return { success: false, error: 'Could not save the lyrics file.' };
            }
        }
    );
}
