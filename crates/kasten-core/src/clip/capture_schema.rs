//! The tag database a capture is filed under: its columns and views.

use serde_json::{Value, json};

/// The `capture` tag's schema: the page's address, site and day, the
/// triage `status` and the `reading` state a person sets while working
/// through what they saved.
pub(super) fn schema() -> Value {
    json!({
        "color": "blue",
        "properties": [
            {"key": "url", "type": "url"},
            {"key": "site", "type": "text"},
            {"key": "captured", "type": "date"},
            {"key": "status", "type": "select", "options": ["New", "Read", "Filed"]},
            {"key": "reading", "type": "select", "options": ["Unread", "Reading", "Finished"]},
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
