//! A page body cut into blocks by the page scanner, each written as LaTeX:
//! paragraphs, headings, lists, tables, code, quotes, callouts, formulas,
//! rules. What has no LaTeX form (HTML, embeds, images) becomes a comment.

use super::escape::{comment_text, math_is_safe};
use super::inline::Inline;
use super::{list, table};
use crate::pages::{Block, Kind, Page};

/// How many quotes may nest before the rest is read as one paragraph.
const MAX_QUOTE_DEPTH: usize = 6;

/// One converted block.
pub(super) enum Out {
    Heading {
        level: u8,
        text: String,
        notes: Vec<String>,
    },
    Text(String),
}

impl Out {
    /// A heading where headings do not belong (inside a quote): a bold line.
    pub fn flattened(self) -> String {
        match self {
            Out::Text(text) => text,
            Out::Heading { text, notes, .. } => {
                let mut lines = vec![format!("\\textbf{{{text}}}")];
                lines.extend(notes);
                lines.join("\n")
            }
        }
    }
}

/// The text and the notes that follow it, as one block of output; none when both are empty.
fn finish(text: String, inline: &mut Inline) -> Option<String> {
    let notes = std::mem::take(&mut inline.notes);
    let mut lines: Vec<String> = Vec::new();
    if !text.trim().is_empty() {
        lines.push(text);
    }
    lines.extend(notes);
    (!lines.is_empty()).then(|| lines.join("\n"))
}

/// The lines of a paragraph, each without its indent (line breaks are kept).
fn paragraph_text(source: &str) -> String {
    source
        .lines()
        .map(str::trim_start)
        .collect::<Vec<_>>()
        .join("\n")
}

fn is_definition(line: &str) -> bool {
    let line = line.trim_start();
    line.strip_prefix('[')
        .and_then(|rest| rest.split_once("]:"))
        .is_some_and(|(label, target)| {
            !label.is_empty()
                && !label.starts_with('^')
                && !label.contains(']')
                && !target.trim().is_empty()
        })
}

/// `body` as converted blocks. `depth` counts the quotes around it.
pub(super) fn convert(body: &str, depth: usize, inline: &mut Inline) -> Vec<Out> {
    let page = Page::parse(body);
    let mut outs = Vec::new();
    for block in &page.blocks {
        let (start, end) = page.range_of(block);
        let source = &body[start..end];
        match block_out(block, source, depth, inline) {
            Some(out @ Out::Heading { .. }) if depth > 0 => outs.push(Out::Text(out.flattened())),
            Some(out) => outs.push(out),
            None => {}
        }
    }
    outs
}

fn block_out(block: &Block, source: &str, depth: usize, inline: &mut Inline) -> Option<Out> {
    let text = |s: String, inline: &mut Inline| finish(s, inline).map(Out::Text);
    match block.kind {
        // Layout wrappers: their children are blocks of their own.
        Kind::Columns | Kind::Column => None,
        Kind::Toggle => {
            let title = inline.convert(block.title.as_deref().unwrap_or(""));
            text(
                if title.is_empty() {
                    String::new()
                } else {
                    format!("\\textbf{{{title}}}")
                },
                inline,
            )
        }
        Kind::Heading => {
            let shown = block.heading_path.last().map_or("", String::as_str);
            let text = inline.convert(shown);
            let notes = std::mem::take(&mut inline.notes);
            Some(Out::Heading {
                level: block.level.unwrap_or(1),
                text,
                notes,
            })
        }
        Kind::List | Kind::Todo => {
            let tex = list::convert(source, inline);
            text(tex, inline)
        }
        Kind::Table => match table::convert(source, inline) {
            Some(tex) => text(tex, inline),
            None => paragraph(source, inline),
        },
        Kind::Code => text(code(source), inline),
        Kind::Quote => {
            let tex = quote(source, depth, inline);
            text(tex, inline)
        }
        Kind::Callout => {
            let tex = callout(source, depth, inline);
            text(tex, inline)
        }
        Kind::Divider => text("\\medskip\\hrule\\medskip".to_owned(), inline),
        Kind::Math => {
            let inner = source
                .trim()
                .strip_prefix("$$")
                .and_then(|rest| rest.strip_suffix("$$"))
                .map(str::trim);
            match inner {
                Some(math) if math_is_safe(math) => text(format!("\\[\n{math}\n\\]"), inline),
                _ => paragraph(source, inline),
            }
        }
        Kind::Embed => {
            let target = source
                .trim()
                .trim_start_matches('!')
                .trim_start_matches("[[");
            let target = target.trim_end_matches("]]");
            inline.note(format!(
                "% TODO: embed not converted: {}",
                comment_text(target)
            ));
            text(String::new(), inline)
        }
        Kind::Html => {
            inline.note("% TODO: HTML not converted");
            for line in source.lines().take(10) {
                inline.note(format!("% {}", comment_text(line)));
            }
            text(String::new(), inline)
        }
        Kind::Paragraph => paragraph(source, inline),
    }
}

