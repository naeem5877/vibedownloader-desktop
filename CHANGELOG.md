## [2.2.0] - 2026-10-05

### 🎞️ Plays & Imports Everywhere
- **Universal Video Compatibility**: Every downloaded video is now checked and, when needed, converted to 8-bit 4:2:0 H.264 (`avc1`) + AAC in an MP4 with fast-start. VP9, AV1, HEVC, 10-bit/4:4:4 video, HE-AAC/Opus audio and webm/mkv containers are all handled, so files open in QuickTime, VLC, Premiere, DaVinci Resolve, CapCut and on phones.
- **No More "Audio Only" Videos**: Fixes videos that opened as audio only in QuickTime/editors and the "file contains media which isn't compatible with QuickTime Player" warning.
- **Works on Every Platform**: Applies to YouTube, Instagram, TikTok, Facebook, X and Twitch, including direct-CDN story downloads.
- **Smarter Conversion**: Only the stream that needs fixing is re-encoded; the rest is copied, so most files finish quickly. Subtitle/cover-art streams can no longer make the conversion fail, and macOS falls back to hardware encoding if needed.
- **Cleaner Audio Pick**: Downloads prefer AAC (m4a) audio, so most files need no re-encode at all.

### 🍎🐧 macOS & Linux Fixes
- **yt-dlp ENOENT Fixed**: A Windows `yt-dlp.exe` (or a Windows executable under the `yt-dlp` name) left in a Mac/Linux profile is removed and the correct build (`yt-dlp_macos`, `yt-dlp_linux`, `yt-dlp_linux_aarch64`) is fetched automatically. yt-dlp is re-checked right before every link fetch and download.
- **yt-dlp Now Installs on Mac & Linux**: The freshly downloaded yt-dlp wasn't marked executable before its safety check, so the check always failed and the file was never installed, which caused `spawn … yt-dlp ENOENT` on macOS. It is now made executable first.
- **No More First-Launch Race**: If you pasted a link while yt-dlp was still downloading on the first run, the request failed. It now waits for the running download instead of erroring.
- **Subtitles & Spotify Check yt-dlp Too**: Subtitle downloads and Spotify track downloads now make sure yt-dlp is ready before starting, like every other download.
- **ffprobe on macOS**: On Mac, FFmpeg and ffprobe are separate downloads, and a missing ffprobe silently skipped video compatibility conversion. A missing ffprobe is now fetched on its own, at startup and before downloads.
- **Oversized Menu-Bar Icon**: The tray/menu-bar icon is now scaled per OS instead of showing a huge, cropped icon on macOS.
- **Homebrew & Snap Tools Found**: Apps launched from Finder or a desktop launcher couldn't see Homebrew/snap installs of FFmpeg, Deno or Node. They are now detected.
- **Browser Extension Setup**: The native-messaging host is now registered for Chrome, Edge, Brave, Vivaldi, Chromium and Opera on macOS/Linux, and one missing browser folder no longer stops the others from registering.

### 🛠️ Reliability
- **Safer yt-dlp Update Button**: Updating from Settings no longer deletes the working yt-dlp before the new one is downloaded. If the update fails, your current version keeps working.

### 🎨 Design
- **New TikTok Icon**: A sharper, redrawn TikTok icon with the cyan and red glitch shadows and no background box. It adapts to the active/inactive tab colors and is used in the platform bar and on the TikTok screen.

## [2.1.0] - 2026-10-04

### 🎬 YouTube Upgrades
- **Subtitles Download**: Videos with captions now show a **Subtitles** option. Pick a language and save the subtitles as an SRT file.
- **Multi-Language Audio Tracks**: If a video has more than one audio track (for example Bangla, English, Hindi), you can now choose the exact language you want.
- **Audio or Video in Your Language**: Download the selected language as an audio file, or as a video with that audio track.
- **Smarter Format Detection**: The app now checks the quality list YouTube returns. If it looks incomplete (for example only 360p), it tries again with a different player before showing you the result.

