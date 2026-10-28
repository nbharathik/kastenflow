//! The commands the window builds LaTeX documents with. Each starts by
//! asking `plugins::require("latex")`, so a plugin that is off answers with
//! how to turn it on. A build is asked for (`latex_build`) and answers at
//! once with its number; how it goes is told as `latex-build` events. The
//! PDF is read by a command that returns its bytes. Nothing here writes the
//! vault: builds live in the vault's cache folder, and Export PDF is a
//! kasten-core op the window calls itself.

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::time::{Duration, Instant};

use kasten_core::latex::{LatexConfig, LatexDoc, MAX_PDF_BYTES};
use serde::{Deserialize, Serialize};
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Manager, State};

use super::build::{Job, built_places, execute, stem_of};
use super::collect::{pdf_path, pdf_stamp};
use super::ended::EndedLog;
use super::engines::{
    Engine, Found, Next, NoEngine, Origin, Resolved, choose, find_program, payload_program,
};
use super::paths::{clean_rel, plain_folders_below, really_inside};
use super::service::{BuildError, EVENT, Event, Host, Outcome, Service};
use super::snapshot::{Buffer, check_buffers, read_plain};
use super::sync::{self, Spot};
use super::synctex::Hit;
use crate::open_vault::OpenVault;
use crate::plugins::{self, payload_root, pins};

/// How long a build may run unless the request says otherwise, and the
/// range a request may ask for.
const DEFAULT_TIMEOUT_SECS: u64 = 120;
const MIN_TIMEOUT_SECS: u64 = 10;
const MAX_TIMEOUT_SECS: u64 = 900;
/// Said when the build folder is not as a build leaves it.
pub(super) const NOT_BUILT: &str = "There is nothing built for this document yet: build it first";

/// Runs real builds and tells the window about them.
pub struct AppHost {
    app: AppHandle,
    epoch: Instant,
    /// How builds ended, for whoever waits for one (the MCP bridge).
    ended: Arc<EndedLog>,
}

impl Host for AppHost {
    type Job = Job;

    fn run(&self, job: &Job, cancel: &AtomicBool, note: &dyn Fn(&str)) -> Outcome {
        execute(job, cancel, note, &|spec| spec)
    }

    fn emit(&self, event: &Event) {
        self.ended.record(event);
        let _ = self.app.emit(EVENT, event);
    }

    fn now_ms(&self) -> u64 {
        self.epoch.elapsed().as_millis() as u64
    }
}

/// The build service, kept in the app's state.
pub struct Latex {
    service: Arc<Service<AppHost>>,
    ended: Arc<EndedLog>,
}

fn state(app: &AppHandle) -> tauri::State<'_, Latex> {
    if app.try_state::<Latex>().is_none() {
        // Two first calls at once: only one is kept, the other finds it.
        let ended = Arc::new(EndedLog::default());
        let _ = app.manage(Latex {
            service: Service::new(AppHost {
                app: app.clone(),
                epoch: Instant::now(),
                ended: Arc::clone(&ended),
            }),
            ended,
        });
    }
    app.state::<Latex>()
}

pub(crate) fn latex(app: &AppHandle) -> Arc<Service<AppHost>> {
    Arc::clone(&state(app).service)
}

/// How builds ended: wait for the end of one with `EndedLog::wait`.
pub(crate) fn ended(app: &AppHandle) -> Arc<EndedLog> {
    Arc::clone(&state(app).ended)
}

fn require(app: &AppHandle) -> Result<(), BuildError> {
    plugins::require(app, "latex").map_err(|why| BuildError::new("plugin-off", why))
}

/// What the window asks a build with.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildRequest {
    /// The document's folder.
    pub folder: String,
    /// Text not saved yet: the build uses it instead of the file's.
    #[serde(default)]
    pub buffers: Vec<Buffer>,
    /// How long the build may run, in seconds.
    #[serde(default)]
    pub timeout_secs: Option<u64>,
}

/// The engines found on this computer.
fn detect(app: &AppHandle) -> Found {
    let payload = app
        .path()
        .app_local_data_dir()
        .ok()
        .zip(pins::current("latex"))
        .and_then(|(local, (version, _))| payload_program(&payload_root(&local, "latex"), version));
    let latexmk = std::env::var_os("PATH").and_then(|path| find_program("latexmk", &path));
    Found { payload, latexmk }
}

