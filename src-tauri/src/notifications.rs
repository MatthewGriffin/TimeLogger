use std::sync::OnceLock;
use tauri::AppHandle;
use tauri_plugin_notification::{ActionPerformed, NotificationExt};

use crate::platform::host_log;

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

const URL_EXTRA: &str = "url";

pub fn set_app_handle(handle: AppHandle) {
    let _ = APP_HANDLE.set(handle);
}

/// The link to open for a toast action: only a click on the toast itself counts.
fn clicked_url(action: &ActionPerformed) -> Option<&str> {
    if action.action_id() != "tap" {
        return None;
    }
    action.notification()?.extra().get(URL_EXTRA)?.as_str()
}

/// Opens a toast's link when it is clicked. Toasts shown before this runs report
/// nothing, so it has to be registered during setup. On Windows a click is only
/// reported while the toast is on screen; the in-app inbox keeps the link after that.
pub fn register_click_handler(app: &AppHandle) {
    let handle = app.clone();
    let registered = app.notification().on_action(move |action| {
        let Some(url) = clicked_url(action).map(str::to_owned) else {
            return;
        };
        // The plugin calls this on a background thread without COM set up, which
        // ShellExecute may need, so open the link from the main thread instead.
        let scheduled = handle.run_on_main_thread(move || {
            if let Err(error) = crate::files::open_external_url(url) {
                host_log(&format!("Could not open notification link: {error}"));
            }
        });
        if let Err(error) = scheduled {
            host_log(&format!("Could not open notification link: {error}"));
        }
    });
    if let Err(error) = registered {
        host_log(&format!("Could not register the notification click handler: {error}"));
    }
}

#[derive(Debug, Clone)]
pub struct Notification {
    pub title: String,
    pub body: String,
    pub url: Option<String>,
}

impl Notification {
    pub fn new(title: impl Into<String>, body: impl Into<String>) -> Self {
        Self { title: title.into(), body: body.into(), url: None }
    }

    pub fn with_url(mut self, url: impl Into<String>) -> Self {
        let value = url.into();
        if value.starts_with("https://github.com/") {
            self.url = Some(value);
        }
        self
    }

    pub fn show(&self) -> Result<(), String> {
        let app = APP_HANDLE.get()
            .ok_or_else(|| "Application handle is not available".to_string())?;
        let mut builder = app.notification().builder()
            .title(&self.title)
            .body(&self.body);
        if let Some(url) = &self.url {
            builder = builder.extra(URL_EXTRA, url);
        }
        builder.show()
            .map_err(|e| format!("Failed to show notification: {e}"))
    }
}

pub fn show_submission_success(submission_date: &str) -> Result<(), String> {
    Notification::new("✅ Time Entry Submitted", format!("Successfully submitted entries for {}", submission_date)).show()
}

pub fn show_submission_error(error: &str) -> Result<(), String> {
    Notification::new("❌ Submission Failed", format!("Failed to submit entries: {}", error)).show()
}

pub fn show_daily_reminder(task_count: usize) -> Result<(), String> {
    Notification::new("⏰ Daily Summary", format!("You have {} time entries to review", task_count)).show()
}

fn format_duration(minutes: usize) -> String {
    let hours = minutes / 60;
    let mins = minutes % 60;
    match (hours, mins) {
        (0, m) => format!("{}m", m),
        (h, 0) => format!("{}h", h),
        (h, m) => format!("{}h {}m", h, m),
    }
}

/// Reminder that time has been logged locally but not sent to Tempo.
pub fn show_tempo_reminder(entry_count: usize, minutes: usize) -> Result<(), String> {
    let entries = if entry_count == 1 { "entry" } else { "entries" };
    let body = if minutes > 0 {
        format!("{} {} ({}) not yet submitted to Tempo.", entry_count, entries, format_duration(minutes))
    } else {
        format!("{} {} not yet submitted to Tempo.", entry_count, entries)
    };
    Notification::new("⏱️ Submit your time to Tempo", body).show()
}

#[allow(dead_code)]
pub fn show_calendar_reminder(event_title: &str, time_until: &str) -> Result<(), String> {
    Notification::new("📅 Upcoming Event", format!("{} starts {}", event_title, time_until)).show()
}

pub fn show_generic_with_url(title: &str, message: &str, url: Option<&str>) -> Result<(), String> {
    let notif = match url {
        Some(value) => Notification::new(title, message).with_url(value),
        None => Notification::new(title, message),
    };
    notif.show()
}

#[tauri::command]
pub fn show_notification(title: String, message: String, url: Option<String>) -> Result<String, String> {
    show_generic_with_url(&title, &message, url.as_deref())?;
    Ok("Notification shown".to_string())
}

#[tauri::command]
pub fn show_submission_success_notification(submission_date: String) -> Result<String, String> {
    show_submission_success(&submission_date)?;
    Ok("Notification shown".to_string())
}

#[tauri::command]
pub fn show_submission_error_notification(error: String) -> Result<String, String> {
    show_submission_error(&error)?;
    Ok("Notification shown".to_string())
}

#[tauri::command]
pub fn show_daily_reminder_notification(task_count: i32) -> Result<String, String> {
    show_daily_reminder(task_count.max(0) as usize)?;
    Ok("Notification shown".to_string())
}

#[tauri::command]
pub fn show_tempo_reminder_notification(entry_count: i32, minutes: i32) -> Result<String, String> {
    show_tempo_reminder(entry_count.max(0) as usize, minutes.max(0) as usize)?;
    Ok("Notification shown".to_string())
}

#[cfg(test)]
mod tests {
    use super::{clicked_url, ActionPerformed, URL_EXTRA};
    use serde_json::json;
    use tauri_plugin_notification::NotificationData;

    /// Builds the action the way the plugin does: the whole serialized
    /// `NotificationData` is the payload, and it must survive being read back.
    fn action(action_id: &str, extra: serde_json::Value) -> ActionPerformed {
        let data: NotificationData = serde_json::from_value(json!({ "title": "PR", "extra": extra })).unwrap();
        serde_json::from_value(json!({
            "actionId": action_id,
            "inputValue": null,
            "notification": serde_json::to_value(&data).unwrap(),
        }))
        .unwrap()
    }

    #[test]
    fn clicking_a_toast_with_a_link_gives_that_link() {
        let url = "https://github.com/owner/repo/pull/1";
        assert_eq!(clicked_url(&action("tap", json!({ URL_EXTRA: url }))), Some(url));
    }

    #[test]
    fn a_toast_without_a_link_opens_nothing() {
        assert_eq!(clicked_url(&action("tap", json!({}))), None);
    }

    #[test]
    fn only_a_click_on_the_toast_itself_opens_the_link() {
        let extra = json!({ URL_EXTRA: "https://github.com/owner/repo/pull/1" });
        assert_eq!(clicked_url(&action("dismiss", extra)), None);
    }
}