### 🎵 Lyrics Download (Spotify & YouTube Music)
- **Lyrics for Music Tracks**: When a song has lyrics available, a new lyrics option appears in the music section.
- **Line by Line**: Synced lyrics, one line at a time.
- **Word by Word**: Lyrics timed word by word, for karaoke-style use.
- **Plain Text**: Clean lyrics without timestamps.
- **Translation**: Download a translated version of the lyrics.

### 🎧 Music Downloading
- **WAV Format Added**: Download songs as uncompressed WAV for the highest audio fidelity.
- **Better Metadata Embedding**: Downloaded songs now include **track, album and artist** details, so they show up correctly in your music player.
- **Spotify: 4 Audio Formats**: Spotify downloads now offer four audio format options.

### 📸 Stories
- **Instagram Stories Fixed**: Story downloading works again.
- **Facebook Stories Fixed**: Story downloading works again.

### 🛡️ Bot Protection & Age Restriction
- **Improved YouTube Reliability**: Reworked how the app talks to YouTube to reduce "bot protection" and age-restriction errors, including on PCs where it previously failed.
- **Automatic Player Fallback**: If one YouTube player is refused, the app tries another instead of showing an error.
- **Better Error Messages**: The app reads the real reason yt-dlp reports, so you see a clearer message when something goes wrong.
- **Stuck Requests Cancelled Properly**: A timed-out request now stops the downloader process instead of leaving it running in the background.
- **More Secure Connections**: Removed the setting that skipped certificate checks.

### 🧰 Diagnostics & Debugging
- **Sentry Error Reporting**: Added to help find and fix crashes faster. Links and file paths are scrubbed before anything is sent.
- **Private Logs**: Video links in logs are redacted.

## [2.0.0] - 2026-09-02

### 🧩 Browser Extension
- **Download From the Page**: Overlaid one-click download buttons on YouTube, YouTube Music, Instagram, Facebook, TikTok, X (Twitter), Spotify, and SoundCloud.
- **Native Messaging Bridge**: The extension connects to the desktop app over a secure local host and can auto-launch it.
- **Simple Setup**: In-app extension center detects your browser, prepares the unpacked folder / CRX, and walks you through "Load unpacked" (Chrome, Edge, Brave, Vivaldi, Opera, Firefox).

### 🔴 Twitch Support
- **Live Recording**: Paste a live Twitch channel, hit **Record live stream**, and it saves the broadcast until you press **Stop** — automatically finalized into a playable MP4.
- **Live Detection**: A red LIVE badge shows when a stream is actually broadcasting, with a dedicated record button.
- **VODs & Clips**: Twitch VODs (`/videos/...`) and clips (`/clip/...`) download like normal videos with full quality + Cut support.
- **Smart Organization**: Downloads are sorted into `Twitch/Live`, `Twitch/VODs`, and `Twitch/Clips`.

### ✂️ Cut & Download Modal
- **Cut Timeline Precision**: A sleek waveform editor with a compact dual-range slider to trim any video or song before you save it.
- **Clip Summary**: Live feedback on how long your clip is (in words), start/end range, and % saved.
- **Clean Output**: The full-length source is automatically deleted after a successful cut — only your trimmed file stays.

### 🛠️ Engine & Fixes
- **YouTube Quality Fix**: Resolved videos capping at 320p by switching the downloader client (`tv_embedded`) — full DASH quality up to 4K restored.
- **Compact Slider**: Cut timeline re-designed to a slim, premium grid with a lighter waveform.
- **Snapchat Removed**: App is now curated strictly to stable, supported platforms.

## [1.6.0] - 2026-04-22

### 🛠️ Engine & Stability Fixes
- **YouTube Quality Fix**: Resolved an issue where some YouTube videos were limited to 360p by prioritizing modern DASH clients (`web`, `web_creator`) and adding mobile client fallbacks.
- **Lossless Fetching Repair**: Fixed connection issues and timeouts when fetching lossless audio from Tidal/Qobuz proxies.
- **Spotify API Optimization**: Improved the robustness of Spotify metadata scraping with enhanced fallbacks for regional blocks and API errors.
- **Version Bump**: Official transition to v1.6.0 with updated internal service headers.

