//! Paths, logging and process flags shared by the other host modules.

/// Prevents helper processes from flashing a console window and stealing focus.
#[cfg(target_os = "windows")]
pub(crate) const CREATE_NO_WINDOW: u32 = 0x08000000;

pub(crate) fn runtime_pid_file() -> std::path::PathBuf {
  std::env::var("LOCALAPPDATA")
    .map(std::path::PathBuf::from)
    .unwrap_or_else(|_| std::path::PathBuf::from(r"C:\Temp"))
    .join("TimeLogger")
    .join("backend.pid")
}

pub(crate) fn app_data_dir() -> std::path::PathBuf {
  std::env::var("LOCALAPPDATA")
    .map(std::path::PathBuf::from)
    .unwrap_or_else(|_| std::path::PathBuf::from(r"C:\Temp"))
    .join("TimeLogger")
}

#[tauri::command]
pub fn get_app_data_dir() -> String {
  app_data_dir().to_string_lossy().to_string()
}

/// Appends a line to the host-side log so the native transport can be
/// diagnosed without access to the webview console.
pub(crate) fn host_log(message: &str) {
  use std::io::Write;
  let path = std::env::var("LOCALAPPDATA")
    .map(std::path::PathBuf::from)
    .unwrap_or_else(|_| std::path::PathBuf::from(r"C:\Temp"))
    .join("TimeLogger");
  let _ = std::fs::create_dir_all(&path);
  if let Ok(mut file) = std::fs::OpenOptions::new()
    .create(true)
    .append(true)
    .open(path.join("host.log"))
  {
    let stamp = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .map(|d| d.as_secs())
      .unwrap_or(0);
    let _ = writeln!(file, "[{}] {}", stamp, message);
  }
}
