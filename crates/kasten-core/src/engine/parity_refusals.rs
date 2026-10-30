//! What agents may not do with the parity ops (duplicate, restore, page
//! header, template, journal day, to-do, comment, collection, reference,
//! diagram file and session undo ops), in every mode: no trust or approval
//! lifts these. The note an op names has been checked for a lock already
//! (`refusals_with`).

use std::collections::HashSet;

use serde_json::{Map, Value};

use super::Kasten;
use super::bibliography::managed_text;
use crate::agent::AgentOp;
use crate::bib::{NewReference, style};
use crate::comments::NewComment;
use crate::error::{Error, Result};
use crate::frontmatter::split;
use crate::slug::slugify;

/// The page header keys an agent may set; the title is `rename_note`, the
/// lock is the person's.
const META_KEYS: [&str; 6] = ["icon", "cover", "font", "width", "text", "layout"];

/// The longest value of a page header setting an agent may write: an icon,
/// a picture's address or a choice, never a block of text.
const META_VALUE_BYTES: usize = 2_000;

/// The keys of a saved search.
const COLLECTION_KEYS: [&str; 6] = ["icon", "query", "when", "filter", "sort", "display"];

/// How far back history is looked at for a session's changes.
const LOOK_BACK: usize = 20_000;

fn bad(message: impl Into<String>) -> Error {
    Error::Invalid(message.into())
}

/// Refuses a path that is not a note.
fn a_note(path: &str, what: &str) -> Result<()> {
    if path.ends_with(".md") {
        Ok(())
    } else {
        Err(bad(format!("{path} is not a note: {what}")))
    }
}

/// Refuses keys a saved search does not have.
fn search_keys(edits: &Map<String, Value>) -> Result<()> {
    match edits
        .keys()
        .find(|k| !COLLECTION_KEYS.contains(&k.as_str()))
    {
        Some(key) => Err(bad(format!(
            "A saved search has {}; not “{key}”",
            COLLECTION_KEYS.join(", ")
        ))),
        None => Ok(()),
    }
}

