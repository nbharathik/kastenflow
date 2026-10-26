//! Whiteboards through the engine, for the app and the MCP board tools:
//! each change to a board is one commit, and cards are
//! titled from the index rather than by reading every note.

use std::collections::HashMap;

use serde::Serialize;

use super::{Change, Kasten};
use crate::board::{self, Added, BoardChange, BoardView, Canvas, FileItem, Layout};
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::time::Instant;

/// A board in lists.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardInfo {
    pub path: String,
    pub title: String,
    /// The project folder it is in, if any.
    pub project: Option<String>,
    pub nodes: usize,
    pub modified: u64,
    /// The id of the page the board is a map of, if it was made from one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

/// What a batch of board changes made, and the board after it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardApplied {
    /// The id of what each change that makes something made or reused, in
    /// order.
    pub made: Vec<String>,
    pub board: BoardView,
}

pub(super) fn project_of(path: &str) -> Option<String> {
    let mut parts = path.split('/');
    // Windows and macOS reach `Projects/` the same way: the project's mode holds.
    (parts
        .next()
        .is_some_and(|p| p.eq_ignore_ascii_case("projects")))
    .then(|| parts.next().map(str::to_owned))
    .flatten()
}

impl Kasten {
    /// Every board, by title.
    pub fn boards(&self) -> Result<Vec<BoardInfo>> {
        let mut out = self.board_infos(|_| true)?;
        out.sort_by_key(|b| b.title.to_lowercase());
        Ok(out)
    }

    /// The boards whose facts `wanted` accepts, in path order.
    fn board_infos(
        &self,
        wanted: impl Fn(&super::file_cache::BoardFacts) -> bool,
    ) -> Result<Vec<BoardInfo>> {
        Ok(self
            .board_facts()?
            .into_iter()
            .filter(|(_, facts)| wanted(facts))
            .map(|(file, facts)| BoardInfo {
                title: facts.title.clone(),
                project: project_of(&file.path),
                nodes: facts.nodes,
                modified: file.modified,
                source: facts.source.clone(),
                path: file.path,
            })
            .collect())
    }

    /// The boards with a card for the file at `path`, by title: where a
    /// card appears, for the right panel.
    pub fn boards_with(&self, path: &str) -> Result<Vec<BoardInfo>> {
        let mut out = self.board_infos(|facts| {
            facts
                .files
                .binary_search_by(|file| file.as_str().cmp(path))
                .is_ok()
        })?;
        out.sort_by_key(|b| b.title.to_lowercase());
        Ok(out)
    }

    /// Puts a trashed board back; returns its path.
    pub fn restore_board(&self, actor: &Actor, trashed: &str) -> Result<String> {
        self.apply(
            actor,
            "restore_board",
            false,
            Instant::now().millis,
            |vault| {
                let path = crate::trash::restore_board(vault, trashed)?;
                let title = board::read_board(vault, &path)
                    .ok()
                    .and_then(|c| c.title().map(str::to_owned))
                    .unwrap_or_else(|| {
                        let name = path.rsplit('/').next().unwrap_or(&path);
                        name.trim_end_matches(".canvas").to_owned()
                    });
                Ok(Change {
                    message: format!("restore: {title}"),
                    paths: vec![trashed.to_owned(), path.clone()],
                    value: path,
                })
            },
        )
    }

