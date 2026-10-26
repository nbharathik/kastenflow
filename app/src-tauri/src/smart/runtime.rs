//! What the app keeps while smart pages run: one agent session for each page,
//! so everything a page's code changes counts against the same soft limits
//! (and comes back as one batch of work in History and for Undo), and the
//! frames that are showing a page right now, each known by a secret that is
//! part of every address it loads from.

use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

use kasten_core::agent::Session;
use kasten_core::{Instant, ulid_at};

/// The longest page path an agent's name carries.
const MAX_NAME: usize = 120;

/// Frames kept at once. A window that was reloaded cannot close the frames it
/// had, so the oldest are forgotten past this many; a page shows at most a few
/// frames at a time, so a live one is never the oldest.
const MAX_FRAMES: usize = 256;

/// Random bytes in a frame's secret (256 bits).
const NONCE_BYTES: usize = 32;

/// Requests one frame may have open at once. A page that asks for thousands of
/// files together would keep the app's pool busy; past this many it is told to
/// wait (503), and a normal page, which loads a handful, never meets it.
pub const MAX_IN_FLIGHT: usize = 32;

#[derive(Default)]
pub struct Runtime {
    sessions: Mutex<HashMap<String, Session>>,
    frames: Mutex<Frames>,
    in_flight: Mutex<HashMap<String, usize>>,
}

/// A request being answered for a live frame; it counts until dropped.
pub struct InFlight<'a> {
    runtime: &'a Runtime,
    nonce: String,
}

impl Drop for InFlight<'_> {
    fn drop(&mut self) {
        let mut open = self
            .runtime
            .in_flight
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(count) = open.get_mut(&self.nonce) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                open.remove(&self.nonce);
            }
        }
    }
}

/// The frame has too many requests open; the request waits (503).
#[derive(Debug, PartialEq, Eq)]
pub struct Busy;

/// The live frames: secret to page id, and the order they came in.
#[derive(Default)]
struct Frames {
    page_of: HashMap<String, String>,
    order: VecDeque<String>,
}

/// The agent a smart page's changes are made by: `smart:<page path>`. What
/// would break the name of a commit's author is left out.
pub fn actor_name(page_path: &str) -> String {
    let clean: String = page_path
        .chars()
        .filter(|c| {
            !c.is_control() && !matches!(c, '<' | '>') && !kasten_core::agent::is_invisible(*c)
        })
        .take(MAX_NAME)
        .collect();
    format!("smart:{clean}")
}

/// Whether `text` is the form a frame's secret has: 64 lower-case hex digits.
/// Checked before a request looks anything up.
pub fn is_nonce(text: &str) -> bool {
    text.len() == NONCE_BYTES * 2 && text.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// A new secret from the system's random numbers; there is no weaker fallback.
fn new_nonce() -> Result<String, String> {
    let mut bytes = [0u8; NONCE_BYTES];
    getrandom::fill(&mut bytes)
        .map_err(|e| format!("This page could not be started safely, because this computer would not give KastenFlow a secure random number ({e}). Try again."))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

impl Runtime {
    /// The page's session, begun the first time it is asked for.
    pub fn session(&self, page_path: &str, now: Instant) -> Session {
        let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        sessions
            .entry(page_path.to_owned())
            .or_insert_with(|| Session {
                id: ulid_at(now.millis),
                client: actor_name(page_path),
                started: now.millis,
            })
            .clone()
    }

    /// Begins a frame for the page with `page_id`: a new secret that its
    /// address, and every address it loads from, carries. Two frames of one
    /// page have two secrets.
    pub fn open_frame(&self, page_id: &str) -> Result<String, String> {
        let nonce = new_nonce()?;
        let mut frames = self.frames.lock().unwrap_or_else(|e| e.into_inner());
        while frames.order.len() >= MAX_FRAMES {
            if let Some(oldest) = frames.order.pop_front() {
                frames.page_of.remove(&oldest);
            }
        }
        frames.page_of.insert(nonce.clone(), page_id.to_owned());
        frames.order.push_back(nonce.clone());
        Ok(nonce)
    }

    /// Lets a request for the frame with this secret in, unless the frame has
    /// `MAX_IN_FLIGHT` open already (`Busy`). The request counts until the
    /// guard is dropped. A secret that is no live frame's is let in uncounted
    /// (it is answered with a refusal at once, and nothing is kept for it).
    pub fn admit(&self, nonce: &str) -> Result<Option<InFlight<'_>>, Busy> {
        if self.frame_page(nonce).is_none() {
            return Ok(None);
        }
        let mut open = self.in_flight.lock().unwrap_or_else(|e| e.into_inner());
        let count = open.entry(nonce.to_owned()).or_insert(0);
        if *count >= MAX_IN_FLIGHT {
            return Err(Busy);
        }
        *count += 1;
        Ok(Some(InFlight {
            runtime: self,
            nonce: nonce.to_owned(),
        }))
    }

    /// Ends a frame: nothing is served for its secret any more, and calls
    /// made for it are refused.
    pub fn close_frame(&self, nonce: &str) {
        let mut frames = self.frames.lock().unwrap_or_else(|e| e.into_inner());
        if frames.page_of.remove(nonce).is_some() {
            frames.order.retain(|n| n != nonce);
        }
    }

    /// Ends every frame (smart pages were turned off): nothing is served and
    /// every call is refused until a frame begins again.
    pub fn close_all(&self) {
        let mut frames = self.frames.lock().unwrap_or_else(|e| e.into_inner());
        frames.page_of.clear();
        frames.order.clear();
    }

    /// The id of the page whose frame has this secret, if there is one now.
    pub fn frame_page(&self, nonce: &str) -> Option<String> {
        if !is_nonce(nonce) {
            return None;
        }
        let frames = self.frames.lock().unwrap_or_else(|e| e.into_inner());
        frames.page_of.get(nonce).cloned()
    }

    /// Whether `nonce` is a live frame of the page with `page_id`.
    pub fn frame_is_of(&self, nonce: &str, page_id: &str) -> bool {
        self.frame_page(nonce).is_some_and(|id| id == page_id)
    }
}
