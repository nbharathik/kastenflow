//! The engine every shell drives: the app, the
//! CLI and the MCP server call these methods, never the file system. Each
//! write takes the vault's write lock, applies one op, updates the index
//! and commits to git. Human typing is batched into one commit after a
//! quiet spell; agent ops commit at once.

mod agent;
mod agent_assets;
mod asset_add;
mod asset_files;
mod asset_meta;
mod asset_thumbs;
mod asset_usage;
mod assets;
mod backup_file;
mod boards;
mod brainstorm;
mod commits;
mod create;
mod deck_agent;
mod deck_limits;
mod decks;
mod diagram_agent;
mod diagrams;
mod edit;
mod empty_trash;
mod execute;
mod graph;
mod highlight_cards;
mod init;
mod kits;
mod latest;
mod latest_apply;
mod links;
mod marks;
mod ops;
mod placing;
mod reads;
mod references;
mod replace;
mod restore;
mod review;
mod sources;
mod tag_lists;
mod undo;
mod verify;
mod verify_names;

use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock, RwLock};

use crate::agent::Tally;
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
pub use boards::{BoardApplied, BoardInfo, NoteStats};
pub use brainstorm::{Brainstormed, Idea, MAX_IDEAS};
pub use commits::{BackupRecord, Tick};
pub use decks::DeckInfo;
pub use empty_trash::Emptied;
pub use kits::{AddedKit, KitInfo, kits};
pub use latest::{Latest, LatestOutcome};
pub use placing::Placed;
pub use references::MAX_BIB_BYTES;
pub use replace::{
    Expected, MAX_REPLACE_NOTES, MAX_REPLACEMENTS, NoteMatches, ReplaceRequest, Replaced,
};
pub use restore::VaultRestore;
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
/// Recent note versions kept for three-way merges.
const BASES: usize = 64;

pub struct Kasten {
    vault: Vault,
    config: RwLock<Config>,
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
}

#[derive(Debug, Default)]
struct State {
    /// Human edits not committed yet: path, and when it last changed.
    edits: BTreeMap<String, u64>,
    last_edit: Option<u64>,
    /// When the person last typed, kept after the commit: backup files
    /// wait until the vault has been quiet a while.
    typed: Option<u64>,
    /// When the watcher last saw a change made outside Kasten.
    outside: Option<u64>,
    /// Recent versions by hash, so a save can merge with edits made meanwhile.
    bases: VecDeque<(String, String)>,
    last_commit: Option<u64>,
    backup: BackupRecord,
    /// The remote the person confirmed on this computer, the only one
    /// scheduled pushes go to.
    confirmed_remote: Option<String>,
    /// The token for the remote's server, from the app's keychain; held
    /// in memory only.
    git_token: Option<crate::history::GitToken>,
    /// What each agent session changed lately, for the soft limits.
    tallies: HashMap<String, Tally>,
    /// Paths an op wrote that the index could not take yet.
    unindexed: BTreeSet<String>,
    /// Stop the next Get latest before its branch moves (tests).
    stop_before_branch: bool,
    /// Fail the next Get latest after this many files (tests).
    fail_writes_after: Option<usize>,
}

impl Kasten {
    /// Indexes `paths`, with any an earlier refresh could not take. The
    /// files are written by then: an index that fails now (SQLite busy)
    /// catches up with the next op rather than failing this one.
    fn refresh_or_later(&self, paths: &[String]) {
        let mut all: BTreeSet<String> = std::mem::take(&mut self.state().unindexed);
        all.extend(paths.iter().cloned());
        let all: Vec<String> = all.into_iter().collect();
        if self.index().refresh(&self.vault, &all).is_err() {
            self.state().unindexed.extend(all);
        }
    }
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
        let kasten = Kasten {
            lock: WriteLock::new(vault.root()),
            vault,
            config: RwLock::new(config),
            history,
            index: Mutex::new(index),
            state: Mutex::new(State::default()),
            agent_turn: Mutex::new(()),
            backup_turn: Mutex::new(()),
            vectors: crate::vectors::Vectors::new(vectors),
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

    pub fn config(&self) -> Config {
        self.config
            .read()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }

    /// Replaces the vault's config and writes it.
    pub fn set_config(&self, config: Config) -> Result<()> {
        if let Some(remote) = &config.git.remote {
            crate::history::check_remote(remote)?;
        }
        self.lock.hold(|| config.save(self.vault.root()))?;
        *self.config.write().unwrap_or_else(|p| p.into_inner()) = config;
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
        Ok(())
    }

    pub(crate) fn index(&self) -> MutexGuard<'_, Index> {
        self.index.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn state(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn remember(&self, hash: &str, text: &str) {
        let mut state = self.state();
        if state.bases.iter().any(|(h, _)| h == hash) {
            return;
        }
        if state.bases.len() >= BASES {
            state.bases.pop_front();
        }
        state.bases.push_back((hash.to_owned(), text.to_owned()));
    }

    fn base(&self, hash: &str) -> Option<String> {
        self.state()
            .bases
            .iter()
            .find(|(h, _)| h == hash)
            .map(|(_, t)| t.clone())
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
        self.lock.hold(|| {
            let batched = batch && !actor.is_agent();
            if let Some(history) = self.history.get().filter(|_| !batched) {
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
                if actor.is_agent() {
                    self.commit_external_held(history)?;
                }
            }
            let change = run(&self.vault)?;
            self.refresh_or_later(&change.paths);
            if let Actor::Agent { session, .. } = actor {
                let mut state = self.state();
                let tally = state.tallies.entry(session.clone()).or_default();
                tally.record(&change.paths, now);
                if op == "trash_note" {
                    // Every note that went, sub-pages too.
                    tally.trashed += change
                        .paths
                        .iter()
                        .filter(|p| p.starts_with(".trash/"))
                        .count();
                }
            }
            let mut commit = None;
            if let Some(history) = self.history.get() {
                if batched {
                    let mut state = self.state();
                    for path in &change.paths {
                        state.edits.insert(path.clone(), now);
                    }
                    state.last_edit = Some(now);
                    state.typed = Some(now);
                } else {
                    commit =
                        history.commit_with(&change.paths, &change.message, actor, op, trailers)?;
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
        })
    }
}