    /// A board's path from its path or title.
    pub fn resolve_board(&self, reference: &str) -> Result<String> {
        let r = reference.trim();
        if r.ends_with(".canvas")
            && self
                .vault
                .file_of(r, &[".canvas"])
                .is_ok_and(|p| p.is_file())
        {
            return Ok(r.to_owned());
        }
        let found: Vec<BoardInfo> = self
            .boards()?
            .into_iter()
            .filter(|b| b.title.eq_ignore_ascii_case(r))
            .collect();
        match found.as_slice() {
            [one] => Ok(one.path.clone()),
            [] => Err(Error::Invalid(format!("No board called “{r}”"))),
            many => Err(Error::Invalid(format!(
                "Several boards are called “{r}”; name one by path: {}",
                many.iter()
                    .map(|b| b.path.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            ))),
        }
    }

    fn titles(&self) -> Result<HashMap<String, String>> {
        Ok(self
            .list()?
            .into_iter()
            .map(|n| (n.path, n.title))
            .collect())
    }

    /// What each card on a board is called: notes from the index, nested
    /// boards and other files from the vault. None for a missing file.
    pub(super) fn card_titles(&self) -> Result<impl Fn(&str) -> Option<String> + '_> {
        let titles = self.titles()?;
        Ok(move |file: &str| match titles.get(file) {
            Some(title) => Some(title.clone()),
            None if file.ends_with(".md") => None,
            None => board::file_title(&self.vault, file),
        })
    }

    /// A board's nodes and edges, with the titles of the notes on it.
    pub fn board(&self, path: &str) -> Result<BoardView> {
        let canvas = board::read_board(&self.vault, path)?;
        Ok(BoardView::with_titles(path, &canvas, self.card_titles()?))
    }

    /// A batch of edits a person made on a board, applied whole or not at
    /// all. Like typing, a person's edits are committed after a pause, so a
    /// flurry of drags is one commit; an agent's are committed at once.
    pub fn board_apply(
        &self,
        actor: &Actor,
        path: &str,
        changes: &[BoardChange],
        now: Instant,
    ) -> Result<BoardApplied> {
        for change in changes {
            if let BoardChange::Card { path: file, .. } = change
                && board::file_title(&self.vault, file.trim()).is_none()
            {
                return Err(Error::Invalid(format!(
                    "No file {} in this vault",
                    file.trim()
                )));
            }
        }
        let title_of = self.card_titles()?;
        self.apply(actor, "board_apply", true, now.millis, |vault| {
            let mut canvas = board::read_board(vault, path)?;
            let made = canvas.apply(changes, now)?;
            board::write_board(vault, path, &canvas)?;
            let board = BoardView::with_titles(path, &canvas, title_of);
            let n = changes.len();
            Ok(Change {
                message: format!(
                    "board: {n} change{} on {}",
                    if n == 1 { "" } else { "s" },
                    board.title
                ),
                paths: vec![path.to_owned()],
                value: BoardApplied { made, board },
            })
        })
    }

    pub fn create_board(
        &self,
        actor: &Actor,
        title: &str,
        project: Option<&str>,
        now: Instant,
    ) -> Result<String> {
        self.apply(actor, "create_board", false, now.millis, |vault| {
            let path = board::create_board(vault, title, project)?;
            Ok(Change {
                message: format!("board: create {}", title.trim()),
                paths: vec![path.clone()],
                value: path,
            })
        })
    }

    /// Reads a board, changes it and writes it back, as one commit.
    fn edit_board<T>(
        &self,
        actor: &Actor,
        op: &str,
        path: &str,
        now: Instant,
        change: impl FnOnce(&mut Canvas, &BoardView) -> Result<(T, String)>,
    ) -> Result<T> {
        let title_of = self.card_titles()?;
        self.apply(actor, op, false, now.millis, |vault| {
            let text = board::board_text(vault, path)?;
            let edit = board_edited(path, &text, title_of, change)?;
            crate::atomic::write_atomic(&vault.file_of(path, &[".canvas"])?, edit.text.as_bytes())?;
            Ok(Change {
                message: format!("board: {} on {}", edit.what, edit.title),
                paths: vec![path.to_owned()],
                value: edit.value,
            })
        })
    }

    /// The notes at `notes` as cards to put on a board, with their tags.
    pub(super) fn file_items(&self, notes: &[String]) -> Result<Vec<FileItem>> {
        let tags: HashMap<String, Vec<String>> =
            self.list()?.into_iter().map(|n| (n.path, n.tags)).collect();
        Ok(notes
            .iter()
            .map(|p| FileItem {
                path: p.clone(),
                tags: tags.get(p).cloned().unwrap_or_default(),
            })
            .collect())
    }

