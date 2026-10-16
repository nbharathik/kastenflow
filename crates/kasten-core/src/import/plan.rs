//! What an import will write, worked out before anything is: the project
//! page, notes, journal days, boards, tag schemas and files, with warnings
//! about what did not come across as it was.

use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};

use super::{ImportKind, ImportSummary};
use crate::slug::slugify;
use crate::time::Instant;
use crate::vault::Vault;

/// What every importer needs.
pub(crate) struct Context<'a> {
    pub vault: &'a Vault,
    /// The folder being imported.
    pub root: &'a Path,
    pub kind: ImportKind,
    /// The new project's title, and its folder name in `projects/` and `assets/`.
    pub project: String,
    pub slug: String,
    pub now: Instant,
    /// Whether a note id is in the vault already.
    pub id_taken: &'a dyn Fn(&str) -> bool,
}

impl Context<'_> {
    pub fn folder(&self) -> String {
        format!("projects/{}", self.slug)
    }
}

/// A text file the import makes.
#[derive(Debug, Clone)]
pub(crate) struct Written {
    pub path: String,
    pub text: String,
}

/// A journal day: made, or added to the day already there.
#[derive(Debug, Clone)]
pub(crate) struct Day {
    pub date: String,
    /// The whole note for a new day; for a day already here, only its body.
    pub text: String,
    pub tags: Vec<String>,
    pub exists: bool,
}

/// A file copied as it is.
#[derive(Debug, Clone)]
pub(crate) struct Copied {
    pub path: String,
    pub from: PathBuf,
}

/// A PDF kept in `sources/` with an empty sidecar; `reuse` when the same
/// bytes are there already.
#[derive(Debug, Clone)]
pub(crate) struct Pdf {
    pub path: String,
    pub from: PathBuf,
    pub title: String,
    pub reuse: bool,
}

#[derive(Debug)]
pub(crate) struct Plan {
    pub kind: ImportKind,
    pub project: String,
    /// `projects/<slug>`.
    pub folder: String,
    /// The project page, then every note.
    pub notes: Vec<Written>,
    pub days: Vec<Day>,
    pub boards: Vec<Written>,
    pub tags: Vec<Written>,
    pub copies: Vec<Copied>,
    pub pdfs: Vec<Pdf>,
    pub warnings: Warnings,
}

fn plural(n: usize, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}

impl Plan {
    pub fn summary(&self) -> ImportSummary {
        ImportSummary {
            kind: self.kind,
            project: self.project.clone(),
            project_path: format!("{}/_project.md", self.folder),
            notes: self.notes.len().saturating_sub(1),
            days: self.days.iter().filter(|d| !d.exists).count(),
            days_appended: self.days.iter().filter(|d| d.exists).count(),
            boards: self.boards.len(),
            files: self.copies.len() + self.pdfs.len(),
            tags: self.tags.len(),
            warnings: self.warnings.sentences(),
            conflicts: Vec::new(),
        }
    }

    /// "8 notes, 2 journal days, 1 board, 3 files", leaving out what is none.
    pub fn counts(&self) -> Vec<String> {
        let s = self.summary();
        [
            (s.notes, "note", "notes"),
            (s.days + s.days_appended, "journal day", "journal days"),
            (s.boards, "board", "boards"),
            (s.files, "file", "files"),
            (s.tags, "tag", "tags"),
        ]
        .into_iter()
        .filter(|(n, _, _)| *n > 0)
        .map(|(n, one, many)| plural(n, one, many))
        .collect()
    }

    /// The commit message.
    pub fn message(&self) -> String {
        let counts = self.counts();
        let counts = if counts.is_empty() {
            "nothing".to_owned()
        } else {
            counts.join(", ")
        };
        format!(
            "import: {} “{}” ({counts})",
            self.kind.label(),
            self.project
        )
    }
}

/// The project page's body: where it came from and what came.
pub(crate) fn project_body(kind: ImportKind, day: &str, counts: &[String]) -> String {
    let what = match counts {
        [] => "nothing".to_owned(),
        [one] => one.clone(),
        [rest @ .., last] => format!("{} and {last}", rest.join(", ")),
    };
    format!("Imported from {} on {day}: {what}.\n", kind.with_article())
}

/// Something that did not come across as it was.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Warn {
    NoteType,
    OriginalId,
    BadFrontmatter,
    NotText,
    TooBig,
    MissingBoardFile,
    BadBoard,
    TagKept,
}

#[derive(Debug, Default)]
pub(crate) struct Warnings {
    by: BTreeMap<Warn, Vec<String>>,
}

impl Warnings {
    pub fn add(&mut self, warn: Warn, what: impl Into<String>) {
        self.by.entry(warn).or_default().push(what.into());
    }

