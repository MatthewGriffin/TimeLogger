//! Thin proxies for the setup screens. Each forwards to the backend's
//! `/api/setup/*` routes, which own the actual credential checks.

use crate::api::{call_node_api, call_node_api_get};

#[tauri::command]
pub async fn test_jira_connection(base_url: String, email: String, api_token: String, tempo_token: String) -> Result<serde_json::Value, String> {
  call_node_api("/setup/test-jira", serde_json::json!({
    "baseUrl": base_url,
    "email": email,
    "apiToken": api_token,
    "tempoToken": tempo_token,
  })).await
}

#[tauri::command]
pub async fn test_tempo_connection(tempo_token: String) -> Result<serde_json::Value, String> {
  call_node_api("/setup/test-tempo", serde_json::json!({
    "tempoToken": tempo_token,
  })).await
}

#[tauri::command]
pub async fn test_graph_connection(tenant_id: String, client_id: String, client_secret: Option<String>) -> Result<serde_json::Value, String> {
  call_node_api("/setup/test-graph", serde_json::json!({
    "tenantId": tenant_id,
    "clientId": client_id,
    "clientSecret": client_secret.filter(|s| !s.trim().is_empty()),
  })).await
}

#[tauri::command]
pub async fn test_ollama_connection(host: String) -> Result<serde_json::Value, String> {
  call_node_api("/setup/test-ollama", serde_json::json!({ "host": host })).await
}

#[tauri::command]
pub async fn get_oauth_status(clear: Option<bool>) -> Result<serde_json::Value, String> {
  let query = if clear == Some(true) { "?clear=true" } else { "" };
  call_node_api_get(&format!("/setup/oauth-status{}", query)).await
}

#[tauri::command]
pub async fn get_oauth_authorize_url() -> Result<serde_json::Value, String> {
  call_node_api_get("/setup/oauth-authorize-url").await
}

#[tauri::command]
pub async fn complete_setup(config: serde_json::Value) -> Result<serde_json::Value, String> {
  call_node_api("/setup/complete", config).await
}

#[tauri::command]
pub async fn get_setup_status() -> Result<serde_json::Value, String> {
  call_node_api_get("/setup/status").await
}
