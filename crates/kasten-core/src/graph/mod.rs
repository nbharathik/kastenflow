//! The link graph: notes, boards, decks and diagrams as nodes, links,
//! embeds and board cards as edges. Links are followed the way the editor
//! follows them (`links::Directory::resolve`), so a title several notes
//! share goes where the reader would be sent. A link to a page that does not
//! exist is a **ghost** node, so a gap in the notes can be seen and filled; a
//! link nothing picks between is drawn to every candidate and flagged.
//!
//! The graph is derived from the index and the board and deck files: it is
//! never stored.

use serde::{Deserialize, Serialize};

mod build;
mod scope;

#[cfg(test)]
mod scope_tests;
#[cfg(test)]
mod tests;

pub use build::build;

/// How much of the vault to draw.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Scope {
    /// Everything.
    Vault,
    /// The project's own notes, boards and decks, and what they link to or
    /// are linked from, marked `outside` when it is not in the project.
    /// `path` is the project's folder, its `_project.md` or its name.
    Project { path: String },
    /// The page (or board, deck or ghost, by its id) and everything within
    /// `depth` links of it, in either direction. `depth` is kept between 1 and 3.
    Around { path: String, depth: u8 },
}

/// A board, deck or diagram file, as the engine reads it from the vault.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileNode {
    pub path: String,
    pub title: String,
    /// `board`, `deck` or `diagram`.
    pub kind: String,
    pub project: Option<String>,
    /// For a board, the notes it holds a card for, by path.
    pub cards: Vec<String>,
}

fn is_false(value: &bool) -> bool {
    !*value
}

/// A note, board, deck, diagram or ghost.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    /// The path of what it stands for; `ghost:` and the missing title for a
    /// page that does not exist.
    pub id: String,
    /// The vault path, none for a ghost.
    pub path: Option<String>,
    pub title: String,
    /// A note's own kind (`page`, `card`, `journal`, `project`, `chat`,
    /// `highlight`…), or `board`, `deck`, `diagram` or `ghost`.
    pub kind: String,
    /// The project folder it lives in.
    pub project: Option<String>,
    /// How many other nodes it is linked with, in either direction.
    pub links: u32,
    /// In a project's graph: a neighbour that is not in the project.
    #[serde(skip_serializing_if = "is_false")]
    pub outside: bool,
}

/// A link, embed or board card from one node to another, by their place in
/// `Graph::nodes`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Edge {
    pub from: u32,
    pub to: u32,
    /// `![[…]]`.
    #[serde(skip_serializing_if = "is_false")]
    pub embed: bool,
    /// The link names a title several notes share and nothing picks one.
    #[serde(skip_serializing_if = "is_false")]
    pub ambiguous: bool,
    /// A board's card for the note.
    #[serde(skip_serializing_if = "is_false")]
    pub board: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Graph {
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
}
