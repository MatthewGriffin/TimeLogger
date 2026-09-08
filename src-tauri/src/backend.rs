//! Lifecycle of the bundled Node sidecar: starting it, keeping it alive and
//! stopping it on quit.

use std::fs;
use std::io::Write;

use crate::platform::{host_log, runtime_pid_file};
#[cfg(target_os = "windows")]
use crate::platform::CREATE_NO_WINDOW;

/// Serializes backend restarts. Concurrent failed calls would otherwise each
/// spawn a backend and kill the previous one, leaving nothing listening.
static BACKEND_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Set once the backend has been started successfully, so the watchdog knows a
/// missing listener is a crash rather than "not launched yet".
static BACKEND_WANTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Set when the user quits, so the watchdog does not resurrect the backend we
/// are deliberately shutting down.
pub(crate) static SHUTTING_DOWN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn backend_is_listening() -> bool {
  std::net::TcpStream::connect("127.0.0.1:3001").is_ok()
}

/// Starts the backend if needed. `force` restarts even a healthy backend, which
/// is what app startup wants so a stale process from an older build is replaced.
pub(crate) fn ensure_backend(force: bool) -> Result<String, String> {
  let _guard = BACKEND_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());

  // A concurrent caller may have already restarted it while we waited.
  if !force && backend_is_listening() {
    return Ok("Backend already running".to_string());
  }

  let result = launch_backend();
  if result.is_ok() {
    BACKEND_WANTED.store(true, std::sync::atomic::Ordering::SeqCst);
  }
  result
}

/// Watches the backend and restarts it if it dies, so a crash surfaces as a
/// brief pause instead of "failed to reach backend" on the next user action.
pub(crate) fn start_backend_watchdog() {
  std::thread::spawn(|| loop {
    std::thread::sleep(std::time::Duration::from_secs(10));

    if SHUTTING_DOWN.load(std::sync::atomic::Ordering::SeqCst)
      || !BACKEND_WANTED.load(std::sync::atomic::Ordering::SeqCst)
      || backend_is_listening()
    {
      continue;
    }

    host_log("watchdog: backend not listening, restarting");
    match ensure_backend(false) {
      Ok(status) => host_log(&format!("watchdog: {}", status)),
      Err(error) => host_log(&format!("watchdog restart failed: {}", error)),
    }
  });
}

fn prune_non_target_binaries(root: &std::path::Path, log_file: &mut std::fs::File) {
  #[cfg(target_os = "windows")]
  {
    let prebuilds_dir = root
      .join("node_modules")
      .join("better-sqlite3")
      .join("prebuilds");

    let arm64_prebuild = prebuilds_dir.join("win32-arm64.node");
    let x64_prebuild = prebuilds_dir.join("win32-x64.node");

    if arm64_prebuild.exists() {
      match fs::remove_file(&arm64_prebuild) {
        Ok(_) => {
          let _ = writeln!(log_file, "Removed unused native addon: {}", arm64_prebuild.display());
        }
        Err(err) => {
          let _ = writeln!(log_file, "Could not remove unused native addon {}: {}", arm64_prebuild.display(), err);
        }
      }
    }

    if x64_prebuild.exists() {
      let _ = writeln!(log_file, "Keeping required native addon: {}", x64_prebuild.display());
    }
  }
}

#[tauri::command]
pub async fn start_backend() -> Result<String, String> {
  // Must not return before the new backend is listening. Returning early lets
  // the frontend health check pass against the previous backend moments before
  // this routine kills it, which surfaced as "failed to reach backend".
  tauri::async_runtime::spawn_blocking(|| ensure_backend(true))
    .await
    .map_err(|e| format!("Backend startup task failed: {}", e))?
}

