//! How connected each note is, for the Card Library: backlinks, outgoing
//! links and the boards with a card for it.

use std::collections::HashMap;

use serde::Serialize;

use super::Kasten;
use crate::error::Result;
use crate::links::{path_key, title_key};
use crate::note::NoteMeta;

/// How connected a note is, for the Card Library.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteStats {
    pub path: String,
    /// Notes that link to it by title.
    pub backlinks: u32,
    /// Links it makes to other notes.
    pub links: u32,
    /// Boards with a card for it.
    pub boards: u32,
}

impl Kasten {
    /// Backlink and board counts for every note, templates aside.
    pub fn note_stats(&self) -> Result<Vec<NoteStats>> {
        let links: HashMap<String, u32> = self.index().link_counts()?.into_iter().collect();
        let outgoing: HashMap<String, u32> = self.index().outgoing_counts()?.into_iter().collect();
        let mut boards: HashMap<String, u32> = HashMap::new();
        for (_, facts) in self.board_facts()? {
            // Each board counts once for a note, however many cards it has for it.
            for path in &facts.files {
                *boards.entry(path.clone()).or_default() += 1;
            }
        }
        let notes: Vec<NoteMeta> = self
            .list()?
            .into_iter()
            .filter(|n| n.kind != "template")
            .collect();
        let mut titles: HashMap<String, u32> = HashMap::new();
        for note in &notes {
            *titles.entry(title_key(&note.title)).or_default() += 1;
        }
        let mut out = Vec::with_capacity(notes.len());
        for n in notes {
            let title = title_key(&n.title);
            let key = path_key(&n.path);
            let by_path = links
                .get(&key)
                .or(links.get(&format!("{key}.md")))
                .copied()
                .unwrap_or(0);
            // A shared title, or links by path: count the links that go to this note.
            let backlinks = if by_path > 0 || titles.get(&title).is_some_and(|&c| c > 1) {
                self.index().backlinks(&n.path)?.len() as u32
            } else {
                links.get(&title).copied().unwrap_or(0)
            };
            out.push(NoteStats {
                backlinks,
                links: outgoing.get(&n.path).copied().unwrap_or(0),
                boards: boards.get(&n.path).copied().unwrap_or(0),
                path: n.path,
            });
        }
        Ok(out)
    }
}
