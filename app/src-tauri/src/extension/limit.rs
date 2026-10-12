//! How often the extension's door may be knocked on: a sliding window, so a
//! page that tries to guess a token or a code is slowed to a crawl, and a
//! stuck extension cannot flood Kasten with captures.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

/// At most `most` events in any stretch of `span`.
pub(super) struct Window {
    span: Duration,
    most: usize,
    hits: VecDeque<Instant>,
}

impl Window {
    pub fn new(span: Duration, most: usize) -> Window {
        Window {
            span,
            most,
            hits: VecDeque::new(),
        }
    }

    fn forget_old(&mut self, now: Instant) {
        while let Some(first) = self.hits.front() {
            if now.saturating_duration_since(*first) >= self.span {
                self.hits.pop_front();
            } else {
                break;
            }
        }
    }

    /// Counts an event at `now`, and says whether it is within the limit.
    /// An event over the limit is not counted, so waiting is what clears it.
    pub fn take(&mut self, now: Instant) -> bool {
        self.forget_old(now);
        if self.hits.len() >= self.most {
            return false;
        }
        self.hits.push_back(now);
        true
    }

    /// Whether the limit is reached at `now`, without counting an event.
    pub fn full(&mut self, now: Instant) -> bool {
        self.forget_old(now);
        self.hits.len() >= self.most
    }
}

/// What is limited at the door.
pub(super) struct Limits {
    /// Every request that gets in.
    pub requests: Window,
    /// Requests refused for a wrong token, origin or code: once there are
    /// too many, everything waits, so a token cannot be guessed.
    pub failures: Window,
}

impl Limits {
    pub fn new(requests: usize, failures: usize, span: Duration) -> Limits {
        Limits {
            requests: Window::new(span, requests),
            failures: Window::new(span, failures),
        }
    }

    /// The usual limits: 60 requests and 8 failures a minute.
    pub fn usual() -> Limits {
        Limits::new(60, 8, Duration::from_secs(60))
    }

    /// Whether a request at `now` may go on.
    pub fn admit(&mut self, now: Instant) -> bool {
        !self.failures.full(now) && self.requests.take(now)
    }

    /// A request was refused for what it presented.
    pub fn failed(&mut self, now: Instant) {
        // Past the limit it is not counted; the window is already full.
        let _ = self.failures.take(now);
    }
}
