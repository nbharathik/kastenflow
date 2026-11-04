//! One turn of a thread answered by an agent CLI: its lines become the chat's
//! events (text as it streams, each tool call and its result, cards for its
//! questions), its questions wait for the person, Stop ends the whole process
//! tree, and a program that goes quiet for too long is ended. The program
//! itself is behind `Transport`, so the whole turn is tested with a script.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde_json::Value;

use super::approvals::Approvals;
use super::claude::{self, ClaudeParser};
use super::items::{Ask, Finish, Item, Problem, classify};
use super::opencode::OpenCodeParser;
use super::process::{Recv, Transport};
use super::{Agent, tools};
use crate::chat::errors::FailKind;
use crate::chat::event::{Approval, ApprovalState, ChatEvent, EventKind, Events};
use crate::chat::summary::Described;
use crate::chat::turn::Ending;

/// How long things may take.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    /// Without a line of output (and no question waiting) it is ended.
    pub quiet: Duration,
    /// A turn is at most this long.
    pub total: Duration,
    /// A question nobody answers is refused after this.
    pub ask: Duration,
    /// After its closing words it has this long to end by itself.
    pub grace: Duration,
    /// How often the cancel flag and the answers are looked at.
    pub poll: Duration,
}

impl Default for Limits {
    fn default() -> Limits {
        Limits {
            quiet: Duration::from_secs(10 * 60),
            total: Duration::from_secs(2 * 60 * 60),
            ask: Duration::from_secs(30 * 60),
            grace: Duration::from_secs(15),
            poll: Duration::from_millis(50),
        }
    }
}

/// Tells a call of KastenFlow's own tools in the chat's words.
pub type Describe<'a> = &'a dyn Fn(&str, &Value, &Result<Value, String>) -> Option<Described>;

pub struct Drive<'a> {
    pub agent: Agent,
    pub events: &'a dyn Events,
    pub chat: &'a str,
    pub turn: &'a str,
    pub cancel: &'a AtomicBool,
    pub approvals: &'a Approvals,
    pub limits: Limits,
    pub describe: Describe<'a>,
}

/// What a turn came to.
#[derive(Debug)]
pub struct Outcome {
    /// What the agent said, whole.
    pub text: String,
    /// The CLI's id of the conversation, to go on with next time.
    pub session: Option<String>,
    pub ending: Ending,
}

enum Parser {
    Claude(ClaudeParser),
    OpenCode(OpenCodeParser),
}

impl Parser {
    fn feed(&mut self, line: &str) -> Vec<Item> {
        match self {
            Parser::Claude(p) => p.feed(line),
            Parser::OpenCode(p) => p.feed(line),
        }
    }
}

/// Why the program was ended by this side.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Killed {
    Stopped,
    Quiet,
    Long,
    /// It had said all it would; it was not ended for a fault.
    Done,
}

struct OpenAsk {
    ask: Ask,
    since: Instant,
}

struct Run<'a> {
    d: &'a Drive<'a>,
    parser: Parser,
    text: String,
    session: Option<String>,
    finished: Option<Finish>,
    finished_at: Option<Instant>,
    calls: HashMap<String, (String, Value)>,
    asks: Vec<OpenAsk>,
    /// Lines to send at the next look: refusals that were not the person's to make.
    outbox: Vec<String>,
    errors: Vec<String>,
}

