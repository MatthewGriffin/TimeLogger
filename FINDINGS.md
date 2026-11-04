# TimeLogger Codebase & Security Findings

This document summarizes the comprehensive analysis of TimeLogger across the Tauri host (`src-tauri/`), Express sidecar (`src-node/`), and Vue 3 frontend (`src/`).

---

## 1. Windows Defender False Positive Risks & Heuristic Triggers

Desktop applications (particularly those built with Rust/Tauri, Go, or Node) are subject to automated behavioral telemetry by Windows Defender Antivirus, AMSI, and Endpoint Detection and Response (EDR) solutions. When helper processes are spawned with `CREATE_NO_WINDOW` (0x08000000) or invoke known Living Off the Land Binaries (LOLBins), Defender heuristics routinely flag the application as malicious (e.g., `Trojan:Win32/Wacatac`, `Behavior:Win32/Persistence`).

### 1.1 `reg.exe` Invocation for Autostart Persistence (High Risk)
* **Location:** `src-tauri/src/autostart.rs` (Lines 20–42)
* **Issue:**
  The host invokes `reg.exe add HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run ...` via `std::process::Command` using `CREATE_NO_WINDOW`.
* **Heuristic Risk:**
  Spawning a hidden command-line `reg.exe` process to write into the `Run` registry key is an explicit behavioral rule match for malware persistence (`Behavior:Win32/Persistence`). Unsigned or low-reputation binaries executing this command are frequently quarantined.
* **Remediation:**
  Use in-process Win32 Registry APIs instead of launching `reg.exe`. Rust crates like `winreg` or `windows-sys` call `RegOpenKeyExW` / `RegSetValueExW` directly in-process. In-process registry configuration is standard desktop software behavior and generates no suspicious child-process creation events. Alternatively, use Tauri's official autostart plugin (`tauri-plugin-autostart`).

### 1.2 Piped `cmd.exe` Batch Loop for Port Reclaim / Process Termination (High Risk)
* **Location:** `src-tauri/src/backend.rs` (Lines 224–228, 324–328)
* **Issue:**
  ```rust
  let reclaim_command = format!("for /f \"tokens=5\" %a in ('netstat -ano ^| find \":{}\" ^| find \"LISTENING\"') do taskkill /PID %a /F", backend_port());
  let _ = std::process::Command::new("cmd.exe")
    .args(&["/c", &reclaim_command])
    .creation_flags(CREATE_NO_WINDOW)
    .output();
  ```
* **Heuristic Risk:**
  Spawning hidden `cmd.exe /c` processes executing one-liner shell loops (`for /f ... in ('netstat -ano ^| find ...') do taskkill ... /F`) triggers aggressive heuristics (such as `Behavior:Win32/CmdExecution` and generic trojan dropper rules).
* **Reliability Risk:**
  If an unrelated application or service on the machine is bound to port 3001, this command forcefully kills that process without checking image name or process ownership.
* **Remediation:**
  Implement a `POST /api/shutdown` route in Express (`src-node/server.js`) so the backend shuts down cleanly. When forced termination is necessary, kill only the verified PID recorded in `backend.pid` via native process handles or Win32 `TerminateProcess`.

### 1.3 LOLBin `rundll32.exe` to Open URLs (High Risk)
* **Location:** `src-tauri/src/files.rs` (Lines 22–26)
* **Issue:**
  Spawns `rundll32.exe url.dll,FileProtocolHandler <url>` with `CREATE_NO_WINDOW`.
* **Heuristic Risk:**
  `rundll32.exe` is a monitored Living Off the Land Binary (LOLBin). Malware frequently launches `rundll32` with hidden windows to bypass security controls and initiate outbound connections. Microsoft Defender Attack Surface Reduction (ASR) rules and behavior monitors actively flag non-system processes launching `rundll32.exe`.
* **Remediation:**
  Open URLs using the Win32 API `ShellExecuteW(NULL, L"open", url, NULL, NULL, SW_SHOWNORMAL)`. This can be achieved via the `open` crate (`open::that(&url)`) or `tauri_plugin_opener`, avoiding child process creation for `rundll32.exe`.

### 1.4 Runtime Binary Deletion (Medium Risk)
* **Location:** `src-tauri/src/backend.rs` (Lines 73–99, `prune_non_target_binaries`)
* **Issue:**
  At startup, the host checks for and deletes `node_modules/better-sqlite3/prebuilds/win32-arm64.node`.
* **Heuristic Risk:**
  An application deleting or altering executable `.node` / `.dll` files in its installation directory on launch triggers heuristic alerts. Additionally, when installed in `C:\Program Files`, standard users lack write permissions, causing unhandled permission errors.
