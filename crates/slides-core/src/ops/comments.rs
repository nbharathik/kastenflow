//! Comments on a deck: a note on a slide, on an element or at a point, an answer
//! to it, and settling it. Each is one operation on the slide that holds the
//! comment, so each is one step to undo, and nothing is ever removed: a
//! settled comment is marked, and can be opened again.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::util::slide_mut;
use super::{Cx, Op, Scope, op_types};
use crate::error::{Error, Result};
use crate::ids::IdGen;
use crate::model::{CommentPin, Deck, DeckComment, DeckCommentReply, is_false};

/// The prefix of the ids of comments and replies.
const COMMENT: &str = "c-";
/// The longest a comment or a reply is, in characters.
pub const LONGEST_COMMENT: usize = 4000;
/// The longest an author's name is, in characters.
const LONGEST_AUTHOR: usize = 80;
/// What an author is called when the host names nobody.
const SOMEONE: &str = "Someone";
const ASSISTANT: &str = "Assistant";

fn yes() -> bool {
    true
}

/// The words of a comment, trimmed, or why they cannot be kept.
fn clean_text(text: &str) -> Result<String> {
    let text = text.trim();
    if text.is_empty() {
        return Err(Error::invalid("A comment needs some words."));
    }
    if text.chars().count() > LONGEST_COMMENT {
        return Err(Error::invalid(format!(
            "A comment is at most {LONGEST_COMMENT} characters."
        )));
    }
    Ok(text.to_owned())
}

/// Who wrote it: the name given, or the one a person or an assistant goes by.
fn author_of(given: Option<&str>, agent: bool) -> Result<String> {
    let name = given.map(str::trim).filter(|n| !n.is_empty());
    match name {
        Some(n) if n.chars().count() > LONGEST_AUTHOR => Err(Error::invalid(format!(
            "An author's name is at most {LONGEST_AUTHOR} characters."
        ))),
        Some(n) => Ok(n.to_owned()),
        None if agent => Ok(ASSISTANT.to_owned()),
        None => Ok(SOMEONE.to_owned()),
    }
}

fn id_taken(deck: &Deck, id: &str) -> bool {
    deck.slides
        .iter()
        .any(|s| s.comments.iter().any(|c| c.holds_id(id)))
}

fn fresh_id(deck: &Deck, ids: &mut IdGen) -> String {
    ids.fresh(COMMENT, |candidate| id_taken(deck, candidate))
}

/// The id of the slide that holds the comment `id`, as a scope; nothing when no slide does.
fn scope_of(deck: &Deck, comment: &str) -> Scope {
    deck.slides
        .iter()
        .find(|s| s.comments.iter().any(|c| c.id == comment))
        .map_or_else(Scope::default, |s| Scope::slide(&s.id))
}

fn no_comment(id: &str) -> Error {
    Error::invalid(format!(
        "There is no comment `{id}`. get_deck or list_deck_comments shows the ids."
    ))
}

op_types! {
    /// Leaves a comment on a slide, on one of its elements, or at a point of it.
    pub struct AddDeckComment {
        pub slide: String,
        /// The element it is about.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub element: Option<String>,
        /// A point on the slide in slide units; give `x` and `y` together.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub x: Option<f64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub y: Option<f64>,
        pub text: String,
        /// A person's name, or an assistant's.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub author: Option<String>,
        /// Written by an assistant.
        #[serde(default, skip_serializing_if = "is_false")]
        pub agent: bool,
        /// When, as UTC text such as `2026-11-02T09:30:00Z`; the host fills it in.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub at: Option<String>,
    }

    pub struct AddedComment {
        pub comment: String,
    }

    /// Answers a comment.
    pub struct ReplyDeckComment {
        pub comment: String,
        pub text: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub author: Option<String>,
        #[serde(default, skip_serializing_if = "is_false")]
        pub agent: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub at: Option<String>,
    }

    pub struct AddedReply {
        pub reply: String,
    }

    /// Settles a comment, or opens it again.
    pub struct ResolveDeckComment {
        pub comment: String,
        /// `true` (the default) settles it; `false` opens it again.
        #[serde(default = "yes")]
        pub resolved: bool,
    }
}

