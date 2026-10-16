//! A turn's link to its thread: the messages sent while it works wait here
//! and are taken up at the next step, each step's conversation is kept (and
//! saved), a turn's events are numbered, and the turn is settled when it ends.

use std::sync::Arc;
use std::sync::atomic::Ordering;

use kasten_core::agent::Session;

use super::{Chats, now_ms};
use crate::chat::errors::FailKind;
use crate::chat::event::{ChatEvent, Events};
use crate::chat::model::Message;
use crate::chat::plan::PlanItem;
use crate::chat::store::Status;
use crate::chat::turn::{Ending, Link};

/// A message sent while a turn works: what the person typed, for the window,
/// and the message the model gets (its context already read).
#[derive(Debug, Clone, PartialEq)]
pub struct Queued {
    pub text: String,
    pub message: Message,
}

/// The turn that will take a queued message up.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Waiting {
    pub session: String,
    pub turn: String,
}

/// What ending a turn comes to.
#[derive(Debug)]
pub enum Settled {
    /// The turn is over and the thread is free.
    Over,
    /// Messages arrived as the turn ended well: it goes on with them.
    More(Vec<Queued>),
}

impl Chats {
    /// Queues `queued` for the running turn of `chat`. When no turn is
    /// running (it ended a moment ago), the message comes back.
    pub fn enqueue(&self, chat: &str, queued: Queued) -> Result<Waiting, Box<Queued>> {
        let mut inner = self.lock();
        let Some(turn) = inner.running.get(chat).map(|r| r.turn.clone()) else {
            return Err(Box::new(queued));
        };
        let Some(thread) = inner.threads.get_mut(chat) else {
            return Err(Box::new(queued));
        };
        thread.queue.push_back(queued);
        Ok(Waiting {
            session: thread.session.id.clone(),
            turn,
        })
    }

    /// What waits for the turn `turn` of `chat`, taken out of the queue.
    pub(super) fn drain_queue(&self, chat: &str, turn: &str) -> Vec<Queued> {
        let mut inner = self.lock();
        if !inner.running.get(chat).is_some_and(|r| r.turn == turn) {
            return Vec::new();
        }
        inner
            .threads
            .get_mut(chat)
            .map(|thread| thread.queue.drain(..).collect())
            .unwrap_or_default()
    }

    /// The thread's agent session.
    pub fn session_of(&self, chat: &str) -> Option<Session> {
        self.lock().threads.get(chat).map(|t| t.session.clone())
    }

    /// The texts waiting to be sent, for tests.
    #[cfg(test)]
    pub fn waiting(&self, chat: &str) -> Vec<String> {
        self.lock()
            .threads
            .get(chat)
            .map(|t| t.queue.iter().map(|q| q.text.clone()).collect())
            .unwrap_or_default()
    }

    /// Keeps the conversation after a step, and saves the thread.
    pub fn checkpoint(&self, chat: &str, turn: &str, messages: &[Message], plan: &[PlanItem]) {
        {
            let mut inner = self.lock();
            if !inner.running.get(chat).is_some_and(|r| r.turn == turn) {
                return;
            }
            let Some(thread) = inner.threads.get_mut(chat) else {
                return;
            };
            thread.messages = messages.to_vec();
            thread.plan = plan.to_vec();
            thread.updated = now_ms();
        }
        self.persist(chat);
    }

    /// Ends the turn `turn`. Its conversation is kept, unless the thread was
    /// reset while it ran. A turn that ended well while messages waited is
    /// not over: they are returned for it to go on with. Stopped, it
    /// drops what waited (Stop stops); paused or failed, what waits stays
    /// for the next step.
    pub fn settle(
        &self,
        chat: &str,
        turn: &str,
        kept: Option<(&Session, Vec<Message>, Vec<PlanItem>)>,
        ending: &Ending,
    ) -> Settled {
        let mut inner = self.lock();
        let ours = inner.running.get(chat).is_some_and(|r| r.turn == turn);
        let closing = inner.closing;
        if let Some(thread) = inner.threads.get_mut(chat) {
            if let Some((session, messages, plan)) = kept
                && thread.session.id == session.id
            {
                thread.messages = messages;
                thread.plan = plan;
            }
            if ours {
                if matches!(ending, Ending::Done { stopped: false })
                    && !thread.queue.is_empty()
                    && !closing
                {
                    return Settled::More(thread.queue.drain(..).collect());
                }
                if matches!(ending, Ending::Done { stopped: true }) {
                    thread.queue.clear();
                }
                thread.status = match (closing, ending) {
                    (true, _) => Status::Interrupted,
                    (_, Ending::Done { .. }) => Status::Idle,
                    (_, Ending::Error { .. }) => Status::Error,
                    (_, Ending::Paused { .. }) => Status::Paused,
                };
                thread.updated = now_ms();
            }
        }
        if ours {
            inner.running.remove(chat);
        }
        drop(inner);
        self.persist(chat);
        Settled::Over
    }

    /// Frees a thread whose turn was dropped half way.
    pub fn abort(&self, chat: &str, turn: &str) {
        let ending = Ending::Error {
            message: String::new(),
            kind: FailKind::Other,
        };
        self.settle(chat, turn, None, &ending);
    }

    /// The app is closing: every turn is stopped and its thread is saved as
    /// interrupted, so it can be picked up again.
    pub fn interrupt_all(&self) {
        let jobs: Vec<_> = {
            let mut inner = self.lock();
            inner.closing = true;
            let ids: Vec<String> = inner.running.keys().cloned().collect();
            for id in &ids {
                if let Some(run) = inner.running.get(id) {
                    run.cancel.store(true, Ordering::SeqCst);
                }
                if let Some(thread) = inner.threads.get_mut(id) {
                    thread.status = Status::Interrupted;
                }
            }
            ids.iter().filter_map(|id| inner.snapshot(id)).collect()
        };
        for (store, record) in jobs {
            let _ = store.save(&record);
        }
    }

    /// `events`, with every event of `chat` numbered and kept for `chat_state`.
    pub fn feed(&self, chat: &str, events: Arc<dyn Events>) -> Arc<dyn Events> {
        Arc::new(Feed {
            chats: self.clone(),
            chat: chat.to_owned(),
            events,
        })
    }

    fn stamp(&self, chat: &str, event: ChatEvent) -> ChatEvent {
        self.lock()
            .logs
            .entry(chat.to_owned())
            .or_default()
            .stamp(event)
    }
}

struct Feed {
    chats: Chats,
    chat: String,
    events: Arc<dyn Events>,
}

impl Events for Feed {
    fn emit(&self, event: ChatEvent) {
        let numbered = self.chats.stamp(&self.chat, event);
        self.events.emit(numbered);
    }
}

/// A running turn's view of its thread.
pub(super) struct Linked {
    pub chats: Chats,
    pub chat: String,
    pub turn: String,
}

impl Link for Linked {
    fn checkpoint(&self, messages: &[Message], plan: &[PlanItem]) {
        self.chats
            .checkpoint(&self.chat, &self.turn, messages, plan);
    }

    fn take_queued(&self) -> Vec<Queued> {
        self.chats.drain_queue(&self.chat, &self.turn)
    }
}