* **Remediation:**
  Prune unused prebuilds during the build and packaging step in CI/CD before generating the NSIS installer.

### 1.5 Missing Authenticode Code Signing (Medium-High Risk)
* **Location:** `.github/workflows/release.yml` (Lines 105–135)
* **Issue:**
  While Tauri updater artifacts are signed with a minisign private key, the installer executable (`TimeLogger_*_x64-setup.exe`) and installed binary are not signed with a Microsoft Authenticode certificate.
* **Heuristic Risk:**
  Unsigned executables have zero SmartScreen reputation, causing Windows Defender SmartScreen to block downloads ("Windows protected your PC"). Unsigned binaries that also execute child processes like `cmd.exe` and `reg.exe` are prime targets for machine learning false positives.
* **Remediation:**
  Sign releases using Azure Trusted Signing or a hardware/cloud code signing certificate via `signtool.exe` in the release workflow.

---

## 2. UI Consistency & Theme Conformance

The project defines explicit design and layout rules in `UI-CONSISTENCY.md`. Multiple screens deviate from these standards:

### 2.1 Unstyled Component: Broken Button Class
* **Location:** `src/features/notifications/Notifications.vue` (Line 10)
* **Issue:**
  `<button v-if="notifications.length > 0" class="btn-range" type="button" @click="clearAll">Clear all</button>`
  `.btn-range` is **not** a shared class; it was scoped inside `Submit.vue`. Because it does not exist in `Notifications.vue` or `components.css`, the button renders completely unstyled as a default browser button.
* **Remediation:** Replace with shared class `.btn-secondary`.

### 2.2 Broken Page Shell & Geometry Alignment
* **`DailyEntries.vue` (Line 21):**
  Uses `.entries-content` with hardcoded `padding: 3rem; max-width: 1400px; margin: 0 auto;` instead of the shared `.page-body` class (`padding: var(--page-block) var(--page-gutter); max-width: var(--page-max);`).
* **`Calendar.vue` (Line 26):**
  Uses `.calendar-content` with hardcoded `padding: 2rem 3rem; max-width: 1600px;` instead of `.page-body.wide`.
* **`Submit.vue` (Line 20 & 39):**
  The date range bar (`.range-bar`) has `padding: 0 var(--page-gutter)` with no `max-width`, while `.submit-content` has `max-width: var(--page-max-wide); margin: 0 auto;`. On wide viewports (such as 1700px), the date range sticks to the left edge while the table content is centered at 1600px. `UI-CONSISTENCY.md` explicitly forbids having different horizontal gutters for header, date bar, and main content on the same screen.
* **`Dashboard.vue` (Line 18):**
  Renders `<ConfigurationStatus />` outside `.page-body`, causing the banner to span full width while the main dashboard grid is constrained to 1400px.

### 2.3 Hardcoded Color Tokens & Accessibility Contrast Bugs
* **Severe Contrast Failure:** `src/features/settings/components/MicrosoftSettings.vue` (Line 12) uses inline style `style="color: #666;"`. On a dark theme (`#0f172a`), `#666` text fails WCAG AA contrast and is barely readable.
* **Non-Token Hex Values:**
  * `Notifications.vue` (Line 96): `.notification-warning { border-left-color: #f59e0b; }` (should be `var(--color-warning)`).
  * `ScrumBlockersPanel.vue` (Line 95): `color: #1f2937` and non-standard radius `border-radius: 0.75rem` (tokens only define `0.375rem`, `0.5rem`, `1rem`).
  * `Notes.vue` (Line 671) & `Settings.vue` (Line 886): Hardcoded sidebar surface `background: rgba(20, 30, 50, 0.8)`.
  * `forms.css` (Line 61): Hardcoded `.lookup-msg.bad { color: #f87171; }` instead of `var(--color-danger)`.
  * `Submit.vue`: Multiple raw badge colors (`#4ade80`, `#60a5fa`, `#c084fc`, `#facc15`, `#f472b6`).

### 2.4 Modal and Dialog Fragmentation
* `src/styles/components.css` defines standard modal classes (`.modal-overlay`, `.modal`, `.modal-header`, `.modal-close`, `.modal-footer`).
* Dialogs such as `ConfirmDangerDialog.vue`, `UpdateDialog.vue`, `AiModelPrompt.vue`, and `MeetingConflictPrompt.vue` implement custom `.confirm-backdrop` / `.update-backdrop` overlays and one-off action buttons (`.confirm-cancel`, `.confirm-accept`, `.update-primary`, `.update-secondary`) rather than reusing the shared modal system.

---

## 3. Code Duplication & Refactoring Opportunities

