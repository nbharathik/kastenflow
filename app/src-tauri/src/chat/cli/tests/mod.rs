//! Tests of the agent CLIs: the parsers on recorded lines (fixtures/agent-cli),
//! command resolution, the clean environment, the command lines and MCP config,
//! the turn on a scripted program, and a real process tree that is ended.
//! No test starts Claude Code or OpenCode.

mod build;
mod drive;
mod parse;
mod process;
mod review;

use std::sync::Mutex;

use crate::chat::event::{ChatEvent, Events};

/// A fixture's lines.
pub(super) fn lines(text: &str) -> Vec<String> {
    text.lines().map(str::to_owned).collect()
}

pub(super) const CLAUDE_ANSWER: &str =
    include_str!("../../../../../../fixtures/agent-cli/claude-answer.jsonl");
pub(super) const CLAUDE_ASK: &str =
    include_str!("../../../../../../fixtures/agent-cli/claude-ask.jsonl");
pub(super) const CLAUDE_SIGNIN: &str =
    include_str!("../../../../../../fixtures/agent-cli/claude-signin.jsonl");
pub(super) const OPENCODE_RUN: &str =
    include_str!("../../../../../../fixtures/agent-cli/opencode-run.jsonl");
pub(super) const OPENCODE_REFUSED: &str =
    include_str!("../../../../../../fixtures/agent-cli/opencode-refused.jsonl");

/// Events a turn told, in order.
#[derive(Default)]
pub(super) struct Seen(Mutex<Vec<ChatEvent>>);

impl Events for Seen {
    fn emit(&self, event: ChatEvent) {
        self.0.lock().unwrap().push(event);
    }
}

impl Seen {
    pub(super) fn all(&self) -> Vec<ChatEvent> {
        self.0.lock().unwrap().clone()
    }
}
