//! The small text rules of the log reader: what a heading, a banner, a
//! context line, a file name or a `file:line:` prefix looks like.

use super::log::Diagnostic;

pub(super) const MAX_MESSAGE: usize = 1000;

const ON_LINE: &str = " on input line ";

/// Moves "... on input line 12." out of the message and into `line`.
pub(super) fn tidy(d: &mut Diagnostic) {
    let found = d.message.rfind(ON_LINE).and_then(|at| {
        let tail = &d.message[at + ON_LINE.len()..];
        let digits = tail.bytes().take_while(u8::is_ascii_digit).count();
        let rest = &tail[digits..];
        if digits > 0 && (rest.is_empty() || rest == ".") {
            tail[..digits].parse::<u32>().ok().map(|n| (at, n))
        } else {
            None
        }
    });
    if let Some((at, number)) = found {
        d.message.truncate(at);
        d.line = d.line.or(Some(number));
    }
    d.message = d.message.trim().to_owned();
    if let Some((end, _)) = d.message.char_indices().nth(MAX_MESSAGE) {
        d.message.truncate(end);
    }
}

/// "LaTeX Warning: x" and "Package p Error: x" without the heading ("p: x").
pub(super) fn strip_head(message: &str) -> String {
    match split_head(message) {
        Some((Some(name), _, rest)) => format!("{name}: {}", rest.trim()),
        Some((None, _, rest)) => rest.trim().to_owned(),
        None => message.trim().to_owned(),
    }
}

/// Splits a heading such as "LaTeX Warning: ", "LaTeX Error: " or
/// "Package natbib Warning: " into (package or class, is a warning, rest).
pub(super) fn split_head(message: &str) -> Option<(Option<&str>, bool, &str)> {
    for (head, warning) in [
        ("LaTeX Warning: ", true),
        ("LaTeX Font Warning: ", true),
        ("LaTeX Error: ", false),
    ] {
        if let Some(rest) = message.strip_prefix(head) {
            return Some((None, warning, rest));
        }
    }
    for kind in ["Package ", "Class "] {
        let Some(rest) = message.strip_prefix(kind) else {
            continue;
        };
        let Some((name, tail)) = rest.split_once(' ') else {
            continue;
        };
        if let Some(text) = tail.strip_prefix("Warning: ") {
            return Some((Some(name), true, text));
        }
        if let Some(text) = tail.strip_prefix("Error: ") {
            return Some((Some(name), false, text));
        }
    }
    None
}

pub(super) fn is_box_message(line: &str) -> bool {
    line.starts_with("Overfull ") || line.starts_with("Underfull ")
}

/// The first line of a TeX run (not BibTeX's).
pub(super) fn is_tex_banner(line: &str) -> bool {
    line.starts_with("This is ")
        && line.contains("TeX")
        && line.contains(", Version")
        && !line.contains("BibTeX")
}

/// What latexmk says between the runs.
pub(super) fn is_chatter(line: &str) -> bool {
    [
        "Latexmk:",
        "Rule ",
        "Run number",
        "-----",
        "Running '",
        "Category '",
        "=== ",
    ]
    .iter()
    .any(|p| line.starts_with(p))
}

/// Lines that start a message of their own.
pub(super) fn is_diag_start(line: &str) -> bool {
    [
        "LaTeX Warning",
        "LaTeX Font Warning",
        "Package ",
        "Class ",
        "Overfull ",
        "Underfull ",
        "Runaway ",
        "Missing character",
        "pdfTeX warning",
        "Warning--",
        "error: ",
        "warning: ",
    ]
    .iter()
    .any(|p| line.starts_with(p))
}

/// `(package)   more text`, the next line of a package's message.
pub(super) fn continuation(line: &str) -> Option<&str> {
    let rest = line.strip_prefix('(')?;
    let close = rest.find(')')?;
    let name = &rest[..close];
    let after = &rest[close + 1..];
    let plain = name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    (!name.is_empty() && plain && after.starts_with("  ")).then(|| after.trim())
}

