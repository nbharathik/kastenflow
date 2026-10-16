//! A storyboard: the slides a page would make, drafted before any slide exists. Each [`StoryEntry`] is one slide-to-be
//! (its title, the point it makes, the evidence on it, what the speaker says), with the section of the page it came
//! from. A person reorders, merges, splits, drops and rewrites the entries; `add_storyboard_slides` then makes the
//! slides. Nothing here reads a file: the host hands over the page's Markdown.
//!
//! The words an entry puts on its slide are [`compose`]d from its point and evidence, one Markdown text, so the same
//! rule draws a slide when it is made and again when the page changes ([`section_body`]).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::lines::item_of;
use super::{
    Block, PageSection, blocks, fingerprint, parts, plain, section_markdown, sections,
    strip_frontmatter,
};
use crate::markdown::to_markdown;
use crate::model::{Paragraph, Run};

/// The longest a point is, in characters.
const POINT_CHARS: usize = 200;

/// Where an entry's words come from: a page of the host, and the Markdown of the part of it that was read.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StorySource {
    /// The page, as the host names pages (a vault path in KastenFlow).
    pub page: String,
    /// The host's stable name for the page, if it has one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// What the page is called.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// The heading whose section this is, as the page writes it. Absent for words that are not a section of the page by a heading (the words before the first heading, a part cut at dividers).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub section: Option<String>,
    /// The Markdown that was read: the whole page when asking for a draft, the section's text in an entry. Its fingerprint is what the slide is compared with when the page changes.
    #[serde(default)]
    pub markdown: String,
}

/// One slide of a storyboard.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StoryEntry {
    /// The slide's title: the section's heading.
    pub title: String,
    /// The point the slide makes: the first sentence of the section's first paragraph. It leads the slide's words.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub point: Option<String>,
    /// What backs the point up, one Markdown block each in the order of the page: a list item (nested ones indented by two spaces), a picture, a table, code or a formula.
    #[serde(default)]
    pub evidence: Vec<String>,
    /// What the speaker says: the section's prose, as Markdown. It goes to the slide's notes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    /// The layout of the slide; `title-body`, or `section` for a slide with no words, when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<String>,
    /// Whether the evidence holds a picture, a table, code or a formula.
    #[serde(default)]
    pub media: bool,
    /// The sections of pages it came from: one for a slide drafted from one section, more once entries were merged.
    #[serde(default)]
    pub sources: Vec<StorySource>,
}

/// A part of a page that is already cut: a title and the Markdown under it (the sections of a page that is cut at dividers).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StoryChunk {
    pub title: String,
    pub markdown: String,
}

/// The first sentence of some Markdown, at most [`POINT_CHARS`] characters long.
fn first_sentence(markdown: &str) -> String {
    let flat = markdown.split_whitespace().collect::<Vec<_>>().join(" ");
    let end = flat
        .char_indices()
        .find(|&(i, c)| {
            matches!(c, '.' | '!' | '?')
                && flat[i + c.len_utf8()..]
                    .chars()
                    .next()
                    .is_none_or(char::is_whitespace)
        })
        .map_or(flat.len(), |(i, c)| i + c.len_utf8());
    let sentence = &flat[..end];
    if sentence.chars().count() > POINT_CHARS {
        let cut: String = sentence.chars().take(POINT_CHARS - 1).collect();
        format!("{}…", cut.trim_end())
    } else {
        sentence.to_owned()
    }
}

/// The Markdown of some runs, on one line.
fn inline(runs: &[Run]) -> String {
    let paragraph = Paragraph {
        runs: runs.to_vec(),
        ..Paragraph::plain("")
    };
    to_markdown(&[paragraph])
        .replace('\n', " ")
        .trim()
        .to_owned()
}

/// A table as GitHub-style Markdown, its first row the header.
fn table_markdown(rows: &[Vec<Vec<Run>>]) -> String {
    let columns = rows.iter().map(Vec::len).max().unwrap_or(1).max(1);
    let line = |row: &[Vec<Run>]| {
        let cells: Vec<String> = (0..columns)
            .map(|c| {
                row.get(c)
                    .map(|runs| inline(runs).replace('|', "\\|"))
                    .unwrap_or_default()
            })
            .collect();
        format!("| {} |", cells.join(" | "))
    };
    let mut out = Vec::new();
    for (n, row) in rows.iter().enumerate() {
        out.push(line(row));
        if n == 0 {
            out.push(format!("|{}", " --- |".repeat(columns)));
        }
    }
    out.join("\n")
}

/// A fence longer than any run of backticks inside.
fn code_markdown(language: &str, code: &str) -> String {
    let longest = code.split(|c| c != '`').map(str::len).max().unwrap_or(0);
    let bar = "`".repeat((longest + 1).max(3));
    format!("{bar}{language}\n{code}\n{bar}")
}

