//! A whiteboard as context: its sections and what is in them, its cards,
//! stickies and links, and its arrows, as the person would describe it.

use kasten_core::Kasten;
use kasten_core::board::{BoardView, NodeView};

use super::{Part, attr, cut, quoted};

fn node_name(view: &BoardView, id: &str) -> String {
    let Some(node) = view.nodes.iter().find(|n| n.id == id) else {
        return id.to_owned();
    };
    let short = |s: &Option<String>| s.as_deref().map(|t| quoted(cut(t.trim(), 60)));
    short(&node.title)
        .or_else(|| short(&node.label))
        .or_else(|| short(&node.text))
        .or_else(|| node.url.clone())
        .unwrap_or_else(|| id.to_owned())
}

fn board_body(view: &BoardView) -> String {
    let inside = |n: &NodeView, g: &NodeView| {
        n.id != g.id
            && n.x >= g.x
            && n.y >= g.y
            && n.x + n.width <= g.x + g.width
            && n.y + n.height <= g.y + g.height
    };
    let mut lines = Vec::new();
    for group in view.nodes.iter().filter(|n| n.kind == "group") {
        let members: Vec<String> = view
            .nodes
            .iter()
            .filter(|n| n.kind != "group" && inside(n, group))
            .map(|n| node_name(view, &n.id))
            .collect();
        let label = quoted(group.label.as_deref().unwrap_or("Section"));
        lines.push(format!("Section {label}: {}", members.join(", ")));
    }
    for node in &view.nodes {
        match node.kind.as_str() {
            "file" => {
                let title = node.title.as_deref().unwrap_or_default();
                let file = node.file.as_deref().unwrap_or_default();
                lines.push(format!("Card {} ({file})", quoted(title)));
            }
            "text" => {
                let text = node.text.as_deref().unwrap_or_default().replace('\n', " ");
                lines.push(format!("Sticky: {}", cut(text.trim(), 300)));
            }
            "link" => lines.push(format!("Link: {}", node.url.as_deref().unwrap_or_default())),
            _ => {}
        }
    }
    for edge in &view.edges {
        let (from, to) = (node_name(view, &edge.from), node_name(view, &edge.to));
        let label = edge
            .label
            .as_deref()
            .map(|l| format!(": {l}"))
            .unwrap_or_default();
        lines.push(format!("Arrow {from} → {to}{label}"));
    }
    lines.join("\n")
}

pub(super) fn board(kasten: &Kasten, path: &str) -> Part {
    let (title, body) = match kasten.board(path) {
        Ok(view) => (view.title.clone(), board_body(&view)),
        Err(err) => (path.to_owned(), format!("(It could not be read: {err})")),
    };
    Part {
        name: format!("board {}", quoted(&title)),
        open: format!("<board title=\"{}\" path=\"{}\">", attr(&title), attr(path)),
        body,
        close: "</board>".to_owned(),
    }
}