/// The typed answer for a document that has no engine to build with.
pub(super) fn no_engine(missing: NoEngine) -> BuildError {
    BuildError {
        kind: "no-engine",
        message: missing.message,
        next: Some(match missing.next {
            Next::InstallTectonic => "install-tectonic",
            Next::InstallTex => "install-tex",
        }),
    }
}

/// The document whose folder is `folder`, with its settings and the vault's
/// folder on disk.
pub(super) fn document(
    vault: &OpenVault,
    folder: &str,
) -> Result<(LatexDoc, LatexConfig, PathBuf), BuildError> {
    let kasten = vault
        .require()
        .map_err(|why| BuildError::new("no-document", why))?;
    let folder = folder.trim_end_matches('/');
    let doc = kasten
        .latex_docs()
        .map_err(|err| BuildError::new("no-document", err.to_string()))?
        .into_iter()
        .find(|d| d.folder == folder)
        .ok_or_else(|| BuildError::new("no-document", "That folder is not a LaTeX document"))?;
    // A settings file that cannot be read builds with the defaults (it stays locked for agents).
    let config = kasten.latex_config(&doc.folder).unwrap_or_default();
    let root = kasten.root().to_path_buf();
    // The folder is what the vault says it is: no link on the way leaves the vault.
    if !plain_folders_below(&root, &doc.folder) || !really_inside(&root, &root.join(&doc.folder)) {
        return Err(BuildError::new(
            "bad-request",
            "The document's folder is not a plain folder inside the vault",
        ));
    }
    Ok((doc, config, root))
}

/// Asks for a build of the document in `request.folder`; answers its number.
#[tauri::command(async)]
pub fn latex_build(
    app: AppHandle,
    vault: State<'_, OpenVault>,
    request: BuildRequest,
) -> Result<u64, BuildError> {
    require(&app)?;
    let (folder, job) = prepare(&app, &vault, request)?;
    Ok(latex(&app).submit(&folder, job))
}

/// The build a request asks for, checked and ready to submit: the document's
/// folder and the job. Everything the engine will touch is decided here.
pub(crate) fn prepare(
    app: &AppHandle,
    vault: &OpenVault,
    request: BuildRequest,
) -> Result<(String, Job), BuildError> {
    let (doc, config, root) = document(vault, &request.folder)?;
    let main = clean_rel(&doc.main).ok_or_else(|| {
        BuildError::new(
            "bad-request",
            "The document's main file has an unusable name",
        )
    })?;
    check_buffers(&doc.folder, &request.buffers)
        .map_err(|why| BuildError::new("bad-request", why.to_string()))?;
    let resolved: Resolved = choose(config.engine.as_deref(), &detect(app)).map_err(no_engine)?;
    let package_cache = app
        .path()
        .app_local_data_dir()
        .map(|local| payload_root(&local, "latex").join("cache"))
        .map_err(|err| {
            BuildError::new(
                "internal",
                format!("KastenFlow has no folder for it: {err}"),
            )
        })?;
    let secs = request
        .timeout_secs
        .unwrap_or(DEFAULT_TIMEOUT_SECS)
        .clamp(MIN_TIMEOUT_SECS, MAX_TIMEOUT_SECS);
    let job = Job {
        folder: doc.folder.clone(),
        root,
        main,
        engine: resolved,
        package_cache,
        buffers: request.buffers,
        vault_bib: doc.bibliography == "vault",
        timeout: Duration::from_secs(secs),
    };
    Ok((doc.folder, job))
}

/// Stops the build of the document in `folder`, and the one waiting.
#[tauri::command(async)]
pub fn latex_cancel(app: AppHandle, folder: String) -> Result<(), String> {
    plugins::require(&app, "latex")?;
    latex(&app).cancel(folder.trim_end_matches('/'));
    Ok(())
}

