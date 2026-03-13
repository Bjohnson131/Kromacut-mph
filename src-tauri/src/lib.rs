use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
struct VersionInfo {
    version: String,
    download_url: Option<String>,
    release_notes: Option<String>,
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
                        // Compare versions (simple string comparison for now)
                        if version_info.version != current_version {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![check_for_updates, get_app_version])
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
