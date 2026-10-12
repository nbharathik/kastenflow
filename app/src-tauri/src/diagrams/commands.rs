//! The commands the window uses to see whether the diagram editor is
//! installed, install it (with progress told as events), cancel, and remove
//! it. Nothing here reaches the vault.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use super::clean::forget_folder;
use super::extract::{Failure, LIMITS};
use super::install::{Progress, VERSION_FILE, client, install, release_host};
use super::pinned::Source;

/// The event that tells the window how far an install is.
pub const PROGRESS_EVENT: &str = "diagram-editor-progress";

/// The install that is running, if any, so a second one cannot start and
/// the first can be cancelled.
#[derive(Default)]
pub struct Editor {
    running: Mutex<Option<Arc<AtomicBool>>>,
}

impl Editor {
    fn begin(&self) -> Result<Arc<AtomicBool>, String> {
        let mut running = self.running.lock().unwrap_or_else(|e| e.into_inner());
        if running.is_some() {
            return Err("The diagram editor is already being installed".to_owned());
        }
        let cancel = Arc::new(AtomicBool::new(false));
        *running = Some(Arc::clone(&cancel));
        Ok(cancel)
    }

    fn end(&self) {
        *self.running.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }

    fn busy(&self) -> bool {
        self.running
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_some()
    }
}

/// The folder the editor lives in, in the app's local data.
pub fn editor_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|dir| dir.join("diagrams"))
        .map_err(|err| format!("KastenFlow has no folder for the diagram editor: {err}"))
}

/// The installed editor's folder, when the pinned release is installed whole.
pub fn installed_dir(app: &AppHandle) -> Option<PathBuf> {
    let dir = editor_root(app).ok()?.join(super::pinned::VERSION);
    let marked = std::fs::read_to_string(dir.join(VERSION_FILE)).ok()?;
    (marked.trim() == super::pinned::VERSION && dir.join("index.html").is_file()).then_some(dir)
}

/// What the window shows about the editor.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// The release Kasten installs.
    pub version: &'static str,
    /// The size of its download, in bytes.
    pub bytes: u64,
    /// Where it is downloaded from.
    pub url: &'static str,
    pub installed: bool,
    pub busy: bool,
}

#[tauri::command]
pub fn diagram_editor_status(app: AppHandle, editor: State<'_, Editor>) -> Status {
    Status {
        version: super::pinned::VERSION,
        bytes: super::pinned::SIZE,
        url: super::pinned::URL,
        installed: installed_dir(&app).is_some(),
        busy: editor.busy(),
    }
}

/// Downloads and installs the editor, telling progress as events; answers
/// `installed` or `cancelled` when it is over, or why it failed.
#[tauri::command]
pub async fn diagram_editor_install(
    app: AppHandle,
    editor: State<'_, Editor>,
) -> Result<&'static str, String> {
    let cancel = editor.begin()?;
    let result = async {
        let root = editor_root(&app).map_err(Failure::Failed)?;
        let client = client(release_host).map_err(Failure::Failed)?;
        let told = app.clone();
        let report = Arc::new(move |progress: Progress| {
            let _ = told.emit(PROGRESS_EVENT, progress);
        });
        install(&client, &Source::pinned(), &root, LIMITS, cancel, report).await
    }
    .await;
    editor.end();
    match result {
        Ok(()) => Ok("installed"),
        Err(Failure::Cancelled) => Ok("cancelled"),
        Err(failure) => Err(failure.message()),
    }
}

/// Stops the install that is running.
#[tauri::command]
pub fn diagram_editor_cancel(editor: State<'_, Editor>) {
    if let Some(cancel) = editor
        .running
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
    {
        cancel.store(true, Ordering::Relaxed);
    }
}

/// Takes the installed editor away. Diagrams are not touched: they are files
/// in the vault, and are shown by their pictures without it.
#[tauri::command]
pub fn diagram_editor_remove(app: AppHandle, editor: State<'_, Editor>) -> Result<(), String> {
    if editor.busy() {
        return Err("The diagram editor is being installed; cancel that first".to_owned());
    }
    forget_folder(&editor_root(&app)?);
    Ok(())
}
