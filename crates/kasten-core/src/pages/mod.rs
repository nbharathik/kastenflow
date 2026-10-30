//! A page as blocks, for agents: `read_page_blocks` lists them (an id, a kind,
//! the headings above, a glimpse of the text and a hash of the bytes), and
//! `edit_page` changes them with steps that name blocks by id and hash. Steps
//! are cut from the page's own bytes: the blocks a step does not touch keep
//! every byte, and a step on a block that is no longer as it was read is
//! refused, with nothing written.
//!
//! The blocks come from a line scanner of CommonMark's block rules (`scan`),
//! so the page is cut where the editor cuts it; toggles and columns are paired
//! as the editor pairs them (`tree`). Where a rule is unsure a block comes out
//! larger, never smaller.

mod apply;
mod blocks;
mod edits;
mod lines;
mod markers;
mod scan;
mod scan_html;
mod scan_list;
mod scan_rules;
mod steps;
mod table;
mod table_edit;
mod todo;
mod tree;
mod wrap;

pub use apply::{Edited, MAX_STEPS, edit_body};
pub use blocks::{Block, Kind, Page, TableSize};
pub use steps::{BlockRef, PageStep, STEP_NAMES};
pub use todo::Todo;

use serde::Serialize;

use crate::frontmatter::split;

/// What `read_page_blocks` answers.
#[derive(Debug, Clone, Serialize)]
pub struct PageBlocks {
    pub path: String,
    pub title: String,
    /// The hash of the whole file as it was read.
    pub hash: String,
    /// How many blocks the page has.
    pub total: usize,
    /// More blocks follow the ones listed.
    pub truncated: bool,
    pub blocks: Vec<Block>,
}

/// The blocks of a page's text (frontmatter left out).
pub fn blocks_of(text: &str) -> Vec<Block> {
    Page::parse(split(text).body).blocks
}

/// `text` (a whole file) with the steps made on its body; the frontmatter and
/// every byte of the blocks no step touches stay as they are. The pure part of
/// the `edit_page` op.
pub fn edit_text(text: &str, steps: &[PageStep]) -> crate::error::Result<(String, Edited)> {
    let edited = edit_note(text, steps)?;
    Ok((format!("{}{}", split(text).prefix, edited.body), edited))
}

/// The steps made on the body of a note's whole text (`Edited::body` is the
/// new body). A body with no line end of its own gets the file's.
pub fn edit_note(text: &str, steps: &[PageStep]) -> crate::error::Result<Edited> {
    let eol = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let parts = split(text);
    let edited = apply::edit_body_as(parts.body, steps, eol)?;
    // A page without frontmatter that now began with a `---` line would read
    // that line as the start of some: saving would have to spell the rule
    // another way, which is a change to a block no step named.
    if edited.changed
        && matches!(
            crate::frontmatter::body_under(parts.prefix, &edited.body),
            std::borrow::Cow::Owned(_)
        )
    {
        return Err(crate::error::Error::Invalid(
            "After this change the page would begin with a line of three dashes (---), which reads as the start of frontmatter. Keep a block above it. Nothing was written"
                .to_owned(),
        ));
    }
    Ok(edited)
}
