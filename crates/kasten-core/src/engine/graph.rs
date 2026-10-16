//! The link graph through the engine: notes and their links come from the
//! index (kept while the index is as it was), boards, decks and diagrams from
//! their files (found in one walk of the vault; what a board or deck says is
//! kept while the file is as it was, see `file_cache`).

use std::sync::Arc;

use super::Kasten;
use super::boards::project_of;
use crate::deck;
use crate::error::Result;
use crate::graph::{self, FileNode, Graph, Scope};
use crate::index::LinkRow;
use crate::note::NoteMeta;

/// The notes and links the graph is built from, with the index state they were read at.
pub(super) struct GraphInputs {
    stamp: (i64, i128),
    notes: Vec<NoteMeta>,
    rows: Vec<LinkRow>,
}

fn stem_of(path: &str, ending: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.strip_suffix(ending).unwrap_or(name).to_owned()
}

impl Kasten {
    /// The vault's link graph, cut down to `scope`. Reads, writes nothing.
    pub fn graph(&self, scope: &Scope) -> Result<Graph> {
        let inputs = self.graph_inputs()?;
        let files = self.graph_files()?;
        Ok(graph::build(&inputs.notes, &inputs.rows, &files, scope))
    }

    /// Every note outside templates and every link they make, read from the
    /// index once and kept until the index changes (by this engine or by
    /// another program with the same index open): ten thousand notes and
    /// their links are most of what a whole-vault graph costs to read.
    fn graph_inputs(&self) -> Result<Arc<GraphInputs>> {
        let index = self.index();
        let stamp = index.stamp();
        let mut kept = self.graph_inputs.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(found) = kept.as_ref().filter(|found| found.stamp == stamp) {
            return Ok(Arc::clone(found));
        }
        let (notes, rows) = index.graph_inputs()?;
        let fresh = Arc::new(GraphInputs { stamp, notes, rows });
        *kept = Some(Arc::clone(&fresh));
        Ok(fresh)
    }

    /// Every board, deck and diagram, with the notes each board shows. One
    /// that cannot be read is left out of the graph, not an error.
    fn graph_files(&self) -> Result<Vec<FileNode>> {
        let walked = self.walk_facts(&[".canvas", ".deck", ".drawio"])?;
        let mut out = Vec::with_capacity(walked.boards.len() + walked.decks.len());
        // A slide template is not a thing the person's pages link to.
        for (file, facts) in walked.boards {
            if deck::is_template(&file.path) {
                continue;
            }
            out.push(FileNode {
                project: project_of(&file.path),
                kind: "board".to_owned(),
                title: facts.title.clone(),
                cards: facts.files.clone(),
                path: file.path,
            });
        }
        for (file, facts) in walked.decks {
            if deck::is_template(&file.path) {
                continue;
            }
            out.push(FileNode {
                project: project_of(&file.path),
                kind: "deck".to_owned(),
                title: facts.title.clone(),
                cards: Vec::new(),
                path: file.path,
            });
        }
        for file in walked.diagrams {
            if deck::is_template(&file.path) {
                continue;
            }
            out.push(FileNode {
                project: project_of(&file.path),
                kind: "diagram".to_owned(),
                title: stem_of(&file.path, ".drawio"),
                cards: Vec::new(),
                path: file.path,
            });
        }
        Ok(out)
    }
}