fn launch_backend() -> Result<String, String> {
  {
    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;
    use std::fs::OpenOptions;
    use std::io::Write;
    
    // Create a log file in the app data directory
    let log_path = if let Ok(exe_path) = std::env::current_exe() {
      if let Some(exe_dir) = exe_path.parent() {
        exe_dir.join("backend_debug.log")
      } else {
        std::path::PathBuf::from("backend_debug.log")
      }
    } else {
      std::path::PathBuf::from("backend_debug.log")
    };
    
    let mut log_file = match OpenOptions::new()
      .create(true)
      .append(true)
      .open(&log_path)
    {
      Ok(f) => f,
      Err(e) => {
        eprintln!("Failed to open log file: {}", e);
        return Err(format!("Failed to open backend log: {}", e));
      }
    };
    
    let _ = writeln!(log_file, "\n=== Backend startup attempt ===");

    let mut possible_paths: Vec<std::path::PathBuf> = Vec::new();
    
    // Try to find the bundled src-node from the app installation
    if let Ok(exe_path) = std::env::current_exe() {
      if let Some(exe_dir) = exe_path.parent() {
        let _ = writeln!(log_file, "Exe directory: {}", exe_dir.display());
        
        // Tauri bundles resources in _up_ directory
        possible_paths.push(exe_dir.join("_up_").join("src-node"));
        possible_paths.push(exe_dir.join("src-node"));
        
        // Or one level up
        if let Some(parent) = exe_dir.parent() {
          possible_paths.push(parent.join("src-node"));
          possible_paths.push(parent.join("_up_").join("src-node"));
        }
      }
    }
    
    // Also try development paths as fallback
    possible_paths.push(std::path::PathBuf::from("C:\\repos\\TimeLogger\\timelogger-app\\src-node"));
    possible_paths.push(std::path::PathBuf::from("src-node"));
    possible_paths.push(std::path::PathBuf::from("../src-node"));
    possible_paths.push(std::path::PathBuf::from("../../src-node"));
    possible_paths.push(std::path::PathBuf::from("../_up_/src-node"));
    
    // Find node executable
    let node_exe = if cfg!(target_os = "windows") {
      // Try common Windows paths first
      let mut common_paths = vec![
        "C:\\Program Files\\nodejs\\node.exe".to_string(),
        "C:\\Program Files (x86)\\nodejs\\node.exe".to_string(),
      ];
      
      if let Ok(programfiles) = std::env::var("PROGRAMFILES") {
        common_paths.push(format!("{}\\nodejs\\node.exe", programfiles));
      }
      
      let mut found_node = None;
      for np in &common_paths {
        if std::path::Path::new(&np).exists() {
          let _ = writeln!(log_file, "Found node at: {}", np);
          found_node = Some(np.clone());
          break;
        }
      }
      
      // Fallback: try running node via PATH using cmd.exe
      let result = found_node.unwrap_or_else(|| "node.exe".to_string());
      let _ = writeln!(log_file, "Will use node executable: {}", result);
      result
    } else {
      "node".to_string()
    };

    let pid_file = runtime_pid_file();
    if let Ok(pid_text) = std::fs::read_to_string(&pid_file) {
      if let Ok(pid) = pid_text.trim().parse::<u32>() {
        let _ = writeln!(log_file, "Stopping previous backend PID: {}", pid);
        let _ = std::process::Command::new("taskkill")
          .args(&["/PID", &pid.to_string(), "/F"])
          .creation_flags(CREATE_NO_WINDOW)
          .output();

        // The port lingers briefly after the kill; starting before it frees
        // makes the new process die with EADDRINUSE.
        for _ in 0..20 {
          if std::net::TcpStream::connect("127.0.0.1:3001").is_err() {
            break;
          }
          std::thread::sleep(std::time::Duration::from_millis(250));
        }
      }
    }
    let _ = std::fs::remove_file(&pid_file);

    // The tracked PID misses backends left by a crash or an older build. Any
    // survivor still owning the port would make the new process exit with
    // EADDRINUSE, so reclaim it before spawning.
    if std::net::TcpStream::connect("127.0.0.1:3001").is_ok() {
      let _ = writeln!(log_file, "Port 3001 still in use; reclaiming it");
      let _ = std::process::Command::new("cmd.exe")
        .args(&["/c", "for /f \"tokens=5\" %a in ('netstat -ano ^| find \":3001\" ^| find \"LISTENING\"') do taskkill /PID %a /F"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();

      for _ in 0..20 {
        if std::net::TcpStream::connect("127.0.0.1:3001").is_err() {
          break;
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
      }
    }

    for path in &possible_paths {
      let server_path = path.join("server.js");
      let _ = writeln!(log_file, "Checking for backend at: {}", path.display());
      
      if server_path.exists() {
        let _ = writeln!(log_file, "Found server.js at: {}", server_path.display());
        let _ = writeln!(log_file, "Starting backend from: {}", path.display());
        prune_non_target_binaries(path, &mut log_file);

        let result = std::process::Command::new(&node_exe)
          .arg("server.js")
          .current_dir(&path)
          .stdout(std::process::Stdio::null())
          .stderr(std::process::Stdio::piped())
          .creation_flags(CREATE_NO_WINDOW)
          .spawn();
        
        match result {
          Ok(mut child) => {
            let _ = writeln!(log_file, "✅ Backend process started with PID: {}", child.id());
            let _ = std::fs::write(&pid_file, child.id().to_string());
            // Wait until port 3001 is reachable or the process exits.
            for _ in 0..40 {
              if let Ok(Some(status)) = child.try_wait() {
                let _ = writeln!(log_file, "❌ Backend exited early with status: {}", status);
                let mut details = String::new();
                if let Some(mut stderr) = child.stderr.take() {
                  let _ = std::io::Read::read_to_string(&mut stderr, &mut details);
                  if !details.trim().is_empty() {
                    let _ = writeln!(log_file, "Backend stderr: {}", details.trim());
                  }
                }
                return Err(format!(
                  "Backend exited during startup ({}). {}",
                  status,
                  details.trim()
                ));
              }

              if std::net::TcpStream::connect("127.0.0.1:3001").is_ok() {
                let _ = writeln!(log_file, "✅ Backend is now listening on 3001");
                return Ok("Backend started".to_string());
              }
              std::thread::sleep(std::time::Duration::from_millis(500));
            }
            if let Ok(Some(status)) = child.try_wait() {
              let _ = writeln!(log_file, "❌ Backend exited with status: {}", status);
              if let Some(mut stderr) = child.stderr.take() {
                let mut details = String::new();
                let _ = std::io::Read::read_to_string(&mut stderr, &mut details);
                if !details.trim().is_empty() {
                  let _ = writeln!(log_file, "Backend stderr: {}", details.trim());
                }
              }
            } else {
              let _ = writeln!(log_file, "❌ Backend did not start listening on 3001 in time");
            }
            return Err("Backend did not start listening on port 3001 in time.".to_string());
          }
          Err(e) => {
            let _ = writeln!(log_file, "❌ Failed to spawn backend from {}: {}", path.display(), e);
            return Err(format!("Failed to start Node backend: {}. Check that Node.js is installed.", e));
          }
        }
      }
    }
    let _ = writeln!(log_file, "❌ Could not find src-node/server.js in any of the expected locations");
    Err("Could not find the bundled backend (src-node/server.js).".to_string())
  }
}

#[tauri::command]
pub fn stop_backend() -> Result<String, String> {
  #[cfg(target_os = "windows")]
  {
    use std::os::windows::process::CommandExt;
    let pid_file = runtime_pid_file();
    if let Ok(pid_text) = std::fs::read_to_string(&pid_file) {
      if let Ok(pid) = pid_text.trim().parse::<u32>() {
        let _ = std::process::Command::new("taskkill")
          .args(&["/PID", &pid.to_string(), "/F"])
          .creation_flags(CREATE_NO_WINDOW)
          .output();
      }
    }
    let _ = std::fs::remove_file(&pid_file);
    let output = std::process::Command::new("cmd.exe")
      .args(&["/c", "for /f \"tokens=5\" %a in ('netstat -ano ^| find \":3001\" ^| find \"LISTENING\"') do taskkill /PID %a /F"])
      .creation_flags(CREATE_NO_WINDOW)
      .output()
      .map_err(|e| format!("Failed to stop backend: {}", e))?;

    if output.status.success() {
      Ok("Backend stopped".to_string())
    } else {
      Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
  }

  #[cfg(not(target_os = "windows"))]
  Err("Backend stop only supported on Windows".to_string())
}
