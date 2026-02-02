
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
