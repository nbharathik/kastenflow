//! A capture from the browser tab: a web page, or a selection from one,
//! kept as a card tagged `capture` (with the page's address and a few
//! properties, in the inbox or a project), or as a quote added to a page.
//! The first card also makes the `capture` tag's database, in the same commit.
//! What the page held is read here, not trusted: scripts and `javascript:`
//! links go, text cannot form a link or a tag, and sizes are capped.

use serde_json::{Map, Value, json};

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
/// The longest address kept.
const MAX_URL: usize = 4096;
/// The most Markdown quoted into a page.
const MAX_QUOTE: usize = 50_000;
/// The tag every capture carries.
pub const TAG: &str = "capture";
const SCHEMA: &str = "tags/capture.yaml";

/// The most tags a capture carries beside `capture`.
const MAX_TAGS: usize = 8;
/// The longest tag, in characters.
const MAX_TAG: usize = 40;

/// What the browser tab or the browser extension read: the page's address
/// (from navigation, not from the page), its title, the selection or page as
/// HTML or as plain text, how it came ("browser" or "extension"), and tags to
/// put on the card beside `capture`. With neither `html` nor `text` the
/// capture is the link alone. A quote added to a page takes no tags.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WebCapture {
    pub url: String,
    pub title: String,
    pub html: Option<String>,
    pub text: Option<String>,
    pub via: String,
    pub tags: Vec<String>,
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
#[derive(Debug, Clone, PartialEq, Eq)]
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

/// `tags` as the tags a card keeps beside `capture`: a leading `#` goes,
/// empty ones and repeats (in any case) are dropped, and one that could not
/// be a tag (letters, digits, `-`, `_` and `/` only) refuses the capture.
fn extra_tags(tags: &[String]) -> Result<Vec<String>> {
    let mut out: Vec<String> = Vec::new();
    for tag in tags {
        let tag = tag.trim().trim_start_matches('#').trim();
        if tag.is_empty() {
            continue;
        }
        let fine = tag.chars().count() <= MAX_TAG
            && tag
                .chars()
                .all(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '/'));
        if !fine {
            return Err(Error::Invalid(format!(
                "“{}” cannot be a tag: tags are letters, digits, dashes, underscores and slashes, up to {MAX_TAG} characters",
                tag.chars().take(MAX_TAG).collect::<String>()
            )));
        }
        if !tag.eq_ignore_ascii_case(TAG) && !out.iter().any(|t| t.eq_ignore_ascii_case(tag)) {
            out.push(tag.to_owned());
        }
    }
    if out.len() > MAX_TAGS {
        return Err(Error::Invalid(format!(
            "A capture carries at most {MAX_TAGS} tags"
        )));
    }
    Ok(out)
}

/// `url` as an address a capture keeps: a web page's, with no name or
/// password in it.
fn address(url: &str) -> Result<String> {
    let url = url.trim();
    let lower = url.to_ascii_lowercase();
    let rest = ["https://", "http://"]
        .iter()
        .find_map(|scheme| lower.strip_prefix(scheme).map(|_| &url[scheme.len()..]));
    let bad = |why: &str| Error::Invalid(format!("That address cannot be kept: {why}"));
    let Some(rest) = rest else {
        return Err(bad("only web pages (http or https) are captured"));
    };
    if url.len() > MAX_URL || url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(bad("it is too long or holds spaces"));
    }
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty() || authority.contains('@') {
        return Err(bad("it has no site, or holds a name and password"));
    }
    Ok(url.to_owned())
}

