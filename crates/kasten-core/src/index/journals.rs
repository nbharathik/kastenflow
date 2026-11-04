//! The index queries behind project journals: which projects wrote on a
//! day (for the vault's own journal), and the days of one project's journal
//! (for its peek). Both read the index; neither walks the disk.

use rusqlite::params;
use serde::Serialize;

use super::Index;
use crate::error::Result;
use crate::journal_path::project_journal_of;

/// A project that has a journal note for a day.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectJournalRef {
    /// The project's folder under `projects/`.
    pub project: String,
    /// The project page's title (the folder name when it has none).
    pub project_title: String,
    /// The day's note, `projects/<project>/journal/<year>/<date>.md`.
    pub path: String,
    /// `YYYY-MM-DD`.
    pub date: String,
}

/// One day of a project's journal, as a list shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectJournalEntry {
    /// `YYYY-MM-DD`.
    pub date: String,
    pub path: String,
    /// The first readable text of the day.
    pub excerpt: String,
    pub words: u32,
    /// Last modification, in milliseconds since the Unix epoch.
    pub modified: u64,
}

/// A page of a project's journal days, newest first.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectJournalPage {
    pub project: String,
    pub project_title: String,
    /// How many days the journal has, whatever page this is.
    pub total: usize,
    pub days: Vec<ProjectJournalEntry>,
}

/// The GLOB for the day files of a project's journal, `folder` a clean slug
/// (letters, digits and dashes: nothing GLOB reads specially).
fn day_files(folder: &str) -> String {
    format!(
        "projects/{folder}/journal/[0-9][0-9][0-9][0-9]/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].md"
    )
}

impl Index {
    /// The project journals that have the day `date` (`YYYY-MM-DD`), by the
    /// projects' titles. Trashed projects are not in the index; archived
    /// ones are, and keep their journals.
    pub fn project_journals_on(&self, date: &str) -> Result<Vec<ProjectJournalRef>> {
        let year = date.get(..4).unwrap_or("");
        let mut stmt = self.conn.prepare_cached(
            "SELECT n.project, COALESCE(p.title, n.project), n.path
             FROM notes n LEFT JOIN notes p ON p.path = 'projects/' || n.project || '/_project.md'
             WHERE n.project IS NOT NULL
               AND n.path = 'projects/' || n.project || '/journal/' || ?1 || '/' || ?2 || '.md'
             ORDER BY lower(COALESCE(p.title, n.project)), n.project",
        )?;
        let rows = stmt.query_map(params![year, date], |r| {
            Ok(ProjectJournalRef {
                project: r.get(0)?,
                project_title: r.get(1)?,
                path: r.get(2)?,
                date: date.to_owned(),
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// The days of the journal of the project in `folder`, newest first:
    /// `limit` of them after the first `offset`, and how many there are.
    pub fn project_journal_days(
        &self,
        folder: &str,
        limit: usize,
        offset: usize,
    ) -> Result<(usize, Vec<ProjectJournalEntry>)> {
        let files = day_files(folder);
        let total = self.conn.query_row(
            "SELECT COUNT(*) FROM notes WHERE project = ?1 AND path GLOB ?2",
            params![folder, files],
            |r| r.get::<_, i64>(0),
        )? as usize;
        let mut stmt = self.conn.prepare_cached(
            "SELECT path, excerpt, words, modified FROM notes
             WHERE project = ?1 AND path GLOB ?2 ORDER BY path DESC LIMIT ?3 OFFSET ?4",
        )?;
        let rows = stmt.query_map(params![folder, files, limit as i64, offset as i64], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, u32>(2)?,
                r.get::<_, i64>(3)? as u64,
            ))
        })?;
        let mut days = Vec::new();
        for row in rows {
            let (path, excerpt, words, modified) = row?;
            if let Some((_, date)) = project_journal_of(&path) {
                days.push(ProjectJournalEntry {
                    date: date.to_owned(),
                    path,
                    excerpt,
                    words,
                    modified,
                });
            }
        }
        Ok((total, days))
    }
}
