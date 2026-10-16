//! Kasten core: the single owner of every vault read, write, index update and
//! git commit. The desktop app, CLI, MCP server and chat are thin shells over
//! this crate, so guardrails live in exactly one place.
//!
//! It holds the vault model and frontmatter, atomic writes, the ops on notes,
//! boards, tags, sources and highlights, the SQLite index, git history with
//! undo and backup, agent sessions with their guardrails and proposals, and
//! the importers. `Kasten` (engine/) runs every op under one write lock and
//! commits it.

pub mod agent;
pub mod assets;
mod atomic;
pub mod bib;
pub mod board;
pub mod bundle;
pub(crate) mod capture;
pub mod cite;
pub mod clip;
pub mod collections;
pub mod comments;
pub mod companions;
pub mod config;
pub mod dates;
pub mod deck;
pub mod diagrams;
pub mod diff;
mod engine;
mod error;
pub mod extract;
pub mod frontmatter;
#[doc(hidden)]
pub mod generate;
pub mod graph;
pub mod history;
mod id;
pub mod import;
pub mod index;
pub mod links;
pub mod local_paths;
mod lock;
mod loose;
mod marks;
pub mod merge;
mod moving;
mod note;
mod ops;
pub mod props;
mod readable;
mod rename;
pub mod replace;
mod rollback;
mod save;
mod search;
pub mod sections;
mod slug;
pub mod sources;
mod survey;
mod synced;
pub mod tag_query;
pub mod tag_yaml;
pub mod tags;
mod template_vars;
mod templated;
pub mod text_highlights;
mod time;
mod trash;
mod vault;
pub mod vectors;
pub mod watch;

pub use config::Config;
pub use engine::{
    AddedKit, BACKUP_FILES_KEPT, BackupFile, BackupFileRecord, BackupFileStatus, BackupRecord,
    BoardApplied, BoardInfo, Brainstormed, ChangedFile, DeckInfo, Emptied, Idea, Kasten, KitInfo,
    Latest, LatestOutcome, MAX_ASSET_BYTES, MAX_BIB_BYTES, MAX_IDEAS, NoteRef, NoteStats, Outcome,
    Placed, Problem, QUIET_MS, Report, SessionInfo, Tick, UndoConflict, Undone, VaultRestore,
    computer_name, kits,
};
pub use engine::{AppliedSetup, SetupInfo, SetupPlan, SetupTarget, setups};
pub use engine::{DeckEdit, DecksSaved, MAX_SAVE_DECKS, SaveDecksRequest};
pub use engine::{
    Expected, MAX_REPLACE_NOTES, MAX_REPLACEMENTS, NoteMatches, ReplaceRequest, Replaced,
};
pub use engine::{Health, HealthCounts, HistoryHealth, IndexHealth, LastCheck, TrashHealth};
pub use engine::{
    LastUpdate, LatestActivity, NextAction, PROJECT_HEALTHS, PROJECT_STATUSES, ProjectState,
    ProjectSummary, TaskCounts,
};
pub use engine::{MAX_TAGGED, TagAdded};
pub use engine::{Revision, RevisionArea, area_of, shipped_template};
pub use error::{Error, Result};
pub use id::ulid_at;
pub use lock::WriteLock;
pub use marks::AgentMark;
pub use moving::{duplicate_note, move_note, nest_note};
pub use note::{AI_ACTION, NoteFile, NoteMeta, content_hash, wiki_links};
pub use ops::{Kind, NewNote, Saved, create_note, save_body, set_meta, trash_note};
pub use rename::{Renamed, rename_note};
pub use replace::{FindSpec, MatchSample};
pub use search::{Backlink, DayMention, Hit};
pub use slug::slugify;
pub use survey::{Survey, SurveyedVault, survey};
pub use synced::{home_folder, synced_by, synced_warning};
pub use templated::{apply_template, journal_day};
pub use time::Instant;
pub use trash::{Trashed, list_trash, read_trashed, restore_board, restore_deck, restore_note};
pub use vault::{FileStat, Vault};

/// Version of the core crate, shown by every shell so bug reports can name it.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// The name every shell uses for the product in user-facing text.
pub const PRODUCT_NAME: &str = "KastenFlow";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_is_semver_like() {
        let parts: Vec<&str> = VERSION.split('.').collect();
        assert_eq!(parts.len(), 3, "expected MAJOR.MINOR.PATCH, got {VERSION}");
        assert!(parts.iter().all(|p| p.parse::<u64>().is_ok()));
    }

    #[test]
    fn product_name_is_set() {
        assert_eq!(PRODUCT_NAME, "KastenFlow");
    }
}
