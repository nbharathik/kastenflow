//! The deck tools' calls in words for the person, as the chat shows them:
//! "Changed the deck “Tool use” · lint: 0 errors" and what the call set out to do.

use kasten_core::Kasten;
use serde_json::Value;

use super::is_tool;

/// How a call went, in a line and the decks it touched.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Told {
    pub summary: String,
    pub paths: Vec<String>,
}

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or_default().trim()
}

fn count(n: u64, what: &str) -> String {
    format!("{n} {what}{}", if n == 1 { "" } else { "s" })
}

/// A deck's title from the vault, else its file's name.
fn title_of(kasten: &Kasten, path: &str) -> String {
    let named = kasten
        .decks()
        .ok()
        .and_then(|all| all.into_iter().find(|d| d.path == path))
        .map(|d| d.title)
        .filter(|t| !t.trim().is_empty());
    named.unwrap_or_else(|| {
        let file = path.rsplit('/').next().unwrap_or(path);
        file.trim_end_matches(".deck").to_owned()
    })
}

fn quoted(words: &str) -> String {
    format!("“{}”", words.trim())
}

/// The deck a call is about, as the person would say it: the title or the name it was given.
fn deck_words(kasten: &Kasten, input: &Value, path: &str) -> String {
    if !path.is_empty() {
        return quoted(&title_of(kasten, path));
    }
    match text(input, "deck") {
        "" => "the deck".to_owned(),
        given => quoted(given.trim_end_matches(".deck")),
    }
}

/// The file a tool's answer names. A tool answers with the name it was given, which may be a title, and adds `.deck` to it.
fn resolve(kasten: &Kasten, name: &str) -> Option<String> {
    let name = name.trim();
    if name.is_empty() {
        return None;
    }
    if let Ok(path) = kasten.resolve_deck(name) {
        return Some(path);
    }
    let stem = name.strip_suffix(".deck")?;
    if let Ok(path) = kasten.resolve_deck(stem) {
        return Some(path);
    }
    let decks = kasten.decks().ok()?;
    let mut same = decks.iter().filter(|d| {
        d.path
            .rsplit('/')
            .next()
            .is_some_and(|f| f.trim_end_matches(".deck") == stem)
    });
    let first = same.next()?;
    same.next().is_none().then(|| first.path.clone())
}

/// What a deck tool set out to do, in words that follow "Could not" or "Waiting for review:".
pub fn action(name: &str, input: &Value) -> Option<String> {
    if !is_tool(name) {
        return None;
    }
    let deck = match text(input, "deck") {
        "" => "the deck".to_owned(),
        given => quoted(given.trim_end_matches(".deck")),
    };
    Some(match name {
        "list_decks" => "list the decks".to_owned(),
        "get_deck" => format!("read {deck}"),
        "get_slide" => format!("read slide {} of {deck}", text(input, "slide")),
        "get_outline" => format!("read the outline of {deck}"),
        "list_layouts" => format!("read the layouts of {deck}"),
        "get_theme" => format!("read the theme of {deck}"),
        "search_assets" => "look for pictures".to_owned(),
        "lint_deck" => format!("check {deck}"),
        "create_deck" => match text(input, "title") {
            "" => "create a deck".to_owned(),
            title => format!("create the deck {}", quoted(title)),
        },
        "deck_from_note" => format!("make a deck from {}", quoted(text(input, "note"))),
        "trash_deck" => format!("move {deck} to the trash"),
        "add_asset" => "add a picture".to_owned(),
        "import_pptx" => "import a PowerPoint file".to_owned(),
        "export" => format!("export {deck} as {}", text(input, "format")),
        "render_slide" => format!("draw slide {} of {deck}", text(input, "slide")),
        "render_grid" => format!("draw all the slides of {deck}"),
        "place_image" => format!("place a picture in {deck}"),
        "delete_slides" => format!("delete slides from {deck}"),
        "add_slide" => format!("add a slide to {deck}"),
        "set_cells" => format!("fill cells in {deck}"),
        "clear_cells" => format!("clear cells in {deck}"),
        "set_cell_fill" => format!("colour cells in {deck}"),
        "insert_rows" => format!("add rows to {deck}"),
        "delete_rows" => format!("remove rows from {deck}"),
        "insert_columns" => format!("add columns to {deck}"),
        "delete_columns" => format!("remove columns from {deck}"),
        "merge_cells" => format!("merge cells in {deck}"),
        "unmerge_cells" => format!("split merged cells in {deck}"),
        other => format!("change {deck} ({})", other.replace('_', " ")),
    })
}

