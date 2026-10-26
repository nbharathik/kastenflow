//! Agent sessions in history, and undoing one: its commits are reverted
//! newest first as new commits. A later edit to the same lines stops the
//! undo and is reported, never overwritten.
//! One commit, such as an import, is undone the same way.

use std::collections::{BTreeMap, HashSet};
use std::fs;

use serde::Serialize;

use super::{Change, Kasten};
use crate::atomic::write_atomic;
use crate::deck;
use crate::error::{Error, Result};
use crate::history::{Actor, CommitInfo, History};
use crate::merge::merge3;
use crate::time::Instant;

/// How far back history is searched for a session's commits.
const LOOK_BACK: usize = 20_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub client: String,
    /// First and last commit, in milliseconds since the Unix epoch.
    pub started: u64,
    pub last: u64,
    pub commits: usize,
    /// Every commit of the session has been undone.
    pub undone: bool,
}

/// A commit an undo could not revert without losing a later edit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoConflict {
    pub commit: String,
    pub summary: String,
    pub path: String,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Undone {
    /// The session's commits now reverted, newest first.
    pub reverted: Vec<String>,
    pub conflict: Option<UndoConflict>,
}

/// One file a commit changed, as text for showing a diff.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub before: Option<String>,
    pub after: Option<String>,
}

fn text(bytes: &[u8]) -> Option<&str> {
    std::str::from_utf8(bytes).ok()
}

impl Kasten {
    /// The files a commit changed, before and after (binary files as None).
    pub fn commit_changes(&self, rev: &str) -> Result<Vec<ChangedFile>> {
        let Some(history) = self.history.get() else {
            return Ok(Vec::new());
        };
        let as_text = |b: Option<Vec<u8>>| b.and_then(|b| String::from_utf8(b).ok());
        Ok(history
            .changes(rev)?
            .into_iter()
            .map(|c| ChangedFile {
                path: c.path,
                before: as_text(c.before),
                after: as_text(c.after),
            })
            .collect())
    }

    /// Agent sessions, newest first.
    pub fn sessions(&self, limit: usize) -> Result<Vec<SessionInfo>> {
        let log = self.log(None, LOOK_BACK)?;
        let undone: HashSet<&str> = log.iter().filter_map(|c| c.undoes.as_deref()).collect();
        let mut by: BTreeMap<&str, SessionInfo> = BTreeMap::new();
        for commit in log.iter().filter(|c| c.agent) {
            let Some(id) = commit.session.as_deref() else {
                continue;
            };
            let client = commit
                .author
                .strip_prefix("agent:")
                .unwrap_or(&commit.author);
            let entry = by.entry(id).or_insert_with(|| SessionInfo {
                id: id.to_owned(),
                client: client.to_owned(),
                started: commit.time,
                last: commit.time,
                commits: 0,
                undone: true,
            });
            entry.commits += 1;
            entry.started = entry.started.min(commit.time);
            entry.last = entry.last.max(commit.time);
            entry.undone &= undone.contains(commit.id.as_str());
        }
        let mut out: Vec<SessionInfo> = by.into_values().collect();
        out.sort_by(|a, b| b.last.cmp(&a.last).then(b.id.cmp(&a.id)));
        out.truncate(limit);
        Ok(out)
    }

    /// Reverts a session's commits newest first, one new commit each.
    pub fn undo_session(&self, session: &str, now: Instant) -> Result<Undone> {
        self.undo_session_with(session, now, &[])
    }

    /// `undo_session`, its commits carrying the extra trailers `by`: how an
    /// agent's undo says whose it was, since the revert itself is committed as
    /// the person's (it never joins the session it takes back).
    pub(super) fn undo_session_with(
        &self,
        session: &str,
        now: Instant,
        by: &[(&str, String)],
    ) -> Result<Undone> {
        let history = self.history_for_undo()?;
        let log = self.log(None, LOOK_BACK)?;
        let done: HashSet<String> = log.iter().filter_map(|c| c.undoes.clone()).collect();
        let commits: Vec<_> = log
            .into_iter()
            // Only an agent's commit belongs to a session, as in the digest: a
            // trailer in a person's commit never makes it one to take back.
            .filter(|c| c.agent && c.session.as_deref() == Some(session) && !done.contains(&c.id))
            .collect();
        let mut reverted = Vec::new();
        for commit in commits {
            if let Some(conflict) = self.revert(history, &commit, now, by)? {
                return Ok(Undone {
                    reverted,
                    conflict: Some(conflict),
                });
            }
            reverted.push(commit.id);
        }
        Ok(Undone {
            reverted,
            conflict: None,
        })
    }