    /// Puts notes on a board as cards (those already there stay put).
    pub fn add_to_board(
        &self,
        actor: &Actor,
        path: &str,
        notes: &[String],
        layout: Layout,
        now: Instant,
    ) -> Result<Added> {
        let items = self.file_items(notes)?;
        self.edit_board(actor, "add_to_board", path, now, |canvas, _| {
            add_cards(canvas, &items, layout, now)
        })
    }

    /// A sticky note on a board.
    pub fn add_sticky(
        &self,
        actor: &Actor,
        path: &str,
        text: &str,
        at: Option<(i64, i64)>,
        now: Instant,
    ) -> Result<String> {
        self.edit_board(actor, "add_to_board", path, now, |canvas, _| {
            Ok((canvas.add_text(text, at, now), "add a sticky".to_owned()))
        })
    }

    /// Connects two nodes, named by id, file or title.
    pub fn connect(
        &self,
        actor: &Actor,
        path: &str,
        from: &str,
        to: &str,
        label: Option<&str>,
        now: Instant,
    ) -> Result<String> {
        self.edit_board(actor, "connect", path, now, |canvas, view| {
            connect_nodes(canvas, view, (from, to), label, now)
        })
    }

    /// A labelled section around nodes named by id, file or title.
    pub fn group_on_board(
        &self,
        actor: &Actor,
        path: &str,
        nodes: &[String],
        label: &str,
        now: Instant,
    ) -> Result<String> {
        self.edit_board(actor, "group_on_board", path, now, |canvas, view| {
            group_nodes(canvas, view, nodes, label, now)
        })
    }
}

/// What a change to a board makes.
pub(super) struct BoardEdit<T> {
    /// The board as it should be written.
    pub text: String,
    pub value: T,
    /// What the change did, in a few words for the commit.
    pub what: String,
    /// The board's title.
    pub title: String,
}

/// Changes the board whose text is `text`: the text it becomes, and what the
/// change made. The pure step of every board edit, which a staged change shares.
pub(super) fn board_edited<T>(
    path: &str,
    text: &str,
    title_of: impl Fn(&str) -> Option<String>,
    change: impl FnOnce(&mut Canvas, &BoardView) -> Result<(T, String)>,
) -> Result<BoardEdit<T>> {
    let mut canvas = Canvas::parse(text)?;
    let view = BoardView::with_titles(path, &canvas, title_of);
    let (value, what) = change(&mut canvas, &view)?;
    Ok(BoardEdit {
        text: canvas.to_text(),
        value,
        what,
        title: view.title,
    })
}

/// Puts `items` on the board as cards.
pub(super) fn add_cards(
    canvas: &mut Canvas,
    items: &[FileItem],
    layout: Layout,
    now: Instant,
) -> Result<(Added, String)> {
    let added = canvas.add_files(items, layout, now)?;
    let n = added.created.len();
    Ok((
        added,
        format!("add {n} card{}", if n == 1 { "" } else { "s" }),
    ))
}

/// An edge between two nodes named by id, file or title.
pub(super) fn connect_nodes(
    canvas: &mut Canvas,
    view: &BoardView,
    (from, to): (&str, &str),
    label: Option<&str>,
    now: Instant,
) -> Result<(String, String)> {
    let (a, b) = (view.resolve(from)?, view.resolve(to)?);
    let id = canvas.connect(&a, &b, label, now)?;
    Ok((id, format!("connect {} → {}", from.trim(), to.trim())))
}

/// A labelled section around nodes named by id, file or title.
pub(super) fn group_nodes(
    canvas: &mut Canvas,
    view: &BoardView,
    nodes: &[String],
    label: &str,
    now: Instant,
) -> Result<(String, String)> {
    let ids = nodes
        .iter()
        .map(|n| view.resolve(n))
        .collect::<Result<Vec<_>>>()?;
    let id = canvas.group(&ids, label, now)?;
    Ok((id, format!("section {}", label.trim())))
}
