//! The activity digest: what agents did since a moment, session by session.
//! It is read from history alone. A commit counts only when an agent made it
//! (an `agent:` author) and its last paragraph names a session in a
//! `Kasten-Session` trailer, so a person's edit never does, whatever a note's
//! title says. Reading all of history is the slow part, so the sessions are
//! kept in a cache file under the newest commit's id; the proposals still
//! waiting are read fresh each time, since deciding one makes no commit.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::Kasten;
use crate::atomic::write_atomic;
use crate::error::Result;
use crate::history::{CommitInfo, History};

/// How many commits back history is read, as for the list of sessions.
const LOOK_BACK: usize = 20_000;
const CACHE: &str = ".kasten/cache/digest.json";
/// Notes named per session; the count of all of them is kept as well.
const MOST_NOTES: usize = 50;

/// One agent session's share of the window.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DigestSession {
    pub id: String,
    /// The name the agent connected under (a routine's name, say).
    pub client: String,
    /// The session's first and last change, in milliseconds since the Unix epoch.
    pub started: u64,
    pub last: u64,
    /// Changes made inside the window: one per commit.
    pub changes: usize,
    /// Changes it asked the person to decide on, inside the window.
    #[serde(default)]
    pub proposed: usize,
    /// How many different notes those changes touched.
    pub notes_touched: usize,
    /// Their paths, the first few in order.
    pub notes: Vec<String>,
    /// `autonomous` when the session worked on its own.
    pub mode: Option<String>,
    /// Proposals of this session that still wait for the person.
    #[serde(default)]
    pub proposals_waiting: usize,
    /// Something of the session can still be taken back.
    pub can_undo: bool,
    /// Everything it did has been taken back.
    pub undone: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Digest {
    /// The window's start, in milliseconds since the Unix epoch.
    pub since: u64,
    /// Sessions that changed something in the window, newest first.
    pub sessions: Vec<DigestSession>,
    /// Changes in all of them.
    pub changes: usize,
    /// Proposals waiting in all of them.
    pub waiting: usize,
    /// The sessions came from the cache file, not from reading history.
    #[serde(skip)]
    pub from_cache: bool,
}

#[derive(Serialize, Deserialize)]
struct Cached {
    head: String,
    since: u64,
    sessions: Vec<DigestSession>,
}

/// Whether a changed path is a thing the person would call a note: Kasten's
/// own folders are not, nor are the picture files in `assets/` (their pages
/// are), nor the code files inside a smart page's folder one by one.
fn is_a_note(path: &str) -> bool {
    !path.starts_with(".kasten/")
        && !path.starts_with(".trash/")
        && !(path.starts_with("assets/") && !path.ends_with(".md"))
        && !crate::companions::in_folder(path)
}

struct Acc {
    session: DigestSession,
    paths: BTreeSet<String>,
    everything_undone: bool,
}

fn group(history: &History, log: &[CommitInfo], since: u64) -> Vec<DigestSession> {
    let undone: HashSet<&str> = log.iter().filter_map(|c| c.undoes.as_deref()).collect();
    let mut by: BTreeMap<&str, Acc> = BTreeMap::new();
    for commit in log.iter().filter(|c| c.agent && !c.merge) {
        let Some(id) = commit.session.as_deref() else {
            continue;
        };
        let acc = by.entry(id).or_insert_with(|| Acc {
            session: DigestSession {
                id: id.to_owned(),
                client: commit
                    .author
                    .strip_prefix("agent:")
                    .unwrap_or(&commit.author)
                    .to_owned(),
                started: commit.time,
                last: commit.time,
                changes: 0,
                proposed: 0,
                notes_touched: 0,
                notes: Vec::new(),
                mode: None,
                proposals_waiting: 0,
                can_undo: false,
                undone: false,
            },
            paths: BTreeSet::new(),
            everything_undone: true,
        });
        acc.session.started = acc.session.started.min(commit.time);
        acc.session.last = acc.session.last.max(commit.time);
        // A proposal is a change asked for, not made: it is counted apart and
        // has nothing to take back.
        let proposing = commit.op.as_deref() == Some("propose");
        if !proposing {
            acc.everything_undone &= undone.contains(commit.id.as_str());
        }
        if commit.time < since {
            continue;
        }
        if proposing {
            acc.session.proposed += 1;
            continue;
        }
        acc.session.changes += 1;
        if commit.mode.as_deref() == Some("autonomous") {
            acc.session.mode = Some("autonomous".to_owned());
        }
        if let Ok(paths) = history.changed_paths(&commit.id) {
            acc.paths.extend(paths.into_iter().filter(|p| is_a_note(p)));
        }
    }
    let mut out: Vec<DigestSession> = by
        .into_values()
        .filter(|acc| acc.session.changes + acc.session.proposed > 0)
        .map(|acc| {
            let mut s = acc.session;
            s.notes_touched = acc.paths.len();
            s.notes = acc.paths.into_iter().take(MOST_NOTES).collect();
            s.undone = acc.everything_undone && s.changes > 0;
            s.can_undo = !acc.everything_undone && s.changes > 0;
            s
        })
        .collect();
    out.sort_by(|a, b| b.last.cmp(&a.last).then(b.id.cmp(&a.id)));
    out
}

fn read_cache(root: &Path) -> Option<Cached> {
    let text = std::fs::read_to_string(root.join(CACHE)).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_cache(root: &Path, cached: &Cached) -> Result<()> {
    let path = root.join(CACHE);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let text = serde_json::to_string(cached).unwrap_or_else(|_| "{}".to_owned());
    write_atomic(&path, text.as_bytes())?;
    Ok(())
}

impl Kasten {
    /// What agents did since `since` (milliseconds since the Unix epoch), per
    /// session. A person's changes are not in it. Nothing is written to the
    /// vault; the sessions are kept in the cache folder under the newest
    /// commit, and a new commit makes them again.
    pub fn activity_digest(&self, since: u64) -> Result<Digest> {
        let mut digest = Digest {
            since,
            sessions: Vec::new(),
            changes: 0,
            waiting: 0,
            from_cache: false,
        };
        let Some(history) = self.history.get() else {
            return Ok(digest);
        };
        let root = self.vault.root();
        let head = history.head();
        let cached = head
            .as_ref()
            .and_then(|head| read_cache(root).filter(|c| c.head == *head && c.since == since));
        if let Some(cached) = cached {
            digest.sessions = cached.sessions;
            digest.from_cache = true;
        } else {
            let log = history.log(None, LOOK_BACK)?;
            digest.sessions = group(history, &log, since);
            if let Some(head) = head {
                let _ = write_cache(
                    root,
                    &Cached {
                        head,
                        since,
                        sessions: digest.sessions.clone(),
                    },
                );
            }
        }
        let mut waiting: HashMap<String, usize> = HashMap::new();
        for proposal in self.proposals().unwrap_or_default() {
            *waiting.entry(proposal.session).or_default() += 1;
        }
        for session in &mut digest.sessions {
            session.proposals_waiting = waiting.get(&session.id).copied().unwrap_or(0);
        }
        // A session that only asked, and was answered, has nothing left to show.
        digest
            .sessions
            .retain(|s| s.changes > 0 || s.proposals_waiting > 0);
        digest.changes = digest.sessions.iter().map(|s| s.changes).sum();
        digest.waiting = digest.sessions.iter().map(|s| s.proposals_waiting).sum();
        Ok(digest)
    }
}