impl Kasten {
    pub(super) fn parity_refusals(&self, op: &AgentOp) -> Result<()> {
        match op {
            AgentOp::DuplicateNote { path } => {
                a_note(path, "duplicate_note copies pages and cards")
            }
            AgentOp::RestoreNote { path } => self.restore_refusals(path),
            AgentOp::SetNoteMeta { path, key, value } => {
                a_note(path, "set_note_meta changes a page's header")?;
                match key.as_str() {
                    "locked" => Err(bad("A page is locked and unlocked by a person only")),
                    "title" => Err(bad("rename_note changes a title")),
                    // A smart page runs code; smart_create is the one way in for
                    // an agent (it makes the folder with the page), so that the
                    // modes, the size limits and the file rules see the whole page.
                    "layout" if value.as_deref() == Some(crate::smart::SMART_LAYOUT) => Err(bad(
                        "An agent makes a smart page with smart_create; a person turns an existing page into one",
                    )),
                    k if META_KEYS.contains(&k) => {
                        if value.as_deref().is_some_and(|v| v.len() > META_VALUE_BYTES) {
                            return Err(bad(format!(
                                "A page's {k} is short: at most {META_VALUE_BYTES} bytes"
                            )));
                        }
                        crate::ops::check_meta_value(k, value.as_deref())
                    }
                    other => Err(bad(format!(
                        "An agent sets {} on a page header; not “{other}”",
                        META_KEYS.join(", ")
                    ))),
                }
            }
            AgentOp::ApplyTemplate {
                path,
                template,
                date,
            } => self.template_refusals(path, template, date.as_deref()),
            AgentOp::JournalDay { date } => {
                if crate::dates::is_real_day(date) {
                    Ok(())
                } else {
                    Err(bad(format!("Not a day: “{date}”. Write it YYYY-MM-DD")))
                }
            }
            AgentOp::SetTask {
                path,
                line,
                done,
                base,
            } => {
                a_note(path, "set_task ticks a to-do in a note")?;
                let note = self.vault.read(path)?;
                if note.hash != *base {
                    return Err(bad(format!(
                        "“{}” changed since you read it. Read its to-dos again with list_tasks and tick the one you mean once more",
                        note.meta.title
                    )));
                }
                super::parity::tick_in_body(split(&note.text).body, *line, *done).map(|_| ())
            }
            AgentOp::AddComment { path, anchor, text } => {
                a_note(path, "comments go on notes")?;
                NewComment {
                    anchor: anchor.clone(),
                    text: text.clone(),
                }
                .check()
            }
            AgentOp::ResolveComment { path, id, .. } => {
                a_note(path, "comments are on notes")?;
                if id.trim().is_empty() {
                    return Err(bad("Say which comment: list_comments gives their ids"));
                }
                Ok(())
            }
            AgentOp::CreateCollection { name, edits } => {
                search_keys(edits)?;
                crate::collections::new_text(name, edits).map(|_| ())
            }
            AgentOp::UpdateCollection { path, edits, base } => {
                search_keys(edits)?;
                self.collection_update_refusals(path, edits, base)
            }
            AgentOp::AddReference {
                kind,
                key,
                fields,
                allow_duplicate,
            } => self.reference_refusals(kind, key, fields, *allow_duplicate),
            AgentOp::RenameDiagram { path, title } => {
                self.diagram_file(path)?;
                if title.trim().is_empty() {
                    return Err(bad("A diagram needs a title"));
                }
                self.no_locked_mentions(path, "rename it")
            }
            AgentOp::MoveDiagram { path, .. } => {
                self.diagram_file(path)?;
                self.no_locked_mentions(path, "move it")
            }
            AgentOp::DuplicateDiagram { path } => self.diagram_file(path),
            AgentOp::UndoSession { session } => self.undo_refusals(session),
            _ => Ok(()),
        }
    }

    fn diagram_file(&self, path: &str) -> Result<()> {
        if path.ends_with(crate::diagrams::EXT) {
            Ok(())
        } else {
            Err(bad(format!(
                "{path} is not a diagram: this changes a .drawio file"
            )))
        }
    }

    /// A diagram that moves or is renamed is named differently in the notes
    /// that embed it, which are rewritten: a locked note cannot be.
    fn no_locked_mentions(&self, path: &str, doing: &str) -> Result<()> {
        let name = path.rsplit('/').next().unwrap_or(path);
        let lower = name.to_lowercase();
        // Every note is read: a lock in a header the typed reader gives up on
        // is seen only by `locked_for_agents`, which counts an unreadable
        // header as locked (the index's own column does not see it).
        for meta in self.list()? {
            let Ok(note) = self.vault.read(&meta.path) else {
                continue;
            };
            // Links name a file whatever its case (Windows and macOS do not tell them apart).
            if note.text.to_lowercase().contains(&lower)
                && super::agent_refusals::locked_for_agents(&note)
            {
                return Err(bad(format!(
                    "{} is locked and names {name}, so an agent cannot {doing}",
                    meta.path
                )));
            }
        }
        Ok(())
    }

    /// Only a trashed group at the top of the trash comes back, and not into
    /// the templates or a hidden folder.
    fn restore_refusals(&self, trashed: &str) -> Result<()> {
        let listed = self.list_trash()?;
        let Some(item) = listed.iter().find(|t| t.trashed == trashed) else {
            return Err(bad(format!(
                "{trashed} is not something the trash lists. list_trash names what can come back"
            )));
        };
        if !item.original.ends_with(".md") {
            return Err(bad(format!(
                "{} is not a note: restore_note puts notes back",
                item.original
            )));
        }
        Self::writable_form(&item.original)
    }

