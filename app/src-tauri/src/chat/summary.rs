//! A tool call's result in words for the person, such as "Created card
//! “Venue ideas”", and the notes or boards it touched, from the result the
//! tool returned (the same JSON an MCP client reads).

use kasten_core::Kasten;
use serde_json::Value;

/// How a tool call went, for the `toolResult` event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Described {
    pub ok: bool,
    pub summary: String,
    pub paths: Vec<String>,
    /// The change was held in the thread's staged changes, not written.
    pub staged: bool,
}

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or_default().trim()
}

fn quoted(name: &str) -> String {
    format!("“{}”", name.trim())
}

fn count(n: usize, what: &str) -> String {
    format!("{n} {what}{}", if n == 1 { "" } else { "s" })
}

/// `shown` of `total` things when a list was cut, else just the total.
pub(super) fn some_of(shown: usize, total: usize, what: &str) -> String {
    if shown < total {
        format!("{shown} of {}", count(total, what))
    } else {
        count(total, what)
    }
}

/// A tool's `total`, or the rows it gave when it names none.
fn total(value: &Value, rows: usize) -> usize {
    value["total"].as_u64().map_or(rows, |t| t as usize)
}

fn tags(input: &Value) -> String {
    let tags = input["tags"].as_array().into_iter().flatten();
    let tags: Vec<String> = tags
        .filter_map(Value::as_str)
        .map(|t| format!("#{}", t.trim_start_matches('#')))
        .collect();
    tags.join(" ")
}

fn len(value: &Value) -> usize {
    value.as_array().map_or(0, Vec::len)
}

/// At most `max` characters, on one line.
fn clip(words: &str, max: usize) -> String {
    let line = words.lines().next().unwrap_or_default().trim();
    match line.char_indices().nth(max) {
        Some((at, _)) => format!("{}…", &line[..at]),
        None => line.to_owned(),
    }
}

/// What the call set out to do: "create card “X”".
fn action(name: &str, input: &Value) -> String {
    if let Some(words) = kasten_mcp::decks::words::action(name, input) {
        return words;
    }
    if let Some(words) = kasten_mcp::diagram_words::action(name, input) {
        return words;
    }
    let note = quoted(text(input, "note"));
    let board = quoted(text(input, "board"));
    let or = |key: &str, default: &str| match text(input, key) {
        "" => default.to_owned(),
        given => given.to_owned(),
    };
    match name {
        "search" => format!("search for {}", quoted(text(input, "query"))),
        "read_note" => format!("read {note}"),
        "query_tag" => format!("read #{}", text(input, "tag").trim_start_matches('#')),
        "get_journal" => format!("read the journal for {}", or("date", "today")),
        "get_history" => format!("read the history of {note}"),
        "read_board" => format!("read the board {board}"),
        "capture" => format!("capture {}", quoted(&clip(text(input, "markdown"), 60))),
        "create_note" => format!(
            "create {} {}",
            or("type", "note"),
            quoted(text(input, "title"))
        ),
        "append" => format!("add to {note}"),
        "replace_section" => format!("replace “{}” in {note}", text(input, "heading")),
        "update_props" => format!("set properties of {note}"),
        "add_tags" => format!("tag {note} {}", tags(input)),
        "remove_tags" => format!("remove {} from {note}", tags(input)),
        "rename_note" => format!("rename {note} to {}", quoted(text(input, "title"))),
        "move_note" => format!("move {note} to {}", or("project", "the library")),
        "journal_append" => format!("add to the journal for {}", or("date", "today")),
        "trash_note" => format!("move {note} to the trash"),
        "propose_edit" => format!("rewrite {note}"),
        "update_tag_schema" => format!(
            "change the schema of #{}",
            text(input, "tag").trim_start_matches('#')
        ),
        "create_board" => format!("create the board {}", quoted(text(input, "title"))),
        "add_to_board" => format!("put {} on {board}", count(len(&input["notes"]), "card")),
        "connect" => format!(
            "connect {} to {} on {board}",
            quoted(text(input, "from")),
            quoted(text(input, "to"))
        ),
        "group_on_board" => format!("group nodes as {} on {board}", quoted(text(input, "title"))),
        // list_notes, list_tags, list_boards.
        other => other.replace('_', " "),
    }
}

fn lower_first(words: &str) -> String {
    let mut chars = words.chars();
    match chars.next() {
        Some(first) => first.to_lowercase().chain(chars).collect(),
        None => String::new(),
    }
}

/// The result of calling `name` with `input`, described. A change held in
/// the thread's staged changes reads as the change it is, and says so.
pub fn describe(
    kasten: &Kasten,
    name: &str,
    input: &Value,
    result: &Result<Value, String>,
) -> Described {
    let mut told = described(kasten, name, input, result);
    if let Ok(value) = result
        && value["status"] == "staged"
    {
        told.staged = true;
        // The core says which files the change touched; the tools' own words
        // look for them in the vault, where a staged note is not yet.
        if let Some(paths) = value["paths"].as_array() {
            told.paths = paths
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect();
        }
    }
    told
}

