use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Stops the helper PowerShell process from flashing a console window. A
/// reminder that blinks a black box on screen is exactly the interruption
/// notifications are supposed to avoid.
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Windows will not display a toast for an unknown application. The AUMID
/// must be registered, otherwise `CreateToastNotifier` throws
/// RPC_E_SERVERFAULT and nothing is ever shown.
#[cfg(target_os = "windows")]
const APP_USER_MODEL_ID: &str = "com.timelogger.app";

#[cfg(target_os = "windows")]
const DISPLAY_NAME: &str = "TimeLogger";

/// WinRT types are only available to Windows PowerShell 5.1. PowerShell 7
/// cannot load them, so resolving `powershell` through PATH is not safe -
/// address the 5.1 binary directly.
#[cfg(target_os = "windows")]
fn powershell_path() -> String {
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
    format!("{}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", root)
}

/// Escape text for inclusion in the toast XML document. Without this an
/// ampersand or angle bracket in a task name makes the XML invalid and the
/// notification silently fails to appear.
#[cfg(target_os = "windows")]
fn escape_xml(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// Escape a value for a single-quoted PowerShell literal, where the only
/// special character is the quote itself.
#[cfg(target_os = "windows")]
fn escape_ps_single(text: &str) -> String {
    text.replace('\'', "''")
}

#[derive(Debug, Clone)]
pub struct Notification {
    pub title: String,
    pub body: String,
}

impl Notification {
    pub fn new(title: impl Into<String>, body: impl Into<String>) -> Self {
        Self {
            title: title.into(),
            body: body.into(),
        }
    }

    #[cfg(target_os = "windows")]
    pub fn show(&self) -> Result<(), String> {
        let toast_xml = format!(
            "<toast><visual><binding template=\"ToastText02\"><text id=\"1\">{}</text><text id=\"2\">{}</text></binding></visual></toast>",
            escape_xml(&self.title),
            escape_xml(&self.body),
        );

        // Both WinRT assemblies must be loaded explicitly. Loading only
        // ToastNotificationManager leaves XmlDocument unresolvable, which was
        // why every notification failed before.
        let ps_script = format!(
            r#"
$ErrorActionPreference = 'Stop'
$aumid = '{aumid}'
$key = "HKCU:\SOFTWARE\Classes\AppUserModelId\$aumid"
if (-not (Test-Path $key)) {{ New-Item -Path $key -Force | Out-Null }}
New-ItemProperty -Path $key -Name DisplayName -Value '{display}' -PropertyType String -Force | Out-Null

[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] > $null

$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml('{toast}')
$toast = New-Object Windows.UI.Notifications.ToastNotification $xml
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($aumid).Show($toast)
"#,
            aumid = APP_USER_MODEL_ID,
            display = escape_ps_single(DISPLAY_NAME),
            toast = escape_ps_single(&toast_xml),
        );

        let output = Command::new(powershell_path())
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle",
                "Hidden",
                "-Command",
                &ps_script,
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("Failed to show notification: {}", e))?;

        if output.status.success() {
            return Ok(());
        }

        // Previously a failure with empty stderr was reported as success, so a
        // broken notification pipeline looked healthy from the app's side.
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if err.is_empty() {
            format!("Notification failed with exit code {:?}", output.status.code())
        } else {
            err
        })
    }

    #[cfg(not(target_os = "windows"))]
    pub fn show(&self) -> Result<(), String> {
        Err("Notifications only supported on Windows".to_string())
    }
}

pub fn show_submission_success(submission_date: &str) -> Result<(), String> {
    let notif = Notification::new(
        "✅ Time Entry Submitted",
        format!("Successfully submitted entries for {}", submission_date),
    );
    notif.show()
}

pub fn show_submission_error(error: &str) -> Result<(), String> {
    let notif = Notification::new(
        "❌ Submission Failed",
        format!("Failed to submit entries: {}", error),
    );
    notif.show()
}

pub fn show_daily_reminder(task_count: usize) -> Result<(), String> {
    let notif = Notification::new(
        "⏰ Daily Summary",
        format!("You have {} time entries to review", task_count),
    );
    notif.show()
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
        format!(
            "{} {} ({}) not yet submitted to Tempo.",
            entry_count,
            entries,
            format_duration(minutes)
        )
    } else {
        format!("{} {} not yet submitted to Tempo.", entry_count, entries)
    };

    let notif = Notification::new("⏱️ Submit your time to Tempo", body);
    notif.show()
}

#[allow(dead_code)]
pub fn show_calendar_reminder(event_title: &str, time_until: &str) -> Result<(), String> {
    let notif = Notification::new(
        "📅 Upcoming Event",
        format!("{} starts {}", event_title, time_until),
    );
    notif.show()
}

pub fn show_generic(title: &str, message: &str) -> Result<(), String> {
    let notif = Notification::new(title, message);
    notif.show()
}

// ---------------------------------------------------------------------------
// Commands exposed to the webview. These wrap the functions above so the
// frontend gets a uniform Result<String, String> instead of Result<(), String>.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn show_notification(title: String, message: String) -> Result<String, String> {
  show_generic(&title, &message)?;
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
  show_daily_reminder(task_count as usize)?;
  Ok("Notification shown".to_string())
}

#[tauri::command]
pub fn show_tempo_reminder_notification(entry_count: i32, minutes: i32) -> Result<String, String> {
  show_tempo_reminder(entry_count.max(0) as usize, minutes.max(0) as usize)?;
  Ok("Notification shown".to_string())
}

