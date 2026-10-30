//! Keeping the index current: whole rebuilds, per-path refreshes after an
//! op, and a scan that finds files changed behind its back.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::time::UNIX_EPOCH;

use rusqlite::{OptionalExtension, Transaction, params};

use super::Index;
use crate::error::Result;
use crate::frontmatter::split;
use crate::note::meta_with_extract;
use crate::time::Instant;
use crate::vault::Vault;

/// The day filters compare: the note's own date, else its file time (UTC).
fn day_of(created: Option<&str>, updated: Option<&str>, modified: u64) -> String {
    // Only a real day: a hand-written date may hold any letters.
    let own = updated
        .or(created)
        .and_then(|d| d.get(..10))
        .filter(|d| crate::dates::is_real_day(d))
        .map(str::to_owned);
    own.unwrap_or_else(|| Instant { millis: modified }.rfc3339()[..10].to_owned())
}

/// Drops the note at `path` from every table; the project it was in, if it was in one.
fn remove(tx: &Transaction, path: &str) -> Result<Option<String>> {
    let found: Option<(i64, Option<String>)> = tx
        .query_row(
            "SELECT num, project FROM notes WHERE path = ?1",
            [path],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();
    let Some((num, project)) = found else {
        return Ok(None);
    };
    for table in ["tags", "links", "tasks"] {
        tx.execute(&format!("DELETE FROM {table} WHERE num = ?1"), [num])?;
    }
    tx.execute("DELETE FROM fts WHERE rowid = ?1", [num])?;
    tx.execute("DELETE FROM notes WHERE num = ?1", [num])?;
    Ok(project)
}

/// Indexes the note at `path`; the project it is in, if it is in one.
fn insert(
    tx: &Transaction,
    path: &str,
    text: &str,
    modified: u64,
    size: u64,
) -> Result<Option<String>> {
    // One note the parser trips on is listed by its name alone, and the
    // rest of the vault still opens.
    let (meta, extract) = std::panic::catch_unwind(|| meta_with_extract(path, text, modified))
        .unwrap_or_else(|_| meta_with_extract(path, "", modified));
    let day = day_of(meta.created.as_deref(), meta.updated.as_deref(), modified);
    // The page a captured or clipped note came from, to find it saved again.
    let url_key = crate::clip::note_url_key(text, &meta.props);
    tx.execute(
        "INSERT INTO notes (path, id, title, title_key, kind, project, parent, icon, cover, tags, props, created, updated, day, modified, size, excerpt, words, locked, url_key, children_order)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)",
        params![
            meta.path,
            meta.id,
            meta.title,
            meta.title.trim().to_lowercase(),
            meta.kind,
            meta.project,
            meta.parent,
            meta.icon,
            meta.cover,
            serde_json::to_string(&meta.tags).unwrap_or_else(|_| "[]".into()),
            meta.props.to_string(),
            meta.created,
            meta.updated,
            day,
            modified as i64,
            size as i64,
            meta.excerpt,
            meta.words,
            meta.locked,
            url_key,
            serde_json::to_string(&meta.children_order).unwrap_or_else(|_| "[]".into()),
        ],
    )?;
    let num = tx.last_insert_rowid();
    for tag in &meta.tags {
        tx.execute(
            "INSERT INTO tags (num, tag) VALUES (?1, ?2)",
            params![num, tag.trim().to_lowercase()],
        )?;
    }
    for link in &extract.links {
        tx.execute(
            "INSERT INTO links (num, target, embed, line, context, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                num,
                link.target.trim().to_lowercase(),
                link.embed,
                link.line as i64,
                link.context,
                link.at
            ],
        )?;
    }
    for task in &extract.tasks {
        tx.execute(
            "INSERT INTO tasks (num, line, done, text, due, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                num,
                task.line as i64,
                task.done,
                task.text,
                task.due,
                task.at
            ],
        )?;
    }
    tx.execute(
        "INSERT INTO fts (rowid, title, body) VALUES (?1, ?2, ?3)",
        params![num, meta.title, split(text).body],
    )?;
    Ok(meta.project)
}

fn millis(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as u64)
}

impl Index {
    /// Drops everything and indexes every note again.
    pub fn rebuild(&mut self, vault: &Vault) -> Result<usize> {
        let files = vault.files(".md")?;
        let tx = self.conn.transaction()?;
        for table in ["notes", "tags", "links", "tasks", "fts"] {
            tx.execute(&format!("DELETE FROM {table}"), [])?;
        }
        // Written in one go, the search index starts out tidy.
        tx.execute("DELETE FROM meta WHERE key = 'unmerged'", [])?;
        let mut count = 0;
        for file in &files {
            if let Ok(text) = fs::read_to_string(vault.root().join(&file.path)) {
                insert(&tx, &file.path, &text, file.modified, file.size)?;
                count += 1;
            }
        }
        tx.commit()?;
        self.touched.all = true;
        Ok(count)
    }