/// The site an address is on: its host without a port or a leading `www.`.
pub fn site_of(url: &str) -> String {
    let rest = url.split_once("://").map_or(url, |(_, rest)| rest);
    let authority = rest.split(['/', '?', '#']).next().unwrap_or(rest);
    let host = if authority.starts_with('[') {
        authority.split_inclusive(']').next().unwrap_or(authority)
    } else {
        authority.split(':').next().unwrap_or(authority)
    };
    let host = host.to_ascii_lowercase();
    host.strip_prefix("www.").unwrap_or(&host).to_owned()
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

/// The tag database a capture is filed under: its columns and three views.
fn schema() -> Value {
    json!({
        "color": "blue",
        "properties": [
            {"key": "url", "type": "url"},
            {"key": "site", "type": "text"},
            {"key": "captured", "type": "date"},
            {"key": "status", "type": "select", "options": ["New", "Read", "Filed"]},
        ],
        "views": [
            {"name": "All", "type": "table", "sort": [{"key": "captured", "dir": "desc"}]},
            {"name": "By site", "type": "table", "sort": [{"key": "site", "dir": "asc"}, {"key": "captured", "dir": "desc"}]},
            {"name": "This week", "type": "calendar", "date": "captured"},
            // The view a project page embeds: only what is filed in that project.
            {"name": "This project", "type": "table", "scope": "project", "sort": [{"key": "captured", "dir": "desc"}]},
        ],
    })
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
            Ok(Change {
                message: format!("capture: {}", note.meta.title),
                paths,
                value: note,
            })
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_web_addresses_only_and_names_the_site() {
        assert_eq!(
            address(" https://www.Example.com/a?b=1#c ").unwrap(),
            "https://www.Example.com/a?b=1#c"
        );
        for bad in [
            "http:///x",
            "https://u:p@example.com/",
            "https://a b/",
            "mailto:a@b.c",
            "HTTP:example.com",
        ] {
            assert!(address(bad).is_err(), "{bad}");
        }
        assert_eq!(site_of("https://www.Example.com:8443/a?b=1"), "example.com");
        assert_eq!(site_of("http://[::1]:8080/x"), "[::1]");
        assert_eq!(site_of("https://news.example.org"), "news.example.org");
    }

    #[test]
    fn the_default_database_is_the_one_a_first_capture_makes() {
        // New vaults are given this file with the other default tags, and a
        // vault without it gets the same text from its first capture.
        let made = crate::tags::schema_yaml(TAG, &schema()).unwrap();
        assert_eq!(made, include_str!("../../defaults/tags/capture.yaml"));
    }

    #[test]
    fn extra_tags_are_cleaned_and_one_that_cannot_be_a_tag_refuses() {
        let list = |tags: &[&str]| tags.iter().map(|t| (*t).to_owned()).collect::<Vec<_>>();
        assert_eq!(
            extra_tags(&list(&["#a", " b ", "A", "", "Capture", "x/y-z_1", "é"])).unwrap(),
            ["a", "b", "x/y-z_1", "é"]
        );
        assert!(extra_tags(&[]).unwrap().is_empty());
        for bad in ["a b", "a,b", "a:b", "a#b", "<x>", &"z".repeat(41)] {
            assert!(extra_tags(&list(&[bad])).is_err(), "{bad}");
        }
        let nine: Vec<String> = (0..9).map(|n| format!("t{n}")).collect();
        assert!(extra_tags(&nine).is_err());
        assert_eq!(extra_tags(&nine[..8]).unwrap().len(), 8);
    }

    #[test]
    fn text_becomes_paragraphs_that_start_no_block() {
        assert_eq!(
            paragraphs("a\r\nb\n\n\n# c\n- d\n1. e\n> f\n```\nplain"),
            "a  \nb\n\n\\# c  \n\\- d  \n\\1. e  \n\\> f  \n\\```  \nplain"
        );
        assert_eq!(paragraphs(" \n\t\n"), "");
    }

    #[test]
    fn a_long_selection_is_quoted_in_whole_paragraphs() {
        let checked = Checked {
            url: "https://example.com/x".to_owned(),
            title: "T".to_owned(),
            site: "example.com".to_owned(),
            via: "browser".to_owned(),
            tags: Vec::new(),
            markdown: Some(format!(
                "{}\n\n{}\n",
                "a".repeat(40_000),
                "b".repeat(40_000)
            )),
        };
        let text = quote(&checked, "2026-09-24");
        assert!(text.contains("*The rest of the selection was left out.*"));
        assert!(!text.contains('b'.to_string().repeat(100).as_str()));
        assert!(text.ends_with("> — [T](https://example.com/x), 2026-09-24"));
    }
}
