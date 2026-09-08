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
    .map_err(|e| format!("Failed to write OAuth signal: {}", e))?;
  Ok(signal_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn read_microsoft_oauth_signal(path: String) -> Result<serde_json::Value, String> {
  let data = fs::read_to_string(&path).map_err(|e| format!("Failed to read OAuth signal: {}", e))?;
  fs::remove_file(&path).map_err(|e| format!("Failed to clear OAuth signal: {}", e))?;
  serde_json::from_str(&data).map_err(|e| format!("Failed to parse OAuth signal: {}", e))
}

#[tauri::command]
pub fn start_microsoft_oauth(tenant_id: String, client_id: String, redirect_uri: String, scope: String) -> Result<String, String> {
  fn encode_param(s: &str) -> String {
    s.chars().map(|c| {
      match c {
        'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' | '/' | ':' => c.to_string(),
        ' ' => "%20".to_string(),
        _ => format!("%{:02X}", c as u8),
      }
    }).collect()
  }

  let auth_url = format!(
    "https://login.microsoftonline.com/{}/oauth2/v2.0/authorize?client_id={}&redirect_uri={}&response_type=code&scope={}",
    tenant_id,
    encode_param(&client_id),
    encode_param(&redirect_uri),
    encode_param(&scope)
  );

  println!("OAuth URL: {}", auth_url);
  Ok(auth_url)
}
