//! What a saved thread is on disk: the whole record, and the short head
//! that the thread list reads without opening the conversation.

use kasten_core::agent::Session;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::chat::WriteMode;
use crate::chat::binding::Binding;
use crate::chat::capabilities::GenerationSettings;
use crate::chat::model::Message;
use crate::chat::plan::PlanItem;

/// The file format's version. A file of a newer version is left alone.
pub const VERSION: u32 = 1;
/// The most the window's own snapshot of a thread may be.
pub const MAX_UI_BYTES: usize = 5 * 1024 * 1024;

/// Where a thread is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    /// Nothing is running and nothing waits.
    #[default]
    Idle,
    /// A turn is working.
    Running,
    /// A turn is ready and waits for another chat to finish: as many chats
    /// are working as `chat.max_concurrent` allows.
    Waiting,
    /// A turn stopped on a budget, a loop or a length limit and can go on.
    Paused,
    /// A turn was working when the app closed; it can go on.
    Interrupted,
    /// The last turn failed.
    Error,
}

impl Status {
    /// A turn was under way: found so with nothing working, the app closed on it.
    pub fn was_working(self) -> bool {
        matches!(self, Status::Running | Status::Waiting)
    }

    /// Whether Continue makes sense.
    pub fn can_continue(self) -> bool {
        matches!(self, Status::Paused | Status::Interrupted | Status::Error)
    }
}

/// A thread as it is saved: the conversation as the model has it, the
/// window's own picture of it, and what is needed to go on.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub version: u32,
    pub id: String,
    pub title: String,
    pub created: u64,
    pub updated: u64,
    pub status: Status,
    pub provider: String,
    pub model: String,
    #[serde(default)]
    pub settings: Option<GenerationSettings>,
    #[serde(default)]
    pub writes: WriteMode,
    pub session: Session,
    pub system: String,
    /// The day the system prompt names.
    #[serde(default)]
    pub day: String,
    pub messages: Vec<Message>,
    #[serde(default)]
    pub plan: Vec<PlanItem>,
    /// The last event number given in this thread.
    #[serde(default)]
    pub seq: u64,
    /// The staged changes' set, in the vault's cache.
    #[serde(default)]
    pub change_set: Option<String>,
    /// What the window sent with `chat_save_ui`.
    #[serde(default)]
    pub ui: Option<Value>,
    /// Attachments the conversation refers to.
    #[serde(default)]
    pub attachments: Vec<String>,
    /// Older than the list's size: shown under "Archived", never deleted for it.
    #[serde(default)]
    pub archived: bool,
    /// The page, deck, diagram or document the thread is about.
    #[serde(default)]
    pub bound: Option<Binding>,
    /// Which snapshot of the thread this is, so an older one never replaces a
    /// newer one that was written first. Not saved.
    #[serde(skip)]
    pub rev: u64,
}

/// A line of the thread list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSummary {
    pub id: String,
    pub title: String,
    /// Milliseconds since the Unix epoch.
    pub updated: u64,
    pub status: Status,
    pub provider: String,
    pub model: String,
    /// In the head file so the list can show it, and the cap archive, without opening the thread.
    #[serde(default)]
    pub archived: bool,
    /// What the thread is bound to, if anything.
    #[serde(default)]
    pub bound: Option<Binding>,
}

/// The summary and what the store needs to know without the conversation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Head {
    #[serde(flatten)]
    pub summary: ThreadSummary,
    #[serde(default)]
    pub change_set: Option<String>,
    #[serde(default)]
    pub attachments: Vec<String>,
    /// The size of the thread's file.
    #[serde(default)]
    pub bytes: u64,
}

impl Record {
    pub fn summary(&self) -> ThreadSummary {
        ThreadSummary {
            id: self.id.clone(),
            title: self.title.clone(),
            updated: self.updated,
            status: self.status,
            provider: self.provider.clone(),
            model: self.model.clone(),
            archived: self.archived,
            bound: self.bound.clone(),
        }
    }

    pub fn head(&self, bytes: u64) -> Head {
        Head {
            summary: self.summary(),
            change_set: self.change_set.clone(),
            attachments: self.attachments.clone(),
            bytes,
        }
    }
}

/// A title from the first thing the person said: its first line, short.
pub fn title_from(text: &str) -> String {
    let line = text
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or_default();
    match line.char_indices().nth(60) {
        Some((at, _)) => format!("{}…", line[..at].trim_end()),
        None => line.to_owned(),
    }
}

/// Whether `id` can be a thread's file name: letters, digits, `-`, `_` and
/// `.` inside; not a name Windows keeps for devices.
pub fn valid_id(id: &str) -> bool {
    if id.is_empty() || id.len() > 120 || id.starts_with('.') || id.ends_with(".head") {
        return false;
    }
    if !id
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
    {
        return false;
    }
    let stem = id
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    let device = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ["COM", "LPT"].iter().any(|p| {
            stem.strip_prefix(p)
                .is_some_and(|n| n.len() == 1 && n != "0")
        });
    !device
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_plain_file_names() {
        for good in ["chat-abc123", "slides_deck.1", "a"] {
            assert!(valid_id(good), "{good}");
        }
        for bad in [
            "",
            ".hidden",
            "a/b",
            "a\\b",
            "a b",
            "..",
            "con",
            "NUL.x",
            "com1",
            "lpt9",
            &"x".repeat(121),
        ] {
            assert!(!valid_id(bad), "{bad}");
        }
        assert!(valid_id("com10") && valid_id("console"));
    }

    #[test]
    fn a_title_is_the_first_line_of_what_was_said() {
        assert_eq!(title_from("  \n\nPlan my week\nsecond"), "Plan my week");
        assert!(title_from(&"w".repeat(100)).ends_with('…'));
        assert_eq!(title_from(""), "");
    }
}
