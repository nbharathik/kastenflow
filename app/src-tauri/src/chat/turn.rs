//! One turn of a chat: the model answers, its tool calls run through
//! `kasten_mcp::tools` in the thread's session, their results go back, and
//! so on until the model is done, a budget runs out (the turn is then
//! *paused*, and the person can let it go on), or the person stops it. A
//! refused or failed call goes back to the model as an error result; it never
//! ends the turn.
//!
//! Between steps the turn takes up what the person sent meanwhile, keeps the
//! history within the model's window (compact.rs), and hands the thread to be
//! saved. An answer cut off by its length limit is continued; a call cut off
//! is asked again smaller; calls that only read run together.

mod tools;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use kasten_core::Kasten;
use kasten_core::agent::Session;
use kasten_mcp::tools::ToolSpec;

use super::budget::{self, ChatBudgets, LoopGuard, Meter, Pause, PauseReason, Verdict};
use super::compact;
use super::context::fence_tags;
use super::errors::FailKind;
use super::model::{Call, Failure, Message, Model, Reply, Stop};
use super::plan::PlanItem;
use super::responses;
use super::threads::{Changes, Queued};
use super::{ChangesInfo, ChatEvent, EventKind, Events};

/// How often a request that is open is asked for news worth telling.
const NOTICE_LOOK: Duration = Duration::from_millis(200);
/// How many times in a row an answer cut off by its length is continued.
const MAX_CONTINUES: u32 = 3;

pub(crate) const CONTINUE: &str =
    "Continue exactly where you stopped. Do not repeat what you already wrote.";
pub(crate) const SMALLER: &str = "Your last tool call was cut off by the length limit, so it was not run. Make smaller calls: fewer items in each, or one piece at a time.";
/// What the model is told when a paused thread goes on and the last word was its own.
pub(crate) const RESUME: &str = "Continue with the task where you left off.";

/// Whether `text` is something the harness said to the model, not the person.
pub(crate) fn is_harness_text(text: &str) -> bool {
    [CONTINUE, SMALLER, RESUME, budget::NUDGE].contains(&text)
}

/// How a turn ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Ending {
    Done {
        stopped: bool,
    },
    Error {
        message: String,
        kind: FailKind,
    },
    /// Stopped on a limit, a loop or an interruption; it can go on.
    Paused {
        reason: PauseReason,
        detail: String,
    },
}

impl Ending {
    fn failed(message: impl Into<String>, kind: FailKind) -> Ending {
        Ending::Error {
            message: message.into(),
            kind,
        }
    }

    fn paused(pause: Pause) -> Ending {
        Ending::Paused {
            reason: pause.reason,
            detail: pause.detail,
        }
    }
}

/// What a turn asks of the thread it runs in.
pub trait Link: Send + Sync {
    /// The conversation after a step, to be kept (and saved).
    fn checkpoint(&self, messages: &[Message], plan: &[PlanItem]);
    /// What the person sent while the turn worked, taken from the queue.
    fn take_queued(&self) -> Vec<Queued>;
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
    /// The thread's staged changes, when its writes are held back for the
    /// person; none when they are made at once.
    pub changes: Option<&'a Changes>,
    pub link: &'a dyn Link,
    pub budgets: ChatBudgets,
    /// Tokens the model reads at once.
    pub window: usize,
    /// Time the turn has already used: a test's clock.
    pub spent: Duration,
}

