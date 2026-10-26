//! What agents may not write at all: templates and hidden folders, locked
//! notes, links a locked note would lose, oversized writes. No trust or
//! approval lifts these.

use super::Kasten;
use super::page_edit::PageText;
use crate::agent::AgentOp;
use crate::error::{Error, Result};
use crate::frontmatter::{read_map, split};
use crate::note::NoteFile;

/// Whether agents must treat the page as locked: its lock is set, or its
/// header cannot be read, so a lock in it cannot be seen. (A header the
/// parser cannot make sense of reads as having no keys, `locked` included; and
/// a header that parses as plain YAML but not as the known keys does too.)
pub(super) fn locked_for_agents(note: &NoteFile) -> bool {
    if note.meta.locked {
        return true;
    }
    match read_map(split(&note.text).prefix) {
        Ok(keys) => keys.get("locked").is_some_and(|value| {
            value.as_bool() == Some(true)
                || value
                    .as_str()
                    .is_some_and(|text| matches!(text.trim(), "true" | "yes"))
        }),
        Err(_) => true,
    }
}

impl Kasten {
    /// A path agents may write by its form alone: not a template or a
    /// private file.
    pub(super) fn writable_form(path: &str) -> Result<()> {
        if crate::vault::in_templates(path) || path.starts_with('.') || path.contains("/.") {
            return Err(Error::Invalid(format!(
                "{path} is read-only for agents (templates and hidden folders)"
            )));
        }
        Ok(())
    }

    /// A note or board agents may write: not a template or private file,
    /// not locked.
    pub(super) fn writable(&self, path: &str) -> Result<()> {
        Self::writable_form(path)?;
        // A LaTeX source is as writable as its document's folder (not locked).
        if crate::latex::is_source_path(path) {
            return self.latex_writable(path);
        }
        // A diagram's picture is as writable as its source, which is what an agent changes.
        if let Some(source) = path
            .strip_suffix(".svg")
            .filter(|s| s.ends_with(crate::diagrams::EXT))
        {
            return self.writable(source);
        }
        // Boards, decks and diagrams have no lock: the folders and the file being there are all that is asked.
        if let Some(ext) = [".canvas", ".deck", crate::diagrams::EXT]
            .into_iter()
            .find(|e| path.ends_with(e))
        {
            return match self.vault.file_of(path, &[ext])?.is_file() {
                true => Ok(()),
                false => Err(Error::NotFound(path.to_owned())),
            };
        }
        let note = self.vault.read(path)?;
        if locked_for_agents(&note) {
            return Err(Error::Invalid(format!(
                "“{}” is locked (or its header cannot be read): read-only for agents. Ask the owner to unlock it or use propose_edit elsewhere",
                note.meta.title
            )));
        }
        Ok(())
    }

    /// Refuses when a locked note other than `path` links to `title`: the
    /// op would rewrite that link.
    pub(super) fn no_locked_links(&self, title: &str, path: &str, doing: &str) -> Result<()> {
        for other in self.index().linking(title)? {
            if other != path && self.vault.read(&other).is_ok_and(|n| locked_for_agents(&n)) {
                return Err(Error::Invalid(format!(
                    "{other} is locked and links to “{title}”, so an agent cannot {doing}"
                )));
            }
        }
        Ok(())
    }

    /// `no_locked_links` for a new note, when its title is already in use.
    fn no_locked_links_to_namesake(&self, title: &str) -> Result<()> {
        let title = title.trim();
        if self.index().by_title(title)?.is_empty() {
            return Ok(());
        }
        self.no_locked_links(title, "", "make another note with that title")
    }

    /// Guardrails no trust or approval lifts: these ops are refused.
    pub(crate) fn refusals(&self, op: &AgentOp) -> Result<()> {
        self.refusals_with(op, &|_| false, PageText::Vault)
    }

