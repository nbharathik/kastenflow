//! What the index finds: search
//! hits, backlinks and the notes that mention a day.

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub path: String,
    pub title: String,
    pub icon: Option<String>,
    /// Text around the first match in the body, or empty for title-only hits.
    pub snippet: String,
    pub score: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Backlink {
    pub path: String,
    pub title: String,
    pub icon: Option<String>,
    /// The line that holds the link.
    pub snippet: String,
}

/// A note that links a day (`[[2026-10-01]]`, as `@` writes it) outside a
/// to-do: what the calendar shows as mentioned on that day.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DayMention {
    pub day: String,
    pub path: String,
    pub title: String,
    pub icon: Option<String>,
    /// `page`, `card`, `journal` or `project`, as `NoteMeta` says it.
    pub kind: String,
    /// The line that holds the link.
    pub snippet: String,
    /// The time (`HH:MM`) written directly after the link, if any.
    pub at: Option<String>,
}
