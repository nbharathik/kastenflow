//! When the app shares the selection. It does so only for a client that asked
//! (`Call::WatchSelection`), and for two minutes after the last ask; the file
//! is then deleted. While it is shared the app tells its window to publish, and
//! this keeps the file's time fresh so an unchanged selection is not called out
//! of date. Time is always given by the caller, so all of it is testable.

use std::sync::Mutex;

use super::files::Mailbox;
use super::selection::{Published, Snippet};
use super::{REFRESH_MS, WATCH_MS};
use crate::error::Result;

/// What a look at the clock came to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tick {
    /// Nothing to do.
    Idle,
    /// The file's time was renewed.
    Restamped,
    /// No client has asked for two minutes: the file is gone.
    Lapsed,
}

#[derive(Default)]
struct State {
    /// Shared until this time (0: not shared).
    until: u64,
    /// What the file holds.
    snippets: Vec<Snippet>,
    /// When the file was last written (0: not since sharing began).
    written: u64,
}

/// Whether the selection is shared, and what is shared.
#[derive(Default)]
pub struct Sharing {
    state: Mutex<State>,
}

impl Sharing {
    fn held(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// A client asked at `now`: sharing goes on for two minutes more. True when
    /// it was not on before.
    pub fn ask(&self, now: u64) -> bool {
        let mut state = self.held();
        let was = state.until > now;
        state.until = now + WATCH_MS;
        !was
    }

    /// Whether the selection is shared at `now`.
    pub fn on(&self, now: u64) -> bool {
        self.held().until > now
    }

    /// Whether the file has been written since `since`.
    pub fn written_since(&self, since: u64) -> bool {
        let written = self.held().written;
        written != 0 && written >= since
    }

    /// The window sent what is selected: written to the file when it is shared,
    /// else nothing is written. Says whether it was written.
    pub fn publish(&self, mailbox: &Mailbox, incoming: &[Snippet], now: u64) -> Result<bool> {
        let mut state = self.held();
        if state.until <= now {
            return Ok(false);
        }
        let published = Published::of(incoming, &state.snippets, now);
        mailbox.write_selection(&published)?;
        state.snippets = published.snippets;
        state.written = now;
        Ok(true)
    }

    /// Looks at the clock: renews the file's time now and then, and takes the
    /// file away when no client has asked for two minutes.
    pub fn tick(&self, mailbox: &Mailbox, now: u64) -> Tick {
        let mut state = self.held();
        if state.until != 0 && state.until <= now {
            *state = State::default();
            mailbox.clear_selection();
            return Tick::Lapsed;
        }
        if state.until > now
            && state.written != 0
            && now.saturating_sub(state.written) >= REFRESH_MS
        {
            let renewed = Published {
                time: now,
                snippets: state.snippets.clone(),
            };
            if mailbox.write_selection(&renewed).is_ok() {
                state.written = now;
                return Tick::Restamped;
            }
        }
        Tick::Idle
    }

    /// The app is closing: nothing is shared and the file goes.
    pub fn stop(&self, mailbox: &Mailbox) {
        *self.held() = State::default();
        mailbox.clear_selection();
    }
}
