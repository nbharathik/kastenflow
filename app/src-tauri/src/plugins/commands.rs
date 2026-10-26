//! The commands the window uses to list plugins, turn them on and off, and
//! install, cancel and remove a plugin's downloaded payload (progress told as
//! `plugin-payload` events). Whether a plugin is on is written by kasten-core
//! (or, for the browser, the app's settings); nothing here writes the vault.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use kasten_core::Instant;
use kasten_core::history::Actor;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use super::payload::{self, Failure, Phase, Progress, Spec};
use super::{PluginInfo, Scope, check, find, is_on, payload_root, pins};
use crate::browser::Browser;
use crate::diagrams::Editor;
use crate::open_vault::OpenVault;

/// The event that tells the window how far a payload's install is.
pub const EVENT: &str = "plugin-payload";

/// The installs that are running, so a second one cannot start for the same
/// plugin and the first can be cancelled.
#[derive(Default)]
pub struct Payloads {
    running: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl Payloads {
    fn held(&self) -> std::sync::MutexGuard<'_, HashMap<String, Arc<AtomicBool>>> {
        self.running.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn begin(&self, id: &str) -> Result<Arc<AtomicBool>, String> {
        let mut running = self.held();
        if running.contains_key(id) {
            return Err("It is already being installed".to_owned());
        }
        let cancel = Arc::new(AtomicBool::new(false));
        running.insert(id.to_owned(), Arc::clone(&cancel));
        Ok(cancel)
    }

    pub fn end(&self, id: &str) {
        self.held().remove(id);
    }

    pub fn busy(&self, id: &str) -> bool {
        self.held().contains_key(id)
    }

    fn cancel(&self, id: &str) {
        if let Some(flag) = self.held().get(id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

/// One step of an install, as the window hears it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: String,
    /// idle, downloading, verifying, installing, ready, failed or cancelled.
    pub state: &'static str,
    pub done: u64,
    pub total: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl Event {
    fn of(id: &str, state: &'static str) -> Event {
        Event {
            id: id.to_owned(),
            state,
            done: 0,
            total: 0,
            error: None,
        }
    }

    fn progress(id: &str, progress: Progress) -> Event {
        Event {
            state: match progress.phase {
                Phase::Downloading => "downloading",
                Phase::Verifying => "verifying",
                Phase::Extracting => "installing",
            },
            done: progress.done,
            total: progress.total,
            ..Event::of(id, "idle")
        }
    }

    /// How an install ended.
    pub fn ended(id: &str, result: &Result<(), Failure>) -> Event {
        match result {
            Ok(()) => Event::of(id, "ready"),
            Err(Failure::Cancelled) => Event::of(id, "cancelled"),
            Err(failure) => Event {
                error: Some(failure.message()),
                ..Event::of(id, "failed")
            },
        }
    }
}

/// How to unpack plugin `id`'s download, if it has one.
fn spec_of(id: &str) -> Option<Spec> {
    match id {
        "diagrams" => Some(crate::diagrams::editor_spec(crate::diagrams::LIMITS)),
        "latex" => Some(super::latex::unpack::spec()),
        _ => None,
    }
}

/// The folder plugin `id`'s payload is kept in.
fn root_of(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let local = app
        .path()
        .app_local_data_dir()
        .map_err(|err| format!("KastenFlow has no folder for plugins: {err}"))?;
    Ok(payload_root(&local, id))
}

/// Whether plugin `id`'s pinned payload is installed whole.
fn installed(app: &AppHandle, id: &str) -> bool {
    let (Some((version, _)), Some(spec)) = (pins::current(id), spec_of(id)) else {
        return false;
    };
    root_of(app, id)
        .is_ok_and(|root| payload::installed_version(&root.join(version), version, spec.required))
}

/// A version of plugin `id`'s payload that is installed whole, whichever it is
/// (the newest by name when there are several): an app that pins a newer
/// release than the one downloaded earlier offers an update.
fn installed_any(app: &AppHandle, id: &str) -> Option<String> {
    let spec = spec_of(id)?;
    let root = root_of(app, id).ok()?;
    let mut found: Vec<String> = std::fs::read_dir(&root)
        .ok()?
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            payload::installed_version(&entry.path(), &name, spec.required).then_some(name)
        })
        .collect();
    found.sort();
    found.pop()
}

/// A plugin and whether it is on.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginView {
    #[serde(flatten)]
    pub info: PluginInfo,
    pub enabled: bool,
}

#[tauri::command(async)]
pub fn plugins_list(app: AppHandle) -> Vec<PluginView> {
    super::catalog()
        .into_iter()
        .map(|info| PluginView {
            enabled: is_on(&app, &info),
            info,
        })
        .collect()
}

/// Turns plugin `id` on or off: in the vault for a plugin that belongs to it
/// (one commit, which Undo takes back), in the app's settings for one that
/// belongs to the computer. Answers whether anything changed.
#[tauri::command(async)]
pub fn plugin_set_enabled(
    app: AppHandle,
    vault: State<'_, OpenVault>,
    browser: State<'_, Browser>,
    id: String,
    on: bool,
) -> Result<bool, String> {
    let info = find(&id)?;
    match info.scope {
        Scope::Vault => vault.run(|k| k.set_plugin_enabled(&Actor::Human, &id, on, Instant::now())),
        Scope::Computer => {
            let was = is_on(&app, &info);
            crate::browser::set_browser_enabled(app, browser, on)?;
            Ok(was != on)
        }
    }
}

/// What the window shows about a plugin's payload.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PayloadStatus {
    pub id: String,
    pub state: &'static str,
    pub installed: bool,
    pub busy: bool,
    pub version: Option<&'static str>,
    pub size_bytes: u64,
    /// A version installed whole, when it is not the pinned one: the card
    /// offers "Update available".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_version: Option<String>,
}

