//! Project journals: adding to a day of the vault's journal or a project's,
//! and the two lists the journal views read (the projects that wrote on a
//! day, and the days of one project's journal). Both lists come from the
//! index; `journal_day` itself is in notes.rs.

use kasten_core::index::{ProjectJournalPage, ProjectJournalRef};
use kasten_core::{Instant, Kasten, NoteFile};
use tauri::State;

use super::notes::{HUMAN, OpenVault};

/// Adds Markdown to a journal day of the vault (`project` none) or of a
/// project, making the day from its template if it is new; at the end of the
/// day or under `heading`. One commit.
#[tauri::command(async)]
pub fn journal_append(
    state: State<'_, OpenVault>,
    date: String,
    markdown: String,
    heading: Option<String>,
    project: Option<String>,
) -> Result<NoteFile, String> {
    state.run(|k| {
        k.journal_append(
            &HUMAN,
            project.as_deref(),
            &date,
            &markdown,
            heading.as_deref(),
            Instant::now(),
        )
    })
}

/// The project journals that have a note for `date` (`YYYY-MM-DD`), by the
/// projects' titles.
#[tauri::command(async)]
pub fn project_journals_on(
    state: State<'_, OpenVault>,
    date: String,
) -> Result<Vec<ProjectJournalRef>, String> {
    state.run(|k: &Kasten| k.project_journals_on(&date))
}

/// The days of a project's journal, newest first: `limit` (default 30, at
/// most 200) after the first `offset` (default 0), and how many there are.
#[tauri::command(async)]
pub fn project_journal_days(
    state: State<'_, OpenVault>,
    project: String,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<ProjectJournalPage, String> {
    state.run(|k: &Kasten| {
        k.project_journal_days(&project, limit.unwrap_or(30), offset.unwrap_or(0))
    })
}
