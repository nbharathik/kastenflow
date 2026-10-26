//! Plugins (the drawing editor, LaTeX, the browser): what can be added to
//! KastenFlow, which of it is on, and what each needs downloaded. The catalog
//! mirrors the window's own list of plugins. Whether a plugin is on is the
//! vault's choice (`.kasten/config.yaml`, set by kasten-core) or, for a
//! plugin that belongs to the computer, the app's settings. `require` is what
//! every command that needs a plugin calls first.

pub mod clean;
pub mod commands;
pub mod latex;
pub mod payload;
mod pins;

#[cfg(test)]
mod tests;

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::app_settings::AppSettings;
use crate::open_vault::OpenVault;

pub use commands::Payloads;

/// Where a plugin's on/off choice lives.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    /// In the vault, so it travels with it.
    Vault,
    /// On this computer, whichever vault is open.
    Computer,
}

/// The download a plugin needs, as the window shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PayloadInfo {
    pub label: String,
    pub version: String,
    pub size_bytes: u64,
}

/// What one plugin is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub summary: String,
    pub version: String,
    pub default_on: bool,
    pub scope: Scope,
    pub payload: Option<PayloadInfo>,
}

fn entry(
    id: &str,
    name: &str,
    summary: &str,
    default_on: bool,
    scope: Scope,
    label: Option<&str>,
) -> PluginInfo {
    PluginInfo {
        id: id.to_owned(),
        name: name.to_owned(),
        summary: summary.to_owned(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
        default_on,
        scope,
        payload: label.and_then(|label| {
            let (version, pin) = pins::current(id)?;
            Some(PayloadInfo {
                label: label.to_owned(),
                version: version.to_owned(),
                size_bytes: pin.size,
            })
        }),
    }
}

/// Every plugin this build knows.
pub fn catalog() -> Vec<PluginInfo> {
    vec![
        entry(
            "diagrams",
            "Diagrams",
            "Draw flowcharts and sketches in a diagram file.",
            true,
            Scope::Vault,
            Some("Diagram editor"),
        ),
        entry(
            "latex",
            "LaTeX",
            "Write pages in LaTeX and get a PDF.",
            false,
            Scope::Vault,
            Some("LaTeX engine"),
        ),
        entry(
            "browser",
            "Browser",
            "Open web pages in a tab of their own.",
            false,
            Scope::Computer,
            None,
        ),
    ]
}

/// The plugin called `id`.
pub fn find(id: &str) -> Result<PluginInfo, String> {
    catalog()
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| format!("There is no plugin called “{id}”"))
}

/// Agrees when `on`, else says in a sentence how to turn the plugin on.
pub fn check(info: &PluginInfo, on: bool) -> Result<(), String> {
    if on {
        Ok(())
    } else {
        Err(format!(
            "Turn on the {} plugin in Settings → Plugins",
            info.name
        ))
    }
}

/// Whether plugin `info` is on now: the open vault's choice, else the
/// plugin's default while no vault is open yet; or the computer's own switch.
pub fn is_on(app: &AppHandle, info: &PluginInfo) -> bool {
    match info.scope {
        Scope::Vault => app
            .try_state::<OpenVault>()
            .and_then(|vault| vault.kasten())
            .map_or(info.default_on, |k| k.config().plugin_enabled(&info.id)),
        Scope::Computer => app
            .path()
            .app_config_dir()
            .map(|dir| AppSettings::load(&dir))
            .map(|s| match info.id.as_str() {
                "browser" => s.browser_on(),
                _ => info.default_on,
            })
            .unwrap_or(info.default_on),
    }
}

/// Agrees that plugin `id` may be used now; every plugin command calls this
/// first. The payload install does through `check`; so does the diagram
/// editor's install; the commands the plugins still to come add (LaTeX
/// builds) call this.
pub fn require(app: &AppHandle, id: &str) -> Result<(), String> {
    let info = find(id)?;
    check(&info, is_on(app, &info))
}

/// The folder plugin `id`'s downloaded payload lives in, inside the app's
/// local data folder `local`: `plugins/<id>`, each version in a folder of its
/// own. The diagram editor an earlier version of the app kept in `diagrams/`
/// is moved there the first time.
pub fn payload_root(local: &Path, id: &str) -> PathBuf {
    let root = local.join("plugins").join(id);
    if id == "diagrams" {
        let old = local.join("diagrams");
        payload::adopt_legacy(&old, &root);
        // A move that did not work leaves the old folder in use, so the editor goes on working.
        if !root.exists() && old.is_dir() {
            return old;
        }
    }
    root
}

/// Moves the diagram editor an earlier version kept in `diagrams/` to its
/// place under `plugins/`, once, when the app starts. Only the app's own
/// folder is touched, and a move that fails leaves the old one working.
pub fn migrate_payloads(app: &AppHandle) {
    if let Ok(local) = app.path().app_local_data_dir() {
        let _ = payload_root(&local, "diagrams");
    }
}
