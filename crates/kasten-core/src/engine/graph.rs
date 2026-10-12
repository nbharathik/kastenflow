//! The link graph through the engine: notes and their links come from the
//! index, boards, decks and diagrams from their files (found in one walk of
//! the vault, the way `boards` and `decks` find them).

use super::Kasten;
use super::boards::project_of;
use crate::board;
use crate::deck;
use crate::error::Result;
use crate::graph::{self, FileNode, Graph, Scope};

fn stem_of(path: &str, ending: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.strip_suffix(ending).unwrap_or(name).to_owned()
}

impl Kasten {
    /// The vault's link graph, cut down to `scope`. Reads, writes nothing.
    pub fn graph(&self, scope: &Scope) -> Result<Graph> {
        let (notes, rows) = self.index().graph_inputs()?;
        let files = self.graph_files()?;
        Ok(graph::build(&notes, &rows, &files, scope))
    }

    /// Every board, deck and diagram, with the notes each board shows. One
    /// that cannot be read is left out of the graph, not an error.
    fn graph_files(&self) -> Result<Vec<FileNode>> {
        let mut out = Vec::new();
        for file in self.vault.files_among(&[".canvas", ".deck", ".drawio"])? {
            // A slide template is not a thing the person's pages link to.
            if deck::is_template(&file.path) {
                continue;
            }
            let project = project_of(&file.path);
            let (kind, title, cards) = if file.path.ends_with(".canvas") {
                let Ok(canvas) = board::read_board(&self.vault, &file.path) else {
                    continue;
                };
                let cards = canvas
                    .nodes()
                    .iter()
                    .filter(|n| n.get("type").and_then(|t| t.as_str()) == Some("file"))
                    .filter_map(|n| n.get("file").and_then(|f| f.as_str()))
                    .map(str::to_owned)
                    .collect();
                let title = canvas
                    .title()
                    .map_or_else(|| stem_of(&file.path, ".canvas"), str::to_owned);
                ("board", title, cards)
            } else if file.path.ends_with(".deck") {
                let head = deck::read_deck(&self.vault, &file.path)
                    .and_then(|deck| deck::head_of(&deck.text));
                let title = head
                    .ok()
                    .and_then(|head| head.title)
                    .filter(|title| !title.trim().is_empty())
                    .unwrap_or_else(|| stem_of(&file.path, ".deck"));
                ("deck", title, Vec::new())
            } else {
                ("diagram", stem_of(&file.path, ".drawio"), Vec::new())
            };
            out.push(FileNode {
                path: file.path,
                title,
                kind: kind.to_owned(),
                project,
                cards,
            });
        }
        Ok(out)
    }
}
