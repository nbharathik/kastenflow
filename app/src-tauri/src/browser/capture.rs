//! What the browser tab's capture accepts, and from whom. A page is hostile
//! by default, so nothing a page says is taken as a capture unless Kasten
//! asked for it a moment ago: each click makes a one-time 256-bit nonce for
//! one tab; the script Kasten runs in that page carries it back, by the first
//! of three ways that works (the script's own result; the page's title, in
//! chunks; a navigation to an address that never resolves, which the guard
//! always cancels). Kasten takes only an answer that names the nonce of a
//! live, unexpired request for that tab, once. The address it files is the
//! one Kasten saw the tab navigate to, never the one the page reports, and
//! nothing is written until the person has seen what would be kept.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use kasten_core::clip::WebCapture;
use serde::Deserialize;
use tauri::Url;

/// The host of the navigation that carries an answer: `.invalid` never resolves.
pub const SENTINEL_HOST: &str = "kasten-capture.invalid";
/// What a title that carries a chunk starts with.
pub const TITLE_MARK: &str = "kasten-capture:";
/// How long a request is answered.
pub const TTL: Duration = Duration::from_secs(20);
/// How long a preview waits for its confirmation.
pub const PREVIEW_TTL: Duration = Duration::from_secs(600);
/// The most the script's own result may hold. The page-side script keeps at
/// most 900,000 characters each of HTML and text; the core refuses what is
/// still too much.
pub const MAX_ANSWER: usize = 8 * 1024 * 1024 + 64 * 1024;
/// The most a slower way (title or navigation) carries, as decoded bytes.
pub const MAX_SLOW: usize = 256 * 1024;
/// How much of an answer one title carries, in characters.
pub const CHUNK: usize = 3000;
/// The most chunks a title answer may have: the cap, base64 and a little more.
const MAX_CHUNKS: usize = MAX_SLOW * 4 / 3 / CHUNK + 3;
/// The most previews kept at once.
const MAX_PREVIEWS: usize = 4;

/// What was asked for: the selection, or the whole page.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Selection,
    Page,
}

/// What the page's script answered.
#[derive(Debug, Deserialize)]
pub struct Answer {
    pub n: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub html: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub error: Option<String>,
}

/// Why an answer was not taken.
#[derive(Debug, PartialEq, Eq)]
pub enum Refused {
    /// No request for this tab is waiting (or it was answered already).
    Unknown,
    /// The request ran out of time.
    Expired,
    /// The answer does not name the request's nonce.
    WrongNonce,
    TooBig,
    Garbled(String),
}

impl std::fmt::Display for Refused {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Refused::Unknown => f.write_str("No capture is waiting for that page"),
            Refused::Expired => f.write_str("The page took too long to answer"),
            Refused::WrongNonce => f.write_str("That answer is not for this capture"),
            Refused::TooBig => f.write_str("That is too big to keep"),
            Refused::Garbled(why) => write!(f, "The page's answer could not be read: {why}"),
        }
    }
}

/// The pieces of a title answer, put back together.
struct Assembler {
    total: usize,
    parts: Vec<Option<String>>,
}

impl Assembler {
    fn new(total: usize) -> Result<Assembler, Refused> {
        if total == 0 || total > MAX_CHUNKS {
            return Err(Refused::TooBig);
        }
        Ok(Assembler {
            total,
            parts: vec![None; total],
        })
    }

    /// Takes chunk `seq` (a repeat replaces it); the whole once every chunk is in.
    fn add(&mut self, seq: usize, data: &str) -> Result<Option<Vec<u8>>, Refused> {
        let slot = self
            .parts
            .get_mut(seq)
            .ok_or_else(|| Refused::Garbled("a chunk is out of range".to_owned()))?;
        if data.len() > CHUNK {
            return Err(Refused::TooBig);
        }
        *slot = Some(data.to_owned());
        if self.parts.iter().any(Option::is_none) {
            return Ok(None);
        }
        let joined: String = self.parts.iter().flatten().map(String::as_str).collect();
        let bytes = URL_SAFE_NO_PAD
            .decode(joined.as_bytes())
            .map_err(|_| Refused::Garbled("not base64".to_owned()))?;
        if bytes.len() > MAX_SLOW {
            return Err(Refused::TooBig);
        }
        Ok(Some(bytes))
    }
}

