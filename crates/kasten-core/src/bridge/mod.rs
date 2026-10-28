//! The mailbox between the MCP server and the desktop app.
//!
//! The MCP server is a process of its own: it shares only the vault's folder
//! with the app. Some things only the app can do (build a LaTeX document with
//! its engine, keep the built PDF), so the server asks through files in
//! `.kasten/cache/bridge/`, which no history, backup or git ever takes in:
//!
//! - `requests/<id>.json`: written by the asker. A [`Request`] holds a `kind`
//!   and its `params` (typed as a [`Call`] at both ends), the agent's session
//!   and when it was made.
//! - `replies/<id>.json`: written by the app. A [`Reply`] is `ok` with a
//!   result, or not, with one plain sentence. It is read once and removed.
//! - `app-alive.json`: the app writes its time and version every few seconds;
//!   an asker calls the app closed when it is missing or older than 15 s.
//! - `selection.json`: what the person has selected, shared by the app for two
//!   minutes after a client asked (see [`Sharing`]); not a request or a reply,
//!   but kept under the same rules.
//!
//! The ids are long and random, the files are readable by their owner alone
//! (the same care as the MCP token), writes are atomic, requests and replies
//! expire, and the folder is swept of what is old. Links are never followed,
//! an id or a name that could leave the folder is refused, nothing that is
//! not JSON of the right shape and size is obeyed, and a request can only name
//! a place inside the vault: no program, no outside path, no network address
//! (see [`Call`]). The app checks the document again before it acts.
//!
//! The app side is [`serve`], a loop that hands each request to a handler.
//! The asking side is [`Mailbox::ask`]. To add a kind of request, add it to
//! [`Call`] (one place: `call.rs`) and handle it in the app.

mod alive;
mod call;
mod client;
mod files;
mod selection;
mod server;
mod sharing;
mod standard;

use std::io;
use std::path::Path;

pub use alive::Alive;
pub use call::{Call, MAX_WAIT_MS, Reply, Request};
pub use client::Answer;
pub use files::Mailbox;
pub use selection::{Published, SOURCES, Seen, Snippet, Span};
pub use server::{Handler, Server, serve};
pub use sharing::{Sharing, Tick};

/// Where the mailbox is, in the vault.
pub const DIR: &str = ".kasten/cache/bridge";
/// The most a request file may hold.
pub const MAX_REQUEST_BYTES: u64 = 64 * 1024;
/// The most a reply file may hold (a diagram's PNG comes back in one, as base64).
pub const MAX_REPLY_BYTES: u64 = 3 * 1024 * 1024;
/// The most the app's own file may hold.
pub const MAX_ALIVE_BYTES: u64 = 1024;
/// The most requests that may wait at once.
pub const MAX_WAITING: usize = 64;
/// How long a request waits to be taken up before it is dropped.
pub const REQUEST_TTL_MS: u64 = 60_000;
/// How long a reply waits to be read before it is swept.
pub const REPLY_TTL_MS: u64 = 10 * 60_000;
/// How often the app says it is there.
pub const ALIVE_EVERY_MS: u64 = 3_000;
/// The app is closed when its file is older than this.
pub const ALIVE_MAX_AGE_MS: u64 = 15_000;
/// The most snippets of selected text that are shared, and the most bytes of each.
pub const MAX_SNIPPETS: usize = 5;
pub const MAX_SNIPPET_TEXT: usize = 20 * 1024;
/// The most the shared selection's file may hold (five snippets, escaped).
pub const MAX_SELECTION_BYTES: u64 = 512 * 1024;
/// A shared selection not renewed for this long is out of date.
pub const SELECTION_STALE_MS: u64 = 60_000;
/// The selection is shared this long after a client last asked.
pub const WATCH_MS: u64 = 120_000;
/// While it is shared, an unchanged selection's file is renewed this often.
pub const REFRESH_MS: u64 = 20_000;

/// What differs between computers: how a file is written so only its owner
/// can read it, how to tell that it is, and where random ids come from. The
/// MCP server and the app give the strict ones (the operating system's random
/// source, and the owner-only access list on Windows, as for the MCP token);
/// [`Platform::standard`] uses only the standard library.
#[derive(Clone, Copy)]
pub struct Platform {
    /// Writes a new file at the path, atomically, readable by its owner alone.
    pub write: fn(&Path, &[u8]) -> io::Result<()>,
    /// Whether the file is readable by its owner alone.
    pub is_private: fn(&Path) -> bool,
    /// An unguessable id: at least 128 random bits, as lowercase hex.
    pub random_id: fn() -> io::Result<String>,
}
