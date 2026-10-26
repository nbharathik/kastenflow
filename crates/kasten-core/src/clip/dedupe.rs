//! A page saved more than once: what is already kept from an address, so a
//! person is told before a second copy is made, and the way to keep one on
//! purpose (a snapshot that points back at the first card, which is never
//! touched).

use serde::Serialize;

use super::address::url_key;
use super::capture::{Preview, WebCapture};
use crate::engine::Kasten;
use crate::error::{Error, Result};
use crate::note::NoteMeta;

/// A note already kept from the same page.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Existing {
    pub path: String,
    pub title: String,
    /// The day it was captured (`YYYY-MM-DD`), when the note says.
    pub captured: Option<String>,
}

/// What a capture would keep, and what is already kept from its page.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturePreview {
    pub preview: Preview,
    /// The notes kept from the same page, the first saved first.
    pub existing: Vec<Existing>,
}

/// The first ten characters of `text`, when they are a day.
fn day_in(text: &str) -> Option<String> {
    text.get(..10)
        .filter(|day| crate::dates::is_real_day(day))
        .map(str::to_owned)
}

impl From<&NoteMeta> for Existing {
    fn from(note: &NoteMeta) -> Existing {
        let captured = note
            .props
            .get("captured")
            .and_then(|v| v.as_str())
            .and_then(day_in)
            .or_else(|| note.created.as_deref().and_then(day_in));
        Existing {
            path: note.path.clone(),
            title: note.title.clone(),
            captured,
        }
    }
}

fn existing_of(note: &NoteMeta) -> Existing {
    Existing::from(note)
}

impl Kasten {
    /// The notes kept from the page at `url`, the first saved first: cards
    /// from a capture or the web clipper, found by `url_key`, so the same
    /// page written another way (http or https, with or without `www.`, a
    /// fragment or tracking parameters) is the same page. None for an
    /// address that is not a web page.
    pub fn captured(&self, url: &str) -> Result<Vec<NoteMeta>> {
        let Some(key) = url_key(url) else {
            return Ok(Vec::new());
        };
        let mut notes = self.index().by_url_key(&key)?;
        // Saved at the same moment, a snapshot still comes after what it
        // is a snapshot of.
        notes.sort_by(|a, b| {
            let snapshot = |n: &NoteMeta| n.props.get("snapshot_of").is_some();
            (a.created.as_deref(), snapshot(a), &a.path).cmp(&(
                b.created.as_deref(),
                snapshot(b),
                &b.path,
            ))
        });
        Ok(notes)
    }

    /// What `capture` would keep, or why it cannot be kept, with the notes
    /// already kept from its page.
    pub fn capture_preview(&self, capture: &WebCapture) -> Result<CapturePreview> {
        let preview: Preview = capture.preview()?;
        let existing = self
            .captured(&capture.url)?
            .iter()
            .map(existing_of)
            .collect();
        Ok(CapturePreview { preview, existing })
    }

    /// The id a snapshot of the note at `reference` (its id or its path)
    /// records: the note's own, or, if it is itself a snapshot, the one it
    /// was taken from. A note with no id is named by its path.
    pub(super) fn snapshot_origin(&self, reference: &str) -> Result<String> {
        let reference = reference.trim();
        let note = {
            let index = self.index();
            match index.note(reference)? {
                Some(note) => Some(note),
                None => match index.by_id(reference)? {
                    Some(path) => index.note(&path)?,
                    None => None,
                },
            }
        };
        let Some(note) = note else {
            return Err(Error::Invalid(
                "The page this is another snapshot of is not there any more".to_owned(),
            ));
        };
        let first = note
            .props
            .get("snapshot_of")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|v| !v.is_empty());
        Ok(first.map(str::to_owned).or(note.id).unwrap_or(note.path))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn note(props: serde_json::Value, created: Option<&str>) -> NoteMeta {
        NoteMeta {
            path: "inbox/a.md".to_owned(),
            id: None,
            title: "A".to_owned(),
            kind: "card".to_owned(),
            icon: None,
            cover: None,
            parent: None,
            project: None,
            tags: Vec::new(),
            modified: 0,
            created: created.map(str::to_owned),
            updated: None,
            excerpt: String::new(),
            words: 0,
            props,
            locked: false,
            children_order: Vec::new(),
        }
    }

    #[test]
    fn the_day_it_was_captured_is_the_property_else_the_creation_day() {
        let day = |props, created| existing_of(&note(props, created)).captured;
        let some = |s: &str| Some(s.to_owned());
        assert_eq!(
            day(
                json!({"captured": "2026-09-01"}),
                Some("2026-10-01T10:00:00Z")
            ),
            some("2026-09-01")
        );
        assert_eq!(
            day(json!({}), Some("2026-10-01T10:00:00Z")),
            some("2026-10-01")
        );
        assert_eq!(
            day(json!({"captured": "soon"}), Some("2026-10-01")),
            some("2026-10-01")
        );
        assert_eq!(day(json!({"captured": "2026-02-30"}), None), None);
        assert_eq!(day(json!({}), None), None);
    }
}
