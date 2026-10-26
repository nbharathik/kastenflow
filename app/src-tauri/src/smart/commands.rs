//! The window's commands for smart pages. Only the window's own code can call
//! them: the frame has no way to a command (see `guard`). Each takes the path
//! of the smart page the call is for, which the window knows from the frame it
//! made, and runs as a person, or as the page's agent for a bridge call.

use std::path::PathBuf;

use kasten_core::Instant;
use kasten_core::history::{Actor, CommitInfo};
use kasten_core::smart::ops::Restored;
use kasten_core::smart::{BridgeCall, BridgeError, BridgeErrorCode, ErrorLog, ErrorReport};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use super::runtime::Runtime;
use super::trust::Trust;
use super::{bridge, errors, page, settings, trust};
use crate::commands::notes::OpenVault;

fn data_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_local_data_dir().ok()
}

fn refused(message: impl Into<String>) -> BridgeError {
    BridgeError {
        code: BridgeErrorCode::Refused,
        message: message.into(),
    }
}

/// What the window needs to show a smart page.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageInfo {
    /// The id the page's address is made with.
    pub id: String,
    pub path: String,
    pub title: String,
    /// Whether the page's folder is there with an `index.html` in it.
    pub ready: bool,
    /// The height the page asks for, and the most it may have, in pixels.
    pub height: Option<u32>,
    pub max_height: Option<u32>,
    /// The page's own words on what is wrong with its folder.
    pub problems: Vec<String>,
    /// Whether the page may show pictures from the web.
    pub web_images: bool,
    /// The named views the manifest offers (`![[Page#name]]`).
    pub views: Vec<NamedView>,
}

/// A view the manifest names, and the file it is drawn from when it is not the main page.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NamedView {
    pub name: String,
    pub title: Option<String>,
    pub entry: Option<String>,
}

/// Whether a view's `entry` may be loaded into a frame: a page file inside the
/// folder, by the same rules as any file the folder holds (no `..`, no hidden
/// part, no absolute or drive path), and an HTML file. A manifest is written by
/// whoever made the page, so what the window builds an address from is checked
/// here and not taken as it stands.
pub(super) fn safe_entry(entry: &str) -> bool {
    kasten_core::smart::check_path(entry).is_ok() && entry.to_ascii_lowercase().ends_with(".html")
}

/// The id of the smart page at `page`, when `frame` is a live frame of that
/// page. A call from a frame that has gone away, or one made for another
/// page, finds the way shut.
pub(super) fn bound(
    kasten: &kasten_core::Kasten,
    runtime: &Runtime,
    page: &str,
    frame: &str,
) -> Result<String, String> {
    let id = page::read(kasten, page)?.meta.id.unwrap_or_default();
    if runtime.frame_is_of(frame, &id) {
        Ok(id)
    } else {
        Err("That page is not showing any more.".to_owned())
    }
}

/// Begins a frame for the smart page at `page`: gives the secret its address
/// and everything it loads carry. Only the window's code can ask; the page's
/// own code, which sees only its own address, cannot learn another frame's.
#[tauri::command(async)]
pub fn smart_frame_open(
    app: AppHandle,
    state: State<'_, OpenVault>,
    runtime: State<'_, Runtime>,
    page: String,
) -> Result<String, String> {
    let kasten = state.require()?;
    let note = page::read(&kasten, &page)?;
    // Smart pages being off, and a page an agent made that a person has not allowed
    // yet, stop here: no secret, so nothing is served and no call is answered.
    trust::may_open(&kasten, &note, data_dir(&app).as_deref(), Instant::now())?;
    runtime.open_frame(&note.meta.id.unwrap_or_default())
}

/// Who made the page and whether it waits for a person's "Allow to run".
#[tauri::command(async)]
pub fn smart_trust(
    app: AppHandle,
    state: State<'_, OpenVault>,
    page: String,
) -> Result<Trust, String> {
    let kasten = state.require()?;
    let note = page::read(&kasten, &page)?;
    Ok(trust::trust(
        &kasten,
        &note,
        data_dir(&app).as_deref(),
        Instant::now(),
    ))
}

/// A person's "Allow to run" for the page. Only the window calls it; no agent
/// tool and no page can.
#[tauri::command(async)]
pub fn smart_allow_run(
    app: AppHandle,
    state: State<'_, OpenVault>,
    page: String,
) -> Result<(), String> {
    let kasten = state.require()?;
    let id = page::read(&kasten, &page)?.meta.id.unwrap_or_default();
    let dir = data_dir(&app).ok_or("KastenFlow has no place to keep this choice.")?;
    settings::set_allowed(&dir, &id)
}

/// Whether smart pages run at all (they do, until a person turns them off).
#[tauri::command(async)]
pub fn smart_run_enabled(app: AppHandle) -> bool {
    settings::run_enabled(data_dir(&app).as_deref())
}

/// Turns smart pages on or off. Off ends every frame at once. Only the window
/// calls it.
#[tauri::command(async)]
pub fn smart_set_run_enabled(
    app: AppHandle,
    runtime: State<'_, Runtime>,
    on: bool,
) -> Result<(), String> {
    let dir = data_dir(&app).ok_or("KastenFlow has no place to keep this choice.")?;
    settings::set_run_enabled(&dir, on)?;
    if !on {
        runtime.close_all();
    }
    Ok(())
}

