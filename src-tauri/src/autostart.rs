//! Registers and removes the Windows "run at login" entry.
//!
//! The registry is written in-process rather than through `reg.exe`: a hidden
//! child process editing the Run key is what malware persistence looks like to
//! antivirus behaviour monitoring.

#[cfg(target_os = "windows")]
const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
#[cfg(target_os = "windows")]
const RUN_VALUE: &str = "TimeLogger";

#[tauri::command]
pub fn enable_autostart() -> Result<String, String> {
  #[cfg(target_os = "windows")]
  {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let app_path = std::env::current_exe()
      .map_err(|e| format!("Failed to get app path: {}", e))?;

    let (run_key, _) = RegKey::predef(HKEY_CURRENT_USER)
      .create_subkey(RUN_KEY)
      .map_err(|e| format!("Failed to open autostart registry key: {}", e))?;

    // Quoted because Windows parses this value as a command line, and an
    // unquoted path containing spaces can resolve to the wrong executable.
    run_key
      .set_value(RUN_VALUE, &format!("\"{}\"", app_path.display()))
      .map_err(|e| format!("Failed to set autostart: {}", e))?;

    Ok("Autostart enabled".to_string())
  }

  #[cfg(not(target_os = "windows"))]
  Err("Autostart only supported on Windows".to_string())
}

#[tauri::command]
pub fn disable_autostart() -> Result<String, String> {
  #[cfg(target_os = "windows")]
  {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
    use winreg::RegKey;

    let run_key = RegKey::predef(HKEY_CURRENT_USER)
      .open_subkey_with_flags(RUN_KEY, KEY_SET_VALUE)
      .map_err(|e| format!("Failed to open autostart registry key: {}", e))?;

    match run_key.delete_value(RUN_VALUE) {
      Ok(()) => Ok("Autostart disabled".to_string()),
      // Already absent is the state the user asked for.
      Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok("Autostart disabled".to_string()),
      Err(e) => Err(format!("Failed to remove autostart: {}", e)),
    }
  }

  #[cfg(not(target_os = "windows"))]
  Err("Autostart only supported on Windows".to_string())
}
