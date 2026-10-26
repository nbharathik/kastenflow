//! The build service: requests go to the scheduler, each build it starts
//! runs on a thread of its own, and every step is told to the window as a
//! `latex-build` event. What a build actually does is the host's (`Host`),
//! so the service can be tested with a build that is only a fake.

use std::collections::{HashMap, VecDeque};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use serde::Serialize;

use super::log::Diagnostic;
use super::scheduler::{Action, GLOBAL_CAP, Scheduler};

/// The event the window hears builds through.
pub const EVENT: &str = "latex-build";

/// Why a build did not work, in a sentence, with what to do about it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BuildError {
    /// plugin-off, no-document, bad-request, no-engine, timeout, engine-failed,
    /// snapshot or internal.
    pub kind: &'static str,
    pub message: String,
    /// install-tectonic or install-tex, when one of them is the fix.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next: Option<&'static str>,
}

impl BuildError {
    pub fn new(kind: &'static str, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            next: None,
        }
    }
}

/// One step of a build, as the window hears it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    /// The document's folder.
    pub doc: String,
    pub seq: u64,
    /// queued, running, done, failed or cancelled.
    pub state: &'static str,
    pub ms: u64,
    pub diagnostics: Vec<Diagnostic>,
    /// This build made a PDF (read it with `latex_read_pdf`).
    pub pdf: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<BuildError>,
    /// What a running build is doing, when it takes long.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

impl Event {
    pub fn of(doc: &str, seq: u64, state: &'static str) -> Event {
        Event {
            doc: doc.to_owned(),
            seq,
            state,
            ms: 0,
            diagnostics: Vec::new(),
            pdf: false,
            error: None,
            note: None,
        }
    }
}

/// How a build ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Ended {
    Done,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Outcome {
    pub ended: Ended,
    pub ms: u64,
    pub diagnostics: Vec<Diagnostic>,
    pub pdf: bool,
    pub error: Option<BuildError>,
}

impl Outcome {
    pub fn failed(error: BuildError, ms: u64) -> Outcome {
        Outcome {
            ended: Ended::Failed,
            ms,
            diagnostics: Vec::new(),
            pdf: false,
            error: Some(error),
        }
    }
}

/// What the service needs from outside: building, telling, the time.
pub trait Host: Send + Sync + 'static {
    type Job: Send + 'static;
    /// Builds. Stops early, with `Cancelled`, when `cancel` is set. `note`
    /// tells the window what is going on.
    fn run(&self, job: &Self::Job, cancel: &AtomicBool, note: &dyn Fn(&str)) -> Outcome;
    fn emit(&self, event: &Event);
    /// Milliseconds on a clock that only goes forward.
    fn now_ms(&self) -> u64;
}

struct Inner<J> {
    scheduler: Scheduler<J>,
    /// The cancel flag of each running build.
    flags: HashMap<(String, u64), Arc<AtomicBool>>,
}

pub struct Service<H: Host> {
    host: H,
    inner: Mutex<Inner<H::Job>>,
}

impl<H: Host> Service<H> {
    pub fn new(host: H) -> Arc<Self> {
        Self::with_cap(host, GLOBAL_CAP)
    }

    pub fn with_cap(host: H, cap: usize) -> Arc<Self> {
        Arc::new(Self {
            host,
            inner: Mutex::new(Inner {
                scheduler: Scheduler::new(cap),
                flags: HashMap::new(),
            }),
        })
    }

    fn lock(&self) -> MutexGuard<'_, Inner<H::Job>> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Tells the window. A listener that panics must not stop the service
    /// half way through a change (a build left "running" for good, a place
    /// never freed), so the panic ends here.
    fn tell(&self, event: &Event) {
        let _ = catch_unwind(AssertUnwindSafe(|| self.host.emit(event)));
    }

