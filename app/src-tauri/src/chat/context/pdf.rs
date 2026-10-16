//! A PDF as context: the pages the person chose and the highlights they
//! picked. This side has no PDF reader, so the window reads the pages' text
//! (with pdf.js) and sends it as `excerpts`; the highlights are read here,
//! through the core. Both are capped again, whatever the window sent, and
//! both are data between `pdf` tags, never instructions.
//!
//! A chip's `ref` is `[source, "pages:3-5,8", "highlights:id,id"]` (or
//! `highlights:all`), the last two optional.

use kasten_core::Kasten;
use serde::Deserialize;

use super::{Part, attr, chars, cut, quoted};

/// The most pages whose text goes with a message.
pub const MAX_PAGES: usize = 10;
/// The most characters of page text.
pub const PAGE_CHARS: usize = 30_000;
/// The most highlights, and the most characters they take together.
pub const MAX_HIGHLIGHTS: usize = 50;
pub const HIGHLIGHT_CHARS: usize = 20_000;
/// The highest page number read; a page list never expands past it.
const LAST_PAGE: u32 = 10_000;

/// The text of one page of a PDF, read in the window.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Excerpt {
    /// The PDF's vault path.
    pub source: String,
    /// From 1.
    pub page: u32,
    pub text: String,
}

/// Page numbers from a list such as `3-5,8`: sorted, each once. Anything
/// that is not a page or a range of pages is an error.
pub fn pages(spec: &str) -> Result<Vec<u32>, String> {
    let mut out = Vec::new();
    if spec.trim().is_empty() {
        return Ok(out);
    }
    let number = |text: &str| -> Result<u32, String> {
        let page: u32 = text
            .trim()
            .parse()
            .map_err(|_| format!("“{}” is not a page number", text.trim()))?;
        if (1..=LAST_PAGE).contains(&page) {
            Ok(page)
        } else {
            Err(format!("Page {page} is out of range"))
        }
    };
    for item in spec.split(',') {
        match item.split_once('-') {
            Some((from, to)) => {
                let (from, to) = (number(from)?, number(to)?);
                if to < from {
                    return Err(format!("“{}” runs backwards", item.trim()));
                }
                out.extend(from..=to);
            }
            None => out.push(number(item)?),
        }
    }
    out.sort_unstable();
    out.dedup();
    Ok(out)
}

/// `pages` written short again: `1-3, 7, 9-10`.
pub fn label(pages: &[u32]) -> String {
    let mut parts = Vec::new();
    let mut i = 0;
    while i < pages.len() {
        let mut j = i;
        while j + 1 < pages.len() && pages[j + 1] == pages[j] + 1 {
            j += 1;
        }
        parts.push(if j > i {
            format!("{}-{}", pages[i], pages[j])
        } else {
            pages[i].to_string()
        });
        i = j + 1;
    }
    parts.join(", ")
}

/// What a chip names, read out of its `ref`.
struct Chosen<'a> {
    pages: Result<Vec<u32>, String>,
    /// `None`: no highlights chosen. `Some(None)`: all of them.
    highlights: Option<Option<Vec<&'a str>>>,
}

fn chosen(refs: &[String]) -> Chosen<'_> {
    let mut pages_spec = "";
    let mut highlights = None;
    for item in refs.iter().skip(1) {
        if let Some(spec) = item.strip_prefix("pages:") {
            pages_spec = spec;
        } else if let Some(list) = item.strip_prefix("highlights:") {
            let ids: Vec<&str> = list
                .split(',')
                .map(str::trim)
                .filter(|id| !id.is_empty())
                .collect();
            highlights = Some((ids != ["all"]).then_some(ids));
        }
    }
    Chosen {
        pages: pages(pages_spec),
        highlights,
    }
}

