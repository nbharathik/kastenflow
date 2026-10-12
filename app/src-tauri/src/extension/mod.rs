//! The browser extension's way into Kasten. A small server on this computer's
//! own address (127.0.0.1, port 7434 unless changed), running only while Kasten
//! does and only when the switch in Settings is on. The extension pairs once
//! with a code Settings shows, then adds captures (a page, a selection, a link
//! or a picture) as cards or as quotes in a page. It can add and nothing
//! else: it cannot read a note, change one or delete one, and each capture is
//! one op that Undo takes back. The server is not the MCP server: it speaks
//! three routes, and the vault is reached through `capture_web` alone.

mod api;
mod limit;
mod pairing;
mod server;
mod shared;
mod store;
#[cfg(test)]
mod tests;

use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::app_settings::AppSettings;
use crate::closing::MAIN;
use crate::commands::notes::OpenVault;
use limit::Limits;
use pairing::Pairing;
use server::Server;
use shared::{Shared, held};
use store::{PairedInfo, Store};

/// Where the extension knocks, unless Settings changes the port.
pub const DEFAULT_PORT: u16 = 7434;
/// The lowest port Settings accepts: the ones below it belong to the system.
const LOWEST_PORT: u16 = 1024;

/// The extension door, managed by the app.
#[derive(Default)]
pub struct Extension {
    shared: OnceLock<Arc<Shared>>,
    server: tokio::sync::Mutex<Option<Server>>,
    /// Why the door could not open (the port is taken), to show in Settings.
    problem: Mutex<Option<String>>,
}

/// The code waiting to be typed into the extension.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingInfo {
    code: String,
    seconds_left: u64,
    tries_left: u8,
}

/// What Settings shows: the switch, the port, whether the door is open, the
/// extensions paired (never their tokens) and the code waiting.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    enabled: bool,
    port: u16,
    running: bool,
    problem: Option<String>,
    paired: Vec<PairedInfo>,
    pairing: Option<PairingInfo>,
}

impl Extension {
    fn shared(&self) -> Result<&Arc<Shared>, String> {
        self.shared
            .get()
            .ok_or_else(|| "The extension door is not ready yet".to_owned())
    }

    /// Opens the door on `port`, in place of any open one; why it cannot
    /// (the port is taken) is kept for Settings.
    async fn listen(&self, port: u16) {
        let Ok(shared) = self.shared() else {
            return;
        };
        let mut slot = self.server.lock().await;
        if let Some(old) = slot.take() {
            old.stop().await;
        }
        match Server::start(port, Arc::clone(shared)).await {
            Ok(server) => {
                *slot = Some(server);
                *held(&self.problem) = None;
            }
            Err(why) => *held(&self.problem) = Some(why),
        }
    }

    /// Closes the door, and the code waiting with it.
    async fn shut(&self) {
        if let Some(old) = self.server.lock().await.take() {
            old.stop().await;
        }
        *held(&self.problem) = None;
        if let Ok(shared) = self.shared() {
            held(&shared.pairing).cancel();
        }
    }
}

fn config_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_config_dir().map_err(|e| e.to_string())
}

/// Reads the saved switch when the app starts, and opens the door if it is on.
pub fn start(app: &AppHandle) {
    let dir = app.path().app_config_dir().ok();
    let settings = dir.as_deref().map(AppSettings::load).unwrap_or_default();
    let vault = app.clone();
    let told = app.clone();
    let shared = Arc::new(Shared::new(
        Box::new(move || vault.state::<OpenVault>().require()),
        Box::new(move |paths| {
            // To the main window only, as the watcher does.
            let _ = told.emit_to(MAIN, "vault-changed", &paths);
        }),
        Store::load(dir),
        Pairing::new(pairing::TTL, pairing::TRIES),
        Limits::usual(),
    ));
    shared.on.store(settings.extension_on(), Ordering::Relaxed);
    let extension = app.state::<Extension>();
    let _ = extension.shared.set(shared);
    if settings.extension_on() {
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            handle
                .state::<Extension>()
                .listen(settings.extension_port())
                .await;
        });
    }
}

async fn status(app: &AppHandle, extension: &Extension) -> Result<Status, String> {
    let settings = AppSettings::load(&config_dir(app)?);
    let shared = extension.shared()?;
    // The port it listens on, when it is open; else the one chosen.
    let listening = extension.server.lock().await.as_ref().map(Server::port);
    let paired = held(&shared.store).infos();
    let pairing = held(&shared.pairing)
        .offer(Instant::now())
        .map(|offer| PairingInfo {
            code: offer.code,
            seconds_left: offer.seconds_left,
            tries_left: offer.tries_left,
        });
    Ok(Status {
        enabled: settings.extension_on(),
        port: listening.unwrap_or_else(|| settings.extension_port()),
        running: listening.is_some(),
        problem: held(&extension.problem).clone(),
        paired,
        pairing,
    })
}

/// The switch, the port, the extensions paired and the code waiting.
#[tauri::command]
pub async fn extension_status(
    app: AppHandle,
    extension: State<'_, Extension>,
) -> Result<Status, String> {
    status(&app, &extension).await
}

/// Opens or closes the door (and saves the switch). Closing also forgets
/// the code waiting; the extensions stay paired.
#[tauri::command]
pub async fn set_extension_enabled(
    app: AppHandle,
    extension: State<'_, Extension>,
    on: bool,
) -> Result<Status, String> {
    let port = AppSettings::update(&config_dir(&app)?, |s| {
        s.extension = Some(on);
        s.extension_port()
    })
    .map_err(|e| e.to_string())?;
    extension.shared()?.on.store(on, Ordering::Relaxed);
    if on {
        extension.listen(port).await;
    } else {
        extension.shut().await;
    }
    status(&app, &extension).await
}

/// Changes the port the door listens on, and reopens it there if it is open.
#[tauri::command]
pub async fn set_extension_port(
    app: AppHandle,
    extension: State<'_, Extension>,
    port: u16,
) -> Result<Status, String> {
    if port < LOWEST_PORT {
        return Err(format!(
            "Pick a port from {LOWEST_PORT} up: the ones below belong to the system"
        ));
    }
    let on = AppSettings::update(&config_dir(&app)?, |s| {
        s.extension_port = (port != DEFAULT_PORT).then_some(port);
        s.extension_on()
    })
    .map_err(|e| e.to_string())?;
    if on {
        extension.listen(port).await;
    }
    status(&app, &extension).await
}

/// Makes a pairing code, good for 2 minutes and 5 tries, in place of any
/// earlier one. The door must be open: there is nothing to pair with otherwise.
#[tauri::command]
pub async fn extension_pair_start(
    app: AppHandle,
    extension: State<'_, Extension>,
) -> Result<Status, String> {
    if extension.server.lock().await.is_none() {
        return Err("Turn the extension on first, and make sure its port is free".to_owned());
    }
    let code = pairing::new_code()?;
    held(&extension.shared()?.pairing).start(code, Instant::now());
    status(&app, &extension).await
}

/// Throws away the code waiting.
#[tauri::command]
pub async fn extension_pair_cancel(
    app: AppHandle,
    extension: State<'_, Extension>,
) -> Result<Status, String> {
    held(&extension.shared()?.pairing).cancel();
    status(&app, &extension).await
}

/// Revokes a paired extension: its token never works again.
#[tauri::command]
pub async fn extension_revoke(
    app: AppHandle,
    extension: State<'_, Extension>,
    id: String,
) -> Result<Status, String> {
    held(&extension.shared()?.store).revoke(&id)?;
    status(&app, &extension).await
}
