//! Native HTTP transport to the Node backend.
//!
//! Every backend call goes through here rather than `fetch()` in the webview,
//! which would be subject to WebView2's CORS and private-network rules.

use crate::backend::ensure_backend;
use crate::platform::host_log;

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
pub async fn api_request(tool_name: String, args: serde_json::Value) -> Result<serde_json::Value, String> {
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
pub async fn backend_health() -> bool {
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
pub(crate) async fn call_node_api(path: &str, payload: serde_json::Value) -> Result<serde_json::Value, String> {
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
pub(crate) async fn call_node_api_get(path: &str) -> Result<serde_json::Value, String> {
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
