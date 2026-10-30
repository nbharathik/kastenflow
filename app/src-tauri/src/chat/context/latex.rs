//! A LaTeX file as context: its text with the hash a change must bring back,
//! and what the last build of its document said, each error with its file and
//! line, as the LaTeX tools would tell an agent that asked. The file is the
//! person's own writing, so it is fenced as data like anything else attached.

use kasten_core::Kasten;
use kasten_core::agent::Session;
use serde_json::{Value, json};

use super::{Part, attr, cut, fence, quoted};

/// The most of the file that goes along, in characters.
const MOST: usize = 24_000;
/// The most diagnostics listed one by one.
const LISTED: usize = 20;

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
    }
    let more = errors as usize + warnings as usize;
    if more > LISTED {
        out.push_str(&format!("\n- … and {} more.", more - LISTED));
    }
    out
}

/// A LaTeX file: `refs` are its path in the vault. The document's last build
/// goes with it.
pub(super) fn latex(kasten: &Kasten, session: &Session, refs: &[String]) -> Part {
    let name = refs.first().map_or("", String::as_str).trim();
    match kasten_mcp::tools::call(kasten, session, "latex_read", json!({ "doc": name })) {
        Ok(read) => {
            let (doc, file) = (text(&read, "doc"), text(&read, "file"));
            let whole = read["text"].as_str().unwrap_or_default();
            let shown = cut(whole, MOST);
            let more = if shown.len() < whole.len() {
                "\n(The file goes on; this is its first part. latex_read has the rest.)\n"
            } else {
                ""
            };
            let build =
                kasten_mcp::tools::call(kasten, session, "latex_build", json!({ "doc": doc }))
                    .map(|b| build_lines(&b))
                    .unwrap_or_else(|err| format!("The last build could not be read: {err}"));
            Part {
                // The name is said outside the fenced block (in the line about what was cut).
                name: fence(&format!("the LaTeX file {}", quoted(file))),
                open: format!(
                    "<latex doc=\"{}\" file=\"{}\" hash=\"{}\">",
                    attr(doc),
                    attr(file),
                    attr(text(&read, "hash"))
                ),
                body: format!("{shown}{more}\n{build}"),
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
}
