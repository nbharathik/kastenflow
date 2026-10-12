//! Sources and their highlights: PDFs
//! in `sources/`, each with a sidecar `<name>.highlights.json` of the
//! passages marked in it. A sidecar is kept as parsed JSON, so keys Kasten
//! does not know survive in their order, and is written in the boards'
//! house style with one highlight per line. Rectangles are in PDF user
//! space: `[x1, y1, x2, y2]` in points from the page's bottom left, as
//! pdf.js converts them.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::error::{Error, Result};

/// The colours a highlight comes in.
pub const COLORS: [&str; 5] = ["yellow", "green", "blue", "pink", "purple"];

/// The largest PDF kept as a source: bigger ones belong outside the
/// vault's history.
pub const MAX_SOURCE_BYTES: usize = 100 * 1024 * 1024;

/// The longest quote or comment a highlight keeps.
const MAX_TEXT: usize = 20_000;
/// The most rectangles one highlight covers.
const MAX_RECTS: usize = 1_000;

/// A highlight as the app shows it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Highlight {
    pub id: String,
    /// From 1.
    pub page: u32,
    pub rects: Vec<[f64; 4]>,
    /// The quoted text, as selected.
    pub text: String,
    pub color: String,
    pub comment: Option<String>,
    /// The id of its highlight card, once made.
    pub card_id: Option<String>,
    pub created: Option<String>,
    /// The path of its card, while that note exists.
    pub card: Option<String>,
}

/// A highlight to add.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewHighlight {
    pub page: u32,
    pub rects: Vec<[f64; 4]>,
    pub text: String,
    pub color: String,
    #[serde(default)]
    pub comment: Option<String>,
}

/// A change to a highlight: each field given replaces the old value; an
/// empty comment removes it.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HighlightEdit {
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub comment: Option<String>,
}

/// A PDF in `sources/`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    pub path: String,
    /// The name it was imported under, or its file name.
    pub title: String,
    /// How many highlights it has.
    pub highlights: usize,
    pub bytes: u64,
    /// Milliseconds since the Unix epoch.
    pub modified: u64,
}

/// A source and its highlights, in the order they were made.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceHighlights {
    pub source: SourceInfo,
    pub highlights: Vec<Highlight>,
}

/// The sidecar of the PDF at `source`: `sources/x.pdf` has
/// `sources/x.highlights.json`.
pub fn sidecar_of(source: &str) -> Result<String> {
    let lower = source.to_ascii_lowercase();
    if !lower.starts_with("sources/") || !lower.ends_with(".pdf") {
        return Err(Error::InvalidPath(source.to_owned()));
    }
    Ok(format!("{}.highlights.json", &source[..source.len() - 4]))
}

/// `text` on one line: every run of white space or control characters as
/// one space.
pub fn one_line(text: &str) -> String {
    text.split(|c: char| c.is_whitespace() || c.is_control())
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// `text` on one line; over `max` characters, the whole words that fit in
/// `cut` and an ellipsis.
pub fn shortened(text: &str, max: usize, cut: usize) -> String {
    let line = one_line(text);
    if line.chars().count() <= max {
        return line;
    }
    let mut head = String::new();
    for word in line.split(' ') {
        let len = head.chars().count() + usize::from(!head.is_empty()) + word.chars().count();
        if len > cut {
            break;
        }
        if !head.is_empty() {
            head.push(' ');
        }
        head.push_str(word);
    }
    if head.is_empty() {
        head = line.chars().take(cut).collect();
    }
    format!("{}…", head.trim_end_matches([',', ';', ':', '-', '–', '—']))
}

fn round(n: f64) -> f64 {
    (n * 100.0).round() / 100.0
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

fn check_text(what: &str, text: &str) -> Result<()> {
    if text.chars().count() > MAX_TEXT {
        return Err(Error::Invalid(format!(
            "A highlight's {what} is at most {MAX_TEXT} characters"
        )));
    }
    Ok(())
}

impl NewHighlight {
    /// Why it cannot be kept, if it cannot.
    pub fn check(&self) -> Result<()> {
        if self.page == 0 {
            return Err(Error::Invalid("Pages count from 1".into()));
        }
        if self.rects.is_empty() || self.rects.len() > MAX_RECTS {
            return Err(Error::Invalid(format!(
                "A highlight covers 1 to {MAX_RECTS} rectangles"
            )));
        }
        if self.rects.iter().flatten().any(|n| !n.is_finite()) {
            return Err(Error::Invalid(
                "A highlight's rectangles need numbers".into(),
            ));
        }
        if self.text.trim().is_empty() {
            return Err(Error::Invalid("A highlight needs the text it marks".into()));
        }
        check_text("text", &self.text)?;
        check_text("comment", self.comment.as_deref().unwrap_or(""))?;
        check_color(&self.color)
    }
}

/// A sidecar: the document as read, with its `highlights` array.
#[derive(Debug, Clone, PartialEq)]
pub struct Sidecar {
    doc: Map<String, Value>,
}

fn field<'a>(item: &'a Value, key: &str) -> Option<&'a str> {
    item.get(key).and_then(Value::as_str)
}

