//! Update checks for the main and beta release channels.
//!
//! The updater plugin's own frontend `check` can only use the endpoint in
//! `tauri.conf.json`, so these commands choose it instead. The webview only ever
//! names a channel, never a URL, and every download is still verified against
//! the public key in `tauri.conf.json`.
//!
//! An older version is only ever offered as an explicit choice: rolling back, or
//! choosing Stable while on a beta build. Nothing installs without the user
//! accepting it.

use semver::Version;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{ipc::Channel, AppHandle, State};
use tauri_plugin_updater::{RemoteRelease, Update, UpdaterExt};
use url::Url;

const RELEASES_API: &str = "https://api.github.com/repos/MatthewGriffin/TimeLogger/releases?per_page=100";
// Anything older has no channel switch, and so no way back to beta.
const ROLLBACK_MINIMUM: Version = Version::new(0, 8, 0);
const ROLLBACK_CHOICES: usize = 20;

const MAIN_MANIFEST: &str =
  "https://github.com/MatthewGriffin/TimeLogger/releases/latest/download/latest.json";
// On its own branch because GitHub has no URL for the latest pre-release, and
// this repository's immutable releases can't be overwritten.
const BETA_MANIFEST: &str =
  "https://raw.githubusercontent.com/MatthewGriffin/TimeLogger/beta-manifest/latest.json";

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReleaseChannel {
  Main,
  Beta,
}

/// The update found by the last check, held until the user accepts it.
#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Update>>);

/// What installing this release means, which the dialog explains.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum UpdateKind {
  Update,
  /// Stable is chosen on a beta build, and the latest stable release is older.
  Switch,
  Rollback,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
  kind: UpdateKind,
  version: String,
  current_version: String,
  notes: String,
  changes: Vec<ReleaseNote>,
  release_date: String,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct ReleaseNote {
  version: String,
  changes: Vec<String>,
}

