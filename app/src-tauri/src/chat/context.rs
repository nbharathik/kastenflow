//! Context chips: what the person attached to a message
//! (a note, cards, a board, a tag's view, search results, a slide deck or the
//! slide they are looking at), read through the core and put before their
//! words in one marked block of at most about 60,000 characters, with a line
//! saying what was cut.

use kasten_core::Kasten;
use kasten_core::agent::Session;
use kasten_core::board::BoardView;
use kasten_core::frontmatter::split;
use serde_json::{Value, json};

use super::ContextChip;
use super::summary::some_of;

mod decks;

/// The most context one message carries, in characters.
pub const LIMIT: usize = 60_000;
/// Search results given in full, and how much of each.
const HITS: usize = 8;
const HIT_TEXT: usize = 1_500;

/// One attached thing: `open`, `body` and `close`, so a cut keeps the tags.
struct Part {
    name: String,
    open: String,
    body: String,
    close: String,
}

fn chars(text: &str) -> usize {
    text.chars().count()
}

/// At most `max` characters of `text`, ending at a line end when one is near.
fn cut(text: &str, max: usize) -> &str {
    let end = text.char_indices().nth(max).map_or(text.len(), |(i, _)| i);
    match text[..end].rfind('\n') {
        Some(line) if line > end / 2 => &text[..line],
        _ => &text[..end],
    }
}

pub(crate) fn attr(value: &str) -> String {
    value
        .replace('"', "'")
        .replace(['\n', '\r'], " ")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// The tags this block is built from. Text from the vault may be written
/// by anyone (a clipped page, an import), so it never gets to close one and
/// go on as if the person were speaking.
const FRAMES: [&str; 8] = [
    "context", "note", "board", "tag", "search", "pdf", "deck", "slide",
];

/// `text` with any opening or closing of the block's own tags made inert.
pub(crate) fn fence(text: &str) -> String {
    fence_tags(text, &FRAMES)
}

/// `text` with any opening or closing of the tags in `frames` made inert.
pub(crate) fn fence_tags(text: &str, frames: &[&str]) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('<') {
        out.push_str(&rest[..at]);
        let after = &rest[at + 1..];
        // `</ context >` reads as a closing tag to a model too.
        let name = after.trim_start();
        let name = name.strip_prefix('/').unwrap_or(name).trim_start();
        let framed = frames.iter().any(|frame| {
            name.get(..frame.len())
                .is_some_and(|word| word.eq_ignore_ascii_case(frame))
                && !name[frame.len()..]
                    .chars()
                    .next()
                    .is_some_and(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        });
        out.push_str(if framed { "&lt;" } else { "<" });
        rest = after;
    }
    out.push_str(rest);
    out
}

fn quoted(name: &str) -> String {
    format!("“{}”", name.trim())
}

fn show(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Array(items) => items.iter().map(show).collect::<Vec<_>>().join(", "),
        other => other.to_string(),
    }
}

fn props_line(props: &Value) -> Option<String> {
    let props = props.as_object().filter(|p| !p.is_empty())?;
    let pairs: Vec<String> = props
        .iter()
        .map(|(k, v)| format!("{k}: {}", show(v)))
        .collect();
    Some(pairs.join("; "))
}

fn listing(names: &[String]) -> String {
    match names {
        [] => String::new(),
        [one] => one.clone(),
        [rest @ .., last] => format!("{} and {last}", rest.join(", ")),
    }
}

