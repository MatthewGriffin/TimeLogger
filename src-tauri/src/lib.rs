use std::fs;
use std::io::Write;
use tauri::Emitter;
use tauri::Manager;

mod notifications;

/// Prevents helper processes from flashing a console window and stealing focus.
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;


fn runtime_pid_file() -> std::path::PathBuf {
  std::env::var("LOCALAPPDATA")
    .map(std::path::PathBuf::from)
    .unwrap_or_else(|_| std::path::PathBuf::from(r"C:\Temp"))
    .join("TimeLogger")
    .join("backend.pid")
}

fn app_data_dir() -> std::path::PathBuf {
  std::env::var("LOCALAPPDATA")
    .map(std::path::PathBuf::from)
    .unwrap_or_else(|_| std::path::PathBuf::from(r"C:\Temp"))
    .join("TimeLogger")
}

#[tauri::command]
fn get_app_data_dir() -> String {
  app_data_dir().to_string_lossy().to_string()
}

#[tauri::command]
fn write_microsoft_oauth_signal(success: bool, code: String, timestamp: String) -> Result<String, String> {
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
fn read_microsoft_oauth_signal(path: String) -> Result<serde_json::Value, String> {
  let data = fs::read_to_string(&path).map_err(|e| format!("Failed to read OAuth signal: {}", e))?;
  fs::remove_file(&path).map_err(|e| format!("Failed to clear OAuth signal: {}", e))?;
  serde_json::from_str(&data).map_err(|e| format!("Failed to parse OAuth signal: {}", e))
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
fn enable_autostart() -> Result<String, String> {
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
fn disable_autostart() -> Result<String, String> {
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

#[tauri::command]
async fn test_jira_connection(base_url: String, email: String, api_token: String, tempo_token: String) -> Result<serde_json::Value, String> {
  call_node_api("/setup/test-jira", serde_json::json!({
    "baseUrl": base_url,
    "email": email,
    "apiToken": api_token,
    "tempoToken": tempo_token,
  })).await
}

#[tauri::command]
async fn test_tempo_connection(tempo_token: String) -> Result<serde_json::Value, String> {
  call_node_api("/setup/test-tempo", serde_json::json!({
    "tempoToken": tempo_token,
  })).await
}

#[tauri::command]
async fn test_graph_connection(tenant_id: String, client_id: String, client_secret: Option<String>) -> Result<serde_json::Value, String> {
  call_node_api("/setup/test-graph", serde_json::json!({
    "tenantId": tenant_id,
    "clientId": client_id,
    "clientSecret": client_secret.filter(|s| !s.trim().is_empty()),
  })).await
}

#[tauri::command]
async fn get_oauth_status(clear: Option<bool>) -> Result<serde_json::Value, String> {
  let query = if clear == Some(true) { "?clear=true" } else { "" };
  call_node_api_get(&format!("/setup/oauth-status{}", query)).await
}

#[tauri::command]
async fn get_oauth_authorize_url() -> Result<serde_json::Value, String> {
  call_node_api_get("/setup/oauth-authorize-url").await
}

#[tauri::command]
fn start_microsoft_oauth(tenant_id: String, client_id: String, redirect_uri: String, scope: String) -> Result<String, String> {
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

#[tauri::command]
async fn test_ollama_connection(host: String) -> Result<serde_json::Value, String> {
  call_node_api("/setup/test-ollama", serde_json::json!({ "host": host })).await
}

#[tauri::command]
async fn complete_setup(config: serde_json::Value) -> Result<serde_json::Value, String> {
  call_node_api("/setup/complete", config).await
}

#[tauri::command]
async fn get_setup_status() -> Result<serde_json::Value, String> {
  call_node_api_get("/setup/status").await
}

const BACKEND_ORIGIN: &str = "http://127.0.0.1:3001";

static API_CLIENT: std::sync::OnceLock<Result<reqwest::Client, String>> = std::sync::OnceLock::new();
static HEALTH_CLIENT: std::sync::OnceLock<Result<reqwest::Client, String>> = std::sync::OnceLock::new();
static SETUP_CLIENT: std::sync::OnceLock<Result<reqwest::Client, String>> = std::sync::OnceLock::new();

fn shared_client(
  slot: &'static std::sync::OnceLock<Result<reqwest::Client, String>>,
  timeout: std::time::Duration,
) -> Result<&'static reqwest::Client, String> {
  slot.get_or_init(|| {
    reqwest::Client::builder()
      .timeout(timeout)
      .build()
      .map_err(|e| format!("Failed to create HTTP client: {}", e))
  }).as_ref().map_err(Clone::clone)
}

/// Serializes backend restarts. Concurrent failed calls would otherwise each
/// spawn a backend and kill the previous one, leaving nothing listening.
static BACKEND_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Set once the backend has been started successfully, so the watchdog knows a
/// missing listener is a crash rather than "not launched yet".
static BACKEND_WANTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Set when the user quits, so the watchdog does not resurrect the backend we
/// are deliberately shutting down.
static SHUTTING_DOWN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn backend_is_listening() -> bool {
  std::net::TcpStream::connect("127.0.0.1:3001").is_ok()
}

/// Starts the backend if needed. `force` restarts even a healthy backend, which
/// is what app startup wants so a stale process from an older build is replaced.
fn ensure_backend(force: bool) -> Result<String, String> {
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
fn start_backend_watchdog() {
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

/// Appends a line to the host-side log so the native transport can be
/// diagnosed without access to the webview console.
fn host_log(message: &str) {
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

/// Tools that change state outside this machine, where a silent retry could
/// duplicate the change.
///
/// A dropped connection does not tell us whether the backend received the
/// request. For a read that is harmless — repeating it returns the same data.
/// For a worklog write it is not: the first attempt may have reached Tempo and
/// succeeded, so re-sending would log the time twice. These tools therefore
/// surface the error and let the user decide, rather than retrying blindly.
fn is_retryable(tool_name: &str) -> bool {
  !matches!(
    tool_name,
    "tempo_submit_day"
      | "tempo_post_worklog"
      | "tempo_update_worklog"
      | "tempo_delete_worklog"
      | "tempo_import_worklogs"
  )
}

/// Proxies backend calls through Rust so the webview never performs a
/// cross-origin request. WebView2 applies CORS and private-network rules to
/// fetch() from the tauri.localhost origin; native HTTP has no such limits.
#[tauri::command]
async fn api_request(tool_name: String, args: serde_json::Value) -> Result<serde_json::Value, String> {
  let client = shared_client(&API_CLIENT, std::time::Duration::from_secs(120))?;

  let send = |client: &'static reqwest::Client, tool: String, args: serde_json::Value| async move {
    client
      .post(format!("{}/api/execute", BACKEND_ORIGIN))
      .json(&serde_json::json!({ "toolName": tool, "args": args }))
      .send()
      .await
  };

  let response = match send(client, tool_name.clone(), args.clone()).await {
    Ok(response) => response,
    Err(first_error) => {
      if !is_retryable(&tool_name) {
        host_log(&format!(
          "api_request {} failed: {}; not retried (may already have been applied)",
          tool_name, first_error
        ));
        // The backend is still restarted so the next action works, but this
        // request is reported as failed rather than repeated.
        let _ = tauri::async_runtime::spawn_blocking(|| ensure_backend(false)).await;
        return Err(format!(
          "The connection to the backend dropped while submitting. \
           This may or may not have reached Tempo — check Tempo before retrying. ({})",
          first_error
        ));
      }

      // A dropped connection usually means the backend died. Restart it and
      // retry once so a transient failure doesn't surface to the user.
      host_log(&format!("api_request {} failed: {}; restarting backend", tool_name, first_error));

      match tauri::async_runtime::spawn_blocking(|| ensure_backend(false))
        .await
        .map_err(|e| format!("Backend restart task failed: {}", e))?
      {
        Ok(status) => host_log(&format!("backend restart for {}: {}", tool_name, status)),
        Err(restart_error) => {
          host_log(&format!("backend restart for {} failed: {}", tool_name, restart_error));
          return Err(format!("Failed to reach backend: {}", restart_error));
        }
      }

      send(client, tool_name.clone(), args)
        .await
        .map_err(|e| format!("Failed to reach backend: {}", e))?
    }
  };

  let status = response.status();
  response
    .json::<serde_json::Value>()
    .await
    .map_err(|e| format!("Invalid backend response (HTTP {}): {}", status, e))
}

/// Returns true once the backend answers its health endpoint.
#[tauri::command]
async fn backend_health() -> bool {
  let Ok(client) = shared_client(&HEALTH_CLIENT, std::time::Duration::from_secs(2)) else {
    return false;
  };

  match client.get(format!("{}/health", BACKEND_ORIGIN)).send().await {
    Ok(response) => {
      host_log(&format!("backend_health: HTTP {}", response.status()));
      response.status().is_success()
    }
    Err(e) => {
      host_log(&format!("backend_health failed: {}", e));
      false
    }
  }
}

/// Sends a JSON POST to the backend using the native HTTP client.
///
/// Previously this shelled out to `node -e`. On Windows that spawned a console
/// window for every call, which stole focus from whatever the user was doing
/// (most visibly during the once-per-second OAuth sign-in poll).
async fn call_node_api(path: &str, payload: serde_json::Value) -> Result<serde_json::Value, String> {
  let client = shared_client(&SETUP_CLIENT, std::time::Duration::from_secs(60))?;

  let response = client
    .post(format!("{}/api{}", BACKEND_ORIGIN, path))
    .json(&payload)
    .send()
    .await
    .map_err(|e| format!("Failed to call backend: {}", e))?;

  parse_backend_response(response).await
}

/// Sends a GET to the backend using the native HTTP client.
async fn call_node_api_get(path: &str) -> Result<serde_json::Value, String> {
  let client = shared_client(&SETUP_CLIENT, std::time::Duration::from_secs(60))?;

  let response = client
    .get(format!("{}/api{}", BACKEND_ORIGIN, path))
    .send()
    .await
    .map_err(|e| format!("Failed to call backend: {}", e))?;

  parse_backend_response(response).await
}

/// Preserves the previous envelope semantics: non-2xx and `success: false`
/// bodies surface as Err so the setup UI keeps showing backend messages.
async fn parse_backend_response(response: reqwest::Response) -> Result<serde_json::Value, String> {
  let status = response.status();
  let body = response
    .text()
    .await
    .map_err(|e| format!("Failed to read backend response: {}", e))?;
  let trimmed = body.trim();

  if trimmed.is_empty() {
    return if status.is_success() {
      Ok(serde_json::json!({ "success": true }))
    } else {
      Err(format!("Backend request failed (HTTP {})", status))
    };
  }

  let parsed: serde_json::Value = match serde_json::from_str(trimmed) {
    Ok(value) => value,
    Err(_) => {
      return if status.is_success() {
        Ok(serde_json::json!({ "success": true, "body": trimmed }))
      } else {
        Err(trimmed.to_string())
      };
    }
  };

  if !status.is_success() || parsed.get("success").and_then(|v| v.as_bool()) == Some(false) {
    let message = parsed
      .get("message")
      .or_else(|| parsed.get("error"))
      .and_then(|v| v.as_str())
      .unwrap_or("Backend request failed");
    return Err(message.to_string());
  }

  Ok(parsed)
}
#[tauri::command]
async fn start_backend() -> Result<String, String> {
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
fn stop_backend() -> Result<String, String> {
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

#[tauri::command]
fn show_notification(title: String, message: String) -> Result<String, String> {
  notifications::show_generic(&title, &message)?;
  Ok("Notification shown".to_string())
}

#[tauri::command]
fn show_submission_success_notification(submission_date: String) -> Result<String, String> {
  notifications::show_submission_success(&submission_date)?;
  Ok("Notification shown".to_string())
}

#[tauri::command]
fn show_submission_error_notification(error: String) -> Result<String, String> {
  notifications::show_submission_error(&error)?;
  Ok("Notification shown".to_string())
}

#[tauri::command]
fn show_daily_reminder_notification(task_count: i32) -> Result<String, String> {
  notifications::show_daily_reminder(task_count as usize)?;
  Ok("Notification shown".to_string())
}

#[tauri::command]
fn show_tempo_reminder_notification(entry_count: i32, minutes: i32) -> Result<String, String> {
  notifications::show_tempo_reminder(entry_count.max(0) as usize, minutes.max(0) as usize)?;
  Ok("Notification shown".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // Closing the window only hides it to the tray, so relaunching from the
    // Start menu used to create a second instance. Both instances then fought
    // over port 3001, each killing the other's backend and leaving nothing
    // listening ("failed to reach backend"). Reuse the running instance.
    .plugin(tauri_plugin_updater::Builder::new().build())
    // The updater relaunches the app once the new version is installed.
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
      if let Some(window) = app.webview_windows().values().next() {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
      }
    }))
    .setup(|app| {
      // Set up system tray
      setup_tray(app)?;
      start_backend_watchdog();

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .on_window_event(|window, event| {
      match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
          api.prevent_close();
          window.hide().unwrap_or_else(|e| eprintln!("Failed to hide window: {}", e));
        }
        _ => {}
      }
    })
    .invoke_handler(tauri::generate_handler![start_backend, stop_backend, api_request, backend_health, enable_autostart, disable_autostart, open_external_url, test_jira_connection, test_graph_connection, test_tempo_connection, test_ollama_connection, complete_setup, get_setup_status, get_oauth_status, get_oauth_authorize_url, get_app_data_dir, write_microsoft_oauth_signal, read_microsoft_oauth_signal, start_microsoft_oauth, show_notification, show_submission_success_notification, show_submission_error_notification, show_daily_reminder_notification, show_tempo_reminder_notification])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
  use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
  use tauri::tray::TrayIconBuilder;

  let menu = Menu::new(app)?;

  let show_item = MenuItem::with_id(app, "show", "Show", true, None::<String>)?;
  let add_task_item = MenuItem::with_id(app, "add_task", "Add Task", true, None::<String>)?;
  let add_note_item = MenuItem::with_id(app, "add_note", "Add Note", true, None::<String>)?;
  let submit_time_item = MenuItem::with_id(app, "submit_time", "Submit Time", true, None::<String>)?;
  let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<String>)?;

  menu.append(&show_item)?;
  menu.append(&PredefinedMenuItem::separator(app)?)?;
  menu.append(&add_task_item)?;
  menu.append(&add_note_item)?;
  menu.append(&submit_time_item)?;
  menu.append(&PredefinedMenuItem::separator(app)?)?;
  menu.append(&quit_item)?;

  // Bring the window to the front, then tell the frontend what the user
  // wants to do next (navigate + focus a specific input).
  let show_and_navigate = |app: &tauri::AppHandle, target: &'static str| {
    if let Some(window) = app.webview_windows().values().next() {
      let _ = window.show();
      let _ = window.unminimize();
      let _ = window.set_focus();
    }
    let _ = app.emit("tray-navigate", target);
  };

  // Reuse the main window icon so the tray icon matches the app/taskbar icon
  // instead of needing a separate asset.
  let tray_icon = app.default_window_icon().cloned();

  let mut tray_builder = TrayIconBuilder::new()
    .menu(&menu)
    .show_menu_on_left_click(false)
    .on_menu_event(move |app, event| match event.id().as_ref() {
      "show" => {
        if let Some(window) = app.webview_windows().values().next() {
          let _ = window.show();
          let _ = window.unminimize();
          let _ = window.set_focus();
        }
      }
      "add_task" => show_and_navigate(app, "add-task"),
      "add_note" => show_and_navigate(app, "add-note"),
      "submit_time" => show_and_navigate(app, "submit-time"),
      "quit" => {
        SHUTTING_DOWN.store(true, std::sync::atomic::Ordering::SeqCst);
        let _ = stop_backend();
        app.exit(0);
      }
      _ => {}
    })
    .on_tray_icon_event(|tray, event| {
      use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};

      match event {
        TrayIconEvent::DoubleClick { button: MouseButton::Left, .. } => {
          let app = tray.app_handle();
          if let Some(window) = app.webview_windows().values().next() {
            let _ = window.show();
            let _ = window.set_focus();
          }
        }
        // Only react to a completed left-click here so a right-click is left
        // free to show the native context menu instead of also toggling the
        // window.
        TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } => {
          let app = tray.app_handle();
          if let Some(window) = app.webview_windows().values().next() {
            if window.is_visible().unwrap_or(false) {
              let _ = window.hide();
            } else {
              let _ = window.show();
              let _ = window.set_focus();
            }
          }
        }
        _ => {}
      }
    });

  if let Some(icon) = tray_icon {
    tray_builder = tray_builder.icon(icon);
  }

  let _tray = tray_builder.build(app)?;

  Ok(())
}


















#[tauri::command]
fn open_external_url(url: String) -> Result<String, String> {
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
