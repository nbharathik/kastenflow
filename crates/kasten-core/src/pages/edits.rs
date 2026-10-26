//! The byte edits the simple steps make: insert, replace, move, delete, tick
//! a task, add an embed. Each is worked out against the page as it was read,
//! as spans of its bytes; nothing outside a span can change.

use super::blocks::{Block, Kind, Page};
use super::lines::{is_blank, with_eol};
use super::steps::{BlockRef, PageStep};
use super::todo::tasks;
use crate::error::{Error, Result};

/// How an insertion sits among its neighbours.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Place {
    /// Replaces its span and nothing more.
    Exact,
    /// Follows a block: a blank line, then the text; a block that touched the
    /// next one still has a blank line before it.
    After,
    /// Precedes a block: the text, then a blank line.
    Before,
}

/// `start..end` of the page's bytes replaced by `text`.
#[derive(Debug, Clone)]
pub(crate) struct Edit {
    pub start: usize,
    pub end: usize,
    pub text: String,
    pub place: Place,
    /// The step that made it, from 0.
    pub step: usize,
    /// The block this edit works inside, when it may sit at the block's edge
    /// (a row added under a table): that whole block counts as changed.
    pub within: Option<(usize, usize)>,
}

impl Edit {
    pub(crate) fn exact(start: usize, end: usize, text: String) -> Edit {
        Edit {
            start,
            end,
            text,
            place: Place::Exact,
            step: 0,
            within: None,
        }
    }

    pub(crate) fn inside(mut self, block: (usize, usize)) -> Edit {
        self.within = Some(block);
        self
    }
}

fn invalid(why: impl Into<String>) -> Error {
    Error::Invalid(why.into())
}

impl Page<'_> {
    /// Markdown from an agent, with the page's line ends; refused when empty.
    pub(crate) fn clean(&self, markdown: &str) -> Result<String> {
        let text = with_eol(markdown, self.eol);
        if text.trim().is_empty() {
            return Err(invalid(
                "The markdown is empty (use delete to take a block out)",
            ));
        }
        Ok(text)
    }

    /// The blocks beside `block`, in order: its parent's, or the top level.
    pub(crate) fn siblings(&self, block: &Block) -> &[usize] {
        match block.parent {
            Some(parent) => &self.blocks[parent].children,
            None => &self.roots,
        }
    }

    /// An insertion of `text` after the block (at the end of a column).
    pub(crate) fn after(&self, block: &Block, text: String) -> Edit {
        let at = self.raws[block.at.last_raw].end;
        Edit {
            start: at,
            end: at,
            text: format!("{eol}{eol}{text}", eol = self.eol),
            place: Place::After,
            step: 0,
            within: None,
        }
    }

    /// An insertion of `text` before the block.
    pub(crate) fn before(&self, block: &Block, text: String) -> Result<Edit> {
        if block.kind == Kind::Column {
            return Err(invalid(
                "Nothing goes before a column; insert after the block above it, or in the column",
            ));
        }
        let at = self.raws[block.at.first_raw].start;
        Ok(Edit {
            start: at,
            end: at,
            text: format!("{text}{eol}{eol}", eol = self.eol),
            place: Place::Before,
            step: 0,
            within: None,
        })
    }

    /// The bytes that go when `block` is taken out: the block and the gap
    /// after it, or the gap before it if it is last or touches the block above.
    pub(crate) fn removal(&self, block: &Block) -> Result<(usize, usize)> {
        if block.kind == Kind::Column {
            return Err(invalid(
                "A column cannot be taken out on its own; delete its blocks, or use unwrap_columns",
            ));
        }
        let (first, last) = (block.at.first_raw, block.at.last_raw);
        let (start, end) = (self.raws[first].start, self.raws[last].end);
        let prev = first.checked_sub(1).map(|p| self.raws[p].end);
        let touches_above = prev.is_some_and(|p| self.body[p..start].matches('\n').count() < 2);
        Ok(match (self.raws.get(last + 1), prev) {
            (_, Some(p)) if touches_above => (p, end),
            (Some(next), _) => (start, next.start),
            (None, Some(p)) => (p, end),
            (None, None) => (start, end),
        })
    }

    /// The blocks `refs` name, which must be neighbours in order.
    pub(crate) fn run_of(&self, refs: &[BlockRef]) -> Result<Vec<&Block>> {
        if refs.is_empty() {
            return Err(invalid("Name at least one block"));
        }
        let blocks = refs
            .iter()
            .map(|r| self.find(r))
            .collect::<Result<Vec<_>>>()?;
        let first = blocks[0];
        if blocks.iter().any(|b| b.parent != first.parent) {
            return Err(invalid("The blocks are not in the same place on the page"));
        }
        let siblings = self.siblings(first);
        let at = |b: &Block| siblings.iter().position(|&s| self.blocks[s].id == b.id);
        let first_at = at(first).ok_or_else(|| invalid("Not a block of this page"))?;
        for (n, block) in blocks.iter().enumerate() {
            if at(block) != Some(first_at + n) {
                return Err(invalid(
                    "The blocks must be next to each other, in the order they are on the page",
                ));
            }
        }
        if blocks.iter().any(|b| b.kind == Kind::Column) {
            return Err(invalid("A column cannot be wrapped on its own"));
        }
        Ok(blocks)
    }

    /// The bytes from the first of `blocks` to the end of the last.
    pub(crate) fn run_span(&self, blocks: &[&Block]) -> (usize, usize) {
        (
            blocks[0].at.start,
            blocks.last().map_or(blocks[0].at.end, |b| b.at.end),
        )
    }
}