impl Run<'_> {
    fn emit(&self, kind: EventKind, fill: impl FnOnce(&mut ChatEvent)) {
        let mut event = ChatEvent::new(self.d.chat, self.d.turn, kind);
        fill(&mut event);
        self.d.events.emit(event);
    }

    fn card(&self, ask: &Ask, state: ApprovalState) {
        let label = self.d.agent.label();
        self.emit(EventKind::Approval, |e| {
            e.approval = Some(Approval {
                id: ask.request_id.clone(),
                agent: label.to_owned(),
                tool: self.d.agent.strip_tool(&ask.tool).to_owned(),
                question: ask
                    .title
                    .clone()
                    .unwrap_or_else(|| tools::question(label, &ask.tool)),
                detail: tools::detail(&ask.tool, &ask.input)
                    .unwrap_or_else(|| "(Too long to review)".to_owned()),
                state,
            });
        });
    }

    fn item(&mut self, item: Item) {
        match item {
            Item::Session(id) => self.session = Some(id),
            Item::Text(piece) => {
                self.text.push_str(&piece);
                self.emit(EventKind::Text, |e| e.text = Some(piece));
            }
            Item::Tool { id, name, input } => {
                let shown = self.d.agent.strip_tool(&name).to_owned();
                self.calls.insert(id.clone(), (name, input.clone()));
                self.emit(EventKind::Tool, |e| {
                    e.tool = Some(crate::chat::event::ToolUse {
                        id,
                        name: shown,
                        input,
                    });
                });
            }
            Item::ToolDone { id, ok, text } => self.tool_done(id, ok, &text),
            Item::Ask(ask) => {
                // Allow runs the whole input, so one the card cannot show whole is not asked.
                if tools::detail(&ask.tool, &ask.input).is_none() {
                    self.card(&ask, ApprovalState::Denied);
                    self.outbox.push(claude::deny_line(
                        &ask.request_id,
                        "This request is too long to review in KastenFlow, so it was refused.",
                    ));
                    return;
                }
                self.d.approvals.open(self.d.chat, &ask.request_id);
                self.card(&ask, ApprovalState::Asking);
                self.asks.push(OpenAsk {
                    ask,
                    since: Instant::now(),
                });
            }
            Item::AskWithdrawn(id) => {
                self.d.approvals.close(self.d.chat, &id);
                if let Some(at) = self.asks.iter().position(|a| a.ask.request_id == id) {
                    let open = self.asks.remove(at);
                    self.card(&open.ask, ApprovalState::Over);
                }
            }
            Item::Notice { text, code } => self.emit(EventKind::Notice, |e| {
                e.text = Some(text);
                e.code = code;
            }),
            Item::Finished(done) => {
                // Nothing came as partial text (an older CLI): the closing words are the answer.
                if done.ok && self.text.is_empty() && !done.text.is_empty() {
                    self.item(Item::Text(done.text.clone()));
                }
                self.finished_at = Some(Instant::now());
                self.finished = Some(done);
            }
        }
    }

    fn tool_done(&mut self, id: String, ok: bool, text: &str) {
        let (name, input) = self
            .calls
            .remove(&id)
            .unwrap_or_else(|| (String::new(), Value::Null));
        let own = self.d.agent.is_kasten_tool(&name);
        let told = own
            .then(|| {
                let value = serde_json::from_str::<Value>(text.trim()).map_err(|_| text.to_owned());
                (self.d.describe)(
                    self.d.agent.strip_tool(&name),
                    &input,
                    &if ok { value } else { Err(text.to_owned()) },
                )
            })
            .flatten();
        let (summary, paths, ok) = match told {
            Some(t) => (t.summary, t.paths, t.ok),
            None => {
                let mut summary = tools::describe(&name, &input);
                if !ok {
                    let why = tools::clip(text, 140);
                    if !why.is_empty() {
                        summary = format!("{summary}: {why}");
                    }
                }
                (summary, Vec::new(), ok)
            }
        };
        self.emit(EventKind::ToolResult, |e| {
            e.result = Some(crate::chat::event::ToolResultInfo {
                id,
                ok,
                summary,
                paths,
                staged: false,
            });
        });
    }

    /// Passes on the answers the person gave to the open questions, and the
    /// refusals made without asking.
    fn answers(&mut self, t: &mut dyn Transport) {
        for line in std::mem::take(&mut self.outbox) {
            let _ = t.send_line(&line);
        }
        let chat = self.d.chat;
        let mut at = 0;
        while at < self.asks.len() {
            let id = self.asks[at].ask.request_id.clone();
            let Some(answer) = self.d.approvals.take(chat, &id) else {
                at += 1;
                continue;
            };
            let open = self.asks.remove(at);
            let line = if answer.allow {
                claude::allow_line(&id, &open.ask.input)
            } else {
                claude::deny_line(
                    &id,
                    answer
                        .message
                        .as_deref()
                        .unwrap_or("The user did not allow this in KastenFlow."),
                )
            };
            let state = if answer.allow {
                ApprovalState::Allowed
            } else {
                ApprovalState::Denied
            };
            self.card(&open.ask, state);
            let _ = t.send_line(&line);
        }
    }

    /// Refuses the questions nobody answered in time.
    fn expire(&mut self, t: &mut dyn Transport) {
        let late: Vec<String> = self
            .asks
            .iter()
            .filter(|a| a.since.elapsed() >= self.d.limits.ask)
            .map(|a| a.ask.request_id.clone())
            .collect();
        for id in late {
            self.d.approvals.answer(
                self.d.chat,
                &id,
                false,
                Some("Nobody answered in KastenFlow in time, so this was refused.".to_owned()),
            );
        }
        self.answers(t);
    }

    fn tail(&self) -> String {
        self.errors.join("\n")
    }

    fn close_asks(&mut self) {
        for open in std::mem::take(&mut self.asks) {
            self.card(&open.ask, ApprovalState::Over);
        }
        self.d.approvals.close_chat(self.d.chat);
    }
}

