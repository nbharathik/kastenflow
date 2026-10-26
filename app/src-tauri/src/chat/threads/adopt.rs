//! Bringing a saved thread back can fail, and the window is told how, in a
//! form it can act on: `adoptFailed` with the reason, so it can offer to try
//! again or to start a new chat. A saved chat is never swapped for an empty
//! one without the person knowing.

use std::fmt;

use serde::Serialize;

use crate::chat::store::Unloaded;

/// Why a saved thread was not brought back.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AdoptReason {
    /// No saved chat has that name.
    Missing,
    /// Its file does not read; it has been set aside, not deleted.
    Damaged,
    /// A newer KastenFlow wrote it.
    Newer,
}

/// What `chat_load` answers with when it cannot give the thread back. The
/// window gets `{"kind": "adoptFailed", "reason": ..., "message": ...}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoptFailed {
    /// Always `adoptFailed`, to tell it from the plain sentences other commands give.
    pub kind: &'static str,
    pub reason: AdoptReason,
    /// One plain sentence for the person.
    pub message: String,
}

impl AdoptFailed {
    pub fn new(reason: AdoptReason) -> AdoptFailed {
        let message = match reason {
            AdoptReason::Missing => "This chat is not saved on this computer any more",
            AdoptReason::Damaged => "This chat's file could not be read",
            AdoptReason::Newer => "This chat was saved by a newer KastenFlow",
        };
        AdoptFailed {
            kind: "adoptFailed",
            reason,
            message: message.to_owned(),
        }
    }
}

impl From<Unloaded> for AdoptFailed {
    fn from(why: Unloaded) -> AdoptFailed {
        AdoptFailed::new(match why {
            Unloaded::Missing => AdoptReason::Missing,
            Unloaded::Damaged => AdoptReason::Damaged,
            Unloaded::Newer => AdoptReason::Newer,
        })
    }
}

impl fmt::Display for AdoptFailed {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}