struct Session {
    nonce: String,
    kind: Kind,
    started: Instant,
    assembler: Option<Assembler>,
}

/// What a title was, to a capture waiting on a tab.
#[derive(Debug)]
pub enum Titled {
    /// An ordinary title.
    Plain,
    /// A chunk that is not for any request here: neither a title nor an answer.
    Foreign,
    /// A chunk taken; the page is asked for the next.
    More,
    /// The last chunk: the answer.
    Done(Answer, Kind),
    Refused(Refused),
}

/// The requests waiting for an answer, one per tab.
#[derive(Default)]
pub struct Sessions {
    live: HashMap<String, Session>,
}

/// Compares without stopping at the first difference.
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len()
        && a.bytes()
            .zip(b.bytes())
            .fold(0u8, |diff, (x, y)| diff | (x ^ y))
            == 0
}

impl Sessions {
    /// Starts a request for tab `label`, replacing one still waiting.
    pub fn begin(&mut self, label: &str, kind: Kind, nonce: String, now: Instant) {
        self.live.insert(
            label.to_owned(),
            Session {
                nonce,
                kind,
                started: now,
                assembler: None,
            },
        );
    }

    /// Gives the request up (it timed out, or the tab went).
    pub fn cancel(&mut self, label: &str) {
        self.live.remove(label);
    }

    pub fn waiting(&self, label: &str) -> bool {
        self.live.contains_key(label)
    }

    /// The live request for `label`, forgotten when it has run out of time.
    fn fresh(&mut self, label: &str, now: Instant) -> Result<&mut Session, Refused> {
        let expired = self
            .live
            .get(label)
            .ok_or(Refused::Unknown)
            .map(|s| now.saturating_duration_since(s.started) > TTL)?;
        if expired {
            self.live.remove(label);
            return Err(Refused::Expired);
        }
        self.live.get_mut(label).ok_or(Refused::Unknown)
    }

    /// Takes an answer's bytes (JSON) for `label`. A wrong nonce leaves the
    /// request waiting: a page that guesses cannot cancel the person's click.
    pub fn accept(
        &mut self,
        label: &str,
        bytes: &[u8],
        now: Instant,
    ) -> Result<(Answer, Kind), Refused> {
        let session = self.fresh(label, now)?;
        if bytes.len() > MAX_ANSWER {
            return Err(Refused::TooBig);
        }
        let answer: Answer =
            serde_json::from_slice(bytes).map_err(|e| Refused::Garbled(e.to_string()))?;
        if !same(&answer.n, &session.nonce) {
            return Err(Refused::WrongNonce);
        }
        let kind = session.kind;
        self.live.remove(label);
        match answer.error {
            Some(why) => Err(Refused::Garbled(why)),
            None => Ok((answer, kind)),
        }
    }

