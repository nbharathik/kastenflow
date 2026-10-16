//! Notes, tag views and search results as context: what a note chip, a
//! cards chip, a tag chip and a search chip stand for, read through the core.

use kasten_core::Kasten;
use kasten_core::agent::Session;
use kasten_core::frontmatter::split;
use serde_json::{Value, json};

use super::{Part, attr, chars, cut, quoted};
use crate::chat::summary::some_of;

/// Search results given in full, and how much of each.
const HITS: usize = 8;
const HIT_TEXT: usize = 1_500;

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

pub(super) fn note(kasten: &Kasten, path: &str) -> Part {
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

pub(super) fn tag(kasten: &Kasten, session: &Session, refs: &[String]) -> Part {
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

pub(super) fn search(kasten: &Kasten, query: &str) -> Part {
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
