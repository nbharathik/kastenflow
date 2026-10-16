//! Reading the index: every note's metadata, backlinks, unlinked mentions,
//! to-dos and lookups by title or id.

use rusqlite::{Row, params};
use serde::Serialize;

use super::Index;
use crate::error::Result;
use crate::links::{Directory, Place, Resolution, path_key, title_key};
use crate::note::NoteMeta;
use crate::search::{Backlink, DayMention};

pub(super) const META_COLUMNS: &str = "n.path, n.id, n.title, n.kind, n.icon, n.cover, n.parent, n.project, n.tags, n.modified, n.created, n.updated, n.excerpt, n.words, n.props, n.locked";

pub(super) fn meta_of(row: &Row) -> rusqlite::Result<NoteMeta> {
    let tags: String = row.get(8)?;
    let props: String = row.get(14)?;
    Ok(NoteMeta {
        path: row.get(0)?,
        id: row.get(1)?,
        title: row.get(2)?,
        kind: row.get(3)?,
        icon: row.get(4)?,
        cover: row.get(5)?,
        parent: row.get(6)?,
        project: row.get(7)?,
        tags: serde_json::from_str(&tags).unwrap_or_default(),
        modified: row.get::<_, i64>(9)? as u64,
        created: row.get(10)?,
        updated: row.get(11)?,
        excerpt: row.get(12)?,
        words: row.get(13)?,
        props: serde_json::from_str(&props).unwrap_or_else(|_| serde_json::json!({})),
        locked: row.get(15)?,
    })
}

/// A to-do somewhere in the vault.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRow {
    pub path: String,
    pub title: String,
    pub icon: Option<String>,
    /// Line number in the body, from 0.
    pub line: u32,
    pub done: bool,
    pub text: String,
    /// The day the task names, if any.
    pub due: Option<String>,
    /// The time (`HH:MM`) that directly follows that day, if any.
    pub at: Option<String>,
}

/// Words of a title as an FTS5 phrase, or None if nothing searchable remains.
pub(super) fn phrase(title: &str) -> Option<String> {
    let words: Vec<String> = title
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_lowercase)
        .collect();
    (!words.is_empty()).then(|| format!("\"{}\"", words.join(" ")))
}

