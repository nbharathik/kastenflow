//! A page body as blocks: what an agent reads (`id`, `kind`, `depth`, the
//! headings above, a glimpse of the text, a `hash` of its bytes) and what the
//! steps need (the bytes each covers, its neighbours).

use serde::Serialize;

use super::lines::{eol_of, split_lines};
use super::scan::{Raw, RawKind, scan};
use super::scan_rules::{atx_level, atx_text, callout_header, quote_inner_once};
use super::steps::BlockRef;
use super::table::split_row;
use super::todo::{Todo, tasks};
use super::tree::{Item, build};
use crate::error::{Error, Result};
use crate::note::content_hash;

/// The longest glimpse of a block's text.
const GLIMPSE: usize = 400;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Paragraph,
    Heading,
    List,
    Todo,
    Table,
    Code,
    Quote,
    Callout,
    Toggle,
    Columns,
    Column,
    Embed,
    Math,
    Divider,
    Html,
}

/// A table's size, rows counting its header.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct TableSize {
    pub rows: usize,
    pub columns: usize,
}

/// Where a block's bytes are: its range, and the raw blocks it covers.
#[derive(Debug, Clone, Copy)]
pub(crate) struct At {
    pub start: usize,
    pub end: usize,
    pub first_raw: usize,
    pub last_raw: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct Block {
    /// `b1`, `b2`, …: the block's place in this read.
    pub id: String,
    pub kind: Kind,
    /// 0 at the top of the page; a block in a column or toggle is deeper.
    pub depth: usize,
    /// The headings above the block (a heading's own path includes itself).
    pub heading_path: Vec<String>,
    /// The block's text, cut to 400 characters.
    pub text: String,
    /// What makes a step on this block safe: it changes when the block does.
    pub hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<u8>,
    /// A toggle's summary, a callout's title.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// A callout's kind (`note`, `tip`, …).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub callout: Option<String>,
    /// The numbers after `columns`, as written.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ratio: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub table: Option<TableSize>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub todos: Vec<Todo>,
    #[serde(skip)]
    pub(crate) at: At,
    #[serde(skip)]
    pub(crate) parent: Option<usize>,
    #[serde(skip)]
    pub(crate) children: Vec<usize>,
}

/// A page body, cut into blocks.
pub struct Page<'a> {
    pub(crate) body: &'a str,
    pub(crate) raws: Vec<Raw>,
    pub blocks: Vec<Block>,
    /// The top-level blocks.
    pub(crate) roots: Vec<usize>,
    pub(crate) eol: &'static str,
}

/// The first 12 hex digits of the bytes' hash.
pub(crate) fn short_hash(text: &str) -> String {
    content_hash(text)[..12].to_owned()
}

fn glimpse(text: &str) -> String {
    let text = text.replace("\r\n", "\n");
    let mut chars = text.chars();
    let mut out: String = chars.by_ref().take(GLIMPSE).collect();
    if chars.next().is_some() {
        out.push('…');
    }
    out
}

impl<'a> Page<'a> {
    pub fn parse(body: &'a str) -> Page<'a> {
        Page::parse_as(body, "\n")
    }

    /// `parse`, for a body that may have no line end of its own: new text then
    /// ends its lines as `eol`, the way the rest of the file does.
    pub fn parse_as(body: &'a str, eol: &'static str) -> Page<'a> {
        let raws = scan(body);
        let items = build(body, &raws);
        let mut page = Page {
            body,
            raws,
            blocks: Vec::new(),
            roots: Vec::new(),
            eol: if body.contains('\n') {
                eol_of(body)
            } else {
                eol
            },
        };
        let mut path = Vec::new();
        page.roots = page.push_items(items, 0, None, &mut path);
        page
    }

    /// For each raw block: the depth of the leaf block it is, or None for a
    /// line that makes a toggle or columns block (`<details>`, `<!-- column -->`, …).
    pub(crate) fn roles(&self) -> Vec<Option<usize>> {
        let mut roles = vec![None; self.raws.len()];
        for block in &self.blocks {
            if !matches!(block.kind, Kind::Toggle | Kind::Columns | Kind::Column) {
                roles[block.at.first_raw] = Some(block.depth);
            }
        }
        roles
    }

