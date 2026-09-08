//! System tray icon and its menu.

use tauri::{Emitter, Manager};

use crate::backend::{stop_backend, SHUTTING_DOWN};

pub(crate) fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
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
