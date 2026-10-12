//! Cutting the whole graph down to what was asked for.

use super::{Edge, Graph, Node, Scope};
use crate::links::path_key;

pub(super) fn apply(full: Graph, scope: &Scope) -> Graph {
    let mut out = match scope {
        Scope::Vault => full,
        Scope::Project { path } => project(full, project_name(path)),
        Scope::Around { path, depth } => around(full, path, (*depth).clamp(1, 3)),
    };
    count_links(&mut out);
    out
}

/// A project's folder name from its folder, its `_project.md` or the name.
fn project_name(path: &str) -> &str {
    let path = path.trim().trim_matches('/');
    let path = path.strip_prefix("projects/").unwrap_or(path);
    path.split('/').next().unwrap_or(path)
}

/// The project's own notes, boards and decks, with whatever they link to or
/// are linked from. Links between two things outside it are not its own.
fn project(full: Graph, name: &str) -> Graph {
    let inside: Vec<bool> = full
        .nodes
        .iter()
        .map(|n| n.kind != "ghost" && n.project.as_deref() == Some(name))
        .collect();
    let mut kept = inside.clone();
    for edge in &full.edges {
        if inside[edge.from as usize] || inside[edge.to as usize] {
            kept[edge.from as usize] = true;
            kept[edge.to as usize] = true;
        }
    }
    let outside: Vec<bool> = full
        .nodes
        .iter()
        .enumerate()
        .map(|(i, n)| kept[i] && !inside[i] && n.kind != "ghost")
        .collect();
    subgraph(full, &kept, &outside, |e| {
        inside[e.from as usize] || inside[e.to as usize]
    })
}

/// Everything within `depth` links of `path`, whichever way the links point.
fn around(full: Graph, path: &str, depth: u8) -> Graph {
    let Some(start) = find(&full.nodes, path) else {
        return Graph::default();
    };
    // Each node's neighbours in one flat list (offsets, then the numbers), not a list per node.
    let count = full.nodes.len();
    let mut offset = vec![0u32; count + 1];
    for edge in &full.edges {
        offset[edge.from as usize + 1] += 1;
        offset[edge.to as usize + 1] += 1;
    }
    for i in 0..count {
        offset[i + 1] += offset[i];
    }
    let mut at = offset.clone();
    let mut flat = vec![0u32; offset[count] as usize];
    for edge in &full.edges {
        flat[at[edge.from as usize] as usize] = edge.to;
        at[edge.from as usize] += 1;
        flat[at[edge.to as usize] as usize] = edge.from;
        at[edge.to as usize] += 1;
    }
    let mut seen = vec![false; count];
    seen[start] = true;
    let mut frontier = vec![start as u32];
    for _ in 0..depth {
        let mut next = Vec::new();
        for &node in &frontier {
            let (from, to) = (
                offset[node as usize] as usize,
                offset[node as usize + 1] as usize,
            );
            for &other in &flat[from..to] {
                if !seen[other as usize] {
                    seen[other as usize] = true;
                    next.push(other);
                }
            }
        }
        frontier = next;
    }
    let outside = vec![false; full.nodes.len()];
    subgraph(full, &seen, &outside, |e| {
        seen[e.from as usize] && seen[e.to as usize]
    })
}

/// The node an id or a path names: by id, else by the path as written, else by path in any case.
fn find(nodes: &[Node], path: &str) -> Option<usize> {
    nodes
        .iter()
        .position(|n| n.id == path)
        .or_else(|| nodes.iter().position(|n| n.path.as_deref() == Some(path)))
        .or_else(|| {
            let key = path_key(path);
            nodes
                .iter()
                .position(|n| n.path.as_deref().is_some_and(|p| path_key(p) == key))
        })
}

/// The nodes marked in `kept`, in their order, and the edges `keep` allows.
fn subgraph(full: Graph, kept: &[bool], outside: &[bool], keep: impl Fn(&Edge) -> bool) -> Graph {
    let mut moved = vec![u32::MAX; full.nodes.len()];
    let mut nodes = Vec::new();
    for (i, mut node) in full.nodes.into_iter().enumerate() {
        if kept[i] {
            moved[i] = nodes.len() as u32;
            node.outside = outside[i];
            nodes.push(node);
        }
    }
    let edges = full
        .edges
        .into_iter()
        .filter(|e| keep(e))
        .map(|e| Edge {
            from: moved[e.from as usize],
            to: moved[e.to as usize],
            ..e
        })
        .collect();
    Graph { nodes, edges }
}

/// Each node's number of distinct neighbours, a pair of notes that link each
/// other counting once.
fn count_links(graph: &mut Graph) {
    let mut pairs: Vec<(u32, u32)> = graph
        .edges
        .iter()
        .map(|e| (e.from.min(e.to), e.from.max(e.to)))
        .collect();
    pairs.sort_unstable();
    pairs.dedup();
    for (a, b) in pairs {
        graph.nodes[a as usize].links += 1;
        graph.nodes[b as usize].links += 1;
    }
}
