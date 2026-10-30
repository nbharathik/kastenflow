//! The build service with a build that is only a fake: what the window hears,
//! and in which order, when requests come in quickly. The fake build waits at
//! a gate the test opens, and notices when it is told to stop.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use crate::plugins::latex::service::{BuildError, Ended, Event, Host, Outcome, Service};

#[derive(Default)]
struct Gate {
    open: Mutex<bool>,
    changed: Condvar,
}

impl Gate {
    fn open(&self) {
        *self.open.lock().unwrap() = true;
        self.changed.notify_all();
    }
}

struct FakeJob {
    name: &'static str,
    gate: Arc<Gate>,
    panics: bool,
    note: bool,
}

fn job(name: &'static str) -> (FakeJob, Arc<Gate>) {
    let gate = Arc::new(Gate::default());
    let job = FakeJob {
        name,
        gate: Arc::clone(&gate),
        panics: false,
        note: false,
    };
    (job, gate)
}

#[derive(Default)]
struct Shared {
    clock: AtomicU64,
    started: Mutex<Vec<&'static str>>,
}

struct Fake {
    shared: Arc<Shared>,
    events: Mutex<Sender<Event>>,
}

impl Host for Fake {
    type Job = FakeJob;

    fn run(&self, job: &FakeJob, cancel: &AtomicBool, note: &dyn Fn(&str)) -> Outcome {
        self.shared.started.lock().unwrap().push(job.name);
        if job.panics {
            panic!("the fake build breaks");
        }
        if job.note {
            note("Downloading TeX packages…");
        }
        let mut open = job.gate.open.lock().unwrap();
        while !*open {
            if cancel.load(Ordering::Relaxed) {
                // A build that was told to stop but finished anyway: the
                // service still calls it cancelled.
                return Outcome {
                    ended: Ended::Done,
                    ms: 1,
                    diagnostics: Vec::new(),
                    pdf: true,
                    error: None,
                };
            }
            open = job
                .gate
                .changed
                .wait_timeout(open, Duration::from_millis(5))
                .unwrap()
                .0;
        }
        Outcome {
            ended: Ended::Done,
            ms: 7,
            diagnostics: Vec::new(),
            pdf: true,
            error: None,
        }
    }

    fn emit(&self, event: &Event) {
        let _ = self.events.lock().unwrap().send(event.clone());
    }

    fn now_ms(&self) -> u64 {
        self.shared.clock.load(Ordering::Relaxed)
    }
}

fn service() -> (Arc<Service<Fake>>, Arc<Shared>, Receiver<Event>) {
    service_with_cap(2)
}

fn service_with_cap(cap: usize) -> (Arc<Service<Fake>>, Arc<Shared>, Receiver<Event>) {
    let shared = Arc::new(Shared::default());
    let (tx, rx) = mpsc::channel();
    let fake = Fake {
        shared: Arc::clone(&shared),
        events: Mutex::new(tx),
    };
    (Service::with_cap(fake, cap), shared, rx)
}

/// The next event: (document, number, state).
fn next(rx: &Receiver<Event>) -> (String, u64, &'static str) {
    let event = rx
        .recv_timeout(Duration::from_secs(20))
        .expect("an event within 20 seconds");
    (event.doc, event.seq, event.state)
}

fn expect(rx: &Receiver<Event>, wanted: &[(&str, u64, &str)]) {
    for (doc, seq, state) in wanted {
        assert_eq!(next(rx), (doc.to_string(), *seq, *state));
    }
}

#[test]
fn the_latest_request_wins_and_the_window_hears_every_step_in_order() {
    let (svc, shared, rx) = service();
    let (j1, g1) = job("one");
    assert_eq!(svc.submit("d", j1), 1);
    expect(&rx, &[("d", 1, "queued"), ("d", 1, "running")]);

    shared.clock.store(1_000, Ordering::Relaxed);
    let (j2, _g2) = job("two");
    let (j3, g3) = job("three");
    assert_eq!(svc.submit("d", j2), 2);
    assert_eq!(svc.submit("d", j3), 3);
    expect(
        &rx,
        &[
            ("d", 2, "queued"),
            ("d", 3, "queued"),
            ("d", 2, "cancelled"),
        ],
    );

    g1.open();
    expect(&rx, &[("d", 1, "done"), ("d", 3, "running")]);
    g3.open();
    expect(&rx, &[("d", 3, "done")]);
    assert_eq!(*shared.started.lock().unwrap(), ["one", "three"]);
}

#[test]
fn a_build_that_just_started_is_stopped_for_the_next_and_reported_cancelled() {
    let (svc, shared, rx) = service();
    let (j1, _g1) = job("one");
    svc.submit("d", j1);
    expect(&rx, &[("d", 1, "queued"), ("d", 1, "running")]);

    // 100 ms later: the first is told to stop. The fake finishes it anyway,
    // and the window still hears "cancelled", never "done", for it.
    shared.clock.store(100, Ordering::Relaxed);
    let (j2, g2) = job("two");
    svc.submit("d", j2);
    expect(
        &rx,
        &[
            ("d", 2, "queued"),
            ("d", 1, "cancelled"),
            ("d", 2, "running"),
        ],
    );
    g2.open();
    expect(&rx, &[("d", 2, "done")]);
}

