//! Tauri host for TimeLogger.
//!
//! This file only wires the app together. Each area of behaviour lives in its
//! own module:
//!
//! - [`platform`]   paths, host logging and process flags
//! - [`backend`]    starting, watching and stopping the Node sidecar
//! - [`api`]        native HTTP transport to that sidecar
//! - [`setup`]      proxies for the setup screens
//! - [`oauth`]      Microsoft sign-in handshake
//! - [`autostart`]  the Windows "run at login" entry
//! - [`files`]      narrow filesystem and shell commands
//! - [`tray`]       system tray icon and menu
//! - [`notifications`] Windows toasts

use tauri::Manager;

mod api;
mod autostart;
mod backend;
mod files;
mod notifications;
mod oauth;
mod platform;
mod setup;
mod tray;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // Closing the window only hides it to the tray, so relaunching from the
    // Start menu used to create a second instance. Both instances then fought
    // over port 3001, each killing the other's backend and leaving nothing
    // listening ("failed to reach backend"). Reuse the running instance.
    .plugin(tauri_plugin_updater::Builder::new().build())
    // Backup and restore need a native file picker. The file itself is read
    // and written by dedicated commands rather than the fs plugin, so no
    // wildcard filesystem scope has to be granted to the webview.
    .plugin(tauri_plugin_dialog::init())
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
      tray::setup_tray(app)?;
      backend::start_backend_watchdog();

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
    .invoke_handler(tauri::generate_handler![
      backend::start_backend,
      backend::stop_backend,
      api::api_request,
      api::backend_health,
      autostart::enable_autostart,
      autostart::disable_autostart,
      files::open_external_url,
      files::open_logs_folder,
      files::write_backup_file,
      files::read_backup_file,
      setup::test_jira_connection,
      setup::test_graph_connection,
      setup::test_tempo_connection,
      setup::test_ollama_connection,
      setup::complete_setup,
      setup::get_setup_status,
      setup::get_oauth_status,
      setup::get_oauth_authorize_url,
      platform::get_app_data_dir,
      oauth::write_microsoft_oauth_signal,
      oauth::read_microsoft_oauth_signal,
      oauth::start_microsoft_oauth,
      notifications::show_notification,
      notifications::show_submission_success_notification,
      notifications::show_submission_error_notification,
      notifications::show_daily_reminder_notification,
      notifications::show_tempo_reminder_notification
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