fn paragraph(source: &str, inline: &mut Inline) -> Option<Out> {
    if source
        .lines()
        .all(|l| l.trim().is_empty() || is_definition(l))
    {
        return None;
    }
    let converted = inline.convert(&paragraph_text(source));
    finish(converted, inline).map(Out::Text)
}

/// A code block (fenced or indented) as `verbatim`.
fn code(source: &str) -> String {
    let lines: Vec<&str> = source.lines().collect();
    let Some(first) = lines.first() else {
        return String::new();
    };
    let indent = first.len() - first.trim_start().len();
    let opening = first.trim_start();
    let fence = opening.chars().next().filter(|c| matches!(c, '`' | '~'));
    let run = fence.map_or(0, |f| opening.chars().take_while(|&c| c == f).count());
    let mut language = String::new();
    let body: Vec<&str> = match fence {
        Some(f) if run >= 3 => {
            language = opening[run..]
                .split_whitespace()
                .next()
                .unwrap_or("")
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || "_+#.-".contains(*c))
                .take(30)
                .collect();
            let mut rest = &lines[1..];
            if let Some(last) = rest.last()
                && last.trim().len() >= run
                && last.trim().chars().all(|c| c == f)
            {
                rest = &rest[..rest.len() - 1];
            }
            rest.iter()
                .map(|l| {
                    let strip = l.len() - l.trim_start_matches(' ').len();
                    &l[strip.min(indent)..]
                })
                .collect()
        }
        _ => lines
            .iter()
            .map(
                |l| match l.strip_prefix("    ").or_else(|| l.strip_prefix('\t')) {
                    Some(rest) => rest,
                    None => l.trim_start(),
                },
            )
            .collect(),
    };
    let mut out = Vec::new();
    if !language.is_empty() {
        out.push(format!("% language: {language}"));
    }
    out.push("\\begin{verbatim}".to_owned());
    // Nothing inside may end the environment early.
    out.extend(
        body.iter()
            .map(|l| l.replace("\\end{verbatim}", "\\end{verbatim }")),
    );
    out.push("\\end{verbatim}".to_owned());
    out.join("\n")
}

/// The lines of a quote without their `>` marks.
fn unquote(source: &str) -> String {
    source
        .lines()
        .map(|line| {
            let t = line.trim_start();
            match t.strip_prefix('>') {
                Some(rest) => rest.strip_prefix(' ').unwrap_or(rest),
                None => line,
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Converted blocks of a quote's inside, as one text.
fn inside(text: &str, depth: usize, inline: &mut Inline) -> String {
    if depth + 1 >= MAX_QUOTE_DEPTH {
        let converted = inline.convert(&paragraph_text(text));
        return finish(converted, inline).unwrap_or_default();
    }
    let parts: Vec<String> = convert(text, depth + 1, inline)
        .into_iter()
        .map(Out::flattened)
        .collect();
    parts.join("\n\n")
}

fn quote(source: &str, depth: usize, inline: &mut Inline) -> String {
    let body = inside(&unquote(source), depth, inline);
    environment("quote", &body)
}

fn environment(name: &str, body: &str) -> String {
    if body.trim().is_empty() {
        format!("\\begin{{{name}}}\n\\end{{{name}}}")
    } else {
        format!("\\begin{{{name}}}\n{body}\n\\end{{{name}}}")
    }
}

/// `> [!note] Title` and its body: a quote that starts with the title in bold.
fn callout(source: &str, depth: usize, inline: &mut Inline) -> String {
    let inner = unquote(source);
    let (first, rest) = inner.split_once('\n').unwrap_or((inner.as_str(), ""));
    let header = first
        .trim()
        .strip_prefix("[!")
        .and_then(|h| h.split_once(']'));
    let Some((kind, title)) = header else {
        return quote(source, depth, inline);
    };
    let title = title.trim_start_matches(['+', '-']).trim();
    let shown = if title.is_empty() {
        let mut chars = kind.chars();
        chars
            .next()
            .map_or(String::new(), |c| c.to_uppercase().chain(chars).collect())
    } else {
        title.to_owned()
    };
    let title = inline.convert(&shown);
    let heading = finish(format!("\\textbf{{{title}}}"), inline).unwrap_or_default();
    let body = inside(rest, depth, inline);
    let all = if body.trim().is_empty() {
        heading
    } else {
        format!("{heading}\n\n{body}")
    };
    environment("quote", &all)
}
