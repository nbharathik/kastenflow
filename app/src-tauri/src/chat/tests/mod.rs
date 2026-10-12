//! The chat's tests: a private copy of the dev vault with history, a model
//! that answers from a script, and a list the turn's events go to. Nothing
//! here reaches a network beyond 127.0.0.1 or a real keychain.

mod chatgpt;
mod chatgpt_flow;
mod chatgpt_http;
mod check;
mod context;
mod decks;
mod drafts;
mod http;
mod providers;
mod requests;
mod responses;
mod responses_request;
mod script;
mod stops;
mod streams;
mod summary;
mod turns;
mod write;

use std::collections::VecDeque;
use std::fs;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use kasten_core::{Instant, Kasten, ulid_at};
use serde_json::Value;

use super::model::{Call, Failure, Message, Model, Reply, Stop, ToolCall};
use super::{ChatEvent, EventKind, Events};

/// A copy of `fixtures/dev-vault`, removed when dropped.
pub struct Vault {
    pub dir: PathBuf,
    pub kasten: Arc<Kasten>,
}

impl Drop for Vault {
    fn drop(&mut self) {
        // Only the test's own copy under the system temp folder.
        let _ = fs::remove_dir_all(&self.dir);
    }
}

fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), &target).unwrap();
        }
    }
}

/// The dev vault, copied, with history on unless `history` is false.
pub fn vault_with(history: bool) -> Vault {
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/dev-vault");
    let dir = std::env::temp_dir().join(format!("kasten-chat-{}", ulid_at(Instant::now().millis)));
    copy_dir(&source, &dir);
    let kasten = Kasten::open(&dir).unwrap();
    if history {
        kasten.start_history().unwrap();
    }
    Vault {
        dir,
        kasten: Arc::new(kasten),
    }
}

pub fn vault() -> Vault {
    vault_with(true)
}

/// Runs a future on a runtime of its own, as the app's would.
pub fn block_on<F: Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap()
        .block_on(future)
}

/// What the fake model does for one request.
pub enum Step {
    /// Answers with this text (streamed in two pieces) and these calls.
    Reply(&'static str, Vec<(&'static str, Value)>, Stop),
    Fail(&'static str),
    /// Streams this text, then waits until the turn is stopped.
    Hang(&'static str),
}

/// A model that answers from a script and keeps what it was sent.
#[derive(Default)]
pub struct Fake {
    script: Mutex<VecDeque<Step>>,
    pub requests: Mutex<Vec<(String, Vec<Message>)>>,
}

impl Fake {
    pub fn new(script: Vec<Step>) -> Arc<Fake> {
        Arc::new(Fake {
            script: Mutex::new(script.into()),
            requests: Mutex::default(),
        })
    }

    /// The messages of each request, in order.
    pub fn sent(&self) -> Vec<Vec<Message>> {
        let requests = self.requests.lock().unwrap();
        requests.iter().map(|(_, m)| m.clone()).collect()
    }

    pub fn systems(&self) -> Vec<String> {
        let requests = self.requests.lock().unwrap();
        requests.iter().map(|(s, _)| s.clone()).collect()
    }
}

impl Model for Arc<Fake> {
    async fn reply(
        &self,
        call: &Call<'_>,
        text: &(dyn Fn(&str) + Sync),
        cancel: &AtomicBool,
    ) -> Result<Reply, Failure> {
        let n = {
            let mut requests = self.requests.lock().unwrap();
            requests.push((call.system.to_owned(), call.messages.to_vec()));
            requests.len()
        };
        let step = self.script.lock().unwrap().pop_front();
        match step.unwrap_or(Step::Reply("Done.", vec![], Stop::End)) {
            Step::Reply(words, calls, stop) => {
                let (a, b) = words.split_at(words.len() / 2);
                for piece in [a, b].into_iter().filter(|p| !p.is_empty()) {
                    text(piece);
                }
                let calls = calls
                    .into_iter()
                    .enumerate()
                    .map(|(i, (name, input))| ToolCall {
                        id: format!("call_{n}_{i}"),
                        name: name.to_owned(),
                        arguments: input.to_string(),
                    })
                    .collect();
                Ok(Reply {
                    text: words.to_owned(),
                    calls,
                    stop,
                    blocks: None,
                    items: None,
                })
            }
            Step::Fail(message) => Err(Failure::new(message)),
            Step::Hang(words) => {
                text(words);
                while !cancel.load(Ordering::SeqCst) {
                    tokio::time::sleep(Duration::from_millis(5)).await;
                }
                Ok(Reply {
                    text: words.to_owned(),
                    calls: vec![],
                    stop: Stop::Cancelled,
                    blocks: None,
                    items: None,
                })
            }
        }
    }
}

type Hook = Box<dyn Fn(&ChatEvent) + Send + Sync>;

/// The events of a turn, in order; a hook may act on each as it comes.
#[derive(Default)]
pub struct Seen {
    events: Mutex<Vec<ChatEvent>>,
    hook: Option<Hook>,
}

impl Seen {
    pub fn new() -> Arc<Seen> {
        Arc::new(Seen::default())
    }

    pub fn with(hook: impl Fn(&ChatEvent) + Send + Sync + 'static) -> Arc<Seen> {
        Arc::new(Seen {
            events: Mutex::default(),
            hook: Some(Box::new(hook)),
        })
    }

    pub fn all(&self) -> Vec<ChatEvent> {
        self.events.lock().unwrap().clone()
    }

    pub fn of(&self, kind: EventKind) -> Vec<ChatEvent> {
        self.all().into_iter().filter(|e| e.kind == kind).collect()
    }

    /// The text the person saw.
    pub fn text(&self) -> String {
        self.of(EventKind::Text)
            .into_iter()
            .filter_map(|e| e.text)
            .collect()
    }

    /// The one event that ended the turn.
    pub fn last(&self) -> ChatEvent {
        self.all().last().cloned().unwrap()
    }
}

impl Events for Seen {
    fn emit(&self, event: ChatEvent) {
        if let Some(hook) = &self.hook {
            hook(&event);
        }
        self.events.lock().unwrap().push(event);
    }
}
