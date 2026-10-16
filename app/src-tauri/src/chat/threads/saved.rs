//! What a window asks of the saved threads besides loading one: the events it
//! missed, going on with a thread, the list, how much room the saved chats
//! take, and removing one when the person says so. Nothing here (or anywhere
//! in the saved chats) removes anything on its own.

use kasten_core::Kasten;
use serde::Serialize;

use super::Chats;
use crate::chat::WriteMode;
use crate::chat::capabilities::GenerationSettings;
use crate::chat::event::ChatEvent;
#[cfg(test)]
use crate::chat::plan::PlanItem;
use crate::chat::store::{Status, ThreadSummary};

/// What `chat_usage` answers: how much room the saved chats of the vault
/// take. Only a report, for the window to offer to delete old chats with.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatUsage {
    /// Saved chats.
    pub threads: usize,
    /// The size of their files.
    pub thread_bytes: u64,
    /// The size of their attachments.
    pub attachment_bytes: u64,
    /// Both together.
    pub total_bytes: u64,
}

/// What `chat_state` answers.
#[derive(Debug, Clone, Serialize)]
pub struct StateOf {
    pub status: Status,
    pub seq: u64,
    pub events: Vec<ChatEvent>,
    pub gap: bool,
}

/// What it takes to go on with a thread.
#[derive(Debug, Clone)]
pub struct Resume {
    pub provider: String,
    pub model: String,
    pub settings: Option<GenerationSettings>,
    pub writes: WriteMode,
    pub status: Status,
    /// The conversation holds something to go on from.
    pub started: bool,
}

impl Chats {
    /// The thread's events after number `since`, and where it stands.
    pub fn state(&self, chat: &str, since: u64) -> StateOf {
        let (status, saved_seq, log) = {
            let inner = self.lock();
            let status = inner.threads.get(chat).map(|t| t.status);
            let saved = inner.store.clone();
            let live = inner.logs.get(chat).map(|l| (l.seq(), l.since(since)));
            drop(inner);
            match (status, live) {
                (Some(status), Some((seq, log))) => (status, seq, Some(log)),
                (Some(status), None) => (status, 0, None),
                (None, live) => {
                    // Not in memory: what the store has, no events.
                    let record = saved.and_then(|s| s.load(chat));
                    let status = record.as_ref().map_or(Status::Idle, |r| match r.status {
                        Status::Running => Status::Interrupted,
                        other => other,
                    });
                    let seq = live.map_or(record.as_ref().map_or(0, |r| r.seq), |(seq, _)| seq);
                    (status, seq, None)
                }
            }
        };
        let (events, gap) = match log {
            Some(log) => (log.events, log.gap),
            None => (Vec::new(), saved_seq > since),
        };
        StateOf {
            status,
            seq: saved_seq,
            events,
            gap,
        }
    }

    /// What it takes to go on with the thread, if it has something to go on from.
    pub fn resume_facts(&self, chat: &str, kasten: &Kasten) -> Option<Resume> {
        self.ensure_loaded(chat, kasten);
        let inner = self.lock();
        let thread = inner.threads.get(chat)?;
        Some(Resume {
            provider: thread.provider.clone(),
            model: thread.model.clone(),
            settings: thread.settings.clone(),
            writes: thread.writes,
            status: thread.status,
            started: !thread.messages.is_empty(),
        })
    }

    /// The thread's plan, for tests.
    #[cfg(test)]
    pub fn plan(&self, chat: &str) -> Vec<PlanItem> {
        self.lock()
            .threads
            .get(chat)
            .map(|t| t.plan.clone())
            .unwrap_or_default()
    }

    /// The saved threads, newest first.
    pub fn list(&self) -> Vec<ThreadSummary> {
        self.store().map(|s| s.list()).unwrap_or_default()
    }

    /// Takes the thread out of memory and the store, and its attachments
    /// that nothing else uses. The attachments' ids come back.
    pub fn forget_saved(&self, chat: &str) -> Vec<String> {
        let ids: Vec<String> = {
            let inner = self.lock();
            inner
                .threads
                .get(chat)
                .map(|t| t.attachments.iter().cloned().collect())
                .unwrap_or_default()
        };
        let (store, files) = {
            let mut inner = self.lock();
            inner.logs.remove(chat);
            (inner.store.clone(), inner.files.clone())
        };
        let Some(store) = store else {
            return ids;
        };
        // What the saved copy refers to counts too, if the thread was not in memory.
        let mut ids = ids;
        if let Some(record) = store.load(chat) {
            ids.extend(record.attachments);
        }
        store.delete(chat);
        if let Some(files) = files {
            let used = store.referenced_attachments();
            for id in &ids {
                files.drop_unused(id, &used);
            }
        }
        ids
    }

    /// Deletes a saved thread the person no longer wants. Refused while it
    /// works or has changes waiting for review.
    pub fn delete_thread(&self, chat: &str, kasten: &Kasten) -> Result<(), String> {
        self.ensure_loaded(chat, kasten);
        {
            let inner = self.lock();
            if inner.running.contains_key(chat) {
                return Err("This chat is still answering; stop it first".to_owned());
            }
            if let Some(thread) = inner.threads.get(chat)
                && !thread
                    .changes
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .is_empty()
            {
                return Err(
                    "This chat has changes waiting for review. Apply or discard them first"
                        .to_owned(),
                );
            }
        }
        self.drop_thread(chat);
        self.forget_saved(chat);
        Ok(())
    }

    /// Notes attachments the thread now refers to (a queued message's).
    pub fn refer_to(&self, chat: &str, ids: &[String]) {
        if let Some(thread) = self.lock().threads.get_mut(chat) {
            thread.attachments.extend(ids.iter().cloned());
        }
    }

    /// How much room the saved chats and their attachments take. Only a
    /// report: nothing is removed because of it.
    pub fn usage(&self) -> ChatUsage {
        let used = self.store().map(|s| s.usage());
        let thread_bytes = used.map_or(0, |u| u.bytes);
        let attachment_bytes = self.files().map_or(0, |f| f.total());
        ChatUsage {
            threads: used.map_or(0, |u| u.threads),
            thread_bytes,
            attachment_bytes,
            total_bytes: thread_bytes + attachment_bytes,
        }
    }
}
