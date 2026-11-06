//! The agents' own tools (a shell, reading and changing files, searching) in
//! words for the person: a line for a step, and the question a card asks.
//! KastenFlow's tools are described by the chat's own summaries.

use serde_json::Value;

/// At most `max` characters of the first line.
pub fn clip(text: &str, max: usize) -> String {
    let line = text
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or_default();
    match line.char_indices().nth(max) {
        Some((at, _)) => format!("{}…", &line[..at]),
        None => line.to_owned(),
    }
}

fn field<'a>(input: &'a Value, keys: &[&str]) -> &'a str {
    keys.iter()
        .find_map(|k| input[*k].as_str().map(str::trim).filter(|s| !s.is_empty()))
        .unwrap_or_default()
}

fn file(input: &Value) -> &str {
    field(input, &["file_path", "filePath", "path", "notebook_path"])
}

/// What the call does, in a few words: "Ran npm test", "Read notes.md".
pub fn describe(name: &str, input: &Value) -> String {
    let lower = name.to_ascii_lowercase();
    let with = |verb: &str, what: &str| {
        if what.is_empty() {
            verb.to_owned()
        } else {
            format!("{verb} {}", clip(what, 90))
        }
    };
    match lower.as_str() {
        "bash" | "shell" | "powershell" => with("Ran", field(input, &["command"])),
        "read" => with("Read", file(input)),
        "write" => with("Wrote", file(input)),
        "edit" | "multiedit" | "notebookedit" | "patch" | "apply_patch" => {
            with("Changed", file(input))
        }
        "glob" => with("Looked for files", field(input, &["pattern"])),
        "grep" => with("Searched for", field(input, &["pattern"])),
        "list" | "ls" => with("Listed", file(input)),
        "webfetch" => with("Fetched", field(input, &["url"])),
        "websearch" => with("Searched the web for", field(input, &["query"])),
        "todowrite" => "Updated its to-do list".to_owned(),
        "task" | "agent" => with("Started a helper:", field(input, &["description"])),
        _ => {
            let words = name.replace(['_', '-'], " ");
            let words = words.trim();
            if words.is_empty() {
                "Used a tool".to_owned()
            } else {
                format!("Used {words}")
            }
        }
    }
}

/// The question a card asks about a call that needs the person's yes.
pub fn question(agent: &str, name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    let what = match lower.as_str() {
        "bash" | "shell" | "powershell" => "run a command".to_owned(),
        "write" | "edit" | "multiedit" | "notebookedit" | "patch" | "apply_patch" => {
            "change a file".to_owned()
        }
        "read" | "glob" | "grep" | "list" | "ls" => "read files".to_owned(),
        "webfetch" | "websearch" => "use the web".to_owned(),
        _ => format!("use {}", name.replace(['_', '-'], " ").trim()),
    };
    format!("Allow {agent} to {what}?")
}

/// The longest input a card shows, in characters. Allow runs the whole input, so
/// a call longer than this cannot be reviewed and is refused instead.
pub const MAX_DETAIL: usize = 10_000;

/// A field that says what a single-field call is about; shown without its name.
const PRIMARY: [&str; 6] = [
    "command",
    "url",
    "file_path",
    "filePath",
    "path",
    "notebook_path",
];

fn show(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

/// What the card shows under the question: all of the call's input, every field
/// of it (a command with a switch, a path with the text to write), as it will
/// run. None when it is longer than `MAX_DETAIL`. The agent's own label for a
/// command (`description`) runs nothing and is left out.
pub fn detail(name: &str, input: &Value) -> Option<String> {
    let lower = name.to_ascii_lowercase();
    let labelled = matches!(lower.as_str(), "bash" | "shell" | "powershell");
    let shown = match input {
        Value::Object(fields) => {
            let fields: Vec<(&String, &Value)> = fields
                .iter()
                .filter(|(key, value)| !(labelled && *key == "description") && !value.is_null())
                .collect();
            match fields.as_slice() {
                [(key, value)] if PRIMARY.contains(&key.as_str()) => show(value),
                _ => fields
                    .iter()
                    .map(|(key, value)| format!("{key}: {}", show(value)))
                    .collect::<Vec<_>>()
                    .join("\n"),
            }
        }
        Value::Null => String::new(),
        other => show(other),
    };
    (shown.chars().count() <= MAX_DETAIL).then_some(shown)
}