/// A span of time in words: "10 minutes", "30 seconds".
fn span(time: Duration) -> String {
    let secs = time.as_secs();
    if secs >= 120 {
        format!("{} minutes", secs / 60)
    } else if secs == 60 {
        "1 minute".to_owned()
    } else {
        format!("{secs} seconds")
    }
}

/// The CLI's own words, then what to do about it.
fn failure(agent: Agent, text: &str, problem: Problem) -> Ending {
    let mut message = text.trim().to_owned();
    if message.is_empty() {
        message = format!("{} stopped without saying why.", agent.label());
    }
    if problem == Problem::SignIn {
        message = format!("{message}\n\n{}", agent.sign_in_hint());
    }
    Ending::Error {
        message,
        kind: problem.kind(),
    }
}

/// Runs a turn on `t` to its end. `start` are the lines sent first (the
/// person's message, and for Claude Code the `initialize` request).
pub fn drive(t: &mut dyn Transport, start: &[String], d: &Drive<'_>) -> Outcome {
    let mut run = Run {
        d,
        parser: match d.agent {
            Agent::ClaudeCode => Parser::Claude(ClaudeParser::default()),
            Agent::OpenCode => Parser::OpenCode(OpenCodeParser::default()),
        },
        text: String::new(),
        session: None,
        finished: None,
        finished_at: None,
        calls: HashMap::new(),
        asks: Vec::new(),
        outbox: Vec::new(),
        errors: Vec::new(),
    };
    let began = Instant::now();
    let mut last = Instant::now();
    let mut killed: Option<Killed> = None;
    let mut input_open = true;
    for line in start {
        if let Err(err) = t.send_line(line) {
            run.errors.push(err);
        }
    }
    // OpenCode takes its message, then reads to the end of its input.
    if d.agent == Agent::OpenCode {
        t.close_input();
        input_open = false;
    }
    let code = loop {
        if killed.is_none() {
            if d.cancel.load(Ordering::SeqCst) {
                t.kill();
                killed = Some(Killed::Stopped);
            } else if run.asks.is_empty() && last.elapsed() >= d.limits.quiet {
                t.kill();
                killed = Some(Killed::Quiet);
            } else if began.elapsed() >= d.limits.total {
                t.kill();
                killed = Some(Killed::Long);
            } else if run
                .finished_at
                .is_some_and(|at| at.elapsed() >= d.limits.grace)
            {
                t.kill();
                killed = Some(Killed::Done);
            }
        }
        run.answers(t);
        run.expire(t);
        match t.recv(d.limits.poll) {
            Recv::Out(line) => {
                last = Instant::now();
                for item in run.parser.feed(&line) {
                    run.item(item);
                }
                // It has said all it will: tell it nothing more is coming, so it ends.
                if run.finished.is_some() && input_open {
                    t.close_input();
                    input_open = false;
                }
            }
            Recv::Err(line) => {
                last = Instant::now();
                run.errors.push(line);
                if run.errors.len() > 20 {
                    run.errors.remove(0);
                }
            }
            Recv::Quiet => {}
            Recv::Ended(code) => break code,
        }
    };
    run.close_asks();
    let ending = match (killed, &run.finished) {
        (Some(Killed::Stopped), _) => Ending::Done { stopped: true },
        (Some(Killed::Quiet), _) => Ending::Error {
            message: format!(
                "{} did not answer for {}, so it was ended. Send the message again to go on.",
                d.agent.label(),
                span(d.limits.quiet)
            ),
            kind: FailKind::Connection,
        },
        (Some(Killed::Long), _) => Ending::Error {
            message: format!(
                "{} worked for more than {}, so it was ended. What it did is kept; send a message to go on.",
                d.agent.label(),
                span(d.limits.total)
            ),
            kind: FailKind::Other,
        },
        (_, Some(done)) if done.ok => Ending::Done { stopped: false },
        (_, Some(done)) => failure(d.agent, &done.text, done.problem),
        (_, None) if code == Some(0) => Ending::Done { stopped: false },
        (_, None) => {
            let tail = run.tail();
            let how = match code {
                Some(n) => format!("{} stopped unexpectedly (exit code {n}).", d.agent.label()),
                None => format!("{} was ended unexpectedly.", d.agent.label()),
            };
            let problem = classify(None, &tail);
            let words: String = tail.split_whitespace().collect::<Vec<_>>().join(" ");
            let said: String = words.chars().take(400).collect();
            let said = if said.is_empty() {
                how
            } else {
                format!("{how} It said: {said}")
            };
            failure(d.agent, &said, problem)
        }
    };
    Outcome {
        text: run.text,
        session: run.session,
        ending,
    }
}