    /// Asks for a build of `doc`; answers its number. The window hears it
    /// queued, then running, then how it ended.
    pub fn submit(self: &Arc<Self>, doc: &str, job: H::Job) -> u64 {
        let mut inner = self.lock();
        let (seq, actions) = inner.scheduler.submit(doc, job, self.host.now_ms());
        self.tell(&Event::of(doc, seq, "queued"));
        self.apply(&mut inner, actions);
        seq
    }

    /// Stops the build of `doc` and forgets the one waiting.
    pub fn cancel(self: &Arc<Self>, doc: &str) {
        let mut inner = self.lock();
        let actions = inner.scheduler.cancel(doc);
        self.apply(&mut inner, actions);
    }

    /// Does what the scheduler decided. Events are told with the lock held,
    /// so the window always hears one document's builds in order.
    fn apply(self: &Arc<Self>, inner: &mut Inner<H::Job>, actions: Vec<Action<H::Job>>) {
        let mut todo: VecDeque<Action<H::Job>> = actions.into();
        while let Some(action) = todo.pop_front() {
            match action {
                Action::Kill { doc, seq } => {
                    if let Some(flag) = inner.flags.get(&(doc, seq)) {
                        flag.store(true, Ordering::Relaxed);
                    }
                }
                Action::Drop { doc, seq } => {
                    self.tell(&Event::of(&doc, seq, "cancelled"));
                }
                Action::Start { doc, seq, job } => {
                    let flag = Arc::new(AtomicBool::new(false));
                    inner.flags.insert((doc.clone(), seq), Arc::clone(&flag));
                    self.tell(&Event::of(&doc, seq, "running"));
                    let me = Arc::clone(self);
                    let name = doc.clone();
                    let started = std::thread::Builder::new()
                        .name("latex-build".to_owned())
                        .spawn(move || me.work(&name, seq, &job, &flag));
                    if started.is_err() {
                        // No thread to build on: the build fails, and the next may start.
                        inner.flags.remove(&(doc.clone(), seq));
                        let error = BuildError::new(
                            "internal",
                            "KastenFlow could not start a build just now",
                        );
                        self.tell(&finished_event(&doc, seq, Outcome::failed(error, 0)));
                        let now = self.host.now_ms();
                        todo.extend(inner.scheduler.finished(&doc, seq, now));
                    }
                }
            }
        }
    }

    /// The body of a build's thread.
    fn work(self: &Arc<Self>, doc: &str, seq: u64, job: &H::Job, flag: &Arc<AtomicBool>) {
        let note = |text: &str| {
            let mut event = Event::of(doc, seq, "running");
            event.note = Some(text.to_owned());
            self.tell(&event);
        };
        let ran = catch_unwind(AssertUnwindSafe(|| self.host.run(job, flag, &note)));
        let mut outcome = ran.unwrap_or_else(|_| {
            Outcome::failed(
                BuildError::new("internal", "The build stopped unexpectedly"),
                0,
            )
        });
        let mut inner = self.lock();
        // A build told to stop is over for the window, whatever it managed
        // to do first: a newer one is coming, or the person cancelled. The
        // flag is only ever set with the lock held, so looking at it now
        // leaves no moment in which a cancel could still slip by.
        if flag.load(Ordering::Relaxed) {
            outcome = Outcome {
                ended: Ended::Cancelled,
                ms: outcome.ms,
                diagnostics: Vec::new(),
                pdf: false,
                error: None,
            };
        }
        self.tell(&finished_event(doc, seq, outcome));
        inner.flags.remove(&(doc.to_owned(), seq));
        let actions = inner.scheduler.finished(doc, seq, self.host.now_ms());
        self.apply(&mut inner, actions);
    }
}

fn finished_event(doc: &str, seq: u64, outcome: Outcome) -> Event {
    Event {
        doc: doc.to_owned(),
        seq,
        state: match outcome.ended {
            Ended::Done => "done",
            Ended::Failed => "failed",
            Ended::Cancelled => "cancelled",
        },
        ms: outcome.ms,
        diagnostics: outcome.diagnostics,
        pdf: outcome.pdf,
        error: outcome.error,
        note: None,
    }
}
