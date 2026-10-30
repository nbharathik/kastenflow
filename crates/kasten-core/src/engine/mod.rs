//! The engine every shell drives: the app, the
//! CLI and the MCP server call these methods, never the file system. Each
//! write takes the vault's write lock, applies one op, updates the index
//! and commits to git. Human typing is batched into one commit after a
//! quiet spell; agent ops commit at once.

mod agent;
mod agent_assets;
mod agent_checkpoints;
mod agent_policy;
mod agent_refusals;
mod agent_review;
mod ai_actions;
mod annotations;
mod asset_add;
mod asset_files;
mod asset_meta;
mod asset_thumbs;
mod asset_usage;
mod assets;
mod backup_check;
mod backup_extra;
mod backup_file;
mod backup_link;
mod backup_now;
mod backup_pull;
mod batch_apply;
mod batch_decide;
mod batch_person;
mod batch_rollback;
mod bibliography;
mod board_stats;
mod boards;
mod brainstorm;
mod bundles;
mod collections;
mod commits;
mod create;
mod deck_agent;
mod deck_limits;
mod decks;
mod diagram_agent;
mod diagram_edit;
mod diagram_picture;
mod diagrams;
mod digest;
mod edit;
mod empty_trash;
mod execute;
mod file_cache;
mod formula_rows;
mod graph;
mod health;
mod highlight_cards;
mod init;
mod kits;
mod latest;
mod latest_apply;
mod latex_agent;
mod latex_cite;
mod latex_docs;
mod latex_export;
mod latex_figures;
mod latex_files;
mod latex_more;
mod latex_preview;
mod latex_send;
mod latex_send_agent;
mod latex_source;
mod latex_tools;
mod link_checks;
mod links;
mod live_config;
mod marks;
mod ops;
mod page_edit;
mod parity;
mod parity_refusals;
mod parity_words;
mod placing;
mod plugin_state;
mod project_summaries;
mod projects;
mod push;
mod reads;
mod references;
mod replace;
mod restore;
mod review;
mod review_hunks;
mod revision;
mod setup_agent;
mod setup_manage;
mod setup_plan;
mod setup_save;
mod setup_save_manifest;
mod setup_save_plan;
mod setup_saved;
mod setup_skeleton;
mod setups;
mod smart;
mod smart_agent;
mod smart_author;
mod smart_create;
mod smart_history;
mod smart_request;
mod smart_search;
mod smart_switch;
mod smart_template;
pub use smart_author::{MadeSmart, NewSmartPage};
pub use smart_switch::{PROJECT_KEY as SMART_PROJECT_KEY, ProjectSmart, SMART_PLUGIN};
pub use smart_template::{SavedSmartTemplate, SmartTemplate, SmartTemplateInfo};
mod sources;
mod stage;
mod state;
mod structure;
mod structure_agent;
mod tag_lists;
mod tag_many;
mod undo;
mod verify;
mod verify_names;
mod view_order;
mod wake;

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock, RwLock};

use file_cache::FileCache;
use state::State;

use crate::config::{Config, FORMAT};
use crate::error::{Error, Result};
use crate::history::{Actor, History};
use crate::index::Index;
use crate::lock::WriteLock;
use crate::vault::Vault;

