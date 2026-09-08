//! Registers and removes the Windows "run at login" entry.

#[cfg(target_os = "windows")]
use crate::platform::CREATE_NO_WINDOW;

#[tauri::command]
pub fn enable_autostart() -> Result<String, String> {
  #[cfg(target_os = "windows")]
  {
    use std::process::Command;
    use std::os::windows::process::CommandExt;
    
    // Get the app executable path
    let app_path = std::env::current_exe()
      .map_err(|e| format!("Failed to get app path: {}", e))?;
    
    let app_path_str = app_path.to_string_lossy();
    
    // Use Windows reg add command to set autostart
    let output = Command::new("reg")
      .args(&[
        "add",
        "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
        "/v",
        "TimeLogger",
        "/t",
        "REG_SZ",
        "/d",
        &app_path_str,
        "/f",
      ])
      .creation_flags(CREATE_NO_WINDOW)
      .output()
      .map_err(|e| format!("Failed to set autostart registry: {}", e))?;

    if output.status.success() {
      Ok("Autostart enabled".to_string())
    } else {
      let stderr = String::from_utf8_lossy(&output.stderr);
      Err(format!("Failed to set autostart: {}", stderr))
    }
  }
  
  #[cfg(not(target_os = "windows"))]
  Err("Autostart only supported on Windows".to_string())
}

#[tauri::command]
pub fn disable_autostart() -> Result<String, String> {
  #[cfg(target_os = "windows")]
  {
    use std::process::Command;
    use std::os::windows::process::CommandExt;
    
    // Use Windows reg delete command to remove autostart
    let output = Command::new("reg")
      .args(&[
        "delete",
        "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
        "/v",
        "TimeLogger",
        "/f",
      ])
      .creation_flags(CREATE_NO_WINDOW)
      .output()
      .map_err(|e| format!("Failed to remove autostart registry: {}", e))?;

    if output.status.success() {
      return Ok("Autostart disabled".to_string());
    } else {
      let stderr = String::from_utf8_lossy(&output.stderr);
      return Err(format!("Failed to remove autostart: {}", stderr));
    }
  }
  
  #[cfg(not(target_os = "windows"))]
  Err("Autostart only supported on Windows".to_string())
}
