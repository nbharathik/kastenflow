//! `selection.json`: what the person has selected in the app, shared with a
//! client that asked for it. It is kept in the mailbox's folder, so it is in
//! the cache that no history, backup or git ever takes in, and it follows the
//! mailbox's rules for every file (a plain file, owner-only, written whole or
//! not at all, never read through a link). It holds at most five snippets, each
//! text cut at 20 KB; it is stamped with the app's time, so a file nobody has
//! refreshed for a minute is called out of date; and it goes when the app
//! closes or when no client has asked for two minutes (`Sharing`).

use serde::{Deserialize, Serialize};

use super::call::inside_the_vault;
use super::files::{Found, Mailbox};
use super::{MAX_SELECTION_BYTES, MAX_SNIPPET_TEXT, MAX_SNIPPETS, SELECTION_STALE_MS};
use crate::error::{Error, Result};

/// What kinds of place a snippet may come from.
pub const SOURCES: [&str; 4] = ["page", "pdf", "slide", "latex"];
/// The most element ids one snippet names, and the longest id.
const MAX_ELEMENTS: usize = 50;
const MAX_ID_CHARS: usize = 100;
/// The longest title or heading kept.
const MAX_TITLE_CHARS: usize = 200;

/// Where a snippet sits in its text, in characters.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Span {
    pub from: u64,
    pub to: u64,
}

/// One piece of selected text, or the elements selected on a slide.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Snippet {
    /// `page`, `pdf`, `slide` or `latex`.
    pub kind: String,
    /// The page, PDF, deck or LaTeX file, as a vault path.
    pub path: String,
    /// Its name, as the person sees it.
    pub title: String,
    /// The heading it sits under, when it sits under one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub heading: Option<String>,
    /// Where it is in the text, when the place can say.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub range: Option<Span>,
    /// The ids of the selected elements, for a slide.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub elements: Vec<String>,
    /// The selected words (cut at 20 KB).
    #[serde(default)]
    pub text: String,
    /// The text was cut.
    #[serde(default, skip_serializing_if = "is_false")]
    pub truncated: bool,
    /// When it was first seen selected (milliseconds since the Unix epoch).
    #[serde(default)]
    pub time: u64,
}

fn is_false(value: &bool) -> bool {
    !*value
}

/// The file: when the app wrote it, and the snippets.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Published {
    /// The app's time when it wrote this (milliseconds since the Unix epoch).
    pub time: u64,
    pub snippets: Vec<Snippet>,
}

/// What reading the selection found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Seen {
    /// The app is not open on this vault.
    AppClosed,
    /// Nothing is selected (or nothing has been shared).
    Nothing,
    /// The file is older than a minute, or from the future.
    OutOfDate,
    Selected(Published),
}

fn cut_chars(text: &str, most: usize) -> String {
    text.trim().chars().take(most).collect()
}

/// `text` cut to at most `most` bytes at a character boundary, and whether it was.
fn cut_bytes(text: &str, most: usize) -> (String, bool) {
    if text.len() <= most {
        return (text.to_owned(), false);
    }
    let mut end = most;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    (text[..end].to_owned(), true)
}

impl Snippet {
    /// The snippet as the file keeps it: a known kind, a plain vault path, short
    /// names, the text cut. None when it is not one worth sharing (an odd kind
    /// or path, or nothing selected). `earlier` are the snippets already
    /// shared: one that is the same as one of them keeps its time.
    fn kept(&self, earlier: &[Snippet], now: u64) -> Option<Snippet> {
        if !SOURCES.contains(&self.kind.as_str()) || inside_the_vault(&self.path).is_err() {
            return None;
        }
        let elements: Vec<String> = self
            .elements
            .iter()
            .map(|id| cut_chars(id, MAX_ID_CHARS))
            .filter(|id| !id.is_empty())
            .take(MAX_ELEMENTS)
            .collect();
        let (text, truncated) = cut_bytes(&self.text, MAX_SNIPPET_TEXT);
        if text.trim().is_empty() && elements.is_empty() {
            return None;
        }
        let mut kept = Snippet {
            kind: self.kind.clone(),
            path: self.path.clone(),
            title: cut_chars(&self.title, MAX_TITLE_CHARS),
            heading: self
                .heading
                .as_deref()
                .map(|h| cut_chars(h, MAX_TITLE_CHARS))
                .filter(|h| !h.is_empty()),
            range: self.range.filter(|r| r.from <= r.to),
            elements,
            text,
            truncated,
            time: 0,
        };
        kept.time = earlier
            .iter()
            .find(|s| {
                Snippet {
                    time: 0,
                    ..(*s).clone()
                } == kept
            })
            .map_or(now, |s| s.time);
        Some(kept)
    }
}

impl Published {
    /// The file for `incoming` snippets at `now`: at most five, each as `kept`
    /// makes it, and no snippet twice.
    pub fn of(incoming: &[Snippet], earlier: &[Snippet], now: u64) -> Published {
        let mut snippets: Vec<Snippet> = Vec::new();
        for snippet in incoming {
            if snippets.len() >= MAX_SNIPPETS {
                break;
            }
            if let Some(kept) = snippet.kept(earlier, now)
                && !snippets.iter().any(|s| {
                    Snippet {
                        time: 0,
                        ..s.clone()
                    } == Snippet {
                        time: 0,
                        ..kept.clone()
                    }
                })
            {
                snippets.push(kept);
            }
        }
        Published {
            time: now,
            snippets,
        }
    }
}

impl Mailbox {
    /// Writes the shared selection: whole or not at all, readable by its owner
    /// alone.
    pub fn write_selection(&self, published: &Published) -> Result<()> {
        let bytes = serde_json::to_vec(published).map_err(|e| Error::Invalid(e.to_string()))?;
        if bytes.len() as u64 > MAX_SELECTION_BYTES {
            return Err(Error::Invalid(
                "That selection is too big to share".to_owned(),
            ));
        }
        self.ensure_dirs()?;
        self.write(&self.selection_path(), &bytes)
    }

    /// What is shared at `now` (milliseconds since the Unix epoch).
    pub fn read_selection(&self, now: u64) -> Seen {
        if self.alive(now).is_none() {
            return Seen::AppClosed;
        }
        let Found::Bytes(bytes) = self.read(&self.selection_path(), MAX_SELECTION_BYTES) else {
            return Seen::Nothing;
        };
        let Ok(published) = serde_json::from_slice::<Published>(&bytes) else {
            return Seen::Nothing;
        };
        let age = now.saturating_sub(published.time);
        if age > SELECTION_STALE_MS || published.time > now + super::ALIVE_MAX_AGE_MS {
            return Seen::OutOfDate;
        }
        if published.snippets.is_empty() {
            return Seen::Nothing;
        }
        Seen::Selected(published)
    }

    /// Stops sharing: the file goes.
    pub fn clear_selection(&self) {
        self.forget(&self.selection_path());
    }
}