/// What a write tool did to a deck, before "the deck": the verb in the past.
fn verb(name: &str) -> &'static str {
    match name {
        "add_slide" | "duplicate_slide" | "add_diagram" | "add_elements" | "add_citation" => {
            "Added to"
        }
        "delete_slides" | "delete_elements" => "Removed from",
        "set_text" | "replace_all" | "set_notes" => "Changed the words of",
        "set_cells" => "Filled cells in",
        "clear_cells" => "Cleared cells in",
        "set_cell_fill" => "Coloured cells in",
        "insert_rows" => "Added rows to",
        "delete_rows" => "Removed rows from",
        "insert_columns" => "Added columns to",
        "delete_columns" => "Removed columns from",
        "merge_cells" => "Merged cells in",
        "unmerge_cells" => "Split merged cells in",
        "place_image" => "Placed a picture in",
        "apply_theme" | "edit_theme" | "set_logo" => "Changed the look of",
        "reorder_slides" | "reorder_elements" => "Reordered",
        _ => "Changed",
    }
}

/// The lint counts an answer carries, as " · lint: 0 errors, 1 warning".
fn lint_words(lint: &Value) -> String {
    let (Some(errors), Some(warnings)) = (lint["errors"].as_u64(), lint["warnings"].as_u64())
    else {
        return String::new();
    };
    format!(
        " · lint: {}, {}",
        count(errors, "error"),
        count(warnings, "warning")
    )
}

/// How a deck tool's call went, from the answer `tools::call` gave; none for a tool that is not a deck tool.
pub fn told(kasten: &Kasten, name: &str, input: &Value, value: &Value) -> Option<Told> {
    if !is_tool(name) {
        return None;
    }
    let done = &value["result"];
    let deck_path =
        |v: &Value| resolve(kasten, v["deck"].as_str().unwrap_or_default()).unwrap_or_default();
    let (summary, paths): (String, Vec<String>) = match name {
        "list_decks" => (
            format!(
                "Listed {}",
                count(
                    value["decks"].as_array().map_or(0, |d| d.len() as u64),
                    "deck"
                )
            ),
            vec![],
        ),
        "get_deck" => {
            let path = deck_path(value);
            let slides = value["slides"].as_array().map_or(0, |s| s.len() as u64);
            (
                format!(
                    "Read the deck {} ({})",
                    deck_words(kasten, input, &path),
                    count(slides, "slide")
                ),
                // A read touched nothing: a deck named here would be taken for a change.
                vec![],
            )
        }
        "get_slide" => {
            let path = deck_path(value);
            (
                format!(
                    "Read slide {} of {}",
                    value["position"],
                    deck_words(kasten, input, &path)
                ),
                vec![],
            )
        }
        "get_outline" | "list_layouts" | "get_theme" => {
            let what = match name {
                "get_outline" => "the outline of",
                "list_layouts" => "the layouts of",
                _ => "the theme of",
            };
            (
                format!("Read {what} {}", deck_words(kasten, input, "")),
                vec![],
            )
        }
        "search_assets" => (
            format!(
                "Found {}",
                count(value["total"].as_u64().unwrap_or_default(), "picture")
            ),
            vec![],
        ),
        "lint_deck" => {
            let issues = value["issues"].as_array().cloned().unwrap_or_default();
            let n =
                |severity: &str| issues.iter().filter(|i| i["severity"] == severity).count() as u64;
            (
                format!(
                    "Checked {}: {}, {}",
                    deck_words(kasten, input, ""),
                    count(n("error"), "error"),
                    count(n("warning"), "warning")
                ),
                vec![],
            )
        }
        "create_deck" => {
            let path = deck_path(done);
            (
                format!(
                    "Created the deck {} with {}{}",
                    quoted(text(done, "title").trim().to_owned().as_str()),
                    count(
                        done["slides"].as_array().map_or(0, |s| s.len() as u64),
                        "slide"
                    ),
                    lint_words(&done["lint"])
                ),
                vec![path],
            )
        }
        "deck_from_note" => {
            let path = deck_path(done);
            (
                format!(
                    "Made the deck {} from {}: {}{}",
                    quoted(text(done, "title")),
                    quoted(text(input, "note")),
                    count(done["slides"].as_u64().unwrap_or_default(), "slide"),
                    lint_words(&done["lint"])
                ),
                vec![path],
            )
        }
        "trash_deck" => {
            let trashed = text(done, "trashed");
            let original = trashed
                .strip_prefix(".trash/")
                .and_then(|r| r.split_once('/'))
                .map(|(_, p)| p.to_owned());
            (
                format!(
                    "Moved {} to the trash",
                    deck_words(kasten, input, original.as_deref().unwrap_or(""))
                ),
                original.into_iter().collect(),
            )
        }
        "add_asset" => (
            format!("Added the picture {}", quoted(text(done, "path"))),
            vec![],
        ),
        "export" => (format!("Exported {}", quoted(text(done, "path"))), vec![]),
        other => {
            let path = deck_path(done);
            let what = if done["changed"] == false {
                format!("Changed nothing in {}", deck_words(kasten, input, &path))
            } else {
                format!("{} {}", verb(other), deck_words(kasten, input, &path))
            };
            (format!("{what}{}", lint_words(&done["lint"])), vec![path])
        }
    };
    Some(Told {
        summary,
        paths: paths.into_iter().filter(|p| !p.is_empty()).collect(),
    })
}
