//! Getting the latest from the backup. Its history is fetched outside the
//! write lock; then, under it, taken as a fast-forward when only the other
//! computer wrote, or joined with this computer's when both did (merging).
//!
//! - Waiting typing and outside changes are committed first, so they are
//!   joined like any other edit.
//! - Files are written one by one, atomically, only where they are
//!   unchanged since the last commit, and none when one is in the way
//!   (`latest_apply`).
//! - The branch moves only while it is still where it was.
//! - A journal lets a Get latest stopped part way be finished.
//!
//! Nothing is reset, overwritten or force-pushed.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::Kasten;
use super::latest_apply::Stopped;
use crate::error::{Error, Result};
use crate::frontmatter::{Front, join, set_key, split};
use crate::history::{History, merging::unrelated, redacted};
use crate::id::ulid_at;
use crate::ops::eol_of;
use crate::time::Instant;

const JOURNAL: &str = ".kasten/cache/get-latest.json";

/// What Get latest did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LatestOutcome {
    /// Nothing new in the backup: it holds nothing this vault lacks.
    UpToDate,
    /// Only the other computer wrote: its commits were taken as they are.
    FastForward,
    /// Both wrote: the two lines of history were joined.
    Merged,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Latest {
    pub outcome: LatestOutcome,
    pub head: Option<String>,
    /// Files that changed in this vault.
    pub changed: Vec<String>,
    /// Copies of the other computer's versions kept beside this one's.
    pub copies: Vec<String>,
    /// The other computer's settings and tag schemas set aside under
    /// `.kasten/conflicts/`.
    pub set_aside: Vec<String>,
}

impl Latest {
    fn nothing(head: Option<String>) -> Latest {
        Latest {
            outcome: LatestOutcome::UpToDate,
            head,
            changed: Vec::new(),
            copies: Vec::new(),
            set_aside: Vec::new(),
        }
    }
}

/// A Get latest under way, written before any file is.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Journal {
    ours: String,
    theirs: String,
    tree: String,
    merge: bool,
    copies: Vec<String>,
    set_aside: Vec<String>,
}

impl Kasten {
    fn read_journal(&self) -> Option<Journal> {
        let text = fs::read_to_string(self.root().join(JOURNAL)).ok()?;
        serde_json::from_str(&text).ok()
    }

    fn write_journal(&self, journal: &Journal) -> Result<()> {
        let text =
            serde_json::to_string_pretty(journal).map_err(|e| Error::Invalid(e.to_string()))?;
        crate::atomic::write_atomic(&self.root().join(JOURNAL), text.as_bytes())?;
        Ok(())
    }

    fn clear_journal(&self) {
        // Kasten's own note of work under way, in its cache.
        let _ = fs::remove_file(self.root().join(JOURNAL));
    }

    /// Whether a Get latest was stopped part way and waits to be finished.
    pub fn unfinished_get_latest(&self) -> bool {
        self.root().join(JOURNAL).is_file()
    }

    /// Gets the latest from the backup remote confirmed on this computer.
    pub fn get_latest(&self, now: Instant) -> Result<Latest> {
        let history = self.history_or_err()?;
        let url = self.confirmed_remote().ok_or_else(|| {
            Error::Invalid("No backup is set up on this computer to get the latest from".into())
        })?;
        let token = self.git_token();
        self.finish_get_latest(now)?;
        // The network, outside the write lock: typing goes on meanwhile.
        let fetched = history
            .fetch_latest(&url, token.as_ref())
            .map_err(|err| redacted(err, token.as_ref()))?;
        match fetched {
            Some(theirs) => self.take_latest(history, &theirs, now),
            None => Ok(Latest::nothing(history.head())),
        }
    }

    /// Gets the latest from a backup file, as from a remote.
    pub fn get_latest_from_file(&self, bundle: &Path, now: Instant) -> Result<Latest> {
        let history = self.history_or_err()?;
        self.finish_get_latest(now)?;
        let theirs = history.fetch_bundle(bundle)?;
        self.take_latest(history, &theirs, now)
    }

    fn take_latest(&self, history: &History, theirs: &str, now: Instant) -> Result<Latest> {
        let done = self.lock.hold(|| {
            if let Some(lock) = history.held_by() {
                return Err(History::busy_error(&lock));
            }
            self.commit_edits_held(history)?;
            self.commit_external_held(history)?;
            let ours = history
                .head()
                .ok_or_else(|| Error::Invalid("This vault's history has no commit yet".into()))?;
            if ours == theirs || history.holds(&ours, theirs) {
                return Ok(Latest::nothing(Some(ours)));
            }
            if !history.related(&ours, theirs)? {
                return Err(unrelated());
            }
            let journal = if history.holds(theirs, &ours) {
                Journal {
                    tree: history.tree_of(theirs)?,
                    ours,
                    theirs: theirs.to_owned(),
                    merge: false,
                    copies: Vec::new(),
                    set_aside: Vec::new(),
                }
            } else {
                let label = format!("from other computer {}", now.file_stamp());
                let joined = history.join(&ours, theirs, &label, &mut || ulid_at(now.millis))?;
                let tree = self.fresh_ids(history, &ours, &joined.tree, &joined.copies, now)?;
                Journal {
                    tree,
                    ours,
                    theirs: theirs.to_owned(),
                    merge: true,
                    copies: joined.copies,
                    set_aside: joined.set_aside,
                }
            };
            self.write_journal(&journal)?;
            self.write_latest(history, &journal, true)?;
            if std::mem::take(&mut self.state().stop_before_branch) {
                return Err(Error::Invalid(
                    "Stopped before the branch moved, as asked".into(),
                ));
            }
            self.complete_latest(history, &journal, now)
        });
        // The files it brought are counted once the write lock is free.
        if let Ok(latest) = &done {
            self.revised(&latest.changed);
        }
        done
    }

