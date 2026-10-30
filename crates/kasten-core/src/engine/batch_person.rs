//! A batch a person runs from the app: many changes that are all made or none,
//! as one commit that one Undo takes back (table bulk actions, a pasted block
//! of cells, "Turn into database"). It is the agent batch's engine
//! (batch_apply.rs: one hold of the write lock, every change checked again as
//! the ones before it left the vault, a failure puts back the files the batch
//! wrote) under the rules of a person:
//!
//! - the same limits (100 changes, 1 MB of text) and the same changes a batch
//!   may hold (`batch::BATCHABLE`), and a change may name a note an earlier one
//!   makes (`batch::refs`);
//! - no agent guardrail: a person is not held by the soft limits, a locked
//!   page is theirs to change as it is for every other change they make, and
//!   nothing waits for review or takes a checkpoint;
//! - what no one writes stays refused: the vault's own folders (`.kasten`,
//!   `.git`, the trash) and any path that is not a plain note path. One such
//!   change refuses the whole batch.
//!
//! An agent never reaches this: its batches go through `agent_run`, which
//! holds them to the agent's guardrails, and `execute_batch` refuses a batch
//! with no agent behind it.

use serde::Serialize;
use serde_json::Value;

use super::Kasten;
use super::batch_apply::Guard;
use crate::agent::AgentOp;
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::time::Instant;
use crate::vault::aliases_on_windows;

/// What a person's batch did.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PersonBatch {
    /// How many changes were made.
    pub changes: usize,
    /// What each change answered, in order: a made note is `{path, id, title}`.
    pub results: Vec<Value>,
    /// The one commit that made them; `undo_commit` takes it back. None when
    /// the changes left every file as it was.
    pub commit: Option<String>,
}

/// Refuses a path that is in the vault's own folders or is not a plain note
/// path, however it is spelled.
fn plain_path(path: &str) -> Result<()> {
    let own = |part: &str| part.starts_with('.');
    if path.split('/').any(own) {
        return Err(Error::Invalid(format!(
            "{path} is in a folder KastenFlow keeps for itself (such as .kasten or .git), which a batch never writes"
        )));
    }
    if path.contains(['\\', ':', '\0'])
        || path.starts_with('/')
        || (cfg!(windows) && path.split('/').any(aliases_on_windows))
    {
        return Err(Error::InvalidPath(path.to_owned()));
    }
    Ok(())
}

/// Every path an op names, to be checked by form before it runs. A reference
/// to a note an earlier change makes is no path yet: it is checked once it is
/// put by the note's path.
pub(super) fn named(op: &AgentOp) -> Vec<&str> {
    let mut paths: Vec<&str> = op.path().into_iter().collect();
    match op {
        AgentOp::CreateNote { parent, .. } | AgentOp::SetParent { parent, .. } => {
            paths.extend(parent.as_deref());
        }
        AgentOp::AddToBoard { notes, .. } => paths.extend(notes.iter().map(String::as_str)),
        _ => {}
    }
    paths.retain(|p| !p.starts_with(crate::batch::refs::PREFIX));
    paths
}

impl Kasten {
    /// Makes `ops` as one batch, as the person: all or none, one commit
    /// (`Kasten-Op: batch`, `Kasten-Batch: <count>`) that one undo takes back,
    /// and the whole batch refused when any change is. `reason` is the
    /// commit's summary when given. The batch needs the vault's history.
    pub fn batch_as_person(
        &self,
        ops: &[AgentOp],
        reason: Option<&str>,
        now: Instant,
    ) -> Result<PersonBatch> {
        let (value, commit) = self.run_batch(&Actor::Human, ops, now, Guard::Person, reason)?;
        let results = match value.get("results") {
            Some(Value::Array(results)) => results.clone(),
            _ => Vec::new(),
        };
        Ok(PersonBatch {
            changes: ops.len(),
            results,
            commit,
        })
    }

    /// What no person writes through a batch: the vault's own folders, and a
    /// path that is no note's. (Locked pages are not here: the lock keeps
    /// agents out, and a person's other changes are not held by it.)
    pub(super) fn person_refusals(&self, op: &AgentOp) -> Result<()> {
        named(op).into_iter().try_for_each(plain_path)
    }

    /// Refuses a path spelled with other capitals than the file's own. On
    /// Windows and macOS it names the same file, but History knows the file
    /// only by its own spelling, so a failed batch would take the file for one
    /// it had just made and remove it instead of putting it back.
    pub(super) fn spelled_as_on_disk(&self, op: &AgentOp) -> Result<()> {
        for path in named(op) {
            self.check_spelling(path)?;
        }
        Ok(())
    }