| Duplication Area | Locations | Recommended Refactoring |
| :--- | :--- | :--- |
| **`formatDuration(minutes)`** | `Dashboard.vue` (Line 367)<br>`DailyEntries.vue` (Line 357)<br>`Submit.vue` (Line 502) | Move the identical 8-line duration formatting helper into `src/shared/utils/dates.ts`. |
| **`formatTime(time)`** | `Calendar.vue` (Line 416)<br>`DailyEntries.vue` (Line 351) | Move `formatTime` into `src/shared/utils/dates.ts`. |
| **`toLocalDateString` vs `localDate`** | `Calendar.vue` (Line 175)<br>`src/shared/utils/dates.ts` (Line 15) | Replace `Calendar.vue`'s custom `toLocalDateString` with `localDate` imported from `dates.ts`. |
| **Time Math for Duration** | `DailyEntries.vue` (Line 340)<br>`Calendar.vue` (Line 425) | Extract clock string duration calculation (`"HH:MM" -> minutes`) into a shared helper in `dates.ts`. |
| **Calendar Sync Handlers** | `DailyEntries.vue` (Lines 382–405)<br>`Calendar.vue` (Lines 349–370) | Extract common calendar synchronization dispatch and prompt handling logic into a composable. |
| **Table Chrome CSS** | `DailyEntries.vue` (Line 844)<br>`Submit.vue` (Line 1053) | `.entries-table`, `.table-header`, `.table-body`, and `.table-row` styles are duplicated verbatim. Extract `.data-table` into `components.css`. |
| **Navigation Action Buttons** | `Calendar.vue` (Line 511)<br>`DailyEntries.vue` (Line 720)<br>`Notes.vue` (Line 607) | `.btn-nav`, `.btn-today`, and `.btn-sync` are duplicated across three scoped stylesheets. |
| **Database Settings Queries** | 8+ files across `src-node/tools/` | Multiple files repeat `db.prepare("SELECT value FROM settings WHERE key = ?").get(...)` with manual JSON parsing. Add `getSetting(key, default)` and `setSetting(key, val)` in `src-node/db.js`. |

---

## 4. Code Issues, Logic Bugs & Reliability

### 4.1 Bug: GitHub Search API Query Rejection (HTTP 422)
* **Location:** `src-node/tools/github-prs.js` (Line 349)
* **The Code:**
  ```javascript
  const query = `is:pr created:${date} OR is:pr merged:${date} OR is:pr updated:${date}`;
  const items = await searchPrs(token, login, query);
  ```
* **The Issue:**
  GitHub's search syntax does not allow boolean operators (`OR`) between qualifiers without search terms:
  > `"The search contains only logical operators (AND / OR / NOT) without any search terms. Logical operators only apply to text, not to qualifiers."`
  Every time `getPullRequestsWithMajorUpdatesOnDate` is called by `src-node/tools/scrum.js`, GitHub responds with HTTP 422, causing PR activity to fail silently in the Daily Scrum screen.
* **Remediation:**
  Query using `is:pr updated:${date}` (which captures updates, creation, and merges on that date) or run separate queries and combine the candidate items.

### 4.2 Rust Compiler Warning: Unused Code
* **Location:** `src-tauri/src/notifications.rs` (Line 82)
* **Issue:** `pub fn show_generic(title: &str, message: &str) -> Result<(), String>` is dead code and emits a compiler warning during `cargo check`.
* **Remediation:** Remove the unused function or annotate with `#[allow(dead_code)]`.

### 4.3 Machine-Specific Development Fallback Path
* **Location:** `src-tauri/src/backend.rs` (Line 163)
* **Issue:**
  `possible_paths.push(std::path::PathBuf::from("C:\\repos\\TimeLogger\\timelogger-app\\src-node"));`
  Hardcoded development path pointing to another developer environment.
* **Remediation:** Remove hardcoded absolute paths and rely on relative bundle discovery.

### 4.4 Unhandled Async in `beforeunload`
* **Location:** `src/App.vue` (Lines 153–159)
* **Issue:**
  ```typescript
  window.addEventListener('beforeunload', async () => {
    try { await invoke('stop_backend') } catch { }
  })
  ```
  The browser/WebView `beforeunload` event does not await promises. The window unloads immediately and terminates pending asynchronous IPC calls.
* **Remediation:** Drive backend lifecycle from native Tauri window events (`WindowEvent::CloseRequested`) and tray exit handlers.

### 4.5 Unused Plugin Dependency in Rust
* **Location:** `src-tauri/Cargo.toml` (Line 26) & `src-tauri/capabilities/default.json` (Line 10)
* **Issue:** `tauri-plugin-shell = "2.0.0"` is included in dependencies and granted in permissions, but never initialized in `src-tauri/src/lib.rs`.