pub use agent::{NoteRef, Outcome};
pub use assets::MAX_ASSET_BYTES;
pub use backup_file::{
    BackupFile, BackupFileRecord, BackupFileStatus, KEEP as BACKUP_FILES_KEPT, computer_name,
};
pub use batch_person::PersonBatch;
pub use board_stats::NoteStats;
pub use boards::{BoardApplied, BoardInfo};
pub use brainstorm::{Brainstormed, Idea, MAX_IDEAS};
pub use commits::Tick;
pub use decks::{DeckEdit, DeckInfo, DecksSaved, MAX_SAVE_DECKS, SaveDecksRequest};
pub use diagram_picture::DiagramPicture;
pub use digest::{Digest, DigestSession};
pub use empty_trash::Emptied;
pub use health::{Health, HealthCounts, HistoryHealth, IndexHealth, LastCheck, TrashHealth};
pub use init::shipped_template;
pub use kits::{AddedKit, KitInfo, kits};
pub use latest::{Latest, LatestOutcome};
pub use placing::Placed;
pub use project_summaries::{LastUpdate, LatestActivity, NextAction, ProjectSummary, TaskCounts};
pub use projects::{HEALTHS as PROJECT_HEALTHS, ProjectState, STATUSES as PROJECT_STATUSES};
pub use push::BackupRecord;
pub use references::MAX_BIB_BYTES;
pub use replace::{
    Expected, MAX_REPLACE_NOTES, MAX_REPLACEMENTS, NoteMatches, ReplaceRequest, Replaced,
};
pub use restore::VaultRestore;
pub use revision::{Revision, RevisionArea, area_of};
pub use setup_manage::SetupGone;
pub use setup_save::{SavedSetup, SetupPage, SetupSource};
pub use setups::{AppliedSetup, SetupInfo, SetupPlan, SetupTarget, setups};
pub use structure::NewProject;
pub use tag_many::{MAX_TAGGED, TagAdded};
pub use undo::{ChangedFile, SessionInfo, UndoConflict, Undone};
pub use verify::{Problem, Report};

pub const INDEX_PATH: &str = ".kasten/cache/index.sqlite";
/// How long typing or outside edits must pause before they are committed.
pub const QUIET_MS: u64 = 30_000;

/// Kasten's own folders, which it writes into without asking the vault for
/// a path. A link here would take the index, with every note's text, or
/// trashed notes out of the vault.
const OWN_FOLDERS: [&str; 4] = [".kasten", ".kasten/cache", ".kasten/proposals", ".trash"];

fn own_folders_in_place(root: &Path) -> Result<()> {
    for folder in OWN_FOLDERS {
        crate::local_paths::check_tree(&root.join(folder))?;
    }
    Ok(())
}

pub struct Kasten {
    vault: Vault,
    config: RwLock<Config>,
    /// What was last seen of `.kasten/config.yaml` (engine/live_config.rs).
    config_watch: Mutex<live_config::ConfigWatch>,
    lock: WriteLock,
    history: OnceLock<History>,
    index: Mutex<Index>,
    state: Mutex<State>,
    /// Held while an agent op is weighed against the soft limits and run,
    /// so ops sent together each count against what the ones before left.
    agent_turn: Mutex<()>,
    /// Held while a backup file is written and older ones are removed, so
    /// two writes never remove each other's files.
    backup_turn: Mutex<()>,
    /// Notes' vectors for search by meaning, opened on first use.
    pub(crate) vectors: crate::vectors::Vectors,
    /// The vault's change counters (engine/revision.rs).
    revisions: Mutex<Revision>,
    /// Told of each change once the write lock is free.
    listener: OnceLock<Box<dyn Fn(Revision) + Send + Sync>>,
    /// Facts read from boards and decks, kept while the files stay as they are
    /// (engine/file_cache.rs).
    file_cache: Mutex<FileCache>,
    /// The notes and links of the last graph, while the index is as it was
    /// (engine/graph.rs).
    graph_inputs: Mutex<Option<std::sync::Arc<graph::GraphInputs>>>,
    /// What the index said about the projects at the last summaries, while
    /// the index and the day are as they were (engine/project_summaries.rs).
    kept_project_rows: Mutex<Option<project_summaries::KeptRows>>,
    /// What the commit and backup workers sleep on (engine/wake.rs).
    wakes: wake::Wakes,
}

/// What an op did: its result, the paths it touched and its commit message.
pub(crate) struct Change<T> {
    pub value: T,
    pub paths: Vec<String>,
    pub message: String,
}

impl std::fmt::Debug for Kasten {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Kasten")
            .field("root", &self.vault.root())
            .finish()
    }
}

