//! Agent ops through the guardrails: each op is
//! refused, run, or kept as a proposal for review, by what it touches, how
//! much it writes and what its session did lately.

use serde::Serialize;
use serde_json::Value;

use super::Kasten;
use crate::agent::{AgentOp, Proposal, Session, load_trust};
use crate::error::{Error, Result};
use crate::frontmatter::split;
use crate::time::Instant;

/// A note as an agent sees it after a write.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NoteRef {
    pub path: String,
    pub id: Option<String>,
    pub title: String,
}

/// What an agent op came to (MCP tools return it as is).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Outcome {
    Done {
        result: Value,
    },
    PendingReview {
        proposal: String,
        reason: String,
    },
    /// Held back in a change set for the person to look at and apply: nothing
    /// is in the vault yet. `result` is what `Done` would have said.
    Staged {
        change_set: String,
        paths: Vec<String>,
        result: Value,
    },
}

/// Pending proposals one session may have before it is refused more.
pub const MAX_PENDING: usize = 100;
/// The window for "notes changed per session in 10 minutes", and for the
/// slides and pictures a session may take out or add in as long.
pub(super) const WINDOW_MS: u64 = 10 * 60 * 1000;

impl Kasten {
    /// A note's path from its path (`.md` optional), id or title, or a
    /// link to it (`[[path|Title]]`, `[[Title#Heading]]`). Titles shared by
    /// several notes are an error naming their paths.
    pub fn resolve(&self, reference: &str) -> Result<String> {
        let r = reference.trim();
        let r = match r.strip_prefix("[[").and_then(|x| x.strip_suffix("]]")) {
            Some(inner) => crate::links::parts(inner).target,
            None => r,
        };
        if r.ends_with(".md") && self.vault.exists(r) {
            return Ok(r.to_owned());
        }
        if r.contains('/') && !r.ends_with(".md") && self.vault.exists(&format!("{r}.md")) {
            return Ok(format!("{r}.md"));
        }
        if let Some(path) = self.path_of_id(r)? {
            return Ok(path);
        }
        let found: Vec<String> = self
            .index()
            .by_title(r)?
            .into_iter()
            .filter(|p| !crate::vault::in_templates(p))
            .collect();
        match found.as_slice() {
            [one] => Ok(one.clone()),
            [] => Err(Error::Invalid(format!("No note called “{r}”"))),
            many => Err(Error::Invalid(format!(
                "Several notes are called “{r}”; name one by path: {}",
                many.join(", ")
            ))),
        }
    }

    /// Runs an agent op: refused with an error, done, or kept for review.
    pub fn agent_run(&self, session: &Session, op: &AgentOp, now: Instant) -> Result<Outcome> {
        let _turn = self
            .agent_turn
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        self.refusals(op)?;
        if let Some(reason) = self.review_reason(session, op, now)? {
            return self.hold_for_review(session, op, reason, now);
        }
        let result = self.execute(&session.actor(), op, now)?;
        Ok(Outcome::Done { result })
    }

    /// Keeps `op` for review, for `reason`: the session's proposals are
    /// counted first, so one cannot fill the queue.
    pub(super) fn hold_for_review(
        &self,
        session: &Session,
        op: &AgentOp,
        reason: String,
        now: Instant,
    ) -> Result<Outcome> {
        let waiting = Proposal::pending(self.vault.root())?
            .iter()
            .filter(|p| p.session == session.id)
            .count();
        if waiting >= MAX_PENDING {
            return Err(Error::Invalid(format!(
                "This session has {waiting} proposals waiting for review; wait for them to be decided"
            )));
        }
        let id = self.propose(session, op, &reason, now)?;
        Ok(Outcome::PendingReview {
            proposal: id,
            reason,
        })
    }

    /// Whether a person trusted this session, lifting the soft limits.
    pub fn trusted(&self, session: &str, now: Instant) -> bool {
        load_trust(self.vault.root())
            .get(session)
            .is_some_and(|until| *until > now.millis)
    }

    /// Trusts a session until `until`.
    pub fn trust_session(&self, session: &str, until: u64) -> Result<()> {
        self.lock.hold(|| {
            let mut trust = load_trust(self.vault.root());
            trust.retain(|_, end| *end > crate::time::Instant::now().millis);
            trust.insert(session.to_owned(), until);
            crate::agent::save_trust(self.vault.root(), &trust)
        })
    }

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
        if note.meta.locked {
            return Err(Error::Invalid(format!(
                "“{}” is locked: read-only for agents. Ask the owner to unlock it or use propose_edit elsewhere",
                note.meta.title
            )));
        }
        Ok(())
    }

    /// Refuses when a locked note other than `path` links to `title`: the
    /// op would rewrite that link.
    fn no_locked_links(&self, title: &str, path: &str, doing: &str) -> Result<()> {
        for other in self.index().linking(title)? {
            if other != path && self.vault.read(&other).is_ok_and(|n| n.meta.locked) {
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
        self.refusals_with(op, &|_| false)
    }

    /// `refusals`, where `staged_new` says which paths are notes only a
    /// staged change has: they are not in the vault to be read, so they are
    /// held to the rules of their form (they cannot be locked yet).
    pub(crate) fn refusals_with(
        &self,
        op: &AgentOp,
        staged_new: &dyn Fn(&str) -> bool,
    ) -> Result<()> {
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