/// The page text of the chosen pages, within the cap.
fn page_text(source: &str, wanted: &[u32], excerpts: &[Excerpt]) -> String {
    if wanted.len() > MAX_PAGES {
        return format!(
            "(Too many pages were attached: the most is {MAX_PAGES}, and {} were named. None of their text was sent.)",
            wanted.len()
        );
    }
    let mut room = PAGE_CHARS;
    let mut cut_short = false;
    let mut sections = Vec::new();
    for page in wanted {
        let text = excerpts
            .iter()
            .find(|e| e.source == source && e.page == *page)
            .map(|e| e.text.trim());
        let body = match text {
            None => "(The text of this page was not available.)".to_owned(),
            Some("") => "(This page has no text to read; it may be a picture.)".to_owned(),
            Some(_) if room == 0 => {
                cut_short = true;
                continue;
            }
            Some(text) if chars(text) <= room => {
                room -= chars(text);
                text.to_owned()
            }
            Some(text) => {
                let shown = cut(text, room);
                room = 0;
                cut_short = true;
                format!("{shown}\n…")
            }
        };
        sections.push(format!("[Page {page}]\n{body}"));
    }
    let mut out = sections.join("\n\n");
    if cut_short {
        out.push_str(&format!(
            "\n\n(Page text was cut to stay within {PAGE_CHARS} characters.)"
        ));
    }
    out
}

/// The picked highlights, within the count and the size caps.
fn highlight_text(kasten: &Kasten, source: &str, picked: &Option<Vec<&str>>) -> String {
    let all = match kasten.highlights(source) {
        Ok(all) => all,
        Err(err) => return format!("(The highlights could not be read: {err})"),
    };
    let total = all.len();
    let mut lines = Vec::new();
    let mut missing = Vec::new();
    let chosen: Vec<_> = match picked {
        None => all.iter().collect(),
        Some(ids) => {
            for id in ids {
                if !all.iter().any(|h| h.id == *id) {
                    missing.push(format!("(No highlight {id} in this PDF.)"));
                }
            }
            all.iter()
                .filter(|h| ids.contains(&h.id.as_str()))
                .collect()
        }
    };
    let (mut room, mut shown) = (HIGHLIGHT_CHARS, 0);
    for highlight in chosen.iter().take(MAX_HIGHLIGHTS) {
        let comment = highlight
            .comment
            .as_deref()
            .map(str::trim)
            .filter(|c| !c.is_empty())
            .map(|c| format!(" Comment: {c}"))
            .unwrap_or_default();
        let line = format!(
            "- {} (page {}, {}): {}{comment}",
            highlight.id,
            highlight.page,
            highlight.color,
            quoted(&highlight.text.replace('\n', " "))
        );
        if chars(&line) > room {
            break;
        }
        room -= chars(&line);
        shown += 1;
        lines.push(line);
    }
    let mut out = Vec::new();
    if !chosen.is_empty() || missing.is_empty() {
        out.push(format!("Highlights ({shown} of {total} in this PDF):"));
        out.extend(lines);
        if shown < chosen.len() {
            out.push(format!(
                "(Only the first {shown} of the {} highlights chosen are included, to keep to {MAX_HIGHLIGHTS} highlights and {HIGHLIGHT_CHARS} characters.)",
                chosen.len()
            ));
        }
    }
    out.extend(missing);
    out.join("\n")
}

/// The chip's PDF as one part of the context block.
pub(super) fn pdf(kasten: &Kasten, refs: &[String], excerpts: &[Excerpt]) -> Part {
    let source = refs.first().map(String::as_str).unwrap_or_default();
    let chosen = chosen(refs);
    let mut sections = Vec::new();
    let mut label_of_pages = String::new();
    match &chosen.pages {
        Ok(wanted) => {
            label_of_pages = label(wanted);
            if !wanted.is_empty() {
                sections.push(page_text(source, wanted, excerpts));
            }
        }
        Err(why) => sections.push(format!("(The pages could not be read: {why}.)")),
    }
    if let Some(picked) = &chosen.highlights {
        sections.push(highlight_text(kasten, source, picked));
    }
    if sections.is_empty() {
        sections.push("(Nothing from this PDF was chosen.)".to_owned());
    }
    let name = source.rsplit('/').next().unwrap_or(source);
    Part {
        name: format!("the PDF {}", quoted(name)),
        open: format!(
            "<pdf path=\"{}\" pages=\"{}\">",
            attr(source),
            attr(&label_of_pages)
        ),
        body: sections.join("\n\n"),
        close: "</pdf>".to_owned(),
    }
}