    /// `spelled_as_on_disk` for one path.
    pub(super) fn check_spelling(&self, path: &str) -> Result<()> {
        let mut dir = self.vault.root().to_path_buf();
        for part in path.split('/') {
            let Ok(entries) = std::fs::read_dir(&dir) else {
                break; // not a folder yet: nothing there to be spelled otherwise
            };
            let lower = part.to_lowercase();
            let (mut exact, mut other) = (false, None);
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if name == part {
                    exact = true;
                    break;
                }
                let same = if part.is_ascii() && name.is_ascii() {
                    name.eq_ignore_ascii_case(part)
                } else {
                    name.to_lowercase() == lower
                };
                if other.is_none() && same {
                    other = Some(name);
                }
            }
            if let Some(real) = other.filter(|_| !exact) {
                return Err(Error::Invalid(format!(
                    "{path} is spelled with other capitals than the file it names (“{real}”). Use the path as it is"
                )));
            }
            dir.push(part);
        }
        Ok(())
    }

    /// The rules that belong to a batch, for an agent's and a person's alike.
    pub(super) fn batch_rules(&self, op: &AgentOp) -> Result<()> {
        self.spelled_as_on_disk(op)?;
        match op {
            // A batch makes the schema of a tag that has none; it never
            // replaces one (that is a change of its own, one a person sees).
            AgentOp::TagSchema { tag, .. } => {
                let name = tag.trim().trim_start_matches('#').trim();
                let path = crate::tags::tag_file(name)?;
                let by_name = self
                    .tag_schemas()?
                    .iter()
                    .any(|s| s.name.eq_ignore_ascii_case(name));
                let by_file = self
                    .vault
                    .file_of(&path, &[".yaml"])
                    .is_ok_and(|file| file.exists());
                if by_name || by_file {
                    return Err(Error::Invalid(format!(
                        "The tag “{name}” already has a schema, and a batch only makes the schema of a tag that has none. Change its properties and views on their own"
                    )));
                }
                Ok(())
            }
            AgentOp::SetViewOrder { tag, view, ids } => {
                self.check_view_order(tag, view, ids).map(|_| ())
            }
            _ => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_agent_path_does_not_run_a_batch_that_has_no_agent_behind_it() {
        let dir = std::env::temp_dir().join(format!(
            "kasten-person-batch-{}",
            crate::ulid_at(Instant::now().millis)
        ));
        let kasten = Kasten::init(&dir, "Batch").unwrap();
        let before = kasten.list().unwrap().len();
        let ops = [AgentOp::Capture {
            markdown: "A card.".into(),
            tags: vec![],
        }];
        // The agent path (`execute` of a Batch op, what `agent_run` ends in)
        // refuses the person as actor: a person's batch is `batch_as_person`.
        let err = kasten
            .execute(
                &Actor::Human,
                &AgentOp::Batch {
                    ops: ops.to_vec(),
                    reason: None,
                },
                Instant::now(),
            )
            .unwrap_err();
        assert!(err.to_string().contains("batch_as_person"), "{err}");
        assert_eq!(kasten.list().unwrap().len(), before, "nothing was made");
        drop(kasten);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_new_tags_file_is_where_its_schema_will_be_written() {
        use crate::tags::tag_file;
        for (tag, file) in [
            ("books", "tags/books.yaml"),
            ("#Reading List", "tags/reading-list.yaml"),
            ("my_books", "tags/my-books.yaml"),
            ("trips/2026", "tags/trips-2026.yaml"),
            ("Überlegungen", "tags/überlegungen.yaml"),
        ] {
            assert_eq!(tag_file(tag).unwrap(), file, "{tag}");
        }
        assert!(tag_file("***").is_err() && tag_file(" # ").is_err());
    }

    #[test]
    fn the_vaults_own_folders_are_never_named() {
        for path in [
            ".kasten/config.yaml",
            ".git/HEAD",
            ".Git/config",
            ".KASTEN/x.md",
            ".trash/a.md",
            "library/.hidden/a.md",
            "a/../b.md",
            "..",
            "a\\b.md",
            "C:/x.md",
            "/etc/x.md",
        ] {
            assert!(plain_path(path).is_err(), "{path}");
        }
        for path in ["library/a.md", "projects/x/pages/b.md", "tags/task.yaml"] {
            assert!(plain_path(path).is_ok(), "{path}");
        }
    }
}
