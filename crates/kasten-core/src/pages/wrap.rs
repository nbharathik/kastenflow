//! Steps that put blocks into a container: columns, a toggle, a callout, and
//! columns taken apart. The container is written the way the editor writes
//! it; the blocks inside keep their bytes (a callout puts `> ` in front of
//! each line, which is what a callout is).

use super::blocks::{Block, Kind, Page};
use super::edits::Edit;
use super::lines::{is_blank, split_lines, with_eol};
use super::steps::{BlockRef, PageStep};
use crate::error::{Error, Result};

fn invalid(why: impl Into<String>) -> Error {
    Error::Invalid(why.into())
}

/// The edits of the steps that wrap blocks; None for the steps others make.
pub(crate) fn wrapping(page: &Page, step: &PageStep) -> Option<Result<Vec<Edit>>> {
    Some(match step {
        PageStep::WrapColumns {
            blocks,
            columns,
            ratio,
        } => wrap_columns(page, blocks, columns, ratio.as_deref()),
        PageStep::UnwrapColumns { block } => unwrap_columns(page, block),
        PageStep::Toggle { blocks, title } => toggle(page, blocks, title),
        PageStep::Callout {
            blocks,
            kind,
            title,
        } => callout(page, blocks, kind, title),
        _ => return None,
    })
}

/// Checks that `text` is one block of the kind a step meant to make, so a
/// container that would not read back as itself is never written.
fn made(text: &str, wanted: Kind, what: &str) -> Result<()> {
    let page = Page::parse(text);
    match page.roots.as_slice() {
        [only] if page.blocks[*only].kind == wanted => Ok(()),
        _ => Err(invalid(format!(
            "These blocks would not read back as one {what} (their text clashes with its markers), so nothing was written"
        ))),
    }
}

fn joined(page: &Page, blocks: &[&Block]) -> String {
    let gap = format!("{eol}{eol}", eol = page.eol);
    blocks
        .iter()
        .map(|b| page.source(b))
        .collect::<Vec<_>>()
        .join(&gap)
}

fn not_a_container(blocks: &[&Block]) -> Result<()> {
    if blocks
        .iter()
        .any(|b| matches!(b.kind, Kind::Columns | Kind::Column))
    {
        return Err(invalid(
            "Columns cannot go inside a toggle or a callout; they stay at the top of the page",
        ));
    }
    Ok(())
}

fn wrap_columns(
    page: &Page,
    refs: &[BlockRef],
    sizes: &[usize],
    ratio: Option<&str>,
) -> Result<Vec<Edit>> {
    let run = page.run_of(refs)?;
    if run
        .iter()
        .any(|b| b.parent.is_some() || b.kind == Kind::Columns)
    {
        return Err(invalid(
            "Columns go around blocks at the top of the page, not blocks already in a column or toggle",
        ));
    }
    let sizes: Vec<usize> = if sizes.is_empty() {
        vec![1; run.len()]
    } else {
        sizes.to_vec()
    };
    if sizes.contains(&0) || sizes.iter().sum::<usize>() != run.len() {
        return Err(invalid(format!(
            "`columns` must give each column at least one block, {} in all",
            run.len()
        )));
    }
    if sizes.len() < 2 {
        return Err(invalid("Columns need at least two columns"));
    }
    let ratio = ratio.map(str::trim).unwrap_or_default();
    let fits = ratio.is_empty()
        || (ratio.split('/').count() == sizes.len()
            && ratio.split('/').all(|p| {
                !p.is_empty()
                    && p.chars().all(|c| c.is_ascii_digit())
                    && p.parse::<u64>().is_ok_and(|n| n > 0)
            }));
    if !fits {
        return Err(invalid(format!(
            "The ratio needs {} positive numbers joined by /, such as 40/60",
            sizes.len()
        )));
    }
    let eol = page.eol;
    let gap = format!("{eol}{eol}");
    let mut parts = vec![if ratio.is_empty() {
        "<!-- columns -->".to_owned()
    } else {
        format!("<!-- columns {ratio} -->")
    }];
    let mut at = 0;
    for (n, size) in sizes.iter().enumerate() {
        if n > 0 {
            parts.push("<!-- column -->".to_owned());
        }
        parts.push(joined(page, &run[at..at + size]));
        at += size;
    }
    parts.push("<!-- /columns -->".to_owned());
    let text = parts.join(&gap);
    made(&text, Kind::Columns, "columns block")?;
    let (start, end) = page.run_span(&run);
    Ok(vec![Edit::exact(start, end, text)])
}