    /// `refusals`, where `staged_new` says which paths are notes only a
    /// staged change has: they are not in the vault to be read, so they are
    /// held to the rules of their form (they cannot be locked yet). `pages`
    /// says which text a page edit is tried against.
    pub(crate) fn refusals_with(
        &self,
        op: &AgentOp,
        staged_new: &dyn Fn(&str) -> bool,
        pages: PageText,
    ) -> Result<()> {
        // A batch is refused if any change in it is; the size limit is each
        // change's own (the batch has its own, in `check_shape`).
        if let AgentOp::Batch { ops, .. } = op {
            crate::batch::check_shape(ops)?;
            for (index, each) in ops.iter().enumerate() {
                self.refusals_with(each, staged_new, pages)
                    .and_then(|()| self.batch_rules(each))
                    .map_err(|err| crate::batch::refused(index, ops.len(), each, &err))?;
            }
            return Ok(());
        }
        let writable = |path: &str| {
            if staged_new(path) {
                Self::writable_form(path)
            } else {
                self.writable(path)
            }
        };
        let limit = self.config().guardrails.max_write_bytes;
        if op.bytes() as u64 > limit {
            return Err(Error::Invalid(format!(
                "A single write may be at most {} KB; this one is {} KB",
                limit / 1024,
                op.bytes() / 1024
            )));
        }
        if let Some(path) = op.path() {
            writable(path)?;
        }
        match op {
            AgentOp::CreateNote {
                title,
                parent,
                template,
                ..
            } => {
                if let Some(parent) = parent {
                    writable(parent)?;
                }
                if let Some(name) = template {
                    crate::ops::not_an_action(name)?;
                    let path = format!("templates/{}.md", crate::slug::slugify(name));
                    if !self.vault.exists(&path) {
                        return Err(Error::Invalid(format!(
                            "No template called “{name}”; list_templates names them"
                        )));
                    }
                }
                // A title in use makes links to the other note name its path.
                self.no_locked_links_to_namesake(title)?;
            }
            AgentOp::Rename { path, .. } => {
                let title = self.vault.read(path)?.meta.title;
                self.no_locked_links(&title, path, "rename it")?;
            }
            // Sub-pages go to the trash along with their page.
            AgentOp::Trash { path, .. } => {
                for going in self.with_sub_pages(path)? {
                    self.writable(&going)?;
                }
            }
            // Sub-pages go along, and links to what moves may be rewritten.
            AgentOp::Move { path, .. } => {
                let notes = self.index().notes()?;
                if let Some(root) = notes.iter().find(|n| n.path == *path) {
                    for moved in crate::moving::subtree(&notes, root) {
                        self.writable(&moved.path)?;
                        self.no_locked_links(&moved.title, &moved.path, "move it")?;
                    }
                }
            }
            AgentOp::Capture { markdown, .. } => {
                self.no_locked_links_to_namesake(&crate::capture::split(markdown).0)?;
            }
            AgentOp::JournalAppend { date, .. } => {
                let path = format!("journal/{}/{date}.md", date.get(..4).unwrap_or(""));
                if self.vault.exists(&path) {
                    self.writable(&path)?;
                }
            }
            AgentOp::TagSchema { tag, schema } => {
                crate::tags::schema_yaml(tag, schema)?;
            }
            AgentOp::EditDeck { .. } | AgentOp::CreateDeck { .. } => self.deck_refusals(op)?,
            AgentOp::SaveSource { .. } => self.latex_refusals(op)?,
            AgentOp::SmartWrite { .. } | AgentOp::SmartDelete { .. } => self.smart_refusals(op)?,
            AgentOp::SmartCreate { title, parent, .. } => {
                if let Some(parent) = parent {
                    writable(parent)?;
                }
                self.no_locked_links_to_namesake(title)?;
                self.smart_create_refusals(op)?;
            }
            AgentOp::EditPage { .. } => self.page_refusals(op, pages)?,
            AgentOp::SetParent { .. }
            | AgentOp::ReorderChildren { .. }
            | AgentOp::CreateProject { .. }
            | AgentOp::SetProjectState { .. }
            | AgentOp::SetTagViews { .. }
            | AgentOp::UpdateProps { .. } => self.structure_refusals(op, staged_new)?,
            AgentOp::SetViewOrder { .. } => self.view_order_refusals(op)?,
            AgentOp::DuplicateNote { .. }
            | AgentOp::RestoreNote { .. }
            | AgentOp::SetNoteMeta { .. }
            | AgentOp::ApplyTemplate { .. }
            | AgentOp::JournalDay { .. }
            | AgentOp::SetTask { .. }
            | AgentOp::AddComment { .. }
            | AgentOp::ResolveComment { .. }
            | AgentOp::CreateCollection { .. }
            | AgentOp::UpdateCollection { .. }
            | AgentOp::AddReference { .. }
            | AgentOp::RenameDiagram { .. }
            | AgentOp::MoveDiagram { .. }
            | AgentOp::DuplicateDiagram { .. }
            | AgentOp::UndoSession { .. } => self.parity_refusals(op)?,
            AgentOp::SaveProjectSetup { .. } => self.setup_save_refusals(op)?,
            AgentOp::CreateDiagram { .. }
            | AgentOp::UpdateDiagram { .. }
            | AgentOp::EditDiagram { .. } => {
                self.diagram_refusals(op)?;
            }
            AgentOp::Template {
                name, text, base, ..
            } => {
                let path = AgentOp::template_path(name)
                    .ok_or_else(|| Error::Invalid("A template needs a name".to_owned()))?;
                if !crate::frontmatter::yaml_ok(split(text).prefix) {
                    return Err(Error::Invalid(
                        "The template's frontmatter is not valid YAML".to_owned(),
                    ));
                }
                match (base, self.vault.exists(&path)) {
                    (None, true) => {
                        return Err(Error::Invalid(format!(
                            "A template called “{name}” already exists; update_template changes it"
                        )));
                    }
                    (Some(_), false) => return Err(Error::NotFound(path)),
                    _ => {}
                }
            }
            _ => {}
        }
        Ok(())
    }
}
