//! Page comments kept in a sidecar file beside the page, anchored to a section and a quote.
//!
//! The comments of `projects/x/pages/plan.md` are in
//! `projects/x/pages/plan.comments.json`:
//!
//! ```json
//! {
//!   "format": "kasten-comments",
//!   "comments": [
//!     {"id": "c-01J9…", "anchor": {"section": "Method", "nth": 1, "quote": "perceptual hash", "prefix": "Use a ", "suffix": " to score"}, "text": "Enough for crops?", "author": "you", "created": "2026-10-10T09:12:00+02:00"},
//!     {"id": "c-01J9…", "anchor": {"section": "Results", "nth": 1}, "text": "Add the table", "author": "agent:claude-code", "created": "…", "resolved": {"at": "…", "by": "you"}}
//!   ]
//! }
//! ```
//!
//! The file is kept as parsed JSON, so keys KastenFlow does not know survive,
//! and written one comment to a line. There is no delete: a comment is
//! resolved, and history keeps what was said. The page's own Markdown is
//! never touched. `section` is a section's title and `nth` which section of
//! that title it is (from 1; the sections are the page's, cut at its
//! dividers or, without any, at its headings); an empty `section` is the page
//! as a whole. The quote and what stands around it let the app find the place
//! again after the page changed; it is the app's to read, and a comment whose
//! place is gone is shown apart and can be attached again.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::companions::{COMMENTS, ListDoc, plain_id};
use crate::error::{Error, Result};

#[cfg(test)]
mod tests;

/// What the file says it is.
pub const FORMAT: &str = "kasten-comments";
/// The most comments one page keeps.
pub const MAX_COMMENTS: usize = 2_000;
/// The longest comment, in characters.
pub const MAX_TEXT: usize = 10_000;
/// The longest section title, quote and context, in characters.
const MAX_SECTION: usize = 300;
const MAX_QUOTE: usize = 2_000;
const MAX_CONTEXT: usize = 200;
/// The most sections of one title a page can have.
const MAX_NTH: u32 = 100_000;

/// Where a comment sits: a section, and optionally the words it is about.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Anchor {
    /// The section's title; empty for the page as a whole.
    #[serde(default)]
    pub section: String,
    /// Which section of that title, from 1.
    #[serde(default = "first")]
    pub nth: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quote: Option<String>,
    /// The words just before the quote.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prefix: Option<String>,
    /// The words just after the quote.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suffix: Option<String>,
}

fn first() -> u32 {
    1
}

/// When and by whom a comment was resolved.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Resolved {
    pub at: String,
    pub by: String,
}

/// A comment as the app shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: String,
    pub anchor: Anchor,
    pub text: String,
    /// `you`, or `agent:<client>` for an agent's comment.
    pub author: String,
    pub created: Option<String>,
    pub resolved: Option<Resolved>,
}

/// A comment to add.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewComment {
    pub anchor: Anchor,
    pub text: String,
}

/// The comments file of the page at `page`: `a/b.md` has `a/b.comments.json`.
pub fn sidecar_of(page: &str) -> Result<String> {
    crate::companions::of(page, COMMENTS).ok_or_else(|| Error::InvalidPath(page.to_owned()))
}

fn too_long(what: &str, max: usize) -> Error {
    Error::Invalid(format!("A comment's {what} is at most {max} characters"))
}

impl Anchor {
    /// Why it cannot be kept, if it cannot.
    pub fn check(&self) -> Result<()> {
        if self.section.chars().count() > MAX_SECTION {
            return Err(too_long("section", MAX_SECTION));
        }
        if self.section.chars().any(char::is_control) {
            return Err(Error::Invalid(
                "A section's title is on one line".to_owned(),
            ));
        }
        if self.nth == 0 || self.nth > MAX_NTH {
            return Err(Error::Invalid(
                "Sections of the same title count from 1".to_owned(),
            ));
        }
        for (what, text, max) in [
            ("quote", &self.quote, MAX_QUOTE),
            ("context before the quote", &self.prefix, MAX_CONTEXT),
            ("context after the quote", &self.suffix, MAX_CONTEXT),
        ] {
            if text.as_deref().is_some_and(|t| t.chars().count() > max) {
                return Err(too_long(what, max));
            }
        }
        Ok(())
    }
}

impl NewComment {
    /// Why it cannot be kept, if it cannot.
    pub fn check(&self) -> Result<()> {
        if self.text.trim().is_empty() {
            return Err(Error::Invalid("A comment needs some words".to_owned()));
        }
        if self.text.chars().count() > MAX_TEXT {
            return Err(too_long("text", MAX_TEXT));
        }
        self.anchor.check()
    }
}

fn string(item: &Map<String, Value>, key: &str) -> Option<String> {
    item.get(key).and_then(Value::as_str).map(str::to_owned)
}

fn anchor_of(item: &Map<String, Value>) -> Anchor {
    let at = item.get("anchor").and_then(Value::as_object);
    let get = |key: &str| at.and_then(|a| string(a, key));
    Anchor {
        section: get("section").unwrap_or_default(),
        nth: at
            .and_then(|a| a.get("nth"))
            .and_then(Value::as_u64)
            .and_then(|n| u32::try_from(n).ok())
            .filter(|n| *n >= 1)
            .unwrap_or(1),
        quote: get("quote"),
        prefix: get("prefix"),
        suffix: get("suffix"),
    }
}