impl Kasten {
    /// Opens a vault: its config, its history if it has one, and the index,
    /// built or caught up with the files.
    pub fn open(root: impl Into<PathBuf>) -> Result<Kasten> {
        let vault = Vault::open(crate::local_paths::resolve_root(&root.into())?)?;
        own_folders_in_place(vault.root())?;
        crate::atomic::sweep_stale(vault.root());
        let config = Config::load(vault.root())?;
        // Before anything is written: a newer format is left as it is.
        if config.format > FORMAT {
            return Err(Error::Invalid(format!(
                "This vault was made by a newer version of KastenFlow (format {}; this one reads up to {FORMAT}). Update KastenFlow to open it.",
                config.format
            )));
        }
        let index_path = vault.root().join(INDEX_PATH);
        let mut index = match Index::open(&index_path) {
            Ok(index) => index,
            Err(_) => {
                // A broken cache is only a cache: start it again.
                let _ = std::fs::remove_file(&index_path);
                Index::open(&index_path)?
            }
        };
        if index.is_empty()? {
            index.rebuild(&vault)?;
        } else {
            index.reconcile(&vault)?;
        }
        let history = OnceLock::new();
        if let Some(found) = History::open(vault.root())? {
            let _ = history.set(found);
        }
        let vectors = vault.root().join(crate::vectors::VECTORS_PATH);
        let watch = live_config::ConfigWatch::new(vault.root());
        let kasten = Kasten {
            lock: WriteLock::new(vault.root()),
            vault,
            config: RwLock::new(config),
            config_watch: Mutex::new(watch),
            history,
            index: Mutex::new(index),
            state: Mutex::new(State::default()),
            agent_turn: Mutex::new(()),
            backup_turn: Mutex::new(()),
            vectors: crate::vectors::Vectors::new(vectors),
            revisions: Mutex::new(Revision {
                epoch: crate::time::Instant::now().millis,
                ..Revision::default()
            }),
            listener: OnceLock::new(),
            file_cache: Mutex::new(FileCache::default()),
            graph_inputs: Mutex::new(None),
            kept_project_rows: Mutex::new(None),
            wakes: wake::Wakes::default(),
        };
        kasten.load_backup();
        Ok(kasten)
    }

    pub fn vault(&self) -> &Vault {
        &self.vault
    }

    pub fn root(&self) -> &std::path::Path {
        self.vault.root()
    }

    /// Replaces the vault's config and writes it.
    pub fn set_config(&self, config: Config) -> Result<()> {
        if let Some(remote) = &config.git.remote {
            crate::history::check_remote(remote)?;
        }
        self.lock.hold(|| config.save(self.vault.root()))?;
        *self.config.write().unwrap_or_else(|p| p.into_inner()) = config;
        self.config_saved();
        Ok(())
    }

    /// Changes the vault's config as it is in the file now, under the write
    /// lock: `change` sees what another program saved a moment ago, so a
    /// small change (the backup address, one setting) cannot undo it, which
    /// `set_config` of a copy read earlier can. An error from `change` writes
    /// nothing.
    pub fn update_config(&self, change: impl FnOnce(&mut Config) -> Result<()>) -> Result<()> {
        let config = self.lock.hold(|| {
            let mut config = Config::load(self.vault.root())?;
            change(&mut config)?;
            if let Some(remote) = &config.git.remote {
                crate::history::check_remote(remote)?;
            }
            config.save(self.vault.root())?;
            Ok(config)
        })?;
        *self.config.write().unwrap_or_else(|p| p.into_inner()) = config;
        self.config_saved();
        Ok(())
    }

    pub fn has_history(&self) -> bool {
        self.history.get().is_some()
    }

    /// Starts git history for a vault that has none: a repository and a
    /// first commit of everything in it.
    pub fn start_history(&self) -> Result<()> {
        if self.has_history() {
            return Ok(());
        }
        let name = self.config().name;
        let history = self.lock.hold(|| History::init(self.vault.root(), &name))?;
        let _ = self.history.set(history);
        self.wake_workers();
        Ok(())
    }

