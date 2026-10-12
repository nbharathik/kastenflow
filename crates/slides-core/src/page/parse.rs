//! A page's Markdown read into blocks.

use super::Block;
use super::inline::{bold, runs};
use super::lines::{
    Indents, begins_block, cells_of, heading_of, image_line, is_quote, is_rule, item_of,
    starts_table, task_of,
};
use super::sections::strip_frontmatter;
use crate::markdown::{fence_closes, fence_open};

/// The blocks of a page, in order. Frontmatter is left off; what is not understood is a paragraph of its words.
pub fn blocks(markdown: &str) -> Vec<Block> {
    let body = strip_frontmatter(markdown);
    let lines: Vec<&str> = body.lines().collect();
    let mut out = Vec::new();
    let mut indents = Indents::default();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim();
        if trimmed.is_empty() {
            i += 1;
            continue;
        }
        if !matches!(out.last(), Some(Block::Item { .. })) {
            indents.forget();
        }

        if let Some((ch, n)) = fence_open(line) {
            let language = trimmed
                .trim_start_matches(ch)
                .split_whitespace()
                .next()
                .unwrap_or("")
                .to_owned();
            let mut code = Vec::new();
            i += 1;
            while i < lines.len() && !fence_closes(lines[i], ch, n) {
                code.push(lines[i]);
                i += 1;
            }
            i += 1;
            out.push(Block::Code {
                language,
                code: code.join("\n"),
            });
            continue;
        }

        if trimmed.starts_with("$$") {
            out.push(Block::Math {
                latex: formula(&lines, &mut i),
            });
            continue;
        }

        if let Some((level, text)) = heading_of(line) {
            out.push(Block::Heading {
                level,
                runs: runs(text),
            });
            i += 1;
            continue;
        }

        if is_rule(trimmed)
            && item_of(line).is_none_or(|item| {
                item.rest
                    .trim()
                    .chars()
                    .all(|c| matches!(c, '-' | '*' | '_' | ' '))
            })
        {
            out.push(Block::Rule);
            i += 1;
            continue;
        }

        if trimmed.starts_with("<!--") && trimmed.ends_with("-->") {
            i += 1;
            continue;
        }
        if trimmed.starts_with("<details") || trimmed.starts_with("</details") {
            i += 1;
            continue;
        }
        if let Some(summary) = trimmed.strip_prefix("<summary>") {
            let words = summary.trim_end_matches("</summary>").trim();
            if !words.is_empty() {
                out.push(Block::Paragraph { runs: bold(words) });
            }
            i += 1;
            continue;
        }

        if starts_table(&lines, i) {
            let header = cells_of(lines[i]);
            let mut rows = vec![header.iter().map(|c| runs(c)).collect::<Vec<_>>()];
            i += 2;
            while i < lines.len() && !lines[i].trim().is_empty() && lines[i].contains('|') {
                let mut cells = cells_of(lines[i]);
                cells.resize(header.len(), String::new());
                rows.push(cells.iter().map(|c| runs(c)).collect());
                i += 1;
            }
            out.push(Block::Table { header: true, rows });
            continue;
        }

        if is_quote(line) {
            let mut contents = Vec::new();
            while i < lines.len() && is_quote(lines[i]) {
                let inner = lines[i].trim_start().trim_start_matches('>');
                contents.push(
                    inner
                        .strip_prefix(' ')
                        .unwrap_or(inner)
                        .trim_end()
                        .to_owned(),
                );
                i += 1;
            }
            quote(&contents, &mut out);
            continue;
        }

        if let Some(marker) = item_of(line) {
            let level = indents.level(marker.indent);
            let (checked, first) = match task_of(marker.rest) {
                Some((ticked, words)) => (Some(ticked), words),
                None => (None, marker.rest),
            };
            let mut text = first.trim_end().to_owned();
            i += 1;
            // A line that is not another block carries the item on, as a soft break does.
            while i < lines.len() && !begins_block(&lines, i) {
                text.push(' ');
                text.push_str(lines[i].trim());
                i += 1;
            }
            out.push(Block::Item {
                level,
                ordered: marker.ordered,
                checked,
                runs: runs(&text),
            });
            continue;
        }

        if let Some((alt, src)) = image_line(trimmed) {
            out.push(Block::Image { src, alt });
            i += 1;
            continue;
        }

        let mut text = String::new();
        loop {
            let hard = lines[i].ends_with("  ") || lines[i].trim_end().ends_with('\\');
            let words = lines[i].trim().trim_end_matches('\\').trim_end();
            text.push_str(words);
            i += 1;
            if i >= lines.len() || begins_block(&lines, i) {
                break;
            }
            text.push(if hard { '\n' } else { ' ' });
        }
        out.push(Block::Paragraph { runs: runs(&text) });
    }
    out
}

/// A formula on lines of its own, in `$$`: the LaTeX between them, or on the line with them. `i` is left after it.
fn formula(lines: &[&str], i: &mut usize) -> String {
    let trimmed = lines[*i].trim();
    let inner = trimmed.trim_start_matches('$');
    if inner.ends_with("$$") && !inner.is_empty() {
        *i += 1;
        return inner.trim_end_matches('$').trim().to_owned();
    }
    let mut latex = Vec::new();
    if !inner.trim().is_empty() {
        latex.push(inner.trim());
    }
    *i += 1;
    while *i < lines.len() && !lines[*i].trim().ends_with("$$") {
        latex.push(lines[*i].trim_end());
        *i += 1;
    }
    if let Some(last) = lines.get(*i) {
        let tail = last.trim().trim_end_matches('$').trim();
        if !tail.is_empty() {
            latex.push(tail);
        }
    }
    *i += 1;
    latex.join("\n").trim().to_owned()
}

/// A quote's lines as blocks: a paragraph of the quote each, the first naming the kind when the quote is a callout.
fn quote(lines: &[String], out: &mut Vec<Block>) {
    let mut callout = None;
    let mut paragraphs: Vec<String> = Vec::new();
    let mut start = 0;
    if let Some(first) = lines.first()
        && let Some(rest) = first.trim_start().strip_prefix("[!")
        && let Some((kind, title)) = rest.split_once(']')
        && !kind.is_empty()
        && kind.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        callout = Some(kind.to_ascii_lowercase());
        let title = title.trim().trim_start_matches(['+', '-']).trim();
        if !title.is_empty() {
            out.push(Block::Quote {
                callout: callout.take(),
                runs: bold(title),
            });
        }
        start = 1;
    }
    let mut current = String::new();
    for line in &lines[start..] {
        if line.trim().is_empty() {
            if !current.is_empty() {
                paragraphs.push(std::mem::take(&mut current));
            }
        } else {
            if !current.is_empty() {
                current.push(' ');
            }
            current.push_str(line.trim());
        }
    }
    if !current.is_empty() {
        paragraphs.push(current);
    }
    for text in paragraphs {
        out.push(Block::Quote {
            callout: callout.take(),
            runs: runs(&text),
        });
    }
    // A callout with a kind and nothing under it is still there.
    if let Some(kind) = callout {
        out.push(Block::Quote {
            callout: Some(kind.clone()),
            runs: bold(&kind),
        });
    }
}
