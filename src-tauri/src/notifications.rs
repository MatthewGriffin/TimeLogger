use std::sync::OnceLock;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

pub fn set_app_handle(handle: AppHandle) {
    let _ = APP_HANDLE.set(handle);
}

#[derive(Debug, Clone)]
pub struct Notification {
    pub title: String,
    pub body: String,
    // Retained for compatibility with existing callers. The Tauri notification
    // plugin does not currently expose desktop click actions on Windows.
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
        app.notification().builder()
            .title(&self.title)
            .body(&self.body)
            .show()
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