fn note(kasten: &Kasten, path: &str) -> Part {
    let mut part = Part {
        name: format!("note {}", quoted(path)),
        open: format!("<note path=\"{}\">", attr(path)),
        body: String::new(),
        close: "</note>".to_owned(),
    };
    match kasten.read(path) {
        Ok(note) => {
            let meta = &note.meta;
            part.name = format!("note {}", quoted(&meta.title));
            part.open = format!(
                "<note title=\"{}\" path=\"{}\">",
                attr(&meta.title),
                attr(path)
            );
            if !meta.tags.is_empty() {
                let tags: Vec<String> = meta.tags.iter().map(|t| format!("#{t}")).collect();
                part.body.push_str(&format!("Tags: {}\n", tags.join(" ")));
            }
            if let Some(props) = props_line(&meta.props) {
                part.body.push_str(&format!("Properties: {props}\n"));
            }
            if !part.body.is_empty() {
                part.body.push('\n');
            }
            part.body.push_str(split(&note.text).body.trim_end());
        }
        Err(err) => part.body = format!("(It could not be read: {err})"),
    }
    part
}

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
    let inside = |n: &kasten_core::board::NodeView, g: &kasten_core::board::NodeView| {
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

fn board(kasten: &Kasten, path: &str) -> Part {
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

fn tag(kasten: &Kasten, session: &Session, refs: &[String]) -> Part {
    let name = refs
        .first()
        .map_or("", |t| t.trim().trim_start_matches('#'));
    let view = refs.get(1).map(|v| v.trim()).filter(|v| !v.is_empty());
    let mut args = json!({"tag": name, "limit": 200});
    if let Some(view) = view {
        args["view"] = json!(view);
    }
    let open = match view {
        Some(v) => format!("<tag name=\"{}\" view=\"{}\">", attr(name), attr(v)),
        None => format!("<tag name=\"{}\">", attr(name)),
    };
    // The same rows the agent's query_tag sees, the view applied.
    let body = match kasten_mcp::tools::call(kasten, session, "query_tag", args) {
        Ok(rows) => {
            let list = rows["rows"].as_array().cloned().unwrap_or_default();
            let paths: Vec<String> = list
                .iter()
                .filter_map(|r| r["path"].as_str())
                .map(str::to_owned)
                .collect();
            let metas = kasten.notes_at(&paths).unwrap_or_default();
            let total = rows["total"].as_u64().map_or(list.len(), |t| t as usize);
            let mut lines = vec![some_of(list.len(), total, "note")];
            for row in &list {
                let path = row["path"].as_str().unwrap_or_default();
                let mut line = format!(
                    "- {} ({path})",
                    quoted(row["title"].as_str().unwrap_or_default())
                );
                if let Some(props) = props_line(&row["props"]) {
                    line.push_str(&format!(" · {props}"));
                }
                if let Some(meta) = metas
                    .iter()
                    .find(|m| m.path == path)
                    .filter(|m| !m.excerpt.is_empty())
                {
                    line.push_str(&format!(" · {}", cut(&meta.excerpt, 200)));
                }
                lines.push(line);
            }
            lines.join("\n")
        }
        Err(err) => format!("(It could not be read: {err})"),
    };
    Part {
        name: format!("#{name}"),
        open,
        body,
        close: "</tag>".to_owned(),
    }
}

fn search(kasten: &Kasten, query: &str) -> Part {
    let body = match kasten.search(query, HITS) {
        Ok(hits) if hits.is_empty() => "(Nothing matched.)".to_owned(),
        Ok(hits) => {
            let found: Vec<String> = hits
                .iter()
                .map(|hit| {
                    let text = kasten
                        .read(&hit.path)
                        .map(|n| split(&n.text).body.trim().to_owned());
                    let text = text.unwrap_or_else(|_| hit.snippet.clone());
                    let more = if chars(&text) > HIT_TEXT { "\n…" } else { "" };
                    format!(
                        "## {} ({})\n{}{more}",
                        quoted(&hit.title),
                        hit.path,
                        cut(&text, HIT_TEXT)
                    )
                })
                .collect();
            found.join("\n\n")
        }
        Err(err) => format!("(The search failed: {err})"),
    };
    Part {
        name: format!("the search {}", quoted(query)),
        open: format!("<search query=\"{}\">", attr(query)),
        body,
        close: "</search>".to_owned(),
    }
}

fn parts(kasten: &Kasten, session: &Session, chip: &ContextChip) -> Vec<Part> {
    let first = chip.refs.first().map(String::as_str).unwrap_or_default();
    match chip.kind.as_str() {
        "note" => vec![note(kasten, first)],
        "cards" => chip.refs.iter().map(|p| note(kasten, p)).collect(),
        "board" => vec![board(kasten, first)],
        "tag" => vec![tag(kasten, session, &chip.refs)],
        "search" => vec![search(kasten, first)],
        "deck" => vec![decks::deck(kasten, first)],
        "slide" => vec![decks::slide(kasten, &chip.refs)],
        other => {
            let kind: String = other
                .chars()
                .filter(|c| c.is_ascii_alphanumeric())
                .collect();
            vec![Part {
                name: chip.label.clone(),
                open: format!("<{kind}>"),
                body: "(KastenFlow cannot read this kind of context.)".to_owned(),
                close: format!("</{kind}>"),
            }]
        }
    }
}

/// The chips' content in one `<context>` block; empty without chips.
pub fn expand(kasten: &Kasten, session: &Session, chips: &[ContextChip]) -> String {
    if chips.is_empty() {
        return String::new();
    }
    let all: Vec<Part> = chips
        .iter()
        .flat_map(|c| parts(kasten, session, c))
        .collect();
    let mut room = LIMIT;
    let mut shown = Vec::new();
    let mut left = Vec::new();
    for part in all {
        let body = fence(&part.body);
        let frame = chars(&part.open) + chars(&part.close) + 4;
        let size = frame + chars(&body);
        if left.is_empty() && size <= room {
            room -= size;
            shown.push(format!("{}\n{body}\n{}", part.open, part.close));
        } else if left.is_empty() && room > frame + 200 {
            let body = cut(&body, room - frame - 2);
            room = 0;
            shown.push(format!("{}\n{body}\n…\n{}", part.open, part.close));
            left.push(format!("the rest of {}", part.name));
        } else {
            left.push(part.name);
        }
    }
    let mut out = "<context>\nThe user attached this from their vault:\n\n".to_owned();
    out.push_str(&shown.join("\n\n"));
    if !left.is_empty() {
        out.push_str(&format!(
            "\n\n[Cut to stay within {LIMIT} characters: left out {}.]",
            listing(&left)
        ));
    }
    out.push_str("\n</context>");
    out
}

/// The person's words with their chips' content before them.
pub fn message(kasten: &Kasten, session: &Session, chips: &[ContextChip], text: &str) -> String {
    let context = expand(kasten, session, chips);
    match (context.is_empty(), text.trim().is_empty()) {
        (true, _) => text.to_owned(),
        (false, true) => context,
        (false, false) => format!("{context}\n\n{text}"),
    }
}