    /// The text the blocks were cut from.
    pub fn body(&self) -> &'a str {
        self.body
    }

    /// The bytes a block covers, as `start..end` of the text.
    pub fn range_of(&self, block: &Block) -> (usize, usize) {
        (block.at.start, block.at.end)
    }

    /// The bytes of a block.
    pub(crate) fn source(&self, block: &Block) -> &'a str {
        &self.body[block.at.start..block.at.end]
    }

    /// The block a step names, if the page still has it as it was read.
    pub(crate) fn find(&self, reference: &BlockRef) -> Result<&Block> {
        let id = reference.block.trim();
        let block = id
            .strip_prefix('b')
            .and_then(|n| n.parse::<usize>().ok())
            .and_then(|n| n.checked_sub(1))
            .and_then(|at| self.blocks.get(at))
            .ok_or_else(|| {
                Error::Invalid(format!(
                    "There is no block “{id}” on this page, which has {} blocks. Nothing was written. Read the page again with read_page_blocks",
                    self.blocks.len()
                ))
            })?;
        if !block.hash.eq_ignore_ascii_case(reference.hash.trim()) {
            return Err(Error::Invalid(format!(
                "Block {id} changed since you read it, so nothing was written. Read the page again with read_page_blocks and use the new ids and hashes"
            )));
        }
        Ok(block)
    }

    fn push_items(
        &mut self,
        items: Vec<Item>,
        depth: usize,
        parent: Option<usize>,
        path: &mut Vec<(u8, String)>,
    ) -> Vec<usize> {
        items
            .into_iter()
            .map(|item| self.push_item(item, depth, parent, path))
            .collect()
    }

    fn make(
        &mut self,
        kind: Kind,
        at: At,
        depth: usize,
        parent: Option<usize>,
        path: &[(u8, String)],
    ) -> usize {
        let body: &'a str = self.body;
        let source = &body[at.start..at.end];
        let index = self.blocks.len();
        self.blocks.push(Block {
            id: format!("b{}", index + 1),
            kind,
            depth,
            heading_path: path.iter().map(|(_, text)| text.clone()).collect(),
            text: glimpse(source),
            hash: short_hash(source),
            level: None,
            title: None,
            callout: None,
            ratio: None,
            table: None,
            todos: Vec::new(),
            at,
            parent,
            children: Vec::new(),
        });
        index
    }

    fn push_item(
        &mut self,
        item: Item,
        depth: usize,
        parent: Option<usize>,
        path: &mut Vec<(u8, String)>,
    ) -> usize {
        match item {
            Item::Leaf(raw) => self.push_leaf(raw, depth, parent, path),
            Item::Toggle(toggle) => {
                let at = self.span(toggle.open, toggle.close);
                let index = self.make(Kind::Toggle, at, depth, parent, path);
                self.blocks[index].text = glimpse(&toggle.summary);
                self.blocks[index].title = Some(toggle.summary);
                let children = self.push_items(toggle.body, depth + 1, Some(index), path);
                self.blocks[index].children = children;
                index
            }
            Item::Columns(columns) => {
                let at = self.span(columns.open, columns.close);
                let index = self.make(Kind::Columns, at, depth, parent, path);
                let count = columns.columns.len();
                self.blocks[index].text = glimpse(&format!("{count} columns {}", columns.ratio));
                self.blocks[index].ratio = Some(columns.ratio.clone());
                let markers =
                    std::iter::once(columns.open).chain(columns.separators.iter().copied());
                let mut made = Vec::new();
                for (j, (marker, items)) in markers.zip(columns.columns).enumerate() {
                    let last = items.last().map_or(marker, Item::last_raw);
                    let at = self.span(marker, last);
                    let column = self.make(Kind::Column, at, depth + 1, Some(index), path);
                    self.blocks[column].text = format!("column {} of {count}", j + 1);
                    let children = self.push_items(items, depth + 2, Some(column), path);
                    self.blocks[column].children = children;
                    made.push(column);
                }
                self.blocks[index].children = made;
                index
            }
        }
    }

    fn span(&self, first_raw: usize, last_raw: usize) -> At {
        At {
            start: self.raws[first_raw].start,
            end: self.raws[last_raw].end,
            first_raw,
            last_raw,
        }
    }

    fn push_leaf(
        &mut self,
        raw: usize,
        depth: usize,
        parent: Option<usize>,
        path: &mut Vec<(u8, String)>,
    ) -> usize {
        let r = self.raws[raw];
        let body: &'a str = self.body;
        let source = &body[r.start..r.end];
        let kind = match r.kind {
            RawKind::Paragraph => Kind::Paragraph,
            RawKind::Heading(_) => Kind::Heading,
            RawKind::List { todo: true } => Kind::Todo,
            RawKind::List { todo: false } => Kind::List,
            RawKind::Table => Kind::Table,
            RawKind::Code => Kind::Code,
            RawKind::Quote => Kind::Quote,
            RawKind::Callout => Kind::Callout,
            RawKind::Divider => Kind::Divider,
            RawKind::Html => Kind::Html,
            RawKind::Math => Kind::Math,
            RawKind::Embed => Kind::Embed,
        };
        let mut heading = None;
        if let RawKind::Heading(level) = r.kind {
            let first = source.lines().next().unwrap_or("");
            let text = if atx_level(first).is_some() {
                atx_text(first)
            } else {
                let mut lines: Vec<&str> = source.lines().map(str::trim).collect();
                lines.pop();
                lines.join(" ")
            };
            while path.last().is_some_and(|(top, _)| *top >= level) {
                path.pop();
            }
            path.push((level, text));
            heading = Some(level);
        }
        let at = self.span(raw, raw);
        let index = self.make(kind, at, depth, parent, path);
        let block = &mut self.blocks[index];
        block.level = heading;
        match r.kind {
            RawKind::Callout => {
                let header = source
                    .lines()
                    .next()
                    .map(quote_inner_once)
                    .and_then(callout_header);
                block.callout = header.as_ref().map(|h| h.kind.clone());
                block.title = header.map(|h| h.title).filter(|t| !t.is_empty());
            }
            RawKind::List { .. } => {
                block.todos = tasks(source)
                    .into_iter()
                    .take(100)
                    .map(|t| Todo {
                        line: t.line,
                        done: t.done,
                        text: t.text,
                    })
                    .collect();
            }
            RawKind::Table => {
                let lines = split_lines(source);
                block.table = Some(TableSize {
                    rows: lines.len().saturating_sub(1),
                    columns: lines.first().map_or(0, |l| split_row(l.text).cells.len()),
                });
            }
            _ => {}
        }
        index
    }
}

#[cfg(test)]
mod tests;
