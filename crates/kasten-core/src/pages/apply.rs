//! Making the steps: every step becomes byte edits against the page as it was
//! read, the edits are put together (refused if two meet), and the result is
//! checked before it is returned: every block no step meant to touch must come
//! out with the same bytes and kind. All steps are made, or none.

use std::collections::{BTreeMap, HashMap};

use super::blocks::{Kind, Page};
use super::edits::{Edit, Place, simple, touches_above, touches_below};
use super::scan::Raw;
use super::steps::PageStep;
use super::table_edit::tables;
use super::wrap::wrapping;
use crate::error::{Error, Result};

/// The most steps one call may hold.
pub const MAX_STEPS: usize = 200;

/// The page after the steps.
#[derive(Debug, Clone, PartialEq)]
pub struct Edited {
    pub body: String,
    /// Whether any byte changed.
    pub changed: bool,
    /// The share of the page's text (by lines, moves not counted) the steps take out.
    pub removed: f64,
    pub steps: usize,
}

/// Where an edit's bytes were and where its text now is.
struct Span {
    old: (usize, usize),
    new: (usize, usize),
}

fn step_edits(page: &Page, step: &PageStep) -> Result<Vec<Edit>> {
    simple(page, step)
        .or_else(|| wrapping(page, step))
        .or_else(|| tables(page, step))
        .unwrap_or_else(|| Err(Error::Invalid("Not a step this page knows".to_owned())))
}

/// `body` with `steps` made. The blocks the steps name are looked up by id
/// and hash in `body` as it is now; a block that is not as it was read refuses
/// the call.
pub fn edit_body(body: &str, steps: &[PageStep]) -> Result<Edited> {
    edit_body_as(body, steps, "\n")
}

/// `edit_body`, where a body with no line end of its own gets new lines ended
/// as `eol` (the rest of the file's habit).
pub fn edit_body_as(body: &str, steps: &[PageStep], eol: &'static str) -> Result<Edited> {
    if steps.is_empty() {
        return Err(Error::Invalid(
            "edit_page needs at least one step".to_owned(),
        ));
    }
    if steps.len() > MAX_STEPS {
        return Err(Error::Invalid(format!(
            "edit_page takes at most {MAX_STEPS} steps; this has {}. Send it in parts",
            steps.len()
        )));
    }
    let page = Page::parse_as(body, eol);
    let mut edits = Vec::new();
    for (n, step) in steps.iter().enumerate() {
        let made = step_edits(&page, step).map_err(|err| {
            let why = err.to_string();
            let tail = if why.contains("othing was written") {
                ""
            } else {
                ". Nothing was written"
            };
            Error::Invalid(format!("Step {} ({}): {why}{tail}", n + 1, step.name()))
        })?;
        edits.extend(made.into_iter().map(|mut edit| {
            edit.step = n;
            edit
        }));
    }
    let removed = removed_share(body, &edits);
    tables_stay_tables(body, &edits)?;
    let (text, spans) = compose(body, page.eol, edits)?;
    verify(&page, &text, &spans)?;
    Ok(Edited {
        changed: text != body,
        body: text,
        removed,
        steps: steps.len(),
    })
}

/// Where edits at one spot go, first to last: text before a block, edits
/// inside it (a row added at a table's end), text after it.
fn rank(place: Place) -> u8 {
    match place {
        Place::Before => 0,
        Place::Exact => 1,
        Place::After => 2,
    }
}

/// Removals that overlap only in blank space are one removal: the last block
/// of a page takes the gap above it and the block above takes the gap below.
/// Two that share text (a block named twice, or moved twice) stay a conflict.
fn merge_removals(body: &str, edits: Vec<Edit>) -> Vec<Edit> {
    let removal = |e: &Edit| {
        e.place == Place::Exact && e.text.is_empty() && e.start < e.end && e.within.is_none()
    };
    let mut out: Vec<Edit> = Vec::with_capacity(edits.len());
    for edit in edits {
        if let Some(last) = out.last_mut()
            && removal(&*last)
            && removal(&edit)
            && edit.start < last.end
            && body[edit.start..last.end.min(edit.end)]
                .chars()
                .all(char::is_whitespace)
        {
            last.end = last.end.max(edit.end);
            continue;
        }
        out.push(edit);
    }
    out
}

/// Table steps are each checked alone. Several on one table must leave it a
/// table too: its edits are made on its own bytes and the result is read back.
fn tables_stay_tables(body: &str, edits: &[Edit]) -> Result<()> {
    let mut tables: BTreeMap<(usize, usize), Vec<&Edit>> = BTreeMap::new();
    for edit in edits {
        if let Some(table) = edit.within {
            tables.entry(table).or_default().push(edit);
        }
    }
    for ((start, end), mut list) in tables {
        if list.len() < 2 {
            continue;
        }
        list.sort_by_key(|e| (e.start, e.end, e.step));
        let (mut text, mut at) = (String::new(), start);
        for edit in list {
            if edit.start < at {
                // Overlapping edits are refused by `compose`, with its words.
                return Ok(());
            }
            text.push_str(&body[at..edit.start]);
            text.push_str(&edit.text);
            at = edit.end;
        }
        text.push_str(&body[at..end]);
        let page = Page::parse(&text);
        if !matches!(page.roots.as_slice(), [only] if page.blocks[*only].kind == Kind::Table) {
            return Err(Error::Invalid(
                "These steps together would leave a table unreadable as a table, so nothing was written. Give them in smaller parts"
                    .to_owned(),
            ));
        }
    }
    Ok(())
}