/// A line of the context TeX prints after a message: `l.12 text` or one of
/// the `<argument> text` lines that say where the text being read came from.
pub(super) fn is_context_line(line: &str) -> bool {
    const SOURCES: [&str; 11] = [
        "<argument>",
        "<to be read again>",
        "<recently read>",
        "<inserted text>",
        "<template>",
        "<output>",
        "<write>",
        "<read",
        "<everypar>",
        "<everymath>",
        "<everyhbox>",
    ];
    context_number(line).is_some() || SOURCES.iter().any(|s| line.starts_with(s))
}

/// The `n` of a context line `l.<n> text`.
pub(super) fn context_number(line: &str) -> Option<u32> {
    let rest = line.strip_prefix("l.")?;
    let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
    let after = &rest[digits..];
    if digits > 0 && (after.is_empty() || after.starts_with(' ')) {
        rest[..digits].parse().ok()
    } else {
        None
    }
}

/// The number right after the first `pattern` in `text`.
pub(super) fn number_after(text: &str, pattern: &str) -> Option<u32> {
    let rest = &text[text.find(pattern)? + pattern.len()..];
    let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
    rest[..digits].parse().ok()
}

/// `file:12: message`, as `-file-line-error` and Tectonic print it.
pub(super) fn split_file_line(text: &str) -> Option<(&str, u32, &str)> {
    let mut from = 0;
    while let Some(found) = text[from..].find(':') {
        let colon = from + found;
        let rest = &text[colon + 1..];
        let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
        if digits > 0 && rest[digits..].starts_with(": ") {
            let file = &text[..colon];
            if let (true, Ok(number)) = (looks_like_file(file), rest[..digits].parse()) {
                return Some((file, number, rest[digits + 2..].trim()));
            }
        }
        from = colon + 1;
    }
    None
}

/// The name after a `(`: a quoted name may hold spaces. Returns the file, if
/// it looks like one, and how many bytes it took.
pub(super) fn file_token(text: &str) -> (Option<String>, usize) {
    let closing = text.strip_prefix('"').and_then(|quoted| quoted.find('"'));
    if let Some(end) = closing {
        let name = &text[1..=end];
        return if looks_like_file(name) {
            (Some(clean_file(name)), end + 2)
        } else {
            (None, 0)
        };
    }
    let end = text
        .find(|c: char| c.is_whitespace() || c == '(' || c == ')')
        .unwrap_or(text.len());
    let name = &text[..end];
    if looks_like_file(name) {
        (Some(clean_file(name)), end)
    } else {
        (None, 0)
    }
}

fn looks_like_file(name: &str) -> bool {
    let bytes = name.as_bytes();
    if bytes.len() < 2 || bytes.len() > 1024 {
        return false;
    }
    if name.starts_with('/')
        || name.starts_with("./")
        || name.starts_with("../")
        || name.starts_with('~')
    {
        return true;
    }
    if bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'\\' | b'/')
    {
        return true;
    }
    let Some((stem, ext)) = name.rsplit_once('.') else {
        return false;
    };
    !stem.is_empty()
        && (2..=5).contains(&ext.len())
        && ext.starts_with(|c: char| c.is_ascii_alphabetic())
        && ext.chars().all(|c| c.is_ascii_alphanumeric())
}

pub(super) fn clean_file(name: &str) -> String {
    let mut name = name.trim().trim_matches('"');
    while let Some(rest) = name.strip_prefix("./") {
        name = rest;
    }
    name.to_owned()
}

/// The index of the next `close` at or after `from`, or the end.
pub(super) fn skip_to(bytes: &[u8], from: usize, close: u8) -> usize {
    bytes[from..]
        .iter()
        .position(|&b| b == close)
        .map_or(bytes.len(), |p| from + p)
}
