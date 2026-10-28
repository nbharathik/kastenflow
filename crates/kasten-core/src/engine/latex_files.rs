//! Agents making a LaTeX document, adding text to a source file, and taking
//! a file out (to the trash). They go through `decide` like every agent op,
//! with the rules of the whole-file write beside them (`latex_agent.rs`): a
//! locked document or folder is refused in every mode, paths are plain and
//! spelled as on disk, files stay under the size limit, and Review holds all
//! of them. Taking out a document's root file waits for review in every mode
//! but Autonomous. Nothing is deleted for good.

use std::fs;

use serde_json::{Value, json};

use super::review::Preview;
use super::{Change, Kasten};
use crate::agent::{AgentOp, Target};
use crate::diff::unified;
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::latex::{self, MAX_SOURCE_BYTES, SOURCE_EXTENSIONS, Template, appended};
use crate::note::content_hash;
use crate::policy::OpClass;
use crate::time::Instant;

fn name_of(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// The template a tool names: `article` when it names none.
fn template_of(name: &str) -> Result<Template> {
    if name.trim().is_empty() {
        return Ok(Template::Article);
    }
    Template::from_name(name).ok_or_else(|| {
        Error::Invalid(format!(
            "There is no template called “{}”: the templates are article, report and beamer",
            name.trim()
        ))
    })
}

impl Kasten {
    /// Where a new document would go and what its root file would hold.
    pub(super) fn new_document(
        &self,
        title: &str,
        template: &str,
        project: Option<&str>,
    ) -> Result<(String, Template, String)> {
        if title.trim().is_empty() {
            return Err(Error::Invalid("A document needs a title".to_owned()));
        }
        let template = template_of(template)?;
        let path = self.new_latex_path(title, project)?;
        Ok((path.clone(), template, template.render(title, None)))
    }

    /// The text of the source file at `path`, as it is on disk: refused when
    /// it is over the size limit, or is not text.
    pub(super) fn source_text(&self, path: &str) -> Result<String> {
        let file = self.vault.file_of(path, &SOURCE_EXTENSIONS)?;
        super::latex_source::check_stored_size(&file)?;
        fs::read_to_string(&file).map_err(|err| match err.kind() {
            std::io::ErrorKind::NotFound => Error::NotFound(path.to_owned()),
            std::io::ErrorKind::InvalidData => Error::Invalid(format!(
                "{path} is not UTF-8 text, so it cannot be edited here"
            )),
            _ => Error::Io(err),
        })
    }

    /// The file `path` with the text of an append put in; why not, if the
    /// file moved on since it was read, would grow too big, or has no such marker.
    fn appended_file(&self, op: &AgentOp) -> Result<(String, latex::Appended)> {
        let AgentOp::AppendLatexFile {
            path,
            base_hash,
            text,
            after,
            ..
        } = op
        else {
            return Err(Error::Invalid(format!("{} is not an append", op.name())));
        };
        if base_hash.trim().is_empty() {
            return Err(Error::Invalid(format!(
                "Read {} first: adding to a file needs the hash it had when you read it",
                name_of(path)
            )));
        }
        let current = self.source_text(path)?;
        if content_hash(&current) != base_hash.trim() {
            return Err(Error::Invalid(format!(
                "{} changed since you read it, so nothing was written. Read it again and redo the change",
                name_of(path)
            )));
        }
        let size = current.len() + text.len();
        if size > MAX_SOURCE_BYTES {
            return Err(Error::Invalid(format!(
                "A source file may be at most {} KB; this one would be {} KB",
                MAX_SOURCE_BYTES / 1024,
                size.div_ceil(1024)
            )));
        }
        let done = appended(&current, text, after.as_deref(), name_of(path))?;
        Ok((current, done))
    }

    /// What no mode or approval lifts for these ops.
    pub(super) fn latex_files_refusals(&self, op: &AgentOp) -> Result<()> {
        match op {
            AgentOp::CreateLatexDoc {
                title,
                template,
                project,
                ..
            } => {
                let (path, ..) = self.new_document(title, template, project.as_deref())?;
                Self::writable_form(&path)?;
                if let Some(name) = self.latex_locked_above(&path) {
                    return Err(super::latex_source::locked_for_agents(&name));
                }
                self.check_spelling(&path)?;
            }
            AgentOp::AppendLatexFile { path, .. } => {
                if !latex::is_source_path(path) {
                    return Err(not_a_source(path));
                }
                self.check_spelling(path)?;
                self.appended_file(op)?;
            }
            AgentOp::TrashLatexFile { path, .. } => {
                if !latex::is_source_path(path) {
                    return Err(not_a_source(path));
                }
                self.check_spelling(path)?;
            }
            _ => {}
        }
        Ok(())
    }

    /// Whether the op waits for review whatever the mode: a document's root
    /// file taken out (the document goes with it).
    pub(super) fn latex_files_class(&self, op: &AgentOp) -> Result<OpClass> {
        let AgentOp::TrashLatexFile { path, .. } = op else {
            return Ok(OpClass::Ordinary);
        };
        Ok(
            if self
                .latex_doc_of(path)?
                .is_some_and(|doc| doc.main_path == *path)
            {
                OpClass::Always(format!(
                    "Taking out {}, the root file of a LaTeX document, always waits for review",
                    name_of(path)
                ))
            } else {
                OpClass::Ordinary
            },
        )
    }

    /// What a reviewer sees of these ops.
    pub(super) fn latex_files_preview(&self, op: &AgentOp) -> Result<Option<Preview>> {
        Ok(Some(match op {
            AgentOp::CreateLatexDoc {
                title,
                template,
                project,
                ..
            } => {
                let (path, kind, text) = self.new_document(title, template, project.as_deref())?;
                let words = format!("Make the {} document “{}”", kind.name(), title.trim());
                Preview {
                    diff: format!("{words}\n\n{}", unified(&path, "", &text, 3)),
                    target: Some(Target {
                        path,
                        title: title.trim().to_owned(),
                    }),
                    before: None,
                    after: Some(text),
                }
            }
            AgentOp::AppendLatexFile { path, .. } => {
                let (before, done) = self.appended_file(op)?;
                let words = format!("Add to the file {}", name_of(path));
                Preview {
                    diff: format!("{words}\n\n{}", unified(path, &before, &done.text, 3)),
                    target: Some(Target {
                        path: path.clone(),
                        title: name_of(path).to_owned(),
                    }),
                    before: Some(before),
                    after: Some(done.text),
                }
            }
            AgentOp::TrashLatexFile { path, .. } => {
                let before = self.source_text(path).ok();
                let words = format!("Move the file {} to the trash", name_of(path));
                Preview {
                    diff: format!(
                        "{words}\n\n{}",
                        unified(path, before.as_deref().unwrap_or(""), "", 3)
                    ),
                    target: Some(Target {
                        path: path.clone(),
                        title: name_of(path).to_owned(),
                    }),
                    before,
                    after: None,
                }
            }
            _ => return Ok(None),
        }))
    }

    /// Runs one of these ops as `actor`; what the agent is told comes back.
    pub(super) fn latex_files_execute(
        &self,
        actor: &Actor,
        op: &AgentOp,
        now: Instant,
    ) -> Result<Value> {
        match op {
            AgentOp::CreateLatexDoc {
                title,
                template,
                project,
                ..
            } => {
                let (_, kind, _) = self.new_document(title, template, project.as_deref())?;
                let doc = self.make_latex_doc(actor, title, kind, project.as_deref(), None, now)?;
                Ok(json!({
                    "status": "created",
                    "folder": doc.folder,
                    "main": doc.main,
                    "path": doc.main_path,
                    "title": doc.title,
                    "template": kind.name(),
                }))
            }
            AgentOp::AppendLatexFile { path, reason, .. } => {
                let (current, done) = self.appended_file(op)?;
                let note = done.text[..done.at]
                    .lines()
                    .any(|line| line.trim_start().starts_with("\\end{document}"));
                let save = AgentOp::SaveSource {
                    path: path.clone(),
                    text: done.text,
                    base: current,
                    reason: reason.clone(),
                };
                let mut out = self.latex_execute(actor, &save, now)?;
                out["added"] = json!(done.added);
                if note {
                    out["note"] = json!(
                        "The text went after \\end{document}, where TeX does not read it. Use after to put text inside the document"
                    );
                }
                Ok(out)
            }
            AgentOp::TrashLatexFile { path, .. } => {
                if actor.is_agent() {
                    self.latex_writable(path)?;
                }
                let trashed =
                    self.apply(actor, "trash_latex_file", false, now.millis, |vault| {
                        let trashed = crate::trash::trash_source_file(vault, path, now)?;
                        Ok(Change {
                            message: format!("trash: {}", name_of(path)),
                            paths: vec![path.clone(), trashed.clone()],
                            value: trashed,
                        })
                    })?;
                Ok(json!({ "path": path, "status": "trashed", "trashed": trashed }))
            }
            other => Err(Error::Invalid(format!(
                "{} is not a LaTeX file op",
                other.name()
            ))),
        }
    }
}

fn not_a_source(path: &str) -> Error {
    Error::Invalid(format!(
        "{path} is not a LaTeX source: these tools change {} files",
        SOURCE_EXTENSIONS.join(", ")
    ))
}
