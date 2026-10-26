//! Writing LaTeX documents: a source file saved as it is typed (merged with
//! other changes, or kept in a copy), a new document, a document's settings,
//! and the exported PDF. A person's saves are committed after a pause, like
//! typing in a page; an agent's go through `agent_run` (engine/latex_agent.rs).

use std::fs;

use super::{Change, Kasten};
use crate::atomic::{create_atomic, write_atomic};
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::latex::{
    self, CONFIG_FILE, LatexConfig, LatexDoc, MAX_SOURCE_BYTES, Plan, SOURCE_EXTENSIONS,
    SourceFile, SourceSaved, Template,
};
use crate::slug::slugify;
use crate::time::Instant;
use crate::vault::Vault;

fn name_of(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// Refuses a file already on disk that is over the size limit: it is not
/// read whole into memory, merged, or written over.
pub(super) fn check_stored_size(file: &std::path::Path) -> Result<()> {
    match fs::metadata(file) {
        Ok(meta) if meta.len() > MAX_SOURCE_BYTES as u64 => Err(too_big(meta.len() as usize)),
        _ => Ok(()),
    }
}

fn too_big(len: usize) -> Error {
    Error::Invalid(format!(
        "A source file may be at most {} KB; this one is {} KB",
        MAX_SOURCE_BYTES / 1024,
        len.div_ceil(1024)
    ))
}

impl Kasten {
    /// A source file of a LaTeX document, remembered so a later save can merge.
    pub fn source(&self, path: &str) -> Result<SourceFile> {
        let file = self.vault.file_of(path, &SOURCE_EXTENSIONS)?;
        visible(path)?;
        if self.latex_doc_of(path)?.is_none() {
            return Err(not_in_a_document(path));
        }
        check_stored_size(&file)?;
        let text = fs::read_to_string(&file).map_err(|err| match err.kind() {
            std::io::ErrorKind::NotFound => Error::NotFound(path.to_owned()),
            std::io::ErrorKind::InvalidData => not_text(path),
            _ => Error::Io(err),
        })?;
        let file = SourceFile::new(path, text);
        self.remember(&file.hash, &file.text);
        Ok(file)
    }

    /// Saves `text` as the source file at `path`, written against the file
    /// that had `base_hash` (empty for a new file). If the file changed
    /// since, edits on other lines are merged; edits on the same lines keep
    /// the editor's text in a copy beside it. A person's saves are committed
    /// after a quiet spell. Agents save through `agent_run`.
    pub fn save_source(
        &self,
        actor: &Actor,
        path: &str,
        base_hash: &str,
        text: &str,
        now: Instant,
    ) -> Result<SourceSaved> {
        if actor.is_agent() {
            return Err(Error::Invalid(
                "Agents save LaTeX sources through the guarded write (agent_run)".to_owned(),
            ));
        }
        self.write_source(actor, path, base_hash, text, now)
    }

    /// `save_source` for any actor, once the guardrails have said yes.
    pub(super) fn write_source(
        &self,
        actor: &Actor,
        path: &str,
        base_hash: &str,
        text: &str,
        now: Instant,
    ) -> Result<SourceSaved> {
        if text.len() > MAX_SOURCE_BYTES {
            return Err(too_big(text.len()));
        }
        let full = self.vault.file_of(path, &SOURCE_EXTENSIONS)?;
        visible(path)?;
        // Every folder above the file is looked at, not only its document's.
        if actor.is_agent()
            && let Some(name) = self.latex_locked_above(path)
        {
            return Err(locked_for_agents(&name));
        }
        // On a disk that ignores case another spelling names the same file, but History would
        // then know it under the new spelling.
        self.check_spelling(path)?;
        let doc = self.latex_doc_of(path)?;
        match &doc {
            Some(_) => {}
            // The first file of a document is a root: it names its class.
            None if path.ends_with(".tex")
                && !full.exists()
                && latex::facts_of(text).documentclass
                && path.contains('/') => {}
            None => return Err(not_in_a_document(path)),
        }
        let base = self.base(base_hash);
        let saved = self.apply(actor, "save_source", true, now.millis, |vault| {
            let saved = write_checked(vault, path, base_hash, base.as_deref(), text, now)?;
            let mut paths = vec![path.to_owned()];
            if let SourceSaved::Conflict { copy, .. } = &saved {
                paths.push(copy.clone());
            }
            Ok(Change {
                message: format!("edit: {}", name_of(path)),
                paths,
                value: saved,
            })
        })?;
        self.remember(&saved.file().hash, &saved.file().text);
        Ok(saved)
    }

    /// Where a new document called `title` would go: its root file in a
    /// folder of its own in `project` (or the library), a name nobody uses.
    pub fn new_latex_path(&self, title: &str, project: Option<&str>) -> Result<String> {
        let slug = match slugify(title) {
            s if s.is_empty() => "document".to_owned(),
            s => s,
        };
        let parent = match project {
            Some(p) => {
                if p.is_empty() || p.contains(['/', '\\', ':']) || p.starts_with('.') {
                    return Err(Error::Invalid(format!("No project called “{p}”")));
                }
                if !self.vault.exists(&format!("projects/{p}/_project.md")) {
                    return Err(Error::Invalid(format!("No project called “{p}”")));
                }
                format!("projects/{p}/latex")
            }
            None => "library/latex".to_owned(),
        };
        let mut folder = format!("{parent}/{slug}");
        let mut n = 2;
        while self.vault.root().join(&folder).exists() {
            folder = format!("{parent}/{slug}-{n}");
            n += 1;
        }
        Ok(format!("{folder}/main.tex"))
    }

    /// Makes a document titled `title` in `project` or the library, with a
    /// short article to start from; a person's op (`create_latex_doc_from`
    /// takes the template).
    pub fn create_latex_doc(
        &self,
        actor: &Actor,
        title: &str,
        project: Option<&str>,
        now: Instant,
    ) -> Result<LatexDoc> {
        self.create_latex_doc_from(actor, title, Template::Article, project, None, now)
    }

    /// Saves the settings of the document in `folder`; a person's op.
    pub fn set_latex_config(
        &self,
        actor: &Actor,
        folder: &str,
        config: &LatexConfig,
        now: Instant,
    ) -> Result<LatexConfig> {
        if actor.is_agent() {
            return Err(Error::Invalid(
                "Only a person changes a document's settings".to_owned(),
            ));
        }
        config.check()?;
        let doc = self
            .latex_docs()?
            .into_iter()
            .find(|d| d.folder == folder)
            .ok_or_else(|| Error::Invalid(format!("{folder} is not a LaTeX document folder")))?;
        if let Some(main) = &config.main
            && !self.vault.root().join(format!("{folder}/{main}")).is_file()
        {
            return Err(Error::Invalid(format!(
                "There is no file {main} in {folder}"
            )));
        }
        let path = format!("{folder}/{CONFIG_FILE}");
        let file = self.vault.file_of(&path, &[".yaml"])?;
        if let Ok(existing) = fs::read_to_string(&file) {
            // A file that cannot be read is not written over; one that already says it is left.
            if LatexConfig::try_parse(&existing)? == *config {
                return Ok(config.clone());
            }
        }
        self.apply(actor, "latex_config", false, now.millis, |_| {
            // Read again under the lock, and change only the lines that differ.
            let text = match fs::read_to_string(&file) {
                Ok(existing) => config.to_yaml_over(&existing)?,
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => config.to_yaml()?,
                Err(err) => return Err(err.into()),
            };
            write_atomic(&file, text.as_bytes())?;
            Ok(Change {
                message: format!("latex: settings for {}", doc.title),
                paths: vec![path.clone()],
                value: config.clone(),
            })
        })
    }

    /// Keeps the built PDF `bytes` of the document in `folder` beside its root
    /// file, replacing an earlier export, as one commit; returns the PDF's
    /// path. Only a person exports, and only into a LaTeX folder.
    pub fn export_pdf(
        &self,
        actor: &Actor,
        folder: &str,
        bytes: &[u8],
        now: Instant,
    ) -> Result<String> {
        if actor.is_agent() {
            return Err(Error::Invalid("Only a person exports a PDF".to_owned()));
        }
        latex::check_pdf(bytes)?;
        let doc = self
            .latex_docs()?
            .into_iter()
            .find(|d| d.folder == folder.trim_end_matches('/'))
            .ok_or_else(|| {
                Error::Invalid(format!(
                    "{folder} is not a LaTeX document folder, so nothing was exported there"
                ))
            })?;
        let pdf = latex::pdf_path(&doc);
        let file = self.vault.file_of(&pdf, &[".pdf"])?;
        self.apply(actor, "export_pdf", false, now.millis, |_| {
            // Only an earlier export is replaced: another kind of file with this name stays.
            match fs::File::open(&file) {
                Ok(mut existing) => {
                    let mut head = [0u8; 5];
                    let read = std::io::Read::read(&mut existing, &mut head)?;
                    if head[..read] != *b"%PDF-" {
                        return Err(Error::Invalid(format!(
                            "{pdf} is already a file that is not a PDF, so the export was not saved over it"
                        )));
                    }
                }
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                Err(err) => return Err(err.into()),
            }
            write_atomic(&file, bytes)?;
            Ok(Change {
                message: format!("export: {} PDF", doc.title),
                paths: vec![pdf.clone()],
                value: pdf.clone(),
            })
        })
    }
}

pub(super) fn not_in_a_document(path: &str) -> Error {
    Error::Invalid(format!(
        "{path} is not in a LaTeX document folder (a folder with a .tex file that starts with \\documentclass)"
    ))
}

pub(super) fn locked_for_agents(name: &str) -> Error {
    Error::Invalid(format!(
        "“{name}” is locked: read-only for agents. Ask the owner to unlock it in the document's settings"
    ))
}

/// Refuses a path with a hidden folder or file in it: builds and tools keep
/// their files there, and the listing never shows them.
pub(super) fn visible(path: &str) -> Result<()> {
    if path.split('/').any(|part| part.starts_with('.')) {
        return Err(Error::InvalidPath(path.to_owned()));
    }
    Ok(())
}

fn not_text(path: &str) -> Error {
    Error::Invalid(format!(
        "{path} is not UTF-8 text, so it cannot be edited here"
    ))
}

/// The write under the lock: what `plan` says, done.
fn write_checked(
    vault: &Vault,
    path: &str,
    base_hash: &str,
    base: Option<&str>,
    text: &str,
    now: Instant,
) -> Result<SourceSaved> {
    let full = vault.file_of(path, &SOURCE_EXTENSIONS)?;
    check_stored_size(&full)?;
    let current = match fs::read_to_string(&full) {
        Ok(current) => current,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            // A new file: only when the editor said so.
            if !base_hash.is_empty() {
                return Err(Error::NotFound(path.to_owned()));
            }
            if let Some(dir) = full.parent() {
                fs::create_dir_all(dir)?;
            }
            create_atomic(&full, text.as_bytes())?;
            return Ok(SourceSaved::Written {
                file: SourceFile::new(path, text.to_owned()),
            });
        }
        Err(err) if err.kind() == std::io::ErrorKind::InvalidData => return Err(not_text(path)),
        Err(err) => return Err(err.into()),
    };
    Ok(match latex::plan(&current, base_hash, base, text) {
        Plan::Unchanged => SourceSaved::Unchanged {
            file: SourceFile::new(path, current),
        },
        Plan::Write(written) => {
            write_atomic(&full, written.as_bytes())?;
            SourceSaved::Written {
                file: SourceFile::new(path, written),
            }
        }
        Plan::Merged(merged) => {
            write_atomic(&full, merged.as_bytes())?;
            SourceSaved::Merged {
                file: SourceFile::new(path, merged),
            }
        }
        Plan::Conflict => {
            let copy = latex::conflict_path(|p| vault.root().join(p).exists(), path, now);
            create_atomic(&vault.file_of(&copy, &SOURCE_EXTENSIONS)?, text.as_bytes())?;
            SourceSaved::Conflict {
                copy,
                file: SourceFile::new(path, current),
            }
        }
    })
}
