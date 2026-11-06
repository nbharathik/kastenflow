//! Comments for agents: reading the notes left on a deck, and what a tool adds
//! to the ones an assistant writes (that an assistant wrote them, and when).

use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};

use super::read::slide_id;
use super::session::Agent;
use super::store::Store;
use super::{ToolError, ToolOutput, ToolResult};
use crate::model::{DeckComment, DeckCommentReply};

/// The operations whose input an assistant's tool call is made to say it came from an assistant.
const WRITING: &[&str] = &["add_deck_comment", "reply_deck_comment"];

/// UTC text such as `2026-11-02T09:30:00Z` for seconds since 1970.
pub(super) fn utc_text(seconds: u64) -> String {
    let days = i64::try_from(seconds / 86_400).unwrap_or(0);
    let rest = seconds % 86_400;
    // Days to a civil date (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * shifted_month + 2) / 5 + 1;
    let month = if shifted_month < 10 {
        shifted_month + 3
    } else {
        shifted_month - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rest / 3_600,
        rest % 3_600 / 60,
        rest % 60
    )
}

/// The time now, as UTC text; empty if the clock says it is before 1970.
fn now_utc() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| utc_text(d.as_secs()))
        .unwrap_or_default()
}

/// Makes the input of a comment operation what an assistant's is: marked as written by an assistant, and dated.
pub(super) fn mark_as_assistants(op: &str, input: &mut Value) {
    if !WRITING.contains(&op) {
        return;
    }
    if let Some(map) = input.as_object_mut() {
        map.insert("agent".to_owned(), Value::Bool(true));
        let dated = map
            .get("at")
            .and_then(Value::as_str)
            .is_some_and(|at| !at.trim().is_empty());
        if !dated {
            map.insert("at".to_owned(), Value::String(now_utc()));
        }
    }
}

fn reply_json(reply: &DeckCommentReply) -> Value {
    json!({ "id": reply.id, "author": reply.author, "agent": reply.agent, "text": reply.text, "created": reply.created })
}

fn comment_json(slide: &str, number: usize, comment: &DeckComment) -> Value {
    json!({
        "id": comment.id,
        "slide": slide,
        "slideNumber": number,
        "element": comment.element,
        "pin": comment.pin.as_ref().map(|p| json!({ "x": p.x, "y": p.y })),
        "author": comment.author,
        "agent": comment.agent,
        "text": comment.text,
        "created": comment.created,
        "resolved": comment.resolved,
        "replies": comment.replies.iter().map(reply_json).collect::<Vec<_>>(),
    })
}

pub fn list_deck_comments(agent: &mut Agent, store: &mut dyn Store, args: &Value) -> ToolResult {
    let name = agent.deck_name(store, args)?;
    let (_, deck) = agent.read(store, &name)?;
    let only = match args.get("slide") {
        Some(given) if !given.is_null() => Some(slide_id(&deck, given)?),
        _ => None,
    };
    let status = args.get("status").and_then(Value::as_str).unwrap_or("all");
    if !["all", "open", "resolved"].contains(&status) {
        return Err(ToolError::new(
            "`status` is `open`, `resolved` or `all` (the default).",
        ));
    }
    let mut listed = Vec::new();
    let (mut open, mut resolved) = (0, 0);
    for (n, slide) in deck.slides.iter().enumerate() {
        for comment in &slide.comments {
            if comment.resolved {
                resolved += 1;
            } else {
                open += 1;
            }
            let wanted = only.as_deref().is_none_or(|id| id == slide.id)
                && match status {
                    "open" => !comment.resolved,
                    "resolved" => comment.resolved,
                    _ => true,
                };
            if wanted {
                listed.push(comment_json(&slide.id, n + 1, comment));
            }
        }
    }
    Ok(ToolOutput::json(json!({
        "deck": name,
        "open": open,
        "resolved": resolved,
        "comments": listed,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seconds_become_utc_text_across_a_leap_day_and_a_new_year() {
        assert_eq!(utc_text(0), "1970-01-01T00:00:00Z");
        assert_eq!(utc_text(1_709_208_000), "2024-02-29T12:00:00Z");
        assert_eq!(utc_text(1_793_611_800), "2026-11-02T09:30:00Z");
        assert_eq!(utc_text(1_798_761_599), "2026-12-31T23:59:59Z");
        assert_eq!(utc_text(1_798_761_600), "2027-01-01T00:00:00Z");
    }

    #[test]
    fn an_assistants_comment_is_marked_and_dated_whatever_it_said() {
        let mut input = json!({ "slide": "s-1", "text": "x", "agent": false });
        mark_as_assistants("add_deck_comment", &mut input);
        assert_eq!(input["agent"], true);
        assert!(input["at"].as_str().is_some_and(|at| at.ends_with('Z')));
        let mut dated = json!({ "comment": "c-1", "text": "x", "at": "2026-01-01T00:00:00Z" });
        mark_as_assistants("reply_deck_comment", &mut dated);
        assert_eq!(dated["at"], "2026-01-01T00:00:00Z");
        let mut other = json!({ "comment": "c-1" });
        mark_as_assistants("resolve_deck_comment", &mut other);
        assert_eq!(other, json!({ "comment": "c-1" }));
    }
}