/// A comment from its JSON; None for an entry without a usable id.
fn comment_of(item: &Value) -> Option<Comment> {
    let item = item.as_object()?;
    let id = string(item, "id").filter(|id| plain_id(id))?;
    let resolved = match item.get("resolved") {
        Some(Value::Object(r)) => Some(Resolved {
            at: string(r, "at").unwrap_or_default(),
            by: string(r, "by").unwrap_or_default(),
        }),
        Some(Value::Bool(true)) => Some(Resolved {
            at: String::new(),
            by: String::new(),
        }),
        _ => None,
    };
    Some(Comment {
        id,
        anchor: anchor_of(item),
        text: string(item, "text").unwrap_or_default(),
        author: string(item, "author").unwrap_or_default(),
        created: string(item, "created"),
        resolved,
    })
}

/// A comments file: the document as read, with its `comments` array.
#[derive(Debug, Clone, PartialEq)]
pub struct Comments {
    doc: ListDoc,
}

impl Default for Comments {
    fn default() -> Self {
        Comments::new()
    }
}

impl Comments {
    /// An empty file.
    pub fn new() -> Comments {
        Comments {
            doc: ListDoc::new("comments", FORMAT),
        }
    }

    /// A file in any JSON formatting; it needs to be an object, and a
    /// `comments` array is added when it has none.
    pub fn parse(text: &str) -> Result<Comments> {
        Ok(Comments {
            doc: ListDoc::parse(text, "comments", "a comments file")?,
        })
    }

    /// The file in house style, a comment to a line.
    pub fn to_text(&self) -> String {
        self.doc.to_text()
    }

    /// Every comment that has a usable id, in the order they were made.
    pub fn comments(&self) -> Vec<Comment> {
        self.doc.items().iter().filter_map(comment_of).collect()
    }

    /// Adds `new` as comment `id`, written by `author` at `created`.
    pub fn add(
        &mut self,
        id: &str,
        new: &NewComment,
        author: &str,
        created: &str,
    ) -> Result<Comment> {
        new.check()?;
        if self.doc.items().len() >= MAX_COMMENTS {
            return Err(Error::Invalid(format!(
                "A page keeps at most {MAX_COMMENTS} comments"
            )));
        }
        let mut item = Map::new();
        item.insert("id".to_owned(), id.into());
        item.insert("anchor".to_owned(), anchor_value(&new.anchor, Map::new()));
        item.insert("text".to_owned(), new.text.trim().into());
        item.insert("author".to_owned(), author.into());
        item.insert("created".to_owned(), created.into());
        let item = Value::Object(item);
        let added = comment_of(&item).ok_or_else(|| {
            Error::Invalid(
                "A comment's id is letters, digits, - and _, at most 64 characters".to_owned(),
            )
        })?;
        self.doc.items_mut().push(item);
        Ok(added)
    }

    /// Marks comment `id` resolved by `by` at `at`, or open again with None.
    /// Returns the comment and whether anything changed.
    pub fn resolve(&mut self, id: &str, resolved: Option<(&str, &str)>) -> Result<(Comment, bool)> {
        let item = self.doc.find_mut(id, "comment")?;
        let was = item.get("resolved").is_some_and(|r| !r.is_null());
        let changed = match resolved {
            // Resolving what is resolved keeps who and when.
            Some(_) if was => false,
            Some((at, by)) => {
                let mut r = Map::new();
                r.insert("at".to_owned(), at.into());
                r.insert("by".to_owned(), by.into());
                item.insert("resolved".to_owned(), Value::Object(r));
                true
            }
            None if was => {
                item.shift_remove("resolved");
                true
            }
            None => false,
        };
        Ok((read_back(item, id)?, changed))
    }

    /// Gives comment `id` another place. Returns the comment and whether
    /// anything changed.
    pub fn reanchor(&mut self, id: &str, anchor: &Anchor) -> Result<(Comment, bool)> {
        anchor.check()?;
        let item = self.doc.find_mut(id, "comment")?;
        let old = item
            .get("anchor")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let new = anchor_value(anchor, old);
        let changed = item.get("anchor") != Some(&new);
        item.insert("anchor".to_owned(), new);
        Ok((read_back(item, id)?, changed))
    }
}

/// The JSON of an anchor, keeping the keys `old` has that this does not know.
fn anchor_value(anchor: &Anchor, mut old: Map<String, Value>) -> Value {
    old.insert("section".to_owned(), anchor.section.clone().into());
    old.insert("nth".to_owned(), anchor.nth.into());
    for (key, value) in [
        ("quote", &anchor.quote),
        ("prefix", &anchor.prefix),
        ("suffix", &anchor.suffix),
    ] {
        match value {
            Some(text) => {
                old.insert(key.to_owned(), text.clone().into());
            }
            None => {
                old.shift_remove(key);
            }
        }
    }
    Value::Object(old)
}

/// The comment as an entry now reads, or why another tool's entry cannot be read.
fn read_back(item: &Map<String, Value>, id: &str) -> Result<Comment> {
    comment_of(&Value::Object(item.clone())).ok_or_else(|| {
        Error::Invalid(format!(
            "The comment {id} is saved in a form KastenFlow cannot read"
        ))
    })
}