impl Op for AddDeckComment {
    type Output = AddedComment;
    const NAME: &'static str = "add_deck_comment";
    const ABOUT: &'static str = "Leave a comment on a slide, to point something out without changing it. Give `element` to pin it to an element, or `x` and `y` (slide units) to pin it at a point; with neither it is about the whole slide. Shown in the Comments panel and as markers, never when presenting or exporting. Answer with reply_deck_comment, settle with resolve_deck_comment.";

    fn scope(&self, _: &Deck) -> Scope {
        Scope::slide(&self.slide)
    }

    fn run(self, cx: &mut Cx) -> Result<AddedComment> {
        let text = clean_text(&self.text)?;
        let author = author_of(self.author.as_deref(), self.agent)?;
        let pin = match (self.x, self.y) {
            (None, None) => None,
            (Some(x), Some(y)) if x.is_finite() && y.is_finite() => Some(CommentPin {
                x,
                y,
                extra: Default::default(),
            }),
            _ => {
                return Err(Error::invalid(
                    "A point needs both `x` and `y`, as numbers of slide units.",
                ));
            }
        };
        if self.slide.is_empty() || cx.deck.slide(&self.slide).is_none() {
            return Err(Error::no_slide(&self.slide));
        }
        if let Some(element) = &self.element
            && cx
                .deck
                .slide(&self.slide)
                .is_some_and(|s| s.element(element).is_none())
        {
            return Err(Error::no_element(&self.slide, element));
        }
        let id = fresh_id(cx.deck, cx.ids);
        let comment = DeckComment {
            id: id.clone(),
            element: self.element,
            pin,
            author,
            agent: self.agent,
            text,
            created: self.at.unwrap_or_default(),
            resolved: false,
            replies: Vec::new(),
            extra: Default::default(),
        };
        slide_mut(cx.deck, &self.slide)?.comments.push(comment);
        Ok(AddedComment { comment: id })
    }
}

impl Op for ReplyDeckComment {
    type Output = AddedReply;
    const NAME: &'static str = "reply_deck_comment";
    const ABOUT: &'static str = "Answer a comment (see list_deck_comments for the ids). The answer goes under it, after the others.";

    fn scope(&self, deck: &Deck) -> Scope {
        scope_of(deck, &self.comment)
    }

    fn run(self, cx: &mut Cx) -> Result<AddedReply> {
        let text = clean_text(&self.text)?;
        let author = author_of(self.author.as_deref(), self.agent)?;
        let id = fresh_id(cx.deck, cx.ids);
        let comment = cx
            .deck
            .slides
            .iter_mut()
            .flat_map(|s| s.comments.iter_mut())
            .find(|c| c.id == self.comment)
            .ok_or_else(|| no_comment(&self.comment))?;
        comment.replies.push(DeckCommentReply {
            id: id.clone(),
            author,
            agent: self.agent,
            text,
            created: self.at.unwrap_or_default(),
            extra: Default::default(),
        });
        Ok(AddedReply { reply: id })
    }
}

impl Op for ResolveDeckComment {
    type Output = ();
    const NAME: &'static str = "resolve_deck_comment";
    const ABOUT: &'static str = "Settle a comment once what it asks has been done, or open it again with `resolved: false`. The comment and its answers stay.";

    fn scope(&self, deck: &Deck) -> Scope {
        scope_of(deck, &self.comment)
    }

    fn run(self, cx: &mut Cx) -> Result<()> {
        let comment = cx
            .deck
            .slides
            .iter_mut()
            .flat_map(|s| s.comments.iter_mut())
            .find(|c| c.id == self.comment)
            .ok_or_else(|| no_comment(&self.comment))?;
        comment.resolved = self.resolved;
        Ok(())
    }
}