fn described(
    kasten: &Kasten,
    name: &str,
    input: &Value,
    result: &Result<Value, String>,
) -> Described {
    let value = match result {
        Ok(value) => value,
        Err(error) => {
            let summary = format!("Could not {}: {}", action(name, input), clip(error, 200));
            return Described {
                ok: false,
                summary,
                paths: vec![],
                staged: false,
            };
        }
    };
    if value["status"] == "pending_review" {
        let reason = lower_first(text(value, "reason"));
        let summary = format!("Waiting for review: {} ({reason})", action(name, input));
        return Described {
            ok: true,
            summary,
            paths: vec![],
            staged: false,
        };
    }
    // The deck tools are worded beside the tools themselves.
    if let Some(told) = kasten_mcp::decks::words::told(kasten, name, input, value) {
        return Described {
            ok: true,
            summary: told.summary,
            paths: told.paths,
            staged: false,
        };
    }
    // So are the diagram tools.
    if let Some(told) = kasten_mcp::diagram_words::told(name, input, value) {
        return Described {
            ok: true,
            summary: told.summary,
            paths: told.paths,
            staged: false,
        };
    }
    let done = &value["result"];
    let title = quoted(text(done, "title"));
    let path = text(done, "path").to_owned();
    let board = || kasten.resolve_board(text(input, "board")).ok();
    let (summary, paths): (String, Vec<String>) = match name {
        "search" => {
            let query = quoted(text(input, "query"));
            // A chat with staged changes is told its results leave them out.
            let hits = if value.is_object() {
                &value["results"]
            } else {
                value
            };
            (
                format!("Searched for {query}: {}", count(len(hits), "note")),
                vec![],
            )
        }
        "read_note" => (
            format!("Read {}", quoted(text(value, "title"))),
            vec![text(value, "path").to_owned()],
        ),
        "list_notes" => {
            let shown = len(&value["notes"]);
            let listed = some_of(shown, total(value, shown), "note");
            (format!("Listed {listed}"), vec![])
        }
        "query_tag" => {
            let shown = len(&value["rows"]);
            let read = some_of(shown, total(value, shown), "note");
            (format!("Read #{}: {read}", text(value, "tag")), vec![])
        }
        "get_journal" if value["exists"] == false => {
            (format!("No journal for {}", text(value, "date")), vec![])
        }
        "get_journal" => (
            format!("Read the journal for {}", text(value, "title")),
            vec![text(value, "path").to_owned()],
        ),
        "get_history" => {
            let note = quoted(text(input, "note"));
            (
                format!(
                    "Read the history of {note}: {}",
                    count(len(value), "change")
                ),
                vec![],
            )
        }
        "list_tags" => {
            let n = value["tags"].as_object().map_or(0, |t| t.len());
            (format!("Listed {}", count(n, "tag")), vec![])
        }
        "list_boards" => (format!("Listed {}", count(len(value), "board")), vec![]),
        "read_board" => (
            format!("Read the board {}", quoted(text(value, "title"))),
            vec![text(value, "path").to_owned()],
        ),
        "capture" => (format!("Captured {title} in the inbox"), vec![path]),
        "create_note" => {
            let kind = match text(input, "type") {
                "" => "note",
                kind => kind,
            };
            (format!("Created {kind} {title}"), vec![path])
        }
        "append" => (format!("Added to {title}"), vec![path]),
        "replace_section" => {
            let heading = text(input, "heading");
            (format!("Replaced “{heading}” in {title}"), vec![path])
        }
        "update_props" => (format!("Set properties of {title}"), vec![path]),
        "add_tags" => (format!("Tagged {title} {}", tags(input)), vec![path]),
        "remove_tags" => (format!("Removed {} from {title}", tags(input)), vec![path]),
        "rename_note" => {
            let note = &done["note"];
            let mut paths = vec![text(note, "path").to_owned()];
            let relinked = done["relinked"].as_array().into_iter().flatten();
            paths.extend(relinked.filter_map(Value::as_str).map(str::to_owned));
            let (old, new) = (quoted(text(input, "note")), quoted(text(note, "title")));
            (format!("Renamed {old} to {new}"), paths)
        }
        "move_note" => {
            let to = match text(input, "project") {
                "" => "the library".to_owned(),
                project => format!("the project {project}"),
            };
            (format!("Moved {title} to {to}"), vec![path])
        }
        "journal_append" => (
            format!("Added to the journal for {}", text(done, "title")),
            vec![path],
        ),
        "trash_note" => {
            // `.trash/<when>/<original path>`
            let trashed = text(done, "trashed");
            let original = trashed
                .strip_prefix(".trash/")
                .and_then(|r| r.split_once('/'));
            let paths = original.map(|(_, p)| p.to_owned()).into_iter().collect();
            (
                format!("Moved {} to the trash", quoted(text(input, "note"))),
                paths,
            )
        }
        "create_board" => {
            let name = quoted(text(input, "title"));
            (
                format!("Created the board {name}"),
                vec![text(done, "board").to_owned()],
            )
        }
        "add_to_board" => {
            let made = count(len(&done["created"]), "card");
            let name = quoted(text(input, "board"));
            (
                format!("Put {made} on {name}"),
                board().into_iter().collect(),
            )
        }
        "connect" => {
            let (from, to) = (quoted(text(input, "from")), quoted(text(input, "to")));
            let name = quoted(text(input, "board"));
            (
                format!("Connected {from} to {to} on {name}"),
                board().into_iter().collect(),
            )
        }
        "group_on_board" => {
            let (section, name) = (quoted(text(input, "title")), quoted(text(input, "board")));
            (
                format!("Grouped nodes as {section} on {name}"),
                board().into_iter().collect(),
            )
        }
        other => (format!("Ran {}", other.replace('_', " ")), vec![]),
    };
    Described {
        ok: true,
        summary,
        paths: paths.into_iter().filter(|p| !p.is_empty()).collect(),
        staged: false,
    }
}
