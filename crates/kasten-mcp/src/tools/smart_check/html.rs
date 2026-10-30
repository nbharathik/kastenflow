//! A light read of a smart page's HTML: are the tags and comments closed, and
//! which files and kit does it name. There is no HTML parser in the program;
//! this follows the rules browsers follow for what it looks at (void and
//! optional-closing elements, text that is raw inside script and style).

use std::collections::HashMap;

use super::{Finding, Lines, PER_FILE};

const VOID: [&str; 14] = [
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source",
    "track", "wbr",
];
/// Elements a browser closes by itself, so a missing end tag is no problem.
const OPTIONAL: [&str; 15] = [
    "p", "li", "td", "th", "tr", "thead", "tbody", "tfoot", "option", "dt", "dd", "body", "html",
    "head", "colgroup",
];
/// Elements whose content is text, not tags.
const RAW: [&str; 3] = ["script", "style", "textarea"];

/// An opening tag and its attributes (names in lower case).
pub(super) struct Tag {
    pub name: String,
    pub attrs: Vec<(String, String)>,
    pub line: u32,
}

impl Tag {
    pub fn attr(&self, name: &str) -> Option<&str> {
        self.attrs
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, v)| v.as_str())
    }
}

fn attributes(text: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut chars = text.char_indices().peekable();
    while let Some(&(start, c)) = chars.peek() {
        if c.is_whitespace() || c == '/' {
            chars.next();
            continue;
        }
        let mut end = start;
        while let Some(&(at, c)) = chars.peek() {
            if c.is_whitespace() || c == '=' || c == '/' {
                break;
            }
            end = at + c.len_utf8();
            chars.next();
        }
        let name = text[start..end].to_ascii_lowercase();
        while chars.peek().is_some_and(|&(_, c)| c.is_whitespace()) {
            chars.next();
        }
        let mut value = String::new();
        if chars.peek().is_some_and(|&(_, c)| c == '=') {
            chars.next();
            while chars.peek().is_some_and(|&(_, c)| c.is_whitespace()) {
                chars.next();
            }
            match chars.peek().copied() {
                Some((_, quote @ ('"' | '\''))) => {
                    chars.next();
                    for (_, c) in chars.by_ref() {
                        if c == quote {
                            break;
                        }
                        value.push(c);
                    }
                }
                _ => {
                    while let Some(&(_, c)) = chars.peek() {
                        if c.is_whitespace() {
                            break;
                        }
                        value.push(c);
                        chars.next();
                    }
                }
            }
        }
        if !name.is_empty() {
            out.push((name, value));
        }
    }
    out
}

/// The end of the tag that starts at `from` (the index of its `>`), where a
/// `>` inside quotes does not count.
fn tag_end(text: &str, from: usize) -> Option<usize> {
    let mut quote: Option<u8> = None;
    for (at, &b) in text.as_bytes().iter().enumerate().skip(from) {
        match (quote, b) {
            (Some(q), b) if b == q => quote = None,
            (Some(_), _) => {}
            (None, b'"' | b'\'') => quote = Some(b),
            (None, b'>') => return Some(at),
            _ => {}
        }
    }
    None
}

