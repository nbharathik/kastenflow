//! The whole graph: every note, board, deck and diagram, the ghosts the links
//! leave behind, and every edge between them. Scopes cut it down afterwards.

use std::collections::{BTreeSet, HashMap};

use super::{Edge, FileNode, Graph, Node, Scope, scope};
use crate::dates::is_real_day;
use crate::index::LinkRow;
use crate::links::{Directory, Place, Resolution};
use crate::note::NoteMeta;

/// Endings of the files a link may name that are not notes. A link to one
/// that is not a board, deck or diagram here is not a missing page.
const FILE_ENDINGS: [&str; 24] = [
    "canvas", "deck", "drawio", "svg", "png", "jpg", "jpeg", "gif", "webp", "pdf", "mp3", "mp4",
    "mov", "webm", "wav", "csv", "json", "yaml", "yml", "txt", "bib", "html", "zip", "xlsx",
];

/// `notes` and `rows` are what the index holds, `files` the boards, decks and
/// diagrams. Nodes come out notes first, then files, then ghosts, each by path
/// or id, so the same vault always gives the same graph.
pub fn build(notes: &[NoteMeta], rows: &[LinkRow], files: &[FileNode], scope: &Scope) -> Graph {
    scope::apply(whole(notes, rows, files), scope)
}

/// Where a link goes, once its target is worked out.
enum To {
    Node(u32),
    Ghost(String),
}

/// The files links can name, by lowercase path and by lowercase file name.
struct Files {
    by_path: HashMap<String, u32>,
    by_name: HashMap<String, Vec<u32>>,
}

impl Files {
    fn find(&self, target: &str) -> Option<u32> {
        let key = target.trim().to_lowercase();
        if let Some(found) = self.by_path.get(&key) {
            return Some(*found);
        }
        let name = key.rsplit('/').next().unwrap_or(&key);
        match self.by_name.get(name)?.as_slice() {
            [only] => Some(*only),
            _ => None,
        }
    }
}

fn is_file_name(target: &str) -> bool {
    let name = target.rsplit('/').next().unwrap_or(target);
    name.rsplit_once('.')
        .is_some_and(|(stem, ending)| !stem.is_empty() && FILE_ENDINGS.contains(&ending))
}

fn note_node(note: &NoteMeta) -> Node {
    Node {
        id: note.path.clone(),
        path: Some(note.path.clone()),
        title: note.title.clone(),
        kind: note.kind.clone(),
        project: note.project.clone(),
        links: 0,
        outside: false,
    }
}

fn file_node(file: &FileNode) -> Node {
    Node {
        id: file.path.clone(),
        path: Some(file.path.clone()),
        title: file.title.clone(),
        kind: file.kind.clone(),
        project: file.project.clone(),
        links: 0,
        outside: false,
    }
}

fn ghost_node(target: &str) -> Node {
    Node {
        id: format!("ghost:{target}"),
        path: None,
        title: target.to_owned(),
        kind: "ghost".to_owned(),
        project: None,
        links: 0,
        outside: false,
    }
}

fn whole(notes: &[NoteMeta], rows: &[LinkRow], files: &[FileNode]) -> Graph {
    let mut real: Vec<&NoteMeta> = notes
        .iter()
        .filter(|n| n.kind != "template" && !n.path.starts_with("templates/"))
        .collect();
    real.sort_by(|a, b| a.path.cmp(&b.path));
    let mut stored: Vec<&FileNode> = files.iter().collect();
    stored.sort_by(|a, b| a.path.cmp(&b.path));

    let mut nodes: Vec<Node> = Vec::with_capacity(real.len() + stored.len());
    let mut at: HashMap<&str, u32> = HashMap::with_capacity(real.len());
    for note in &real {
        at.insert(note.path.as_str(), nodes.len() as u32);
        nodes.push(note_node(note));
    }
    let mut known = Files {
        by_path: HashMap::new(),
        by_name: HashMap::new(),
    };
    for file in &stored {
        let index = nodes.len() as u32;
        let key = file.path.to_lowercase();
        let name = key.rsplit('/').next().unwrap_or(&key).to_owned();
        known.by_path.insert(key, index);
        known.by_name.entry(name).or_default().push(index);
        nodes.push(file_node(file));
    }
    let first_file = real.len() as u32;

    let directory = Directory::new(real.iter().copied());
    let mut pending: Vec<(u32, To, bool, bool)> = Vec::with_capacity(rows.len());
    for row in rows {
        let Some(&from) = at.get(row.path.as_str()) else {
            continue;
        };
        let place = Place {
            path: &row.path,
            project: nodes[from as usize].project.as_deref(),
        };
        match directory.resolve(&row.target, place) {
            Resolution::Note(found) => {
                let to = at[found.path.as_str()];
                if to != from {
                    pending.push((from, To::Node(to), row.embed, false));
                }
            }
            Resolution::Ambiguous(among) => {
                for found in among {
                    let to = at[found.path.as_str()];
                    if to != from {
                        pending.push((from, To::Node(to), row.embed, true));
                    }
                }
            }
            Resolution::Missing => {
                if let Some(file) = known.find(&row.target) {
                    pending.push((from, To::Node(file), row.embed, false));
                } else if !is_file_name(&row.target) && !is_real_day(row.target.trim()) {
                    pending.push((
                        from,
                        To::Ghost(row.target.trim().to_owned()),
                        row.embed,
                        false,
                    ));
                }
            }
        }
    }

    let ghosts: BTreeSet<&str> = pending
        .iter()
        .filter_map(|(_, to, _, _)| match to {
            To::Ghost(target) => Some(target.as_str()),
            To::Node(_) => None,
        })
        .collect();
    let mut ghost_at: HashMap<&str, u32> = HashMap::with_capacity(ghosts.len());
    for target in ghosts {
        ghost_at.insert(target, nodes.len() as u32);
        nodes.push(ghost_node(target));
    }

    let mut edges: Vec<Edge> = pending
        .iter()
        .map(|(from, to, embed, ambiguous)| Edge {
            from: *from,
            to: match to {
                To::Node(index) => *index,
                To::Ghost(target) => ghost_at[target.as_str()],
            },
            embed: *embed,
            ambiguous: *ambiguous,
            board: false,
        })
        .collect();
    for (offset, file) in stored.iter().enumerate() {
        let from = first_file + offset as u32;
        for card in &file.cards {
            // A card shows a note, or another board or deck.
            let to = match directory.note(card) {
                Some(note) => at[note.path.as_str()],
                None => match known.by_path.get(&card.to_lowercase()) {
                    Some(&other) => other,
                    None => continue,
                },
            };
            if to != from {
                edges.push(Edge {
                    from,
                    to,
                    embed: false,
                    ambiguous: false,
                    board: true,
                });
            }
        }
    }
    // One edge per pair, the plainest: a link beats an embed, and a clear
    // link beats one that is only a guess.
    edges.sort_unstable_by_key(|e| (e.from, e.to, e.embed, e.ambiguous, e.board));
    edges.dedup_by_key(|e| (e.from, e.to));
    Graph { nodes, edges }
}
