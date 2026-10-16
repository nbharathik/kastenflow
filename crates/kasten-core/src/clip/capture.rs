//! A capture from the browser tab: a web page, or a selection from one,
//! kept as a card tagged `capture` (with the page's address and a few
//! properties, in the inbox or a project), or as a quote added to a page.
//! The first card also makes the `capture` tag's database, in the same commit.
//! What the page held is read here, not trusted: scripts and `javascript:`
//! links go, text cannot form a link or a tag, and sizes are capped.

use serde_json::{Map, json};

use super::address::{address, extra_tags, site_of};
use super::capture_schema::schema;
use super::escape::{plain, target as link_target};
use super::{MAX_MARKDOWN, clip};
use crate::engine::{Change, Kasten};
use crate::error::{Error, Result};
use crate::frontmatter::{join, set_key, set_key_raw, split, still_readable, yaml_list};
use crate::history::Actor;
use crate::note::NoteFile;
use crate::ops::{self, Kind, NewNote, eol_of};
use crate::rollback::Rollback;
use crate::slug::slugify;
use crate::time::Instant;

/// The most HTML or text a capture takes in: what the web clipper takes of a
/// whole page. (The browser tab's own script sends at most 900,000 characters
/// of a selection.)
pub const MAX_INPUT: usize = 8 << 20;
/// The most Markdown quoted into a page.
const MAX_QUOTE: usize = 50_000;
/// The tag every capture carries.
pub const TAG: &str = "capture";
const SCHEMA: &str = "tags/capture.yaml";

/// What the browser tab or the browser extension read: the page's address
/// (from navigation, not from the page), its title, the selection or page as
/// HTML or as plain text, how it came ("browser" or "extension"), and tags to
/// put on the card beside `capture`. With neither `html` nor `text` the
/// capture is the link alone. A quote added to a page takes no tags.
///
/// `snapshot_of` names (by id or path) a card the same page was saved in
/// before: the new card is then kept as a snapshot of it, with that card's id
/// (or, for a snapshot, the id it was a snapshot of) in `props.snapshot_of`.
/// The first card is only read, never written. A quote added to a page has no
/// card to mark and ignores it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WebCapture {
    pub url: String,
    pub title: String,
    pub html: Option<String>,
    pub text: Option<String>,
    pub via: String,
    pub tags: Vec<String>,
    pub snapshot_of: Option<String>,
}

/// Where a capture goes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Target {
    /// A card in the inbox.
    Inbox,
    /// A card in the project's folder (its name under `projects/`).
    Project(String),
    /// A quote added to the end of a page, or of the section under `heading`.
    Page {
        path: String,
        heading: Option<String>,
    },
}

/// What a capture would keep, for the person to see before it is written.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub title: String,
    pub site: String,
    /// The start of the Markdown that would be kept; empty for a link alone.
    pub excerpt: String,
    /// The size of that Markdown.
    pub bytes: usize,
}

struct Checked {
    url: String,
    title: String,
    site: String,
    via: String,
    /// The extra tags, cleaned: no `#`, no repeats, none called `capture`.
    tags: Vec<String>,
    markdown: Option<String>,
}

/// Plain text as Markdown: paragraphs apart, line breaks kept, and nothing
/// that forms a link, a tag, a heading, a list or a quote.
fn paragraphs(text: &str) -> String {
    let text = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut out: Vec<String> = Vec::new();
    let mut run: Vec<String> = Vec::new();
    let flush = |run: &mut Vec<String>, out: &mut Vec<String>| {
        if !run.is_empty() {
            out.push(run.join("  \n"));
            run.clear();
        }
    };
    for line in text.split('\n') {
        let line = line.trim();
        if line.is_empty() {
            flush(&mut run, &mut out);
        } else {
            run.push(block_safe(&plain(line)));
        }
    }
    flush(&mut run, &mut out);
    out.join("\n\n")
}

/// `line` with a backslash in front when it would start a block.
fn block_safe(line: &str) -> String {
    let digits = line.bytes().take_while(u8::is_ascii_digit).count();
    let numbered =
        (1..10).contains(&digits) && [". ", ") "].iter().any(|m| line[digits..].starts_with(m));
    let marked = [
        "# ", "## ", "### ", "#### ", "##### ", "###### ", "> ", "- ", "* ", "+ ", "```", "~~~",
        "---", "***", "___", "===",
    ]
    .iter()
    .any(|mark| line.starts_with(mark))
        || line == "#"
        || line == ">"
        || line == "-"
        || line.starts_with('|');
    if numbered || marked {
        format!("\\{line}")
    } else {
        line.to_owned()
    }
}

