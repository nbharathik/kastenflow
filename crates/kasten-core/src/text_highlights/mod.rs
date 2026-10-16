//! Highlights on a captured web page, kept in a sidecar file beside its card.
//!
//! The highlights on `inbox/an-article.md` are in
//! `inbox/an-article.highlights.json`:
//!
//! ```json
//! {
//!   "format": "kasten-text-highlights",
//!   "highlights": [
//!     {"id": "h-01J9…", "anchor": {"quote": "the part marked", "prefix": "…just before ", "suffix": " just after…", "section": "Method"}, "color": "yellow", "comment": "check this", "created": "2026-10-10T09:12:00+02:00"}
//!   ]
//! }
//! ```
//!
//! The colours are the PDF highlights' (`sources::COLORS`). The file is kept
//! as parsed JSON, so keys KastenFlow does not know survive, and written one
//! highlight to a line. A highlight is found again by its quote: the app
//! places it where the quote is the only match, or where what stands around
//! it still matches, and otherwise shows it apart; the text of the card is
//! never touched. Removing a highlight takes it out of the file; history
//! keeps it. A PDF's own highlights file (`sources/x.highlights.json`) is a
//! different thing with the same ending and is never read as this one.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::companions::{HIGHLIGHTS, ListDoc, plain_id};
use crate::error::{Error, Result};
use crate::sources::COLORS;

#[cfg(test)]
mod tests;

/// What the file says it is.
pub const FORMAT: &str = "kasten-text-highlights";
/// The most highlights one page keeps.
pub const MAX_HIGHLIGHTS: usize = 5_000;
/// The longest quote, in characters.
pub const MAX_QUOTE: usize = 5_000;
/// The longest comment, in characters.
pub const MAX_COMMENT: usize = 10_000;
/// The longest context before and after a quote, and section title.
const MAX_CONTEXT: usize = 200;

/// Where a highlight is: the words, what stands around them, and the section
/// they were in.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextAnchor {
    pub quote: String,
    /// The words just before the quote.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prefix: Option<String>,
    /// The words just after the quote.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suffix: Option<String>,
    /// The title of the section the quote was in.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub section: Option<String>,
}

/// A highlight as the app shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextHighlight {
    pub id: String,
    pub anchor: TextAnchor,
    pub color: String,
    pub comment: Option<String>,
    pub created: Option<String>,
}

/// A highlight to add.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewTextHighlight {
    pub anchor: TextAnchor,
    pub color: String,
    #[serde(default)]
    pub comment: Option<String>,
}

/// A change to a highlight: each field given replaces the old value; an
/// empty comment removes it.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextHighlightEdit {
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub comment: Option<String>,
}

/// The highlights file of the page at `note`: `a/b.md` has `a/b.highlights.json`.
pub fn sidecar_of(note: &str) -> Result<String> {
    crate::companions::of(note, HIGHLIGHTS).ok_or_else(|| Error::InvalidPath(note.to_owned()))
}

fn check_color(color: &str) -> Result<()> {
    if COLORS.contains(&color) {
        return Ok(());
    }
    Err(Error::Invalid(format!(
        "A highlight is {}, not {color}",
        COLORS.join(", ")
    )))
}

fn check_comment(comment: &str) -> Result<()> {
    if comment.chars().count() > MAX_COMMENT {
        return Err(Error::Invalid(format!(
            "A highlight's comment is at most {MAX_COMMENT} characters"
        )));
    }
    Ok(())
}

impl TextAnchor {
    /// Why it cannot be kept, if it cannot.
    pub fn check(&self) -> Result<()> {
        if self.quote.trim().is_empty() {
            return Err(Error::Invalid(
                "A highlight needs the words it marks".to_owned(),
            ));
        }
        if self.quote.chars().count() > MAX_QUOTE {
            return Err(Error::Invalid(format!(
                "A highlight marks at most {MAX_QUOTE} characters"
            )));
        }
        for (what, text) in [
            ("context before the quote", &self.prefix),
            ("context after the quote", &self.suffix),
            ("section", &self.section),
        ] {
            if text
                .as_deref()
                .is_some_and(|t| t.chars().count() > MAX_CONTEXT)
            {
                return Err(Error::Invalid(format!(
                    "A highlight's {what} is at most {MAX_CONTEXT} characters"
                )));
            }
        }
        Ok(())
    }
}

impl NewTextHighlight {
    /// Why it cannot be kept, if it cannot.
    pub fn check(&self) -> Result<()> {
        self.anchor.check()?;
        check_color(&self.color)?;
        check_comment(self.comment.as_deref().unwrap_or(""))
    }
}

fn string(item: &Map<String, Value>, key: &str) -> Option<String> {
    item.get(key).and_then(Value::as_str).map(str::to_owned)
}