## [1.3.0] - 2026-03-07

### 🚀 Performance & macOS Lag Fix
- **GPU-Accelerated Scrolling**: Implemented dedicated hardware-acceleration layers (`will-change-transform`, `hardware-accelerated` classes) to ensure buttery smooth scrolling even on high-refresh rate macOS displays.
- **Optimized Empty State**: Re-engineered the platform display area to use light radial gradients instead of heavy real-time CSS blurs, significantly reducing GPU load.
- **Memoized Components**: Key UI elements like `EmptyState`, `PlaylistItem`, and `BatchQueueItem` are now memoized to prevent unnecessary re-renders.

### 🎨 UI & Animation Polish
- **Static Platform Icons**: Fixed the "tilt" bug in the Empty State display; platform icons (YouTube, Spotify, etc.) now stay perfectly upright while surrounding rings rotate.
- **Refined Display Logic**: Improved the loading skeleton logic and unified the animation easing for a more consistent, premium feel.

### 🛠️ Critical Bug Fixes
- **Solved Queue Rendering**: Fixed a JSX structure bug where batch items would sometimes fail to render or duplicate in the queue.
- **TDZ Safety Fix**: Resolved "Variable used before declaration" errors by reordering core playlist state logic.
- **Ghost Removal**: Cleaned up duplicate function declarations for queue management.

## [1.2.0] - 2026-02-26

### ✨ New Features & UI Upgrades
- **Upgraded Empty State**: A completely redesigned home screen that dynamically adapts to the selected platform with glassmorphic cards and animated tutorial steps.
- **Atmospheric Animations**: Added concentric rotating rings, pulsing orbs, and platform-specific hero sections for a premium desktop experience.
- **Shiny Loading Effects**: New `ShinyText` component for dynamic, high-energy status updates during metadata fetching.
- **Next-Gen Input Field**: The URL input now features a reactive brand-colored focus glow and a refined frosted-glass design.

### 🛡️ Reliability & Safety
- **Platform Safety Lock**: Other platform buttons and mode toggles are now automatically locked during active downloads to prevent accidental operation interruptions.
- **Intelligent Auto-Switch**: Improved paste logic that auto-detects the platform from the URL and switches the UI context instantly.

### 🛠️ Minor Improvements
- Added cursor-pointer affordance to all primary action buttons.
- Optimized build configuration for faster deployment.
- Cleaned up unused components and strict type-safety improvements.

## [1.0.11] - 2026-02-03

### ✨ New Features
- **Snapchat Support**: Direct video downloading from Snapchat (Spotlight and Public Stories) with official **Cookie support** for age-restricted or private snaps.
- **Cookie File Upload**: Added "Upload .txt File" functionality to the login/vault modal, allowing users to import Netscape cookie files directly instead of manual pasting.
- **System Tray Integration**: Added "Minimize to Tray" functionality with a premium animated toggle in settings, keeping the app ready for instant use.

### 🚀 Performance & Optimizations
- **Ultra-Fast Startup**: Re-engineered the engine initialization process to bypass non-essential checks, making the app launch almost twice as fast.
- **Smart Background Throttling**: The app now automatically reduces CPU usage and mutes internal audio when hidden in the tray to ensure zero impact on system resources.

### 🔧 Engine Improvements
- **Intelligent Background Updates**: The downloader engine (yt-dlp) now checks for updates silently in the background after startup and notifies the user with a sleek UI popup when a new version is ready.
- **Enhanced Engine Refresh**: Improved the manual engine update process in settings with better verification and cleaner file replacement.

## [1.0.10] - 2026-01-25

### 🐛 Critical Fixes
- **Smart File Naming (Instagram/Social)**: Fixed a major issue where multiple videos from the same creator (Instagram/Facebook/TikTok) would overwrite each other. Files are now saved with a unique identifier (e.g., `Username_VideoID.mp4`) while keeping the clean username display in notifications.
- **CI/CD Pipeline Repair**: Resolved a Spotify environment variable injection failure in GitHub Actions by switching to a robust, cross-platform Node.js script for `.env` generation.


