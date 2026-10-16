use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use reqwest::header::{HeaderMap, HeaderValue};

use super::*;
use crate::chat::tests::block_on;

fn secs(n: f64) -> Duration {
    Duration::from_secs_f64(n)
}

#[test]
fn the_wait_grows_from_half_a_second_to_eight_and_stops_there() {
    let p = Policy::STANDARD;
    // `unit` 0.5 is the middle of the spread: exactly the grown wait.
    let waits: Vec<Duration> = (2..=8).map(|next| p.wait(next, None, 0.5)).collect();
    assert_eq!(
        waits,
        [
            secs(0.5),
            secs(1.0),
            secs(2.0),
            secs(4.0),
            secs(8.0),
            secs(8.0),
            secs(8.0)
        ]
    );
    assert_eq!(p.attempts, 4);
}

#[test]
fn the_spread_is_a_fifth_either_way_and_never_over_the_most() {
    let p = Policy::STANDARD;
    assert_eq!(p.wait(3, None, 0.0), secs(0.8));
    assert_eq!(p.wait(3, None, 1.0), secs(1.2));
    assert_eq!(p.wait(6, None, 1.0), secs(8.0), "capped after the spread");
    // A unit outside 0..1 is pinned, not trusted.
    assert_eq!(p.wait(3, None, 7.0), secs(1.2));
    assert_eq!(p.wait(3, None, -7.0), secs(0.8));
}

#[test]
fn what_the_server_asked_is_the_least_we_wait() {
    let p = Policy::STANDARD;
    assert_eq!(p.wait(2, Some(secs(3.0)), 0.5), secs(3.0));
    assert_eq!(
        p.wait(5, Some(secs(1.0)), 0.5),
        secs(4.0),
        "our own wait when it is the longer"
    );
}

#[test]
fn the_statuses_that_pass_are_the_ones_the_plan_names() {
    for status in [408, 409, 425, 429, 500, 502, 503, 504, 529] {
        assert!(status_passes(status), "{status}");
    }
    for status in [200, 400, 401, 403, 404, 413, 422, 501] {
        assert!(!status_passes(status), "{status}");
    }
}

fn headers(pairs: &[(&'static str, &str)]) -> HeaderMap {
    let mut map = HeaderMap::new();
    for (name, value) in pairs {
        map.insert(*name, HeaderValue::from_str(value).unwrap());
    }
    map
}

#[test]
fn a_wait_is_read_from_seconds_milliseconds_or_a_date() {
    assert_eq!(
        asked_wait(&headers(&[("retry-after", "7")])),
        Some(secs(7.0))
    );
    assert_eq!(
        asked_wait(&headers(&[("retry-after", " 1.5 ")])),
        Some(secs(1.5))
    );
    assert_eq!(
        asked_wait(&headers(&[("retry-after-ms", "250"), ("retry-after", "9")])),
        Some(secs(0.25)),
        "the finer header wins"
    );
    assert_eq!(asked_wait(&headers(&[])), None);
    assert_eq!(asked_wait(&headers(&[("retry-after", "soon")])), None);
    // A date in the past is no wait; one ahead is about that far.
    assert_eq!(
        asked_wait(&headers(&[(
            "retry-after",
            "Wed, 21 Oct 2015 07:28:00 GMT"
        )])),
        Some(Duration::ZERO)
    );
    let ahead = jiff::Timestamp::now()
        .checked_add(jiff::SignedDuration::from_secs(90))
        .unwrap();
    let date = jiff::fmt::rfc2822::to_string(&ahead.to_zoned(jiff::tz::TimeZone::UTC)).unwrap();
    let date = date.replace("+0000", "GMT");
    let got = asked_wait(&headers(&[("retry-after", &date)])).unwrap();
    assert!((88..=91).contains(&got.as_secs()), "{got:?}");
    // A silly number is bounded.
    assert_eq!(
        asked_wait(&headers(&[("retry-after", "1e12")])),
        Some(secs(86_400.0))
    );
}

#[test]
fn the_wait_between_tries_ends_when_the_person_stops() {
    let started = Instant::now();
    let cancel = Arc::new(AtomicBool::new(false));
    let stop = Arc::clone(&cancel);
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(150));
        stop.store(true, Ordering::SeqCst);
    });
    let stopped = block_on(pause(Duration::from_secs(30), &cancel));
    assert!(stopped);
    assert!(started.elapsed() < Duration::from_secs(2));
    // Not stopped: it waits its time and says no.
    let calm = block_on(pause(Duration::from_millis(60), &AtomicBool::new(false)));
    assert!(!calm);
}
