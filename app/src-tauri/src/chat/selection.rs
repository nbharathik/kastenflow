//! Selected text as context: a passage the person marked in a page, a PDF, a
//! LaTeX source or a slide, sent with its place (a snippet and a pointer, so
//! the model reads more with the tools when it needs to). Up to five passages
//! the person pinned and one that follows the selection of the moment. The
//! text is data: it sits inside the context block's fence, where no tag of
//! the block can be closed from within it.

use serde::Deserialize;

use super::ContextChip;
use super::context::{Part, attr, cut, quoted};

/// The most characters of one selected passage that go to the model.
pub const TEXT_LIMIT: usize = 4_000;
/// The most pinned passages one message carries.
pub const MAX_PINNED: usize = 5;
/// The most automatic passages (the live selection) one message carries.
pub const MAX_AUTO: usize = 1;

/// What the passage was taken from.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    /// `page`, `pdf`, `latex` or `slide`.
    pub kind: String,
    /// The file's path in the vault.
    pub path: String,
    /// A note's id or a slide's id, when it has one.
    #[serde(default)]
    pub id: Option<String>,
}

/// Where in the source the passage starts and ends, as the window counts.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
pub struct Range {
    pub from: usize,
    pub to: usize,
}

/// A selection chip's content.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Selection {
    pub source: Source,
    pub text: String,
    /// The heading the passage sits under, when the window knows it.
    #[serde(default)]
    pub heading: Option<String>,
    #[serde(default)]
    pub range: Option<Range>,
    /// The person pinned it; else it follows the live selection.
    #[serde(default)]
    pub pinned: bool,
}

/// The passages of `chips` a message carries: at most `MAX_PINNED` pinned (the
/// first ones) and `MAX_AUTO` automatic (the last, which is the newest). The
/// count of the passages left out comes with them.
pub fn chosen(chips: &[ContextChip]) -> (Vec<&ContextChip>, usize) {
    let selections = |pinned: bool| -> Vec<usize> {
        chips
            .iter()
            .enumerate()
            .filter(|(_, c)| {
                c.kind == "selection" && c.selection.as_ref().is_some_and(|s| s.pinned == pinned)
            })
            .map(|(at, _)| at)
            .collect()
    };
    let pinned = selections(true);
    let auto = selections(false);
    let mut keep: Vec<usize> = pinned.iter().take(MAX_PINNED).copied().collect();
    keep.extend(auto.iter().rev().take(MAX_AUTO).copied());
    let left_out = pinned.len() + auto.len() - keep.len();
    let kept = chips
        .iter()
        .enumerate()
        // A selection chip with no passage is kept: it says so in its place.
        .filter(|(at, c)| c.kind != "selection" || c.selection.is_none() || keep.contains(at))
        .map(|(_, c)| c)
        .collect();
    (kept, left_out)
}

/// The text to send: at most `TEXT_LIMIT` characters, with a marker saying so
/// where it was cut.
pub fn limited(text: &str) -> String {
    if text.chars().count() <= TEXT_LIMIT {
        return text.to_owned();
    }
    format!(
        "{}\n… [cut here: the selection is longer than {} characters; read the whole page with read_note]",
        cut(text, TEXT_LIMIT).trim_end(),
        TEXT_LIMIT
    )
}

fn place(source: &Source) -> String {
    format!("{}:{}", attr(&source.kind), attr(&source.path))
}

/// One selection chip as a part of the context block.
pub(crate) fn part(chip: &ContextChip) -> Part {
    let Some(selection) = &chip.selection else {
        return Part {
            name: "a selection".to_owned(),
            open: "<selection>".to_owned(),
            body: "(The selected text did not arrive.)".to_owned(),
            close: "</selection>".to_owned(),
        };
    };
    let mut open = format!("<selection source=\"{}\"", place(&selection.source));
    if let Some(id) = &selection.source.id {
        open.push_str(&format!(" id=\"{}\"", attr(id)));
    }
    if let Some(heading) = selection
        .heading
        .as_deref()
        .filter(|h| !h.trim().is_empty())
    {
        open.push_str(&format!(" heading=\"{}\"", attr(heading)));
    }
    if let Some(range) = selection.range {
        open.push_str(&format!(" range=\"{}-{}\"", range.from, range.to));
    }
    open.push('>');
    Part {
        // The name reaches the "cut" line outside any fence: no tag in it.
        name: format!("selection from {}", quoted(&attr(&selection.source.path))),
        open,
        body: limited(&selection.text),
        close: "</selection>".to_owned(),
    }
}

/// The line that says passages were left out, as a part of the block.
pub(crate) fn left_out_part(count: usize) -> Part {
    Part {
        name: "selections".to_owned(),
        open: "<selection-limit>".to_owned(),
        body: format!(
            "({count} more selected passage{} left out: a message carries at most {MAX_PINNED} pinned and {MAX_AUTO} automatic.)",
            if count == 1 { " was" } else { "s were" }
        ),
        close: "</selection-limit>".to_owned(),
    }
}
