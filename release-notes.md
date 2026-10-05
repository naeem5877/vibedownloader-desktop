### 🎞️ Plays & Imports Everywhere
- **Universal Video Compatibility**: Every downloaded video is now checked and, when needed, converted to 8-bit 4:2:0 H.264 (`avc1`) + AAC in an MP4 with fast-start. VP9, AV1, HEVC, 10-bit/4:4:4 video, HE-AAC/Opus audio and webm/mkv containers are all handled, so files open in QuickTime, VLC, Premiere, DaVinci Resolve, CapCut and on phones.
- **No More "Audio Only" Videos**: Fixes videos that opened as audio only in QuickTime/editors and the "file contains media which isn't compatible with QuickTime Player" warning.
- **Works on Every Platform**: Applies to YouTube, Instagram, TikTok, Facebook, X and Twitch, including direct-CDN story downloads.
- **Smarter Conversion**: Only the stream that needs fixing is re-encoded; the rest is copied, so most files finish quickly. Subtitle/cover-art streams can no longer make the conversion fail, and macOS falls back to hardware encoding if needed.
- **Cleaner Audio Pick**: Downloads prefer AAC (m4a) audio, so most files need no re-encode at all.

### 🍎🐧 macOS & Linux Fixes
- **yt-dlp ENOENT Fixed**: A Windows `yt-dlp.exe` (or a Windows executable under the `yt-dlp` name) left in a Mac/Linux profile is removed and the correct build (`yt-dlp_macos`, `yt-dlp_linux`, `yt-dlp_linux_aarch64`) is fetched automatically. yt-dlp is re-checked right before every link fetch and download.
- **Oversized Menu-Bar Icon**: The tray/menu-bar icon is now scaled per OS instead of showing a huge, cropped icon on macOS.
- **Homebrew & Snap Tools Found**: Apps launched from Finder or a desktop launcher couldn't see Homebrew/snap installs of FFmpeg, Deno or Node. They are now detected.
- **Browser Extension Setup**: The native-messaging host is now registered for Chrome, Edge, Brave, Vivaldi, Chromium and Opera on macOS/Linux, and one missing browser folder no longer stops the others from registering.

### 🛠️ Reliability
- **Safer yt-dlp Update Button**: Updating from Settings no longer deletes the working yt-dlp before the new one is downloaded. If the update fails, your current version keeps working.