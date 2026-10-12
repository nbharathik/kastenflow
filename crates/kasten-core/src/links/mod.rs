//! Wiki links and the notes they go to. A link names a note by
//! its title, or by its path when other notes share the title:
//! `[[projects/trip/pages/test|Test]]`. A title several notes share goes to
//! the one in the linking note's project; when that does not pick one, the
//! reader is asked.

use std::borrow::Cow;
use std::collections::HashMap;

use crate::note::NoteMeta;

pub mod keep;
pub(crate) mod scan;

#[cfg(test)]
mod keep_tests;
#[cfg(test)]
mod tests;

/// A link's parts: `[[target#heading|alias]]`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LinkParts<'a> {
    pub target: &'a str,
    pub heading: Option<&'a str>,
    pub alias: Option<&'a str>,
}

/// Splits a link's inner text at its first `|`, then its first `#`.
pub fn parts(inner: &str) -> LinkParts<'_> {
    let (head, alias) = match inner.split_once('|') {
        Some((head, alias)) => (head, Some(alias)),
        None => (inner, None),
    };
    let (target, heading) = match head.split_once('#') {
        Some((target, heading)) => (target, Some(heading.trim())),
        None => (head, None),
    };
    LinkParts {
        target: target.trim(),
        heading,
        alias,
    }
}

/// Whether a title can stand as a link's target as it is.
fn linkable(title: &str) -> bool {
    !title.trim().is_empty() && !title.contains(['[', ']', '|', '#'])
}

/// Where a link is written: its note's path and project.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Place<'a> {
    pub path: &'a str,
    pub project: Option<&'a str>,
}

impl<'a> Place<'a> {
    pub fn of(note: &'a NoteMeta) -> Place<'a> {
        Place {
            path: &note.path,
            project: note.project.as_deref(),
        }
    }
}

/// Where a link goes.
#[derive(Debug, Clone, PartialEq)]
pub enum Resolution<'a> {
    Note(&'a NoteMeta),
    /// Several notes share the title and nothing picks one: the reader chooses.
    Ambiguous(Vec<&'a NoteMeta>),
    Missing,
}

/// A path as a link names it: lowercase, without `.md`.
pub fn path_key(path: &str) -> String {
    let lower = path.trim().to_lowercase();
    lower
        .strip_suffix(".md")
        .map(str::to_owned)
        .unwrap_or(lower)
}

/// A title as links match it.
pub fn title_key(title: &str) -> String {
    title.trim().to_lowercase()
}

/// `text` in lowercase, copied only when it has capitals to change: the
/// index keeps link targets lowercase, and following ten thousand notes' links
/// need not copy each one.
fn lowered(text: &str) -> Cow<'_, str> {
    if text.is_ascii() && !text.bytes().any(|b| b.is_ascii_uppercase()) {
        Cow::Borrowed(text)
    } else {
        Cow::Owned(text.to_lowercase())
    }
}

/// Whether a path names a note by its file, in any case.
fn ends_with_md(path: &str) -> bool {
    path.len() >= 3 && path.as_bytes()[path.len() - 3..].eq_ignore_ascii_case(b".md")
}

/// The vault's notes by path and by title, to follow links.
pub struct Directory<'a> {
    by_path: HashMap<String, &'a NoteMeta>,
    by_title: HashMap<String, Vec<&'a NoteMeta>>,
}

impl<'a> Directory<'a> {
    /// Templates are left out: no link goes to one.
    pub fn new(notes: impl IntoIterator<Item = &'a NoteMeta>) -> Directory<'a> {
        let mut by_path = HashMap::new();
        let mut by_title: HashMap<String, Vec<&'a NoteMeta>> = HashMap::new();
        for note in notes {
            if note.kind == "template" || note.path.starts_with("templates/") {
                continue;
            }
            by_path.insert(path_key(&note.path), note);
            by_title
                .entry(title_key(&note.title))
                .or_default()
                .push(note);
        }
        for list in by_title.values_mut() {
            list.sort_by(|a, b| a.path.cmp(&b.path));
        }
        Directory { by_path, by_title }
    }

    /// Notes with this title, by path.
    pub fn titled(&self, title: &str) -> &[&'a NoteMeta] {
        self.by_title
            .get(lowered(title.trim()).as_ref())
            .map_or(&[], Vec::as_slice)
    }

    /// The note at `path`, in any case.
    pub fn note(&self, path: &str) -> Option<&'a NoteMeta> {
        self.by_path.get(&path_key(path)).copied()
    }

    /// Where a link to `target`, written at `from`, goes.
    pub fn resolve(&self, target: &str, from: Place) -> Resolution<'a> {
        let target = target.trim();
        if (target.contains('/') || ends_with_md(target))
            && let Some(note) = self.note(target)
        {
            return Resolution::Note(note);
        }
        let all = self.titled(target);
        // The usual link: one note has the title (a note's link to its own
        // title goes to it too, when none else has it).
        match all {
            [] => return Resolution::Missing,
            [only] => return Resolution::Note(only),
            _ => {}
        }
        // A note's link to its own title means another note by that title.
        let others: Vec<&'a NoteMeta> = all
            .iter()
            .copied()
            .filter(|n| n.path != from.path)
            .collect();
        let candidates = if others.is_empty() {
            all.to_vec()
        } else {
            others
        };
        match candidates.as_slice() {
            [] => return Resolution::Missing,
            [only] => return Resolution::Note(only),
            _ => {}
        }
        let near: Vec<&'a NoteMeta> = candidates
            .iter()
            .copied()
            .filter(|n| n.project.as_deref() == from.project)
            .collect();
        match near.len() {
            1 => Resolution::Note(near[0]),
            0 => Resolution::Ambiguous(candidates),
            _ => Resolution::Ambiguous(near),
        }
    }

    /// How a link at `from` names `note`: its title when that finds it,
    /// else its path with the title to show.
    pub fn target_for(&self, note: &NoteMeta, from: Place) -> (String, Option<String>) {
        if linkable(&note.title)
            && matches!(self.resolve(&note.title, from), Resolution::Note(found) if found.path == note.path)
        {
            return (note.title.trim().to_owned(), None);
        }
        let path = note.path.strip_suffix(".md").unwrap_or(&note.path);
        let shown: String = note
            .title
            .chars()
            .filter(|c| !matches!(c, '[' | ']' | '|'))
            .collect();
        (
            path.to_owned(),
            Some(shown.trim().to_owned()).filter(|s| !s.is_empty()),
        )
    }
}
