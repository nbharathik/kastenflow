//! Agents sending a page, or one section of it, to LaTeX, as the app's "Send to
//! LaTeX" does: the Markdown is converted by the same code (escaped, citations
//! kept as `\cite`), and the text is either added to the root file of a
//! document or made into a new document. The guards are the other LaTeX
//! ops': a locked document or folder is refused in every mode, files stay
//! under the size limit, and the modes decide whether it waits.

use serde_json::{Value, json};

use super::latex_send::nothing_to_send;
use super::review::Preview;
use super::{Kasten, latex_source};
use crate::agent::{AgentOp, Target};
use crate::diff::unified;
use crate::error::{Error, Result};
use crate::frontmatter::split;
use crate::history::Actor;
use crate::latex::{
    Converted, LatexDoc, MAX_SOURCE_BYTES, Material, SourceFile, SourceSaved, Template,
};
use crate::sections::section_with_heading;
use crate::time::Instant;

fn invalid(why: impl Into<String>) -> Error {
    Error::Invalid(why.into())
}

/// The Markdown to send: a whole page, or one section with its heading.
enum Source {
    Page(String),
    Section(String),
}

impl Source {
    fn material(&self) -> Material<'_> {
        match self {
            Source::Page(text) => Material::Page(text),
            Source::Section(text) => Material::Selection(text),
        }
    }
}

/// Where the text goes.
enum Place {
    /// Added to the root file of a document.
    Append {
        doc: LatexDoc,
        file: SourceFile,
        text: String,
    },
    /// A document made for it.
    New {
        path: String,
        title: String,
        template: Template,
        project: Option<String>,
        text: String,
    },
}

/// Sending, worked out and checked, not yet written.
struct SendPlan {
    place: Place,
    converted: Converted,
}

fn too_big(len: usize) -> Error {
    invalid(format!(
        "A source file may be at most {} KB; this one would be {} KB",
        MAX_SOURCE_BYTES / 1024,
        len.div_ceil(1024)
    ))
}

impl Kasten {
    /// The Markdown of a page or of one of its sections, and the page's title.
    fn send_source(&self, page: &str, section: Option<&str>) -> Result<(Source, String)> {
        if !page.trim().ends_with(".md") {
            return Err(invalid(format!(
                "“{}” is not a page: name a note by its path, such as projects/trip/plan.md",
                page.trim()
            )));
        }
        let note = self.vault.read(page.trim())?;
        let title = note.meta.title.clone();
        match section.map(str::trim).filter(|s| !s.is_empty()) {
            None => Ok((Source::Page(note.text), title)),
            Some(heading) => {
                let text = section_with_heading(split(&note.text).body, heading)?;
                Ok((Source::Section(text), title))
            }
        }
    }

    fn send_plan(&self, op: &AgentOp) -> Result<SendPlan> {
        let AgentOp::SendPageToLatex {
            page,
            section,
            doc,
            title,
            template,
            project,
            ..
        } = op
        else {
            return Err(invalid(format!("{} is not a send", op.name())));
        };
        let (source, page_title) = self.send_source(page, section.as_deref())?;
        let named = title.as_deref().map(str::trim).filter(|t| !t.is_empty());
        if let Some(folder) = doc {
            if named.is_some() || project.is_some() || !template.trim().is_empty() {
                return Err(invalid(
                    "Give doc to add to a document, or title, template and project to make a new one, not both",
                ));
            }
            let doc = self.doc_in_folder(folder)?;
            if let Some(locked) = self.latex_locked_above(&doc.main_path) {
                return Err(latex_source::locked_for_agents(&locked));
            }
            self.check_spelling(&doc.main_path)?;
            let (file, text, converted) =
                self.plan_send_append(source.material(), &doc.main_path)?;
            if text.len() > MAX_SOURCE_BYTES {
                return Err(too_big(text.len()));
            }
            return Ok(SendPlan {
                place: Place::Append { doc, file, text },
                converted,
            });
        }
        let title = named.map_or(page_title, str::to_owned);
        let (path, kind, _) = self.new_document(&title, template, project.as_deref())?;
        Self::writable_form(&path)?;
        if let Some(locked) = self.latex_locked_above(&path) {
            return Err(latex_source::locked_for_agents(&locked));
        }
        self.check_spelling(&path)?;
        let converted = source.material().convert(kind.mode());
        if converted.tex.is_empty() {
            return Err(nothing_to_send());
        }
        let text = kind.render(&title, Some(&converted.tex));
        if text.len() > MAX_SOURCE_BYTES {
            return Err(too_big(text.len()));
        }
        Ok(SendPlan {
            place: Place::New {
                path,
                title,
                template: kind,
                project: project.clone(),
                text,
            },
            converted,
        })
    }

    pub(super) fn latex_send_refusals(&self, op: &AgentOp) -> Result<()> {
        self.send_plan(op).map(|_| ())
    }

    pub(super) fn latex_send_preview(&self, op: &AgentOp) -> Result<Preview> {
        Ok(match self.send_plan(op)?.place {
            Place::Append { doc, file, text } => Preview {
                diff: format!(
                    "Add the page to the document “{}”\n\n{}",
                    doc.title,
                    unified(&doc.main_path, &file.text, &text, 3)
                ),
                target: Some(Target {
                    path: doc.main_path.clone(),
                    title: doc.title,
                }),
                before: Some(file.text),
                after: Some(text),
            },
            Place::New {
                path,
                title,
                template,
                text,
                ..
            } => Preview {
                diff: format!(
                    "Make the {} document “{title}” from the page\n\n{}",
                    template.name(),
                    unified(&path, "", &text, 3)
                ),
                target: Some(Target { path, title }),
                before: None,
                after: Some(text),
            },
        })
    }

    /// Sends the page; what the agent is told comes back.
    pub(super) fn latex_send_execute(
        &self,
        actor: &Actor,
        op: &AgentOp,
        now: Instant,
    ) -> Result<Value> {
        let SendPlan { place, converted } = self.send_plan(op)?;
        let mut note = None;
        let (doc, appended) = match place {
            Place::Append { doc, file, text } => {
                let saved = self.write_source(actor, &doc.main_path, &file.hash, &text, now)?;
                if matches!(saved, SourceSaved::Conflict { .. }) {
                    note = Some(
                        "The document changed on the same lines meanwhile, so it was left as it is and the page was kept in a copy beside it"
                            .to_owned(),
                    );
                }
                (doc, true)
            }
            Place::New {
                title,
                template,
                project,
                ..
            } => {
                let doc = self.make_latex_doc(
                    actor,
                    &title,
                    template,
                    project.as_deref(),
                    Some(&converted.tex),
                    now,
                )?;
                (doc, false)
            }
        };
        let mut out = json!({
            "status": "sent",
            "appended": appended,
            "doc": doc.folder,
            "path": doc.main_path,
            "title": doc.title,
            "cites": converted.cites,
            "todos": converted.todos,
        });
        let mut notes: Vec<String> = note.into_iter().collect();
        if !converted.cites.is_empty() {
            notes.push(format!(
                "The text cites {}. Their entries belong in the document's bibliography: latex_cite adds one for a key in the References",
                converted.cites.join(", ")
            ));
        }
        if converted.todos > 0 {
            notes.push(format!(
                "{} places were left as plain text with a % TODO comment: read the file and finish them",
                converted.todos
            ));
        }
        if !notes.is_empty() {
            out["note"] = json!(notes.join(". "));
        }
        Ok(out)
    }
}
