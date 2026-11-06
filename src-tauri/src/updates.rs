//! Update checks for the main and beta release channels.
//!
//! The updater plugin's own frontend `check` can only use the endpoint in
//! `tauri.conf.json`, so these commands choose it instead. The webview only ever
//! names a channel, never a URL, and every download is still verified against
//! the public key in `tauri.conf.json`.
//!
//! There are deliberately no downgrades. Someone moving from beta to main keeps
//! their build until main has a newer version, so nobody lands on an older app
//! than the one that last wrote their database.

use semver::Version;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{ipc::Channel, AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};
use url::Url;

const MAIN_MANIFEST: &str =
  "https://github.com/MatthewGriffin/TimeLogger/releases/latest/download/latest.json";
const BETA_MANIFEST: &str =
  "https://github.com/MatthewGriffin/TimeLogger/releases/download/beta-channel/latest.json";

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReleaseChannel {
  Main,
  Beta,
}

/// The update found by the last check, held until the user accepts it.
#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Update>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
  version: String,
  current_version: String,
  notes: String,
  release_date: String,
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

async fn check_manifest(app: &AppHandle, manifest: &str) -> Result<Option<Update>, String> {
  let url = Url::parse(manifest).map_err(|e| e.to_string())?;
  app
    .updater_builder()
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

#[tauri::command]
pub async fn check_for_update(
  app: AppHandle,
  pending: State<'_, PendingUpdate>,
  channel: ReleaseChannel,
) -> Result<Option<UpdateMetadata>, String> {
  let update = match channel {
    ReleaseChannel::Main => check_manifest(&app, MAIN_MANIFEST).await?,
    ReleaseChannel::Beta => {
      let beta = check_manifest(&app, BETA_MANIFEST).await;
      let main = check_manifest(&app, MAIN_MANIFEST).await;
      choose_for_beta(beta, main, |update: &Update| update.version.as_str())?
    }
  };

  let metadata = update.as_ref().map(|update| UpdateMetadata {
    version: update.version.clone(),
    current_version: update.current_version.clone(),
    notes: update.body.clone().unwrap_or_default(),
    release_date: update
      .raw_json
      .get("pub_date")
      .and_then(|date| date.as_str())
      .unwrap_or_default()
      .to_string(),
  });
  *pending.0.lock().map_err(|e| e.to_string())? = update;
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
        let _ = on_event.send(DownloadEvent::Finished);
      },
    )
    .await
    .map_err(|e| e.to_string())
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

  #[test]
  fn only_known_channels_are_accepted() {
    assert!(serde_json::from_str::<ReleaseChannel>("\"beta\"").is_ok());
    assert!(serde_json::from_str::<ReleaseChannel>("\"main\"").is_ok());
    assert!(serde_json::from_str::<ReleaseChannel>("\"https://example.com\"").is_err());
  }
}
