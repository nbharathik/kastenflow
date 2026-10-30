//! Toggles and columns among a page's blocks. They are made of sibling HTML
//! blocks (`<details>` … `</details>`, `<!-- columns -->` … `<!-- /columns -->`),
//! paired the way the editor pairs them: toggles first, wherever they are,
//! then columns, at the top level only and not nested.

use super::markers::{
    column_separator, columns_close, columns_open, summary_of, toggle_close, toggle_open,
};
use super::scan::{Raw, RawKind};

/// A block, or a pair of markers with blocks between them.
pub(crate) enum Item {
    /// The raw block at this index.
    Leaf(usize),
    Toggle(Toggle),
    Columns(Columns),
}

pub(crate) struct Toggle {
    /// The raw blocks of the opening and closing lines.
    pub open: usize,
    pub close: usize,
    pub summary: String,
    pub body: Vec<Item>,
}

pub(crate) struct Columns {
    pub open: usize,
    pub separators: Vec<usize>,
    pub close: usize,
    /// The numbers after `columns`, as written.
    pub ratio: String,
    pub columns: Vec<Vec<Item>>,
}

impl Item {
    pub(crate) fn first_raw(&self) -> usize {
        match self {
            Item::Leaf(raw) => *raw,
            Item::Toggle(t) => t.open,
            Item::Columns(c) => c.open,
        }
    }

    pub(crate) fn last_raw(&self) -> usize {
        match self {
            Item::Leaf(raw) => *raw,
            Item::Toggle(t) => t.close,
            Item::Columns(c) => c.close,
        }
    }
}

/// The items of a page: toggles paired, then columns.
pub(crate) fn build(body: &str, raws: &[Raw]) -> Vec<Item> {
    let leaves = (0..raws.len()).map(Item::Leaf).collect();
    pair_columns(pair_toggles(leaves, body, raws), body, raws)
}

/// The text of an item that is one HTML block, trimmed.
fn html_value<'a>(item: &Item, body: &'a str, raws: &[Raw]) -> Option<&'a str> {
    match item {
        Item::Leaf(raw) if raws[*raw].kind == RawKind::Html => {
            Some(body[raws[*raw].start..raws[*raw].end].trim())
        }
        _ => None,
    }
}

fn value<'a>(slots: &[Option<Item>], at: usize, body: &'a str, raws: &[Raw]) -> Option<&'a str> {
    slots
        .get(at)
        .and_then(Option::as_ref)
        .and_then(|item| html_value(item, body, raws))
}

/// Moves the items `from..to` out of `slots`.
fn take(slots: &mut [Option<Item>], from: usize, to: usize) -> Vec<Item> {
    slots[from..to]
        .iter_mut()
        .filter_map(Option::take)
        .collect()
}

/// For each opener, the item that closes it: a closer goes with the nearest
/// opener still open, as brackets do, and a stray closer or opener has no
/// partner. One pass, so a page of thousands of stray markers is no slower
/// than any other.
fn partners(
    slots: &[Option<Item>],
    (body, raws): (&str, &[Raw]),
    opens: fn(&str) -> bool,
    closes: fn(&str) -> bool,
) -> Vec<Option<usize>> {
    let mut partner = vec![None; slots.len()];
    let mut open = Vec::new();
    for at in 0..slots.len() {
        let Some(html) = value(slots, at, body, raws) else {
            continue;
        };
        if opens(html) {
            open.push(at);
        } else if closes(html)
            && let Some(opener) = open.pop()
        {
            partner[opener] = Some(at);
        }
    }
    partner
}

fn opens_toggle(html: &str) -> bool {
    toggle_open(html).is_some()
}

fn opens_columns(html: &str) -> bool {
    columns_open(html).is_some()
}

/// Pairs `<details>` openers and closers among sibling items (outermost
/// first; a toggle's body holds the toggles inside it).
fn pair_toggles(items: Vec<Item>, body: &str, raws: &[Raw]) -> Vec<Item> {
    let mut slots: Vec<Option<Item>> = items.into_iter().map(Some).collect();
    let partner = partners(&slots, (body, raws), opens_toggle, toggle_close);
    let end = slots.len();
    nest_toggles(&mut slots, &partner, 0..end, (body, raws), 0)
}

/// How deep toggles may sit in toggles. Deeper ones are plain HTML blocks, so
/// a page of thousands of nested markers cannot overflow the stack.
const MAX_NESTING: usize = 64;

fn nest_toggles(
    slots: &mut [Option<Item>],
    partner: &[Option<usize>],
    range: std::ops::Range<usize>,
    (body, raws): (&str, &[Raw]),
    depth: usize,
) -> Vec<Item> {
    let mut out = Vec::new();
    let mut i = range.start;
    while i < range.end {
        let Some(close) = partner[i].filter(|_| depth < MAX_NESTING) else {
            out.extend(slots[i].take());
            i += 1;
            continue;
        };
        let opener = value(slots, i, body, raws).and_then(toggle_open);
        let (summary, from) = match opener.and_then(|o| o.summary) {
            Some(summary) => (summary, i + 1),
            None => value(slots, i + 1, body, raws)
                .and_then(summary_of)
                .map_or((String::new(), i + 1), |summary| (summary, i + 2)),
        };
        let open = slots[i].as_ref().map_or(0, Item::first_raw);
        let close_raw = slots[close].as_ref().map_or(0, Item::last_raw);
        let inner = nest_toggles(slots, partner, from..close, (body, raws), depth + 1);
        out.push(Item::Toggle(Toggle {
            open,
            close: close_raw,
            summary,
            body: inner,
        }));
        i = close + 1;
    }
    out
}

/// Pairs the columns markers among the page's top-level items.
fn pair_columns(items: Vec<Item>, body: &str, raws: &[Raw]) -> Vec<Item> {
    let mut slots: Vec<Option<Item>> = items.into_iter().map(Some).collect();
    let partner = partners(&slots, (body, raws), opens_columns, columns_close);
    let mut out = Vec::new();
    let mut i = 0;
    while i < slots.len() {
        let Some(close) = partner[i] else {
            out.extend(slots[i].take());
            i += 1;
            continue;
        };
        let ratio = value(&slots, i, body, raws)
            .and_then(columns_open)
            .unwrap_or_default();
        // The separators that are the pair's own, not those of columns inside it.
        let mut depth = 0usize;
        let mut cuts = Vec::new();
        for j in i + 1..close {
            let Some(html) = value(&slots, j, body, raws) else {
                continue;
            };
            if columns_open(html).is_some() {
                depth += 1;
            } else if columns_close(html) {
                depth = depth.saturating_sub(1);
            } else if depth == 0 && column_separator(html) {
                cuts.push(j);
            }
        }
        let raw_of =
            |slots: &[Option<Item>], at: usize| slots[at].as_ref().map_or(0, Item::first_raw);
        let open = raw_of(&slots, i);
        let separators: Vec<usize> = cuts.iter().map(|&at| raw_of(&slots, at)).collect();
        let close_raw = raw_of(&slots, close);
        let mut columns = Vec::new();
        let mut from = i + 1;
        for &cut in cuts.iter().chain(std::iter::once(&close)) {
            columns.push(take(&mut slots, from, cut));
            from = cut + 1;
        }
        out.push(Item::Columns(Columns {
            open,
            separators,
            close: close_raw,
            ratio,
            columns,
        }));
        i = close + 1;
    }
    out
}
