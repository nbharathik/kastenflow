//! Checks that `kasten:` links point at notes that still exist. A link such
//! as `[the plan](kasten:note/01J8Z3K6Q2M4X7V9B1C5D8E0F2#Risks)` names a note by
//! its id, so it survives renames and moves; one whose id is no longer any
//! note's (the note was trashed or deleted) is reported. Nothing is changed.

use std::fs;

use super::{Kasten, Problem};
use crate::error::Result;

/// How a link to a note starts.
const NOTE_LINK: &str = "kasten:note/";
/// The longest id read from a link.
const MAX_ID: usize = 64;

/// `line` without its inline code spans (a link shown as code is no link).
fn without_code(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut inside = false;
    for part in line.split('`') {
        if !inside {
            out.push_str(part);
        }
        inside = !inside;
    }
    // An odd number of backticks leaves the last span open: it was no span.
    if line.matches('`').count() % 2 == 1 {
        let last = line.rsplit('`').next().unwrap_or("");
        out.push_str(last);
    }
    out
}

/// The ids that `kasten:note/<id>` links in `text` name, in order; an empty
/// string for a link with no id. Links in code blocks and code spans are not
/// links.
pub(super) fn note_ids_in(text: &str) -> Vec<String> {
    let mut ids = Vec::new();
    let mut fence: Option<char> = None;
    for line in text.lines() {
        let trimmed = line.trim_start();
        let mark = trimmed.chars().next().filter(|c| matches!(c, '`' | '~'));
        if let Some(mark) = mark
            && trimmed.starts_with(&mark.to_string().repeat(3))
        {
            fence = match fence {
                None => Some(mark),
                Some(open) if open == mark => None,
                other => other,
            };
            continue;
        }
        if fence.is_some() || !line.contains(NOTE_LINK) {
            continue;
        }
        let line = without_code(line);
        let mut rest = line.as_str();
        while let Some(at) = rest.find(NOTE_LINK) {
            let after = &rest[at + NOTE_LINK.len()..];
            let id: String = after
                .chars()
                .take_while(char::is_ascii_alphanumeric)
                .take(MAX_ID)
                .collect();
            rest = &after[id.len()..];
            ids.push(id);
        }
    }
    ids
}

impl Kasten {
    /// The `kasten:note/<id>` links in notes whose id belongs to no note, for
    /// `verify`. Templates are left out, as `verify` leaves their links.
    pub fn kasten_link_problems(&self) -> Result<Vec<Problem>> {
        let mut out = Vec::new();
        for file in self.vault.files(".md")? {
            if crate::vault::in_templates(&file.path) {
                continue;
            }
            let Ok(text) = fs::read_to_string(self.vault.root().join(&file.path)) else {
                continue;
            };
            if !text.contains(NOTE_LINK) {
                continue;
            }
            let mut reported: Vec<String> = Vec::new();
            for id in note_ids_in(&text) {
                if reported.contains(&id) {
                    continue;
                }
                let there = !id.is_empty() && self.index().by_id(&id)?.is_some();
                if !there {
                    out.push(Problem {
                        kind: "unresolved-link".to_owned(),
                        path: Some(file.path.clone()),
                        detail: if id.is_empty() {
                            format!("{NOTE_LINK} names no note")
                        } else {
                            format!("{NOTE_LINK}{id} points to no note")
                        },
                    });
                }
                reported.push(id);
            }
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_ids_of_note_links_and_skips_code() {
        let text = "See [plan](kasten:note/01J8Z3K6Q2M4X7V9B1C5D8E0F2#Risks) and <kasten:note/ABC?section=Intro&n=2>.\n\
                    Also [x](kasten:note/) and `kasten:note/INCODE` and [y](kasten:note/01HX).\n\
                    ```\n[z](kasten:note/FENCED)\n```\n\
                    ~~~\nkasten:note/TILDE\n~~~\n\
                    [after](kasten:note/AFTER)\n\
                    A lone ` backtick and [w](kasten:note/LONE)\n\
                    [other](kasten:board/x.canvas) and kasten:pdf/a.pdf?page=1\n";
        assert_eq!(
            note_ids_in(text),
            [
                "01J8Z3K6Q2M4X7V9B1C5D8E0F2",
                "ABC",
                "",
                "01HX",
                "AFTER",
                "LONE"
            ]
        );
        assert!(note_ids_in("no links here").is_empty());
        assert!(note_ids_in("").is_empty());
    }
}