impl WebCapture {
    fn check(&self) -> Result<Checked> {
        let url = address(&self.url)?;
        let site = site_of(&url);
        let via = self.via.trim();
        if via.is_empty()
            || via.len() > 24
            || !via
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        {
            return Err(Error::Invalid(
                "A capture says how it came in letters, digits and dashes".to_owned(),
            ));
        }
        let title: String = self.title.chars().take(1000).collect();
        let title = crate::import::clean_title(&crate::sources::shortened(&title, 100, 90));
        let title = if self.title.trim().is_empty() {
            site.clone()
        } else {
            title
        };
        Ok(Checked {
            tags: extra_tags(&self.tags)?,
            markdown: self.markdown(&url)?,
            url,
            title,
            site,
            via: via.to_owned(),
        })
    }

    /// What the page held, as Markdown; none for the link alone.
    fn markdown(&self, url: &str) -> Result<Option<String>> {
        let too_big = || Error::Invalid("That is too big to keep".to_owned());
        let nothing = || Error::Invalid("There is nothing to keep in that selection".to_owned());
        match (self.html.as_deref(), self.text.as_deref()) {
            (Some(html), _) if !html.trim().is_empty() => {
                if html.len() > MAX_INPUT {
                    return Err(too_big());
                }
                let markdown = clip(url, html).markdown;
                if markdown.trim().is_empty() {
                    return Err(nothing());
                }
                Ok(Some(markdown))
            }
            (_, Some(text)) if !text.trim().is_empty() => {
                if text.len() > MAX_INPUT {
                    return Err(too_big());
                }
                let mut markdown = paragraphs(text);
                if markdown.is_empty() {
                    return Err(nothing());
                }
                if markdown.len() > MAX_MARKDOWN {
                    let mut cut = MAX_MARKDOWN;
                    while !markdown.is_char_boundary(cut) {
                        cut -= 1;
                    }
                    markdown.truncate(cut);
                    markdown.push_str("\n\n*The rest was left out.*");
                }
                markdown.push('\n');
                Ok(Some(markdown))
            }
            _ => Ok(None),
        }
    }

    /// What keeping this would keep, or why it cannot be kept.
    pub fn preview(&self) -> Result<Preview> {
        let checked = self.check()?;
        let markdown = checked.markdown.unwrap_or_default();
        Ok(Preview {
            title: checked.title,
            site: checked.site,
            excerpt: markdown.chars().take(600).collect(),
            bytes: markdown.len(),
        })
    }
}

/// A quote of `markdown` from the page, with its source, for a page's body.
fn quote(checked: &Checked, day: &str) -> String {
    let source = format!(
        "[{}]({}), {day}",
        checked.title,
        link_target(&checked.url, &checked.url).unwrap_or_else(|| checked.url.clone())
    );
    let Some(markdown) = &checked.markdown else {
        return source;
    };
    let mut text = markdown.trim_end().to_owned();
    if text.len() > MAX_QUOTE {
        let mut cut = MAX_QUOTE;
        while !text.is_char_boundary(cut) {
            cut -= 1;
        }
        // Whole paragraphs only.
        let kept = text[..cut].rfind("\n\n").unwrap_or(cut);
        text.truncate(kept);
        text.push_str("\n\n*The rest of the selection was left out.*");
    }
    let mut lines: Vec<String> = text
        .lines()
        .map(|l| {
            if l.is_empty() {
                ">".to_owned()
            } else {
                format!("> {l}")
            }
        })
        .collect();
    lines.push(">".to_owned());
    lines.push(format!("> — {source}"));
    lines.join("\n")
}

