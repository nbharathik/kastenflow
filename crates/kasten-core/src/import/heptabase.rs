//! A Heptabase backup as a Kasten project. The backup is `All-Data.json`
//! (older ones keep each list in a file of its own: `card.json`,
//! `whiteboard.json`, `card-Instance.json`, `connection.json`):
//!
//! - each card becomes a card, its ProseMirror text written as Markdown,
//!   mentions of other cards as `[[links]]`;
//! - each whiteboard becomes a board with its cards, sections, texts and
//!   connections where they were;
//! - journal days join the journal, added to days already here.
//!
//! Cards and whiteboards in Heptabase's trash stay out.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use serde_json::{Map, Value, json};

use super::days::parse_day;
use super::files::project_page;
use super::front::{Keys, with_keys};
use super::markdown::without_title;
use super::plan::{Context, Day, Names, Plan, Warnings, Written, clean_title, unique_titles};
use super::prosemirror::{content_markdown, first_line};
use crate::board::{Canvas, EXTRAS};
use crate::error::{Error, Result};
use crate::id::ulid_at;
use crate::journal_path::day_file;
use crate::sources::shortened;

#[derive(Default)]
struct Backup {
    cards: Vec<Value>,
    boards: Vec<Value>,
    instances: Vec<Value>,
    connections: Vec<Value>,
    sections: Vec<Value>,
    texts: Vec<Value>,
    journals: Vec<Value>,
}

fn list(value: &Value, keys: &[&str]) -> Vec<Value> {
    keys.iter()
        .find_map(|k| value.get(*k))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn read(root: &Path) -> Result<Backup> {
    let all = root.join("All-Data.json");
    if all.is_file() {
        let value: Value = serde_json::from_str(&fs::read_to_string(&all)?)
            .map_err(|e| Error::Invalid(format!("All-Data.json is not JSON: {e}")))?;
        return Ok(Backup {
            cards: list(&value, &["cardList", "cards"]),
            boards: list(&value, &["whiteBoardList", "whiteboardList", "whiteboards"]),
            instances: list(&value, &["cardInstances", "cardInstanceList"]),
            connections: list(&value, &["connections", "connectionList"]),
            sections: list(&value, &["sectionList", "sections"]),
            texts: list(&value, &["textElementList", "textElements"]),
            journals: list(&value, &["journalList", "journals"]),
        });
    }
    let file = |name: &str| -> Vec<Value> {
        fs::read_to_string(root.join(name))
            .ok()
            .and_then(|t| serde_json::from_str::<Value>(&t).ok())
            .and_then(|v| v.as_array().cloned())
            .unwrap_or_default()
    };
    Ok(Backup {
        cards: file("card.json"),
        boards: file("whiteboard.json"),
        instances: file("card-Instance.json"),
        connections: file("connection.json"),
        sections: file("section.json"),
        texts: file("text-element.json"),
        journals: file("journal.json"),
    })
}

fn text<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str)
}

fn trashed(v: &Value) -> bool {
    v.get("isTrashed").and_then(Value::as_bool).unwrap_or(false)
}

fn number(v: &Value, key: &str) -> Option<i64> {
    v.get(key).and_then(Value::as_f64).map(|n| n.round() as i64)
}

/// `2026-09-02T09:00:00.000Z` as frontmatter writes times: `2026-09-02T09:00:00Z`.
fn time(v: &Value, key: &str) -> Option<String> {
    let t = text(v, key)?;
    let head = t.get(..19)?;
    (head.as_bytes()[10] == b'T').then(|| format!("{head}Z"))
}

/// Heptabase's colour names as JSON Canvas's colour presets.
fn color(v: &Value) -> Option<&'static str> {
    match text(v, "color")? {
        "red" => Some("1"),
        "orange" | "brown" => Some("2"),
        "yellow" => Some("3"),
        "green" => Some("4"),
        "blue" | "cyan" => Some("5"),
        "purple" | "pink" => Some("6"),
        _ => None,
    }
}