/// The tags of the page and what is wrong with how they are written.
pub(super) fn parse(file: &str, text: &str) -> (Vec<Tag>, Vec<Finding>) {
    let low = text.to_ascii_lowercase();
    let lines = Lines::new(text);
    let mut tags = Vec::new();
    let mut found: Vec<Finding> = Vec::new();
    let mut open: Vec<(String, u32)> = Vec::new();
    // How many of each name are open, so that an end tag with no start tag is
    // found without walking the whole stack (thousands deep in a hostile file).
    let mut open_count: HashMap<String, usize> = HashMap::new();
    let mut i = 0;
    while let Some(next) = low[i..].find('<') {
        i += next;
        let rest = &low[i..];
        let line = lines.of(i);
        if let Some(inside) = rest.strip_prefix("<!--") {
            match inside.find("-->") {
                Some(n) => i += 4 + n + 3,
                None => {
                    found.push(Finding::new(
                        "error",
                        file,
                        Some(line),
                        "A comment starts here with <!-- and never ends with -->, so the rest of the file is hidden".to_owned(),
                    ));
                    break;
                }
            }
            continue;
        }
        if rest.starts_with("<!") || rest.starts_with("<?") {
            i += rest.find('>').map_or(rest.len(), |n| n + 1);
            continue;
        }
        let closing = rest.starts_with("</");
        let name_at = i + if closing { 2 } else { 1 };
        let name: String = low[name_at..]
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '-')
            .collect();
        if !name.starts_with(|c: char| c.is_ascii_alphabetic()) {
            i += 1;
            continue;
        }
        let Some(end) = tag_end(text, name_at + name.len()) else {
            found.push(Finding::new(
                "error",
                file,
                Some(line),
                format!("The tag <{name} starts here and never ends with >"),
            ));
            break;
        };
        if closing {
            let is_open = open_count.get(&name).is_some_and(|n| *n > 0);
            if let Some(pos) = is_open
                .then(|| open.iter().rposition(|(n, _)| *n == name))
                .flatten()
            {
                for (n, opened) in open.drain(pos + 1..) {
                    if let Some(c) = open_count.get_mut(&n) {
                        *c = c.saturating_sub(1);
                    }
                    if !OPTIONAL.contains(&n.as_str()) && found.len() < PER_FILE {
                        found.push(Finding::new(
                            "warning",
                            file,
                            Some(line),
                            format!("<{n}> opened on line {opened} is not closed before </{name}>"),
                        ));
                    }
                }
                open.pop();
                if let Some(c) = open_count.get_mut(&name) {
                    *c = c.saturating_sub(1);
                }
            } else if !VOID.contains(&name.as_str()) && found.len() < PER_FILE {
                found.push(Finding::new(
                    "warning",
                    file,
                    Some(line),
                    format!("</{name}> closes a <{name}> that was never opened"),
                ));
            }
            i = end + 1;
            continue;
        }
        let inside = &text[name_at + name.len()..end];
        tags.push(Tag {
            attrs: attributes(inside),
            name: name.clone(),
            line,
        });
        i = end + 1;
        if RAW.contains(&name.as_str()) {
            match low[i..].find(&format!("</{name}")) {
                Some(n) => {
                    let close = i + n;
                    i = tag_end(text, close + 2 + name.len()).map_or(text.len(), |e| e + 1);
                    continue;
                }
                None => {
                    found.push(Finding::new(
                        "error",
                        file,
                        Some(line),
                        format!("<{name}> starts here and is never closed with </{name}>, so the rest of the file is read as its text"),
                    ));
                    break;
                }
            }
        }
        if !VOID.contains(&name.as_str()) && !inside.trim_end().ends_with('/') {
            *open_count.entry(name.clone()).or_default() += 1;
            open.push((name, line));
        }
    }
    for (n, opened) in open {
        if !OPTIONAL.contains(&n.as_str()) && found.len() < PER_FILE {
            found.push(Finding::new(
                "warning",
                file,
                Some(opened),
                format!("<{n}> opened here is never closed"),
            ));
        }
    }
    (tags, found)
}

/// Files the page loads from its own folder, as the names it gives them:
/// scripts, styles, pictures, frames and media (not links to other pages).
pub(super) fn local_refs(tags: &[Tag]) -> Vec<(u32, String)> {
    let mut out = Vec::new();
    for tag in tags {
        let attr = match tag.name.as_str() {
            "script" | "img" | "source" | "video" | "audio" | "iframe" | "embed" | "track" => "src",
            "link" => "href",
            _ => continue,
        };
        let Some(value) = tag.attr(attr).map(str::trim) else {
            continue;
        };
        if value.is_empty()
            || value.starts_with(['#', '/'])
            || value.contains(':')
            || value.contains("{{")
        {
            continue;
        }
        let name = value.split(['?', '#']).next().unwrap_or(value);
        out.push((tag.line, name.to_owned()));
    }
    out
}

/// The kit versions the page names (`smart://kit/<version>/kit.js`).
pub(super) fn kit_versions(tags: &[Tag]) -> Vec<(u32, String)> {
    tags.iter()
        .filter_map(|tag| {
            let value = tag.attr("src").or_else(|| tag.attr("href"))?;
            let rest = value.strip_prefix("smart://kit/")?;
            Some((tag.line, rest.split('/').next().unwrap_or("").to_owned()))
        })
        .collect()
}
