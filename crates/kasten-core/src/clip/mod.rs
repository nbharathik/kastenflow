//! The web clipper: a web page's article kept as a card in the
//! inbox, in Markdown, with the address it came from. Fetching the page is
//! the app's; reading it and keeping the card are the core's, as one commit.
//!
//! The article is the page's `<article>`, else its `<main>`, else its body
//! without navigation, forms and page furniture. Headings, paragraphs,
//! emphasis, links and images (absolute), lists, quotes, code, tables and
//! rules come across; scripts, styles and buttons do not.

mod capture;
mod escape;
mod html;
mod writer;

pub use capture::{MAX_INPUT, Preview, TAG, Target, WebCapture, site_of};
use html::{Element, parse};
use writer::Writer;

use crate::engine::{Change, Kasten};
use crate::error::{Error, Result};
use crate::frontmatter::{join, set_key, split};
use crate::history::Actor;
use crate::note::NoteFile;
use crate::ops::{self, Kind, NewNote, eol_of};
use crate::time::Instant;

/// A page read for keeping.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Clipped {
    pub title: String,
    pub markdown: String,
}

/// Most of a page kept; the rest is left out with a note saying so.
const MAX_MARKDOWN: usize = 400_000;

pub(crate) fn one_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// `href` as an absolute address, read against the page's `base`.
pub fn resolve(base: &str, href: &str) -> String {
    let href = href.trim();
    let scheme = href.split(':').next().unwrap_or("");
    if href.contains(':')
        && !scheme.is_empty()
        && scheme
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c))
    {
        return href.to_owned();
    }
    let base = base.split('#').next().unwrap_or(base);
    let (scheme, rest) = base.split_once("://").unwrap_or(("https", base));
    let host_end = rest.find('/').unwrap_or(rest.len());
    let (host, path) = rest.split_at(host_end);
    if let Some(other) = href.strip_prefix("//") {
        return format!("{scheme}://{other}");
    }
    if href.starts_with('/') {
        return format!("{scheme}://{host}{href}");
    }
    let path = path.split('?').next().unwrap_or(path);
    if href.starts_with('?') {
        return format!("{scheme}://{host}{path}{href}");
    }
    let mut parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
    if !path.ends_with('/') {
        parts.pop();
    }
    for part in href.split('/') {
        match part {
            "." => {}
            ".." => {
                parts.pop();
            }
            part => parts.push(part),
        }
    }
    format!("{scheme}://{host}/{}", parts.join("/"))
}

fn page_title(root: &Element, url: &str) -> String {
    let og = root
        .find(&|e| e.name == "meta" && e.attr("property") == Some("og:title"))
        .and_then(|e| e.attr("content"));
    let title = root.find(&|e| e.name == "title").map(Element::text);
    let heading = root
        .find(&|e| matches!(e.name.as_str(), "h1" | "h2"))
        .map(Element::text);
    [og.map(str::to_owned), title, heading]
        .into_iter()
        .flatten()
        .map(|t| one_line(&t))
        .find(|t| !t.is_empty())
        .unwrap_or_else(|| {
            let bare = url.split_once("://").map_or(url, |(_, rest)| rest);
            bare.trim_end_matches('/').to_owned()
        })
}

/// A page's title alone: its `og:title`, else its `<title>`, else its first
/// heading, else its address without the scheme. It reads whatever HTML it is
/// given, so a page cut off after its head still has one.
pub fn title_of(url: &str, page: &str) -> String {
    page_title(&parse(page), url)
}

/// Reads a page for keeping.
pub fn clip(url: &str, page: &str) -> Clipped {
    let root = parse(page);
    let title = page_title(&root, url);
    let part = root
        .find(&|e| e.name == "article")
        .or_else(|| root.find(&|e| e.name == "main" || e.attr("role") == Some("main")));
    let (part, frame) = match part {
        Some(part) => (part, false),
        None => (root.find(&|e| e.name == "body").unwrap_or(&root), true),
    };
    let writer = Writer { base: url, frame };
    let mut markdown = String::new();
    for block in writer.blocks(&part.children) {
        if markdown.len() + block.len() > MAX_MARKDOWN {
            markdown.push_str("*The rest of the page was left out.*\n\n");
            break;
        }
        markdown.push_str(&block);
        markdown.push_str("\n\n");
    }
    let markdown = markdown.trim_end().to_owned();
    Clipped {
        title,
        markdown: if markdown.is_empty() {
            markdown
        } else {
            format!("{markdown}\n")
        },
    }
}

impl Kasten {
    /// Keeps a web page, read from `page` (its HTML) at `url`, as a card in
    /// the inbox: the article in Markdown, where it came from, and `url:`.
    pub fn clip(&self, actor: &Actor, url: &str, page: &str, now: Instant) -> Result<NoteFile> {
        let clipped = clip(url, page);
        if clipped.markdown.trim().is_empty() {
            return Err(Error::Invalid(
                "There is nothing to keep on that page".to_owned(),
            ));
        }
        let host = url
            .split_once("://")
            .map_or(url, |(_, rest)| rest)
            .split('/')
            .next()
            .unwrap_or(url);
        let day = &now.rfc3339()[..10];
        let article = crate::import::without_title(&clipped.markdown, &clipped.title);
        let body = format!("{article}\nClipped from [{host}]({url}) on {day}.\n");
        let title = crate::import::clean_title(&crate::sources::shortened(&clipped.title, 100, 90));
        self.apply(actor, "clip", false, now.millis, |vault| {
            let new = NewNote {
                kind: Kind::Card,
                title,
                date: day.to_owned(),
                project: None,
                parent: None,
                template: None,
                icon: None,
            };
            let created = ops::create_note(vault, &new, now)?;
            let eol = eol_of(&created.text);
            let parts = split(&created.text);
            let prefix = set_key(parts.prefix, "url", Some(url), eol);
            crate::atomic::write_atomic(
                &vault.path_of(&created.meta.path)?,
                join(&prefix, &body, eol).as_bytes(),
            )?;
            let note = vault.read(&created.meta.path)?;
            Ok(Change {
                message: format!("clip: {}", note.meta.title),
                paths: vec![note.meta.path.clone()],
                value: note,
            })
        })
    }
}

#[cfg(test)]
mod tests;