/// Picks the sections of a manifest's notes that are newer than the installed
/// version. Notes without version headings, as in releases before the changelog,
/// give nothing here, and the app shows them as plain text instead.
fn notes_newer_than(notes: &str, current: &str) -> Vec<ReleaseNote> {
  let current = Version::parse(current).ok();
  let mut sections: Vec<ReleaseNote> = Vec::new();
  let mut keep = false;

  for line in notes.lines() {
    if let Some(heading) = line.strip_prefix("## ") {
      let heading = heading.trim();
      keep = match (Version::parse(heading), &current) {
        (Ok(version), Some(current)) => version > *current,
        (Ok(_), None) => true,
        (Err(_), _) => false,
      };
      if keep {
        sections.push(ReleaseNote { version: heading.to_string(), changes: Vec::new() });
      }
    } else if let (true, Some(change), Some(section)) = (keep, line.strip_prefix("- "), sections.last_mut()) {
      section.changes.push(change.trim().to_string());
    }
  }
  sections
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub enum DownloadEvent {
  #[serde(rename_all = "camelCase")]
  Started { content_length: Option<u64> },
  #[serde(rename_all = "camelCase")]
  Progress { chunk_length: usize },
  Finished,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackVersion {
  version: String,
  release_date: String,
}

#[derive(Deserialize)]
struct GitHubRelease {
  tag_name: String,
  #[serde(default)]
  draft: bool,
  #[serde(default)]
  prerelease: bool,
  #[serde(default)]
  published_at: Option<String>,
}

/// The versions this install can roll back to, newest first. Stable users only
/// see stable releases, and tags that aren't versions are skipped.
fn rollback_choices(releases: Vec<GitHubRelease>, current: &Version, channel: ReleaseChannel) -> Vec<RollbackVersion> {
  let mut choices: Vec<(Version, String)> = releases
    .into_iter()
    .filter(|release| !release.draft)
    .filter(|release| matches!(channel, ReleaseChannel::Beta) || !release.prerelease)
    .filter_map(|release| {
      let version = Version::parse(release.tag_name.strip_prefix('v')?).ok()?;
      (version >= ROLLBACK_MINIMUM && version < *current).then(|| (version, release.published_at.unwrap_or_default()))
    })
    .collect();
  choices.sort_by(|a, b| b.0.cmp(&a.0));
  choices
    .into_iter()
    .take(ROLLBACK_CHOICES)
    .map(|(version, release_date)| RollbackVersion { version: version.to_string(), release_date })
    .collect()
}

/// Whether someone with Stable chosen should be offered this stable release. A
/// beta build isn't on stable, so it's offered the latest even though it's older.
fn stable_offers(current: &Version, release: &Version) -> bool {
  release > current || (!current.pre.is_empty() && release != current)
}

async fn check_manifest(
  app: &AppHandle,
  manifest: &str,
  accept: impl Fn(Version, RemoteRelease) -> bool + Send + Sync + 'static,
) -> Result<Option<Update>, String> {
  let url = Url::parse(manifest).map_err(|e| e.to_string())?;
  app
    .updater_builder()
    .version_comparator(accept)
    .endpoints(vec![url])
    .map_err(|e| e.to_string())?
    .build()
    .map_err(|e| e.to_string())?
    .check()
    .await
    .map_err(|e| e.to_string())
}

/// Picks the update for someone on the beta channel from both channels' checks.
///
/// Main can be ahead of beta, such as when a beta becomes a full release, and a
/// beta user shouldn't be left behind. Beta also has no manifest until its first
/// release, so one failed check isn't an error while the other succeeded.
fn choose_for_beta<T>(
  beta: Result<Option<T>, String>,
  main: Result<Option<T>, String>,
  version_of: impl Fn(&T) -> &str,
) -> Result<Option<T>, String> {
  match (beta, main) {
    (Err(error), Err(_)) => Err(error),
    (Ok(found), Err(_)) | (Err(_), Ok(found)) => Ok(found),
    (Ok(None), Ok(found)) | (Ok(found), Ok(None)) => Ok(found),
    (Ok(Some(beta)), Ok(Some(main))) => {
      let main_is_newer = match (Version::parse(version_of(&beta)), Version::parse(version_of(&main))) {
        (Ok(beta_version), Ok(main_version)) => main_version > beta_version,
        _ => false,
      };
      Ok(Some(if main_is_newer { main } else { beta }))
    }
  }
}

fn is_newer(current: Version, release: RemoteRelease) -> bool {
  release.version > current
}

fn metadata_for(update: &Update, kind: UpdateKind) -> UpdateMetadata {
  // Going back has nothing new to list, and an older release's notes would mislead.
  let notes = match kind {
    UpdateKind::Update => update.body.clone().unwrap_or_default(),
    UpdateKind::Switch | UpdateKind::Rollback => String::new(),
  };
  UpdateMetadata {
    kind,
    version: update.version.clone(),
    current_version: update.current_version.clone(),
    changes: notes_newer_than(&notes, &update.current_version),
    notes,
    release_date: update
      .raw_json
      .get("pub_date")
      .and_then(|date| date.as_str())
      .unwrap_or_default()
      .to_string(),
  }
}

#[tauri::command]
pub async fn check_for_update(
  app: AppHandle,
  pending: State<'_, PendingUpdate>,
  channel: ReleaseChannel,
) -> Result<Option<UpdateMetadata>, String> {
  let update = match channel {
    ReleaseChannel::Main => {
      check_manifest(&app, MAIN_MANIFEST, |current, release| stable_offers(&current, &release.version)).await?
    }
    ReleaseChannel::Beta => {
      let beta = check_manifest(&app, BETA_MANIFEST, is_newer).await;
      let main = check_manifest(&app, MAIN_MANIFEST, is_newer).await;
      choose_for_beta(beta, main, |update: &Update| update.version.as_str())?
    }
  };

  let metadata = update.as_ref().map(|update| {
    let older = match (Version::parse(&update.version), Version::parse(&update.current_version)) {
      (Ok(version), Ok(current)) => version < current,
      _ => false,
    };
    metadata_for(update, if older { UpdateKind::Switch } else { UpdateKind::Update })
  });
  *pending.0.lock().map_err(|e| e.to_string())? = update;
  Ok(metadata)
}

#[tauri::command]
pub async fn list_rollback_versions(app: AppHandle, channel: ReleaseChannel) -> Result<Vec<RollbackVersion>, String> {
  let releases = reqwest::Client::new()
    .get(RELEASES_API)
    .header(reqwest::header::USER_AGENT, "TimeLogger")
    .header(reqwest::header::ACCEPT, "application/vnd.github+json")
    .send()
    .await
    .and_then(|response| response.error_for_status())
    .map_err(|e| e.to_string())?
    .json::<Vec<GitHubRelease>>()
    .await
    .map_err(|e| e.to_string())?;
  Ok(rollback_choices(releases, &app.package_info().version, channel))
}

/// Finds a chosen older release, ready for `install_update`. It uses that
/// release's own manifest, so the download is verified the same way as any update.
#[tauri::command]
pub async fn prepare_rollback(
  app: AppHandle,
  pending: State<'_, PendingUpdate>,
  version: String,
) -> Result<UpdateMetadata, String> {
  // Parsed first, so that only a real version number can reach the URL.
  let target = Version::parse(&version).map_err(|e| e.to_string())?;
  if target < ROLLBACK_MINIMUM || target >= app.package_info().version {
    return Err(format!("TimeLogger can't roll back to {target}."));
  }

  let manifest = format!("https://github.com/MatthewGriffin/TimeLogger/releases/download/v{target}/latest.json");
  let wanted = target.clone();
  let update = check_manifest(&app, &manifest, move |_, release| release.version == wanted)
    .await?
    .ok_or_else(|| format!("TimeLogger {target} couldn't be found."))?;

  let metadata = metadata_for(&update, UpdateKind::Rollback);
  *pending.0.lock().map_err(|e| e.to_string())? = Some(update);
  Ok(metadata)
}

#[tauri::command]
pub async fn install_update(
  pending: State<'_, PendingUpdate>,
  on_event: Channel<DownloadEvent>,
) -> Result<(), String> {
  let update = pending
    .0
    .lock()
    .map_err(|e| e.to_string())?
    .clone()
    .ok_or("There is no update to install.")?;

  let mut started = false;
  update
    .download_and_install(
      |chunk_length, content_length| {
        if !started {
          started = true;
          let _ = on_event.send(DownloadEvent::Started { content_length });
        }
        let _ = on_event.send(DownloadEvent::Progress { chunk_length });
      },
      || {
        // The installer replaces the backend's files, including the native
        // sqlite module the running backend holds open, and the updater exits
        // the app right after starting it, so the normal exit cleanup never
        // runs. Stop the backend now, or the install fails with "Error opening
        // file for writing" on win32-x64.node.
        crate::backend::SHUTTING_DOWN.store(true, std::sync::atomic::Ordering::SeqCst);
        let _ = crate::backend::stop_backend();
        let _ = on_event.send(DownloadEvent::Finished);
      },
    )
    .await
    .map_err(|e| {
      // The app carries on after a failed install, so bring the backend back.
      if crate::backend::SHUTTING_DOWN.swap(false, std::sync::atomic::Ordering::SeqCst) {
        let _ = std::thread::spawn(|| crate::backend::ensure_backend(false));
      }
      e.to_string()
    })
}

#[cfg(test)]
mod tests {
  use super::*;

  fn choose(
    beta: Result<Option<&'static str>, String>,
    main: Result<Option<&'static str>, String>,
  ) -> Result<Option<&'static str>, String> {
    choose_for_beta(beta, main, |version| version)
  }

  #[test]
  fn the_newer_channel_wins() {
    assert_eq!(choose(Ok(Some("0.9.0-beta.2")), Ok(Some("0.8.1"))), Ok(Some("0.9.0-beta.2")));
    assert_eq!(choose(Ok(Some("0.9.0-beta.2")), Ok(Some("0.9.0"))), Ok(Some("0.9.0")));
  }

  #[test]
  fn an_update_from_either_channel_is_used() {
    assert_eq!(choose(Ok(None), Ok(Some("0.9.0"))), Ok(Some("0.9.0")));
    assert_eq!(choose(Ok(Some("0.9.0-beta.1")), Ok(None)), Ok(Some("0.9.0-beta.1")));
    assert_eq!(choose(Ok(None), Ok(None)), Ok(None));
  }

  #[test]
  fn one_failed_check_does_not_hide_the_other() {
    assert_eq!(choose(Err("no manifest".into()), Ok(Some("0.9.0"))), Ok(Some("0.9.0")));
    assert_eq!(choose(Ok(Some("0.9.0-beta.1")), Err("offline".into())), Ok(Some("0.9.0-beta.1")));
  }

  #[test]
  fn two_failed_checks_are_an_error() {
    assert_eq!(choose(Err("beta".into()), Err("main".into())), Err("beta".to_string()));
  }

  const NOTES: &str = "## 0.9.0\n- Stable summary\n\n## 0.9.0-beta.2\n- Second beta\n- Another change\r\n\r\n## 0.8.1\n- Older";

  fn versions(notes: &[ReleaseNote]) -> Vec<&str> {
    notes.iter().map(|note| note.version.as_str()).collect()
  }

  #[test]
  fn only_sections_newer_than_the_installed_version_are_shown() {
    assert_eq!(versions(&notes_newer_than(NOTES, "0.8.1")), ["0.9.0", "0.9.0-beta.2"]);
    assert_eq!(versions(&notes_newer_than(NOTES, "0.9.0-beta.2")), ["0.9.0"]);
    assert!(notes_newer_than(NOTES, "0.9.0").is_empty());
  }

  #[test]
  fn each_section_keeps_its_own_changes() {
    let notes = notes_newer_than(NOTES, "0.9.0-beta.1");
    assert_eq!(notes[0], ReleaseNote { version: "0.9.0".into(), changes: vec!["Stable summary".into()] });
    assert_eq!(notes[1].changes, ["Second beta", "Another change"]);
  }

  #[test]
  fn notes_without_version_headings_give_no_sections() {
    assert!(notes_newer_than("See https://github.com/example/releases/tag/v0.8.2", "0.8.1").is_empty());
    assert!(notes_newer_than("## Not a version\n- Change", "0.8.1").is_empty());
    assert!(notes_newer_than("", "0.8.1").is_empty());
  }

  fn version(text: &str) -> Version {
    Version::parse(text).unwrap()
  }

  #[test]
  fn stable_offers_a_newer_release_to_anyone() {
    assert!(stable_offers(&version("0.8.2"), &version("0.8.3")));
    assert!(stable_offers(&version("0.9.0-beta.1"), &version("0.9.0")));
  }

  #[test]
  fn stable_offers_an_older_release_only_to_a_beta_build() {
    assert!(stable_offers(&version("0.9.0-beta.1"), &version("0.8.2")));
    assert!(!stable_offers(&version("0.8.3"), &version("0.8.2")));
    assert!(!stable_offers(&version("0.8.2"), &version("0.8.2")));
  }

  fn release(tag: &str, prerelease: bool) -> GitHubRelease {
    GitHubRelease { tag_name: tag.into(), draft: false, prerelease, published_at: Some("2026-11-06T12:00:00Z".into()) }
  }

  fn sample_releases() -> Vec<GitHubRelease> {
    vec![
      release("v0.7.102", false),
      release("v0.8.0", false),
      release("v0.8.2-beta.1", true),
      release("v0.8.2", false),
      release("beta-channel", true),
      GitHubRelease { draft: true, ..release("v0.8.1", false) },
      release("v0.8.3-beta.1", true),
      release("v0.9.0", false),
    ]
  }

  fn choice_versions(choices: Vec<RollbackVersion>) -> Vec<String> {
    choices.into_iter().map(|choice| choice.version).collect()
  }

  #[test]
  fn stable_users_can_roll_back_to_older_stable_releases_only() {
    let choices = rollback_choices(sample_releases(), &version("0.8.3"), ReleaseChannel::Main);
    assert_eq!(choice_versions(choices), ["0.8.2", "0.8.0"]);
  }

  #[test]
  fn beta_users_can_roll_back_to_betas_as_well() {
    let choices = rollback_choices(sample_releases(), &version("0.8.3-beta.2"), ReleaseChannel::Beta);
    assert_eq!(choice_versions(choices), ["0.8.3-beta.1", "0.8.2", "0.8.2-beta.1", "0.8.0"]);
  }

  #[test]
  fn rollback_keeps_only_the_newest_choices() {
    let releases = (0..30).map(|patch| release(&format!("v0.8.{patch}"), false)).collect();
    let choices = choice_versions(rollback_choices(releases, &version("0.9.0"), ReleaseChannel::Main));
    assert_eq!(choices.len(), ROLLBACK_CHOICES);
    assert_eq!(choices[0], "0.8.29");
  }

  #[test]
  fn only_known_channels_are_accepted() {
    assert!(serde_json::from_str::<ReleaseChannel>("\"beta\"").is_ok());
    assert!(serde_json::from_str::<ReleaseChannel>("\"main\"").is_ok());
    assert!(serde_json::from_str::<ReleaseChannel>("\"https://example.com\"").is_err());
  }
}
