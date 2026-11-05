//! Filesystem and shell commands exposed to the webview.
//!
//! File selection happens in the native host, not in JavaScript. This keeps a
//! compromised webview from substituting an arbitrary path after a dialog has
//! been shown.

use crate::platform::app_data_dir;
#[cfg(target_os = "windows")]
use crate::platform::shell_open;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// The shell runs whatever it is handed, so anything other than a web link
/// (a local path, `file:`, a custom protocol) must never reach it.
fn web_url(raw: &str) -> Result<url::Url, String> {
  let parsed = url::Url::parse(raw).map_err(|_| "That link is not a valid URL.".to_string())?;
  match parsed.scheme() {
    "http" | "https" => Ok(parsed),
    _ => Err("Only http and https links can be opened.".to_string()),
  }
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<String, String> {
  let target = web_url(&url)?;

  #[cfg(target_os = "windows")]
  {
    shell_open(std::ffi::OsStr::new(target.as_str()))
      .map_err(|e| format!("Failed to open URL: {}", e))?;
    Ok("Opened".to_string())
  }

  #[cfg(not(target_os = "windows"))]
  {
    let _ = target;
    Err("Opening URLs is only supported on Windows in this build".to_string())
  }
}

/// Show the native save dialog and write the backup to the selected path.
/// The webview supplies content and a suggested name, never a filesystem path.
#[tauri::command]
pub fn write_backup_file(
  app: AppHandle,
  suggested_name: String,
  extension: String,
  contents: String,
) -> Result<Option<String>, String> {
  if !matches!(extension.as_str(), "json" | "csv") {
    return Err("Unsupported backup format.".to_string());
  }

  let Some(selected) = app
    .dialog()
    .file()
    .set_file_name(&suggested_name)
    .add_filter("TimeLogger backup", &[extension.as_str()])
    .blocking_save_file()
  else {
    return Ok(None);
  };

  let path = selected
    .into_path()
    .map_err(|e| format!("Invalid save location: {}", e))?;
  std::fs::write(&path, contents).map_err(|e| format!("Could not save the file: {}", e))?;
  Ok(Some(path.to_string_lossy().to_string()))
}

/// Show the native open dialog and read only the file the user selected.
#[tauri::command]
pub fn read_backup_file(app: AppHandle) -> Result<Option<String>, String> {
  const MAX_BACKUP_BYTES: u64 = 100 * 1024 * 1024;

  let Some(selected) = app
    .dialog()
    .file()
    .add_filter("JSON backup", &["json"])
    .blocking_pick_file()
  else {
    return Ok(None);
  };

  let path = selected
    .into_path()
    .map_err(|e| format!("Invalid file selection: {}", e))?;
  match std::fs::metadata(&path) {
    Ok(meta) if meta.len() > MAX_BACKUP_BYTES => {
      return Err("That file is too large to be a TimeLogger backup.".to_string())
    }
    Ok(_) => {}
    Err(e) => return Err(format!("Could not open the file: {}", e)),
  }
  let contents =
    std::fs::read_to_string(&path).map_err(|e| format!("Could not read the file: {}", e))?;
  Ok(Some(contents))
}

/// Reveal the folder holding host.log so a user can attach it to a bug report.
///
/// Opens the folder rather than the log itself: `host.log` has no association,
/// so launching it either does nothing or prompts the user to choose an app,
/// and the useful files are the whole set rather than any one of them.
#[tauri::command]
pub fn open_logs_folder() -> Result<String, String> {
  let dir = app_data_dir();
  std::fs::create_dir_all(&dir)
    .map_err(|e| format!("Could not create the log folder: {}", e))?;

  #[cfg(target_os = "windows")]
  {
    shell_open(dir.as_os_str())
      .map_err(|e| format!("Could not open the log folder: {}", e))?;
    Ok(dir.to_string_lossy().to_string())
  }

  #[cfg(not(target_os = "windows"))]
  Err("Opening the log folder is only supported on Windows in this build".to_string())
}

#[cfg(test)]
mod tests {
  use super::web_url;

  #[test]
  fn web_links_keep_their_full_query_string() {
    let url = "https://login.microsoftonline.com/a/oauth2/v2.0/authorize?client_id=x&scope=y%20z&state=1";
    assert_eq!(web_url(url).unwrap().as_str(), url);
    assert!(web_url("http://localhost:3001/health").is_ok());
  }

  #[test]
  fn anything_the_shell_could_execute_is_rejected() {
    for target in [
      r"C:\Windows\System32\calc.exe",
      "calc.exe",
      "file:///C:/Windows/System32/calc.exe",
      "ms-settings:windowsdefender",
      "javascript:alert(1)",
      "",
    ] {
      assert!(web_url(target).is_err(), "{target} should be rejected");
    }
  }
}