    /// Re-reads `paths` (notes that changed, appeared or went away, and
    /// folders that appeared, went or were renamed). Other files, and
    /// private folders like `.trash`, are skipped.
    pub fn refresh(&mut self, vault: &Vault, paths: &[String]) -> Result<()> {
        let paths = self.notes_among(vault, paths)?;
        let tx = self.conn.transaction()?;
        // Counted for `tidy`, in the file, so saves by every process and
        // every run add up.
        if !paths.is_empty() {
            tx.execute(
                "INSERT INTO meta (key, value) VALUES ('unmerged', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = value + ?1",
                [paths.len() as i64],
            )?;
        }
        // The projects the notes were in and are in now.
        let mut projects: Vec<String> = Vec::new();
        for path in &paths {
            if vault.path_of(path).is_err() {
                continue;
            }
            projects.extend(remove(&tx, path)?);
            let full = vault.root().join(path);
            if let Ok(meta) = fs::metadata(&full)
                && meta.is_file()
                && let Ok(text) = fs::read_to_string(&full)
            {
                projects.extend(insert(&tx, path, &text, millis(&meta), meta.len())?);
            }
        }
        tx.commit()?;
        self.touched.projects.extend(projects);
        Ok(())
    }

    /// The notes `paths` stand for: each note, and for any other path,
    /// which may be a folder that came or went without events for its
    /// files, every note under it on disk or in the index.
    fn notes_among(&self, vault: &Vault, paths: &[String]) -> Result<Vec<String>> {
        let mut notes = Vec::new();
        for path in paths {
            if path.ends_with(".md") {
                notes.push(path.clone());
                continue;
            }
            // Paths under `dir/` sort from `dir/` up to `dir0`, `0` being
            // the byte after `/`, so the path index finds them.
            let dir = path.trim_end_matches('/');
            let mut stmt = self
                .conn
                .prepare_cached("SELECT path FROM notes WHERE path >= ?1 AND path < ?2")?;
            let range = [format!("{dir}/"), format!("{dir}0")];
            for known in stmt.query_map(range, |row| row.get::<_, String>(0))? {
                notes.push(known?);
            }
            if let Ok(files) = vault.files_in(path, ".md") {
                notes.extend(files.into_iter().map(|file| file.path));
            }
        }
        notes.sort();
        notes.dedup();
        Ok(notes)
    }

    /// Finds notes whose time or size differs from the index, or that
    /// appeared or went away, and refreshes them. Returns how many.
    pub fn reconcile(&mut self, vault: &Vault) -> Result<usize> {
        let files = vault.files(".md")?;
        let known: HashMap<String, (u64, u64)> = {
            let mut stmt = self
                .conn
                .prepare("SELECT path, modified, size FROM notes")?;
            let rows = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    (r.get::<_, i64>(1)? as u64, r.get::<_, i64>(2)? as u64),
                ))
            })?;
            rows.collect::<std::result::Result<_, _>>()?
        };
        let on_disk: HashSet<&str> = files.iter().map(|f| f.path.as_str()).collect();
        let mut changed: Vec<String> = files
            .iter()
            .filter(|f| known.get(&f.path) != Some(&(f.modified, f.size)))
            .map(|f| f.path.clone())
            .collect();
        changed.extend(
            known
                .keys()
                .filter(|p| !on_disk.contains(p.as_str()))
                .cloned(),
        );
        if !changed.is_empty() {
            self.refresh(vault, &changed)?;
        }
        Ok(changed.len())
    }

    /// Merges the search index's small pieces once enough saves have left
    /// them. Each save adds a piece and every word is looked up in each, so
    /// searches slow down a little with every save until a merge. One call
    /// does a bounded step (about 2 MB written), so it can run between
    /// edits; calls go on stepping until the merge is done. Returns whether
    /// it merged.
    pub fn tidy(&mut self) -> Result<bool> {
        let unmerged: i64 = self
            .conn
            .query_row(
                "SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'unmerged'",
                [],
                |r| r.get(0),
            )
            .optional()?
            .unwrap_or(0);
        if unmerged < TIDY_AFTER {
            return Ok(false);
        }
        self.conn
            .execute_batch("INSERT INTO fts (fts, rank) VALUES ('usermerge', 2);")?;
        let before = self.conn.total_changes();
        self.conn
            .execute("INSERT INTO fts (fts, rank) VALUES ('merge', 500)", [])?;
        // Fewer than two rows written: nothing was left to merge.
        let merged = self.conn.total_changes() - before >= 2;
        if !merged {
            self.conn
                .execute("DELETE FROM meta WHERE key = 'unmerged'", [])?;
        }
        Ok(merged)
    }
}

/// Saves after which `tidy` merges.
const TIDY_AFTER: i64 = 64;
