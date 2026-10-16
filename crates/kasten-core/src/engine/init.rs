//! A new vault (`kasten init`): Kasten's folders, a config, the default
//! templates and tags, and history from the first minute. It starts with no
//! pages; the tour of the app is a page made only when asked for. Nothing
//! that already exists is overwritten.

use std::fs;
use std::path::{Path, PathBuf};

use super::{Change, Kasten};
use crate::atomic::create_atomic;
use crate::config::{CONFIG_PATH, Config};
use crate::error::Result;
use crate::history::Actor;
use crate::time::Instant;
use crate::vault::Vault;

const FOLDERS: [&str; 10] = [
    "inbox",
    "journal",
    "projects",
    "library",
    "sources",
    "chats",
    "templates",
    "tags",
    "assets",
    ".kasten/proposals",
];

macro_rules! defaults {
    ($dir:literal: $($name:literal),* $(,)?) => {
        [$(($name, include_str!(concat!("../../defaults/", $dir, "/", $name)))),*]
    };
}

pub const TEMPLATES: [(&str, &str); 59] = defaults!("templates":
    "area.md", "article-notes.md", "blog-post.md", "book-notes.md", "brainstorm.md", "budget.md",
    "bug-report.md", "card.md", "city-guide.md", "content-idea.md", "course-notes.md",
    "daily-planner.md", "decision.md", "evening-reflection.md", "event.md", "experiment.md",
    "fleeting-note.md", "goals.md", "gratitude.md", "habit-tracker.md", "interview.md",
    "job-application.md", "journal.md", "lecture.md", "literature-note.md", "literature-review.md",
    "map-of-content.md", "meal-plan.md", "meeting-series.md", "meeting.md", "monthly-review.md",
    "morning-pages.md", "newsletter.md", "one-on-one.md", "packing-list.md", "page.md", "paper.md",
    "permanent-note.md", "person.md", "podcast-notes.md", "product-spec.md", "project-brief.md",
    "project-kickoff.md", "project-update.md", "project.md", "quarterly-goals.md",
    "reading-list.md", "reading.md",
    "recipe.md", "retrospective.md", "road-trip.md", "study-plan.md", "thesis-chapter.md",
    "travel.md", "weekly-plan.md", "weekly-review.md", "weekly-status.md", "workout.md",
    "year-in-review.md",
);

pub const TAGS: [(&str, &str); 6] = defaults!("tags":
    "capture.yaml", "experiment.yaml", "meeting.yaml", "paper.yaml", "task.yaml", "travel.yaml");

const WELCOME: &str = include_str!("../../defaults/welcome.md");

/// The starter template called `name` (without `.md`) as it ships with the
/// app, for a vault that lacks it: made before it existed, or one the person
/// deleted. Only a plain template name is looked up.
pub fn shipped_template(name: &str) -> Option<&'static str> {
    TEMPLATES
        .iter()
        .find(|(file, _)| file.strip_suffix(".md") == Some(name))
        .map(|(_, text)| *text)
}

/// Where the tour of the app goes when someone asks for it.
pub const TOUR_PATH: &str = "library/welcome-to-kasten.md";

fn write_if_missing(path: &Path, text: &str) -> Result<()> {
    if path.exists() {
        return Ok(());
    }
    match create_atomic(path, text.as_bytes()) {
        Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        other => Ok(other?),
    }
}

impl Kasten {
    /// Makes `root` a vault (or completes one) and opens it with history.
    pub fn init(root: impl Into<PathBuf>, name: &str) -> Result<Kasten> {
        let root = crate::local_paths::resolve_root(&root.into())?;
        super::own_folders_in_place(&root)?;
        for folder in FOLDERS {
            crate::local_paths::check(&root.join(folder))?;
        }
        for folder in FOLDERS {
            fs::create_dir_all(root.join(folder))?;
        }
        if !root.join(CONFIG_PATH).exists() {
            Config {
                name: name.trim().to_owned(),
                ..Config::default()
            }
            .save(&root)?;
        }
        // Never through a link: the vault would not read what went there.
        let vault = Vault::open(&root)?;
        for (file, text) in TEMPLATES {
            if let Ok(path) = vault.file_of(&format!("templates/{file}"), &[".md"]) {
                write_if_missing(&path, text)?;
            }
        }
        for (file, text) in TAGS {
            if let Ok(path) = vault.file_of(&format!("tags/{file}"), &[".yaml"]) {
                write_if_missing(&path, text)?;
            }
        }
        let kasten = Kasten::open(&root)?;
        kasten.start_history()?;
        Ok(kasten)
    }
}

