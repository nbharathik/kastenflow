//! The search index: SQLite with FTS5 in `.kasten/cache/index.sqlite`.
//! It is derived from the files and
//! can be deleted at any time; `rebuild` recreates it and `reconcile`
//! catches up with edits made while no one was watching.

mod embed;
mod filters;
mod graph;
mod marks;
mod projects;
mod query;
mod related;
mod search;
mod store;

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;
use std::time::Duration;

use rusqlite::Connection;

use crate::error::{Error, Result};

pub use filters::{DateRange, Filters, parse_query};
pub use graph::LinkRow;
pub(crate) use marks::MarksRow;
pub use projects::{Counts, ProjectRow, ProjectRows};
pub use query::TaskRow;
pub use related::Related;

pub struct Index {
    conn: Connection,
    /// Which projects' notes this connection changed since `take_touched`.
    touched: Touched,
}

/// The projects whose notes changed through one connection, for readers that
/// keep per-project answers (project summaries).
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Touched {
    /// The whole index was rebuilt: every project may have changed.
    pub all: bool,
    /// The folders (`projects/<folder>/`) whose notes were added, changed or removed.
    pub projects: BTreeSet<String>,
}

impl Touched {
    pub fn is_empty(&self) -> bool {
        !self.all && self.projects.is_empty()
    }
}

impl std::fmt::Debug for Index {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Index")
    }
}

impl From<rusqlite::Error> for Error {
    fn from(err: rusqlite::Error) -> Self {
        Error::Index(err.to_string())
    }
}

/// Bump when the tables, or what is extracted into them, change; an older
/// index is dropped and rebuilt.
const SCHEMA_VERSION: &str = "7";

const SCHEMA: &str = "
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE notes (
  num INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  id TEXT,
  title TEXT NOT NULL,
  title_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  project TEXT,
  parent TEXT,
  icon TEXT,
  cover TEXT,
  tags TEXT NOT NULL,
  props TEXT NOT NULL,
  created TEXT,
  updated TEXT,
  day TEXT NOT NULL,
  modified INTEGER NOT NULL,
  size INTEGER NOT NULL,
  excerpt TEXT NOT NULL,
  words INTEGER NOT NULL,
  locked INTEGER NOT NULL,
  url_key TEXT,
  children_order TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX notes_title ON notes(title_key);
CREATE INDEX notes_id ON notes(id);
CREATE INDEX notes_parent ON notes(parent);
CREATE INDEX notes_url ON notes(url_key);
CREATE TABLE tags (num INTEGER NOT NULL, tag TEXT NOT NULL);
CREATE INDEX tags_tag ON tags(tag);
CREATE INDEX tags_num ON tags(num);
CREATE TABLE links (num INTEGER NOT NULL, target TEXT NOT NULL, embed INTEGER NOT NULL, line INTEGER NOT NULL, context TEXT NOT NULL, at TEXT);
CREATE INDEX links_target ON links(target);
CREATE INDEX links_num ON links(num);
CREATE TABLE tasks (num INTEGER NOT NULL, line INTEGER NOT NULL, done INTEGER NOT NULL, text TEXT NOT NULL, due TEXT, at TEXT);
CREATE INDEX tasks_num ON tasks(num);
CREATE INDEX tasks_due ON tasks(due);
CREATE VIRTUAL TABLE fts USING fts5(title, body, tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3');
INSERT INTO fts (fts, rank) VALUES ('rank', 'bm25(10.0, 1.0)');
CREATE TABLE agent_marks (path TEXT PRIMARY KEY, head TEXT NOT NULL, blob TEXT NOT NULL, marks TEXT NOT NULL);
";

const TABLES: [&str; 7] = [
    "meta",
    "notes",
    "tags",
    "links",
    "tasks",
    "fts",
    "agent_marks",
];

impl Index {
    /// Opens (or creates) the index file.
    pub fn open(path: &Path) -> Result<Index> {
        crate::local_paths::check(path)?;
        for suffix in ["-wal", "-shm", "-journal"] {
            let mut sidecar = path.as_os_str().to_owned();
            sidecar.push(suffix);
            crate::local_paths::check(Path::new(&sidecar))?;
        }
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        let conn = Connection::open_with_flags(
            path,
            rusqlite::OpenFlags::default() | rusqlite::OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        Index::setup(conn)
    }

    fn setup(conn: Connection) -> Result<Index> {
        conn.busy_timeout(Duration::from_secs(10))?;
        let version: Option<String> = conn
            .query_row("SELECT value FROM meta WHERE key = 'schema'", [], |r| {
                r.get(0)
            })
            .ok();
        if version.as_deref() != Some(SCHEMA_VERSION) {
            for table in TABLES {
                conn.execute_batch(&format!("DROP TABLE IF EXISTS {table};"))?;
            }
            conn.execute_batch(SCHEMA)?;
            conn.execute(
                "INSERT INTO meta (key, value) VALUES ('schema', ?1)",
                [SCHEMA_VERSION],
            )?;
        }
        // Added after schema 7 without a new version, so an index made by an
        // earlier build gains it in place (a few milliseconds) instead of
        // being rebuilt: it lets one project's notes be found without a scan.
        conn.execute_batch("CREATE INDEX IF NOT EXISTS notes_project ON notes(project);")?;
        Ok(Index {
            conn,
            touched: Touched::default(),
        })
    }

    /// The projects changed through this connection since the last call, and
    /// forgets them. A change made through another connection to the same
    /// file is not here: `stamp` tells of it.
    pub fn take_touched(&mut self) -> Touched {
        std::mem::take(&mut self.touched)
    }

    /// Puts back what `take_touched` gave, for a reader that could not use it.
    pub fn restore_touched(&mut self, back: Touched) {
        self.touched.all |= back.all;
        self.touched.projects.extend(back.projects);
    }

    /// How many notes are indexed.
    pub fn len(&self) -> Result<usize> {
        let n: i64 = self
            .conn
            .query_row("SELECT count(*) FROM notes", [], |r| r.get(0))?;
        Ok(n as usize)
    }

    pub fn is_empty(&self) -> Result<bool> {
        Ok(self.len()? == 0)
    }
}
