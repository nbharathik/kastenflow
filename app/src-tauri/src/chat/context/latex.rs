//! A LaTeX file as context: its text with the hash a change must bring back,
//! what the last build of its document said (each problem with its file and
//! line, and what TeX printed where it stopped), the numbered lines around
//! the problems in every file that has one, and a short map of the document
//! (its files, labels and citation keys). The file is the person's own
//! writing, so it is fenced as data like anything else attached.

mod excerpts;

use kasten_core::Kasten;
use kasten_core::agent::Session;
use kasten_core::latex::{document_map, render_map};
use serde_json::{Value, json};

use super::{Part, attr, cut, fence, quoted};

/// The most of the file and its excerpts that goes along, in characters.
const MOST: usize = 24_000;
/// The most diagnostics listed one by one.
const LISTED: usize = 20;
/// How many of the errors carry the text TeX printed where it stopped.
const WITH_CONTEXT: usize = 8;
/// The most characters of the document map.
const MAP: usize = 3_000;
/// The most files read to make the map.
const MAP_FILES: usize = 40;

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or_default().trim()
}

fn count(n: u64, what: &str) -> String {
    format!("{n} {what}{}", if n == 1 { "" } else { "s" })
}

/// What the last build said, in a few lines.
fn build_lines(build: &Value) -> String {
    if build["built"] != json!(true) {
        return "No build of this document to read yet.".to_owned();
    }
    let errors = build["errors"].as_u64().unwrap_or(0);
    let warnings = build["warnings"].as_u64().unwrap_or(0);
    let mut out = format!(
        "Last build: {}, {}.",
        count(errors, "error"),
        count(warnings, "warning")
    );
    if build["stale"] == json!(true) {
        out.push_str(" A file changed after it, so this may be out of date.");
    }
    let found = build["diagnostics"].as_array().cloned().unwrap_or_default();
    let mut with_context = 0;
    for d in found
        .iter()
        .filter(|d| d["severity"] != json!("info"))
        .take(LISTED)
    {
        let place = match (text(d, "file"), d["line"].as_u64()) {
            ("", Some(line)) => format!("line {line}"),
            ("", None) => String::new(),
            (file, Some(line)) => format!("{file} line {line}"),
            (file, None) => file.to_owned(),
        };
        let place = if place.is_empty() {
            String::new()
        } else {
            format!(" ({place})")
        };
        out.push_str(&format!(
            "\n- {}{place}: {}",
            text(d, "severity"),
            text(d, "message")
        ));
        // What TeX printed where it stopped shows the cause (`l.12 \sectoin`).
        let context = text(d, "context");
        if d["severity"] == json!("error") && !context.is_empty() && with_context < WITH_CONTEXT {
            with_context += 1;
            for line in context.lines() {
                out.push_str(&format!("\n    | {line}"));
            }
        }
    }
    let more = errors as usize + warnings as usize;
    if more > LISTED {
        out.push_str(&format!("\n- … and {} more.", more - LISTED));
    }
    let advice = text(build, "engine_advice");
    if !advice.is_empty() {
        out.push_str(&format!("\nEngine: {advice}"));
    }
    out
}

/// The map of the document `doc`, read from its source files (none when it
/// has nothing worth saying).
fn map_of(kasten: &Kasten, doc: &str, files: &[Value], main: &str) -> String {
    let texts: Vec<(String, String)> = files
        .iter()
        .filter_map(Value::as_str)
        .take(MAP_FILES)
        .filter_map(|rel| {
            let source = kasten.source(&format!("{doc}/{rel}")).ok()?;
            Some((rel.to_owned(), source.text))
        })
        .collect();
    let map = document_map(&texts, main);
    if map.includes.is_empty() && map.labels.is_empty() && !map.has_bibliography {
        return String::new();
    }
    render_map(&map, MAP)
}

/// The file's start and the excerpts, within `MOST` characters: the excerpts
/// of the other files first, then the open file's own, then as much of its
/// start as is left (all of it, when it fits and the excerpts need not be).
fn spend_budget(kasten: &Kasten, doc: &str, open: (&str, &str), build: &Value) -> (String, String) {
    let (file, whole) = open;
    let found = build["diagnostics"].as_array().cloned().unwrap_or_default();
    let main = text(build, "main");
    let main = if main.is_empty() { file } else { main };
    let mut wanted = excerpts::centers(&found, main, &["error"]);
    // Warnings (an undefined reference, an overfull box) come after the errors.
    for (name, lines) in excerpts::centers(&found, main, &["warning"]) {
        match wanted.iter_mut().find(|(f, _)| *f == name) {
            Some((_, have)) => have.extend(lines),
            None => wanted.push((name, lines)),
        }
    }
    // The open file must keep room: other files take at most two thirds.
    let others_room = if wanted.iter().any(|(f, _)| f == file) {
        MOST * 2 / 3
    } else {
        MOST
    };
    let others = excerpts::others(kasten, doc, file, &wanted, others_room);
    let room = MOST.saturating_sub(others.chars().count());
    if whole.chars().count() <= room {
        return (whole.to_owned(), others);
    }
    let mut block = String::new();
    if let Some((_, lines)) = wanted.iter().find(|(f, _)| f == file) {
        block = excerpts::block(file, whole, lines, room);
    }
    let head_room = room.saturating_sub(block.chars().count());
    let head = if head_room >= excerpts::WORTH_A_HEAD {
        cut(whole, head_room).to_owned()
    } else {
        String::new()
    };
    (head, format!("{block}{others}"))
}

