//! One turn of a chat: the model answers, its tool calls run through
//! `kasten_mcp::tools` in the thread's session, their results go back, and
//! so on until the model is done, the turn has made its tool calls, or the
//! person stops it. A refused or failed call goes back to the model as an
//! error result; it never ends the turn.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use kasten_core::Kasten;
use kasten_core::agent::Session;
use kasten_mcp::tools::ToolSpec;
use serde_json::{Value, json};

use super::model::{Call, Message, Model, Reply, Stop, ToolCall, ToolOutput};
use super::responses;
use super::summary::{Described, describe};
use super::{ChatEvent, EventKind, Events, MAX_CALLS, ToolResultInfo, ToolUse};

/// A tool result longer than this is cut, so one read cannot fill the
/// model's context.
const RESULT_LIMIT: usize = 50_000;

/// How a turn ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Ending {
    Done { stopped: bool },
    Error(String),
}

/// What a turn works with.
pub struct Turn<'a> {
    pub kasten: &'a Arc<Kasten>,
    pub session: &'a Session,
    pub system: &'a str,
    pub tools: &'a [ToolSpec],
    pub events: &'a dyn Events,
    pub chat: &'a str,
    pub turn: &'a str,
    pub cancel: &'a AtomicBool,
}

/// Adds an answer to the thread. Without its calls (they will not run), it
/// keeps its text and thinking; an answer with nothing left is not kept.
fn keep(messages: &mut Vec<Message>, mut reply: Reply, with_calls: bool) {
    if !with_calls {
        reply.calls.clear();
        if let Some(blocks) = &mut reply.blocks {
            blocks.retain(|b| b["type"] != "tool_use");
        }
        if let Some(items) = &mut reply.items {
            responses::without_calls(items);
        }
    }
    if !reply.is_empty() {
        messages.push(Message::Assistant(reply));
    }
}

fn not_run(call: &ToolCall, why: &str) -> ToolOutput {
    ToolOutput {
        id: call.id.clone(),
        content: format!("Not run: {why}"),
        is_error: true,
    }
}

/// A result as the model reads it: compact JSON, cut if it is huge.
fn content(value: &Value) -> String {
    let text = value.to_string();
    match text.char_indices().nth(RESULT_LIMIT) {
        Some((at, _)) => format!(
            "{}\n[Cut: the result had {} characters. Ask for less, such as with a smaller limit.]",
            &text[..at],
            text.chars().count()
        ),
        None => text,
    }
}

impl Turn<'_> {
    fn emit(&self, kind: EventKind, fill: impl FnOnce(&mut ChatEvent)) {
        let mut event = ChatEvent::new(self.chat, self.turn, kind);
        fill(&mut event);
        self.events.emit(event);
    }

    fn stopped(&self) -> bool {
        self.cancel.load(Ordering::SeqCst)
    }

    /// Runs the turn on `messages`, which ends with the person's message;
    /// answers and results are appended as they come.
    pub async fn run(&self, model: &impl Model, messages: &mut Vec<Message>) -> Ending {
        let mut made = 0;
        loop {
            if self.stopped() {
                return Ending::Done { stopped: true };
            }
            let text =
                |piece: &str| self.emit(EventKind::Text, |e| e.text = Some(piece.to_owned()));
            let answer = {
                let call = Call {
                    system: self.system,
                    messages,
                    tools: self.tools,
                };
                model.reply(&call, &text, self.cancel).await
            };
            let reply = match answer {
                Ok(reply) => reply,
                Err(failure) => {
                    if let Some(partial) = failure.partial {
                        keep(messages, partial, false);
                    }
                    return Ending::Error(failure.message);
                }
            };
            let ended = match reply.stop {
                Stop::Cancelled => Some(Ending::Done { stopped: true }),
                Stop::Refusal => Some(Ending::Error(
                    "The model declined to go on with this.".to_owned(),
                )),
                Stop::Full => Some(Ending::Error(
                    "This chat is longer than the model can read. Start a new chat, with the notes it needs attached.".to_owned(),
                )),
                // A call cut off by the limit may be half written: none run.
                Stop::Length => Some(Ending::Error(
                    "The answer reached its length limit and was cut off.".to_owned(),
                )),
                Stop::End | Stop::Tools if reply.calls.is_empty() => {
                    Some(Ending::Done { stopped: false })
                }
                Stop::End | Stop::Tools => None,
            };
            if let Some(ending) = ended {
                keep(messages, reply, false);
                return ending;
            }
            let calls = reply.calls.clone();
            keep(messages, reply, true);
            // Every call gets a result, run or not, so the thread stays whole.
            let mut outputs = Vec::new();
            let mut capped = false;
            for call in &calls {
                if self.stopped() {
                    outputs.push(not_run(call, "the user stopped this turn"));
                } else if made == MAX_CALLS {
                    capped = true;
                    let why = format!("this turn reached its limit of {MAX_CALLS} tool calls");
                    outputs.push(not_run(call, &why));
                } else {
                    made += 1;
                    outputs.push(self.call(call).await);
                }
            }
            messages.push(Message::Results(outputs));
            if self.stopped() {
                return Ending::Done { stopped: true };
            }
            if capped {
                return Ending::Error(format!(
                    "Stopped after {MAX_CALLS} tool calls, the most one turn may make. Send another message to let it go on."
                ));
            }
        }
    }

    /// Runs one tool call and tells the person how it went.
    async fn call(&self, call: &ToolCall) -> ToolOutput {
        let input = call.input();
        let shown = input
            .clone()
            .unwrap_or_else(|_| Value::String(call.arguments.clone()));
        self.emit(EventKind::Tool, |e| {
            e.tool = Some(ToolUse {
                id: call.id.clone(),
                name: call.name.clone(),
                input: shown,
            })
        });
        let (result, described) = match input {
            Ok(input) => {
                let kasten = Arc::clone(self.kasten);
                let session = self.session.clone();
                let name = call.name.clone();
                let ran = tokio::task::spawn_blocking(move || {
                    let result = kasten_mcp::tools::call(&kasten, &session, &name, input.clone());
                    let described = describe(&kasten, &name, &input, &result);
                    (result, described)
                })
                .await;
                ran.unwrap_or_else(|err| {
                    let why = format!("The tool stopped: {err}");
                    let summary = format!("Could not run {}: {why}", call.name);
                    let described = Described {
                        ok: false,
                        summary,
                        paths: vec![],
                    };
                    (Err(why), described)
                })
            }
            // As Anthropic suggests: the input back, so the model can mend it.
            Err(_) => (
                Err(json!({"INVALID_JSON": call.arguments}).to_string()),
                Described {
                    ok: false,
                    summary: format!(
                        "Could not run {}: its arguments were not valid JSON",
                        call.name
                    ),
                    paths: vec![],
                },
            ),
        };
        self.emit(EventKind::ToolResult, |e| {
            e.result = Some(ToolResultInfo {
                id: call.id.clone(),
                ok: described.ok,
                summary: described.summary,
                paths: described.paths,
            })
        });
        match result {
            Ok(value) => ToolOutput {
                id: call.id.clone(),
                content: content(&value),
                is_error: false,
            },
            Err(error) => ToolOutput {
                id: call.id.clone(),
                content: error,
                is_error: true,
            },
        }
    }
}