/// A highlight from its JSON; None for an entry without a usable id or quote.
fn highlight_of(item: &Value) -> Option<TextHighlight> {
    let item = item.as_object()?;
    let id = string(item, "id").filter(|id| plain_id(id))?;
    let at = item.get("anchor")?.as_object()?;
    let quote = string(at, "quote").filter(|q| !q.trim().is_empty())?;
    Some(TextHighlight {
        id,
        anchor: TextAnchor {
            quote,
            prefix: string(at, "prefix"),
            suffix: string(at, "suffix"),
            section: string(at, "section"),
        },
        color: string(item, "color").unwrap_or_else(|| COLORS[0].to_owned()),
        comment: string(item, "comment"),
        created: string(item, "created"),
    })
}

/// A highlights file: the document as read, with its `highlights` array.
#[derive(Debug, Clone, PartialEq)]
pub struct TextHighlights {
    doc: ListDoc,
}

impl Default for TextHighlights {
    fn default() -> Self {
        TextHighlights::new()
    }
}

impl TextHighlights {
    /// An empty file.
    pub fn new() -> TextHighlights {
        TextHighlights {
            doc: ListDoc::new("highlights", FORMAT),
        }
    }

    /// A file in any JSON formatting; it needs to be an object, and a
    /// `highlights` array is added when it has none.
    pub fn parse(text: &str) -> Result<TextHighlights> {
        Ok(TextHighlights {
            doc: ListDoc::parse(text, "highlights", "a text highlights file")?,
        })
    }

    /// The file in house style, a highlight to a line.
    pub fn to_text(&self) -> String {
        self.doc.to_text()
    }

    /// Every highlight that has a usable id and quote, in the order they were made.
    pub fn highlights(&self) -> Vec<TextHighlight> {
        self.doc.items().iter().filter_map(highlight_of).collect()
    }

    /// Adds `new` as highlight `id`, made at `created`.
    pub fn add(
        &mut self,
        id: &str,
        new: &NewTextHighlight,
        created: &str,
    ) -> Result<TextHighlight> {
        new.check()?;
        if self.doc.items().len() >= MAX_HIGHLIGHTS {
            return Err(Error::Invalid(format!(
                "A page keeps at most {MAX_HIGHLIGHTS} highlights"
            )));
        }
        let mut item = Map::new();
        item.insert("id".to_owned(), id.into());
        item.insert("anchor".to_owned(), anchor_value(&new.anchor, Map::new()));
        item.insert("color".to_owned(), new.color.clone().into());
        if let Some(comment) = new
            .comment
            .as_deref()
            .map(str::trim)
            .filter(|c| !c.is_empty())
        {
            item.insert("comment".to_owned(), comment.into());
        }
        item.insert("created".to_owned(), created.into());
        let item = Value::Object(item);
        let added = highlight_of(&item).ok_or_else(|| {
            Error::Invalid(
                "A highlight's id is letters, digits, - and _, at most 64 characters".to_owned(),
            )
        })?;
        self.doc.items_mut().push(item);
        Ok(added)
    }

    /// Changes highlight `id` as `edit` says. Returns it and whether anything changed.
    pub fn edit(&mut self, id: &str, edit: &TextHighlightEdit) -> Result<(TextHighlight, bool)> {
        if let Some(color) = &edit.color {
            check_color(color)?;
        }
        if let Some(comment) = &edit.comment {
            check_comment(comment)?;
        }
        let item = self.doc.find_mut(id, "highlight")?;
        let before = item.clone();
        if let Some(color) = &edit.color {
            item.insert("color".to_owned(), color.clone().into());
        }
        match edit.comment.as_deref().map(str::trim) {
            Some("") => {
                item.shift_remove("comment");
            }
            Some(comment) => {
                item.insert("comment".to_owned(), comment.into());
            }
            None => {}
        }
        let changed = *item != before;
        Ok((read_back(item, id)?, changed))
    }

    /// Gives highlight `id` another place. Returns it and whether anything changed.
    pub fn relocate(&mut self, id: &str, anchor: &TextAnchor) -> Result<(TextHighlight, bool)> {
        anchor.check()?;
        let item = self.doc.find_mut(id, "highlight")?;
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

    /// Takes highlight `id` out of the file.
    pub fn remove(&mut self, id: &str) -> Result<TextHighlight> {
        let items = self.doc.items_mut();
        let at = items
            .iter()
            .position(|item| item.get("id").and_then(Value::as_str) == Some(id))
            .ok_or_else(|| Error::Invalid(format!("No highlight {id} on this page")))?;
        let gone = items.remove(at);
        highlight_of(&gone).ok_or_else(|| Error::Invalid(format!("No highlight {id} on this page")))
    }
}

/// The JSON of an anchor, keeping the keys `old` has that this does not know.
fn anchor_value(anchor: &TextAnchor, mut old: Map<String, Value>) -> Value {
    old.insert("quote".to_owned(), anchor.quote.clone().into());
    for (key, value) in [
        ("prefix", &anchor.prefix),
        ("suffix", &anchor.suffix),
        ("section", &anchor.section),
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

/// The highlight as an entry now reads, or why another tool's entry cannot be read.
fn read_back(item: &Map<String, Value>, id: &str) -> Result<TextHighlight> {
    highlight_of(&Value::Object(item.clone())).ok_or_else(|| {
        Error::Invalid(format!(
            "The highlight {id} is saved in a form KastenFlow cannot read"
        ))
    })
}
