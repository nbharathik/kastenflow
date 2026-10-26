//! Chat threads: each chat's conversation, its agent session and system
//! prompt, kept while the app runs (and saved: persist.rs), and the turn
//! running in it, if any. One thread is one session, from its first turn until
//! it is deleted. A message sent while a turn works waits in the thread's queue
//! (queue.rs); `send.rs` starts turns.

mod adopt;
mod archived;
mod bound;
mod launch;
mod persist;
mod queue;
mod saved;
mod send;
mod wait;

use std::collections::{BTreeSet, HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use kasten_core::agent::{ChangeSet, Session};
use kasten_core::{Instant, ulid_at};
use serde_json::Value;

use super::attach::Attachments;
use super::binding::Binding;
use super::budget::ChatBudgets;
use super::capabilities::GenerationSettings;
use super::event::Log;
use super::limit::{ChatLimits, Gate};
use super::model::{Message, ToolOutput};
use super::plan::PlanItem;
use super::store::{Status, Store};
use super::{CLIENT, WriteMode};

pub use adopt::{AdoptFailed, AdoptReason};
pub use archived::NewThread;
#[cfg(test)]
pub use persist::Gap;
pub use persist::Loaded;
pub use queue::{Queued, Settled};
pub use saved::{ChatUsage, StateOf};
#[cfg(test)]
pub use send::send;
pub use send::{Profile, resume_with, send_with};

/// A thread's staged changes, shared by its turns and the commands that
/// show, apply and discard them.
pub type Changes = Arc<Mutex<ChangeSet>>;

struct Thread {
    session: Session,
    system: String,
    /// The day the system prompt names; the prompt is written again when the day changes.
    day: String,
    messages: Vec<Message>,
    /// What the chat has staged for the person to review.
    changes: Changes,
    plan: Vec<PlanItem>,
    status: Status,
    created: u64,
    updated: u64,
    title: String,
    provider: String,
    model: String,
    settings: Option<GenerationSettings>,
    writes: WriteMode,
    /// What the window sent with `chat_save_ui`.
    ui: Option<Value>,
    /// Attachments the conversation refers to.
    attachments: BTreeSet<String>,
    /// Messages sent while a turn worked, in the order they came.
    queue: VecDeque<Queued>,
    /// Older than the list's size: shown under "Archived".
    archived: bool,
    /// What the thread is about, if it is tied to a page, deck or diagram.
    bound: Option<Binding>,
}

struct Running {
    turn: String,
    cancel: Arc<AtomicBool>,
}

#[derive(Default)]
struct Inner {
    threads: HashMap<String, Thread>,
    running: HashMap<String, Running>,
    /// Event numbers and the last events of each chat, kept after a reset
    /// so numbers never go back.
    logs: HashMap<String, Log>,
    store: Option<Arc<Store>>,
    files: Option<Arc<Attachments>>,
    budgets: ChatBudgets,
    /// The list's size and how many chats work at once.
    limits: ChatLimits,
    /// The app is closing: nothing running goes back to idle.
    closing: bool,
    /// Counts snapshots, so an older one never replaces a newer one on disk.
    rev: u64,
}

/// Every thread, shared by the commands and the turns they start.
#[derive(Clone, Default)]
pub struct Chats {
    inner: Arc<Mutex<Inner>>,
    /// Where turns wait when as many chats are working as the limit allows.
    gate: Arc<Gate>,
}

/// A turn begun: its id, its thread's session and prompt, the conversation
/// so far and the flag that stops it.
pub struct Begun {
    pub turn: String,
    pub session: Session,
    pub system: String,
    pub messages: Vec<Message>,
    pub plan: Vec<PlanItem>,
    pub cancel: Arc<AtomicBool>,
    pub changes: Changes,
}

fn now_ms() -> u64 {
    Instant::now().millis
}

fn new_thread(now: Instant, day: &str, system: String) -> Thread {
    let session = Session::start(CLIENT, now);
    let changes = ChangeSet::new(
        ulid_at(now.millis),
        &session.id,
        &session.client,
        now.millis,
    );
    Thread {
        session,
        system,
        day: day.to_owned(),
        messages: Vec::new(),
        changes: Arc::new(Mutex::new(changes)),
        plan: Vec::new(),
        status: Status::Idle,
        created: now.millis,
        updated: now.millis,
        title: String::new(),
        provider: String::new(),
        model: String::new(),
        settings: None,
        writes: WriteMode::default(),
        ui: None,
        attachments: BTreeSet::new(),
        queue: VecDeque::new(),
        archived: false,
        bound: None,
    }
}

/// Gives every tool call that has no result one that says it did not run, so
/// a thread the app closed on, or that was damaged, can be sent again.
pub fn repair(messages: &mut Vec<Message>) {
    let mut at = 0;
    while at < messages.len() {
        let wanted: Vec<String> = match &messages[at] {
            Message::Assistant(reply) => reply.calls.iter().map(|c| c.id.clone()).collect(),
            _ => Vec::new(),
        };
        if !wanted.is_empty() {
            let missing = |have: &[ToolOutput]| -> Vec<ToolOutput> {
                wanted
                    .iter()
                    .filter(|id| !have.iter().any(|r| &r.id == *id))
                    .map(|id| ToolOutput {
                        id: id.clone(),
                        content: "Not run: the app closed before this call ran.".to_owned(),
                        is_error: true,
                    })
                    .collect()
            };
            match messages.get_mut(at + 1) {
                Some(Message::Results(have)) => {
                    let more = missing(have);
                    have.extend(more);
                }
                _ => messages.insert(at + 1, Message::Results(missing(&[]))),
            }
        }
        at += 1;
    }
}

impl Chats {
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// The limits a turn runs within.
    pub fn set_budgets(&self, budgets: ChatBudgets) {
        self.lock().budgets = budgets;
    }

    pub fn budgets(&self) -> ChatBudgets {
        self.lock().budgets
    }

    /// The list's size and the number of chats that work at once, from now on.
    /// Making the list smaller archives the oldest threads (never deletes one).
    pub fn set_limits(&self, limits: ChatLimits) {
        self.lock().limits = limits;
        self.gate.set_max(limits.max_concurrent);
        self.archive_overflow();
    }

    pub fn limits(&self) -> ChatLimits {
        self.lock().limits
    }

    /// The place where turns wait their turn.
    pub(crate) fn gate(&self) -> Arc<Gate> {
        Arc::clone(&self.gate)
    }

    /// Starts a turn in `chat`, and the thread with its session and
    /// prompt if this is its first. One turn at a time per thread.
    #[cfg(test)]
    pub fn begin(
        &self,
        chat: &str,
        now: Instant,
        system: impl FnOnce() -> String,
    ) -> Result<Begun, String> {
        let mut system = Some(system);
        self.begin_on(chat, now, "", |_| {
            system.take().map(|f| f()).unwrap_or_default()
        })
    }

    /// `begin`, on the day `today`: a thread whose prompt names another day
    /// gets the prompt written again, so a chat kept for days is not told it is
    /// still the day it began. An empty `today` leaves the prompt as it is.
    pub fn begin_on(
        &self,
        chat: &str,
        now: Instant,
        today: &str,
        mut system_for: impl FnMut(&str) -> String,
    ) -> Result<Begun, String> {
        let mut inner = self.lock();
        if inner.running.contains_key(chat) {
            return Err("This chat is still answering; stop it first".to_owned());
        }
        let thread = inner
            .threads
            .entry(chat.to_owned())
            .or_insert_with(|| new_thread(now, today, system_for(today)));
        if !today.is_empty() && thread.day != today {
            thread.system = system_for(today);
            thread.day = today.to_owned();
        }
        thread.status = Status::Running;
        thread.updated = now.millis;
        let begun = Begun {
            turn: ulid_at(now.millis),
            session: thread.session.clone(),
            system: thread.system.clone(),
            messages: thread.messages.clone(),
            plan: thread.plan.clone(),
            cancel: Arc::new(AtomicBool::new(false)),
            changes: Arc::clone(&thread.changes),
        };
        let running = Running {
            turn: begun.turn.clone(),
            cancel: Arc::clone(&begun.cancel),
        };
        inner.running.insert(chat.to_owned(), running);
        Ok(begun)
    }

    /// Stops the running turn, if there is one.
    pub fn stop(&self, chat: &str) -> bool {
        match self.lock().running.get(chat) {
            Some(running) => {
                running.cancel.store(true, Ordering::SeqCst);
                true
            }
            None => false,
        }
    }

    /// Takes the thread out of memory: its next turn starts a new conversation
    /// and a new session. A turn still running is stopped, and what it had is
    /// not kept. The thread's staged changes come back, for the caller to throw
    /// away with it.
    pub fn drop_thread(&self, chat: &str) -> Option<Changes> {
        let mut inner = self.lock();
        if let Some(running) = inner.running.remove(chat) {
            running.cancel.store(true, Ordering::SeqCst);
        }
        inner.threads.remove(chat).map(|thread| thread.changes)
    }

    /// Takes the thread out of memory and stops a turn still running in it.
    /// The saved copy stays (a reset never deletes a saved thread: start a
    /// new one with `new_thread`), and so do its staged changes, which the
    /// saved thread brings back. The staged changes come back to the caller.
    pub fn reset(&self, chat: &str) -> Option<Changes> {
        self.drop_thread(chat)
    }

    /// The thread's staged changes, if it has a thread.
    pub fn changes(&self, chat: &str) -> Option<Changes> {
        self.lock()
            .threads
            .get(chat)
            .map(|thread| Arc::clone(&thread.changes))
    }

    /// Whether a turn is running in the thread.
    pub fn running(&self, chat: &str) -> bool {
        self.lock().running.contains_key(chat)
    }

    /// Takes the conversation back to its first `keep` questions: the
    /// question after them and everything after it is forgotten, so the
    /// model is asked it again, or asked another, as if the first had not
    /// been. The thread's agent session, and what it changed, stay. A
    /// conversation with no more than `keep` questions is left as it is.
    /// Refused while a turn is running. Returns how many questions it has now.
    pub fn rewind(&self, chat: &str, keep: usize) -> Result<usize, String> {
        let mut inner = self.lock();
        if inner.running.contains_key(chat) {
            return Err("This chat is still answering; stop it first".to_owned());
        }
        let Some(thread) = inner.threads.get_mut(chat) else {
            return Ok(0);
        };
        let questions = |messages: &[Message]| messages.iter().filter(|m| is_question(m)).count();
        let cut = thread
            .messages
            .iter()
            .enumerate()
            .filter(|(_, m)| is_question(m))
            .nth(keep)
            .map(|(at, _)| at);
        if let Some(at) = cut {
            thread.messages.truncate(at);
        }
        let left = questions(&thread.messages);
        drop(inner);
        self.persist(chat);
        Ok(left)
    }

    /// The thread's conversation, for tests.
    #[cfg(test)]
    pub fn messages(&self, chat: &str) -> Option<Vec<Message>> {
        self.lock().threads.get(chat).map(|t| t.messages.clone())
    }
}

/// A message the person wrote, not one of the harness's own nudges.
fn is_question(message: &Message) -> bool {
    super::compact::asked_by_person(message)
}

/// The person's day as YYYY-MM-DD, when given well; else today in UTC.
pub fn day(given: Option<&str>) -> String {
    let wanted = given.unwrap_or_default().trim();
    let shaped = wanted.len() == 10
        && wanted.bytes().enumerate().all(|(i, b)| match i {
            4 | 7 => b == b'-',
            _ => b.is_ascii_digit(),
        });
    if shaped {
        wanted.to_owned()
    } else {
        Instant::now().rfc3339()[..10].to_owned()
    }
}
