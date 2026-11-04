//! The frame code pictures run in. It is a smart page's kind of frame (a sandbox with scripts and
//! nothing else, on the `smart` scheme, with the policy that allows no network and a secret of 256
//! random bits in every address) but it is not a page of the vault: the window asks for a frame
//! (`generator_frame_open`), loads the runner from it, hands it the code in one message, hears one
//! message back, and ends it (`smart_frame_close`). The runner and the drawing kit are compiled into
//! the app and served only to a live generator frame; the code itself is never a file anywhere and
//! never gets a way to the vault, the network or a command.
//!
//! Whether agent-written code may run is the person's, kept here by deck and code hash (see `settings`); the
//! commands are the window's alone, like every command (a frame can call none).

use std::path::PathBuf;

use kasten_core::Instant;
use kasten_core::deck::{GeneratorFile, GeneratorInfo, GeneratorSaved};
use kasten_core::history::Actor;
use tauri::{AppHandle, Manager, State};

use super::runtime::Runtime;
use super::settings;
use crate::commands::notes::OpenVault;

/// The id a generator frame is known by in the runtime, and the folder its files are served from.
/// A smart page's id is a ULID, so the two can never be taken for each other.
pub const ID: &str = "generator";

const RUNNER_HTML: &str = include_str!("../../../src/generator-kit/runner.html");
const RUNNER_JS: &str = include_str!("../../../src/generator-kit/runner.js");
const KIT_JS: &str = include_str!("../../../src/generator-kit/kit.js");

/// The file a request names, when `rest` (the parts of the address after the frame's secret) is
/// `generator/<file>` and the file is one of the three the runner is made of.
pub fn file(rest: &[String]) -> Option<(String, Vec<u8>)> {
    let [folder, name] = rest else {
        return None;
    };
    if folder != ID {
        return None;
    }
    let text = match name.as_str() {
        "runner.html" => RUNNER_HTML,
        "runner.js" => RUNNER_JS,
        "kit.js" => KIT_JS,
        _ => return None,
    };
    Some((name.clone(), text.as_bytes().to_vec()))
}

fn data_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_local_data_dir().ok()
}

/// Begins a frame for running a code picture: the secret its address, and every address it loads
/// from, carry. Only the window can ask. Ended with `smart_frame_close`.
#[tauri::command(async)]
pub fn generator_frame_open(runtime: State<'_, Runtime>) -> Result<String, String> {
    runtime.open_frame(ID)
}

/// Whether a person allowed this code (its `hash`, as the question showed it) to run in the deck at `deck`.
#[tauri::command(async)]
pub fn generator_allowed(app: AppHandle, deck: String, hash: String) -> bool {
    settings::generator_allowed(data_dir(&app).as_deref(), &deck, &hash)
}

/// A person's "Allow to run" for this code (its `hash`) in the deck at `deck`, for good: other code in
/// the deck asks again. Only the window calls it; no agent tool and no frame can.
#[tauri::command(async)]
pub fn generator_allow(app: AppHandle, deck: String, hash: String) -> Result<(), String> {
    let dir = data_dir(&app).ok_or("KastenFlow has no place to keep this choice.")?;
    settings::set_generator_allowed(&dir, &deck, &hash)
}

/// A text file of the vault's `assets/` (a CSV) for a program to read as an input. Read-only.
#[tauri::command(async)]
pub fn generator_text_asset(state: State<'_, OpenVault>, path: String) -> Result<String, String> {
    state
        .require()?
        .read_text_asset(&path)
        .map_err(|e| e.to_string())
}

/// The code pictures kept for every deck.
#[tauri::command(async)]
pub fn generator_library(state: State<'_, OpenVault>) -> Result<Vec<GeneratorInfo>, String> {
    state
        .require()?
        .generator_library()
        .map_err(|e| e.to_string())
}

/// One kept code picture, as the editor wrote it.
#[tauri::command(async)]
pub fn generator_library_read(
    state: State<'_, OpenVault>,
    path: String,
) -> Result<GeneratorFile, String> {
    state
        .require()?
        .library_generator(&path)
        .map_err(|e| e.to_string())
}

/// Keeps a code picture for every deck (a person's "Save to library"): one commit that Undo takes back.
#[tauri::command(async)]
pub fn generator_library_save(
    state: State<'_, OpenVault>,
    text: String,
) -> Result<GeneratorSaved, String> {
    state
        .require()?
        .save_library_generator(&Actor::Human, &text, Instant::now())
        .map_err(|e| e.to_string())
}
