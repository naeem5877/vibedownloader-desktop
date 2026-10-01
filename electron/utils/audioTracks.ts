/**
 * Audio-language track discovery for the metadata the app already fetches.
 *
 * Most YouTube videos publish exactly one audio language, and for those there
 * is nothing to choose and the picker stays hidden. Dubbed content is the
 * exception: a dubbed feature publishes the original plus one or more dubbed
 * languages, and YouTube gives each language its own set of audio formats. A
 * real example (`DV9pVzqQPR0`) publishes 3 languages across 18 audio-only
 * formats:
 *
 *   139-0  m4a  mp4a.40.5  49k  Bangla, low
 *   139-1  m4a  mp4a.40.5  49k  English (US), low
 *   139-2  m4a  mp4a.40.5  49k  Hindi original (default), low
 *   140-0  m4a  mp4a.40.2 129k  Bangla, medium
 *   ...
 *   251-1  webm opus      124k  Bangla, medium
 *
 * The `-N` suffix is a per-format index and is NOT stable across base ids:
 * `139-0` is Bangla but `249-0` is English, so a language can never be
 * recovered from the id. The explicit `language` field is the only reliable
 * key, which is why every format is read rather than parsed apart.
 */

import { languageLabel } from './subtitles';

export interface AudioTrack {
    /** Unique per track, and stable for a given video. */
    key: string;
    /** yt-dlp language code, e.g. `en-US`, `bn`, `hi`. */
    lang: string;
    /** Human name, e.g. "Bangla", "American English", "Hindi". */
    langLabel: string;
    /** True for the language the video was recorded in. */
    isOriginal: boolean;
    /** yt-dlp format id to download, e.g. `140-1`. */
    formatId: string;
    /** Container of the chosen format. */
    ext: string;
    /** Audio codec, e.g. `mp4a.40.2`. */
    acodec: string;
    /** Approximate bitrate in kbps, 0 when YouTube does not report one. */
    abr: number;
}

/** Stable identity for a track. A language is published once, so the code is enough. */
export function audioTrackKey(lang: string): string {
    return `audio:${lang}`;
}

/**
 * AAC is preferred over Opus because media downloads are muxed to MP4, and an
 * Opus stream has to be re-encoded on the way in while AAC does not. Only when
 * a language publishes no AAC at all do we fall back to Opus.
 */
function codecRank(acodec: string): number {
    if (/^mp4a/i.test(acodec)) return 0;
    if (/opus/i.test(acodec)) return 1;
    return 2;
}

/** A format that is audio on its own, which is what a per-language download needs. */
function isAudioOnly(f: any): boolean {
    if (!f || typeof f !== 'object') return false;
    // HLS variants (233-*, 234-*) carry video and audio in one manifest, so they
    // cannot be paired with a separately chosen video format.
    if (f.protocol && f.protocol !== 'https') return false;
    if (!f.format_id) return false;
    if (f.vcodec !== 'none') return false;
    if (!f.acodec || f.acodec === 'none') return false;
    // Dubbed tracks always carry a language; the single-language case does not
    // need to be looked at twice.
    if (!f.language || typeof f.language !== 'string') return false;
    return true;
}

const bitrate = (f: any): number => Math.round(Number(f.abr ?? f.tbr ?? 0) || 0);

/**
 * The original track is the one YouTube marks as the default. It is reported
 * two ways depending on the video, so both are honoured: a `language_preference`
 * of 10, and the wording YouTube puts in the format note.
 */
function isOriginal(f: any): boolean {
    if (Number(f.language_preference) >= 0) return true;
    return /\boriginal\b|\bdefault\b/i.test(String(f.format_note || ''));
}

/**
 * Best available audio format for one language, or null when it publishes none.
 * Bitrate breaks codec ties, so a language offered in several encodings still
 * resolves to a single deterministic choice.
 */
function bestFormat(formats: any[], lang: string): any | null {
    const candidates = formats.filter((f) => isAudioOnly(f) && f.language === lang);
    if (candidates.length === 0) return null;

    let best = candidates[0];
    for (const f of candidates.slice(1)) {
        const better =
            codecRank(f.acodec) < codecRank(best.acodec)
            || (codecRank(f.acodec) === codecRank(best.acodec) && bitrate(f) > bitrate(best));
        if (better) best = f;
    }
    return best;
}

/**
 * One entry per audio language, original first so the default selection is the
 * language the video was actually recorded in, then alphabetical.
 *
 * Returns an empty list unless the video publishes more than one language.
 * That is what keeps the picker out of the UI for the overwhelming majority of
 * videos, which have a single audio track and nothing to offer.
 */
export function buildAudioTrackList(raw: any): AudioTrack[] {
    const formats: any[] = Array.isArray(raw?.formats) ? raw.formats : [];
    if (formats.length === 0) return [];

    const langs = [...new Set(
        formats.filter(isAudioOnly).map((f) => String(f.language))
    )];

    if (langs.length < 2) return [];

    const tracks: AudioTrack[] = [];
    for (const lang of langs) {
        const f = bestFormat(formats, lang);
        if (!f) continue;
        tracks.push({
            key: audioTrackKey(lang),
            lang,
            langLabel: languageLabel(lang),
            isOriginal: isOriginal(f),
            formatId: String(f.format_id),
            ext: String(f.ext || ''),
            acodec: String(f.acodec || ''),
            abr: bitrate(f)
        });
    }

    if (tracks.length < 2) return [];

    return tracks.sort((a, b) => (
        Number(b.isOriginal) - Number(a.isOriginal)
        || a.langLabel.localeCompare(b.langLabel)
    ));
}
