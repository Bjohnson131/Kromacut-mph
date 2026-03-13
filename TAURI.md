# Kromacut Native App (Tauri)

Kromacut can be built as a native application for macOS, Windows, and Linux using Tauri.

## Prerequisites

- Rust
  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  source "$HOME/.cargo/env"
  ```
- Node.js

## Development

```bash
npm run tauri:dev
```

## Production Build

```bash
npm run tauri:build
```

Build artifacts are created under `src-tauri/target/release/bundle/`.

## Configuration

Main config file: `src-tauri/tauri.conf.json`

- Window defaults are set for Kromacut’s two-pane layout.
- Bundle identifier is configured in the same file.

## Versioning and Release

When releasing a new version:

1. Update `package.json` version.
2. Update `src-tauri/tauri.conf.json` version.
3. Commit and tag the release.

Example:

```bash
git add package.json src-tauri/tauri.conf.json
git commit -m "Bump version to vX.Y.Z"
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

The GitHub Actions workflow will automatically build native applications for:
- **macOS**: Apple Silicon (M1/M2/M3) and Intel
- **Windows**: x64 installer
- **Linux**: AppImage and .deb package

All artifacts are attached to the GitHub release.

## Distribution Notes

**macOS:** Unsigned builds require removing quarantine:

```bash
sudo xattr -d com.apple.quarantine /Applications/Kromacut.app
```

For notarized distribution, configure a Developer ID signing identity in `tauri.conf.json`.

**Windows:** The `.msi` installer may trigger Windows SmartScreen for unsigned builds. Users can click "More info" → "Run anyway".

**Linux:** AppImage bundles are portable and require no installation. `.deb` packages integrate with the system package manager.