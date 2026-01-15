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