//! Paths, logging and process flags shared by the other host modules.

/// Prevents helper processes from flashing a console window and stealing focus.
#[cfg(target_os = "windows")]
pub(crate) const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Hands a URL or folder to its registered handler through the Windows shell,
/// without creating a helper process of our own.
#[cfg(target_os = "windows")]
pub(crate) fn shell_open(target: &std::ffi::OsStr) -> Result<(), String> {
  use std::os::windows::ffi::OsStrExt;
  use windows_sys::Win32::UI::Shell::ShellExecuteW;
  use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

  let operation: Vec<u16> = "open\0".encode_utf16().collect();
  let file: Vec<u16> = target.encode_wide().chain(std::iter::once(0)).collect();

  // SAFETY: both strings are NUL-terminated and outlive this synchronous call;
  // the null handle and parameters are documented as optional.
  let result = unsafe {
    ShellExecuteW(
      std::ptr::null_mut(),
      operation.as_ptr(),
      file.as_ptr(),
      std::ptr::null(),
      std::ptr::null(),
      SW_SHOWNORMAL,
    )
  };

  // ShellExecuteW reports success with any value above 32.
  if result as isize > 32 {
    Ok(())
  } else {
    Err(format!("the Windows shell returned error code {}", result as isize))
  }
}

#[cfg(target_os = "windows")]
fn is_node_image(image_path: &str) -> bool {
  std::path::Path::new(image_path)
    .file_name()
    .and_then(|name| name.to_str())
    .is_some_and(|name| name.eq_ignore_ascii_case("node.exe"))
}

/// Terminates `pid` only if it is still a Node process. The PID comes from a
/// file that can outlive the backend, and Windows reuses PIDs, so it may now
/// belong to an unrelated program.
///
/// Returns `Ok(false)` when no matching process was found to terminate.
#[cfg(target_os = "windows")]
pub(crate) fn terminate_node_process(pid: u32) -> Result<bool, String> {
  use windows_sys::Win32::Foundation::CloseHandle;
  use windows_sys::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, TerminateProcess, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
  };

  // SAFETY: the handle is checked for null, used only within this block and
  // closed exactly once. The buffer length passed matches its allocation.
  unsafe {
    let handle = OpenProcess(PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
    if handle.is_null() {
      return Ok(false);
    }

    let mut buffer = [0u16; 1024];
    let mut length = buffer.len() as u32;
    let named = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, buffer.as_mut_ptr(), &mut length) != 0;
    let image_path = String::from_utf16_lossy(&buffer[..length as usize]);

    let result = if !named || !is_node_image(&image_path) {
      Ok(false)
    } else if TerminateProcess(handle, 1) != 0 {
      Ok(true)
    } else {
      Err(std::io::Error::last_os_error().to_string())
    };

    CloseHandle(handle);
    result
  }
}

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

#[cfg(all(test, target_os = "windows"))]
mod tests {
  use super::{is_node_image, terminate_node_process};

  #[test]
  fn a_process_that_is_not_node_is_left_running() {
    // This test binary is the live process being targeted. If the image check
    // failed, the test run itself would be terminated.
    assert_eq!(terminate_node_process(std::process::id()), Ok(false));
  }

  #[test]
  fn a_running_node_process_is_terminated() {
    let mut child = std::process::Command::new("node")
      .args(["-e", "setInterval(() => {}, 1000)"])
      .spawn()
      .expect("node must be on PATH for this test");

    assert_eq!(terminate_node_process(child.id()), Ok(true));
    assert!(!child.wait().expect("child should exit").success());
  }

  #[test]
  fn only_node_executables_are_recognised_as_the_backend() {
    assert!(is_node_image(r"C:\Program Files\nodejs\node.exe"));
    assert!(is_node_image(r"C:\Program Files\nodejs\NODE.EXE"));
    assert!(!is_node_image(r"C:\Windows\System32\svchost.exe"));
    assert!(!is_node_image(r"C:\tools\node.exe.bak"));
    assert!(!is_node_image(""));
  }
}
