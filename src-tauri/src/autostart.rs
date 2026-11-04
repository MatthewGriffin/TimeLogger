//! Registers and removes the Windows "run at login" entry using the
//! in-process Windows Registry API (no hidden reg.exe child process).

#[cfg(target_os = "windows")]
mod windows_registry {
  use std::ffi::c_void;
  use std::io;

  type HKey = *mut c_void;

  const HKEY_CURRENT_USER: HKey = 0x8000_0001usize as HKey;
  const KEY_SET_VALUE: u32 = 0x0002;
  const REG_SZ: u32 = 1;
  const ERROR_FILE_NOT_FOUND: i32 = 2;
  const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";

  #[link(name = "advapi32")]
  unsafe extern "system" {
    fn RegCreateKeyExW(
      key: HKey,
      sub_key: *const u16,
      reserved: u32,
      class: *mut u16,
      options: u32,
      desired_access: u32,
      security_attributes: *const c_void,
      result: *mut HKey,
      disposition: *mut u32,
    ) -> i32;
    fn RegOpenKeyExW(key: HKey, sub_key: *const u16, options: u32, desired_access: u32, result: *mut HKey) -> i32;
    fn RegSetValueExW(key: HKey, name: *const u16, reserved: u32, value_type: u32, data: *const u8, data_len: u32) -> i32;
    fn RegDeleteValueW(key: HKey, name: *const u16) -> i32;
    fn RegCloseKey(key: HKey) -> i32;
  }

  fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
  }

  pub fn enable(executable: &std::path::Path) -> Result<(), String> {
    let sub_key = wide(RUN_KEY);
    let value_name = wide("TimeLogger");
    // The Run key expects a command line; quote the executable path so installs
    // beneath "Program Files" remain valid.
    let command = wide(&format!("\"{}\"", executable.display()));
    let mut key: HKey = std::ptr::null_mut();
    let status = unsafe {
      RegCreateKeyExW(
        HKEY_CURRENT_USER, sub_key.as_ptr(), 0, std::ptr::null_mut(), 0,
        KEY_SET_VALUE, std::ptr::null(), &mut key, std::ptr::null_mut()
      )
    };
    if status != 0 {
      return Err(format!("Could not open the Windows startup registry key: {}", io::Error::from_raw_os_error(status)));
    }

    let bytes = (command.len() * std::mem::size_of::<u16>()) as u32;
    let status = unsafe {
      RegSetValueExW(key, value_name.as_ptr(), 0, REG_SZ, command.as_ptr().cast(), bytes)
    };
    unsafe { RegCloseKey(key); }
    if status != 0 {
      return Err(format!("Could not enable autostart: {}", io::Error::from_raw_os_error(status)));
    }
    Ok(())
  }

  pub fn disable() -> Result<(), String> {
    let sub_key = wide(RUN_KEY);
    let value_name = wide("TimeLogger");
    let mut key: HKey = std::ptr::null_mut();
    let status = unsafe {
      RegOpenKeyExW(HKEY_CURRENT_USER, sub_key.as_ptr(), 0, KEY_SET_VALUE, &mut key)
    };
    if status == ERROR_FILE_NOT_FOUND {
      return Ok(());
    }
    if status != 0 {
      return Err(format!("Could not open the Windows startup registry key: {}", io::Error::from_raw_os_error(status)));
    }

    let status = unsafe { RegDeleteValueW(key, value_name.as_ptr()) };
    unsafe { RegCloseKey(key); }
    if status == ERROR_FILE_NOT_FOUND {
      return Ok(());
    }
    if status != 0 {
      return Err(format!("Could not disable autostart: {}", io::Error::from_raw_os_error(status)));
    }
    Ok(())
  }
}

#[tauri::command]
pub fn enable_autostart() -> Result<String, String> {
  #[cfg(target_os = "windows")]
  {
    let app_path = std::env::current_exe()
      .map_err(|e| format!("Failed to get app path: {}", e))?;
    windows_registry::enable(&app_path)?;
    Ok("Autostart enabled".to_string())
  }

  #[cfg(not(target_os = "windows"))]
  Err("Autostart only supported on Windows".to_string())
}

#[tauri::command]
pub fn disable_autostart() -> Result<String, String> {
  #[cfg(target_os = "windows")]
  {
    windows_registry::disable()?;
    Ok("Autostart disabled".to_string())
  }

  #[cfg(not(target_os = "windows"))]
  Err("Autostart only supported on Windows".to_string())
}
