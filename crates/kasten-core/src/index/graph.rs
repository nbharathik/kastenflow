//! The notes and links as the graph reads them: each table once, in order.

use std::collections::HashMap;

use super::Index;
use crate::error::Result;
use crate::note::NoteMeta;

/// One link of one note: the note that links, what the link names and whether
/// it embeds. A note that names the same title five times has five rows; the
/// graph draws them as one edge.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkRow {
    /// The linking note.
    pub path: String,
    /// What the link names, lowercased as the index keeps it: a title or a
    /// path (a board or a deck by its file name).
    pub target: String,
    /// `![[…]]` rather than `[[…]]`.
    pub embed: bool,
}

impl Index {
    /// Changes whenever the index's tables do: through this connection (its
    /// own changes) or through any other connection to the same file (the
    /// app and the MCP server share one), so a copy of what it holds can
    /// tell whether it is still current.
    pub fn stamp(&self) -> (i64, i128) {
        let version = self
            .conn
            .query_row("PRAGMA data_version", [], |r| r.get::<_, i64>(0))
            .unwrap_or(-1);
        (version, i128::from(self.conn.total_changes()))
    }

    /// What the link graph is built from: every note outside templates with
    /// what following links needs (path, title, kind and project), by path,
    /// and every link those notes make, a note's links together.
    ///
    /// The rest of each note's metadata is left empty: a graph of ten
    /// thousand notes does not read their excerpts, tags or properties. The
    /// links come from one pass over their table, not a join and a grouping,
    /// which is most of the time a vault of that size would otherwise cost.
    pub fn graph_inputs(&self) -> Result<(Vec<NoteMeta>, Vec<LinkRow>)> {
        let mut stmt = self.conn.prepare_cached(
            "SELECT n.num, n.path, n.title, n.kind, n.project FROM notes n
             WHERE n.kind NOT IN ('template', 'ai-action') ORDER BY n.path",
        )?;
        let mut at: HashMap<i64, usize> = HashMap::new();
        let mut notes: Vec<NoteMeta> = Vec::new();
        let mut rows = stmt.query([])?;
        while let Some(r) = rows.next()? {
            at.insert(r.get(0)?, notes.len());
            notes.push(NoteMeta {
                path: r.get(1)?,
                id: None,
                title: r.get(2)?,
                kind: r.get(3)?,
                icon: None,
                cover: None,
                parent: None,
                project: r.get(4)?,
                tags: Vec::new(),
                modified: 0,
                created: None,
                updated: None,
                excerpt: String::new(),
                words: 0,
                props: serde_json::Value::Null,
                locked: false,
            });
        }

        let mut stmt = self
            .conn
            .prepare_cached("SELECT num, target, embed FROM links")?;
        let mut links: Vec<LinkRow> = Vec::new();
        let mut rows = stmt.query([])?;
        while let Some(r) = rows.next()? {
            let Some(&note) = at.get(&r.get::<_, i64>(0)?) else {
                continue;
            };
            links.push(LinkRow {
                path: notes[note].path.clone(),
                target: r.get(1)?,
                embed: r.get(2)?,
            });
        }
        Ok((notes, links))
    }
}
