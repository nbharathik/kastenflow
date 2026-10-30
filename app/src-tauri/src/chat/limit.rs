//! The chat's two counts: how many threads the list shows before it archives
//! the oldest (`chat.list_size`, 10 to 200, 30 without a setting) and how many
//! chats work at once (`chat.max_concurrent`, 1 to 8, 3 without a setting).
//! Kept beside the agent limits in the app's config folder. A chat that comes
//! after the limit waits in line (`Gate`) and is told so; it is never refused.

use std::collections::VecDeque;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::sync::Notify;

use super::archive::{DEFAULT_LIST_SIZE, LIST_SIZE};
use super::store::disk;

/// The file in the app's config folder.
pub const FILE: &str = "chat-limits.json";
/// What `chat.max_concurrent` may be set to, and what it is without a setting.
pub const CONCURRENT: (usize, usize) = (1, 8);
pub const DEFAULT_CONCURRENT: usize = 3;

/// How often a chat that waits looks at whether it was stopped.
const LOOK: Duration = Duration::from_millis(100);

/// The person's two counts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ChatLimits {
    /// `chat.list_size`.
    pub list_size: usize,
    /// `chat.max_concurrent`.
    pub max_concurrent: usize,
}

impl Default for ChatLimits {
    fn default() -> ChatLimits {
        ChatLimits {
            list_size: DEFAULT_LIST_SIZE,
            max_concurrent: DEFAULT_CONCURRENT,
        }
    }
}

fn within(name: &str, value: usize, (least, most): (usize, usize)) -> Result<usize, String> {
    if (least..=most).contains(&value) {
        Ok(value)
    } else {
        Err(format!("{name} must be between {least} and {most}"))
    }
}

impl ChatLimits {
    /// These limits if each is in its range, else the sentence that says which is not.
    pub fn checked(self) -> Result<ChatLimits, String> {
        within("Chats in the list", self.list_size, LIST_SIZE)?;
        within("Agents working at once", self.max_concurrent, CONCURRENT)?;
        Ok(self)
    }

    /// Each limit brought into its range: what a damaged file comes to.
    pub fn clamped(self) -> ChatLimits {
        ChatLimits {
            list_size: self.list_size.clamp(LIST_SIZE.0, LIST_SIZE.1),
            max_concurrent: self.max_concurrent.clamp(CONCURRENT.0, CONCURRENT.1),
        }
    }

    /// The limits kept in `dir`; the defaults when there are none or the file does not read.
    pub fn load(dir: &Path) -> ChatLimits {
        std::fs::read_to_string(dir.join(FILE))
            .ok()
            .and_then(|text| serde_json::from_str::<ChatLimits>(&text).ok())
            .map(ChatLimits::clamped)
            .unwrap_or_default()
    }

    /// Keeps these limits in `dir`, after checking them.
    pub fn save(self, dir: &Path) -> Result<ChatLimits, String> {
        let limits = self.checked()?;
        let text = serde_json::to_string_pretty(&limits).map_err(|e| e.to_string())?;
        disk::write_atomic(&dir.join(FILE), text.as_bytes())
            .map_err(|e| format!("The limits could not be kept: {e}"))?;
        Ok(limits)
    }
}

struct Line {
    max: usize,
    working: usize,
    /// The chats waiting, in the order they came.
    waiting: VecDeque<String>,
}

/// The place where turns wait their turn: at most `max` work at once.
pub struct Gate {
    line: Mutex<Line>,
    wake: Notify,
}

impl Default for Gate {
    fn default() -> Gate {
        Gate {
            line: Mutex::new(Line {
                max: DEFAULT_CONCURRENT,
                working: 0,
                waiting: VecDeque::new(),
            }),
            wake: Notify::new(),
        }
    }
}

/// A place at work, given back when it is dropped.
pub struct Permit {
    gate: Arc<Gate>,
}

impl Drop for Permit {
    fn drop(&mut self) {
        {
            let mut line = self.gate.lock();
            line.working = line.working.saturating_sub(1);
        }
        self.gate.wake.notify_waiters();
    }
}

/// Takes a chat out of the line when `enter` ends for any reason, a dropped
/// future included. A chat that was given its place is no longer in the line,
/// so this does nothing then.
struct Leave<'a> {
    gate: &'a Gate,
    chat: &'a str,
}

impl Drop for Leave<'_> {
    fn drop(&mut self) {
        let left = {
            let mut line = self.gate.lock();
            let before = line.waiting.len();
            line.waiting.retain(|c| c != self.chat);
            line.waiting.len() != before
        };
        if left {
            self.gate.wake.notify_waiters();
        }
    }
}

impl Gate {
    fn lock(&self) -> MutexGuard<'_, Line> {
        self.line.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// How many may work at once from now on; those working are not stopped.
    pub fn set_max(&self, max: usize) {
        self.lock().max = max.clamp(CONCURRENT.0, CONCURRENT.1);
        self.wake.notify_waiters();
    }

    #[cfg(test)]
    pub fn max(&self) -> usize {
        self.lock().max
    }

    /// How many are working.
    #[cfg(test)]
    pub fn working(&self) -> usize {
        self.lock().working
    }

    /// The chats waiting, first in line first.
    #[cfg(test)]
    pub fn waiting(&self) -> Vec<String> {
        self.lock().waiting.iter().cloned().collect()
    }

    /// A place at work for `chat`. When all places are taken, `queued` is
    /// told once the chat's place in line (1 is next) and the chat waits;
    /// `stop` going true ends the wait with nothing. The chats go in the order they came.
    pub async fn enter(
        self: &Arc<Gate>,
        chat: &str,
        stop: &AtomicBool,
        mut queued: impl FnMut(usize),
    ) -> Option<Permit> {
        // A turn whose future is dropped while it waits must not stay in the
        // line, or the ones behind it would never get a place.
        let _leave = Leave { gate: self, chat };
        let mut told = false;
        loop {
            let mut woken = std::pin::pin!(self.wake.notified());
            woken.as_mut().enable();
            let place = {
                let mut line = self.lock();
                if stop.load(Ordering::SeqCst) {
                    line.waiting.retain(|c| c != chat);
                    return None;
                }
                if !line.waiting.iter().any(|c| c == chat) {
                    line.waiting.push_back(chat.to_owned());
                }
                if line.working < line.max && line.waiting.front().is_some_and(|c| c == chat) {
                    line.waiting.pop_front();
                    line.working += 1;
                    return Some(Permit {
                        gate: Arc::clone(self),
                    });
                }
                line.waiting
                    .iter()
                    .position(|c| c == chat)
                    .map_or(1, |p| p + 1)
            };
            if !told {
                told = true;
                queued(place);
            }
            // Woken when a place is given back; else look again soon, in case it was stopped.
            let _ = tokio::time::timeout(LOOK, woken.as_mut()).await;
        }
    }
}