impl Kasten {
    /// Keeps what the browser tab captured, as one commit: a card (in the
    /// inbox or a project) tagged `capture`, with `url:` and the properties
    /// `url`, `site`, `captured` and `via`, and, if the vault has none yet,
    /// the `capture` tag's database; or a quote with a link to its source
    /// added to a page (at the end, or under a heading), which never takes
    /// anything out of it.
    pub fn capture_web(
        &self,
        actor: &Actor,
        capture: &WebCapture,
        target: &Target,
        now: Instant,
    ) -> Result<NoteFile> {
        let checked = capture.check()?;
        let day = &now.rfc3339()[..10];
        let project = match target {
            Target::Page { path, heading } => {
                let heading = heading.as_deref().filter(|h| !h.trim().is_empty());
                let mut text = quote(&checked, day);
                // After a list or a paragraph, a quote starts a block of its own.
                if heading.is_some() {
                    text.insert(0, '\n');
                }
                return self.append(actor, path, &text, heading, now);
            }
            Target::Inbox => None,
            Target::Project(name) => {
                let folder = self.root().join("projects").join(name);
                if name.is_empty() || slugify(name) != *name || !folder.is_dir() {
                    return Err(Error::Invalid(format!("No project called {name}")));
                }
                Some(name.as_str())
            }
        };
        // Read before the write lock is taken; the first card is not written.
        let origin = match capture.snapshot_of.as_deref() {
            Some(reference) => Some(self.snapshot_origin(reference)?),
            None => None,
        };
        self.apply(actor, "capture_web", false, now.millis, |vault| {
            let new = NewNote {
                kind: Kind::Card,
                title: checked.title.clone(),
                date: day.to_owned(),
                project: project.map(str::to_owned),
                parent: None,
                template: None,
                icon: None,
            };
            let created = ops::create_note(vault, &new, now)?;
            let path = created.meta.path.clone();
            let mut undo = Rollback::default();
            let made = (|| -> Result<(NoteFile, bool)> {
                let eol = eol_of(&created.text);
                let parts = split(&created.text);
                let mut tags = created.meta.tags.clone();
                if !tags.iter().any(|t| t.eq_ignore_ascii_case(TAG)) {
                    tags.push(TAG.to_owned());
                }
                for tag in &checked.tags {
                    if !tags.iter().any(|t| t.eq_ignore_ascii_case(tag)) {
                        tags.push(tag.clone());
                    }
                }
                let mut props = Map::new();
                props.insert("url".to_owned(), json!(checked.url));
                props.insert("site".to_owned(), json!(checked.site));
                props.insert("captured".to_owned(), json!(day));
                props.insert("via".to_owned(), json!(checked.via));
                if let Some(origin) = &origin {
                    props.insert("snapshot_of".to_owned(), json!(origin));
                }
                let prefix = set_key_raw(parts.prefix, "tags", Some(&yaml_list(&tags)), eol);
                let prefix = crate::props::set_props(&prefix, &props, eol)?;
                let prefix = set_key(&prefix, "url", Some(&checked.url), eol);
                still_readable(parts.prefix, &prefix)?;
                let source = format!(
                    "Captured from [{}]({}) on {day}.\n",
                    checked.site,
                    link_target(&checked.url, &checked.url).unwrap_or_else(|| checked.url.clone())
                );
                let body = match &checked.markdown {
                    Some(markdown) => format!("{markdown}\n{source}"),
                    None => source,
                };
                // The file `create_note` made is ours: put back if a later step fails.
                undo.write(
                    &vault.path_of(&path)?,
                    join(&prefix, &body, eol).as_bytes(),
                    None,
                )?;
                let file = vault.file_of(SCHEMA, &[".yaml"])?;
                let first = !file.exists();
                if first {
                    let yaml = crate::tags::schema_yaml(TAG, &schema())?;
                    undo.create(&file, yaml.as_bytes())?;
                }
                Ok((vault.read(&path)?, first))
            })();
            let (note, first) = match made {
                Ok(done) => done,
                Err(err) => {
                    undo.put_back();
                    return Err(err);
                }
            };
            let mut paths = vec![path];
            if first {
                paths.push(SCHEMA.to_owned());
            }
            paths.extend(self.keep_for_new(vault, &note.meta)?);
            let again = if origin.is_some() { " (snapshot)" } else { "" };
            Ok(Change {
                message: format!("capture: {}{again}", note.meta.title),
                paths,
                value: note,
            })
        })
    }
}

#[cfg(test)]
#[path = "capture_tests.rs"]
mod tests;