/// A node at a whiteboard item's place, with a size when it has none.
fn placed(item: &Value, id: &str, kind: &str, size: (i64, i64)) -> Map<String, Value> {
    let mut node = Map::new();
    node.insert("id".to_owned(), json!(id));
    node.insert("type".to_owned(), json!(kind));
    node.insert("x".to_owned(), json!(number(item, "x").unwrap_or(0)));
    node.insert("y".to_owned(), json!(number(item, "y").unwrap_or(0)));
    node.insert(
        "width".to_owned(),
        json!(number(item, "width").unwrap_or(size.0)),
    );
    node.insert(
        "height".to_owned(),
        json!(number(item, "height").unwrap_or(size.1)),
    );
    if let Some(color) = color(item) {
        node.insert("color".to_owned(), json!(color));
    }
    node
}

pub(crate) fn plan(ctx: &Context) -> Result<Plan> {
    let backup = read(ctx.root)?;
    let mut warnings = Warnings::default();
    let mut names = Names::default();
    let project = ctx.folder();
    let cards: Vec<&Value> = backup
        .cards
        .iter()
        .filter(|c| !trashed(c) && text(c, "id").is_some())
        .collect();
    let docs: Vec<Value> = cards
        .iter()
        .map(|c| match c.get("content") {
            Some(Value::String(s)) => serde_json::from_str(s).unwrap_or(Value::Null),
            Some(other) => other.clone(),
            None => Value::Null,
        })
        .collect();
    let wanted: Vec<(String, String)> = cards
        .iter()
        .zip(&docs)
        .map(|(card, doc)| {
            let title = text(card, "title")
                .map(str::trim)
                .filter(|t| !t.is_empty())
                .map(str::to_owned)
                .or_else(|| first_line(doc))
                .unwrap_or_else(|| "Untitled".to_owned());
            (clean_title(&shortened(&title, 80, 70)), String::new())
        })
        .collect();
    let titles = unique_titles(&wanted);
    let index: HashMap<&str, usize> = cards
        .iter()
        .enumerate()
        .filter_map(|(i, c)| text(c, "id").map(|id| (id, i)))
        .collect();
    let title_of = |id: &str| index.get(id).map(|&i| titles[i].clone());
    let paths: Vec<String> = titles
        .iter()
        .map(|t| names.free(ctx.vault, &format!("{project}/cards"), t, ".md"))
        .collect();

    let now = ctx.now.rfc3339();
    let mut written = vec![Written {
        path: String::new(),
        text: String::new(),
    }];
    for (i, card) in cards.iter().enumerate() {
        let body = content_markdown(card.get("content").unwrap_or(&Value::Null), &title_of);
        let body = without_title(&body, &wanted[i].0);
        let created = time(card, "createdTime").unwrap_or_else(|| now.clone());
        let updated = time(card, "lastEditedTime").unwrap_or_else(|| created.clone());
        let id = ulid_at(ctx.now.millis);
        let keys = Keys {
            id: &id,
            title: &titles[i],
            kind: "card",
            created: &created,
            updated: &updated,
            tags: &[],
            parent: None,
            props: None,
        };
        let text = with_keys("", &body, &keys, &titles[i], &mut warnings);
        written.push(Written {
            path: paths[i].clone(),
            text,
        });
    }

    let mut boards = Vec::new();
    for board in backup.boards.iter().filter(|b| !trashed(b)) {
        let Some(id) = text(board, "id") else {
            continue;
        };
        let name = text(board, "name")
            .map(str::trim)
            .filter(|n| !n.is_empty())
            .unwrap_or("Whiteboard");
        let path = names.free(ctx.vault, &format!("{project}/boards"), name, ".canvas");
        let on = |v: &&Value| text(v, "whiteboardId") == Some(id);
        let mut nodes: Vec<Value> = Vec::new();
        for section in backup.sections.iter().filter(on) {
            let Some(sid) = text(section, "id") else {
                continue;
            };
            let mut node = placed(section, sid, "group", (600, 400));
            if let Some(label) = text(section, "title").filter(|t| !t.trim().is_empty()) {
                node.insert("label".to_owned(), json!(label));
            }
            nodes.push(Value::Object(node));
        }
        // Connections name a card's place on the board, or the card itself.
        let mut here: HashSet<String> = HashSet::new();
        let mut place_of: HashMap<&str, &str> = HashMap::new();
        for instance in backup.instances.iter().filter(on) {
            let (Some(iid), Some(card)) = (text(instance, "id"), text(instance, "cardId")) else {
                continue;
            };
            let Some(&i) = index.get(card) else { continue };
            let mut node = placed(instance, iid, "file", (360, 240));
            node.insert("file".to_owned(), json!(paths[i]));
            nodes.push(Value::Object(node));
            here.insert(iid.to_owned());
            place_of.insert(card, iid);
        }
        for item in backup.texts.iter().filter(on) {
            let Some(tid) = text(item, "id") else {
                continue;
            };
            let words = content_markdown(item.get("content").unwrap_or(&Value::Null), &title_of);
            let mut node = placed(item, tid, "text", (240, 80));
            node.insert("text".to_owned(), json!(words.trim_end()));
            nodes.push(Value::Object(node));
            here.insert(tid.to_owned());
        }
        let end = |key: &str, c: &Value| {
            let id = text(c, key)?;
            if here.contains(id) {
                Some(id.to_owned())
            } else {
                place_of.get(id).map(|p| (*p).to_owned())
            }
        };
        let edges: Vec<Value> = backup
            .connections
            .iter()
            .filter(on)
            .filter_map(|c| {
                let (from, to) = (end("beginId", c)?, end("endId", c)?);
                let mut edge = Map::new();
                edge.insert("id".to_owned(), json!(text(c, "id").unwrap_or("edge")));
                edge.insert("fromNode".to_owned(), json!(from));
                edge.insert("toNode".to_owned(), json!(to));
                if text(c, "type") == Some("line") {
                    edge.insert("toEnd".to_owned(), json!("none"));
                }
                if let Some(color) = color(c) {
                    edge.insert("color".to_owned(), json!(color));
                }
                Some(Value::Object(edge))
            })
            .collect();
        let doc = json!({"nodes": nodes, "edges": edges, EXTRAS: {"title": name}});
        boards.push(Written {
            path,
            text: Canvas::from_value(doc)?.to_text(),
        });
    }

    let mut days: Vec<Day> = Vec::new();
    for journal in &backup.journals {
        let Some(date) = text(journal, "date").and_then(|d| parse_day("YYYY-MM-DD", d)) else {
            continue;
        };
        let body = content_markdown(journal.get("content").unwrap_or(&Value::Null), &title_of);
        if body.trim().is_empty() || days.iter().any(|d| d.date == date) {
            continue;
        }
        let path = day_file(None, &date);
        let exists = ctx.vault.exists(&path);
        let text = if exists {
            body
        } else {
            let id = ulid_at(ctx.now.millis);
            let keys = Keys {
                id: &id,
                title: &date,
                kind: "journal",
                created: &now,
                updated: &now,
                tags: &[],
                parent: None,
                props: None,
            };
            with_keys("", &body, &keys, &date, &mut warnings)
        };
        days.push(Day {
            date,
            text,
            tags: Vec::new(),
            exists,
        });
    }

    let mut plan = Plan {
        kind: ctx.kind,
        project: ctx.project.clone(),
        folder: project,
        notes: written,
        days,
        boards,
        tags: Vec::new(),
        copies: Vec::new(),
        pdfs: Vec::new(),
        warnings,
    };
    plan.notes[0] = project_page(ctx, &plan.counts());
    Ok(plan)
}