/// The evidence a block makes, if it is evidence and not prose.
fn evidence_of(block: &Block) -> Option<String> {
    Some(match block {
        Block::Item {
            level,
            ordered,
            checked,
            runs,
        } => {
            let marker = if *ordered { "1. " } else { "- " };
            let task = match checked {
                Some(true) => "[x] ",
                Some(false) => "[ ] ",
                None => "",
            };
            format!(
                "{}{marker}{task}{}",
                "  ".repeat(usize::from(*level)),
                inline(runs)
            )
        }
        // A heading inside a section is a bold line among its list, as it is when a note is made into a deck.
        Block::Heading { runs, .. } => format!("- **{}**", plain(runs).trim()),
        Block::Image { src, alt } => format!("![{alt}]({src})"),
        Block::Table { rows, .. } => table_markdown(rows),
        Block::Code { language, code } => code_markdown(language, code),
        Block::Math { latex } => format!("$$\n{latex}\n$$"),
        Block::Paragraph { .. } | Block::Quote { .. } | Block::Rule => return None,
    })
}

/// Whether a block is a picture, a table, code or a formula.
fn is_media(block: &Block) -> bool {
    matches!(
        block,
        Block::Image { .. } | Block::Table { .. } | Block::Code { .. } | Block::Math { .. }
    )
}

/// An entry from the blocks under a heading (the heading itself is `title`).
fn entry_of(title: &str, under: &[Block], sources: Vec<StorySource>) -> StoryEntry {
    let mut evidence = Vec::new();
    let mut prose = Vec::new();
    let mut point = None;
    for block in under {
        match block {
            Block::Paragraph { runs } => {
                let words = inline(runs);
                if point.is_none() && !words.is_empty() {
                    point = Some(first_sentence(&words));
                }
                prose.push(words);
            }
            Block::Quote { runs, .. } => prose.push(format!("> {}", inline(runs))),
            other => evidence.extend(evidence_of(other)),
        }
    }
    StoryEntry {
        title: title.to_owned(),
        point,
        evidence,
        notes: Some(prose.join("\n\n")).filter(|n| !n.is_empty()),
        layout: None,
        media: under.iter().any(is_media),
        sources,
    }
}

/// Whether a line of Markdown is an item of a list.
fn is_item(line: &str) -> bool {
    item_of(line).is_some()
}

/// The words an entry puts on its slide, as Markdown: its point, then its evidence. List items follow one another; everything else stands apart.
pub fn compose(entry: &StoryEntry) -> String {
    let mut out = String::new();
    let mut after_item = false;
    let point = entry.point.as_deref().map(str::trim).unwrap_or_default();
    if !point.is_empty() {
        out.push_str(point);
    }
    for block in &entry.evidence {
        let block = block.trim_end();
        if block.trim().is_empty() {
            continue;
        }
        let item = !block.contains('\n') && is_item(block);
        if !out.is_empty() {
            out.push_str(if item && after_item { "\n" } else { "\n\n" });
        }
        out.push_str(block);
        after_item = item;
    }
    out
}

/// Whether a picture's address is one a deck cannot keep: a page on the web, inline data, nothing at all.
pub fn is_remote(src: &str) -> bool {
    let src = src.trim().to_ascii_lowercase();
    src.is_empty() || src.contains("://") || src.starts_with("data:") || src.starts_with("//")
}

/// The blocks an entry's slide shows, and the addresses of the pictures that were left out because a deck cannot keep them.
pub fn body_blocks(entry: &StoryEntry) -> (Vec<Block>, Vec<String>) {
    let mut left_out = Vec::new();
    let kept = blocks(&compose(entry))
        .into_iter()
        .filter(|block| match block {
            Block::Image { src, .. } if is_remote(src) => {
                left_out.push(src.clone());
                false
            }
            _ => true,
        })
        .collect();
    (kept, left_out)
}

/// The entry that the section `markdown` drafts. Its heading line comes first and is the title, not content.
fn section_entry(title: &str, markdown: &str) -> StoryEntry {
    let mut all = blocks(markdown);
    if matches!(all.first(), Some(Block::Heading { .. })) {
        all.remove(0);
    }
    entry_of(title, &all, Vec::new())
}

/// The blocks of the slide that the section `markdown` makes: what `draft` says for it, composed. Used again when the page changes, so the
/// slide is made the way it was.
pub fn section_body(title: &str, markdown: &str) -> Vec<Block> {
    body_blocks(&section_entry(title, markdown)).0
}