#[tauri::command(async)]
pub fn plugin_payload_status(
    app: AppHandle,
    payloads: State<'_, Payloads>,
    editor: State<'_, Editor>,
    id: String,
) -> Result<PayloadStatus, String> {
    find(&id)?;
    let pin = pins::current(&id);
    let installed = installed(&app, &id);
    let busy = payloads.busy(&id) || (id == "diagrams" && editor.busy());
    Ok(PayloadStatus {
        state: if busy {
            "downloading"
        } else if installed {
            "ready"
        } else {
            "idle"
        },
        installed,
        busy,
        version: pin.map(|(version, _)| version),
        size_bytes: pin.map_or(0, |(_, pin)| pin.size),
        installed_version: if installed {
            None
        } else {
            installed_any(&app, &id)
        },
        id,
    })
}

/// Downloads and installs plugin `id`'s payload, telling progress as events;
/// answers `installed` or `cancelled` when it is over, or why it failed. The
/// plugin must be on.
#[tauri::command]
pub async fn plugin_payload_install(
    app: AppHandle,
    payloads: State<'_, Payloads>,
    editor: State<'_, Editor>,
    id: String,
) -> Result<&'static str, String> {
    let info = find(&id)?;
    check(&info, is_on(&app, &info))?;
    let (Some(source), Some(spec)) = (pins::source(&id), spec_of(&id)) else {
        return Err(format!("The {} plugin has nothing to download", info.name));
    };
    if id == "diagrams" && editor.busy() {
        return Err("The diagram editor is already being installed".to_owned());
    }
    let cancel = payloads.begin(&id)?;
    let told = app.clone();
    let name = id.clone();
    let _ = told.emit(EVENT, Event::of(&id, "downloading"));
    let result = async {
        let root = root_of(&app, &id).map_err(Failure::Failed)?;
        let web = payload::client(payload::release_host).map_err(Failure::Failed)?;
        let report = Arc::new(move |progress: Progress| {
            let _ = told.emit(EVENT, Event::progress(&name, progress));
        });
        payload::install(&web, &source, &root, &spec, cancel, report).await
    }
    .await;
    payloads.end(&id);
    let _ = app.emit(EVENT, Event::ended(&id, &result));
    match result {
        Ok(()) => Ok("installed"),
        Err(Failure::Cancelled) => Ok("cancelled"),
        Err(failure) => Err(failure.message()),
    }
}

/// Stops the install that is running.
#[tauri::command]
pub fn plugin_payload_cancel(payloads: State<'_, Payloads>, id: String) {
    payloads.cancel(&id);
}

/// Takes plugin `id`'s downloaded payload away: only the app's own copy in
/// its data folder, never anything in the vault.
#[tauri::command(async)]
pub fn plugin_payload_remove(
    app: AppHandle,
    payloads: State<'_, Payloads>,
    editor: State<'_, Editor>,
    id: String,
) -> Result<(), String> {
    find(&id)?;
    if payloads.busy(&id) || (id == "diagrams" && editor.busy()) {
        return Err("It is being installed; cancel that first".to_owned());
    }
    super::clean::forget_folder(&root_of(&app, &id)?);
    let _ = app.emit(EVENT, Event::of(&id, "idle"));
    Ok(())
}
