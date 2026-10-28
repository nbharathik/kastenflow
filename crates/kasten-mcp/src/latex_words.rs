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
pub const TOOLS: [&str; 13] = [
    "latex_list",
    "latex_read",
    "latex_edit",
    "latex_build",
    "latex_create_document",
    "latex_write_file",
    "latex_append",
    "latex_delete_file",
    "latex_add_asset",
    "latex_cite",
    "latex_send_page",
    "latex_export_pdf",
    "diagram_to_latex_figure",
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

/// The diagram a call names, as the person would say it.
fn diagram_named(input: &Value) -> String {
    let name = named(text(input, "diagram"), "the diagram");
    name.replace(".drawio", "")
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
        "latex_create_document" => match text(input, "title") {
            "" => "start a new LaTeX document".to_owned(),
            title => format!("start the LaTeX document “{title}”"),
        },
        "latex_write_file" => format!(
            "write the LaTeX file {} of {doc}",
            named(text(input, "file"), "the file")
        ),
        "latex_append" => format!(
            "add to the LaTeX file {} of {doc}",
            named(text(input, "file"), "the file")
        ),
        "latex_delete_file" => format!(
            "move the LaTeX file {} of {doc} to the trash",
            named(text(input, "file"), "the file")
        ),
        "latex_add_asset" => format!(
            "add the picture {} to {doc}",
            named(text(input, "name"), "a picture")
        ),
        "latex_cite" => format!(
            "cite a reference in the LaTeX file {} of {doc}",
            named(text(input, "file"), "the file")
        ),
        "latex_send_page" => {
            let page = named(text(input, "page"), "the page");
            match text(input, "doc") {
                "" => format!("make a LaTeX document from the page {page}"),
                _ => format!("add the page {page} to the LaTeX document {doc}"),
            }
        }
        "latex_export_pdf" => format!("keep the PDF of {doc}"),
        "diagram_to_latex_figure" => {
            format!("draw {} as a figure of {doc}", diagram_named(input))
        }
        _ if input["wait"] == Value::Bool(true) => format!("build {doc} in the app"),
        _ => format!("read the last build of {doc}"),
    })
}

/// How a save of a file went, in words that follow the verb ("Changed", "Added to").
fn saved_words(done: &Value, verb: &str, file: &str) -> String {
    match text(done, "status") {
        "unchanged" => format!("The LaTeX file {file} was already as asked"),
        "merged" => format!("{verb} the LaTeX file {file} and kept the changes made meanwhile"),
        "conflict" => format!(
            "The LaTeX file {file} changed on the same lines, so the change was kept in a copy"
        ),
        _ => format!("{verb} the LaTeX file {file}"),
    }
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
        "latex_edit" | "latex_write_file" | "latex_append" => {
            let done = &value["result"];
            let file = named(text(value, "file"), "the file");
            // A write with no hash made the file.
            let made = name == "latex_write_file" && text(input, "base_hash").is_empty();
            let verb = match name {
                "latex_append" => "Added to",
                _ if made => "Made",
                _ => "Changed",
            };
            (saved_words(done, verb, &file), own(text(done, "path")))
        }
        "latex_create_document" => {
            let done = &value["result"];
            let title = match text(done, "title") {
                "" => text(input, "title"),
                title => title,
            };
            (
                format!("Started the LaTeX document “{title}”"),
                own(text(done, "path")),
            )
        }
        "latex_delete_file" => {
            let done = &value["result"];
            let file = named(text(value, "file"), "the file");
            let paths = [text(done, "path"), text(done, "trashed")]
                .into_iter()
                .filter(|p| !p.is_empty())
                .map(str::to_owned)
                .collect();
            (format!("Moved the LaTeX file {file} to the trash"), paths)
        }
        "latex_add_asset" => {
            let done = &value["result"];
            let picture = match text(done, "figure") {
                "" => named(text(input, "name"), "a picture"),
                figure => named(figure, "a picture"),
            };
            let doc = named(text(input, "doc"), "the document");
            let words = if text(done, "status") == "existing" {
                format!("The picture {picture} was in {doc} already")
            } else {
                format!("Added the picture {picture} to {doc}")
            };
            (words, own(text(done, "path")))
        }
        "latex_cite" => {
            let done = &value["result"];
            let file = named(text(value, "file"), "the file");
            let paths = [text(done, "path"), text(&done["bib"], "path")]
                .into_iter()
                .filter(|p| !p.is_empty())
                .map(str::to_owned)
                .collect();
            (format!("Cited a reference in the LaTeX file {file}"), paths)
        }
        "latex_send_page" => {
            let done = &value["result"];
            let doc = named(text(done, "doc"), "the document");
            let words = if done["appended"] == Value::Bool(true) {
                format!("Added the page to the LaTeX document {doc}")
            } else {
                format!("Made the LaTeX document {doc} from the page")
            };
            (words, own(text(done, "path")))
        }
        "latex_export_pdf" => {
            let doc = named(
                text(value, "doc"),
                &named(text(input, "doc"), "the document"),
            );
            let words = if text(value, "status") == "pending_review" {
                format!("The PDF of {doc} waits for review")
            } else {
                format!("Kept the PDF of {doc}")
            };
            (words, own(text(&value["result"], "path")))
        }
        "diagram_to_latex_figure" => {
            let done = &value["result"];
            let doc = named(
                text(value, "doc"),
                &named(text(input, "doc"), "the document"),
            );
            let diagram = diagram_named(input);
            let words = if text(done, "status") == "existing" {
                format!("The picture of {diagram} was in {doc} already")
            } else {
                format!("Drew {diagram} as a figure of {doc}")
            };
            (words, own(text(done, "path")))
        }
        _ => {
            let doc = named(text(input, "doc"), "the document");
            let words = if value["waited"] == Value::Bool(true) {
                format!(
                    "Built {doc}: {}, {}",
                    count(value["errors"].as_u64().unwrap_or(0) as usize, "error"),
                    count(value["warnings"].as_u64().unwrap_or(0) as usize, "warning")
                )
            } else if value["built"] != Value::Bool(true) {
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
mod tests;
