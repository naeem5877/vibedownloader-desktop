## VibeDownloader v1.5.0 — The Reliability Update 🚀

### 🎵 Enhanced Spotify Experience
- **High-Reliability Metadata Scraper**: Replaced legacy scraping logic with a new, resilient engine that uses rotating User-Agents (Googlebot bypass) and multi-stage fallback.
- **Improved Album Artwork**: Integrated the `album-art` library to ensure you always get high-quality cover art even when Spotify's CDNs are restricted.
- **Fast-Fail Image Loading**: Implemented a strict 3-second timeout for artwork; no more "hanging" app while waiting for unresponsive image servers.

### 🎧 Lossless Audio (FLAC) Improvements
- **Rate-Limit Bypass**: Added an automatic Deezer-based search fallback for lossless checks. If SongLink rate-limits your IP, the app now uses ISRC codes from Deezer to find the track on Tidal/Qobuz.
- **Stable Downloads**: Upgraded the background download pipeline to use Axios with robust retry logic, preventing "Connect Timeout" errors on slow connections.

### 🛠️ Core Stability & Fixes
- **TypeScript Foundation**: Completely refactored the IPC bridge and global window types for better stability and faster future updates.
- **Binary Reliability**: Fixed critical build errors where Spotify utility functions were accidentally removed during refactoring.
- **Performance Optimization**: Drastically reduced the time spent "finalizing" Spotify downloads by skipping stuck thumbnail fetches.