    /// One sentence per kind of warning, naming up to five of what it is about.
    pub fn sentences(&self) -> Vec<String> {
        self.by
            .iter()
            .map(|(warn, items)| {
                let n = items.len();
                let many = n != 1;
                let (was, is) = if many { ("were", "are") } else { ("was", "is") };
                let mut list = items.iter().take(5).cloned().collect::<Vec<_>>().join(", ");
                if n > 5 {
                    list.push_str(&format!(" and {} more", n - 5));
                }
                let notes = plural(n, "note", "notes");
                match warn {
                    Warn::NoteType => format!(
                        "{notes} had a `type` of {} own; it is kept as `note-type`, since `type` says what kind of note it is in KastenFlow: {list}.",
                        if many { "their" } else { "its" }
                    ),
                    Warn::OriginalId => format!(
                        "{notes} had an `id` that is not a KastenFlow id; it is kept as `original-id`: {list}."
                    ),
                    Warn::BadFrontmatter => format!(
                        "{notes} had frontmatter that is not valid YAML; it is kept at the top of the page as a code block: {list}."
                    ),
                    Warn::NotText => {
                        format!("{notes} {is} not UTF-8 text and {was} left out: {list}.")
                    }
                    Warn::TooBig => format!(
                        "{} over {} MB {was} left out: {list}.",
                        plural(n, "file", "files"),
                        MAX_FILE_BYTES / 1024 / 1024
                    ),
                    Warn::MissingBoardFile => format!(
                        "{} {} to a file that is not in the import: {list}.",
                        plural(n, "board card", "board cards"),
                        if many { "point" } else { "points" }
                    ),
                    Warn::TagKept => format!(
                        "{} already had a schema here, which is kept as it was: {list}.",
                        plural(n, "tag", "tags")
                    ),
                    Warn::BadBoard => format!(
                        "{} {is} not valid JSON Canvas and {was} left out: {list}.",
                        plural(n, "canvas", "canvases")
                    ),
                }
            })
            .collect()
    }
}

/// Files bigger than this stay out of the vault, whose history keeps
/// every version of every file.
pub(crate) const MAX_FILE_BYTES: u64 = 100 * 1024 * 1024;

/// A title as Kasten links it: no `[`, `]`, `|`, `#` or `^`, which would
/// end a `[[link]]`, and no line breaks.
pub(crate) fn clean_title(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| {
            if matches!(c, '[' | ']' | '|' | '#' | '^') || c.is_control() {
                ' '
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    if cleaned.is_empty() {
        "Untitled".to_owned()
    } else {
        cleaned
    }
}

/// Titles unique within the import, ignoring case: a title several notes
/// want gets each one's `label` (its folder), then a number.
pub(crate) fn unique_titles(wanted: &[(String, String)]) -> Vec<String> {
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for (title, _) in wanted {
        *counts.entry(title.to_lowercase()).or_default() += 1;
    }
    let mut taken: HashSet<String> = wanted
        .iter()
        .filter(|(title, _)| counts[&title.to_lowercase()] == 1)
        .map(|(title, _)| title.to_lowercase())
        .collect();
    wanted
        .iter()
        .map(|(title, label)| {
            if counts[&title.to_lowercase()] == 1 {
                return title.clone();
            }
            let base = if label.is_empty() {
                title.clone()
            } else {
                format!("{title} ({label})")
            };
            let mut candidate = base.clone();
            let mut n = 2;
            while !taken.insert(candidate.to_lowercase()) {
                candidate = format!("{base} {n}");
                n += 1;
            }
            candidate
        })
        .collect()
}

/// File names the import has given out, so no two plans share one and
/// none lands on a file already in the vault.
#[derive(Debug, Default)]
pub(crate) struct Names {
    taken: HashSet<String>,
}

impl Names {
    /// Takes `path` if no plan has it yet.
    pub fn claim(&mut self, path: &str) -> bool {
        self.taken.insert(path.to_lowercase())
    }

    /// The first free `dir/stem.ext`, `dir/stem-2.ext`, … (`ext` with its dot).
    pub fn free(&mut self, vault: &Vault, dir: &str, stem: &str, ext: &str) -> String {
        let stem = slugify(stem);
        for n in 1.. {
            let name = if n == 1 {
                format!("{stem}{ext}")
            } else {
                format!("{stem}-{n}{ext}")
            };
            let path = if dir.is_empty() {
                name
            } else {
                format!("{dir}/{name}")
            };
            let there = vault.root().join(&path).exists();
            if !there && self.taken.insert(path.to_lowercase()) {
                return path;
            }
        }
        unreachable!("names run out only after usize::MAX files")
    }
}

/// A folder path with each part as a slug: `Travel/Summer 2026` → `travel/summer-2026`.
pub(crate) fn slug_path(folder: &str) -> String {
    folder
        .split('/')
        .filter(|part| !part.is_empty())
        .map(slugify)
        .collect::<Vec<_>>()
        .join("/")
}

/// A file's time as frontmatter writes it, or the time now.
pub(crate) fn stamp(modified: Option<u64>, now: Instant) -> String {
    Instant {
        millis: modified.unwrap_or(now.millis),
    }
    .rfc3339()
}