/// The commits that changed the page's code folder, newest first.
#[tauri::command(async)]
pub fn smart_history(
    state: State<'_, OpenVault>,
    page: String,
    limit: Option<usize>,
) -> Result<Vec<CommitInfo>, String> {
    let kasten = state.require()?;
    page::read(&kasten, &page)?;
    let dir = kasten_core::smart::sidecar_dir(&page).ok_or("That page could not be found.")?;
    kasten
        .log(Some(&dir), limit.unwrap_or(50).min(200))
        .map_err(|e| e.to_string())
}

/// Puts the page's code folder back as it was at the commit `rev`, as a new
/// commit that Undo takes back. A person's action; the window alone calls it.
#[tauri::command(async)]
pub fn smart_restore_version(
    state: State<'_, OpenVault>,
    page: String,
    rev: String,
) -> Result<Restored, String> {
    let kasten = state.require()?;
    page::read(&kasten, &page)?;
    kasten
        .smart_restore_version(&Actor::Human, &page, &rev, Instant::now())
        .map_err(|e| e.to_string())
}

/// Ends a frame: its address stops serving and its calls are refused.
#[tauri::command(async)]
pub fn smart_frame_close(runtime: State<'_, Runtime>, frame: String) {
    runtime.close_frame(&frame);
}

/// One call from a smart page's frame, made for the page at `page` by the
/// frame with the secret `frame`.
#[tauri::command(async)]
pub fn smart_call(
    state: State<'_, OpenVault>,
    runtime: State<'_, Runtime>,
    page: String,
    frame: String,
    call: Value,
) -> Result<Value, BridgeError> {
    let call: BridgeCall = serde_json::from_value(call).map_err(|err| BridgeError {
        code: BridgeErrorCode::BadRequest,
        message: format!("That message is not one the bridge knows: {err}"),
    })?;
    let kasten = state.require().map_err(refused)?;
    bound(&kasten, &runtime, &page, &frame).map_err(refused)?;
    bridge::handle(&kasten, &runtime, &page, &call, Instant::now())
}

/// What is needed to show the smart page at `path`.
#[tauri::command(async)]
pub fn smart_page_info(
    app: AppHandle,
    state: State<'_, OpenVault>,
    path: String,
) -> Result<PageInfo, String> {
    let kasten = state.require()?;
    let note = page::read(&kasten, &path)?;
    let id = note.meta.id.clone().unwrap_or_default();
    let listing = kasten.smart_read(&path).map_err(|e| e.to_string())?;
    let size = listing.manifest.as_ref().and_then(|m| m.size.clone());
    let views = listing
        .manifest
        .as_ref()
        .map(|m| {
            m.views
                .iter()
                .map(|(name, view)| NamedView {
                    name: name.clone(),
                    title: view.title.clone(),
                    entry: view.entry.clone().filter(|entry| safe_entry(entry)),
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(PageInfo {
        views,
        web_images: web_images_of(&app, &kasten, &path, &id),
        ready: listing.exists && listing.files.iter().any(|f| f.path == "index.html"),
        height: size.as_ref().and_then(|s| s.height),
        max_height: size.as_ref().and_then(|s| s.max_height),
        problems: listing.problems,
        title: note.meta.title,
        path,
        id,
    })
}

/// Keeps an error the kit caught in the page, in the log of the page the
/// frame is for and no other; gives the log as it is now.
#[tauri::command(async)]
pub fn smart_report(
    state: State<'_, OpenVault>,
    runtime: State<'_, Runtime>,
    page: String,
    frame: String,
    report: ErrorReport,
) -> Result<ErrorLog, String> {
    let kasten = state.require()?;
    let id = bound(&kasten, &runtime, &page, &frame)?;
    errors::append(kasten.root(), &id, &report, Instant::now())
}

/// The errors kept for the page, the newest last.
#[tauri::command(async)]
pub fn smart_errors(state: State<'_, OpenVault>, page: String) -> Result<ErrorLog, String> {
    let kasten = state.require()?;
    let id = page::read(&kasten, &page)?.meta.id.unwrap_or_default();
    Ok(errors::read(kasten.root(), &id))
}

/// Forgets the errors kept for the page.
#[tauri::command(async)]
pub fn smart_clear_errors(state: State<'_, OpenVault>, page: String) -> Result<(), String> {
    let kasten = state.require()?;
    let id = page::read(&kasten, &page)?.meta.id.unwrap_or_default();
    errors::clear(kasten.root(), &id)
}

/// Whether the page may show pictures from the web.
#[tauri::command(async)]
pub fn smart_web_images(
    app: AppHandle,
    state: State<'_, OpenVault>,
    page: String,
) -> Result<bool, String> {
    let kasten = state.require()?;
    let id = page::read(&kasten, &page)?.meta.id.unwrap_or_default();
    Ok(web_images_of(&app, &kasten, &page, &id))
}

/// Whether the page's leave for pictures from the web stands: given, and for
/// the files the page has now.
fn web_images_of(app: &AppHandle, kasten: &kasten_core::Kasten, page: &str, id: &str) -> bool {
    settings::web_images(data_dir(app).as_deref(), id, &|| {
        page::fingerprint(kasten, page)
    })
}

/// A person's choice: the page may, or may not, show pictures from the web.
/// Only the window calls it; no agent tool and no page can.
#[tauri::command(async)]
pub fn smart_set_web_images(
    app: AppHandle,
    state: State<'_, OpenVault>,
    page: String,
    allow: bool,
) -> Result<(), String> {
    let kasten = state.require()?;
    let id = page::read(&kasten, &page)?.meta.id.unwrap_or_default();
    let dir = data_dir(&app).ok_or("KastenFlow has no place to keep this choice.")?;
    settings::set_web_images(&dir, &id, allow, &page::fingerprint(&kasten, &page))
}