/// A LaTeX file: `refs` are its path in the vault. The document's last build
/// goes with it.
pub(super) fn latex(kasten: &Kasten, session: &Session, refs: &[String]) -> Part {
    let name = refs.first().map_or("", String::as_str).trim();
    match kasten_mcp::tools::call(kasten, session, "latex_read", json!({ "doc": name })) {
        Ok(read) => {
            let (doc, file) = (text(&read, "doc"), text(&read, "file"));
            let whole = read["text"].as_str().unwrap_or_default();
            let build_json =
                kasten_mcp::tools::call(kasten, session, "latex_build", json!({ "doc": doc }));
            let build = build_json
                .as_ref()
                .map(build_lines)
                .unwrap_or_else(|err| format!("The last build could not be read: {err}"));
            let empty = json!({});
            let (head, around) = spend_budget(
                kasten,
                doc,
                (file, whole),
                build_json.as_ref().unwrap_or(&empty),
            );
            let more = if head.len() >= whole.len() {
                ""
            } else if head.is_empty() {
                "(The file is long, so only the lines near the problems are shown. latex_read has the rest; around_line or lines gives numbered lines.)\n"
            } else {
                "\n(The file goes on; this is its first part. latex_read has the rest; around_line or lines gives numbered lines.)\n"
            };
            let around = if around.is_empty() {
                String::new()
            } else {
                format!("\n{around}")
            };
            let main = text(build_json.as_ref().unwrap_or(&empty), "main");
            let map = map_of(
                kasten,
                doc,
                read["files"].as_array().map_or(&[][..], Vec::as_slice),
                if main.is_empty() { file } else { main },
            );
            let map = if map.is_empty() {
                String::new()
            } else {
                format!("\n{map}")
            };
            Part {
                // The name is said outside the fenced block (in the line about what was cut).
                name: fence(&format!("the LaTeX file {}", quoted(file))),
                open: format!(
                    "<latex doc=\"{}\" file=\"{}\" hash=\"{}\">",
                    attr(doc),
                    attr(file),
                    attr(text(&read, "hash"))
                ),
                body: format!("{head}{more}\n{build}{around}{map}"),
                close: "</latex>".to_owned(),
            }
        }
        Err(err) => Part {
            name: fence(&format!("the LaTeX file {}", quoted(name))),
            open: format!("<latex path=\"{}\">", attr(name)),
            body: format!("(It could not be read: {err})"),
            close: "</latex>".to_owned(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_build_reads_as_a_count_and_a_list_with_places() {
        let build = json!({
            "built": true, "stale": false, "errors": 2, "warnings": 1,
            "diagnostics": [
                {"severity": "error", "file": "main.tex", "line": 12, "message": "Undefined control sequence."},
                {"severity": "error", "file": null, "line": 20, "message": "Missing $ inserted."},
                {"severity": "warning", "file": null, "line": null, "message": "Citation undefined."},
                {"severity": "info", "file": "main.tex", "line": 3, "message": "Overfull hbox"}
            ]
        });
        let lines = build_lines(&build);
        assert!(
            lines.starts_with("Last build: 2 errors, 1 warning."),
            "{lines}"
        );
        assert!(lines.contains("- error (main.tex line 12): Undefined control sequence."));
        assert!(lines.contains("- error (line 20): Missing $ inserted."));
        assert!(lines.contains("- warning: Citation undefined."));
        assert!(!lines.contains("Overfull"), "boxes are left out: {lines}");
        assert_eq!(
            build_lines(&json!({"built": false})),
            "No build of this document to read yet."
        );
        let old = build_lines(
            &json!({"built": true, "stale": true, "errors": 0, "warnings": 0, "diagnostics": []}),
        );
        assert!(
            old.contains("0 errors, 0 warnings. A file changed after it"),
            "{old}"
        );
    }

    #[test]
    fn an_error_keeps_what_tex_printed_where_it_stopped_and_the_engine_advice_is_told() {
        let build = json!({
            "built": true, "errors": 1, "warnings": 0,
            "engine_advice": "This document uses Unicode text; switch its engine to XeLaTeX.",
            "diagnostics": [
                {"severity": "error", "file": "main.tex", "line": 12, "message": "Undefined control sequence.",
                 "context": "l.12 \\sectoin\n             {Introduction}"},
                {"severity": "warning", "file": "main.tex", "line": 14, "message": "Reference `x' undefined.",
                 "context": "never shown"}
            ]
        });
        let lines = build_lines(&build);
        assert!(
            lines.contains("\n    | l.12 \\sectoin\n    |              {Introduction}"),
            "{lines}"
        );
        assert!(
            !lines.contains("never shown"),
            "only errors carry it: {lines}"
        );
        assert!(
            lines.ends_with(
                "\nEngine: This document uses Unicode text; switch its engine to XeLaTeX."
            ),
            "{lines}"
        );
    }
}
