//! What search by meaning reads from the index: each note's stamp (its
//! time and size, cheap to compare), its words, and how to show it.

use rusqlite::OptionalExtension;

use super::Index;
use crate::error::Result;

/// A note that search by meaning covers, and its stamp.
#[derive(Debug, Clone)]
pub(crate) struct Stamped {
    pub num: i64,
    pub path: String,
    pub stamp: String,
}

/// A note as a result shows it.
#[derive(Debug, Clone)]
pub(crate) struct Shown {
    pub title: String,
    pub icon: Option<String>,
    pub excerpt: String,
}

impl Index {
    /// Every note but templates, the latest changed first.
    pub(crate) fn embed_stamps(&self) -> Result<Vec<Stamped>> {
        let mut stmt = self.conn.prepare_cached(
            "SELECT num, path, modified, size FROM notes WHERE kind NOT IN ('template', 'ai-action')
             ORDER BY modified DESC, path",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Stamped {
                num: r.get(0)?,
                path: r.get(1)?,
                stamp: format!("{}:{}", r.get::<_, i64>(2)?, r.get::<_, i64>(3)?),
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// A note's title and body.
    pub(crate) fn embed_text(&self, num: i64) -> Result<(String, String)> {
        Ok(self
            .conn
            .query_row("SELECT title, body FROM fts WHERE rowid = ?1", [num], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })?)
    }

    /// How to show the note at `path`; None when it is gone or a template.
    pub(crate) fn shown(&self, path: &str) -> Result<Option<Shown>> {
        Ok(self
            .conn
            .prepare_cached(
                "SELECT title, icon, excerpt FROM notes WHERE path = ?1 AND kind NOT IN ('template', 'ai-action')",
            )?
            .query_row([path], |r| {
                Ok(Shown {
                    title: r.get(0)?,
                    icon: r.get(1)?,
                    excerpt: r.get(2)?,
                })
            })
            .optional()?)
    }
}
