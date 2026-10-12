//! What a line of a page can be: a heading, a rule, a list item, a row of a table, a quote, a picture. The block reader asks of each line.

use crate::markdown::fence_open;

/// A heading line: its level and its text, with a closing run of `#` taken off when a space comes before it.
pub(super) fn heading_of(line: &str) -> Option<(u8, &str)> {
    let indent = line.len() - line.trim_start_matches(' ').len();
    if indent > 3 {
        return None;
    }
    let rest = &line[indent..];
    let hashes = rest.bytes().take_while(|&b| b == b'#').count();
    if !(1..=6).contains(&hashes) {
        return None;
    }
    let after = &rest[hashes..];
    if !(after.is_empty() || after.starts_with([' ', '\t'])) {
        return None;
    }
    let text = after.trim();
    let closed = text.trim_end_matches('#');
    let text = if closed.len() < text.len() && (closed.is_empty() || closed.ends_with([' ', '\t']))
    {
        closed.trim_end()
    } else {
        text
    };
    Some((u8::try_from(hashes).unwrap_or(6), text))
}

/// Three or more of one of `-`, `*` and `_`, with spaces between them if need be.
pub(super) fn is_rule(trimmed: &str) -> bool {
    let mut chars = trimmed.chars().filter(|c| !c.is_whitespace());
    let Some(first) = chars.next().filter(|c| matches!(c, '-' | '*' | '_')) else {
        return false;
    };
    let mut count = 1;
    for c in chars {
        if c != first {
            return false;
        }
        count += 1;
    }
    count >= 3
}

/// A list item's marker: how far it is indented, whether it numbers, and the text after it.
pub(super) struct Item<'a> {
    pub indent: usize,
    pub ordered: bool,
    pub rest: &'a str,
}

pub(super) fn item_of(line: &str) -> Option<Item<'_>> {
    let rest = line.trim_start_matches([' ', '\t']);
    let indent = line[..line.len() - rest.len()]
        .chars()
        .map(|c| if c == '\t' { 2 } else { 1 })
        .sum();
    let after = |len: usize| {
        let tail = &rest[len..];
        (tail.is_empty() || tail.starts_with([' ', '\t'])).then(|| tail.trim_start())
    };
    if rest.starts_with(['-', '*', '+']) {
        return after(1).map(|rest| Item {
            indent,
            ordered: false,
            rest,
        });
    }
    let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
    if (1..=9).contains(&digits) && matches!(rest.as_bytes().get(digits), Some(b'.' | b')')) {
        return after(digits + 1).map(|rest| Item {
            indent,
            ordered: true,
            rest,
        });
    }
    None
}

/// The tick of a to-do at the start of an item's text: whether it is ticked, and the words after it.
pub(super) fn task_of(rest: &str) -> Option<(bool, &str)> {
    let (ticked, tail) = if let Some(tail) = rest.strip_prefix("[ ]") {
        (false, tail)
    } else {
        (
            true,
            rest.strip_prefix("[x]")
                .or_else(|| rest.strip_prefix("[X]"))?,
        )
    };
    (tail.is_empty() || tail.starts_with([' ', '\t'])).then(|| (ticked, tail.trim_start()))
}

/// The indents lists have gone to, so that a deeper item is a level down whatever the width of its indent.
#[derive(Default)]
pub(super) struct Indents(Vec<usize>);

impl Indents {
    /// The level of an item at `indent`: one more than the item it goes in under, as far down as five.
    pub fn level(&mut self, indent: usize) -> u8 {
        while self.0.last().is_some_and(|&last| last > indent) {
            self.0.pop();
        }
        if self.0.last() != Some(&indent) {
            self.0.push(indent);
        }
        u8::try_from((self.0.len() - 1).min(5)).unwrap_or(5)
    }

    /// A block that is not a list item ends the lists: the next item starts again at level 0.
    pub fn forget(&mut self) {
        self.0.clear();
    }
}

/// A table row's cells: split at the bars that are not escaped, with the outer bars and spaces taken off.
pub(super) fn cells_of(line: &str) -> Vec<String> {
    let line = line.trim();
    let line = line.strip_prefix('|').unwrap_or(line);
    let line = line
        .strip_suffix('|')
        .filter(|_| !line.ends_with("\\|"))
        .unwrap_or(line);
    let mut cells = Vec::new();
    let mut cell = String::new();
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' && chars.peek() == Some(&'|') {
            cell.push('|');
            chars.next();
        } else if c == '|' {
            cells.push(std::mem::take(&mut cell).trim().to_owned());
        } else {
            cell.push(c);
        }
    }
    cells.push(cell.trim().to_owned());
    cells
}

/// Whether a row is the line under a table's header: cells of dashes, with colons for the alignment.
fn is_divider(line: &str) -> bool {
    let cells = cells_of(line);
    line.contains('-')
        && cells.iter().all(|c| {
            !c.is_empty() && c.contains('-') && c.chars().all(|ch| matches!(ch, '-' | ':' | ' '))
        })
}

/// Whether the line at `i` is the header of a table: it has bars, and a divider row is under it.
pub(super) fn starts_table(lines: &[&str], i: usize) -> bool {
    lines[i].contains('|')
        && lines
            .get(i + 1)
            .is_some_and(|next| next.contains('-') && is_divider(next))
}

pub(super) fn is_quote(line: &str) -> bool {
    line.trim_start().starts_with('>')
}

/// A line that begins something other than a paragraph, so that a paragraph above it ends.
pub(super) fn begins_block(lines: &[&str], i: usize) -> bool {
    let line = lines[i];
    let trimmed = line.trim();
    trimmed.is_empty()
        || heading_of(line).is_some()
        || fence_open(line).is_some()
        || is_quote(line)
        || is_rule(trimmed)
        || item_of(line).is_some()
        || trimmed.starts_with("$$")
        || trimmed.starts_with("<details")
        || trimmed.starts_with("</details")
        || trimmed.starts_with("<summary")
        || trimmed.starts_with("<!--")
        || starts_table(lines, i)
}

/// `![alt](src)` as a whole line: the alt and the source (a title after the source is left off). Also `![[name.png]]`.
pub(super) fn image_line(trimmed: &str) -> Option<(String, String)> {
    if let Some(inner) = trimmed
        .strip_prefix("![[")
        .and_then(|t| t.strip_suffix("]]"))
    {
        let target = inner.split('|').next().unwrap_or(inner).trim();
        let is_picture = ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"]
            .iter()
            .any(|ext| target.to_ascii_lowercase().ends_with(&format!(".{ext}")));
        return (is_picture && !inner.contains("]]")).then(|| (String::new(), target.to_owned()));
    }
    let body = trimmed.strip_prefix("![")?;
    let close = body.find("](")?;
    let alt = &body[..close];
    let rest = body[close + 2..].strip_suffix(')')?;
    let src = rest.split_whitespace().next()?.trim_matches(['<', '>']);
    // Two pictures on a line, or words after one, are a paragraph.
    if src.is_empty() || rest.contains(')') || alt.contains(']') {
        return None;
    }
    Some((alt.to_owned(), src.to_owned()))
}
