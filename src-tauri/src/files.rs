//! Filesystem and shell commands exposed to the webview.
//!
//! These exist instead of `tauri-plugin-fs` so the webview is never granted a
//! general filesystem scope: each command does one narrow thing.

use crate::platform::app_data_dir;
#[cfg(target_os = "windows")]
use crate::platform::CREATE_NO_WINDOW;

#[tauri::command]
pub fn open_external_url(url: String) -> Result<String, String> {
  #[cfg(target_os = "windows")]
  {
    use std::process::Command;
    use std::os::windows::process::CommandExt;
    // Deliberately avoids `cmd /C start`: cmd treats the `&` between query
    // parameters as a command separator, which silently truncated OAuth URLs
    // (Microsoft then rejected the request for a missing 'scope').
    Command::new("rundll32.exe")
      .args(["url.dll,FileProtocolHandler", &url])
      .creation_flags(CREATE_NO_WINDOW)
      .spawn()
      .map_err(|e| format!("Failed to open URL: {}", e))?;
    Ok("Opened".to_string())
  }

  #[cfg(not(target_os = "windows"))]
  Err("Opening URLs is only supported on Windows in this build".to_string())
}

/// Write a backup to a path the user chose in the save dialog.
///
/// The webview never gets a general filesystem write: the only way to reach
/// this is a path the user just picked themselves in a native dialog.
#[tauri::command]
pub fn write_backup_file(path: String, contents: String) -> Result<String, String> {
  std::fs::write(&path, contents).map_err(|e| format!("Could not save the file: {}", e))?;
  Ok(path)
}

/// Read a backup the user chose in the open dialog.
#[tauri::command]
pub fn read_backup_file(path: String) -> Result<String, String> {
  // Guards against a mis-picked multi-gigabyte file being pulled into memory
  // and taking the app down; a real backup is orders of magnitude smaller.
  const MAX_BACKUP_BYTES: u64 = 100 * 1024 * 1024;
  match std::fs::metadata(&path) {
    Ok(meta) if meta.len() > MAX_BACKUP_BYTES => {
      return Err("That file is too large to be a TimeLogger backup.".to_string())
    }
    Ok(_) => {}
    Err(e) => return Err(format!("Could not open the file: {}", e)),
  }
  std::fs::read_to_string(&path).map_err(|e| format!("Could not read the file: {}", e))
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
    use std::process::Command;
    use std::os::windows::process::CommandExt;
    // explorer.exe returns a non-zero exit code even when it succeeds, so the
    // status is deliberately not checked - only a spawn failure is a failure.
    Command::new("explorer.exe")
      .arg(&dir)
      .creation_flags(CREATE_NO_WINDOW)
      .spawn()
      .map_err(|e| format!("Could not open the log folder: {}", e))?;
    Ok(dir.to_string_lossy().to_string())
  }

  #[cfg(not(target_os = "windows"))]
  Err("Opening the log folder is only supported on Windows in this build".to_string())
}