/// Puts the edits together. Two edits may not change the same bytes.
fn compose(body: &str, eol: &str, mut edits: Vec<Edit>) -> Result<(String, Vec<Span>)> {
    edits.sort_by_key(|e| (e.start, e.end, rank(e.place), e.step));
    let edits = merge_removals(body, edits);
    let mut limit = 0;
    let mut previous = 0;
    for edit in &edits {
        if edit.start < limit {
            return Err(Error::Invalid(format!(
                "Steps {} and {} both change the same part of the page; give each block one step. Nothing was written",
                previous + 1,
                edit.step + 1
            )));
        }
        if edit.end >= limit {
            limit = edit.end;
            previous = edit.step;
        }
    }
    let mut out = String::with_capacity(body.len());
    let mut spans = Vec::new();
    // Where each edit ends in the body, and where its text ends in the result.
    let mut ends: Vec<(usize, usize)> = Vec::new();
    let mut at = 0;
    let mut i = 0;
    while i < edits.len() {
        let edit = &edits[i];
        out.push_str(&body[at..edit.start]);
        let mut next = i + 1;
        let mut text = edit.text.clone();
        if edit.start == edit.end && edit.place != Place::Exact {
            // Insertions at one spot go in the order of their steps, with one
            // blank line kept from a block they sit against.
            while edits.get(next).is_some_and(|e| {
                e.start == edit.start && e.end == edit.start && e.place == edit.place
            }) {
                text.push_str(&edits[next].text);
                next += 1;
            }
            if edit.place == Place::After && touches_below(body, edit.start) {
                text.push_str(eol);
            }
            if edit.place == Place::Before && touches_above(body, edit.start) {
                text.insert_str(0, eol);
            }
        }
        let from = out.len();
        out.push_str(&text);
        spans.push(Span {
            old: (edit.start, edit.end),
            new: (from, out.len()),
        });
        ends.push((edit.end, out.len()));
        at = edit.end;
        i = next;
    }
    out.push_str(&body[at..]);
    // A block an edit works inside (a table) counts as changed as a whole,
    // wherever in it, or at its edge, the edit falls.
    let place = |pos: usize| {
        ends.iter()
            .rev()
            .find(|(old, _)| *old <= pos)
            .map_or(pos, |(old, new)| new + (pos - old))
    };
    let mut blocks: Vec<(usize, usize)> = edits.iter().filter_map(|e| e.within).collect();
    blocks.sort_unstable();
    blocks.dedup();
    for (start, end) in blocks {
        spans.push(Span {
            old: (start, end),
            new: (place(start), place(end)),
        });
    }
    Ok((out, spans))
}

/// Whether the block `start..end` is cut by a span (an insertion counts only
/// inside the block, not at its edge).
fn touched(start: usize, end: usize, spans: impl Iterator<Item = (usize, usize)>) -> bool {
    spans.into_iter().any(|(s, e)| {
        if s == e {
            start < s && s < end
        } else {
            start < e && s < end
        }
    })
}

/// The blocks (by number) that no span touches.
fn kept(raws: &[Raw], spans: &[Span], side: impl Fn(&Span) -> (usize, usize)) -> Vec<usize> {
    (0..raws.len())
        .filter(|&i| !touched(raws[i].start, raws[i].end, spans.iter().map(&side)))
        .collect()
}

/// Every block no step touched must be in the new page as it was, in the
/// same order, and still where it was among the toggles and columns; a block
/// that fused with new text, or one the new text swallowed, or a toggle or
/// columns block the new text broke or joined, is a change nobody asked for.
fn verify(old: &Page, new: &str, spans: &[Span]) -> Result<()> {
    let page = Page::parse_as(new, old.eol);
    let before = kept(&old.raws, spans, |s| s.old);
    let after = kept(&page.raws, spans, |s| s.new);
    let same = before.len() == after.len()
        && before.iter().zip(&after).all(|(&a, &b)| {
            let (x, y) = (old.raws[a], page.raws[b]);
            x.kind == y.kind && old.body[x.start..x.end] == new[y.start..y.end]
        });
    if !same {
        return Err(Error::Invalid(
            "The change would run together with the blocks beside it (for example a list that continues, or a code fence that stays open), so nothing was written. Put the new text in a block of its own, or replace the whole neighbour"
                .to_owned(),
        ));
    }
    let (was, is) = (old.roles(), page.roles());
    if before.iter().zip(&after).any(|(&a, &b)| was[a] != is[b]) {
        return Err(Error::Invalid(
            "The change would break or join a toggle or a columns block (a block would move in or out of one, or its markers would pair differently), so nothing was written"
                .to_owned(),
        ));
    }
    Ok(())
}

/// A line without its spaces or quote marks, so a block set in a callout still
/// counts as the text it was.
fn plain(line: &str) -> &str {
    let mut text = line.trim();
    while let Some(rest) = text.strip_prefix('>') {
        text = rest.trim_start();
    }
    text
}

/// How much of the page's text the edits take out, counted as the 40 % rule
/// counts it: by lines, a line that comes back (a block moved or wrapped) is
/// not taken out.
fn removed_share(body: &str, edits: &[Edit]) -> f64 {
    let total: usize = body.lines().map(|l| plain(l).len()).sum();
    if total == 0 {
        return 0.0;
    }
    let mut back: HashMap<&str, usize> = HashMap::new();
    for edit in edits {
        for line in edit.text.lines() {
            *back.entry(plain(line)).or_default() += 1;
        }
    }
    let mut gone = 0;
    for edit in edits {
        for line in body[edit.start..edit.end].lines().map(plain) {
            match back.get_mut(line) {
                Some(n) if *n > 0 => *n -= 1,
                _ => gone += line.len(),
            }
        }
    }
    gone as f64 / total as f64
}