fn unwrap_columns(page: &Page, reference: &BlockRef) -> Result<Vec<Edit>> {
    let block = page.find(reference)?;
    if block.kind != Kind::Columns {
        return Err(invalid(format!("{} is not a columns block", block.id)));
    }
    let inside: Vec<&Block> = block
        .children
        .iter()
        .flat_map(|&column| page.blocks[column].children.iter())
        .map(|&child| &page.blocks[child])
        .collect();
    if inside.is_empty() {
        let (start, end) = page.removal(block)?;
        return Ok(vec![Edit::exact(start, end, String::new())]);
    }
    Ok(vec![Edit::exact(
        block.at.start,
        block.at.end,
        joined(page, &inside),
    )])
}

/// A summary line that cannot end the toggle or run anything.
fn summary_line(title: &str) -> String {
    let line = title
        .split(['\r', '\n'])
        .map(str::trim)
        .collect::<Vec<_>>()
        .join(" ");
    let lower = line.to_ascii_lowercase();
    let risky = [
        "summary", "details", "script", "style", "iframe", "object", "embed",
    ]
    .iter()
    .any(|name| {
        [format!("<{name}"), format!("</{name}")].iter().any(|tag| {
            lower.match_indices(tag.as_str()).any(|(at, _)| {
                !lower[at + tag.len()..]
                    .chars()
                    .next()
                    .is_some_and(char::is_alphanumeric)
            })
        })
    });
    if risky {
        line.replace('<', "&lt;").replace('>', "&gt;")
    } else {
        line
    }
}

fn toggle(page: &Page, refs: &[BlockRef], title: &str) -> Result<Vec<Edit>> {
    let run = page.run_of(refs)?;
    not_a_container(&run)?;
    let eol = page.eol;
    let text = format!(
        "<details>{eol}<summary>{}</summary>{eol}{eol}{}{eol}{eol}</details>",
        summary_line(title),
        joined(page, &run)
    );
    made(&text, Kind::Toggle, "toggle")?;
    let (start, end) = page.run_span(&run);
    Ok(vec![Edit::exact(start, end, text)])
}

fn callout(page: &Page, refs: &[BlockRef], kind: &str, title: &str) -> Result<Vec<Edit>> {
    let run = page.run_of(refs)?;
    not_a_container(&run)?;
    let kind = kind.trim();
    let mut chars = kind.chars();
    if !chars.next().is_some_and(|c| c.is_ascii_alphabetic())
        || !chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(invalid(format!(
            "“{kind}” is not a callout kind; use a word such as note, tip, warning or danger"
        )));
    }
    let title = title
        .split(['\r', '\n'])
        .map(str::trim)
        .collect::<Vec<_>>()
        .join(" ");
    let eol = page.eol;
    let mut lines = vec![if title.is_empty() {
        format!("> [!{kind}]")
    } else {
        format!("> [!{kind}] {title}")
    }];
    for (n, block) in run.iter().enumerate() {
        // The header and a first paragraph are one run of lines, as the editor writes it;
        // anything else gets a quoted blank line so it cannot be read into the header.
        if n > 0 || !matches!(block.kind, Kind::Paragraph | Kind::Embed) {
            lines.push(">".to_owned());
        }
        for line in split_lines(page.source(block)) {
            lines.push(if is_blank(line.text) {
                ">".to_owned()
            } else {
                format!("> {}", line.text)
            });
        }
    }
    let text = with_eol(&lines.join("\n"), eol);
    made(&text, Kind::Callout, "callout")?;
    let (start, end) = page.run_span(&run);
    Ok(vec![Edit::exact(start, end, text)])
}