    fn template_refusals(&self, path: &str, template: &str, date: Option<&str>) -> Result<()> {
        a_note(path, "apply_template fills a page")?;
        crate::ops::not_an_action(template)?;
        if !self
            .vault
            .exists(&format!("templates/{}.md", slugify(template)))
        {
            return Err(bad(format!(
                "No template called “{template}”; list_templates names them"
            )));
        }
        if let Some(date) = date
            && !crate::dates::is_real_day(date)
        {
            return Err(bad(format!("Not a day: “{date}”. Write it YYYY-MM-DD")));
        }
        let note = self.vault.read(path)?;
        if !split(&note.text).body.trim().is_empty() {
            return Err(bad("Templates only start empty pages"));
        }
        Ok(())
    }

    fn collection_update_refusals(
        &self,
        path: &str,
        edits: &Map<String, Value>,
        base: &str,
    ) -> Result<()> {
        if !crate::collections::is_path(path) {
            return Err(bad(format!(
                "{path} is not a saved search: they are views/<name>.yaml"
            )));
        }
        let found = self.collection(path)?;
        if let Some(why) = &found.problem {
            return Err(bad(why.clone()));
        }
        if found.read_only {
            return Err(bad("This saved search cannot be changed"));
        }
        if found.hash != base {
            return Err(bad(
                "This saved search changed since you listed it. List the saved searches again and make the change once more",
            ));
        }
        let text = std::fs::read_to_string(self.vault.file_of(path, &[".yaml"])?)?;
        let edited = crate::collections::edit_text(&text, edits)?;
        match crate::collections::read(path, &edited, 0).problem {
            Some(why) => Err(bad(why)),
            None => Ok(()),
        }
    }

    fn reference_refusals(
        &self,
        kind: &str,
        key: &str,
        fields: &std::collections::BTreeMap<String, String>,
        allow_duplicate: bool,
    ) -> Result<()> {
        let kind = style::check_type(kind)?;
        let key = style::check_key(key)?;
        let fields = super::bibliography::clean_fields(fields)?;
        managed_text(&self.vault)?;
        if allow_duplicate {
            return Ok(());
        }
        let wanted = NewReference {
            kind,
            key: key.clone(),
            fields,
            allow_duplicate: false,
        };
        match self.check_reference(&wanted)?.first() {
            Some(found) => Err(bad(format!(
                "“{}” in {} is the same work (same {}). Add it anyway only if it is another work, with allowDuplicate",
                found.key,
                found.file,
                found.by.label()
            ))),
            None => Ok(()),
        }
    }

    /// The commits of an agent session that are not taken back yet. Only a
    /// commit that carries the session's trailer is one of its: a person's
    /// commit never is, whatever its words say.
    pub(super) fn session_commits_left(&self, session: &str) -> Result<Vec<String>> {
        let log = self.log(None, LOOK_BACK)?;
        let undone: HashSet<&str> = log.iter().filter_map(|c| c.undoes.as_deref()).collect();
        Ok(log
            .iter()
            .filter(|c| c.session.as_deref() == Some(session) && !undone.contains(c.id.as_str()))
            .map(|c| c.id.clone())
            .collect())
    }

    /// The session has changes left to take back, and none of them is in a
    /// note that is locked now.
    fn undo_refusals(&self, session: &str) -> Result<()> {
        if !self.has_history() {
            return Err(bad(
                "This vault keeps no history, so there is nothing to undo",
            ));
        }
        let left = self.session_commits_left(session)?;
        if left.is_empty() {
            return Err(bad(
                "That session has nothing left to undo. list_sessions names the sessions",
            ));
        }
        for commit in left {
            for changed in self.commit_changes(&commit)? {
                if changed.path.ends_with(".md")
                    && self
                        .vault
                        .read(&changed.path)
                        .is_ok_and(|note| super::agent_refusals::locked_for_agents(&note))
                {
                    return Err(bad(format!(
                        "{} is locked now, so an agent cannot take back the changes made to it",
                        changed.path
                    )));
                }
            }
        }
        Ok(())
    }
}
