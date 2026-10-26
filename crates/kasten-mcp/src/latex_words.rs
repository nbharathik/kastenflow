//! The LaTeX tools' calls in words for the person, as the chat shows them:
//! "Changed the LaTeX file “intro.tex”", and what a call set out to do.

use serde_json::Value;

/// How a call went, in a line and the files it touched.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Told {
    pub summary: String,
    pub paths: Vec<String>,
}

/// The tools of this file.
pub const TOOLS: [&str; 4] = ["latex_list", "latex_read", "latex_edit", "latex_build"];

pub fn is_tool(name: &str) -> bool {
    TOOLS.contains(&name)
}

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or_default().trim()
}

fn count(n: usize, what: &str) -> String {
    format!("{n} {what}{}", if n == 1 { "" } else { "s" })
}

/// A file or folder as the person would name it: its last part, quoted.
fn named(reference: &str, default: &str) -> String {
    let last = reference
        .trim()
        .trim_end_matches('/')
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
    let doc = named(text(input, "doc"), "the document");
    Some(match name {
        "latex_list" => "list the LaTeX documents".to_owned(),
        "latex_read" => match text(input, "file") {
            "" => format!("read the LaTeX document {doc}"),
            file => format!("read the LaTeX file {}", named(file, "the file")),
        },
        "latex_edit" => format!(
            "change the LaTeX file {} of {doc}",
            named(text(input, "file"), "the file")
        ),
        _ => format!("read the last build of {doc}"),
    })
}

/// How a finished call went (`value` is what the tool answered); none for a
/// tool that is not of this file.
pub fn told(name: &str, input: &Value, value: &Value) -> Option<Told> {
    if !is_tool(name) {
        return None;
    }
    let own = |path: &str| -> Vec<String> {
        (!path.is_empty())
            .then(|| path.to_owned())
            .into_iter()
            .collect()
    };
    let (summary, paths) = match name {
        "latex_list" => (
            format!(
                "Listed {}",
                count(
                    value["documents"].as_array().map_or(0, Vec::len),
                    "LaTeX document"
                )
            ),
            vec![],
        ),
        "latex_read" => (
            format!(
                "Read the LaTeX file {}",
                named(text(value, "file"), "the file")
            ),
            vec![],
        ),
        "latex_edit" => {
            let done = &value["result"];
            let file = named(text(value, "file"), "the file");
            let words = match text(done, "status") {
                "unchanged" => format!("The LaTeX file {file} was already as asked"),
                "merged" => {
                    format!("Changed the LaTeX file {file} and kept the changes made meanwhile")
                }
                "conflict" => format!(
                    "The LaTeX file {file} changed on the same lines, so the change was kept in a copy"
                ),
                _ => format!("Changed the LaTeX file {file}"),
            };
            (words, own(text(done, "path")))
        }
        _ => {
            let doc = named(text(input, "doc"), "the document");
            let words = if value["built"] != Value::Bool(true) {
                format!("There is no build of {doc} to read yet")
            } else {
                let errors = value["errors"].as_u64().unwrap_or(0) as usize;
                let warnings = value["warnings"].as_u64().unwrap_or(0) as usize;
                format!(
                    "Read the last build of {doc}: {}, {}",
                    count(errors, "error"),
                    count(warnings, "warning")
                )
            };
            (words, vec![])
        }
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
        let input = json!({"doc": "projects/p/latex/paper", "file": "sections/intro.tex"});
        assert_eq!(
            action("latex_edit", &input).as_deref(),
            Some("change the LaTeX file “intro.tex” of “paper”")
        );
        let saved = json!({"status": "done", "file": "sections/intro.tex",
            "result": {"status": "saved", "path": "projects/p/latex/paper/sections/intro.tex"}});
        let told_edit = told("latex_edit", &input, &saved).unwrap();
        assert_eq!(told_edit.summary, "Changed the LaTeX file “intro.tex”");
        assert_eq!(
            told_edit.paths,
            ["projects/p/latex/paper/sections/intro.tex"]
        );
        let build = json!({"built": true, "errors": 1, "warnings": 2});
        assert_eq!(
            told("latex_build", &json!({"doc": "paper"}), &build)
                .unwrap()
                .summary,
            "Read the last build of “paper”: 1 error, 2 warnings"
        );
        assert_eq!(
            told(
                "latex_build",
                &json!({"doc": "paper"}),
                &json!({"built": false})
            )
            .unwrap()
            .summary,
            "There is no build of “paper” to read yet"
        );
    }
}
