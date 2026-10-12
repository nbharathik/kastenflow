//! The limits at the door: so many requests a minute, and failures that shut
//! it for a while.

use std::time::{Duration, Instant};

use super::super::limit::{Limits, Window};

#[test]
fn a_window_lets_so_many_through_and_forgets_the_old() {
    let now = Instant::now();
    let mut w = Window::new(Duration::from_secs(60), 3);
    assert!(w.take(now) && w.take(now) && w.take(now));
    assert!(!w.take(now), "the fourth is over");
    assert!(!w.take(now + Duration::from_secs(59)));
    // A minute after the first, room again.
    assert!(w.take(now + Duration::from_secs(60)));
}

#[test]
fn an_event_over_the_limit_is_not_counted_so_waiting_clears_it() {
    let now = Instant::now();
    let mut w = Window::new(Duration::from_secs(10), 1);
    assert!(w.take(now));
    for second in 1..9 {
        assert!(!w.take(now + Duration::from_secs(second)));
    }
    assert!(w.take(now + Duration::from_secs(10)));
}

#[test]
fn failures_shut_the_door_until_they_age_out() {
    let now = Instant::now();
    let mut limits = Limits::new(100, 2, Duration::from_secs(60));
    assert!(limits.admit(now));
    limits.failed(now);
    assert!(limits.admit(now));
    limits.failed(now);
    assert!(!limits.admit(now), "two failures: wait");
    assert!(!limits.admit(now + Duration::from_secs(30)));
    assert!(limits.admit(now + Duration::from_secs(61)));
}

#[test]
fn requests_are_counted_and_the_usual_limit_is_sixty_a_minute() {
    let now = Instant::now();
    let mut limits = Limits::usual();
    for _ in 0..60 {
        assert!(limits.admit(now));
    }
    assert!(!limits.admit(now));
}
