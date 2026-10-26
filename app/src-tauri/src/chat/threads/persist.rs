//! Saving and bringing back threads. A thread is written to the store after
//! every step of a turn and when it ends; a thread that is not in memory (the
//! app was closed, the window was reloaded) is rebuilt from its file the first
//! time something asks for it, so it can be read, sent to and continued.

use std::sync::Arc;

use kasten_core::agent::{ChangeSet, Session};
use kasten_core::{Instant, Kasten, ulid_at};
use serde::Serialize;
use serde_json::Value;

use super::{AdoptFailed, AdoptReason, Chats, Inner, Thread, new_thread, now_ms};
use crate::chat::attach::Attachments;
use crate::chat::binding::Binding;
use crate::chat::event::Log;
use crate::chat::plan::PlanItem;
use crate::chat::store::{MAX_UI_BYTES, Record, Status, Store, VERSION, title_from};
use crate::chat::{CLIENT, ChatRequest, WriteMode};

/// The longest title kept.
const TITLE: usize = 80;

/// What `chat_load` answers.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Loaded {
    /// What the window saved with `chat_save_ui`.
    pub ui: Option<Value>,
    pub status: Status,
    /// The event number the saved screen is up to date with: replay from here.
    pub seq: u64,
    pub plan: Vec<PlanItem>,
    pub title: String,
    pub provider: String,
    pub model: String,
    /// Messages sent but not yet taken up by a turn.
    pub queued: Vec<String>,
    /// Older than the list's size.
    pub archived: bool,
    /// What the thread is tied to, if anything.
    pub bound: Option<Binding>,
    /// Events the window can no longer get from `chat_state`: it holds the
    /// saved screen up to `seq`, and the numbers after it up to the end of
    /// this range are gone. The screen (`ui`) is then the best there is; the
    /// conversation itself is whole.
    pub gap: Option<Gap>,
}

/// A run of event numbers, first to last, that were not kept.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Gap {
    pub from: u64,
    pub to: u64,
}

fn titled(text: &str) -> String {
    let text = text.trim();
    match text.char_indices().nth(TITLE) {
        Some((at, _)) => format!("{}…", text[..at].trim_end()),
        None => text.to_owned(),
    }
}

impl Inner {
    /// The thread as a record to save, with the store to save it in; none
    /// without a store or a thread.
    pub(super) fn snapshot(&mut self, chat: &str) -> Option<(Arc<Store>, Record)> {
        let store = self.store.clone()?;
        self.rev += 1;
        let rev = self.rev;
        let seq = self.logs.get(chat).map_or(0, Log::seq);
        let thread = self.threads.get(chat)?;
        let set = thread
            .changes
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .id
            .clone();
        let record = Record {
            version: VERSION,
            id: chat.to_owned(),
            title: thread.title.clone(),
            created: thread.created,
            updated: thread.updated,
            status: thread.status,
            provider: thread.provider.clone(),
            model: thread.model.clone(),
            settings: thread.settings.clone(),
            writes: thread.writes,
            session: thread.session.clone(),
            system: thread.system.clone(),
            day: thread.day.clone(),
            messages: thread.messages.clone(),
            plan: thread.plan.clone(),
            seq,
            change_set: Some(set),
            ui: thread.ui.clone(),
            attachments: thread.attachments.iter().cloned().collect(),
            archived: thread.archived,
            bound: thread.bound.clone(),
            rev,
        };
        Some((store, record))
    }
}

/// A thread rebuilt from its record. Its staged changes are read from the
/// vault's cache when they are there.
fn rebuilt(record: Record, kasten: &Kasten, files: Option<&Arc<Attachments>>) -> Thread {
    let now = Instant::now();
    let mut messages = record.messages;
    if let Some(files) = files {
        files.restore_pictures(&mut messages);
    }
    let set = record
        .change_set
        .as_deref()
        .and_then(|id| kasten.load_changes(id).ok())
        .unwrap_or_else(|| {
            let id = record
                .change_set
                .clone()
                .unwrap_or_else(|| ulid_at(now.millis));
            ChangeSet::new(id, &record.session.id, &record.session.client, now.millis)
        });
    let mut thread = new_thread(now, &record.day, record.system);
    thread.session = record.session;
    thread.messages = messages;
    thread.changes = Arc::new(std::sync::Mutex::new(set));
    thread.plan = record.plan;
    // Found working (or waiting) with nothing working: the app closed on it.
    thread.status = if record.status.was_working() {
        Status::Interrupted
    } else {
        record.status
    };
    thread.archived = record.archived;
    thread.bound = record.bound;
    thread.created = record.created;
    thread.updated = record.updated;
    thread.title = record.title;
    thread.provider = record.provider;
    thread.model = record.model;
    thread.settings = record.settings;
    thread.writes = record.writes;
    thread.ui = record.ui;
    thread.attachments = record.attachments.into_iter().collect();
    thread
}

/// A record for a chat that has only a screen so far.
pub(super) fn stub(chat: &str) -> Record {
    let now = Instant::now();
    Record {
        version: VERSION,
        id: chat.to_owned(),
        title: String::new(),
        created: now.millis,
        updated: now.millis,
        status: Status::Idle,
        provider: String::new(),
        model: String::new(),
        settings: None,
        writes: WriteMode::default(),
        session: Session::start(CLIENT, now),
        system: String::new(),
        day: String::new(),
        messages: Vec::new(),
        plan: Vec::new(),
        seq: 0,
        change_set: None,
        ui: None,
        attachments: Vec::new(),
        archived: false,
        bound: None,
        rev: 0,
    }
}

