# Changelog

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
