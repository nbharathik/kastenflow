//! The diagram tools' calls in words for the person, as the chat shows them:
//! "Changed the diagram “Login flow”: add 2 nodes, 1 link · lint: 0 errors,
//! 1 warning" and what the call set out to do.

use kasten_core::diagrams::steps::{Step, summarize};
use serde_json::Value;

/// How a call went, in a line and the diagrams it touched.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Told {
    pub summary: String,
    pub paths: Vec<String>,
}

/// The tools of this file.
pub const TOOLS: [&str; 7] = [
    "diagram_describe",
    "diagram_find_shapes",
    "diagram_lint",
    "diagram_preview",
    "diagram_new",
    "diagram_edit",
    "diagram_export",
];

pub fn is_tool(name: &str) -> bool {
    TOOLS.contains(&name)
}

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or_default().trim()
}

fn count(n: u64, what: &str) -> String {
    format!("{n} {what}{}", if n == 1 { "" } else { "s" })
}

fn quoted(words: &str) -> String {
    format!("“{}”", words.trim().trim_end_matches(".drawio"))
}

/// The diagram a call names, as the person would say it.
fn diagram_words(input: &Value) -> String {
    match text(input, "diagram") {
        "" => "the diagram".to_owned(),
        given => {
            let name = given.rsplit('/').next().unwrap_or(given);
            quoted(name)
        }
    }
}

/// The steps a call sent, in a few words.
fn steps_words(input: &Value) -> String {
    let steps: Vec<Step> = input["steps"]
        .as_array()
        .map(|list| {
            list.iter()
                .filter_map(|s| serde_json::from_value(s.clone()).ok())
                .collect()
        })
        .unwrap_or_default();
    summarize(&steps)
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

/// What a diagram tool set out to do, in words that follow "Could not" or "Waiting for review:".
pub fn action(name: &str, input: &Value) -> Option<String> {
    if !is_tool(name) {
        return None;
    }
    let diagram = diagram_words(input);
    Some(match name {
        "diagram_describe" => format!("read {diagram}"),
        "diagram_find_shapes" => match text(input, "query") {
            "" => "list the diagram shapes".to_owned(),
            query => format!("look for diagram shapes “{query}”"),
        },
        "diagram_lint" => format!("check {diagram}"),
        "diagram_preview" => format!("draw a preview of {diagram}"),
        "diagram_new" => match text(input, "title") {
            "" => "make a diagram".to_owned(),
            title => format!("make the diagram {}", quoted(title)),
        },
        "diagram_edit" => format!("change {diagram} ({})", steps_words(input)),
        _ => format!("keep a picture of {diagram}"),
    })
}

/// How a diagram tool's call went, from the answer `tools::call` gave; none for another tool.
pub fn told(name: &str, input: &Value, value: &Value) -> Option<Told> {
    if !is_tool(name) {
        return None;
    }
    let done = if value["result"].is_object() {
        &value["result"]
    } else {
        value
    };
    let path = text(done, "path").to_owned();
    let paths = |p: &str| {
        if p.is_empty() {
            Vec::new()
        } else {
            vec![p.to_owned()]
        }
    };
    let (summary, touched) = match name {
        "diagram_describe" => (
            format!(
                "Read {} ({}, {}){}",
                diagram_words(input),
                count(
                    value["nodes"].as_array().map_or(0, |n| n.len() as u64),
                    "node"
                ),
                count(
                    value["edges"].as_array().map_or(0, |n| n.len() as u64),
                    "edge"
                ),
                lint_words(&value["lint"])
            ),
            Vec::new(),
        ),
        "diagram_find_shapes" => (
            format!(
                "Found {}",
                count(
                    value["shapes"].as_array().map_or(0, |n| n.len() as u64),
                    "shape"
                )
            ),
            Vec::new(),
        ),
        "diagram_lint" => (
            format!(
                "Checked {}: {}, {}",
                diagram_words(input),
                count(value["errors"].as_u64().unwrap_or(0), "error"),
                count(value["warnings"].as_u64().unwrap_or(0), "warning")
            ),
            Vec::new(),
        ),
        "diagram_preview" => (
            format!(
                "Drew a preview of {} ({})",
                diagram_words(input),
                text(value, "picture")
            ),
            Vec::new(),
        ),
        "diagram_new" => (
            format!(
                "Made the diagram {} with {}{}",
                quoted(text(input, "title")),
                count(done["ids"].as_array().map_or(0, |n| n.len() as u64), "cell"),
                lint_words(&done["lint"])
            ),
            paths(&path),
        ),
        "diagram_edit" => {
            let what = if done["status"] == "unchanged" {
                format!("Changed nothing in {}", diagram_words(input))
            } else {
                format!("Changed {}: {}", diagram_words(input), steps_words(input))
            };
            (format!("{what}{}", lint_words(&done["lint"])), paths(&path))
        }
        _ => (
            format!(
                "Kept a picture of {} as {}",
                diagram_words(input),
                quoted(&path)
            ),
            Vec::new(),
        ),
    };
    Some(Told {
        summary,
        paths: touched,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn calls_are_told_in_the_words_a_person_would_use() {
        let input = json!({"diagram": "library/Login-flow.drawio", "steps": [
            {"op": "add_node", "id": "a"}, {"op": "add_node", "id": "b"}, {"op": "add_edge", "from": "a", "to": "b"}, {"op": "layout"}
        ]});
        assert_eq!(
            action("diagram_edit", &input).unwrap(),
            "change “Login-flow” (add 2 nodes, 1 link, layout)"
        );
        let answer = json!({"status": "done", "result": {"path": "library/Login-flow.drawio", "status": "saved", "lint": {"errors": 0, "warnings": 1}}});
        let told = told("diagram_edit", &input, &answer).unwrap();
        assert_eq!(
            told.summary,
            "Changed “Login-flow”: add 2 nodes, 1 link, layout · lint: 0 errors, 1 warning"
        );
        assert_eq!(told.paths, ["library/Login-flow.drawio"]);
        assert!(action("get_diagram", &input).is_none());
        assert!(super::told("search", &json!({}), &json!({})).is_none());
        assert_eq!(
            action("diagram_new", &json!({"title": "Shop"})).unwrap(),
            "make the diagram “Shop”"
        );
        assert_eq!(
            action("diagram_find_shapes", &json!({"query": "queue"})).unwrap(),
            "look for diagram shapes “queue”"
        );
        // A look touches nothing; a call that changed nothing says so.
        let seen = super::told(
            "diagram_lint",
            &json!({"diagram": "Shop"}),
            &json!({"errors": 1, "warnings": 2}),
        )
        .unwrap();
        assert_eq!(
            (seen.summary.as_str(), seen.paths.len()),
            ("Checked “Shop”: 1 error, 2 warnings", 0)
        );
        let same = json!({"result": {"path": "a.drawio", "status": "unchanged"}});
        assert!(
            super::told("diagram_edit", &json!({"diagram": "A"}), &same)
                .unwrap()
                .summary
                .starts_with("Changed nothing in “A”")
        );
    }
}
