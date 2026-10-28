//! An agent keeps the built PDF of a LaTeX document in the document's folder.
//! The op names the document and nothing else: the bytes are the app's own
//! build, read from the vault's cache when the op runs, so an agent can never
//! put a file of its choosing there, and a proposal that waits for review
//! carries no bytes. It goes through `decide` like every agent op (Review
//! holds it, Balanced and Autonomous write it), is refused for a locked
//! document or with the plugin off, and is one commit in the agent's session.
//! The person's own Export PDF stays person-only (`export_pdf`).

use std::fs;
use std::time::SystemTime;

use serde_json::{Value, json};

use super::review::Preview;
use super::{Change, Kasten};
use crate::agent::{AgentOp, Target};
use crate::atomic::write_atomic;
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::latex::{self, LatexDoc};
use crate::time::Instant;

fn size_words(bytes: usize) -> String {
    if bytes >= 1024 * 1024 {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    } else {
        format!("{} KB", bytes.div_ceil(1024))
    }
}

impl Kasten {
    /// The document of an export op and the PDF its last build left: why not,
    /// when the plugin is off, the document is locked or is not one, there is
    /// no PDF, it is not one, or a source changed after it was made.
    fn export_source(&self, op: &AgentOp) -> Result<(LatexDoc, Vec<u8>)> {
        let AgentOp::ExportLatexPdf { doc, .. } = op else {
            return Err(Error::Invalid(format!("{} is not a PDF export", op.name())));
        };
        if !self.config().plugin_enabled("latex") {
            return Err(Error::Invalid(
                "Turn on the LaTeX plugin in Settings → Plugins".to_owned(),
            ));
        }
        let folder = doc.trim_end_matches('/');
        let found = self.latex_docs()?.into_iter().find(|d| d.folder == folder);
        let doc = found.ok_or_else(|| {
            Error::Invalid(format!(
                "“{}” is not a LaTeX document folder, so nothing was exported there",
                folder.chars().take(80).collect::<String>()
            ))
        })?;
        if self.latex_is_locked(&doc) {
            return Err(super::latex_source::locked_for_agents(&doc.title));
        }
        let (bytes, made) = latex::cached_pdf(self.vault.root(), &doc)?;
        let base = self.vault.root().join(&doc.folder);
        let newest: Option<SystemTime> = self
            .latex_files(&doc)?
            .iter()
            .filter_map(|f| fs::metadata(base.join(f)).and_then(|m| m.modified()).ok())
            .max();
        if matches!((newest, made), (Some(source), Some(built)) if source > built) {
            return Err(Error::Invalid(format!(
                "A file of “{}” changed after its last build, so the PDF may be out of date: build it again first",
                doc.title
            )));
        }
        Ok((doc, bytes))
    }

    /// What no mode or approval lifts for the export.
    pub(super) fn latex_export_refusals(&self, op: &AgentOp) -> Result<()> {
        self.export_source(op).map(|_| ())
    }

    /// What a reviewer sees: the words only (the bytes are the app's).
    pub(super) fn latex_export_preview(&self, op: &AgentOp) -> Result<Option<Preview>> {
        if !matches!(op, AgentOp::ExportLatexPdf { .. }) {
            return Ok(None);
        }
        let (doc, bytes) = self.export_source(op)?;
        let path = latex::pdf_path(&doc);
        let words = format!(
            "Keep the built PDF of “{}” ({}) in the document's folder as {path}",
            doc.title,
            size_words(bytes.len())
        );
        Ok(Some(Preview {
            diff: words,
            target: Some(Target {
                path: path.clone(),
                title: path.rsplit('/').next().unwrap_or(&path).to_owned(),
            }),
            before: None,
            after: None,
        }))
    }

    /// Runs the export as `actor`; what the agent is told comes back.
    pub(super) fn latex_export_execute(
        &self,
        actor: &Actor,
        op: &AgentOp,
        now: Instant,
    ) -> Result<Value> {
        let (doc, bytes) = self.export_source(op)?;
        latex::check_pdf(&bytes)?;
        let path = self.write_pdf(actor, &doc, &bytes, "export_latex_pdf", now)?;
        Ok(json!({
            "status": "exported",
            "doc": doc.folder,
            "path": path,
            "bytes": bytes.len(),
        }))
    }

    /// Keeps `bytes` (a PDF) beside the root file of `doc`, replacing an
    /// earlier export, as one commit named `op`; the PDF's path. Only an
    /// earlier export is replaced: another kind of file with this name stays.
    pub(super) fn write_pdf(
        &self,
        actor: &Actor,
        doc: &LatexDoc,
        bytes: &[u8],
        op: &str,
        now: Instant,
    ) -> Result<String> {
        let pdf = latex::pdf_path(doc);
        let file = self.vault.file_of(&pdf, &[".pdf"])?;
        self.apply(actor, op, false, now.millis, |_| {
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
