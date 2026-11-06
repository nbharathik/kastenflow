//! Review and access: the comments left on a slide, and what a slide says
//! about how it is read aloud. Both are optional on a slide and absent from a
//! deck that uses neither, so such a deck is the same bytes as before.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{Extra, is_false};

model! {
    /// A place on a slide, in slide units.
    #[serde(rename_all = "camelCase")]
    pub struct CommentPin {
        pub x: f64,
        pub y: f64,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// An answer under a comment.
    #[serde(rename_all = "camelCase")]
    pub struct DeckCommentReply {
        /// Unique among the deck's comments and replies.
        pub id: String,
        /// A person's name or an assistant's.
        pub author: String,
        /// Written by an assistant, not a person.
        #[serde(default, skip_serializing_if = "is_false")]
        pub agent: bool,
        pub text: String,
        /// When it was written, as UTC text such as `2026-11-02T09:30:00Z`; empty when the host gave no time.
        #[serde(default)]
        pub created: String,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// A note left on a slide, on an element of it, or at a point of it, with the answers to it.
    #[serde(rename_all = "camelCase")]
    pub struct DeckComment {
        /// Unique among the deck's comments and replies.
        pub id: String,
        /// The element it is about; absent when it is about the slide or a point of it.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub element: Option<String>,
        /// The point it is pinned at; absent when it is about the slide or the element as a whole.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub pin: Option<CommentPin>,
        pub author: String,
        /// Written by an assistant, not a person.
        #[serde(default, skip_serializing_if = "is_false")]
        pub agent: bool,
        pub text: String,
        #[serde(default)]
        pub created: String,
        /// Settled. A resolved comment stays and can be reopened.
        #[serde(default, skip_serializing_if = "is_false")]
        pub resolved: bool,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub replies: Vec<DeckCommentReply>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }

    /// What a slide tells a person who cannot see it.
    #[serde(rename_all = "camelCase")]
    pub struct SlideAccess {
        /// A title that is not drawn, for a slide that shows none; a screen reader and the outline use it.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub title: Option<String>,
        /// The ids of the slide's elements in the order they are read, first to last. An element it leaves out is read after these, in the usual order.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub reading_order: Vec<String>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }
}

impl DeckComment {
    /// Whether `id` names this comment or one of its replies.
    pub fn holds_id(&self, id: &str) -> bool {
        self.id == id || self.replies.iter().any(|r| r.id == id)
    }
}