/// A highlight from its JSON; None for an entry without an id or page.
/// Whether a highlight id can go into a card's frontmatter and link as it
/// is: letters, digits, `-` and `_`. Other tools write sidecars too.
fn plain_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn highlight_of(item: &Value) -> Option<Highlight> {
    let id = field(item, "id").filter(|id| plain_id(id))?.to_owned();
    let page = u32::try_from(item.get("page")?.as_u64()?).ok()?;
    let rects = item
        .get("rects")
        .and_then(Value::as_array)
        .map(|all| {
            all.iter()
                .filter_map(|rect| {
                    let n: Vec<f64> = rect.as_array()?.iter().filter_map(Value::as_f64).collect();
                    <[f64; 4]>::try_from(n).ok()
                })
                .collect()
        })
        .unwrap_or_default();
    let text_of = |key: &str| field(item, key).map(str::to_owned);
    Some(Highlight {
        id,
        page,
        rects,
        text: text_of("text").unwrap_or_default(),
        color: text_of("color").unwrap_or_else(|| COLORS[0].to_owned()),
        comment: text_of("comment"),
        card_id: text_of("card_id"),
        created: text_of("created"),
        card: None,
    })
}

impl Sidecar {
    /// An empty sidecar for a source called `title`.
    pub fn new(title: &str) -> Sidecar {
        let mut doc = Map::new();
        doc.insert("title".to_owned(), title.into());
        doc.insert("highlights".to_owned(), Value::Array(Vec::new()));
        Sidecar { doc }
    }

    /// A sidecar in any JSON formatting; it needs to be an object, and a
    /// `highlights` array is added when it has none.
    pub fn parse(text: &str) -> Result<Sidecar> {
        let bad = |why: String| Error::Invalid(format!("Not a highlights file: {why}"));
        let value: Value = serde_json::from_str(text).map_err(|err| bad(err.to_string()))?;
        let Value::Object(mut doc) = value else {
            return Err(bad("the top level is not an object".into()));
        };
        match doc.get("highlights") {
            Some(Value::Array(_)) => {}
            Some(_) => return Err(bad("`highlights` is not an array".into())),
            None => {
                doc.insert("highlights".to_owned(), Value::Array(Vec::new()));
            }
        }
        Ok(Sidecar { doc })
    }

    /// The sidecar in house style.
    pub fn to_text(&self) -> String {
        crate::board::json_document(&self.doc, &["highlights"])
    }

    pub fn title(&self) -> Option<&str> {
        self.doc
            .get("title")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|title| !title.is_empty())
    }

    fn items(&self) -> &[Value] {
        match self.doc.get("highlights") {
            Some(Value::Array(items)) => items,
            _ => &[],
        }
    }

    fn items_mut(&mut self) -> &mut Vec<Value> {
        match self
            .doc
            .entry("highlights")
            .or_insert_with(|| Value::Array(Vec::new()))
        {
            Value::Array(items) => items,
            _ => unreachable!("parse and new keep an array here"),
        }
    }

    /// Every highlight that has an id and a page, in order.
    pub fn highlights(&self) -> Vec<Highlight> {
        self.items().iter().filter_map(highlight_of).collect()
    }

    fn find_mut(&mut self, id: &str) -> Result<&mut Map<String, Value>> {
        self.items_mut()
            .iter_mut()
            .filter_map(Value::as_object_mut)
            .find(|item| item.get("id").and_then(Value::as_str) == Some(id))
            .ok_or_else(|| Error::Invalid(format!("No highlight {id} in this source")))
    }

    /// Adds `new` as highlight `id`, made at `created`.
    pub fn add(&mut self, id: &str, new: &NewHighlight, created: &str) -> Result<Highlight> {
        new.check()?;
        let mut item = Map::new();
        item.insert("id".to_owned(), id.into());
        item.insert("page".to_owned(), new.page.into());
        let rects: Vec<Value> = new
            .rects
            .iter()
            .map(|rect| Value::from(rect.iter().map(|n| round(*n)).collect::<Vec<f64>>()))
            .collect();
        item.insert("rects".to_owned(), Value::Array(rects));
        item.insert("text".to_owned(), new.text.clone().into());
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
        let added = highlight_of(&item).expect("made with an id and a page");
        self.items_mut().push(item);
        Ok(added)
    }

    /// Changes highlight `id` as `edit` says.
    pub fn edit(&mut self, id: &str, edit: &HighlightEdit) -> Result<Highlight> {
        if let Some(color) = &edit.color {
            check_color(color)?;
        }
        if let Some(comment) = &edit.comment {
            check_text("comment", comment)?;
        }
        let item = self.find_mut(id)?;
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
        // Another tool may have written the highlight in a way it cannot read.
        highlight_of(&Value::Object(item.clone())).ok_or_else(|| {
            Error::Invalid(format!(
                "The highlight {id} is saved in a form KastenFlow cannot read"
            ))
        })
    }

    /// Notes the card made from highlight `id`.
    pub fn set_card(&mut self, id: &str, card_id: &str) -> Result<()> {
        self.find_mut(id)?
            .insert("card_id".to_owned(), card_id.into());
        Ok(())
    }

    /// Takes highlight `id` out; its card, if any, stays.
    pub fn remove(&mut self, id: &str) -> Result<Highlight> {
        let items = self.items_mut();
        let at = items
            .iter()
            .position(|item| field(item, "id") == Some(id))
            .ok_or_else(|| Error::Invalid(format!("No highlight {id} in this source")))?;
        let gone = items.remove(at);
        highlight_of(&gone)
            .ok_or_else(|| Error::Invalid(format!("No highlight {id} in this source")))
    }
}

#[cfg(test)]
mod tests;