    /// Reads a title that may carry a chunk of the answer, as
    /// `kasten-capture:<nonce>:<seq>:<total>:<data>`.
    pub fn titled(&mut self, label: &str, title: &str, now: Instant) -> Titled {
        let Some(rest) = title.strip_prefix(TITLE_MARK) else {
            return Titled::Plain;
        };
        let mut fields = rest.splitn(4, ':');
        let (Some(nonce), Some(seq), Some(total), Some(data)) =
            (fields.next(), fields.next(), fields.next(), fields.next())
        else {
            return Titled::Foreign;
        };
        let (Ok(seq), Ok(total)) = (seq.parse::<usize>(), total.parse::<usize>()) else {
            return Titled::Foreign;
        };
        let session = match self.fresh(label, now) {
            Ok(session) if same(nonce, &session.nonce) => session,
            Ok(_) | Err(Refused::Unknown) => return Titled::Foreign,
            Err(refused) => return Titled::Refused(refused),
        };
        let assembler = match &mut session.assembler {
            Some(a) if a.total == total => a,
            Some(_) => {
                self.live.remove(label);
                return Titled::Refused(Refused::Garbled("the chunks disagree".to_owned()));
            }
            None => match Assembler::new(total) {
                Ok(a) => session.assembler.insert(a),
                Err(refused) => {
                    self.live.remove(label);
                    return Titled::Refused(refused);
                }
            },
        };
        match assembler.add(seq, data) {
            Ok(None) => Titled::More,
            Ok(Some(bytes)) => match self.accept(label, &bytes, now) {
                Ok((answer, kind)) => Titled::Done(answer, kind),
                Err(refused) => Titled::Refused(refused),
            },
            Err(refused) => {
                self.live.remove(label);
                Titled::Refused(refused)
            }
        }
    }

    /// Reads the navigation `https://kasten-capture.invalid/?n=<nonce>&d=<data>`.
    /// None when `url` is not that address at all.
    pub fn sentinel(
        &mut self,
        label: &str,
        url: &Url,
        now: Instant,
    ) -> Option<Result<(Answer, Kind), Refused>> {
        if !is_sentinel(url) {
            return None;
        }
        let mut nonce = None;
        let mut data = None;
        for (key, value) in url.query_pairs() {
            match key.as_ref() {
                "n" => nonce = Some(value.into_owned()),
                "d" => data = Some(value.into_owned()),
                _ => {}
            }
        }
        let (Some(nonce), Some(data)) = (nonce, data) else {
            return Some(Err(Refused::Garbled(
                "the address lacks its parts".to_owned(),
            )));
        };
        let session = match self.fresh(label, now) {
            Ok(session) if same(&nonce, &session.nonce) => session,
            Ok(_) => return Some(Err(Refused::WrongNonce)),
            Err(refused) => return Some(Err(refused)),
        };
        let _ = session;
        if data.len() > MAX_SLOW * 4 / 3 + 4 {
            self.live.remove(label);
            return Some(Err(Refused::TooBig));
        }
        let Ok(bytes) = URL_SAFE_NO_PAD.decode(data.as_bytes()) else {
            self.live.remove(label);
            return Some(Err(Refused::Garbled("not base64".to_owned())));
        };
        Some(self.accept(label, &bytes, now))
    }
}

/// Whether `url` is the navigation that carries an answer (whatever it carries).
pub fn is_sentinel(url: &Url) -> bool {
    url.host_str()
        .is_some_and(|h| h.trim_end_matches('.').eq_ignore_ascii_case(SENTINEL_HOST))
}

/// 32 random bytes as 43 base64url characters.
pub fn new_nonce() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes)
        .map_err(|e| format!("No random numbers to make a capture with: {e}"))?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

/// What the person is shown before anything is written: the capture, held here.
#[derive(Default)]
pub struct Previews {
    held: Vec<(String, WebCapture, Instant)>,
}

impl Previews {
    /// Holds `capture` under `token`; the oldest goes when more than four wait.
    pub fn put(&mut self, token: String, capture: WebCapture, now: Instant) {
        self.held.push((token, capture, now));
        while self.held.len() > MAX_PREVIEWS {
            self.held.remove(0);
        }
    }

    /// The capture for `token`, once: gone after, and when it waited too long.
    pub fn take(&mut self, token: &str, now: Instant) -> Option<WebCapture> {
        let at = self.held.iter().position(|(t, _, _)| same(t, token))?;
        let (_, capture, made) = self.held.remove(at);
        (now.saturating_duration_since(made) <= PREVIEW_TTL).then_some(capture)
    }

    pub fn discard(&mut self, token: &str) {
        self.held.retain(|(t, _, _)| !same(t, token));
    }
}

#[cfg(test)]
#[path = "capture_tests.rs"]
mod tests;
