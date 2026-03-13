# Changelog

All notable changes to Kromacut are documented in this file.

## [2.3.2] - 2026-03-13

### Added
- **Native desktop app** — Tauri-based builds for macOS (Apple Silicon + Intel), Windows, and Linux
- **Filament calibration wizard** — Measure accurate TD values from physical test prints with confidence scoring
- **Advanced optimizer** — Simulated annealing and genetic algorithms for finding optimal filament ordering
- **Region weighting** — Prioritize accuracy in center or edge regions during auto-paint optimization
- **Auto-paint Web Worker** — Optimizer runs off the main thread with debounced dispatch and cancellation
- **Update checker** — Desktop app checks `kromacut.com/version.json` for new versions
- **Theme persistence** — Dark/light mode choice saved to localStorage
- **Sticky Build 3D Model button** — Stays visible when scrolling through settings
- GitHub Actions release workflow for automated multi-platform builds
- GitHub Actions deploy workflow triggers on version tags

### Changed
- `filamentCoverage` confidence metric now uses deltaE-based color matching instead of filament-count heuristic
- Calibration quality metric uses actual filament calibration data instead of hardcoded value
- Region weights integrated into optimizer scoring via `applyRegionWeightHeuristic`
- CSP properly configured for Tauri (whitelists `kromacut.com` and Google Fonts)
- Vite base path set to `/` for custom domain deployment
- Docs (`TAURI.md`, `UPDATE_CHECKER.md`) moved to `docs/` folder
- README updated for multi-platform support with correct release links

### Fixed
- `package-lock.json` version synced to match `package.json`
- Google Fonts blocked in Tauri production builds due to missing CSP directives
- `useAutoPaintWorker` firing excessively due to unstable object references
- Build 3D Model button had transparent gap at top of scroll container

## [2.2.0] - 2026-02-15

### Added
- **Auto-paint mode** — Define filaments with color and Transmission Distance, automatic Beer-Lambert optical blending computes optimal layer stacks
- **Enhanced color matching** — Optimizer evaluates filament orderings for best color reproduction
- **Repeated filament swaps** — Allow filaments to appear multiple times in the stack for intermediate blended colors
- **Height dithering** — Floyd-Steinberg error diffusion for smoother tonal transitions
- **Filament profiles** — Save, load, import/export (`.kapp` files) auto-paint configurations
- **Transition zones** — Automatic calculation of vertical zones where filament colors blend
- **Processing overlay** — Unified progress indicator for quantization and dedithering
- **Build warning dialog** — Warns before building 3D geometry when layer count or pixel count is high
- **Resizable splitter** — Draggable two-pane layout with percentage-based sizing
- Print settings persistence to localStorage
- Auto-paint state persistence to localStorage

### Changed
- Refactored hooks architecture — business logic extracted into custom hooks (`useSwatches`, `useQuantize`, `useThreeScene`, `useAppHandlers`, `useImageHistory`, `useFilaments`, `useProfileManager`, `useColorSlicing`, `useSwapPlan`, `useProcessingState`, `useBuildWarning`)
- Greedy meshing algorithm made async with periodic yielding for UI responsiveness
- 3MF export enriched with layer height, first layer height, and filament colors

## [2.0.0] - 2025-12-01

### Added
- **3MF export** — Multi-material export with per-color objects and slicer metadata
- **Layer-by-layer preview slider** — Interactive height slider to visualize print buildup
- Greedy meshing with separate wall generation to prevent T-junctions
- Slicer first layer height setting
- Model dimension display in 3D view

### Changed
- Complete 3D engine rewrite with BufferGeometry per-face triangles
- Wall generation based on pixel occupancy to reduce banding
- Texture uses `NearestFilter` with disabled mipmaps for crisp pixel mapping

### Fixed
- Non-manifold edge prevention
- Color swap instruction accuracy
- Inverted normals in mesh generation

## [1.0.0] - 2025-10-01

### Added
- Image upload with drag-and-drop support
- Color quantization (posterize, median-cut, K-means, octree, Wu algorithms)
- Dedithering (median-filter smoothing pass)
- Inline color pickers for palette tweaking
- Per-color slice heights with drag-and-drop reordering
- Live 2D canvas preview and 3D stacked preview (Three.js)
- Binary STL export
- Plain-text print instructions with copy-to-clipboard
- Image adjustments (exposure, contrast, saturation, etc.)
- Undo/redo history for image operations
- Dark/light theme toggle
- Predefined color palettes