impl Kasten {
    /// The tour of the app as a page (Help, "Take the tour"), made the first
    /// time it is asked for. Later asks give the same page, untouched.
    pub fn add_tour(&self, actor: &Actor, now: Instant) -> Result<String> {
        if self.vault.exists(TOUR_PATH) {
            return Ok(TOUR_PATH.to_owned());
        }
        self.apply(actor, "tour", false, now.millis, |vault| {
            let path = vault.path_of(TOUR_PATH)?;
            if let Some(dir) = path.parent() {
                fs::create_dir_all(dir)?;
            }
            match create_atomic(&path, WELCOME.as_bytes()) {
                // Made meanwhile: it stays as it is.
                Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {}
                other => other?,
            }
            Ok(Change {
                message: "tour: Welcome to KastenFlow".into(),
                paths: vec![TOUR_PATH.to_owned()],
                value: TOUR_PATH.to_owned(),
            })
        })
    }
}

/// "Road trip" for `road-trip.md`.
fn label(file: &str) -> String {
    let name = file.trim_end_matches(".md").replace(['-', '_'], " ");
    let mut chars = name.chars();
    chars
        .next()
        .map(|c| c.to_uppercase().chain(chars).collect())
        .unwrap_or_default()
}

/// "A", "A and B", "A, B and C", or a count past five.
fn listing(names: &[String]) -> String {
    match names {
        [] => String::new(),
        [one] => one.clone(),
        many if many.len() > 5 => format!("{} starter templates", many.len()),
        [rest @ .., last] => format!("{} and {last}", rest.join(", ")),
    }
}

impl Kasten {
    /// Starter templates this vault lacks, by name: ones that shipped after
    /// it was made, or that were deleted.
    pub fn missing_templates(&self) -> Result<Vec<String>> {
        let dir = self.vault.root().join("templates");
        Ok(TEMPLATES
            .iter()
            .filter(|(file, _)| !dir.join(file).exists())
            .map(|(file, _)| file.trim_end_matches(".md").to_owned())
            .collect())
    }

    /// Adds the missing starter templates in one commit. A template the
    /// vault already has is never touched.
    pub fn add_starter_templates(&self, actor: &Actor, now: Instant) -> Result<Vec<String>> {
        if self.missing_templates()?.is_empty() {
            return Ok(Vec::new());
        }
        self.apply(actor, "add_templates", false, now.millis, |vault| {
            let dir = vault.root().join("templates");
            fs::create_dir_all(&dir)?;
            let mut paths = Vec::new();
            let mut names = Vec::new();
            for (file, text) in TEMPLATES {
                let path = vault.path_of(&format!("templates/{file}"))?;
                match create_atomic(&path, text.as_bytes()) {
                    Ok(()) => {
                        paths.push(format!("templates/{file}"));
                        names.push(label(file));
                    }
                    // Made meanwhile: it stays as it is.
                    Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {}
                    Err(err) => return Err(err.into()),
                }
            }
            Ok(Change {
                message: format!("templates: add {}", listing(&names)),
                value: paths.clone(),
                paths,
            })
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_templates_for_the_commit() {
        assert_eq!(label("road-trip.md"), "Road trip");
        let names = |n: &[&str]| n.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(listing(&names(&["Recipe"])), "Recipe");
        assert_eq!(listing(&names(&["A", "B", "C"])), "A, B and C");
        assert_eq!(
            listing(&names(&["A", "B", "C", "D", "E", "F"])),
            "6 starter templates"
        );
    }

    #[test]
    fn defaults_match_the_dev_vault() {
        let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/dev-vault");
        for (file, text) in TEMPLATES {
            assert_eq!(
                fs::read_to_string(dev.join("templates").join(file)).unwrap(),
                text,
                "templates/{file}"
            );
        }
        for (file, text) in TAGS {
            assert_eq!(
                fs::read_to_string(dev.join("tags").join(file)).unwrap(),
                text,
                "tags/{file}"
            );
        }
    }
}