/// The edits of the simple steps; None for the steps others make.
pub(crate) fn simple(page: &Page, step: &PageStep) -> Option<Result<Vec<Edit>>> {
    Some(match step {
        PageStep::Insert {
            before,
            after,
            at_end_of_heading,
            markdown,
        } => insert(page, [before, after, at_end_of_heading], markdown),
        PageStep::Replace { block, markdown } => replace(page, block, markdown),
        PageStep::Move {
            block,
            after,
            before,
        } => move_block(page, block, after.as_ref(), before.as_ref()),
        PageStep::Delete { block } => page
            .find(block)
            .and_then(|b| page.removal(b))
            .map(|(start, end)| vec![Edit::exact(start, end, String::new())]),
        PageStep::SetTodo { block, line, done } => set_todo(page, block, *line, *done),
        PageStep::Embed {
            after,
            target,
            view,
        } => embed(page, after, target, view.as_deref()),
        _ => return None,
    })
}

fn insert(page: &Page, places: [&Option<BlockRef>; 3], markdown: &str) -> Result<Vec<Edit>> {
    let [before, after, heading] = places;
    if places.iter().filter(|p| p.is_some()).count() != 1 {
        return Err(invalid(
            "An insert names exactly one of before, after and at_end_of_heading",
        ));
    }
    let text = page.clean(markdown)?;
    if let Some(r) = before {
        return Ok(vec![page.before(page.find(r)?, text)?]);
    }
    if let Some(r) = after {
        return Ok(vec![page.after(page.find(r)?, text)]);
    }
    let Some(r) = heading else {
        return Ok(Vec::new());
    };
    let head = page.find(r)?;
    let level = match (head.kind, head.level) {
        (Kind::Heading, Some(level)) => level,
        _ => return Err(invalid(format!("{} is not a heading", head.id))),
    };
    let siblings = page.siblings(head);
    let at = siblings
        .iter()
        .position(|&s| page.blocks[s].id == head.id)
        .unwrap_or_default();
    let mut last = head;
    for &s in &siblings[at + 1..] {
        let next = &page.blocks[s];
        if next.kind == Kind::Heading && next.level.is_some_and(|l| l <= level) {
            break;
        }
        last = next;
    }
    Ok(vec![page.after(last, text)])
}

