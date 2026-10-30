//! How builds ended, kept for a little while so that someone who asked for a
//! build (the MCP bridge) can wait for its end instead of listening to the
//! window's events. A build that ends before the waiter starts waiting is
//! found all the same.

use std::collections::VecDeque;
use std::sync::{Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use super::service::Event;

/// How many ended builds are remembered.
const KEPT: usize = 64;

#[derive(Default)]
pub struct EndedLog {
    events: Mutex<VecDeque<Event>>,
    changed: Condvar,
    /// Builds (document, number) that said they were fetching TeX packages.
    fetching: Mutex<VecDeque<(String, u64)>>,
}

impl EndedLog {
    fn lock(&self) -> MutexGuard<'_, VecDeque<Event>> {
        self.events.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Whether build `seq` of `doc` said it was fetching TeX packages (the
    /// first build does, and can be slow on a poor line).
    pub fn fetching(&self, doc: &str, seq: u64) -> bool {
        let seen = self.fetching.lock().unwrap_or_else(|e| e.into_inner());
        seen.iter().any(|(d, s)| d == doc && *s == seq)
    }

    /// Notes an event if it is an end (done, failed or cancelled), and a note
    /// that packages are being fetched.
    pub fn record(&self, event: &Event) {
        if event
            .note
            .as_deref()
            .is_some_and(|n| n.to_ascii_lowercase().contains("download"))
        {
            let mut seen = self.fetching.lock().unwrap_or_else(|e| e.into_inner());
            if seen.len() >= KEPT {
                seen.pop_front();
            }
            seen.push_back((event.doc.clone(), event.seq));
        }
        if !matches!(event.state, "done" | "failed" | "cancelled") {
            return;
        }
        let mut events = self.lock();
        if events.len() >= KEPT {
            events.pop_front();
        }
        events.push_back(event.clone());
        self.changed.notify_all();
    }

    /// The end of build `seq` of `doc`, waiting up to `timeout` for it; none
    /// if it did not end in time.
    pub fn wait(&self, doc: &str, seq: u64, timeout: Duration) -> Option<Event> {
        let started = Instant::now();
        let mut events = self.lock();
        loop {
            if let Some(found) = events.iter().find(|e| e.doc == doc && e.seq == seq) {
                return Some(found.clone());
            }
            let left = timeout.checked_sub(started.elapsed())?;
            events = self
                .changed
                .wait_timeout(events, left)
                .unwrap_or_else(|e| e.into_inner())
                .0;
        }
    }
}