/// What a thread's staged changes come to now.
pub fn changes_info(changes: &Changes) -> ChangesInfo {
    let set = changes.lock().unwrap_or_else(|p| p.into_inner());
    ChangesInfo {
        id: set.id.clone(),
        count: set.len(),
        paths: set.paths(),
    }
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

impl Turn<'_> {
    fn emit(&self, kind: EventKind, fill: impl FnOnce(&mut ChatEvent)) {
        let mut event = ChatEvent::new(self.chat, self.turn, kind);
        fill(&mut event);
        self.events.emit(event);
    }

    fn stopped(&self) -> bool {
        self.cancel.load(Ordering::SeqCst)
    }

    fn checkpoint(&self, messages: &[Message], plan: &[PlanItem]) {
        self.link.checkpoint(messages, plan);
    }

    /// Takes up what the person sent meanwhile, as messages of their own.
    /// Whether there was any.
    fn steer(&self, messages: &mut Vec<Message>) -> bool {
        let waiting = self.link.take_queued();
        for queued in &waiting {
            messages.push(queued.message.clone());
            self.emit(EventKind::Queued, |e| {
                e.text = Some(queued.text.clone());
                e.delivered = Some(true);
            });
        }
        !waiting.is_empty()
    }

    /// Tells the person what the model has to say about the request.
    fn say_notices(&self, model: &impl Model) {
        for notice in model.take_notices() {
            self.emit(EventKind::Notice, |e| {
                e.text = Some(notice.text);
                e.code = notice.code;
            });
        }
    }

    /// One request to the model. While it is open, news (a connection that
    /// dropped and is tried again) is told as it comes.
    async fn ask(&self, model: &impl Model, messages: &[Message]) -> Result<Reply, Box<Failure>> {
        let text = |piece: &str| self.emit(EventKind::Text, |e| e.text = Some(piece.to_owned()));
        let call = Call {
            system: self.system,
            messages,
            tools: self.tools,
        };
        let mut open = Box::pin(model.reply(&call, &text, self.cancel));
        let answer = loop {
            match tokio::time::timeout(NOTICE_LOOK, &mut open).await {
                Ok(done) => break done,
                Err(_) => self.say_notices(model),
            }
        };
        self.say_notices(model);
        answer.map_err(Box::new)
    }

    /// One extra request that writes the record of the older rounds.
    async fn summarise(&self, model: &impl Model, record: &str) -> Result<String, String> {
        let thread = [Message::User(format!(
            "Write the record of this earlier work.\n\n<record>\n{}\n</record>",
            fence_tags(record, &["record"])
        ))];
        let call = Call {
            system: compact::SUMMARY_SYSTEM,
            messages: &thread,
            tools: &[],
        };
        let reply = model
            .reply(&call, &|_| {}, self.cancel)
            .await
            .map_err(|f| f.message)?;
        match reply.stop {
            Stop::End | Stop::Length if !reply.text.trim().is_empty() => Ok(reply.text),
            _ => Err("The model wrote no summary".to_owned()),
        }
    }

    /// Keeps the history within the window: old results are left out first,
    /// and if that is not enough the older rounds are summarised.
    async fn make_room(
        &self,
        model: &impl Model,
        messages: &mut Vec<Message>,
        plan: &[PlanItem],
        room: &mut compact::State,
    ) {
        let (window, tools) = (self.window.max(1), room.tools);
        let size = |thread: &[Message]| compact::estimate(self.system, thread) + tools;
        if size(messages) * 100 < window * compact::ELIDE_AT {
            return;
        }
        if compact::elide_stale(messages) > 0 {
            self.checkpoint(messages, plan);
        }
        if size(messages) * 100 < window * compact::SUMMARISE_AT
            || !room.may_summarise(messages.len())
        {
            return;
        }
        let Some(cut) = compact::tail_start(messages).filter(|cut| *cut > 2) else {
            return;
        };
        room.tried(messages.len());
        let record = compact::transcript(messages, cut, window);
        let Ok(summary) = self.summarise(model, &record).await else {
            return;
        };
        let staged = self
            .changes
            .map(|c| compact::staged_lines(&c.lock().unwrap_or_else(|p| p.into_inner())))
            .unwrap_or_default();
        let left_out = compact::attachments_in(&messages[1..cut]);
        let message = compact::summary_message(&summary, plan, &staged, &left_out);
        compact::replace_older(messages, cut, message);
        room.tried(messages.len());
        self.checkpoint(messages, plan);
        self.emit(EventKind::Notice, |e| {
            e.text = Some("Earlier steps were summarised to make room.".to_owned());
            e.code = Some("summary".to_owned());
        });
    }

    /// Runs the turn on `messages`, which ends with the person's message (or,
    /// for a turn that goes on, with the results of the step before); answers
    /// and results are appended as they come, and the plan follows the model's
    /// `update_plan` calls.
    pub async fn run(
        &self,
        model: &impl Model,
        messages: &mut Vec<Message>,
        plan: &mut Vec<PlanItem>,
    ) -> Ending {
        let mut meter = Meter::new(self.budgets, self.spent);
        let mut watch = LoopGuard::default();
        let mut room = compact::State::new(self.tools);
        let (mut continues, mut asked_smaller) = (0, false);
        loop {
            if self.stopped() {
                return Ending::Done { stopped: true };
            }
            if let Err(pause) = meter.round() {
                return Ending::paused(pause);
            }
            self.steer(messages);
            self.make_room(model, messages, plan, &mut room).await;
            let n = meter.took_round();
            self.emit(EventKind::Round, |e| {
                e.n = Some(n);
                e.calls = Some(meter.calls());
            });
            let reply = match self.ask(model, messages).await {
                Ok(reply) => reply,
                Err(failure) => {
                    let failure = *failure;
                    if let Some(partial) = failure.partial {
                        keep(messages, partial, false);
                    }
                    self.checkpoint(messages, plan);
                    return Ending::failed(failure.message, failure.kind);
                }
            };
            let ended = match reply.stop {
                Stop::Cancelled => Some(Ending::Done { stopped: true }),
                Stop::Refusal => Some(Ending::failed(
                    "The model declined to go on with this.",
                    FailKind::Refused,
                )),
                Stop::Full => Some(Ending::failed(
                    "This chat is longer than the model can read. Start a new chat, with the notes it needs attached.",
                    FailKind::TooLong,
                )),
                _ => None,
            };
            if let Some(ending) = ended {
                keep(messages, reply, false);
                self.checkpoint(messages, plan);
                return ending;
            }
            // A call cut off by the limit may be half written: none run.
            let cut_call = reply.calls.iter().any(|c| c.input().is_err());
            if reply.stop == Stop::Length && (cut_call || reply.calls.is_empty()) {
                keep(messages, reply, false);
                if cut_call {
                    if asked_smaller {
                        self.checkpoint(messages, plan);
                        return Ending::paused(length_pause());
                    }
                    asked_smaller = true;
                    messages.push(Message::User(SMALLER.to_owned()));
                } else {
                    if continues >= MAX_CONTINUES {
                        self.checkpoint(messages, plan);
                        return Ending::paused(length_pause());
                    }
                    continues += 1;
                    messages.push(Message::User(CONTINUE.to_owned()));
                }
                self.checkpoint(messages, plan);
                continue;
            }
            if reply.calls.is_empty() {
                // The provider paused a long answer: it goes back as it is.
                let paused = reply.stop == Stop::Pause;
                keep(messages, reply, paused);
                // A message that came while the answer finished is the next step.
                if paused || self.steer(messages) {
                    self.checkpoint(messages, plan);
                    continue;
                }
                self.checkpoint(messages, plan);
                return Ending::Done { stopped: false };
            }
            (continues, asked_smaller) = (0, false);
            let calls = reply.calls.clone();
            keep(messages, reply, true);
            self.checkpoint(messages, plan);
            let (outputs, pause) = self.run_calls(&calls, &mut meter, &mut watch, plan).await;
            messages.push(Message::Results(outputs));
            self.checkpoint(messages, plan);
            if self.stopped() {
                return Ending::Done { stopped: true };
            }
            if let Some(pause) = pause {
                return Ending::paused(pause);
            }
            match watch.verdict() {
                Verdict::Fine => {}
                Verdict::Nudge => {
                    messages.push(Message::User(budget::NUDGE.to_owned()));
                    self.checkpoint(messages, plan);
                }
                Verdict::Pause => return Ending::paused(budget::looped()),
            }
        }
    }
}

fn length_pause() -> Pause {
    Pause::new(
        PauseReason::Length,
        "Paused because the answer kept running past its length limit — Continue to let it go on",
    )
}