    /// Reverts one commit, such as an import, as a new commit.
    pub fn undo_commit(&self, rev: &str, now: Instant) -> Result<Undone> {
        let history = self.history_for_undo()?;
        let commit = history
            .commit_info(rev)
            .map_err(|_| Error::Invalid(format!("No change {rev} in this vault's history")))?;
        // Its changes against one side are the other side's whole history.
        if commit.merge {
            return Err(Error::Invalid(format!(
                "“{}” joins two lines of history, so it can't be undone as one change. Restore the vault to a point before it instead.",
                commit.summary
            )));
        }
        let log = self.log(None, LOOK_BACK)?;
        if log
            .iter()
            .any(|c| c.undoes.as_deref() == Some(commit.id.as_str()))
        {
            return Err(Error::Invalid(format!(
                "“{}” is already undone",
                commit.summary
            )));
        }
        if let Some(conflict) = self.revert(history, &commit, now, &[])? {
            return Ok(Undone {
                reverted: Vec::new(),
                conflict: Some(conflict),
            });
        }
        Ok(Undone {
            reverted: vec![commit.id],
            conflict: None,
        })
    }

    fn history_for_undo(&self) -> Result<&History> {
        self.history.get().ok_or_else(|| {
            Error::Invalid("This vault keeps no history, so there is nothing to undo".to_owned())
        })
    }

    /// Takes one commit's changes out as a new commit, keeping later edits
    /// to other lines. A later edit on the same lines is a conflict, and
    /// then nothing is written.
    fn revert(
        &self,
        history: &History,
        commit: &CommitInfo,
        now: Instant,
        by: &[(&str, String)],
    ) -> Result<Option<UndoConflict>> {
        let changes = history.changes(&commit.id)?;
        let mut trailers = vec![("Kasten-Undo", commit.id.clone())];
        trailers.extend(by.iter().cloned());
        let conflict = self.apply_with(
            &Actor::Human,
            "undo",
            false,
            now.millis,
            &trailers,
            |vault| {
                let root = vault.root();
                // Every path is checked before anything is read or written.
                let files = changes
                    .iter()
                    .map(|c| vault.tracked_file(&c.path))
                    .collect::<Result<Vec<_>>>()?;
                let mut writes: Vec<(String, Option<Vec<u8>>)> = Vec::new();
                for (change, file) in changes.iter().zip(&files) {
                    let current = crate::atomic::read_if_there(file)?;
                    if current == change.before {
                        continue;
                    }
                    if current == change.after {
                        writes.push((change.path.clone(), change.before.clone()));
                        continue;
                    }
                    // Edited since: take the commit's change out, keep the later edit.
                    let merged = match (&change.before, &change.after, &current) {
                        (Some(b), Some(a), Some(c)) => match (text(b), text(a), text(c)) {
                            (Some(b), Some(a), Some(c)) => merge3(a, c, b),
                            _ => None,
                        },
                        _ => None,
                    };
                    let stops = |detail: &str| -> Result<Change<Option<UndoConflict>>> {
                        Ok(Change {
                            value: Some(UndoConflict {
                                commit: commit.id.clone(),
                                summary: commit.summary.clone(),
                                path: change.path.clone(),
                                detail: detail.to_owned(),
                            }),
                            paths: Vec::new(),
                            message: String::new(),
                        })
                    };
                    match merged {
                        Some(m) => {
                            // Lines that merge cleanly can still make a deck the
                            // tools cannot open (a section left without its slide).
                            if change.path.ends_with(".deck")
                                && let Some(why) = deck::structure_problem(&m)
                            {
                                return stops(&format!(
                                    "It was edited after this change, and taking the change out would leave a deck that is not usable: {why}"
                                ));
                            }
                            writes.push((change.path.clone(), Some(m.into_bytes())));
                        }
                        None => {
                            return stops(match current {
                                None => "It was moved or trashed after this change",
                                Some(_) => "It was edited on the same lines after this change",
                            });
                        }
                    }
                }
                for (path, bytes) in &writes {
                    let full = vault.tracked_file(path)?;
                    match bytes {
                        Some(bytes) => {
                            if let Some(dir) = full.parent() {
                                fs::create_dir_all(dir)?;
                            }
                            write_atomic(&full, bytes)?;
                        }
                        // The commit made this file and nothing changed it
                        // since; its text stays in that commit. Folders it
                        // leaves empty go too.
                        None => {
                            fs::remove_file(&full)?;
                            let mut dir = full.parent();
                            while let Some(d) = dir.filter(|d| *d != root) {
                                if fs::remove_dir(d).is_err() {
                                    break;
                                }
                                dir = d.parent();
                            }
                        }
                    }
                }
                Ok(Change {
                    value: None,
                    paths: writes.into_iter().map(|(p, _)| p).collect(),
                    message: format!("undo: {}", commit.summary),
                })
            },
        )?;
        if conflict.is_some() {
            return Ok(conflict);
        }
        // Already reverted by later changes: record the undo anyway, so the
        // commit reads as undone.
        if history.commit_info("HEAD")?.undoes.as_deref() != Some(commit.id.as_str()) {
            self.lock.hold(|| {
                history.commit_marker(
                    &format!("undo: {}", commit.summary),
                    &Actor::Human,
                    "undo",
                    &trailers,
                )
            })?;
        }
        Ok(None)
    }
}