    pub(crate) fn index(&self) -> MutexGuard<'_, Index> {
        self.index.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Runs one op under the write lock, indexes what it touched, and
    /// commits it, or for human typing, queues it for the next edit commit.
    pub(crate) fn apply<T>(
        &self,
        actor: &Actor,
        op: &str,
        batch: bool,
        now: u64,
        run: impl FnOnce(&Vault) -> Result<Change<T>>,
    ) -> Result<T> {
        self.apply_with(actor, op, batch, now, &[], run)
    }

    /// `apply` with extra commit trailers.
    pub(crate) fn apply_with<T>(
        &self,
        actor: &Actor,
        op: &str,
        batch: bool,
        now: u64,
        trailers: &[(&str, String)],
        run: impl FnOnce(&Vault) -> Result<Change<T>>,
    ) -> Result<T> {
        self.apply_committing(actor, op, batch, now, trailers, run)
            .map(|(value, _)| value)
    }

    /// `apply_with`, also giving the id of the commit the op made, taken
    /// under the same lock hold, so no other commit can be mistaken for it.
    pub(crate) fn apply_committing<T>(
        &self,
        actor: &Actor,
        op: &str,
        batch: bool,
        now: u64,
        trailers: &[(&str, String)],
        run: impl FnOnce(&Vault) -> Result<Change<T>>,
    ) -> Result<(T, Option<String>)> {
        let mut counted = None;
        // An op of a batch in this thread (engine/batch_apply.rs): the batch
        // holds the lock and makes the one commit.
        let in_batch = self.in_batch();
        let done = self.lock.hold(|| {
            let batched = batch && !actor.is_agent();
            if let Some(history) = self.history.get().filter(|_| !batched && !in_batch) {
                // A git command run by hand is at work: the op waits, with
                // nothing written, so trying again neither loses nor
                // repeats a change.
                if let Some(lock) = history.held_by() {
                    return Err(History::busy_error(&lock));
                }
                // What is waiting for a commit goes in first, as the
                // person's own, so this op's commit holds only this op's
                // change and undoing it never takes their typing (or an
                // outside edit, before an agent's op) with it.
                self.commit_edits_held(history)?;
                // A batch is undone as one step, and a failed one puts back
                // only the files it wrote: changes made outside go in first,
                // for a person's batch as for an agent's.
                if actor.is_agent() || op == "batch" {
                    self.commit_external_held(history)?;
                }
            }
            let change = run(&self.vault)?;
            self.refresh_or_later(&change.paths);
            // The files changed, whatever happens to the commit: counted now,
            // told to the listener when the lock is let go.
            if !change.paths.is_empty() {
                counted = Some(self.bump(&change.paths));
            }
            if let Actor::Agent { session, .. } = actor {
                let mut state = self.state();
                let tally = state.tallies.entry(session.clone()).or_default();
                tally.record(&change.paths, now);
                if op == "trash_note" {
                    // Every note that went, sub-pages too; not the comments and
                    // highlights files that went with them.
                    tally.trashed += change
                        .paths
                        .iter()
                        .filter(|p| p.starts_with(".trash/") && !crate::companions::is_companion(p))
                        .count();
                }
            }
            if in_batch {
                self.joins_batch(&change.paths);
                return Ok((change.value, None));
            }
            let mut commit = None;
            // An autonomous session's commits say so (engine/agent_policy.rs).
            let trailers = self.mode_trailers(actor, trailers);
            if let Some(history) = self.history.get() {
                if batched {
                    let mut state = self.state();
                    for path in &change.paths {
                        state.edits.insert(path.clone(), now);
                    }
                    state.last_edit = Some(now);
                    state.typed = Some(now);
                } else {
                    commit = history.commit_with(
                        &change.paths,
                        &change.message,
                        actor,
                        op,
                        &trailers,
                    )?;
                    let mut state = self.state();
                    for path in &change.paths {
                        state.edits.remove(path);
                    }
                    if commit.is_some() {
                        state.last_commit = Some(now);
                    }
                }
            }
            Ok((change.value, commit))
        });
        // The listener hears of a batch once, when it is done.
        if let Some(revision) = counted.filter(|_| !in_batch) {
            self.announce(revision);
        }
        done
    }
}