impl Index {
    /// Every note, sorted by path.
    pub fn notes(&self) -> Result<Vec<NoteMeta>> {
        let mut stmt = self.conn.prepare_cached(&format!(
            "SELECT {META_COLUMNS} FROM notes n ORDER BY n.path"
        ))?;
        let rows = stmt.query_map([], meta_of)?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// One note's metadata.
    pub fn note(&self, path: &str) -> Result<Option<NoteMeta>> {
        let mut stmt = self.conn.prepare_cached(&format!(
            "SELECT {META_COLUMNS} FROM notes n WHERE n.path = ?1"
        ))?;
        let mut rows = stmt.query_map([path], meta_of)?;
        Ok(rows.next().transpose()?)
    }

    /// Paths of notes with this title (ignoring case), templates last.
    pub fn by_title(&self, title: &str) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare_cached(
            "SELECT path FROM notes WHERE title_key = ?1 ORDER BY kind = 'template', path",
        )?;
        let rows = stmt.query_map([title.trim().to_lowercase()], |r| r.get(0))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn by_id(&self, id: &str) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row("SELECT path FROM notes WHERE id = ?1", [id], |r| r.get(0))
            .ok())
    }

    /// Notes saved from the web page whose `clip::url_key` is `key`, the
    /// first saved first, templates aside.
    pub fn by_url_key(&self, key: &str) -> Result<Vec<NoteMeta>> {
        let mut stmt = self.conn.prepare_cached(&format!(
            "SELECT {META_COLUMNS} FROM notes n WHERE n.url_key = ?1 AND n.kind NOT IN ('template', 'ai-action') ORDER BY COALESCE(n.created, ''), n.path"
        ))?;
        let rows = stmt.query_map([key], meta_of)?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// Notes with this title, templates aside.
    pub fn titled(&self, title: &str) -> Result<Vec<NoteMeta>> {
        let mut stmt = self.conn.prepare_cached(&format!(
            "SELECT {META_COLUMNS} FROM notes n WHERE n.title_key = ?1 AND n.kind NOT IN ('template', 'ai-action') ORDER BY n.path"
        ))?;
        let rows = stmt.query_map([title.trim().to_lowercase()], meta_of)?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// Notes whose links go to the note at `path`, newest first, one row
    /// per note: links by its path, and links by its title that go to it
    /// or ask, among notes sharing the title, whether they mean it.
    pub fn backlinks(&self, path: &str) -> Result<Vec<Backlink>> {
        let Some(note) = self.note(path)? else {
            return Ok(Vec::new());
        };
        let title = title_key(&note.title);
        let key = path_key(path);
        let mut stmt = self.conn.prepare_cached(
            "SELECT n.path, n.title, n.icon, l.context, l.target, n.project FROM links l JOIN notes n ON n.num = l.num
             WHERE l.target IN (?1, ?2, ?3) AND n.kind NOT IN ('template', 'ai-action') AND n.path != ?4
             ORDER BY n.modified DESC, l.line",
        )?;
        let rows = stmt.query_map(params![title, key, format!("{key}.md"), path], |r| {
            Ok((
                Backlink {
                    path: r.get(0)?,
                    title: r.get(1)?,
                    icon: r.get(2)?,
                    snippet: r.get(3)?,
                },
                r.get::<_, String>(4)?,
                r.get::<_, Option<String>>(5)?,
            ))
        })?;
        let rows: Vec<(Backlink, String, Option<String>)> =
            rows.collect::<std::result::Result<_, _>>()?;
        // Only a shared title needs working out which note a link means.
        let namesakes = if rows.iter().any(|(_, target, _)| *target == title) {
            self.titled(&note.title)?
        } else {
            Vec::new()
        };
        let directory = Directory::new(&namesakes);
        let mut out: Vec<Backlink> = Vec::new();
        for (backlink, target, project) in rows {
            let reaches = target != title
                || namesakes.len() < 2
                || match directory.resolve(
                    &target,
                    Place {
                        path: &backlink.path,
                        project: project.as_deref(),
                    },
                ) {
                    Resolution::Note(found) => found.path == note.path,
                    Resolution::Ambiguous(among) => among.iter().any(|n| n.path == note.path),
                    Resolution::Missing => false,
                };
            if reaches && !out.iter().any(|b| b.path == backlink.path) {
                out.push(backlink);
            }
        }
        Ok(out)
    }

    /// Notes that link a day from `from` to `to` (both `YYYY-MM-DD`),
    /// outside to-dos (those are tasks with a due day) and outside the day's
    /// own page: by day, then newest first, one row per note and day.
    pub fn day_mentions(&self, from: &str, to: &str) -> Result<Vec<DayMention>> {
        let mut stmt = self.conn.prepare_cached(
            "SELECT l.target, n.path, n.title, n.icon, n.kind, l.context, l.at FROM links l JOIN notes n ON n.num = l.num
             WHERE l.target BETWEEN ?1 AND ?2
               AND l.target GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
               AND n.kind NOT IN ('template', 'ai-action') AND n.title_key != l.target
               AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.num = l.num AND t.line = l.line)
             ORDER BY l.target, n.modified DESC, l.line",
        )?;
        let rows = stmt.query_map(params![from, to], |r| {
            Ok(DayMention {
                day: r.get(0)?,
                path: r.get(1)?,
                title: r.get(2)?,
                icon: r.get(3)?,
                kind: r.get(4)?,
                snippet: r.get(5)?,
                at: r.get(6)?,
            })
        })?;
        // One per note and day: its first line that names the day.
        let mut seen = std::collections::HashSet::new();
        let mut out = Vec::new();
        for row in rows {
            let row = row?;
            if seen.insert((row.day.clone(), row.path.clone())) {
                out.push(row);
            }
        }
        Ok(out)
    }

    /// Notes whose text names `title` without linking it, the "unlinked
    /// mentions", each with a snippet.
    pub fn mentions(&self, title: &str, path: &str) -> Result<Vec<Backlink>> {
        let Some(phrase) = phrase(title) else {
            return Ok(Vec::new());
        };
        let mut stmt = self.conn.prepare_cached(
            "SELECT n.path, n.title, n.icon, snippet(fts, 1, '', '', '…', 16) FROM fts JOIN notes n ON n.num = fts.rowid
             WHERE fts MATCH ?1 AND n.path != ?2 AND n.kind NOT IN ('template', 'ai-action')
               AND n.num NOT IN (SELECT num FROM links WHERE target = ?3)
             ORDER BY n.modified DESC LIMIT 50",
        )?;
        let query = format!("body : {phrase}");
        let rows = stmt.query_map(params![query, path, title.trim().to_lowercase()], |r| {
            Ok(Backlink {
                path: r.get(0)?,
                title: r.get(1)?,
                icon: r.get(2)?,
                snippet: r.get(3)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// Paths of notes with a link to `title`.
    pub fn linking(&self, title: &str) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare_cached(
            "SELECT DISTINCT n.path FROM links l JOIN notes n ON n.num = l.num WHERE l.target = ?1",
        )?;
        let rows = stmt.query_map([title.trim().to_lowercase()], |r| r.get(0))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// Every to-do outside templates, by note and line.
    pub fn tasks(&self) -> Result<Vec<TaskRow>> {
        let mut stmt = self.conn.prepare_cached(
            "SELECT n.path, n.title, n.icon, t.line, t.done, t.text, t.due, t.at FROM tasks t JOIN notes n ON n.num = t.num
             WHERE n.kind NOT IN ('template', 'ai-action') ORDER BY n.modified DESC, n.path, t.line",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(TaskRow {
                path: r.get(0)?,
                title: r.get(1)?,
                icon: r.get(2)?,
                line: r.get(3)?,
                done: r.get(4)?,
                text: r.get(5)?,
                due: r.get(6)?,
                at: r.get(7)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// How many links each note makes, by path.
    pub fn outgoing_counts(&self) -> Result<Vec<(String, u32)>> {
        let mut stmt = self.conn.prepare_cached(
            "SELECT n.path, count(*) FROM links l JOIN notes n ON n.num = l.num GROUP BY n.path",
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// How many notes link to each title, by lowercase title.
    pub fn link_counts(&self) -> Result<Vec<(String, u32)>> {
        let mut stmt = self
            .conn
            .prepare_cached("SELECT target, count(DISTINCT num) FROM links GROUP BY target")?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }
}
