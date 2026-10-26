//! The smart page tools' calls in words for the person, as the chat shows
//! them: "Changed the file “app.js” of “Deadlines”", and what a call set out
//! to do.

use serde_json::Value;

use crate::latex_words::Told;

/// The tools of this file.
pub const TOOLS: [&str; 7] = [
    "smart_create",
    "smart_read",
    "smart_edit",
    "smart_write_file",
    "smart_delete_file",
    "smart_check",
    "smart_render",
];

pub fn is_tool(name: &str) -> bool {
    TOOLS.contains(&name)
}

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or_default().trim()
}

fn count(n: usize, what: &str) -> String {
    format!("{n} {what}{}", if n == 1 { "" } else { "s" })
}

/// A page or file as the person would name it: its last part, quoted.
fn named(reference: &str, default: &str) -> String {
    let last = reference
        .trim()
        .trim_end_matches('/')
        .trim_end_matches(".md")
        .rsplit('/')
        .next()
        .unwrap_or("");
    if last.is_empty() {
        default.to_owned()
    } else {
        format!("“{last}”")
    }
}

/// What a call set out to do, in words that follow "Could not" or "Waiting for review:".
pub fn action(name: &str, input: &Value) -> Option<String> {
    if !is_tool(name) {
        return None;
    }
    let page = named(text(input, "page"), "the smart page");
    let file = named(text(input, "file"), "the file");
    Some(match name {
        "smart_create" => format!(
            "make the smart page {}",
            named(text(input, "title"), "a new one")
        ),
        "smart_read" => match text(input, "file") {
            "" => format!("read the smart page {page}"),
            _ => format!("read the file {file} of the smart page {page}"),
        },
        "smart_edit" | "smart_write_file" => {
            format!("change the file {file} of the smart page {page}")
        }
        "smart_delete_file" => format!("take the file {file} out of the smart page {page}"),
        "smart_check" => format!("check the smart page {page}"),
        _ => format!("draw the smart page {page}"),
    })
}

/// How a finished call went (`value` is what the tool answered); none for a
/// tool that is not of this file.
pub fn told(name: &str, input: &Value, value: &Value) -> Option<Told> {
    if !is_tool(name) {
        return None;
    }
    let page = named(text(input, "page"), "the smart page");
    let file = named(text(value, "file"), "the file");
    let own = |path: &str| -> Vec<String> {
        (!path.is_empty())
            .then(|| path.to_owned())
            .into_iter()
            .collect()
    };
    let done = &value["result"];
    let (summary, paths) = match name {
        "smart_create" => {
            let title = named(
                text(done, "title"),
                &named(text(input, "title"), "a new one"),
            );
            let files = done["files"].as_array().map_or(0, Vec::len);
            (
                format!("Made the smart page {title} with {}", count(files, "file")),
                own(text(done, "page")),
            )
        }
        "smart_read" => (
            match text(input, "file") {
                "" => format!(
                    "Read the smart page {page}: {}",
                    count(value["files"].as_array().map_or(0, Vec::len), "file")
                ),
                _ => format!("Read the file {file} of {page}"),
            },
            vec![],
        ),
        "smart_edit" | "smart_write_file" => {
            let words = match text(done, "status") {
                "unchanged" => format!("The file {file} of {page} was already as asked"),
                "created" => format!("Made the file {file} of {page}"),
                _ => format!("Changed the file {file} of {page}"),
            };
            (words, own(text(done, "page")))
        }
        "smart_delete_file" => (
            format!("Moved the file {file} of {page} to the trash"),
            own(text(done, "page")),
        ),
        "smart_check" => {
            let errors = value["errors"].as_u64().unwrap_or(0) as usize;
            let warnings = value["warnings"].as_u64().unwrap_or(0) as usize;
            (
                format!(
                    "Checked {page}: {}, {}",
                    count(errors, "error"),
                    count(warnings, "warning")
                ),
                vec![],
            )
        }
        _ => (
            if value["drawn"] == Value::Bool(true) {
                format!("Drew the smart page {page}")
            } else {
                format!("The smart page {page} cannot be drawn here")
            },
            vec![],
        ),
    };
    Some(Told { summary, paths })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn every_tool_of_the_list_has_words_and_none_shows_its_name() {
        for name in TOOLS {
            let said = action(name, &json!({})).unwrap();
            let told = told(name, &json!({}), &json!({})).unwrap().summary;
            assert!(
                !said.contains('_') && !told.contains('_'),
                "{name}: {said} / {told}"
            );
        }
        assert!(action("search", &json!({})).is_none());
        assert!(told("search", &json!({}), &json!({})).is_none());
    }

    #[test]
    fn calls_read_as_a_person_would_say_them() {
        let input = json!({"page": "library/deadlines.md", "file": "app.js"});
        assert_eq!(
            action("smart_edit", &input).as_deref(),
            Some("change the file “app.js” of the smart page “deadlines”")
        );
        let saved = json!({"status": "done", "file": "app.js",
            "result": {"status": "saved", "page": "library/deadlines.md"}});
        let edit = told("smart_edit", &input, &saved).unwrap();
        assert_eq!(edit.summary, "Changed the file “app.js” of “deadlines”");
        assert_eq!(edit.paths, ["library/deadlines.md"]);
        let made = json!({"status": "done", "result": {"status": "created",
            "page": "library/trip.md", "title": "Trip", "files": [{}, {}, {}]}});
        assert_eq!(
            told("smart_create", &json!({"title": "Trip"}), &made)
                .unwrap()
                .summary,
            "Made the smart page “Trip” with 3 files"
        );
        let checked = json!({"errors": 1, "warnings": 2});
        assert_eq!(
            told("smart_check", &json!({"page": "Trip"}), &checked)
                .unwrap()
                .summary,
            "Checked “Trip”: 1 error, 2 warnings"
        );
    }
}
