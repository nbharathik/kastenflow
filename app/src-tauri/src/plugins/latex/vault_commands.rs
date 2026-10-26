//! The commands the window edits LaTeX documents with: the list of
//! documents, a document's files, reading and saving a source file, starting
//! a document, choosing its engine, and keeping the built PDF in the vault.
//! They are thin: every write is a kasten-core op done as the person (so the
//! guardrails, the merge on save and the commits are the core's), and each
//! starts by asking `plugins::require("latex")`.

use kasten_core::history::Actor;
use kasten_core::latex::{LatexDoc, MAX_PDF_BYTES, SourceFile, SourceSaved};
use kasten_core::{Instant, Kasten};
use tauri::{AppHandle, State};

use super::build::{built_places, stem_of};
use super::collect::{pdf_path, pdf_stamp};
use super::commands::{NOT_BUILT, document};
use super::files::{DocFile, list_files};
use super::snapshot::read_plain;
use crate::open_vault::OpenVault;
use crate::plugins;

const PERSON: Actor = Actor::Human;

/// Every LaTeX document in the vault.
#[tauri::command(async)]
pub fn latex_docs(app: AppHandle, vault: State<'_, OpenVault>) -> Result<Vec<LatexDoc>, String> {
    plugins::require(&app, "latex")?;
    vault.run(Kasten::latex_docs)
}

/// The files in the folder of the document `folder`.
#[tauri::command(async)]
pub fn latex_files(
    app: AppHandle,
    vault: State<'_, OpenVault>,
    folder: String,
) -> Result<Vec<DocFile>, String> {
    plugins::require(&app, "latex")?;
    let (doc, _, root) = document(&vault, &folder).map_err(|e| e.message)?;
    Ok(list_files(&root, &doc.folder))
}

/// A source file's text and the hash a save is written against.
#[tauri::command(async)]
pub fn latex_source(
    app: AppHandle,
    vault: State<'_, OpenVault>,
    path: String,
) -> Result<SourceFile, String> {
    plugins::require(&app, "latex")?;
    vault.run(|k| k.source(&path))
}

/// Saves a source file as it is typed: merged with changes made elsewhere,
/// or kept in a copy beside it when the same lines changed.
#[tauri::command(async)]
pub fn latex_save_source(
    app: AppHandle,
    vault: State<'_, OpenVault>,
    path: String,
    base_hash: String,
    text: String,
) -> Result<SourceSaved, String> {
    plugins::require(&app, "latex")?;
    vault.run(|k| k.save_source(&PERSON, &path, &base_hash, &text, Instant::now()))
}

/// Starts a document called `title`, in `project` or the library, from a
/// template (`article`, `report`, `beamer`; the article when none is named).
#[tauri::command(async)]
pub fn latex_create(
    app: AppHandle,
    vault: State<'_, OpenVault>,
    title: String,
    project: Option<String>,
    template: Option<String>,
) -> Result<LatexDoc, String> {
    plugins::require(&app, "latex")?;
    let template = super::send::template_named(template.as_deref())?;
    vault.run(|k| {
        k.create_latex_doc_from(
            &PERSON,
            &title,
            template,
            project.as_deref(),
            None,
            Instant::now(),
        )
    })
}

/// Chooses the engine the document builds with (kept in its settings file).
#[tauri::command(async)]
pub fn latex_set_engine(
    app: AppHandle,
    vault: State<'_, OpenVault>,
    folder: String,
    engine: String,
) -> Result<(), String> {
    plugins::require(&app, "latex")?;
    let folder = folder.trim_end_matches('/').to_owned();
    vault.run(|k| {
        let mut config = k.latex_config(&folder)?;
        config.engine = Some(engine);
        k.set_latex_config(&PERSON, &folder, &config, Instant::now())?;
        Ok(())
    })
}

/// Keeps the last built PDF of the document in the vault, beside its root
/// file; answers the PDF's vault path.
#[tauri::command(async)]
pub fn latex_export_pdf(
    app: AppHandle,
    vault: State<'_, OpenVault>,
    folder: String,
) -> Result<String, String> {
    plugins::require(&app, "latex")?;
    let (doc, _, root) = document(&vault, &folder).map_err(|e| e.message)?;
    let (_, out) = built_places(&root, &doc.folder).ok_or(NOT_BUILT)?;
    let pdf = pdf_path(&out, &stem_of(&doc.main));
    if pdf_stamp(&pdf).is_none() {
        return Err("There is no PDF yet: build the document first".to_owned());
    }
    let bytes = match read_plain(&pdf, MAX_PDF_BYTES as u64 + 1) {
        Some(bytes) if bytes.len() <= MAX_PDF_BYTES => bytes,
        Some(_) => return Err("The PDF is too big to keep".to_owned()),
        None => return Err("The PDF could not be read".to_owned()),
    };
    vault
        .require()?
        .export_pdf(&PERSON, &doc.folder, &bytes, Instant::now())
        .map_err(|err| err.to_string())
}