#[test]
fn a_build_that_has_run_a_while_is_not_stopped() {
    let (svc, shared, rx) = service();
    let (j1, g1) = job("one");
    svc.submit("d", j1);
    expect(&rx, &[("d", 1, "queued"), ("d", 1, "running")]);
    shared.clock.store(300, Ordering::Relaxed);
    let (j2, g2) = job("two");
    svc.submit("d", j2);
    expect(&rx, &[("d", 2, "queued")]);
    g1.open();
    expect(&rx, &[("d", 1, "done"), ("d", 2, "running")]);
    g2.open();
    expect(&rx, &[("d", 2, "done")]);
}

#[test]
fn two_builds_at_a_time_and_the_third_document_waits_its_turn() {
    let (svc, _shared, rx) = service();
    let (a, ga) = job("a");
    let (b, gb) = job("b");
    let (c, gc) = job("c");
    svc.submit("a", a);
    svc.submit("b", b);
    svc.submit("c", c);
    expect(
        &rx,
        &[
            ("a", 1, "queued"),
            ("a", 1, "running"),
            ("b", 2, "queued"),
            ("b", 2, "running"),
            ("c", 3, "queued"),
        ],
    );
    ga.open();
    expect(&rx, &[("a", 1, "done"), ("c", 3, "running")]);
    gb.open();
    gc.open();
    // Both end; their order between them is not fixed.
    let mut ended = vec![next(&rx).2, next(&rx).2];
    ended.sort_unstable();
    assert_eq!(ended, ["done", "done"]);
}

#[test]
fn a_cap_of_one_runs_documents_one_after_the_other() {
    let (svc, _shared, rx) = service_with_cap(1);
    let (a, ga) = job("a");
    let (b, gb) = job("b");
    svc.submit("a", a);
    svc.submit("b", b);
    expect(
        &rx,
        &[("a", 1, "queued"), ("a", 1, "running"), ("b", 2, "queued")],
    );
    ga.open();
    expect(&rx, &[("a", 1, "done"), ("b", 2, "running")]);
    gb.open();
    expect(&rx, &[("b", 2, "done")]);
}

#[test]
fn a_build_that_breaks_fails_without_stopping_the_service() {
    let (svc, shared, rx) = service();
    let (mut j1, _g1) = job("one");
    j1.panics = true;
    svc.submit("d", j1);
    expect(&rx, &[("d", 1, "queued"), ("d", 1, "running")]);
    let event = rx.recv_timeout(Duration::from_secs(20)).unwrap();
    assert_eq!((event.seq, event.state), (1, "failed"));
    assert_eq!(event.error.map(|e| e.kind), Some("internal"));

    // The next build for the same document starts as usual.
    shared.clock.store(10_000, Ordering::Relaxed);
    let (j2, g2) = job("two");
    svc.submit("d", j2);
    expect(&rx, &[("d", 2, "queued"), ("d", 2, "running")]);
    g2.open();
    expect(&rx, &[("d", 2, "done")]);
}

#[test]
fn cancel_ends_the_running_build_and_the_waiting_one_and_nothing_starts() {
    let (svc, shared, rx) = service();
    let (j1, _g1) = job("one");
    svc.submit("d", j1);
    expect(&rx, &[("d", 1, "queued"), ("d", 1, "running")]);
    shared.clock.store(5_000, Ordering::Relaxed);
    let (j2, _g2) = job("two");
    svc.submit("d", j2);
    expect(&rx, &[("d", 2, "queued")]);

    svc.cancel("d");
    expect(&rx, &[("d", 2, "cancelled"), ("d", 1, "cancelled")]);
    assert_eq!(*shared.started.lock().unwrap(), ["one"]);
    // Cancelling a document with nothing to do is quiet.
    svc.cancel("d");
    svc.cancel("never-built");
    assert!(rx.recv_timeout(Duration::from_millis(200)).is_err());
}

#[test]
fn a_long_build_can_tell_the_window_what_it_is_doing() {
    let (svc, _shared, rx) = service();
    let (mut j1, g1) = job("one");
    j1.note = true;
    svc.submit("d", j1);
    expect(&rx, &[("d", 1, "queued"), ("d", 1, "running")]);
    let event = rx.recv_timeout(Duration::from_secs(20)).unwrap();
    assert_eq!(event.state, "running");
    assert_eq!(event.note.as_deref(), Some("Downloading TeX packages…"));
    g1.open();
    expect(&rx, &[("d", 1, "done")]);
}

#[test]
fn events_have_the_shape_the_window_reads() {
    let mut event = Event::of("projects/p/latex/a", 4, "failed");
    event.ms = 120;
    event.error = Some(BuildError {
        kind: "no-engine",
        message: "None".to_owned(),
        next: Some("install-tectonic"),
    });
    let json: HashMap<String, serde_json::Value> =
        serde_json::from_value(serde_json::to_value(&event).unwrap()).unwrap();
    let mut keys: Vec<&str> = json.keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        ["diagnostics", "doc", "error", "ms", "pdf", "seq", "state"]
    );
    assert_eq!(json["error"]["next"], "install-tectonic");
    // Empty extras are left out rather than sent as null.
    let quiet = serde_json::to_value(Event::of("d", 1, "queued")).unwrap();
    assert!(quiet.get("error").is_none() && quiet.get("note").is_none());
}
