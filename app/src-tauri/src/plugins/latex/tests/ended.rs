//! Waiting for the end of a build: one that ended before the wait began is
//! found, one that ends meanwhile wakes the waiter, and one that never ends
//! gives up at the time limit. Only ends are kept, not steps on the way.

use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::plugins::latex::ended::EndedLog;
use crate::plugins::latex::service::Event;

#[test]
fn a_build_that_ended_before_the_wait_is_found() {
    let log = EndedLog::default();
    log.record(&Event::of("a", 1, "running"));
    log.record(&Event::of("a", 1, "done"));
    let found = log.wait("a", 1, Duration::from_millis(10)).unwrap();
    assert_eq!(found.state, "done");
    // Another document's number, or another build's, is not this one.
    assert!(log.wait("b", 1, Duration::from_millis(10)).is_none());
    assert!(log.wait("a", 2, Duration::from_millis(10)).is_none());
}

#[test]
fn a_build_that_ends_meanwhile_wakes_the_waiter() {
    let log = Arc::new(EndedLog::default());
    let waiter = Arc::clone(&log);
    let handle = std::thread::spawn(move || waiter.wait("a", 7, Duration::from_secs(30)));
    std::thread::sleep(Duration::from_millis(100));
    log.record(&Event::of("a", 7, "failed"));
    let found = handle.join().unwrap().unwrap();
    assert_eq!(found.state, "failed");
}

#[test]
fn a_build_that_never_ends_gives_up_at_the_limit_and_only_the_last_ends_are_kept() {
    let log = EndedLog::default();
    let started = Instant::now();
    assert!(log.wait("a", 1, Duration::from_millis(150)).is_none());
    assert!(started.elapsed() >= Duration::from_millis(140));
    for seq in 0..100 {
        log.record(&Event::of("a", seq, "cancelled"));
    }
    assert!(
        log.wait("a", 0, Duration::from_millis(5)).is_none(),
        "the oldest went"
    );
    assert!(log.wait("a", 99, Duration::from_millis(5)).is_some());
}
