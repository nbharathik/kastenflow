//! Pages of the host, as a deck sees them. A Kasten page is Markdown; a deck takes from it by reading it into
//! [`Block`]s, finding its [`PageSection`]s, and making elements of what one of them says. Nothing here reads a
//! file: the host hands over the Markdown, which is why a deck made from a page still opens where there is no
//! such page, and why a standalone build can show an embedded page from what the deck kept.
//!
//! The dialect is the one pages are written in: headings, paragraphs, bullets, numbers and to-dos with indents,
//! quotes and callouts (`> [!tip]`), fenced code, tables, pictures, block formulas (`$$`), rules, toggles
//! (`<details>`), wiki links (`[[Page|words]]`, which become links to `page:Page`), and the inline marks the
//! slide Markdown reads. What it does not know it keeps as words.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::Run;

mod build;
mod inline;
mod lines;
mod made;
mod parse;
mod sections;
mod slides;
mod storyboard;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_build;

pub use build::{Sizes, contents, has_media, media_elements, split, text_paragraphs};
pub use inline::page_link;
pub use made::{is_fingerprint, made_of};
pub use parse::blocks;
pub use sections::{fingerprint, plain, section_markdown, sections, strip_frontmatter};
pub use slides::{Part, parts};
pub use storyboard::{
    StoryChunk, StoryEntry, StorySource, body_blocks, compose, draft, draft_chunks, is_as_drafted,
    is_remote, section_body,
};

model! {
    /// One block of a page.
    #[serde(tag = "type", rename_all = "camelCase")]
    pub enum Block {
        /// A heading, level 1 to 6.
        Heading { level: u8, runs: Vec<Run> },
        Paragraph { runs: Vec<Run> },
        /// One item of a list: its indent `level` from 0, whether the list is numbered, and for a to-do whether it is ticked.
        Item {
            level: u8,
            ordered: bool,
            #[serde(default, skip_serializing_if = "Option::is_none")]
            checked: Option<bool>,
            runs: Vec<Run>,
        },
        /// A quote; the first block of a callout names its kind (`tip`, `note`, `warning` ...).
        Quote {
            #[serde(default, skip_serializing_if = "Option::is_none")]
            callout: Option<String>,
            runs: Vec<Run>,
        },
        /// Code with the language its fence named.
        Code { language: String, code: String },
        /// A formula on lines of its own, in LaTeX.
        Math { latex: String },
        /// A picture: where it is in the host's store, and its alternative words.
        Image { src: String, alt: String },
        /// A table: the rows of cells, each the runs of the cell; the first row is a header when `header` says so.
        Table { header: bool, rows: Vec<Vec<Vec<Run>>> },
        /// A horizontal rule.
        Rule,
    }
}

/// A heading of a page and what lies under it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PageSection {
    /// The heading as it is written, marks and all: what the host finds the section by.
    pub heading: String,
    /// What a person calls it: the heading without its marks.
    pub title: String,
    /// 1 for `#` to 6 for `######`.
    pub level: u8,
    /// The line of the page (from 0, below the frontmatter) it begins at, and the line after the last it holds.
    pub line: usize,
    pub end: usize,
}
