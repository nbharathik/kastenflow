//! Context chips: what the person attached to a message
//! (a note, cards, a board, a tag's view, search results, a slide deck or the
//! slide they are looking at, a diagram, pages or highlights of a PDF), read through the core and put before their
//! words in one marked block of at most about 60,000 characters, with a line
//! saying what was cut. Text the person attached as a file or by pasting
//! (`attachment`) goes in the same block.

use kasten_core::Kasten;
use kasten_core::agent::Session;

use super::ContextChip;

pub mod attachment;
mod boards;
mod decks;
mod diagrams;
mod frames;
mod notes;
pub mod pdf;

pub use attachment::TextAttachment;
pub use frames::{fence, fence_tags};
pub use pdf::Excerpt;

/// The most context one message carries, in characters.
pub const LIMIT: usize = 60_000;

/// One attached thing: `open`, `body` and `close`, so a cut keeps the tags.
pub(crate) struct Part {
    pub(crate) name: String,
    pub(crate) open: String,
    pub(crate) body: String,
    pub(crate) close: String,
}

fn chars(text: &str) -> usize {
    text.chars().count()
}

/// At most `max` characters of `text`, ending at a line end when one is near.
pub(crate) fn cut(text: &str, max: usize) -> &str {
    let end = text.char_indices().nth(max).map_or(text.len(), |(i, _)| i);
    match text[..end].rfind('\n') {
        Some(line) if line > end / 2 => &text[..line],
        _ => &text[..end],
    }
}

pub(crate) fn attr(value: &str) -> String {
    value
        .replace('"', "'")
        .replace(['\n', '\r'], " ")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

pub(crate) fn quoted(name: &str) -> String {
    format!("“{}”", name.trim())
}

fn listing(names: &[String]) -> String {
    match names {
        [] => String::new(),
        [one] => one.clone(),
        [rest @ .., last] => format!("{} and {last}", rest.join(", ")),
    }
}

fn parts(
    kasten: &Kasten,
    session: &Session,
    chip: &ContextChip,
    excerpts: &[Excerpt],
) -> Vec<Part> {
    let first = chip.refs.first().map(String::as_str).unwrap_or_default();
    match chip.kind.as_str() {
        "note" => vec![notes::note(kasten, first)],
        "cards" => chip.refs.iter().map(|p| notes::note(kasten, p)).collect(),
        "board" => vec![boards::board(kasten, first)],
        "tag" => vec![notes::tag(kasten, session, &chip.refs)],
        "search" => vec![notes::search(kasten, first)],
        "deck" => vec![decks::deck(kasten, first)],
        "slide" => vec![decks::slide(kasten, &chip.refs)],
        "diagram" => vec![diagrams::diagram(kasten, session, &chip.refs)],
        "pdf" => vec![pdf::pdf(kasten, &chip.refs, excerpts)],
        other => {
            let kind: String = other
                .chars()
                .filter(|c| c.is_ascii_alphanumeric())
                .collect();
            vec![Part {
                name: chip.label.clone(),
                open: format!("<{kind}>"),
                body: "(KastenFlow cannot read this kind of context.)".to_owned(),
                close: format!("</{kind}>"),
            }]
        }
    }
}

/// The chips' content in one `<context>` block; empty without chips. (A turn
/// goes through `message`, which also has the PDF pages the window read.)
#[cfg(test)]
pub fn expand(kasten: &Kasten, session: &Session, chips: &[ContextChip]) -> String {
    expand_with(kasten, session, chips, &[])
}

/// `expand`, with the text of PDF pages the window read (`excerpts`) for the
/// `pdf` chips that name them.
#[cfg(test)]
pub fn expand_with(
    kasten: &Kasten,
    session: &Session,
    chips: &[ContextChip],
    excerpts: &[Excerpt],
) -> String {
    if chips.is_empty() {
        return String::new();
    }
    assemble(chip_parts(kasten, session, chips, excerpts))
}

/// What each chip stands for, read through the core.
pub(crate) fn chip_parts(
    kasten: &Kasten,
    session: &Session,
    chips: &[ContextChip],
    excerpts: &[Excerpt],
) -> Vec<Part> {
    chips
        .iter()
        .flat_map(|c| parts(kasten, session, c, excerpts))
        .collect()
}

/// `all` in one `<context>` block within `LIMIT` characters, each part's
/// text fenced, and a line saying what was cut.
pub(crate) fn assemble(all: Vec<Part>) -> String {
    let mut room = LIMIT;
    let mut shown = Vec::new();
    let mut left = Vec::new();
    let attached = all.iter().any(attachment::is_attachment);
    for part in all {
        let body = fence(&part.body);
        let frame = chars(&part.open) + chars(&part.close) + 4;
        let size = frame + chars(&body);
        if left.is_empty() && size <= room {
            room -= size;
            shown.push(format!("{}\n{body}\n{}", part.open, part.close));
        } else if left.is_empty() && room > frame + 200 {
            let kept = cut(&body, room - frame - 2);
            let dropped = chars(&body) - chars(kept);
            room = 0;
            shown.push(format!("{}\n{kept}\n…\n{}", part.open, part.close));
            // A person's own text is told how much of it went.
            left.push(if attachment::is_attachment(&part) {
                format!("the rest of {} ({dropped} characters)", part.name)
            } else {
                format!("the rest of {}", part.name)
            });
        } else {
            left.push(part.name);
        }
    }
    let from = if attached {
        "The user attached this (from their vault, and as text or files):"
    } else {
        "The user attached this from their vault:"
    };
    let mut out = format!("<context>\n{from}\n\n");
    out.push_str(&shown.join("\n\n"));
    if !left.is_empty() {
        out.push_str(&format!(
            "\n\n[Cut to stay within {LIMIT} characters: left out {}.]",
            listing(&left)
        ));
    }
    out.push_str("\n</context>");
    out
}

/// The person's words with their chips' content, and the text they attached
/// (pasted, or from a file), before them in one block: the chips first.
pub fn message_with(
    kasten: &Kasten,
    session: &Session,
    chips: &[ContextChip],
    excerpts: &[Excerpt],
    attached: &[TextAttachment],
    text: &str,
) -> String {
    let mut all = chip_parts(kasten, session, chips, excerpts);
    all.extend(attached.iter().map(attachment::part));
    let context = if chips.is_empty() && attached.is_empty() {
        String::new()
    } else {
        assemble(all)
    };
    match (context.is_empty(), text.trim().is_empty()) {
        (true, _) => text.to_owned(),
        (false, true) => context,
        (false, false) => format!("{context}\n\n{text}"),
    }
}
