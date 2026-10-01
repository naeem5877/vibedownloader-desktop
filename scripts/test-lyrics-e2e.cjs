/**
 * End-to-end check of the exact path the renderer takes, on real yt-dlp output.
 *
 * Unit tests feed synthetic payloads. This one runs a real extraction through
 * `buildMetadataFromRaw`, then feeds the resulting title/artist straight into
 * `getLyrics` - the same two calls the renderer makes - so a failure here is a
 * failure the user would actually see.
 */

const { execFileSync } = require('child_process');
const path = require('path');

const { buildMetadataFromRaw } = require('../dist-electron/handlers/infoHandler.js');
const { getLyrics } = require('../dist-electron/utils/lyrics');

const YT_DLP = path.join(
    process.env.APPDATA || '',
    'vibe-downloader',
    'yt-dlp.exe'
);

const URL = process.argv[2] || 'https://www.youtube.com/watch?v=2Vv-BfVoq4g';

function rawFor(url) {
    const out = execFileSync(YT_DLP, ['-J', '--no-warnings', '--skip-download', url], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024
    });
    return JSON.parse(out);
}

async function main() {
    console.log(`real pipeline: ${URL}\n`);

    const raw = rawFor(URL);
    console.log('  raw:');
    console.log(`    title      ${raw.title}`);
    console.log(`    uploader   ${raw.uploader}`);
    console.log(`    categories ${(raw.categories || []).join(',')}`);
    console.log(`    duration   ${raw.duration}`);

    const { metadata } = await buildMetadataFromRaw(raw, URL, true);

    console.log('\n  after buildMetadataFromRaw:');
    console.log(`    isMusic    ${metadata.isMusic}`);
    console.log(`    artist     ${JSON.stringify(metadata.artist)}`);
    console.log(`    title      ${JSON.stringify(metadata.title)}`);
    console.log(`    subtitles  ${(metadata.subtitles || []).length} tracks`);

    const artist = String(metadata.artist || metadata.uploader || '')
        .replace(/\s*-\s*Topic\s*$/i, '')
        .trim();

    console.log('\n  renderer inputs:');
    console.log(`    isMusicTrack        ${Boolean(metadata.isMusic)}`);
    console.log(`    would look up       ${Boolean(metadata.isMusic && artist)}`);
    console.log(`    subtitles suppressed ${Boolean(metadata.isMusic)}`);

    console.log('\n  calling getLyrics with those exact values...');
    const started = Date.now();
    const lyrics = await getLyrics({
        title: String(metadata.title || '').trim(),
        artist,
        duration: metadata.duration
    });
    const ms = Date.now() - started;

    if (!lyrics) {
        console.log(`    RESULT null after ${ms}ms -> panel stays unmounted (the reported symptom)`);
    } else {
        console.log(`    RESULT after ${ms}ms`);
        console.log(`      plain       ${lyrics.plain ? lyrics.plain.split('\n').length + ' lines' : 'none'}`);
        console.log(`      synced      ${lyrics.synced ? lyrics.synced.length + ' lines' : 'none'}`);
        console.log(`      words       ${lyrics.words ? lyrics.words.length + ' lines' : 'none'}`);
        console.log(`      translation ${lyrics.translation ? lyrics.translation.length + ' lines' : 'none'}`);
    }
}

main();