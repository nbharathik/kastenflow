//! What a turn tells the window: `chat-event`s. Each carries `seq`, a number
//! that grows by one with every event of a chat (and goes on after the chat
//! is restored), so a window that was reloaded can ask for what it missed
//! (`chat_state`). The last 2,000 events of a chat are kept for that.

use std::collections::VecDeque;

use serde::Serialize;
use serde_json::Value;

use super::budget::PauseReason;
use super::errors::FailKind;
use super::plan::PlanItem;

/// The events kept per chat for `chat_state`.
pub const RING: usize = 2000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EventKind {
    Text,
    Tool,
    ToolResult,
    /// The turn is over. A turn ends with exactly one of `done`, `error` and
    /// `paused`.
    Done,
    Error,
    /// Something to know about how the request was made, such as a setting
    /// the model turned down, or (with `code: "retry"`) a connection that
    /// dropped and is being tried again.
    Notice,
    /// The thread's staged changes grew or changed; `changes` says how many.
    Changes,
    /// The model's plan changed; `plan` is the whole list.
    Plan,
    /// The turn stopped on a limit, a loop or an interruption and can go on
    /// with Continue. `reason` says why and `detail` is the sentence to show.
    /// Not an error.
    Paused,
    /// A message sent while the turn works. First `delivered` is false (it is
    /// waiting; `text` is what was sent); when the turn takes it up at the
    /// next step the event comes again with `delivered` true.
    Queued,
    /// A step (a request to the model) began: `n` steps so far in this turn
    /// and `calls` tool calls made.
    Round,
}

/// A tool the model called.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ToolUse {
    pub id: String,
    pub name: String,
    pub input: Value,
}

/// How a tool call went, in words for the person.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResultInfo {
    pub id: String,
    pub ok: bool,
    pub summary: String,
    /// The notes or boards it touched.
    pub paths: Vec<String>,
    /// It was held in the thread's staged changes, not written.
    pub staged: bool,
}

/// What a thread's staged changes come to, for the bar above the composer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangesInfo {
    /// The change set's id.
    pub id: String,
    /// Files changed or made, and pictures added.
    pub count: usize,
    /// Their paths.
    pub paths: Vec<String>,
}

/// One `chat-event`. Per turn: text, tool, toolResult, plan, round and notice
/// events in any mix, then exactly one done, error or paused.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatEvent {
    pub chat: String,
    pub turn: String,
    /// This chat's event number, from 1, one more than the event before.
    pub seq: u64,
    pub kind: EventKind,
    /// For `text`, `notice` and `queued`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<ToolUse>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<ToolResultInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stopped: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// What kind of failure the error is, to offer the way on.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_kind: Option<FailKind>,
    /// For `changes`: the thread's staged changes now.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changes: Option<ChangesInfo>,
    /// For `plan`: the whole plan.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<Vec<PlanItem>>,
    /// For `paused`: why.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<PauseReason>,
    /// For `paused`: the sentence to show.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// For `round`: the steps so far in this turn.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub n: Option<u32>,
    /// For `round`: the tool calls so far in this turn.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub calls: Option<u32>,
    /// For `notice`: what it is about (`retry`), when the window acts on it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    /// For `queued`: whether the turn has taken the message up.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delivered: Option<bool>,
}

impl ChatEvent {
    pub fn new(chat: &str, turn: &str, kind: EventKind) -> ChatEvent {
        ChatEvent {
            chat: chat.to_owned(),
            turn: turn.to_owned(),
            seq: 0,
            kind,
            text: None,
            tool: None,
            result: None,
            stopped: None,
            error: None,
            error_kind: None,
            changes: None,
            plan: None,
            reason: None,
            detail: None,
            n: None,
            calls: None,
            code: None,
            delivered: None,
        }
    }
}

/// Where a turn's events go: the window in the app, a list in tests.
pub trait Events: Send + Sync {
    fn emit(&self, event: ChatEvent);
}

/// A chat's event numbers and its last events.
#[derive(Debug, Default)]
pub struct Log {
    seq: u64,
    ring: VecDeque<ChatEvent>,
}

/// What `chat_state` answers about events.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Since {
    pub events: Vec<ChatEvent>,
    /// Events between `since` and the oldest kept were dropped: the window
    /// should load the saved thread instead.
    pub gap: bool,
}

impl Log {
    /// Gives `event` the next number and keeps it.
    pub fn stamp(&mut self, mut event: ChatEvent) -> ChatEvent {
        self.seq += 1;
        event.seq = self.seq;
        self.ring.push_back(event.clone());
        while self.ring.len() > RING {
            self.ring.pop_front();
        }
        event
    }

    /// The number of the last event.
    pub fn seq(&self) -> u64 {
        self.seq
    }

    /// Makes the next number at least `seq`, so numbers never go back.
    pub fn at_least(&mut self, seq: u64) {
        self.seq = self.seq.max(seq);
    }

    /// The events after number `since`.
    pub fn since(&self, since: u64) -> Since {
        let events: Vec<ChatEvent> = self
            .ring
            .iter()
            .filter(|e| e.seq > since)
            .cloned()
            .collect();
        let first_kept = events.first().map_or(self.seq + 1, |e| e.seq);
        Since {
            gap: first_kept > since + 1,
            events,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(piece: &str) -> ChatEvent {
        let mut event = ChatEvent::new("c", "t", EventKind::Text);
        event.text = Some(piece.to_owned());
        event
    }

    #[test]
    fn events_are_numbered_one_after_another_and_replayed_from_a_number() {
        let mut log = Log::default();
        for piece in ["a", "b", "c"] {
            assert!(log.stamp(text(piece)).seq > 0);
        }
        let all = log.since(0);
        assert_eq!(
            all.events.iter().map(|e| e.seq).collect::<Vec<_>>(),
            [1, 2, 3]
        );
        assert!(!all.gap);
        let rest = log.since(2);
        assert_eq!(rest.events.len(), 1);
        assert_eq!(rest.events[0].text.as_deref(), Some("c"));
        assert!(log.since(3).events.is_empty() && !log.since(3).gap);
    }

    #[test]
    fn only_the_last_events_are_kept_and_a_window_too_far_behind_is_told() {
        let mut log = Log::default();
        for _ in 0..RING + 10 {
            log.stamp(text("x"));
        }
        let kept = log.since(0);
        assert_eq!(kept.events.len(), RING);
        assert_eq!(kept.events[0].seq, 11);
        assert!(kept.gap, "events 1 to 10 are gone");
        assert!(!log.since(10).gap, "11 is the next one it needs");
        assert!(log.since(5).gap);
        // A restored chat goes on from its number, with nothing to replay.
        let mut restored = Log::default();
        restored.at_least(40);
        assert!(restored.since(10).gap);
        assert_eq!(restored.stamp(text("y")).seq, 41);
    }
}
