//! A board as agents and lists see it: each node with the title of the note
//! it shows, and edges by node id, as the MCP tool `read_board` gives it.
//! Agents name nodes by id, file or title; `BoardView::resolve` finds the
//! node they mean.

use serde::Serialize;

use super::files::plain;
use super::geometry::Rect;
use super::{Canvas, field, read_board};
use crate::error::{Error, Result};
use crate::vault::Vault;

/// A board's nodes and edges, with the titles of the notes on it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardView {
    pub path: String,
    /// `x-kasten.title`, or the file name without `.canvas`.
    pub title: String,
    /// Lowest in z-order first.
    pub nodes: Vec<NodeView>,
    pub edges: Vec<EdgeView>,
    /// What the board remembers about the page it was made from, as the
    /// app wrote it (`x-kasten.source`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<serde_json::Value>,
}

/// One node. Only the fields of its kind are set.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeView {
    pub id: String,
    /// `file`, `text`, `link`, `group`, or another type as written.
    pub kind: String,
    pub x: i64,
    pub y: i64,
    pub width: i64,
    pub height: i64,
    /// File nodes: the vault path shown.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    /// File nodes: the note's title, a nested board's title or, for other
    /// files, the file name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// File nodes whose file is not in the vault.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub missing: bool,
    /// Text nodes: the sticky's Markdown.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Link nodes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Groups: the section's label.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// `1` to `6` (JSON Canvas presets) or `#rrggbb`, as written.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// File nodes: `title` or `expanded`; unset shows title and first lines.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<String>,
    /// Groups: folded to their label.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub collapsed: bool,
    /// Text nodes drawn as a shape: its outline.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shape: Option<String>,
    /// Text nodes that are a drawn stroke.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub draw: Option<Drawing>,
}

/// A drawn stroke: `x,y` points relative to its node, and the pen's width.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Drawing {
    pub points: String,
    pub size: i64,
}

/// One edge, by node id.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EdgeView {
    pub id: String,
    pub from: String,
    pub to: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// `top`, `right`, `bottom` or `left`; unset, the renderer picks.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_side: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_side: Option<String>,
    /// `none` or `arrow`; unset, JSON Canvas means none at the start and
    /// an arrow at the end.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_end: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_end: Option<String>,
    /// `straight`, `curve` or `elbow`; unset, the renderer's own.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub dash: bool,
}

/// The board at `path`, with the titles of the notes on it.
pub fn view(vault: &Vault, path: &str) -> Result<BoardView> {
    Ok(BoardView::of(vault, path, &read_board(vault, path)?))
}

/// A board's title: `x-kasten.title`, else its file name without `.canvas`.
fn board_title(path: &str, canvas: Option<&Canvas>) -> String {
    let name = path.rsplit('/').next().unwrap_or(path);
    canvas
        .and_then(Canvas::title)
        .unwrap_or_else(|| name.strip_suffix(".canvas").unwrap_or(name))
        .to_owned()
}

/// What the file a card shows is called: a note's title, a nested board's or
/// a deck's title, or another file's name. None when the file is not in the vault.
pub fn file_title(vault: &Vault, file: &str) -> Option<String> {
    if file.ends_with(".md") {
        return vault.read(file).ok().map(|note| note.meta.title);
    }
    if !plain(file) || !vault.root().join(file).is_file() {
        return None;
    }
    if file.ends_with(".canvas") {
        return Some(board_title(file, read_board(vault, file).ok().as_ref()));
    }
    if file.ends_with(".deck") {
        return Some(crate::deck::title_at(vault, file));
    }
    // A diagram, or the picture beside it, is named by its file.
    if file.ends_with(crate::diagrams::EXT) || file.ends_with(crate::diagrams::SIDECAR_EXT) {
        return Some(crate::diagrams::title_of(file));
    }
    // A tag's schema is named as the tag.
    if let Some(stem) = file
        .strip_prefix("tags/")
        .and_then(|f| f.strip_suffix(".yaml"))
    {
        return Some(format!("#{stem}"));
    }
    Some(file.rsplit('/').next().unwrap_or(file).to_owned())
}

impl NodeView {
    /// What people call this node: its card's title, its label, its text
    /// or its url.
    fn name(&self) -> Option<&str> {
        self.title
            .as_deref()
            .or(self.label.as_deref())
            .or(self.text.as_deref())
            .or(self.url.as_deref())
    }
}