impl Chats {
    /// Saves threads in `store` from now on. Threads that were working when
    /// the app last closed are marked interrupted.
    pub fn use_store(&self, store: Arc<Store>, files: Option<Arc<Attachments>>) {
        store.interrupt_the_working();
        {
            let mut inner = self.lock();
            inner.store = Some(store);
            inner.files = files;
            inner.closing = false;
        }
        // A smaller list size than before archives the oldest threads; nothing is deleted.
        self.archive_overflow();
    }

    pub fn store(&self) -> Option<Arc<Store>> {
        self.lock().store.clone()
    }

    pub fn files(&self) -> Option<Arc<Attachments>> {
        self.lock().files.clone()
    }

    /// Writes the thread to the store, if there is one.
    pub(super) fn persist(&self, chat: &str) {
        let job = self.lock().snapshot(chat);
        if let Some((store, record)) = job {
            let _ = store.save(&record);
        }
    }

    /// What a new message tells about the thread: the model it is asked of,
    /// what it was set to, how it writes, and the attachments it refers to.
    /// The thread is working from now on.
    pub fn started(&self, chat: &str, request: &ChatRequest, attachments: &[String]) {
        {
            let mut inner = self.lock();
            let Some(thread) = inner.threads.get_mut(chat) else {
                return;
            };
            thread.provider = request.provider.clone();
            thread.model = request.model.clone();
            thread.settings = request.settings.clone();
            thread.writes = request.writes;
            if thread.title.is_empty() {
                thread.title = titled(&title_from(&request.text));
            }
            thread.attachments.extend(attachments.iter().cloned());
            thread.status = Status::Running;
            thread.updated = now_ms();
            // Writing in an archived chat brings it back to the list.
            thread.archived = false;
        }
        self.persist(chat);
        // The list holds its size: the oldest threads beyond it are archived, never deleted.
        self.archive_overflow();
    }

    /// Brings the thread back from the store if it is not in memory. Whether
    /// it is there now.
    pub fn ensure_loaded(&self, chat: &str, kasten: &Kasten) -> bool {
        self.adopt(chat, kasten).is_ok()
    }

    /// `ensure_loaded`, saying why a thread could not be brought back.
    pub fn adopt(&self, chat: &str, kasten: &Kasten) -> Result<(), AdoptFailed> {
        let (store, files) = {
            let inner = self.lock();
            if inner.threads.contains_key(chat) {
                return Ok(());
            }
            (inner.store.clone(), inner.files.clone())
        };
        let Some(store) = store else {
            return Err(AdoptFailed::new(AdoptReason::Missing));
        };
        let record = store.load_checked(chat).map_err(AdoptFailed::from)?;
        let seq = record.seq;
        let thread = rebuilt(record, kasten, files.as_ref());
        let mut inner = self.lock();
        inner.threads.entry(chat.to_owned()).or_insert(thread);
        inner.logs.entry(chat.to_owned()).or_default().at_least(seq);
        Ok(())
    }

    /// What the window needs to show a saved thread again. A thread that
    /// cannot be brought back is an `AdoptFailed`, never an empty new one.
    pub fn loaded(&self, chat: &str, kasten: &Kasten) -> Result<Loaded, AdoptFailed> {
        self.adopt(chat, kasten)?;
        let inner = self.lock();
        let thread = inner
            .threads
            .get(chat)
            .ok_or_else(|| AdoptFailed::new(AdoptReason::Missing))?;
        let live = inner.logs.get(chat).map_or(0, Log::seq);
        // The screen was saved up to the event it says; else up to the last.
        let seq = thread
            .ui
            .as_ref()
            .and_then(|ui| ui["seq"].as_u64())
            .unwrap_or(live);
        // Events after the screen that the ring no longer holds.
        let gap = inner
            .logs
            .get(chat)
            .and_then(|log| log.missing_after(seq))
            .map(|(from, to)| Gap { from, to });
        Ok(Loaded {
            ui: thread.ui.clone(),
            status: thread.status,
            seq,
            plan: thread.plan.clone(),
            title: thread.title.clone(),
            provider: thread.provider.clone(),
            model: thread.model.clone(),
            queued: thread.queue.iter().map(|q| q.text.clone()).collect(),
            archived: thread.archived,
            bound: thread.bound.clone(),
            gap,
        })
    }

    /// Keeps the window's own picture of the thread. A chat that has not been
    /// sent anything yet is kept too, with only that.
    pub fn save_ui(&self, chat: &str, ui: Value) -> Result<(), String> {
        let size = serde_json::to_vec(&ui).map_or(0, |bytes| bytes.len());
        if size > MAX_UI_BYTES {
            return Err(format!(
                "This chat is too long to keep as it is on screen (the most is {} MB)",
                MAX_UI_BYTES / 1024 / 1024
            ));
        }
        let title = ui["title"]
            .as_str()
            .map(titled)
            .filter(|title| !title.is_empty());
        let in_memory = {
            let mut inner = self.lock();
            match inner.threads.get_mut(chat) {
                Some(thread) => {
                    thread.ui = Some(ui.clone());
                    if let Some(title) = &title {
                        thread.title = title.clone();
                    }
                    true
                }
                None => false,
            }
        };
        if in_memory {
            self.persist(chat);
            return Ok(());
        }
        let Some(store) = self.store() else {
            return Ok(());
        };
        let mut record = store.load(chat).unwrap_or_else(|| stub(chat));
        record.ui = Some(ui);
        if let Some(title) = title {
            record.title = title;
        }
        record.rev = {
            let mut inner = self.lock();
            inner.rev += 1;
            inner.rev
        };
        store.save(&record)
    }
}
