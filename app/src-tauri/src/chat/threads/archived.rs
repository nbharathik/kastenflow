//! The chat list's size and the threads past it. The oldest threads beyond
//! `chat.list_size` are archived (a flag in their head file: still saved,
//! searchable, reopenable); a thread is deleted only when the person names
//! archived ones to delete. Starting a new thread keeps the old one.

use std::collections::HashSet;

use kasten_core::{Instant, Kasten, ulid_at};
use serde::Serialize;

use super::Chats;
use crate::chat::archive::{Candidate, Deleted, Skipped, overflow};
use crate::chat::binding::Binding;

/// What `chat_new_thread` answers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewThread {
    /// The new thread's name; its file is made with its first message.
    pub id: String,
    /// What it took over from the thread it replaces: a page's chat stays that
    /// page's chat, now the new one.
    pub bound: Option<Binding>,
}

impl Chats {
    /// Archives the oldest threads beyond the list's size. The ids archived.
    /// This only sets a flag; no thread is removed.
    pub fn archive_overflow(&self) -> Vec<String> {
        let (cap, running) = {
            let inner = self.lock();
            let running: HashSet<String> = inner.running.keys().cloned().collect();
            (inner.limits.list_size, running)
        };
        let Some(store) = self.store() else {
            return Vec::new();
        };
        let all: Vec<Candidate> = store
            .heads()
            .iter()
            .map(|head| Candidate::of(head, running.contains(&head.summary.id)))
            .collect();
        let mut done = Vec::new();
        for id in overflow(&all, cap) {
            if matches!(
                self.edit(&id, false, |flags| flags.archived = true),
                Ok(true)
            ) {
                done.push(id);
            }
        }
        done
    }

    /// Moves a thread to the Archived section at the person's request. It
    /// stays saved and can come back with `unarchive`; nothing is deleted. A
    /// tie to a page is cut, as the thread leaves the list. A thread that is
    /// working is refused. Whether there was such a thread.
    pub fn archive(&self, chat: &str) -> Result<bool, String> {
        if self.lock().running.contains_key(chat) {
            return Err("This chat is still answering; stop it first".to_owned());
        }
        self.edit(chat, false, |flags| {
            flags.archived = true;
            flags.bound = None;
        })
    }

    /// Brings an archived thread back to the top of the list, which may
    /// archive the oldest in its place. Whether there was such a thread.
    pub fn unarchive(&self, chat: &str) -> Result<bool, String> {
        let now = Instant::now().millis;
        let had = self.edit(chat, false, |flags| {
            flags.archived = false;
            flags.updated = now;
        })?;
        if had {
            self.archive_overflow();
        }
        Ok(had)
    }

    /// Deletes the archived threads in `ids` and no others: the person's
    /// own action. One that is not archived, is working, or has changes
    /// waiting for review stays, with the reason.
    pub fn delete_archived(&self, ids: &[String], kasten: &Kasten) -> Deleted {
        let archived: HashSet<String> = self
            .store()
            .map(|s| {
                s.list()
                    .into_iter()
                    .filter(|t| t.archived)
                    .map(|t| t.id)
                    .collect()
            })
            .unwrap_or_default();
        let known: HashSet<String> = self.list().into_iter().map(|t| t.id).collect();
        let mut out = Deleted::default();
        let mut seen = HashSet::new();
        for id in ids {
            if !seen.insert(id.clone()) {
                continue;
            }
            let why = if !known.contains(id) {
                Some("There is no saved chat with that name".to_owned())
            } else if !archived.contains(id) {
                Some("Only archived chats can be deleted this way".to_owned())
            } else {
                self.delete_thread(id, kasten).err()
            };
            match why {
                None => out.deleted.push(id.clone()),
                Some(reason) => out.skipped.push(Skipped {
                    id: id.clone(),
                    reason,
                }),
            }
        }
        out.count = out.deleted.len();
        out
    }

    /// Starts a new thread and keeps the old one: a name for the window to
    /// use for its next message. A thread tied to a page hands the tie to the
    /// new one (the old one stays in the list, untied). Nothing is deleted
    /// or reset, and a turn working in the old thread goes on.
    pub fn new_thread(&self, from: Option<&str>) -> Result<NewThread, String> {
        let id = format!(
            "chat-{}",
            ulid_at(Instant::now().millis).to_ascii_lowercase()
        );
        let tie = from.and_then(|old| {
            self.list()
                .into_iter()
                .find(|t| t.id == old)
                .and_then(|t| t.bound)
        });
        if let Some(target) = &tie {
            self.bind(&id, target.clone())?;
        }
        self.archive_overflow();
        Ok(NewThread { id, bound: tie })
    }
}
