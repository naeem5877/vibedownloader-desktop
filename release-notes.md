### 🚀 Performance & macOS Lag Fix
- **GPU-Accelerated Scrolling**: Implemented dedicated hardware-acceleration layers to ensure buttery smooth scrolling even on high-refresh rate macOS displays.
- **Optimized Empty State**: Re-engineered the platform display area to use light radial gradients instead of heavy real-time CSS blurs, significantly reducing GPU load.
- **Memoized Components**: Key UI elements are now memoized to prevent unnecessary re-renders during active downloads.

### 🎨 UI & Animation Polish
- **Static Platform Icons**: Fixed the "tilt" bug in the Empty State display; platform icons now stay perfectly upright while surrounding rings rotate.
- **Refined Display Logic**: Improved loading skeleton logic and unified animation easing for a premium feel.

### 🛠️ Critical Bug Fixes
- **Solved Queue Rendering**: Fixed rendering bugs where batch items would sometimes fail to render or duplicate.
- **TDZ Safety Fix**: Resolved scope errors by reordering core playlist state logic.
- **Ghost Removal**: Cleaned up duplicate function declarations for queue management.