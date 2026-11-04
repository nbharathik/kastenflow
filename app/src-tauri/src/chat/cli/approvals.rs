//! The questions an agent has asked that wait for the person: the turn opens
//! one when the CLI asks, the window answers it with a button, and the turn
//! picks the answer up and passes it on. An answer for a question that is not
//! open (a stale card, another chat's id) changes nothing.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

/// What the person said.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Answer {
    pub allow: bool,
    /// Words for the CLI when the answer is no.
    pub message: Option<String>,
}

#[derive(Default)]
struct Slot {
    answer: Option<Answer>,
}

/// Every open question of every chat.
#[derive(Clone, Default)]
pub struct Approvals {
    open: Arc<Mutex<HashMap<(String, String), Slot>>>,
}

impl Approvals {
    fn lock(&self) -> MutexGuard<'_, HashMap<(String, String), Slot>> {
        self.open.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn key(chat: &str, id: &str) -> (String, String) {
        (chat.to_owned(), id.to_owned())
    }

    /// The CLI asked: the question is open.
    pub fn open(&self, chat: &str, id: &str) {
        self.lock().insert(Self::key(chat, id), Slot::default());
    }

    /// The person answered. Whether the question was open and had no answer yet.
    pub fn answer(&self, chat: &str, id: &str, allow: bool, message: Option<String>) -> bool {
        match self.lock().get_mut(&Self::key(chat, id)) {
            Some(slot) if slot.answer.is_none() => {
                slot.answer = Some(Answer { allow, message });
                true
            }
            _ => false,
        }
    }

    /// The answer, if there is one; the question is then closed.
    pub fn take(&self, chat: &str, id: &str) -> Option<Answer> {
        let mut open = self.lock();
        let key = Self::key(chat, id);
        if open.get(&key)?.answer.is_some() {
            return open.remove(&key)?.answer;
        }
        None
    }

    /// The question is over without an answer (withdrawn, or the run ended).
    pub fn close(&self, chat: &str, id: &str) {
        self.lock().remove(&Self::key(chat, id));
    }

    /// Every question of the chat is over.
    pub fn close_chat(&self, chat: &str) {
        self.lock().retain(|(c, _), _| c != chat);
    }

    /// How many questions of the chat wait.
    #[cfg(test)]
    pub fn waiting(&self, chat: &str) -> usize {
        self.lock().keys().filter(|(c, _)| c == chat).count()
    }
}