fn replace(page: &Page, block: &BlockRef, markdown: &str) -> Result<Vec<Edit>> {
    let block = page.find(block)?;
    if block.kind == Kind::Column {
        return Err(invalid(
            "A column cannot be replaced on its own; replace its blocks",
        ));
    }
    let text = page.clean(markdown)?;
    Ok(vec![Edit::exact(block.at.start, block.at.end, text)])
}

fn move_block(
    page: &Page,
    block: &BlockRef,
    after: Option<&BlockRef>,
    before: Option<&BlockRef>,
) -> Result<Vec<Edit>> {
    let moved = page.find(block)?;
    let (target, behind) = match (after, before) {
        (Some(r), None) => (page.find(r)?, true),
        (None, Some(r)) => (page.find(r)?, false),
        _ => return Err(invalid("A move names exactly one of after and before")),
    };
    if target.at.start >= moved.at.start && target.at.end <= moved.at.end {
        return Err(invalid("A block cannot be moved into itself"));
    }
    if moved.kind == Kind::Columns && target.parent.is_some() {
        return Err(invalid(
            "Columns go at the top of the page; they do not nest",
        ));
    }
    let (start, end) = page.removal(moved)?;
    let text = page.source(moved).to_owned();
    let put = if behind {
        page.after(target, text)
    } else {
        page.before(target, text)?
    };
    Ok(vec![Edit::exact(start, end, String::new()), put])
}

fn set_todo(page: &Page, block: &BlockRef, line: usize, done: bool) -> Result<Vec<Edit>> {
    let block = page.find(block)?;
    if !matches!(block.kind, Kind::List | Kind::Todo) {
        return Err(invalid(format!("{} is not a list", block.id)));
    }
    let found = tasks(page.source(block));
    let Some(task) = found.iter().find(|t| t.line == line) else {
        let lines: Vec<String> = found.iter().map(|t| t.line.to_string()).collect();
        return Err(invalid(format!(
            "Line {line} of {} is not a task; its tasks are on lines {}",
            block.id,
            if lines.is_empty() {
                "(none)".to_owned()
            } else {
                lines.join(", ")
            }
        )));
    };
    if task.done == done {
        return Ok(Vec::new());
    }
    let at = block.at.start + task.mark_at;
    let mark = if done { "x" } else { " " };
    Ok(vec![Edit::exact(at, at + 1, mark.to_owned())])
}

fn embed(page: &Page, after: &BlockRef, target: &str, view: Option<&str>) -> Result<Vec<Edit>> {
    let block = page.find(after)?;
    let bad = |s: &str| s.contains(['\n', '\r', '[', ']', '|']);
    let target = target.trim();
    if target.is_empty() || bad(target) {
        return Err(invalid(
            "An embed's target is a page title, a path or a file name, with no brackets, bars or line breaks",
        ));
    }
    let view = view.map(str::trim).filter(|v| !v.is_empty());
    if view.is_some_and(|v| bad(v) || v.contains('#')) {
        return Err(invalid("An embed's view is a plain name"));
    }
    let text = match view {
        Some(view) => format!("![[{target}#{view}]]"),
        None => format!("![[{target}]]"),
    };
    Ok(vec![page.after(block, text)])
}

/// Whether the text before `at` ends in a line with something on it.
pub(crate) fn touches_above(body: &str, at: usize) -> bool {
    let before = &body[..at];
    let before = before
        .strip_suffix("\r\n")
        .or_else(|| before.strip_suffix('\n'));
    match before {
        Some(rest) => rest.rsplit('\n').next().is_some_and(|l| !is_blank(l)),
        None => false,
    }
}

/// Whether the line after the one that ends at `at` has something on it.
pub(crate) fn touches_below(body: &str, at: usize) -> bool {
    let rest = &body[at..];
    match rest
        .strip_prefix("\r\n")
        .or_else(|| rest.strip_prefix('\n'))
    {
        Some(next) => next.split('\n').next().is_some_and(|l| !is_blank(l)),
        None => false,
    }
}