/// Whether an entry still says what its one section says: nothing was merged into it, and its point and evidence were not rewritten.
pub fn is_as_drafted(entry: &StoryEntry) -> bool {
    let [source] = entry.sources.as_slice() else {
        return false;
    };
    source
        .section
        .as_deref()
        .is_some_and(|heading| compose(entry) == compose(&section_entry(heading, &source.markdown)))
}

/// The part of `source.markdown` that `section` names, when it is exactly what `markdown` says of the same section.
fn tracked(source: &StorySource, heading: &str, text: &str) -> Option<String> {
    let found = section_markdown(&source.markdown, heading)?;
    (fingerprint(&found) == fingerprint(text)).then_some(found)
}

fn source_for(page: &StorySource, section: Option<String>, markdown: String) -> StorySource {
    StorySource {
        page: page.page.clone(),
        id: page.id.clone(),
        title: page.title.clone(),
        section,
        markdown,
    }
}

/// The slides of a page: one entry for each section at a heading level (`split`, 1 to 6; 0 for the level that suits the page), and one for
/// the words before the first heading. `source.markdown` is the whole page. A section the host can find again by its heading (the ones at
/// the level the page is cut at) names it; the rest are drafted from their words alone.
pub fn draft(source: &StorySource, split: u8) -> Vec<StoryEntry> {
    let all = blocks(&source.markdown);
    let cut = parts(&all, split, "");
    if cut.is_empty() {
        return Vec::new();
    }
    let level = super::slides::level_of(&all, split);
    let body = strip_frontmatter(&source.markdown);
    let lines: Vec<&str> = body.lines().collect();
    let heads: Vec<PageSection> = if level == 0 {
        Vec::new()
    } else {
        sections(&source.markdown)
            .into_iter()
            .filter(|s| s.level <= level)
            .collect()
    };
    let intro = cut.len() == heads.len() + 1;
    // Headings the two readers disagree about (a `#` inside a formula, say) leave nothing to place a part by.
    let aligned = intro || cut.len() == heads.len();
    let intro_title = source
        .title
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .unwrap_or("Overview");
    let mut out = Vec::with_capacity(cut.len());
    for (n, part) in cut.iter().enumerate() {
        if intro && n == 0 {
            let end = heads.first().map_or(lines.len(), |h| h.line);
            let text = lines[..end.min(lines.len())].join("\n").trim().to_owned();
            out.push(entry_of(
                intro_title,
                &part.blocks,
                vec![source_for(source, None, text)],
            ));
            continue;
        }
        if !aligned {
            let title = plain(&part.title);
            out.push(entry_of(
                &title,
                &part.blocks,
                vec![source_for(source, None, String::new())],
            ));
            continue;
        }
        let head = &heads[n - usize::from(intro)];
        let end = heads
            .get(n - usize::from(intro) + 1)
            .map_or(lines.len(), |next| next.line);
        let text = lines[head.line.min(lines.len())..end.min(lines.len())]
            .join("\n")
            .trim_end()
            .to_owned();
        let title = plain(&part.title);
        let section = (head.level == level)
            .then(|| {
                tracked(source, &head.heading, &text).map(|found| (head.heading.clone(), found))
            })
            .flatten();
        let (section, text) = match section {
            Some((heading, found)) => (Some(heading), found),
            None => (None, text),
        };
        out.push(entry_of(
            &title,
            &part.blocks,
            vec![source_for(source, section, text)],
        ));
    }
    out
}

/// The slides of a page that is already cut into parts (by dividers, say): one entry for each. A part whose title is a heading of the page
/// and which says what that section says is tracked by it; the rest are drafted from their words alone.
pub fn draft_chunks(source: &StorySource, chunks: &[StoryChunk]) -> Vec<StoryEntry> {
    chunks
        .iter()
        .map(|chunk| {
            let mut under = blocks(&chunk.markdown);
            let mut title = chunk.title.trim().to_owned();
            if let Some(Block::Heading { runs, .. }) = under.first() {
                let heading = plain(runs).trim().to_owned();
                if title.is_empty() {
                    title = heading;
                    under.remove(0);
                } else if heading.eq_ignore_ascii_case(&title) {
                    under.remove(0);
                }
            }
            if title.is_empty() {
                title = "Untitled".to_owned();
            }
            let mine = entry_of(&title, &under, Vec::new());
            let found = section_markdown(&source.markdown, &title)
                .filter(|text| compose(&section_entry(&title, text)) == compose(&mine));
            let from = match found {
                Some(text) => source_for(source, Some(title.clone()), text),
                None => source_for(source, None, chunk.markdown.trim().to_owned()),
            };
            StoryEntry {
                sources: vec![from],
                ..mine
            }
        })
        .collect()
}

#[cfg(test)]
#[path = "storyboard_tests.rs"]
mod tests;