## [1.0.9] - 2026-01-15

### ✨ New Feature: Batch Downloading
- **Advanced Batch UI**: Completely redesigned the batch download interface with a modern glassmorphism aesthetic.
- **Per-Item Format Control**: Added **Video/Audio toggles** for individual items in the queue, allowing mixed format downloads in a single batch.
- **Enhanced Queue Management**: New controls to **Pause**, **Resume**, and **Cancel** the entire batch process seamlessly.
- **Smart Completion**: A dedicated success screen with options to "Start New Batch" or "Exit", streamlining the workflow.
- **Visual Feedback**: Improved status indicators, slim progress bars, and clear error messaging for each queue item.

### 🐛 Fixes & Polish
- **Runtime Stability**: Fixed `yt-dlp` JavaScript runtime errors by enforcing Node.js execution.
- **URL Parsing**: Resolved issues with multi-line URL parsing on Windows/Unix systems.
- **State Reliability**: Fixed race conditions in batch processing to ensure accurate progress tracking and pause/resume behavior.
- **UI Refinements**: Added consistent pointer cursors and visual interactive states across the entire batch UI.

## [1.0.8] - 2025-12-21

### 🐛 Fixes
- **MacOS ESM Crash**: Fixed a critical issue on macOS where the application would fail to launch with a `ERR_INVALID_PACKAGE_CONFIG` error. Replaced brittle shell-based config generation with a robust cross-platform Node.js script.

## [1.0.7] - 2025-12-21

### ✨ Features & Organization
- **Structured Playlist Downloads**: Added automatic folder organization for playlists. All items from a playlist are now saved in a dedicated `/Playlists/{PlaylistTitle}/` directory.
- **New "Download All" Button**: Added a one-click button in the playlist header to download the entire collection instantly.
- **Improved Spotify Handling**: Support for localized Spotify URLs and deeper API logging.

### 🐛 Fixes & Maintenance
- **Fixed Blank Screen Bug**: Resolved an issue where certain YouTube playlists would cause the UI to go blank due to malformed metadata.
- **Type Safety**: Fixed TypeScript errors related to new playlist properties in the renderer process.

## [1.0.6] - 2025-12-21

### ✨ UI & Refinements
- **Refined Search UI**: Scaled down search input and fetch button for a more compact and professional look.
- **Improved Window Management**: Enabled launch in maximized state and added support for Windows Aero Snap (multitasking snap) and native title bar double-click.

### 🐛 Fixes & Maintenance
- **Resolved Icon Conflicts**: Fixed JSX/global type conflicts by renaming lucide-react icons.
- **Improved Launch Logic**: Smoother application startup and window show/maximize sequence.

## [1.0.5] - 2025-12-21

### ✨ Features & Improvements
- **Enhanced Thumbnails**: Improved thumbnail extraction and embedding.
- **Turbo Downloads**: Optimized download engine for faster speeds.
- **Improved Progress Bar**: More accurate progress tracking and UI feedback.

## [1.0.4] - 2025-12-13

### 🚀 Major Refactor & Cleanup
- **Codebase Restructuring**: The single `main.ts` file has been split into a modular architecture.
  - `electron/handlers/`: Dedicated handlers for Downloads, Info fetching, Cookies, and General IPC.
  - `electron/utils/`: Shared utilities for Paths, Binaries (yt-dlp/ffmpeg), Spotify, and Environment variables.
- **Professional File System**: Optimized directory structure for better scalability and maintenance.

### 📝 Documentation
- **New README**: Completely redesigned `README.md` with premium aesthetics, better badges, and clearer sections.
- **Installation Guide**: Added explicit instructions for **macOS** and **Linux** users.

### 🔒 Security & Maintenance
- **Security Fixes**: Hardened IPC handlers and improved validaton.
- **Flathub Prep**: Adjustments made to support future Flathub releases.
- **License Update**: Clarified trademark usage while keeping the GPLv3 license for code.

### 🐛 Fixes
- Improved FFmpeg detection and download logic.
- smoother window management and auto-updater behavior.
