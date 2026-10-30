//! A thread bound to the thing it is about: a page, a deck, a diagram, a
//! LaTeX document. The binding is kept in the thread's head file beside its
//! title, not in the window, so it survives a reload and a new window. One
//! thing has one bound thread; binding another takes it over, and the old
//! thread stays in the list. Notes are found by id (a rename does not touch
//! them); decks, diagrams and LaTeX files by path, which a rename or a move
//! updates (`Move`).

use serde::{Deserialize, Serialize};

/// What a thread is bound to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Binding {
    /// `page`, `deck`, `diagram`, `latex`, ...
    pub kind: String,
    /// The file's path in the vault, with `/` between folders.
    pub path: String,
    /// A note's id: found by it when both sides have one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

/// A path that moved: a file, or a folder and everything under it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Move {
    pub from: String,
    pub to: String,
}

/// What `chat_import_bindings` did.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Imported {
    /// Threads now bound.
    pub bound: usize,
    /// Entries whose thread is not saved any more.
    pub missing: usize,
    /// Entries left as they were: the thread or the target already had a binding.
    pub kept: usize,
}

const MAX_PATH: usize = 1024;

fn slashed(path: &str) -> String {
    path.trim().replace('\\', "/").trim_matches('/').to_owned()
}

impl Binding {
    /// This binding with its path in the form bindings are kept in, or the
    /// sentence that says why it cannot be one.
    pub fn checked(self) -> Result<Binding, String> {
        let kind = self.kind.trim().to_owned();
        let path = slashed(&self.path);
        let plain = !kind.is_empty()
            && kind.len() <= 32
            && kind
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'));
        if !plain {
            return Err("A chat can be tied to a page, deck, diagram or LaTeX document".to_owned());
        }
        if path.is_empty() || path.len() > MAX_PATH || path.contains('\0') {
            return Err("The chat needs the path of what it is tied to".to_owned());
        }
        let id = self
            .id
            .map(|id| id.trim().to_owned())
            .filter(|id| !id.is_empty() && id.len() <= 128);
        Ok(Binding { kind, path, id })
    }

    /// Whether `other` names the same thing: by id when both have one,
    /// else by path.
    pub fn same_as(&self, other: &Binding) -> bool {
        if self.kind != other.kind {
            return false;
        }
        match (&self.id, &other.id) {
            (Some(a), Some(b)) => a == b,
            _ => self.path == other.path,
        }
    }

    /// This binding after `moves`: a path that moved, or lies under a folder
    /// that did, follows it. Whether it changed.
    pub fn moved(&mut self, moves: &[Move]) -> bool {
        for step in moves {
            let from = slashed(&step.from);
            let to = slashed(&step.to);
            if from.is_empty() || to.is_empty() {
                continue;
            }
            let now = if self.path == from {
                Some(to)
            } else {
                self.path
                    .strip_prefix(&format!("{from}/"))
                    .map(|rest| format!("{to}/{rest}"))
            };
            if let Some(now) = now {
                self.path = now;
                return true;
            }
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bound(kind: &str, path: &str, id: Option<&str>) -> Binding {
        Binding {
            kind: kind.to_owned(),
            path: path.to_owned(),
            id: id.map(str::to_owned),
        }
    }

    #[test]
    fn a_binding_is_checked_and_kept_with_slashes_between_folders() {
        let ok = bound(" deck ", "\\library\\a.deck", None)
            .checked()
            .unwrap();
        assert_eq!(
            (ok.kind.as_str(), ok.path.as_str()),
            ("deck", "library/a.deck")
        );
        for bad in [
            bound("", "a", None),
            bound("de ck", "a", None),
            bound("deck", "  ", None),
            bound("deck", &"x".repeat(2000), None),
        ] {
            assert!(bad.checked().is_err());
        }
        let blank_id = bound("page", "a.md", Some("  ")).checked().unwrap();
        assert!(blank_id.id.is_none());
    }

    #[test]
    fn the_same_thing_is_found_by_id_for_notes_and_by_path_for_the_rest() {
        let note = bound("page", "projects/a/pages/x.md", Some("N1"));
        let renamed = bound("page", "projects/a/pages/y.md", Some("N1"));
        assert!(note.same_as(&renamed), "a rename does not matter to a note");
        assert!(!note.same_as(&bound("page", "projects/a/pages/x.md", Some("N2"))));
        let deck = bound("deck", "library/a.deck", None);
        assert!(deck.same_as(&bound("deck", "library/a.deck", None)));
        assert!(!deck.same_as(&bound("deck", "library/b.deck", None)));
        assert!(!deck.same_as(&bound("diagram", "library/a.deck", None)));
    }

    #[test]
    fn a_move_of_a_file_or_a_folder_is_followed() {
        let mut deck = bound("deck", "library/a.deck", None);
        let moves = [Move {
            from: "library/a.deck".to_owned(),
            to: "projects/p/decks/a.deck".to_owned(),
        }];
        assert!(deck.moved(&moves));
        assert_eq!(deck.path, "projects/p/decks/a.deck");
        let mut inside = bound("latex", "projects/p/paper/main.tex", None);
        let folder = [Move {
            from: "projects/p".to_owned(),
            to: "projects/q".to_owned(),
        }];
        assert!(inside.moved(&folder));
        assert_eq!(inside.path, "projects/q/paper/main.tex");
        // A name that only starts the same way is a different file.
        let mut other = bound("deck", "projects/pp/a.deck", None);
        assert!(!other.moved(&folder));
        assert_eq!(other.path, "projects/pp/a.deck");
    }
}
