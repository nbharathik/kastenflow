//! A change set: what an agent chat has changed so far, held back for a
//! person to look at. Nothing in it is in the vault yet; every file is the
//! text the vault would hold if the set were applied, next to the text it
//! started from. The engine plans into it (`engine/stage`) and applies it in
//! one commit.
//!
//! The set lives in `.kasten/cache/changes/<id>/set.json` (the cache is never
//! committed), and staged pictures beside it in `assets/`.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::AgentOp;

/// The most files one set may hold (changed and new together).
pub const MAX_STAGED_FILES: usize = 50;
/// The most text one set may hold, summed over its files' staged texts.
pub const MAX_STAGED_BYTES: usize = 2 * 1024 * 1024;

/// What a staged file is, which says how a change made to it by someone
/// else meanwhile is dealt with when the set is applied.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileKind {
    /// A Markdown note: the two sides' edits are merged part by part.
    Note,
    /// A slide deck: merged as the editor's tools merge, and held to the
    /// format's rules.
    Deck,
    /// A drawing: any change since makes the set stale.
    Diagram,
    /// A whiteboard: any change since makes the set stale.
    Board,
}

/// A file of the vault the set changes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StagedFile {
    /// The hash of the file when it was first staged.
    pub base_hash: String,
    /// The file as it was then.
    pub base: String,
    /// The file as the set leaves it.
    pub text: String,
    pub kind: FileKind,
}

/// A file the set makes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewFile {
    /// Where it would be written if it were now; later steps name it by
    /// this path. The path it gets when the set is applied is chosen then.
    pub provisional: String,
    pub title: String,
    /// The op that made it (`create_note`, `capture`, `create_deck`).
    pub op: String,
    pub text: String,
    pub kind: FileKind,
}

/// A picture the set adds to `assets/`, held in the set's own folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StagedAsset {
    /// The path in `assets/` the picture would have if added now.
    pub provisional: String,
    /// The name it was given.
    pub name: String,
    /// Its file in the set's `assets/` folder.
    pub file: String,
    pub sha256: String,
    pub bytes: u64,
}

/// One thing an agent did that went into the set, in order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Step {
    /// The op, to plan it again against a vault that has changed; none for a
    /// picture, which is kept as it is.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub op: Option<AgentOp>,
    /// The tool's name, as the history would carry it.
    pub name: String,
    /// What it did, in words.
    pub summary: String,
    /// The files it touched.
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChangeSet {
    pub id: String,
    pub session: String,
    pub client: String,
    /// Milliseconds since the Unix epoch.
    pub created: u64,
    pub files: BTreeMap<String, StagedFile>,
    #[serde(default)]
    pub created_files: Vec<NewFile>,
    #[serde(default)]
    pub assets: Vec<StagedAsset>,
    #[serde(default)]
    pub steps: Vec<Step>,
}

/// What applying a set came to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ApplyOutcome {
    /// Written, as one commit (none if nothing needed writing).
    Applied {
        commit: Option<String>,
        paths: Vec<String>,
    },
    /// These files changed since they were staged, in a way that cannot be
    /// put together with the set. Nothing was written.
    Stale { files: Vec<String> },
}

/// A step that could not be planned again by `rebase_changes`, with why.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Dropped {
    pub summary: String,
    pub why: String,
}

impl ChangeSet {
    /// An empty set for a chat's session.
    pub fn new(id: String, session: &str, client: &str, created: u64) -> ChangeSet {
        ChangeSet {
            id,
            session: session.to_owned(),
            client: client.to_owned(),
            created,
            files: BTreeMap::new(),
            created_files: Vec::new(),
            assets: Vec::new(),
            steps: Vec::new(),
        }
    }

    /// Whether nothing is staged.
    pub fn is_empty(&self) -> bool {
        self.files.is_empty() && self.created_files.is_empty() && self.assets.is_empty()
    }

    /// How many files the set changes or makes, pictures included.
    pub fn len(&self) -> usize {
        self.files.len() + self.created_files.len() + self.assets.len()
    }

    /// The paths of the set: changed files, then new files and pictures.
    pub fn paths(&self) -> Vec<String> {
        self.files
            .keys()
            .cloned()
            .chain(self.created_files.iter().map(|f| f.provisional.clone()))
            .chain(self.assets.iter().map(|a| a.provisional.clone()))
            .collect()
    }

    /// Whether `path` is a file only the set has so far.
    pub fn is_new(&self, path: &str) -> bool {
        self.created_files.iter().any(|f| f.provisional == path)
    }

    /// The text the set holds for `path`, changed or new.
    pub fn text_of(&self, path: &str) -> Option<&str> {
        match self.files.get(path) {
            Some(file) => Some(&file.text),
            None => self
                .created_files
                .iter()
                .find(|f| f.provisional == path)
                .map(|f| f.text.as_str()),
        }
    }

    /// The staged picture that would be at `path`, if there is one.
    pub fn asset_at(&self, path: &str) -> Option<&StagedAsset> {
        self.assets.iter().find(|a| a.provisional == path)
    }

    /// The bytes of text the set holds (what the size limit counts).
    pub fn staged_bytes(&self) -> usize {
        let changed: usize = self.files.values().map(|f| f.text.len()).sum();
        changed
            + self
                .created_files
                .iter()
                .map(|f| f.text.len())
                .sum::<usize>()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_set_counts_and_finds_its_files() {
        let mut set = ChangeSet::new("S1".into(), "sess", "kasten-chat", 5);
        assert!(set.is_empty());
        set.files.insert(
            "a.md".into(),
            StagedFile {
                base_hash: "h".into(),
                base: "old".into(),
                text: "new".into(),
                kind: FileKind::Note,
            },
        );
        set.created_files.push(NewFile {
            provisional: "inbox/b.md".into(),
            title: "B".into(),
            op: "capture".into(),
            text: "text".into(),
            kind: FileKind::Note,
        });
        assert_eq!((set.len(), set.is_empty()), (2, false));
        assert_eq!(set.paths(), ["a.md", "inbox/b.md"]);
        assert_eq!(set.text_of("a.md"), Some("new"));
        assert_eq!(set.text_of("inbox/b.md"), Some("text"));
        assert_eq!(set.text_of("c.md"), None);
        assert!(set.is_new("inbox/b.md") && !set.is_new("a.md"));
        assert_eq!(set.staged_bytes(), 7);
    }

    #[test]
    fn a_set_round_trips_as_json() {
        let mut set = ChangeSet::new("S1".into(), "sess", "kasten-chat", 5);
        set.steps.push(Step {
            op: Some(AgentOp::Append {
                path: "a.md".into(),
                markdown: "x".into(),
                heading: None,
            }),
            name: "append".into(),
            summary: "add to A".into(),
            paths: vec!["a.md".into()],
        });
        let json = serde_json::to_string(&set).unwrap();
        assert_eq!(serde_json::from_str::<ChangeSet>(&json).unwrap(), set);
    }
}
