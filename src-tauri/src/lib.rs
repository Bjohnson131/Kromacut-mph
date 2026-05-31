use serde::{Deserialize, Serialize};
use std::process::Command;

const RELEASES_URL: &str = "https://github.com/vycdev/Kromacut/releases";

#[derive(Debug, Serialize, Deserialize)]
struct VersionInfo {
    version: String,
    download_url: Option<String>,
    release_notes: Option<String>,
}

fn normalized_version(version: &str) -> &str {
    version.trim().trim_start_matches(['v', 'V'])
}

fn is_different_version(latest: &str, current: &str) -> bool {
    normalized_version(latest) != normalized_version(current)
}

#[tauri::command]
async fn check_for_updates(current_version: String) -> Result<Option<VersionInfo>, String> {
    // Try to fetch version info from kromacut.com/version.json
    let url = "https://kromacut.com/version.json";

    match reqwest::get(url).await {
        Ok(response) => {
            if response.status().is_success() {
                match response.json::<VersionInfo>().await {
                    Ok(version_info) => {
                        if is_different_version(&version_info.version, &current_version) {
                            Ok(Some(version_info))
                        } else {
                            Ok(None)
                        }
                    }
                    Err(e) => Err(format!("Failed to parse version info: {}", e)),
                }
            } else {
                Err(format!("Server returned status: {}", response.status()))
            }
        }
        Err(e) => Err(format!("Failed to check for updates: {}", e)),
    }
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn open_releases_page() -> Result<(), String> {
    open_external_url(RELEASES_URL)
}

fn open_external_url(url: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let result = Command::new("cmd").args(["/C", "start", "", url]).spawn();

    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(url).spawn();

    #[cfg(all(unix, not(target_os = "macos")))]
    let result = Command::new("xdg-open").arg(url).spawn();

    result
        .map(|_| ())
        .map_err(|e| format!("Failed to open releases page: {}", e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            check_for_updates,
            get_app_version,
            open_releases_page
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::is_different_version;

    #[test]
    fn detects_any_different_release_version() {
        assert!(is_different_version("2.6.1", "2.6.0"));
        assert!(is_different_version("2.6.0", "2.7.0"));
        assert!(is_different_version("3.0.0", "2.9.9"));
    }

    #[test]
    fn ignores_exact_version_matches() {
        assert!(!is_different_version("2.6.0", "2.6.0"));
        assert!(!is_different_version(" v2.6.0 ", "2.6.0"));
    }
}
