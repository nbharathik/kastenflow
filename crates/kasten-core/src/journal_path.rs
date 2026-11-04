//! Where a journal day lives. The vault's journal has one note a day,
//! `journal/<year>/<date>.md`; a project's has its own, in the project's
//! folder: `projects/<project>/journal/<year>/<date>.md`. Every op, query
//! and importer names a day's file through here, so the two stay one rule.

use crate::error::{Error, Result};
use crate::slug::slugify;
use crate::template_vars::day_and_time;
use crate::vault::Vault;

/// The file of a day already known to be `YYYY-MM-DD`, in the vault's
/// journal or in the folder of a project already known to be a clean name.
/// Only the checked entry points below and the importers (which read their
/// days from file names they have parsed) use it.
pub(crate) fn day_file(project: Option<&str>, day: &str) -> String {
    match project {
        None => format!("journal/{}/{day}.md", &day[..4]),
        Some(folder) => format!("projects/{folder}/journal/{}/{day}.md", &day[..4]),
    }
}

/// The folder a project's name means: the name as the person or agent writes
/// it (`Photo Organiser`, `photo-organiser`) as a folder name under
/// `projects/`. Refuses what is not one name: nothing, a path, a way up
/// (`../x`, `a/b`), a hidden name, control characters, or no letters.
fn project_folder(project: &str) -> Result<String> {
    let name = project.trim();
    let bad = name.is_empty()
        || name.starts_with('.')
        || name.contains(['/', '\\'])
        || name.contains("..")
        || name.chars().any(char::is_control)
        || !name.chars().any(char::is_alphanumeric);
    if bad {
        return Err(Error::Invalid(format!("Not a project folder: {project}")));
    }
    Ok(slugify(name))
}

/// The path of the journal day `date` (`YYYY-MM-DD`, or with a `THH:MM` time
/// that is dropped) in the vault's journal (`project` None) or in the
/// project's. Checks the spelling of both and nothing on disk: the project
/// need not exist (`journal_path_in` asks that).
pub fn journal_path(project: Option<&str>, date: &str) -> Result<String> {
    let Some((day, _)) = day_and_time(date) else {
        return Err(Error::Invalid(format!("Not a day: {date}")));
    };
    match project {
        None => Ok(day_file(None, day)),
        Some(name) => Ok(day_file(Some(&project_folder(name)?), day)),
    }
}

/// `journal_path`, and the project (when there is one) has to exist in the
/// vault: a folder under `projects/` with a `_project.md`.
pub fn journal_path_in(vault: &Vault, project: Option<&str>, date: &str) -> Result<String> {
    let path = journal_path(project, date)?;
    if let Some(name) = project {
        project_folder_in(vault, name)?;
    }
    Ok(path)
}

/// The folder of the project `name` means, when the vault has it: a folder
/// under `projects/` with a `_project.md`.
pub(crate) fn project_folder_in(vault: &Vault, name: &str) -> Result<String> {
    let folder = project_folder(name)?;
    if vault.exists(&format!("projects/{folder}/_project.md")) {
        Ok(folder)
    } else {
        Err(Error::Invalid(format!(
            "No project called {}; list_projects names them",
            name.trim()
        )))
    }
}

/// The project and the day of a path that is a project's journal day,
/// `projects/<project>/journal/<year>/<date>.md`.
pub fn project_journal_of(path: &str) -> Option<(&str, &str)> {
    let mut parts = path.split('/');
    let (Some("projects"), Some(project), Some("journal"), Some(year), Some(file), None) = (
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
    ) else {
        return None;
    };
    let day = file.strip_suffix(".md")?;
    (!project.is_empty() && crate::template_vars::valid_day(day) && day.starts_with(year))
        .then_some((project, day))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_vault_journal_is_by_year() {
        assert_eq!(
            journal_path(None, "2026-11-03").unwrap(),
            "journal/2026/2026-11-03.md"
        );
        // A time on the day is dropped: the day is the file.
        assert_eq!(
            journal_path(None, "2026-11-03T09:30").unwrap(),
            "journal/2026/2026-11-03.md"
        );
    }

    #[test]
    fn a_project_journal_is_in_the_project_folder() {
        assert_eq!(
            journal_path(Some("photo-organiser"), "2026-11-03").unwrap(),
            "projects/photo-organiser/journal/2026/2026-11-03.md"
        );
        // Spelled as a title, it is the folder the title makes.
        assert_eq!(
            journal_path(Some("  Photo Organiser "), "2026-11-03").unwrap(),
            "projects/photo-organiser/journal/2026/2026-11-03.md"
        );
    }

    #[test]
    fn a_bad_day_is_refused() {
        for date in [
            "",
            "soon",
            "24.09.2026",
            "2026-9-4",
            "2026-11-03T25:00",
            "../2026-11-03",
            "2026/11/03",
            "2026-11-03.md",
        ] {
            for project in [None, Some("photo-organiser")] {
                let err = journal_path(project, date).unwrap_err().to_string();
                assert!(err.contains("Not a day"), "{date:?}: {err}");
            }
        }
    }

    #[test]
    fn a_project_that_is_not_one_folder_name_is_refused() {
        for project in [
            "",
            "   ",
            "../x",
            "..",
            "a/b",
            "a\\b",
            "projects/x",
            ".hidden",
            "x/../y",
            "???",
            "line\nbreak",
        ] {
            let err = journal_path(Some(project), "2026-11-03").unwrap_err();
            assert!(
                err.to_string().contains("Not a project folder"),
                "{project:?}: {err}"
            );
        }
    }

    #[test]
    fn finds_the_project_and_day_of_a_project_journal_path() {
        assert_eq!(
            project_journal_of("projects/p/journal/2026/2026-11-03.md"),
            Some(("p", "2026-11-03"))
        );
        for path in [
            "journal/2026/2026-11-03.md",
            "projects/p/pages/2026-11-03.md",
            "projects/p/journal/2026/notes.md",
            "projects/p/journal/2025/2026-11-03.md",
            "projects/p/journal/2026/2026-11-03.md/x",
            "projects/p/journal/2026/2026-11-03.canvas",
            "projects//journal/2026/2026-11-03.md",
        ] {
            assert_eq!(project_journal_of(path), None, "{path}");
        }
    }
}