    /// Writes the journal's tree into the folder. When a file is in the way
    /// on a first try, nothing was written and the journal goes; once
    /// files may have been written, it stays until the Get latest is
    /// finished.
    fn write_latest(&self, history: &History, journal: &Journal, first: bool) -> Result<()> {
        let ours = history.tree_of(&journal.ours)?;
        match self.apply_latest(history, &ours, &journal.tree) {
            Ok(()) => Ok(()),
            Err(Stopped::InTheWay(err)) => {
                if first {
                    self.clear_journal();
                }
                Err(err)
            }
            Err(Stopped::PartWay(err)) => Err(Error::Invalid(format!(
                "Getting the latest stopped part way ({err}). Nothing is lost: once that is fixed, finish getting the latest"
            ))),
        }
    }

    /// Moves the branch to what the journal says, then indexes the files
    /// that changed.
    fn complete_latest(
        &self,
        history: &History,
        journal: &Journal,
        now: Instant,
    ) -> Result<Latest> {
        let head = if journal.merge {
            history.commit_join(
                &journal.tree,
                &journal.ours,
                &journal.theirs,
                "latest: joined with the other computer's changes",
                &[("Kasten-Op", "get_latest".to_owned())],
            )?
        } else {
            history.advance_branch(&journal.ours, &journal.theirs, "latest: from the backup")?;
            journal.theirs.clone()
        };
        self.clear_journal();
        self.state().backup.behind = false;
        let changed = history.changed_between(&history.tree_of(&journal.ours)?, &journal.tree)?;
        self.refresh_or_later(&changed);
        self.state().last_commit = Some(now.millis);
        Ok(Latest {
            outcome: if journal.merge {
                LatestOutcome::Merged
            } else {
                LatestOutcome::FastForward
            },
            head: Some(head),
            changed,
            copies: journal.copies.clone(),
            set_aside: journal.set_aside.clone(),
        })
    }

    /// Finishes a Get latest stopped part way, if there is one: the files
    /// it had not written yet are written, where unchanged since, and the
    /// branch moves. If the branch moved on meanwhile, that one is over.
    pub fn finish_get_latest(&self, now: Instant) -> Result<Option<Latest>> {
        let Some(journal) = self.read_journal() else {
            return Ok(None);
        };
        let history = self.history_or_err()?;
        let done = self.lock.hold(|| {
            if history.head().as_deref() != Some(journal.ours.as_str()) {
                self.clear_journal();
                return Ok(None);
            }
            self.write_latest(history, &journal, false)?;
            self.complete_latest(history, &journal, now).map(Some)
        });
        if let Ok(Some(latest)) = &done {
            self.revised(&latest.changed);
        }
        done
    }

    /// Gives a new id to each note the other computer added whose id a
    /// note of this vault already has, as happens when both moved the same
    /// note to different places. Answers the tree to write.
    fn fresh_ids(
        &self,
        history: &History,
        ours: &str,
        tree: &str,
        copies: &[String],
        now: Instant,
    ) -> Result<String> {
        let ours_tree = history.tree_of(ours)?;
        let mut rewrites: Vec<(String, Vec<u8>)> = Vec::new();
        for path in history.changed_between(&ours_tree, tree)? {
            if !path.ends_with(".md")
                || copies.contains(&path)
                || history.blob_in_tree(&ours_tree, &path)?.is_some()
            {
                continue;
            }
            let Some(bytes) = history.blob_in_tree(tree, &path)? else {
                continue;
            };
            let Ok(text) = String::from_utf8(bytes) else {
                continue;
            };
            let parts = split(&text);
            let Some(id) = Front::text(&Front::read(parts.prefix).id) else {
                continue;
            };
            let Some(other) = self.index().by_id(&id)? else {
                continue;
            };
            if other != path && history.blob_in_tree(tree, &other)?.is_some() {
                let eol = eol_of(&text);
                let prefix = set_key(parts.prefix, "id", Some(&ulid_at(now.millis)), eol);
                rewrites.push((path, join(&prefix, parts.body, eol).into_bytes()));
            }
        }
        if rewrites.is_empty() {
            return Ok(tree.to_owned());
        }
        history.replace_in_tree(tree, &rewrites)
    }

    /// Stops the next Get latest after its files are written and before
    /// the branch moves, as a crash would: for testing that it finishes.
    #[doc(hidden)]
    pub fn stop_get_latest_before_the_branch_moves(&self) {
        self.state().stop_before_branch = true;
    }
}
