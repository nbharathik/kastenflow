//! The vault's change counters. Every change to the vault's files, whoever
//! made it (an op, an agent, another program the watcher noticed), adds one to
//! `all` and one to the counter of each kind of file it touched. Views that
//! depend on a kind of file compare the counter with the one they last
//! loaded under, so they refresh exactly when something they show may have
//! changed. The counters live in memory; `epoch` is when the vault was opened,
//! so counters from two openings never look alike.

use serde::Serialize;

use super::Kasten;
use crate::companions::SUFFIXES;

/// The counters, as the app receives them.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Revision {
    /// When the vault was opened, in milliseconds since the Unix epoch.
    pub epoch: u64,
    /// Every change.
    pub all: u64,
    /// Markdown notes (`*.md`).
    pub notes: u64,
    /// Whiteboards (`*.canvas`).
    pub boards: u64,
    /// Slide decks and diagrams (`*.deck`, `*.drawio`, `*.drawio.svg`).
    pub decks: u64,
    /// Tag schemas (`tags/*.yaml`).
    pub tags: u64,
    /// Bibliographies (`*.bib`).
    pub references: u64,
    /// Saved collections (`views/*.yaml`).
    pub collections: u64,
    /// Comments and text highlights beside a page (`*.comments.json`, `*.highlights.json`).
    pub annotations: u64,
}

/// A kind of file the counters tell apart.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RevisionArea {
    Notes,
    Boards,
    Decks,
    Tags,
    References,
    Collections,
    Annotations,
}

/// The kind of file at a vault path, if it is one the counters follow.
pub fn area_of(path: &str) -> Option<RevisionArea> {
    let lower = path.to_ascii_lowercase();
    let has = |ending: &str| lower.ends_with(ending);
    if SUFFIXES.iter().any(|suffix| has(suffix)) {
        Some(RevisionArea::Annotations)
    } else if has(".md") {
        Some(RevisionArea::Notes)
    } else if has(".canvas") {
        Some(RevisionArea::Boards)
    } else if has(".deck") || has(".drawio") || has(".drawio.svg") {
        Some(RevisionArea::Decks)
    } else if has(".bib") {
        Some(RevisionArea::References)
    } else if lower.starts_with("tags/") && has(".yaml") {
        Some(RevisionArea::Tags)
    } else if lower.starts_with("views/") && has(".yaml") {
        Some(RevisionArea::Collections)
    } else {
        None
    }
}

impl Revision {
    fn add(&mut self, area: RevisionArea) {
        match area {
            RevisionArea::Notes => self.notes += 1,
            RevisionArea::Boards => self.boards += 1,
            RevisionArea::Decks => self.decks += 1,
            RevisionArea::Tags => self.tags += 1,
            RevisionArea::References => self.references += 1,
            RevisionArea::Collections => self.collections += 1,
            RevisionArea::Annotations => self.annotations += 1,
        }
    }
}

impl Kasten {
    /// The counters as they are now.
    pub fn revision(&self) -> Revision {
        self.revisions
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }

    /// Calls `listener` with the new counters after each change, once the
    /// write lock is free again (so it may start another op). Only the first
    /// listener is kept; false when there already was one.
    pub fn on_revision(&self, listener: impl Fn(Revision) + Send + Sync + 'static) -> bool {
        self.listener.set(Box::new(listener)).is_ok()
    }

    /// Counts a change to `paths`: one more for `all` and for each kind of
    /// file among them, and what the file cache knew of them is forgotten.
    /// Nothing is counted for no paths. The listener is not called: whoever
    /// holds the write lock calls `announce` when it lets go.
    pub(super) fn bump(&self, paths: &[String]) -> Revision {
        if paths.is_empty() {
            return self.revision();
        }
        self.forget_files(paths);
        let mut areas: Vec<RevisionArea> = paths.iter().filter_map(|p| area_of(p)).collect();
        areas.sort_unstable_by_key(|a| *a as u8);
        areas.dedup();
        let mut revision = self.revisions.lock().unwrap_or_else(|p| p.into_inner());
        revision.all += 1;
        for area in areas {
            revision.add(area);
        }
        revision.clone()
    }

    /// Tells the listener, if there is one.
    pub(super) fn announce(&self, revision: Revision) {
        // Typing waiting for its commit, a commit waiting for its push, a
        // tidy index: the workers look again.
        self.wake_workers();
        if let Some(listener) = self.listener.get() {
            listener(revision);
        }
    }

    /// `bump` and `announce` for a change made outside the write lock.
    pub(super) fn revised(&self, paths: &[String]) {
        if paths.is_empty() {
            return;
        }
        let revision = self.bump(paths);
        self.announce(revision);
    }
}
