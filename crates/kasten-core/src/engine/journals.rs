//! Project journals as the engine answers them: which projects wrote on a
//! day, the days of one project's journal, and the checks and words the
//! journal ops share. The days themselves are made by `Kasten::journal`.

use super::Kasten;
use crate::error::{Error, Result};
use crate::index::{ProjectJournalPage, ProjectJournalRef};
use crate::journal_path::{journal_path_in, project_folder_in};
use crate::slug::slugify;

/// The most days a page of a project's journal holds.
pub const MOST_JOURNAL_DAYS: usize = 200;

impl Kasten {
    /// The title of the project `project` means, for a reviewer's sentence;
    /// the name as written when the vault has no such project.
    pub(super) fn project_title(&self, project: Option<&str>) -> String {
        let Some(name) = project else {
            return String::new();
        };
        let folder = slugify(name.trim());
        self.vault
            .read(&format!("projects/{folder}/_project.md"))
            .map_or_else(|_| name.trim().to_owned(), |page| page.meta.title)
    }

    /// What no mode lifts for a journal op: the day must be a day, and the
    /// project (if one is named) one the vault has.
    pub(super) fn journal_refusals(&self, project: Option<&str>, date: &str) -> Result<()> {
        journal_path_in(&self.vault, project, date).map(|_| ())
    }

    /// The project journals that have a note for `date` (`YYYY-MM-DD`), by
    /// project title, for the vault's own journal page. From the index.
    pub fn project_journals_on(&self, date: &str) -> Result<Vec<ProjectJournalRef>> {
        if !crate::dates::is_real_day(date) {
            return Err(Error::Invalid(format!("Not a day: {date}")));
        }
        self.index().project_journals_on(date)
    }

    /// The days of a project's journal, newest first: up to `limit` (at most
    /// `MOST_JOURNAL_DAYS`) after the first `offset`, with how many days there
    /// are. `project` is its folder name or title. From the index.
    pub fn project_journal_days(
        &self,
        project: &str,
        limit: usize,
        offset: usize,
    ) -> Result<ProjectJournalPage> {
        let folder = project_folder_in(&self.vault, project)?;
        let limit = limit.clamp(1, MOST_JOURNAL_DAYS);
        let (total, days) = self.index().project_journal_days(&folder, limit, offset)?;
        Ok(ProjectJournalPage {
            project_title: self.project_title(Some(&folder)),
            project: folder,
            total,
            days,
        })
    }
}
