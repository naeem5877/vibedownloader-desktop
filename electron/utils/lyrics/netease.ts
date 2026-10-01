/**
 * NetEase Cloud Music client for word-by-word and translated lyrics.
 *
 * Unofficial, unversioned, China-based. Every entry point here is best-effort:
 * each one catches its own failure and returns null, because the orchestrator
 * must still render LRCLIB's plain and line-synced lyrics when NetEase is
 * unreachable, rate-limited, or has simply changed shape.
 *
 * `yrc` is the only source of word-level timing in the feature, and coverage is
 * partial. A 12-track sample after strict filtering gave 9 word-level,
 * 2 line-only and 1 no match - `Shape of You` and `Kesariya` are line-only
 * despite being among the most popular songs in the world. So the word tab is
 * hidden when `yrc` is absent rather than showing an empty one.
 */

import type { LyricLine, LyricsProvider } from './types';
import { parseYrc, parseLrc, isUsableTimeline } from './parsers';
import { titleScore, artistScore, isVariantTitle } from './normalize';

const BASE = 'https://music.163.com/api';

/**
 * Referer is required. The API rejects requests without it, and a desktop UA is
 * paired with it because the mobile origin serves a different payload.
 */
const HEADERS = {
    Referer: 'https://music.163.com/',
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Content-Type': 'application/x-www-form-urlencoded'
};

export interface NeteaseMatch {
    words?: LyricLine[];
    translation?: LyricLine[];
    provider: LyricsProvider;
}

/** Search the catalogue for the best-matching song id. */
async function findSongId(
    query: { title: string; artist: string },
    timeoutMs: number
): Promise<number | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const body = new URLSearchParams({
            s: `${query.artist} ${query.title}`,
            type: '1',
            offset: '0',
            total: 'true',
            limit: '20'
        }).toString();

        const res = await fetch(`${BASE}/search/get`, {
            method: 'POST',
            headers: HEADERS,
            body,
            signal: controller.signal
        });
        if (!res.ok) return null;

        const json: any = await res.json();
        const songs = json?.result?.songs;
        if (!Array.isArray(songs) || songs.length === 0) return null;

        let bestId: number | null = null;
        let bestScore = 0;

        for (const song of songs) {
            if (!song?.id || !song?.name) continue;

            // The same variant guard as LRCLIB. NetEase catalogues remix and
            // live cuts heavily, and a wrong pick here yields wrong word
            // timings, which look even more authoritative than plain text.
            const artists = (song.artists || song.ar || [])
                .map((a: any) => a?.name)
                .filter(Boolean)
                .join(', ');
            if (isVariantTitle(song.name)) continue;

            const t = titleScore(query.title, song.name);
            if (t < 0.62) continue;
            const a = artistScore(query.artist, artists);
            if (a < 0.5) continue;

            const score = t * 0.7 + a * 0.3;
            if (score > bestScore) {
                bestScore = score;
                bestId = song.id;
            }
        }

        return bestId;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Unwrap one lyric field from the response.
 *
 * Verified against the live API, this is not a bare string. Every lyric field
 * arrives as `{ version, lyric }`, and the payload inside is *hybrid*: the first
 * few lines are JSON credit metadata (`{"t":0,"c":[{"tx":"作词: "}, ...]}`) and
 * the actual timed lyrics follow as plain yrc or LRC text. Both halves coexist
 * in one string, which is why the parsers are tolerant of lines they cannot
 * read - the credit lines are simply skipped.
 *
 * Accepts a bare string too, since that is the shape the endpoint used to
 * return and a future revert should not silently produce empty lyrics.
 */
function lyricText(field: unknown): string {
    if (typeof field === 'string') return field;
    if (field && typeof field === 'object' && typeof (field as any).lyric === 'string') {
        return (field as any).lyric;
    }
    return '';
}

/**
 * Fetch and parse `yrc` and `tlyric` for one song id.
 *
 * `tlyric` arrives in the same response as `yrc`, so the translation costs no
 * extra request. `yrc` is genuinely absent for many popular tracks - verified
 * absent for `Shape of You` and `Kesariya` - so an absent key means "line-level
 * only", not "provider failure".
 */
async function fetchLyrics(
    songId: number,
    timeoutMs: number
): Promise<{ words?: LyricLine[]; translation?: LyricLine[] }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        // The `/v1` path is required. The legacy `/api/song/lyric` endpoint
        // never returned a `yrc` field at all, so it is not a fallback - it
        // simply does not carry word-level data.
        const url =
            `${BASE}/song/lyric/v1?cp=false&id=${songId}` +
            '&tv=0&lv=0&rv=0&kv=0&yv=0&ytv=0&yrv=0';

        const res = await fetch(url, { headers: HEADERS, signal: controller.signal });
        if (!res.ok) return {};

        const json: any = await res.json();

        const words = parseYrc(lyricText(json?.yrc));
        const translation = parseLrc(lyricText(json?.tlyric));

        return {
            words: isUsableTimeline(words) ? words : undefined,
            translation: isUsableTimeline(translation) ? translation : undefined
        };
    } catch {
        return {};
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Best-effort NetEase lookup.
 *
 * Returns null when the song cannot be identified, and an object with no
 * `words` when it can be but only has line-level data - the caller distinguishes
 * those by checking `words`, and hides the word tab either way.
 */
export async function fetchNetease(
    query: { title: string; artist: string },
    timeoutMs = 5000
): Promise<NeteaseMatch | null> {
    if (!query.title || !query.artist) return null;

    const songId = await findSongId(query, timeoutMs);
    if (songId === null) return null;

    const { words, translation } = await fetchLyrics(songId, timeoutMs);

    if (!words && !translation) return null;

    return { words, translation, provider: 'netease' };
}
