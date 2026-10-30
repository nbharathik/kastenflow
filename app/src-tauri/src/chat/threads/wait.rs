//! Waiting for a place at work: as many chats work at once as
//! `chat.max_concurrent` allows, and the next turn waits in line, says so
//! (a `waiting` event and the thread's `waiting` status), and begins (a
//! `started` event) when a place is free. A turn is never refused for it.

use std::sync::atomic::AtomicBool;

use super::Chats;
use crate::chat::event::{ChatEvent, EventKind, Events};
use crate::chat::limit::Permit;
use crate::chat::store::Status;

/// What the window shows while a turn waits.
pub const WAITING: &str = "Waiting for another chat to finish";

impl Chats {
    /// Marks the running turn `turn` as waiting (or not). A stale turn is ignored.
    fn mark_waiting(&self, chat: &str, turn: &str, waiting: bool) {
        {
            let mut inner = self.lock();
            if !inner.running.get(chat).is_some_and(|r| r.turn == turn) {
                return;
            }
            if let Some(thread) = inner.threads.get_mut(chat) {
                thread.status = if waiting {
                    Status::Waiting
                } else {
                    Status::Running
                };
            }
        }
        self.persist(chat);
    }

    /// A place at work for the turn `turn` of `chat`, once one is free; none
    /// if the turn was stopped while it waited. The place is given back when
    /// the permit is dropped.
    pub(super) async fn take_place(
        &self,
        events: &dyn Events,
        chat: &str,
        turn: &str,
        stop: &AtomicBool,
    ) -> Option<Permit> {
        let gate = self.gate();
        let mut waited = false;
        let permit = gate
            .enter(chat, stop, |place| {
                waited = true;
                self.mark_waiting(chat, turn, true);
                let mut event = ChatEvent::new(chat, turn, EventKind::Waiting);
                event.n = Some(u32::try_from(place).unwrap_or(u32::MAX));
                event.text = Some(WAITING.to_owned());
                events.emit(event);
            })
            .await?;
        if waited {
            self.mark_waiting(chat, turn, false);
            events.emit(ChatEvent::new(chat, turn, EventKind::Started));
        }
        Some(permit)
    }
}
