//! The service under stress: a window listener that panics, a hundred
//! builds one after the other, and requests thrown at it from many threads.
//! Whatever happens, every request ends with exactly one closing event, a
//! document can always build again and the places are all given back.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::plugins::latex::service::{Ended, Event, Host, Outcome, Service};

/// Builds that finish at once; its listener panics on the states in `panic_on`.
struct Quick {
    heard: Mutex<Vec<(String, u64, &'static str)>>,
    panic_on: Mutex<Vec<&'static str>>,
    running: AtomicUsize,
    most_running: AtomicUsize,
    clock: AtomicU64,
    /// How long a build takes (milliseconds).
    takes: u64,
}

impl Quick {
    fn new(takes: u64) -> Arc<Quick> {
        Arc::new(Quick {
            heard: Mutex::new(Vec::new()),
            panic_on: Mutex::new(Vec::new()),
            running: AtomicUsize::new(0),
            most_running: AtomicUsize::new(0),
            clock: AtomicU64::new(0),
            takes,
        })
    }

    fn closed(&self) -> Vec<(String, u64)> {
        self.heard
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, _, state)| ["done", "failed", "cancelled"].contains(state))
            .map(|(doc, seq, _)| (doc.clone(), *seq))
            .collect()
    }
}

struct Handle(Arc<Quick>);

impl Host for Handle {
    type Job = ();

    fn run(&self, _: &(), cancel: &AtomicBool, _: &dyn Fn(&str)) -> Outcome {
        let now = self.0.running.fetch_add(1, Ordering::SeqCst) + 1;
        self.0.most_running.fetch_max(now, Ordering::SeqCst);
        let until = Instant::now() + Duration::from_millis(self.0.takes);
        while Instant::now() < until && !cancel.load(Ordering::Relaxed) {
            std::thread::yield_now();
        }
        self.0.running.fetch_sub(1, Ordering::SeqCst);
        Outcome {
            ended: Ended::Done,
            ms: 1,
            diagnostics: Vec::new(),
            pdf: true,
            error: None,
        }
    }

    fn emit(&self, event: &Event) {
        self.0
            .heard
            .lock()
            .unwrap()
            .push((event.doc.clone(), event.seq, event.state));
        if self.0.panic_on.lock().unwrap().contains(&event.state) {
            panic!("the window's listener breaks");
        }
    }

    fn now_ms(&self) -> u64 {
        self.0.clock.fetch_add(1000, Ordering::Relaxed)
    }
}

/// Waits (by looking, not by sleeping a fixed time) until `done` holds.
fn until(what: &str, done: impl Fn() -> bool) {
    let limit = Instant::now() + Duration::from_secs(30);
    while !done() {
        assert!(Instant::now() < limit, "gave up waiting for {what}");
        std::thread::yield_now();
    }
}

#[test]
fn a_listener_that_panics_does_not_leave_a_build_stuck_or_a_place_taken() {
    for state in ["queued", "running", "done", "cancelled"] {
        let quick = Quick::new(0);
        quick.panic_on.lock().unwrap().push(state);
        let svc = Service::with_cap(Handle(Arc::clone(&quick)), 1);
        // Two builds of the same document and one of another, the one place shared.
        svc.submit("a", ());
        svc.submit("a", ());
        svc.submit("b", ());
        svc.cancel("zzz");
        until(&format!("the builds to end ({state})"), || {
            let closed = quick.closed();
            ["a", "b"]
                .iter()
                .all(|doc| closed.iter().any(|(d, _)| d == doc))
        });
        // Still alive: the place is free and both documents build again.
        quick.panic_on.lock().unwrap().clear();
        let before = quick.closed().len();
        svc.submit("a", ());
        svc.submit("b", ());
        until(&format!("builds after the panic ({state})"), || {
            quick.closed().len() >= before + 2
        });
        assert!(quick.most_running.load(Ordering::SeqCst) <= 1, "{state}");
    }
}

#[test]
fn a_hundred_builds_in_a_row_leave_nothing_behind() {
    let quick = Quick::new(0);
    let svc = Service::with_cap(Handle(Arc::clone(&quick)), 2);
    for round in 0..100u64 {
        let seq = svc.submit(if round % 2 == 0 { "a" } else { "b" }, ());
        until("a build to end", || {
            quick.closed().iter().any(|(_, s)| *s == seq)
        });
    }
    // Every request ended exactly once.
    let closed = quick.closed();
    assert_eq!(closed.len(), 100);
    let mut seen: HashMap<u64, usize> = HashMap::new();
    for (_, seq) in &closed {
        *seen.entry(*seq).or_default() += 1;
    }
    assert!(seen.values().all(|n| *n == 1));
    // All places are back: two documents run side by side again.
    let slow = Quick::new(150);
    let svc = Service::with_cap(Handle(Arc::clone(&slow)), 2);
    svc.submit("a", ());
    svc.submit("b", ());
    svc.submit("c", ());
    until("three builds", || slow.closed().len() == 3);
    assert_eq!(slow.most_running.load(Ordering::SeqCst), 2);
}

#[test]
fn many_threads_asking_at_once_never_exceed_the_cap_and_every_request_ends_once() {
    let quick = Quick::new(3);
    let svc = Service::with_cap(Handle(Arc::clone(&quick)), 2);
    let asked = Mutex::new(Vec::new());
    std::thread::scope(|scope| {
        for t in 0..8 {
            let (svc, asked) = (&svc, &asked);
            scope.spawn(move || {
                for i in 0..25 {
                    let doc = format!("doc{}", (t + i) % 5);
                    let seq = svc.submit(&doc, ());
                    asked.lock().unwrap().push(seq);
                    if i % 7 == 0 {
                        svc.cancel(&doc);
                    }
                }
            });
        }
    });
    let asked = asked.into_inner().unwrap();
    assert_eq!(asked.len(), 200);
    until("every request to end", || quick.closed().len() == 200);
    let closed = quick.closed();
    let mut seen: HashMap<u64, usize> = HashMap::new();
    for (_, seq) in &closed {
        *seen.entry(*seq).or_default() += 1;
    }
    assert!(asked.iter().all(|seq| seen.get(seq) == Some(&1)));
    assert!(quick.most_running.load(Ordering::SeqCst) <= 2);
    // Never two builds of one document at the same time is the scheduler's rule;
    // here it shows as: nothing is left running.
    assert_eq!(quick.running.load(Ordering::SeqCst), 0);
}
