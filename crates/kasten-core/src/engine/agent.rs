//! Agent ops through the guardrails: each op is
//! refused, run, or kept as a proposal for review, by what it touches, how
//! much it writes and what its session did lately.

use serde::Serialize;
use serde_json::Value;

use super::Kasten;
use crate::agent::{AgentOp, Proposal, Session, load_trust};
use crate::diff::removed_fraction;
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
    Done { result: Value },
    PendingReview { proposal: String, reason: String },
}

/// Pending proposals one session may have before it is refused more.
pub const MAX_PENDING: usize = 100;
/// The window for "notes changed per session in 10 minutes", and for the
/// slides and pictures a session may take out or add in as long.
pub(super) const WINDOW_MS: u64 = 10 * 60 * 1000;

fn percent(fraction: f64) -> String {
    format!("{:.0}%", fraction * 100.0)
}

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
            return Ok(Outcome::PendingReview {
                proposal: id,
                reason,
            });
        }
        let result = self.execute(&session.actor(), op, now)?;
        Ok(Outcome::Done { result })
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

    /// A note or board agents may write: not a template or private file,
    /// not locked.
    pub(super) fn writable(&self, path: &str) -> Result<()> {
        if crate::vault::in_templates(path) || path.starts_with('.') || path.contains("/.") {
            return Err(Error::Invalid(format!(
                "{path} is read-only for agents (templates and hidden folders)"
            )));
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
        let limit = self.config().guardrails.max_write_bytes;
        if op.bytes() as u64 > limit {
            return Err(Error::Invalid(format!(
                "A single write may be at most {} KB; this one is {} KB",
                limit / 1024,
                op.bytes() / 1024
            )));
        }
        if let Some(path) = op.path() {
            self.writable(path)?;
        }
        match op {
            AgentOp::CreateNote {
                title,
                parent,
                template,
                ..
            } => {
                if let Some(parent) = parent {
                    self.writable(parent)?;
                }
                if let Some(name) = template {
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
            AgentOp::CreateDiagram { .. } | AgentOp::UpdateDiagram { .. } => {
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

    /// Paths the op would change that exist now, and how many new files it makes.
    fn touches(&self, op: &AgentOp) -> Result<(Vec<String>, usize)> {
        Ok(match op {
            // The file usually moves to its new title's name: one new path.
            AgentOp::Rename { path, .. } => {
                let title = self.vault.read(path)?.meta.title;
                let mut paths = self.index().linking(&title)?;
                paths.push(path.clone());
                (paths, 1)
            }
            AgentOp::Move { path, .. } => {
                let notes = self.list()?;
                let mut tree = vec![path.clone()];
                let mut i = 0;
                while i < tree.len() {
                    let id = notes
                        .iter()
                        .find(|n| n.path == tree[i])
                        .and_then(|n| n.id.clone());
                    if let Some(id) = id {
                        for n in notes.iter().filter(|n| n.parent.as_deref() == Some(&id)) {
                            if !tree.contains(&n.path) {
                                tree.push(n.path.clone());
                            }
                        }
                    }
                    i += 1;
                }
                // Every moved note gets a new path too.
                let moved = tree.len();
                (tree, moved)
            }
            AgentOp::Trash { path, .. } => (self.with_sub_pages(path)?, 0),
            AgentOp::JournalAppend { date, .. } => {
                let path = format!("journal/{}/{date}.md", date.get(..4).unwrap_or(""));
                if self.vault.exists(&path) {
                    (vec![path], 0)
                } else {
                    (vec![], 1)
                }
            }
            other => match other.path() {
                Some(path) => (vec![path.to_owned()], 0),
                None => (vec![], usize::from(other.creates())),
            },
        })
    }

    /// Why an op must wait for review, if it must.
    pub(super) fn review_reason(
        &self,
        session: &Session,
        op: &AgentOp,
        now: Instant,
    ) -> Result<Option<String>> {
        // Decks: a deck to the trash, and many slides taken out, wait even when trusted.
        if let Some(reason) = self.deck_review_reason(session, op, now)? {
            return Ok(Some(reason));
        }
        // Diagrams: one to the trash waits even when trusted; a rewrite that takes a lot out, when not.
        if let Some(reason) = self.diagram_review_reason(session, op, now)? {
            return Ok(Some(reason));
        }
        match op {
            AgentOp::Edit { .. } => {
                return Ok(Some("A full rewrite always waits for review".to_owned()));
            }
            AgentOp::TagSchema { .. } => {
                return Ok(Some(
                    "A tag schema change always waits for review".to_owned(),
                ));
            }
            AgentOp::Template { .. } => {
                return Ok(Some(
                    "A template made or changed by an agent always waits for review".to_owned(),
                ));
            }
            AgentOp::Trash { path, .. } if path.ends_with(".canvas") => {
                return Ok(Some("Trashing a board always waits for review".to_owned()));
            }
            _ => {}
        }
        if self.trusted(&session.id, now) {
            return Ok(None);
        }
        let limits = self.config().guardrails;
        if let AgentOp::ReplaceSection {
            path,
            heading,
            markdown,
        } = op
        {
            let note = self.vault.read(path)?;
            let body = split(&note.text).body;
            let new = crate::sections::replace_section(body, heading, markdown)?;
            let removed = removed_fraction(body, &new);
            if removed > limits.max_removed_fraction {
                return Ok(Some(format!(
                    "Removes {} of the note's text (the limit is {})",
                    percent(removed),
                    percent(limits.max_removed_fraction)
                )));
            }
        }
        let (trashed, recent) = {
            let state = self.state();
            let tally = state.tallies.get(&session.id).cloned().unwrap_or_default();
            let recent: Vec<String> = tally
                .recent(now.millis, WINDOW_MS)
                .into_iter()
                .map(str::to_owned)
                .collect();
            (tally.trashed, recent)
        };
        if let AgentOp::Trash { path, .. } = op {
            let max = limits.max_trash_per_session as usize;
            let going = self.with_sub_pages(path)?.len();
            if trashed + going > max {
                return Ok(Some(if going > 1 {
                    format!(
                        "With its sub-pages this moves {going} notes to the trash, after {trashed} already (the limit is {max})"
                    )
                } else {
                    format!(
                        "This session already moved {trashed} notes to the trash (the limit is {max})"
                    )
                }));
            }
        }
        let (paths, new) = self.touches(op)?;
        let fresh = paths.iter().filter(|p| !recent.contains(p)).count() + new;
        let max = limits.max_notes_per_session_10min as usize;
        if fresh > 0 && recent.len() + fresh > max {
            return Ok(Some(format!(
                "This session changed {} notes in the last 10 minutes; this would make {} (the limit is {max})",
                recent.len(),
                recent.len() + fresh
            )));
        }
        Ok(None)
    }
}
