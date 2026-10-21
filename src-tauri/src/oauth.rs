//! Microsoft sign-in: builds the authorize URL and passes the result from the
//! browser back to the app through a file the OAuth callback page writes.

use std::fs;

use crate::platform::app_data_dir;

#[tauri::command]
pub fn write_microsoft_oauth_signal(success: bool, code: String, timestamp: String) -> Result<String, String> {
  let dir = app_data_dir();
  fs::create_dir_all(&dir).map_err(|e| format!("Failed to prepare app data directory: {}", e))?;
  let signal_path = dir.join("microsoft-oauth.json");
  let payload = serde_json::json!({
    "success": success,
    "code": code,
    "timestamp": timestamp,
  });
  fs::write(&signal_path, serde_json::to_string(&payload).map_err(|e| format!("Failed to serialize signal: {}", e))?)
    .map_err(|e| format!("Failed to write signal: {}", e))?;
  Ok(signal_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn read_microsoft_oauth_signal(_path: String) -> Result<serde_json::Value, String> {
  // Do not trust a path returned by the webview. Always read and clear the
  // one well-known signal file created by write_microsoft_oauth_signal.
  let signal_path = app_data_dir().join("microsoft-oauth.json");
  let data = fs::read_to_string(&signal_path)
    .map_err(|e| format!("Failed to read OAuth signal: {}", e))?;
  fs::remove_file(&signal_path)
    .map_err(|e| format!("Failed to clear OAuth signal: {}", e))?;
  serde_json::from_str(&data).map_err(|e| format!("Failed to parse OAuth signal: {}", e))
}
