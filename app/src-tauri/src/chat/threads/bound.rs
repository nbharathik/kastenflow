//! A thread's flags that the list and the pages care about (archived, bound
//! to a page) and how they change: in memory when the thread is open, else
//! in its saved file, so a thread nobody opened this run is changed too. A
//! binding is in the thread's head file; `thread_for` reads heads only.

use std::collections::HashMap;

use super::Chats;
use super::persist::stub;
use crate::chat::binding::{Binding, Imported, Move};
use crate::chat::store::{ThreadSummary, valid_id};

/// The flags that change without the conversation.
pub(super) struct Flags {
    pub archived: bool,
    pub bound: Option<Binding>,
    pub updated: u64,
}

impl Chats {
    /// Changes a thread's flags wherever it is. With `make`, a chat that is
    /// nowhere yet gets a saved record of its own for the flags. Whether
    /// there was a thread to change.
    pub(super) fn edit(
        &self,
        chat: &str,
        make: bool,
        change: impl FnOnce(&mut Flags),
    ) -> Result<bool, String> {
        if !valid_id(chat) {
            return Err(format!("“{chat}” cannot be the name of a saved chat"));
        }
        {
            let mut inner = self.lock();
            if let Some(thread) = inner.threads.get_mut(chat) {
                let mut flags = Flags {
                    archived: thread.archived,
                    bound: thread.bound.take(),
                    updated: thread.updated,
                };
                change(&mut flags);
                thread.archived = flags.archived;
                thread.bound = flags.bound;
                thread.updated = flags.updated;
                drop(inner);
                self.persist(chat);
                return Ok(true);
            }
        }
        let Some(store) = self.store() else {
            return Ok(false);
        };
        let mut record = match store.load(chat) {
            Some(record) => record,
            None if make => stub(chat),
            None => return Ok(false),
        };
        let mut flags = Flags {
            archived: record.archived,
            bound: record.bound.take(),
            updated: record.updated,
        };
        change(&mut flags);
        record.archived = flags.archived;
        record.bound = flags.bound;
        record.updated = flags.updated;
        record.rev = {
            let mut inner = self.lock();
            inner.rev += 1;
            inner.rev
        };
        store.save(&record)?;
        Ok(true)
    }

    fn heads_of(&self) -> Vec<ThreadSummary> {
        self.store().map(|s| s.list()).unwrap_or_default()
    }

    /// Ties the thread to `target`. Whatever thread was tied to it loses the
    /// tie (it stays in the list), and an archived thread comes back to the
    /// list. The threads that lost the tie come back. A chat with no saved
    /// file yet gets one.
    pub fn bind(&self, chat: &str, target: Binding) -> Result<Vec<String>, String> {
        let target = target.checked()?;
        let displaced: Vec<String> = self
            .heads_of()
            .into_iter()
            .filter(|t| t.id != chat && t.bound.as_ref().is_some_and(|b| b.same_as(&target)))
            .map(|t| t.id)
            .collect();
        for id in &displaced {
            self.edit(id, false, |flags| flags.bound = None)?;
        }
        self.edit(chat, true, |flags| {
            flags.bound = Some(target);
            flags.archived = false;
        })?;
        Ok(displaced)
    }

    /// Cuts the thread's tie. Whether it had one.
    pub fn unbind(&self, chat: &str) -> Result<bool, String> {
        let had = self
            .heads_of()
            .iter()
            .any(|t| t.id == chat && t.bound.is_some());
        if had {
            self.edit(chat, false, |flags| flags.bound = None)?;
        }
        Ok(had)
    }

    /// The thread tied to `target`: the latest if more than one is (an old
    /// file may say so), none if there is none.
    pub fn thread_for(&self, target: &Binding) -> Result<Option<ThreadSummary>, String> {
        let target = target.clone().checked()?;
        Ok(self
            .heads_of()
            .into_iter()
            .find(|t| t.bound.as_ref().is_some_and(|b| b.same_as(&target))))
    }

    /// Follows files that were renamed or moved: every binding whose path
    /// moved (or lies under a folder that did) now names the new path. How
    /// many threads changed.
    pub fn rebind(&self, moves: &[Move]) -> Result<usize, String> {
        let mut changed = 0;
        for thread in self.heads_of() {
            let Some(mut now) = thread.bound.clone() else {
                continue;
            };
            if now.moved(moves) {
                self.edit(&thread.id, false, |flags| flags.bound = Some(now))?;
                changed += 1;
            }
        }
        Ok(changed)
    }

    /// The one-time move of the window's remembered `path -> chat id` pairs
    /// (what it kept in the browser) into the threads' own files. Never
    /// overwrites: a thread that is tied already, or a target that has a
    /// thread, is left as it is, so running it twice does nothing more.
    pub fn import_bindings(&self, kind: &str, pairs: &HashMap<String, String>) -> Imported {
        let mut done = Imported::default();
        // In a steady order, so two entries for one target always come out the same.
        let mut pairs: Vec<(&String, &String)> = pairs.iter().collect();
        pairs.sort();
        for (path, chat) in pairs {
            let known = self.heads_of().into_iter().find(|t| &t.id == chat);
            let Some(known) = known else {
                done.missing += 1;
                continue;
            };
            let target = Binding {
                kind: kind.to_owned(),
                path: path.clone(),
                id: None,
            };
            let free = known.bound.is_none() && self.thread_for(&target).is_ok_and(|t| t.is_none());
            if free && self.bind(chat, target).is_ok() {
                done.bound += 1;
            } else {
                done.kept += 1;
            }
        }
        done
    }
}