/// The PDF the last build of the document in `folder` made, as bytes.
#[tauri::command(async)]
pub fn latex_read_pdf(
    app: AppHandle,
    vault: State<'_, OpenVault>,
    folder: String,
) -> Result<Response, String> {
    plugins::require(&app, "latex")?;
    let (doc, _, root) = document(&vault, &folder).map_err(|e| e.message)?;
    let (_, out) = built_places(&root, &doc.folder).ok_or(NOT_BUILT)?;
    let pdf = pdf_path(&out, &stem_of(&doc.main));
    if pdf_stamp(&pdf).is_none() {
        return Err("There is no PDF yet: build the document first".to_owned());
    }
    match read_plain(&pdf, MAX_PDF_BYTES as u64 + 1) {
        Some(bytes) if bytes.len() <= MAX_PDF_BYTES => Ok(Response::new(bytes)),
        Some(_) => Err("The PDF is too big to show".to_owned()),
        None => Err("The PDF could not be read".to_owned()),
    }
}

/// One engine, and whether it can be used now.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineView {
    pub id: &'static str,
    pub label: &'static str,
    pub available: bool,
    pub origin: Option<Origin>,
}

/// The engines, which one a document would build with, and if none can.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnginesView {
    pub engines: Vec<EngineView>,
    pub chosen: Option<&'static str>,
    pub error: Option<BuildError>,
}

/// The engines on this computer. With `folder`, the answer is for that
/// document (its settings may name an engine).
#[tauri::command(async)]
pub fn latex_engines(
    app: AppHandle,
    vault: State<'_, OpenVault>,
    folder: Option<String>,
) -> Result<EnginesView, String> {
    plugins::require(&app, "latex")?;
    let found = detect(&app);
    let named = match folder {
        Some(folder) => document(&vault, &folder).map_err(|e| e.message)?.1.engine,
        None => None,
    };
    let (chosen, error) = match choose(named.as_deref(), &found) {
        Ok(resolved) => (Some(resolved.engine.id()), None),
        Err(missing) => (None, Some(no_engine(missing))),
    };
    let view = |engine: Engine, label: &'static str| {
        let (available, origin) = if engine.is_latexmk() {
            (
                found.latexmk.is_some(),
                found.latexmk.as_ref().map(|_| Origin::Path),
            )
        } else {
            (
                found.payload.is_some(),
                found.payload.as_ref().map(|_| Origin::Payload),
            )
        };
        EngineView {
            id: engine.id(),
            label,
            available,
            origin,
        }
    };
    Ok(EnginesView {
        engines: vec![
            view(Engine::Tectonic, "Tectonic"),
            view(Engine::LatexmkPdf, "My TeX installation (pdfLaTeX)"),
            view(Engine::LatexmkXe, "My TeX installation (XeLaTeX)"),
            view(Engine::LatexmkLua, "My TeX installation (LuaLaTeX)"),
        ],
        chosen,
        error,
    })
}

/// Where line `line` of `file` is in the last PDF of the document in `folder`.
#[tauri::command(async)]
pub fn latex_sync_forward(
    app: AppHandle,
    vault: State<'_, OpenVault>,
    folder: String,
    file: String,
    line: u32,
) -> Result<Vec<Hit>, String> {
    plugins::require(&app, "latex")?;
    let (doc, _, root) = document(&vault, &folder).map_err(|e| e.message)?;
    let (_, out) = built_places(&root, &doc.folder).ok_or(NOT_BUILT)?;
    // The window names files by vault path; the SyncTeX file by path from the folder.
    let prefix = format!("{}/", doc.folder);
    let rel = file.strip_prefix(&prefix).unwrap_or(&file);
    sync::forward(&out, &stem_of(&doc.main), rel, line)
}

/// The line of source behind the point (`x`, `y`) of `page` in the last PDF.
#[tauri::command(async)]
pub fn latex_sync_inverse(
    app: AppHandle,
    vault: State<'_, OpenVault>,
    folder: String,
    page: u32,
    x: f64,
    y: f64,
) -> Result<Spot, String> {
    plugins::require(&app, "latex")?;
    let (doc, _, root) = document(&vault, &folder).map_err(|e| e.message)?;
    let (tree, out) = built_places(&root, &doc.folder).ok_or(NOT_BUILT)?;
    sync::inverse(
        &root.join(&doc.folder),
        &tree,
        &out,
        &stem_of(&doc.main),
        page,
        x,
        y,
    )
}