impl BoardView {
    /// The view of `canvas`, stored at `path`, titling cards from the vault.
    pub fn of(vault: &Vault, path: &str, canvas: &Canvas) -> BoardView {
        BoardView::with_titles(path, canvas, |file| file_title(vault, file))
    }

    /// The view of `canvas`, titling cards with `title_of`, which gives None
    /// for a file not in the vault. The engine can answer from its index
    /// instead of reading every note.
    pub fn with_titles(
        path: &str,
        canvas: &Canvas,
        title_of: impl Fn(&str) -> Option<String>,
    ) -> BoardView {
        let nodes = canvas
            .nodes()
            .iter()
            .map(|node| {
                let get = |key: &str| field(node, key).map(str::to_owned);
                let rect = Rect::of(node).unwrap_or_default();
                let mut view = NodeView {
                    id: get("id").unwrap_or_default(),
                    kind: get("type").unwrap_or_default(),
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                    color: get("color"),
                    ..NodeView::default()
                };
                match view.kind.as_str() {
                    "file" => {
                        view.file = get("file");
                        view.title = view.file.as_deref().and_then(&title_of);
                        view.missing = view.title.is_none();
                        view.size = canvas.card_size(&view.id).map(str::to_owned);
                    }
                    "text" => {
                        view.text = get("text");
                        view.shape = canvas.shape_of(&view.id).map(str::to_owned);
                        view.draw = canvas
                            .drawing_of(&view.id)
                            .map(|(points, size)| Drawing { points, size });
                    }
                    "link" => view.url = get("url"),
                    "group" => {
                        view.label = get("label");
                        view.collapsed = canvas.is_collapsed(&view.id);
                    }
                    _ => {}
                }
                view
            })
            .collect();
        let edges = canvas
            .edges()
            .iter()
            .map(|edge| {
                let get = |key: &str| field(edge, key).unwrap_or_default().to_owned();
                let set = |key: &str| {
                    field(edge, key)
                        .filter(|value| !value.trim().is_empty())
                        .map(str::to_owned)
                };
                EdgeView {
                    id: get("id"),
                    from: get("fromNode"),
                    to: get("toNode"),
                    label: set("label"),
                    color: set("color"),
                    from_side: set("fromSide"),
                    to_side: set("toSide"),
                    from_end: set("fromEnd"),
                    to_end: set("toEnd"),
                    line: canvas.line_of(&get("id")).map(str::to_owned),
                    dash: canvas.dashed(&get("id")),
                }
            })
            .collect();
        BoardView {
            path: path.to_owned(),
            title: board_title(path, Some(canvas)),
            nodes,
            edges,
            source: canvas.source().cloned(),
        }
    }

    /// The id of the node `reference` means, as an agent names it: a node
    /// id, the vault path a card shows, or a name, ignoring case and outer
    /// spaces: a card's title, a section's label, a sticky's text or a
    /// link's url. A name several nodes share is refused with their ids,
    /// unless they all show the same file.
    pub fn resolve(&self, reference: &str) -> Result<String> {
        let wanted = reference.trim();
        if wanted.is_empty() {
            return Err(Error::Invalid(
                "Name a node by its id, file or title".to_owned(),
            ));
        }
        let by_file = || {
            self.nodes
                .iter()
                .find(|node| node.file.as_deref() == Some(wanted))
        };
        if let Some(node) = self
            .nodes
            .iter()
            .find(|node| node.id == wanted)
            .or_else(by_file)
        {
            return Ok(node.id.clone());
        }
        let key = wanted.to_lowercase();
        let named: Vec<&NodeView> = self
            .nodes
            .iter()
            .filter(|node| {
                node.name()
                    .is_some_and(|name| name.trim().to_lowercase() == key)
            })
            .collect();
        match named.as_slice() {
            [] => Err(Error::Invalid(format!(
                "Nothing on this board is called {wanted}"
            ))),
            [first, rest @ ..]
                if rest
                    .iter()
                    .all(|node| node.file.is_some() && node.file == first.file) =>
            {
                Ok(first.id.clone())
            }
            many => {
                let ids: Vec<&str> = many.iter().map(|node| node.id.as_str()).collect();
                Err(Error::Invalid(format!(
                    "Several nodes are called {wanted} ({}); name one by id",
                    ids.join(", ")
                )))
            }
        }
    }
}
