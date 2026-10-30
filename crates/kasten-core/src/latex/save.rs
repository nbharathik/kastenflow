//! Saving a LaTeX source file as it is typed: written when the file is as
//! the editor loaded it, merged when other lines changed meanwhile, and put
//! in a copy beside it when the same lines changed.

use serde::Serialize;

use crate::merge::merge3;
use crate::note::content_hash;
use crate::time::Instant;

/// A source file: its text and the hash a save brings back.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceFile {
    pub path: String,
    pub text: String,
    pub hash: String,
}

impl SourceFile {
    pub fn new(path: &str, text: String) -> SourceFile {
        SourceFile {
            path: path.to_owned(),
            hash: content_hash(&text),
            text,
        }
    }
}

/// The result of saving a source file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SourceSaved {
    /// Written; `file` is the file as it is now.
    Written { file: SourceFile },
    /// The text was already there; nothing was written.
    Unchanged { file: SourceFile },
    /// The file changed on other lines since it was loaded: both sets of
    /// edits were merged and written.
    Merged { file: SourceFile },
    /// The file changed on the same lines. The editor's text went to
    /// `copy` and the file was left alone.
    Conflict { copy: String, file: SourceFile },
}

impl SourceSaved {
    /// The file as it is on disk after the save.
    pub fn file(&self) -> &SourceFile {
        match self {
            SourceSaved::Written { file }
            | SourceSaved::Unchanged { file }
            | SourceSaved::Merged { file }
            | SourceSaved::Conflict { file, .. } => file,
        }
    }
}

/// What a save comes to, before anything is written.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Plan {
    Unchanged,
    Write(String),
    Merged(String),
    Conflict,
}

/// What saving `text` comes to, written against the file that had
/// `base_hash` (its text `base`, when it is still remembered) while the file
/// holds `current`.
pub(crate) fn plan(current: &str, base_hash: &str, base: Option<&str>, text: &str) -> Plan {
    if text == current {
        return Plan::Unchanged;
    }
    if content_hash(current) == base_hash {
        return Plan::Write(text.to_owned());
    }
    match base.and_then(|base| merge3(base, text, current)) {
        Some(merged) if merged == current => Plan::Unchanged,
        Some(merged) => Plan::Merged(merged),
        None => Plan::Conflict,
    }
}

/// `<name> (conflict <time>).<ext>` beside `path`, the first that is free.
pub(crate) fn conflict_path(exists: impl Fn(&str) -> bool, path: &str, now: Instant) -> String {
    let (stem, ext) = path.rsplit_once('.').unwrap_or((path, ""));
    let label = format!("conflict {}", now.file_stamp());
    let stem = crate::save::fitting(stem, label.len() + ext.len());
    let mut copy = format!("{stem} ({label}).{ext}");
    let mut n = 2;
    while exists(&copy) {
        copy = format!("{stem} ({label} {n}).{ext}");
        n += 1;
    }
    copy
}

#[cfg(test)]
mod tests {
    use super::*;

    const BASE: &str = "one\ntwo\nthree\n";

    #[test]
    fn writes_when_the_file_is_as_it_was_loaded() {
        let plan = plan(BASE, &content_hash(BASE), Some(BASE), "one\nTWO\nthree\n");
        assert_eq!(plan, Plan::Write("one\nTWO\nthree\n".to_owned()));
        // The same text again writes nothing.
        assert_eq!(super::plan(BASE, "anything", None, BASE), Plan::Unchanged);
    }

    #[test]
    fn merges_edits_on_other_lines() {
        let theirs = "ONE\ntwo\nthree\n";
        let ours = "one\ntwo\nTHREE\n";
        assert_eq!(
            plan(theirs, &content_hash(BASE), Some(BASE), ours),
            Plan::Merged("ONE\ntwo\nTHREE\n".to_owned())
        );
    }

    #[test]
    fn keeps_a_copy_when_the_same_lines_changed_or_the_base_is_gone() {
        let theirs = "one\ntwo!\nthree\n";
        let ours = "one\ntwo?\nthree\n";
        assert_eq!(
            plan(theirs, &content_hash(BASE), Some(BASE), ours),
            Plan::Conflict
        );
        assert_eq!(
            plan(theirs, &content_hash(BASE), None, ours),
            Plan::Conflict
        );
    }

    #[test]
    fn names_the_copy_beside_the_file_and_never_over_another() {
        let now = Instant {
            millis: 1_790_236_800_000,
        };
        let first = conflict_path(|_| false, "p/latex/a/main.tex", now);
        assert!(first.starts_with("p/latex/a/main (conflict "), "{first}");
        assert!(first.ends_with(").tex"), "{first}");
        let taken = first.clone();
        let second = conflict_path(|p| p == taken, "p/latex/a/main.tex", now);
        assert_ne!(first, second);
        assert!(second.ends_with(" 2).tex"), "{second}");
    }
}
