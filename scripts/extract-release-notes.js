import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');
const outputPath = path.join(__dirname, '..', 'release-notes.md');

try {
    const changelog = fs.readFileSync(changelogPath, 'utf-8');

    // Split by version header start
    // We look for "\n## [" to identify the start of a version block
    // The first block is usually just the file title
    const blocks = changelog.split(/\r?\n## \[/);

    if (blocks.length > 1) {
        // block[1] is the content for the latest version (including the version number line)
        // e.g. "1.0.9] - 2026-01-15\n\n### Changes..."
        const latestBlock = blocks[1];

        // Split into lines to remove the first line (the version header)
        const lines = latestBlock.split(/\r?\n/);

        // Remove the first line (the version info)
        lines.shift();

        // Join back, remove leading/trailing whitespace
        const notes = lines.join('\n').trim();

        if (notes) {
            fs.writeFileSync(outputPath, notes);
            console.log('Successfully extracted release notes to release-notes.md');
        } else {
            console.error('Empty release notes found');
            process.exit(1);
        }
    } else {
        console.error('Could not find any version entries in changelog');
        console.log('Changelog content preview:', changelog.substring(0, 200));
        process.exit(1);
    }
} catch (error) {
    console.error('Error extracting release notes:', error);
    process.exit(1);
}
