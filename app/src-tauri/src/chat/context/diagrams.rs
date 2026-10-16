//! A diagram as context: the page in words (every box with its id, its kind
//! and where it is, every arrow with its ends and label, the groups) and what
//! the checks say about it, as the diagram tools would tell an agent that
//! asked. The ids are what the editing steps take, so the model can change the
//! diagram without writing any of its file. Labels are the diagram's own text,
//! so they are fenced as data like anything else attached.

use kasten_core::Kasten;
use kasten_core::agent::Session;
use serde_json::{Value, json};

use super::{Part, attr, cut, quoted};

/// The most findings of the checks listed one by one.
const ISSUES: usize = 8;
/// The most of the description that goes along, in characters.
const MOST: usize = 24_000;

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or_default().trim()
}

fn count(n: u64, what: &str) -> String {
    format!("{n} {what}{}", if n == 1 { "" } else { "s" })
}

/// The pages of a diagram with more than one, so the model knows what else there is.
fn pages(read: &Value) -> Option<String> {
    let all = read["pages"].as_array().filter(|p| p.len() > 1)?;
    let listed: Vec<String> = all
        .iter()
        .map(|p| {
            format!(
                "{} ({}, {})",
                quoted(text(p, "name")),
                count(p["nodes"].as_u64().unwrap_or(0), "node"),
                count(p["edges"].as_u64().unwrap_or(0), "edge")
            )
        })
        .collect();
    Some(format!("Pages: {}.", listed.join(", ")))
}

/// What the checks found, in a few lines.
fn checks(lint: &Value) -> String {
    let mut out = format!("Checks: {}.", text(lint, "summary"));
    let issues = lint["issues"].as_array().cloned().unwrap_or_default();
    for issue in issues.iter().take(ISSUES) {
        let cell = match text(issue, "cell") {
            "" => String::new(),
            id => format!(" ({id})"),
        };
        out.push_str(&format!(
            "\n- {}: {}{cell}",
            text(issue, "severity"),
            text(issue, "message")
        ));
    }
    let more = lint["more"].as_u64().unwrap_or(0) as usize + issues.len().saturating_sub(ISSUES);
    if more > 0 {
        out.push_str(&format!("\n- … and {more} more."));
    }
    out
}

/// The description, then the pages and the checks. When it is too long it is
/// the list of boxes that is cut, never the checks.
fn body(read: &Value) -> String {
    let mut tail = String::new();
    if let Some(pages) = pages(read) {
        tail.push_str(&format!("\n{pages}"));
    }
    tail.push_str(&format!("\n{}", checks(&read["lint"])));
    let words = text(read, "text");
    let room = MOST.saturating_sub(tail.chars().count());
    // `cut` always ends at a line, so it is only used on what is too long.
    if words.chars().count() > room {
        format!("{}\n…{tail}", cut(words, room))
    } else {
        format!("{words}{tail}")
    }
}

/// A diagram: `refs` are its title or path and, if it has several pages, the
/// page the chip is about (the first when left out).
pub(super) fn diagram(kasten: &Kasten, session: &Session, refs: &[String]) -> Part {
    let name = refs.first().map_or("", String::as_str);
    let page = refs.get(1).map(|p| p.trim()).filter(|p| !p.is_empty());
    let mut args = json!({ "diagram": name });
    if let Some(page) = page {
        args["page"] = json!(page);
    }
    let on = page
        .map(|p| format!(" page=\"{}\"", attr(p)))
        .unwrap_or_default();
    match kasten_mcp::tools::call(kasten, session, "diagram_describe", args) {
        Ok(read) => {
            let title = text(&read, "title");
            let path = text(&read, "path");
            Part {
                name: format!("diagram {}", quoted(title)),
                open: format!(
                    "<diagram title=\"{}\" path=\"{}\"{on}>",
                    attr(title),
                    attr(path)
                ),
                body: body(&read),
                close: "</diagram>".to_owned(),
            }
        }
        Err(err) => Part {
            name: format!("diagram {}", quoted(name)),
            open: format!("<diagram path=\"{}\"{on}>", attr(name)),
            body: format!("(It could not be read: {err})"),
            close: "</diagram>".to_owned(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(lines: usize) -> Value {
        let text = (0..lines)
            .map(|i| format!("  n{i}: A box with a label [service] at 40,60 120×60"))
            .collect::<Vec<_>>()
            .join("\n");
        json!({
            "text": text,
            "pages": [{"name": "One", "nodes": 2, "edges": 1}, {"name": "Two", "nodes": 1, "edges": 0}],
            "lint": {"summary": "1 error, 2 warnings, 0 notes", "issues": [
                {"severity": "error", "message": "An arrow ends nowhere", "cell": "e1"},
                {"severity": "warning", "message": "Two boxes overlap", "cell": null}
            ], "more": 1}
        })
    }

    #[test]
    fn a_short_description_goes_whole_with_its_pages_and_findings() {
        let body = body(&read(3));
        assert!(body.contains("  n2: A box with a label [service] at 40,60 120×60\n"));
        assert!(body.contains("Pages: “One” (2 nodes, 1 edge), “Two” (1 node, 0 edges)."));
        assert!(body.contains("Checks: 1 error, 2 warnings, 0 notes."));
        assert!(body.contains("- error: An arrow ends nowhere (e1)"));
        assert!(body.contains("- warning: Two boxes overlap\n"));
        assert!(body.ends_with("- … and 1 more."));
    }

    #[test]
    fn a_long_one_loses_boxes_and_never_the_checks() {
        let long = body(&read(1_000));
        assert!(long.chars().count() <= MOST + 200);
        assert!(long.contains("\n…\nPages: "));
        assert!(long.contains("Checks: 1 error, 2 warnings, 0 notes."));
        // Cut at the end of a line, not in the middle of one.
        assert!(long.contains("120×60\n…"));
    }
}
