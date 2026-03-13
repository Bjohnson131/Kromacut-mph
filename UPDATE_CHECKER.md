# Update Checking System

Kromacut includes an automatic update checker for the Tauri desktop app.

## How It Works

1. **Version Check**: The app periodically checks `https://kromacut.com/version.json` for the latest version.
2. **Comparison**: The fetched version is compared with the installed version.
3. **Notification**: If a newer version is available, a notification appears in the bottom-right corner.
4. **User Action**: Users can download the update or dismiss the notification.

## Version File Format

The `version.json` file should be hosted at `https://kromacut.com/version.json` with the following structure:

```json
{
  "version": "2.2.0",
  "download_url": "https://github.com/vycdev/Kromacut/releases/latest",
  "release_notes": "Bug fixes and performance improvements"
}
```

### Fields

- `version` (required): The latest version number (semver format recommended)
- `download_url` (optional): Direct link to download the update
- `release_notes` (optional): Brief description of what's new

## Update Frequency

- **On Startup**: Checks for updates when the app launches
- **Periodic**: Re-checks every 4 hours while the app is running
- **Non-blocking**: Version checks happen in the background

## Version Synchronization

The version number is managed in multiple places and should be kept in sync:

1. `package.json` - `version` field
2. `src-tauri/tauri.conf.json` - `version` field
3. `src-tauri/Cargo.toml` - `version` field under `[package]`

When releasing a new version, update all three files.

## Disabling Update Checks

Update checks only run in the Tauri desktop environment. The web version is unaffected. To disable update checks in the desktop app, simply don't include the UpdateChecker component.

## Testing

To test the update checker locally:

1. Change the version in `public/version.json` to a higher version
2. Build and run the Tauri app: `npm run tauri:dev`
3. The update notification should appear after a few seconds

## Privacy

The update checker makes a single HTTP GET request to the version endpoint. No user data or telemetry is collected or transmitted.
