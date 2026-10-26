//! The vault's health at a glance: how many files of each kind it holds, how
//! the index, history and backup stand, what waits for review, what is in the
//! trash and when `verify` last ran. A read: it adds up what the engine
//! already knows, commits nothing and writes nothing (`verify` leaves its
//! result in the cache folder, which is where the last check is read from).

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::{BackupFileStatus, Kasten, Report, Revision};
use crate::atomic::write_atomic;
use crate::history::{BackupState, BackupStatus};
use crate::time::Instant;

/// Where `verify` leaves its last result. Derived data: deleting it loses nothing.
pub const CHECK_PATH: &str = ".kasten/cache/verify.json";

/// How many files of each kind the vault holds.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthCounts {
    /// Notes, templates left out.
    pub notes: usize,
    /// Boards the app can open.
    pub boards: usize,
    /// Slide decks, slide templates left out.
    pub decks: usize,
    pub diagrams: usize,
    /// PDFs in `sources/`.
    pub sources: usize,
    /// Pictures in `assets/`.
    pub assets: usize,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexHealth {
    /// Notes the index holds, templates included.
    pub notes: usize,
    /// Files an op wrote that the index could not take yet.
    pub unindexed: usize,
    pub schema: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryHealth {
    pub on: bool,
    /// Edits waiting for their commit.
    pub pending: usize,
    /// Milliseconds since the Unix epoch.
    pub last_commit: Option<u64>,
    /// A git command run by hand is at work: writes wait until it ends.
    pub busy: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashHealth {
    /// Files in the trash that can be put back.
    pub items: usize,
    pub bytes: u64,
}

/// What the last `verify` found, in numbers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastCheck {
    /// Milliseconds since the Unix epoch.
    pub time: u64,
    pub notes: usize,
    pub boards: usize,
    pub decks: usize,
    pub problems: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    /// The change counters now.
    pub revision: Revision,
    pub counts: HealthCounts,
    pub index: IndexHealth,
    pub history: HistoryHealth,
    pub backup: BackupStatus,
    /// The backup files; none while there is no sign of any.
    pub backup_file: Option<BackupFileStatus>,
    /// Proposals waiting for review.
    pub proposals: usize,
    pub trash: TrashHealth,
    /// `(conflict …)` copies a save or a sync left, by path.
    pub conflicts: Vec<String>,
    pub last_check: Option<LastCheck>,
    /// The sync app whose folder holds the vault, if any.
    pub synced: Option<String>,
    /// The vault's format version.
    pub format: u32,
    /// Why `.kasten/config.yaml` as it is on disk is not in force (it does
    /// not parse): the settings from before stay until it is fixed.
    pub config_problem: Option<String>,
}

/// A copy a conflict left: `name (conflict 2026-10-06 09-30).md`, or with a number after the time.
pub(crate) fn is_conflict_copy(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    let Some(at) = name.rfind(" (conflict ") else {
        return false;
    };
    let rest = &name[at + " (conflict ".len()..];
    rest.find(')')
        .is_some_and(|close| rest[close + 1..].starts_with('.') && rest[close + 1..].len() > 1)
}

/// Files and bytes under `dir`, links not followed.
fn weigh(dir: &Path) -> (usize, u64) {
    let (mut files, mut bytes) = (0, 0);
    let Ok(entries) = fs::read_dir(dir) else {
        return (0, 0);
    };
    for entry in entries.flatten() {
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_dir() {
            let (f, b) = weigh(&entry.path());
            files += f;
            bytes += b;
        } else if kind.is_file() {
            files += 1;
            bytes += entry.metadata().map_or(0, |m| m.len());
        }
    }
    (files, bytes)
}

impl Kasten {
    /// How the vault stands. Reads only: whatever cannot be read shows as
    /// empty or off rather than failing the report.
    pub fn health(&self, now: u64) -> Health {
        let walked = self
            .walk_facts(&[".canvas", ".deck", ".drawio"])
            .unwrap_or_default();
        let (indexed, notes) = self.index().note_counts().unwrap_or_default();
        let mut conflicts: Vec<String> = self
            .index()
            .conflict_candidates()
            .unwrap_or_default()
            .into_iter()
            .filter(|p| is_conflict_copy(p))
            .collect();
        conflicts.extend(
            walked
                .boards
                .iter()
                .map(|(f, _)| &f.path)
                .chain(walked.decks.iter().map(|(f, _)| &f.path))
                .filter(|p| is_conflict_copy(p))
                .cloned(),
        );
        conflicts.sort();
        let assets = super::asset_files::walk(&self.vault)
            .iter()
            .filter(|f| slides_assets::is_picture_name(f.rel.rsplit('/').next().unwrap_or(&f.rel)))
            .count();
        let sources = self
            .vault
            .files_in("sources", ".pdf")
            .map_or(0, |found| found.len());
        let (items, bytes) = weigh(&self.vault.root().join(".trash"));
        let backup = self.backup_status(now);
        let backup_file = Some(self.backup_file_status(now))
            .filter(|status| status.state != BackupState::Off || status.last_written.is_some());
        let last_commit = self
            .history
            .get()
            .and_then(|history| history.log(None, 1).ok())
            .and_then(|log| log.first().map(|c| c.time));
        // Each lock is taken and let go on its own line: a guard held across the
        // struct below would meet itself in the next call that takes the same lock.
        let unindexed = self.state().unindexed.len();
        let schema = self.index().schema();
        let pending = self.pending_edits().len();
        Health {
            revision: self.revision(),
            counts: HealthCounts {
                notes,
                boards: walked.boards.len(),
                decks: walked
                    .decks
                    .iter()
                    .filter(|(f, _)| !crate::deck::is_template(&f.path))
                    .count(),
                diagrams: walked.diagrams.len(),
                sources,
                assets,
            },
            index: IndexHealth {
                notes: indexed,
                unindexed,
                schema,
            },
            history: HistoryHealth {
                on: self.has_history(),
                pending,
                last_commit,
                busy: self
                    .history
                    .get()
                    // A look, never a clean-up: only an op that holds the write
                    // lock may remove a lock file.
                    .is_some_and(|history| history.held_by_readonly().is_some()),
            },
            backup,
            backup_file,
            proposals: self.proposals().map_or(0, |p| p.len()),
            trash: TrashHealth { items, bytes },
            conflicts,
            last_check: self.last_check(),
            synced: crate::synced_by(self.root(), crate::home_folder().as_deref())
                .map(str::to_owned),
            format: self.config().format,
            config_problem: self.config_problem(),
        }
    }

    /// What the last `verify` left in the cache, if it left anything readable.
    pub fn last_check(&self) -> Option<LastCheck> {
        let text = fs::read_to_string(self.vault.root().join(CHECK_PATH)).ok()?;
        serde_json::from_str(&text).ok()
    }

    /// Keeps the numbers of a `verify` in the cache. Best effort: a check that
    /// cannot be remembered is still a check.
    pub(super) fn remember_check(&self, report: &Report) {
        let check = LastCheck {
            time: Instant::now().millis,
            notes: report.notes,
            boards: report.boards,
            decks: report.decks,
            problems: report.problems.len(),
        };
        let file = self.vault.root().join(CHECK_PATH);
        if let (Some(dir), Ok(json)) = (file.parent(), serde_json::to_vec(&check)) {
            let _ = fs::create_dir_all(dir);
            let _ = write_atomic(&file, &json);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conflict_copies_are_told_by_their_names() {
        for yes in [
            "library/a (conflict 2026-10-06 09-30).md",
            "projects/p/boards/b (conflict 2026-10-06 09-30 2).canvas",
            "x (conflict 2026-10-06 09-30).deck",
        ] {
            assert!(is_conflict_copy(yes), "{yes}");
        }
        for no in [
            "library/a.md",
            "library/(conflict).md",
            "library/a (conflict 2026).",
            "conflict/a.md",
            "a (conflicted copy).md",
        ] {
            assert!(!is_conflict_copy(no), "{no}");
        }
    }
}
