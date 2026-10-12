//! Installing a new version in place. The updater reads the latest
//! release's manifest (`latest.json`, beside the installers), downloads
//! the installer for this computer and checks it was signed with Kasten's
//! key. Once the page's typing is written and committed, it installs it
//! and the app restarts on the new version.
//!
//! Only builds made with the key's public half have an updater: others,
//! such as development and CI builds, offer the download instead.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Error, Update, UpdaterExt};
use tauri_plugin_window_state::AppHandleExt;

use crate::closing::MAIN;
use crate::commands::notes::OpenVault;

/// The event that carries the download's progress.
const PROGRESS: &str = "kasten://update-progress";

/// How long asking for the manifest may take.
const ASK_WAIT: Duration = Duration::from_secs(30);

/// How long the whole download may take, even on a slow line.
const DOWNLOAD_WAIT: Duration = Duration::from_secs(15 * 60);

/// The public key installers must be signed with, from the app's config;
/// None in a build without one, which then has no updater.
pub fn signing_key(config: &tauri::Config) -> Option<String> {
    let key = config.plugins.0.get("updater")?.get("pubkey")?.as_str()?;
    let key = key.trim();
    (!key.is_empty()).then(|| key.to_owned())
}

/// Whether this build can install in place, and the download waiting to be
/// installed.
pub struct Installer {
    on: bool,
    ready: Mutex<Option<(Update, Vec<u8>)>>,
}

impl Installer {
    pub fn new(on: bool) -> Installer {
        Installer {
            on,
            ready: Mutex::new(None),
        }
    }

    pub fn on(&self) -> bool {
        self.on
    }
}

#[derive(Clone, Serialize)]
struct Progress {
    done: u64,
    total: Option<u64>,
}

/// An updater error in words for the person.
fn explain(err: Error) -> String {
    match err {
        Error::TargetsNotFound(_) | Error::TargetNotFound(_) => {
            "This kind of install can't update itself. Download the new version instead.".into()
        }
        Error::ReleaseNotFound => "The latest release can't be installed from here yet.".into(),
        Error::Minisign(_) | Error::SignatureUtf8(_) | Error::Base64(_) => {
            "The download isn't signed with KastenFlow's key, so it was not installed.".into()
        }
        Error::SignedVersionMismatch { .. } => {
            "The download was signed for another version, so it was not installed.".into()
        }
        Error::AuthenticationFailed => {
            "Installing needs your permission, which was not given.".into()
        }
        Error::Reqwest(err) if err.is_timeout() => {
            "GitHub took too long to answer. Try again later.".into()
        }
        Error::Reqwest(_) | Error::Network(_) => {
            "Could not reach GitHub. Check the connection and try again.".into()
        }
        other => format!("The update could not be installed: {other}"),
    }
}

/// Commits the typing the page has written, so it is in history before the
/// app goes.
fn commit(app: &AppHandle) {
    if let Some(kasten) = app.state::<OpenVault>().kasten() {
        let _ = crate::crash::caught(|| kasten.commit_edits().map_err(|e| e.to_string()));
    }
}

/// Looks for a newer version and downloads it, telling the page how far it
/// got. Answers the version ready to install, or None when there is none.
#[tauri::command]
pub async fn update_prepare(
    app: AppHandle,
    installer: State<'_, Installer>,
) -> Result<Option<String>, String> {
    if !installer.on {
        return Err("This copy of KastenFlow can't install updates itself.".into());
    }
    let manifest = crate::updates::manifest_url(env!("CARGO_PKG_REPOSITORY"))
        .ok_or("This build does not say where its releases are.")?;
    let manifest = manifest.parse().map_err(|e| format!("{e}"))?;
    // On Windows the installer ends this process itself, so that path
    // commits, keeps the window's place and lets go of the one-window lock
    // first.
    let exiting = app.clone();
    let updater = app
        .updater_builder()
        .endpoints(vec![manifest])
        .map_err(explain)?
        .timeout(ASK_WAIT)
        .on_before_exit(move || {
            commit(&exiting);
            let _ = exiting.save_window_state(crate::main_window::remembered());
            tauri_plugin_single_instance::destroy(&exiting);
            exiting.cleanup_before_exit();
        })
        .build()
        .map_err(explain)?;
    let Some(mut update) = updater.check().await.map_err(explain)? else {
        return Ok(None);
    };
    update.timeout = Some(DOWNLOAD_WAIT);
    let mut done = 0u64;
    let mut told = 0u64;
    let bytes = update
        .download(
            |chunk, total| {
                done += chunk as u64;
                // A word every quarter megabyte is plenty for a progress bar.
                if done - told >= 256 * 1024 || Some(done) == total {
                    told = done;
                    let _ = app.emit_to(MAIN, PROGRESS, Progress { done, total });
                }
            },
            || {},
        )
        .await
        .map_err(explain)?;
    let version = update.version.clone();
    *installer.ready.lock().unwrap_or_else(|e| e.into_inner()) = Some((update, bytes));
    // Heard in the window when it is in front; otherwise a notice says so.
    crate::notify::tell(
        &app,
        crate::notify::Notice::UpdateReady {
            version: version.clone(),
        },
    );
    Ok(Some(version))
}

/// Installs the downloaded version, then restarts on it once the page has
/// written what was typed since.
#[tauri::command(async)]
pub fn update_install(app: AppHandle, installer: State<'_, Installer>) -> Result<(), String> {
    let (update, bytes) = installer
        .ready
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
        .ok_or("Download the new version first.")?;
    commit(&app);
    update.install(bytes).map_err(explain)?;
    crate::closing::restart_when_written(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(plugins: serde_json::Value) -> tauri::Config {
        serde_json::from_value(serde_json::json!({
            "identifier": "io.github.nbharathik.kasten",
            "plugins": plugins,
        }))
        .unwrap()
    }

    #[test]
    fn only_a_build_with_the_public_key_has_an_updater() {
        let key = config(serde_json::json!({ "updater": { "pubkey": " RWQ-key " } }));
        assert_eq!(signing_key(&key).as_deref(), Some("RWQ-key"));
        assert_eq!(
            signing_key(&config(serde_json::json!({ "updater": { "pubkey": "" } }))),
            None
        );
        assert_eq!(signing_key(&config(serde_json::json!({}))), None);
    }

    #[test]
    fn the_shipped_config_asks_for_signed_versions_and_a_quiet_install() {
        let shipped: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let updater = &shipped["plugins"]["updater"];
        assert_eq!(updater["requireSignedVersion"], true);
        assert_eq!(updater["windows"]["installMode"], "passive");
        // The manifest's address comes from the build, not the config.
        assert!(updater.get("endpoints").is_none());
    }

    #[test]
    fn errors_say_what_to_do() {
        assert!(explain(Error::TargetsNotFound(vec!["linux-x86_64".into()])).contains("Download"));
        assert!(explain(Error::ReleaseNotFound).contains("latest release"));
        assert!(explain(Error::AuthenticationFailed).contains("permission"));
    }
}
