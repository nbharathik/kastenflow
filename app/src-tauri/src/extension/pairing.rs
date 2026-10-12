//! The pairing code: how an extension proves a person at this computer
//! allowed it. Settings makes a code of 8 letters and digits, good for 2
//! minutes and 5 tries; the extension sends it once, and a right code is
//! used up. Nothing else in this file touches a token.

use std::time::{Duration, Instant};

/// Letters and digits that are hard to mistake for each other (no 0, 1, I, O).
const ALPHABET: &[u8; 32] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/// How long a code works.
pub(super) const TTL: Duration = Duration::from_secs(120);
/// How many wrong codes end it.
pub(super) const TRIES: u8 = 5;
const LENGTH: usize = 8;

/// A new code: 8 characters, each 5 random bits.
pub(super) fn new_code() -> Result<String, String> {
    let mut bytes = [0u8; LENGTH];
    getrandom::fill(&mut bytes)
        .map_err(|e| format!("No random numbers to make a code with: {e}"))?;
    // 32 symbols and 8 bits: the low 5 bits are uniform.
    Ok(bytes
        .iter()
        .map(|b| char::from(ALPHABET[usize::from(b & 31)]))
        .collect())
}

/// What a code typed in looks like once spaces, dashes and case are set aside.
fn plain(text: &str) -> String {
    text.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_uppercase())
        .collect()
}

/// Why a code was not taken.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Refused {
    /// No code is waiting (none was made, it was used, or it ended).
    None,
    /// The code ran out of time.
    Expired,
    /// A wrong code; `left` tries remain.
    Wrong { left: u8 },
    /// The last try was wrong: the code is gone.
    Spent,
}

impl Refused {
    /// What the extension says to the person.
    pub fn words(&self) -> String {
        match self {
            Refused::None => "No pairing code is waiting. Press Pair in KastenFlow's Settings, under Browser extension".to_owned(),
            Refused::Expired => "That code has run out of time. Make a new one in KastenFlow's Settings".to_owned(),
            Refused::Wrong { left: 1 } => "That code is not right. One try is left".to_owned(),
            Refused::Wrong { left } => format!("That code is not right. {left} tries are left"),
            Refused::Spent => "Too many wrong codes. Make a new one in KastenFlow's Settings".to_owned(),
        }
    }
}

struct Live {
    code: String,
    expires: Instant,
    left: u8,
}

/// The code waiting to be used, if any: at most one at a time.
pub(super) struct Pairing {
    ttl: Duration,
    tries: u8,
    live: Option<Live>,
}

/// A code as Settings shows it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Offer {
    pub code: String,
    pub seconds_left: u64,
    pub tries_left: u8,
}

impl Pairing {
    pub fn new(ttl: Duration, tries: u8) -> Pairing {
        Pairing {
            ttl,
            tries,
            live: None,
        }
    }

    /// Makes `code` the one waiting, in place of any earlier one.
    pub fn start(&mut self, code: String, now: Instant) -> Offer {
        let offer = Offer {
            code: code.clone(),
            seconds_left: self.ttl.as_secs(),
            tries_left: self.tries,
        };
        self.live = Some(Live {
            code,
            expires: now + self.ttl,
            left: self.tries,
        });
        offer
    }

    /// The code waiting and how much is left of it; none once it ran out.
    pub fn offer(&self, now: Instant) -> Option<Offer> {
        let live = self.live.as_ref().filter(|l| now < l.expires)?;
        Some(Offer {
            code: live.code.clone(),
            seconds_left: live.expires.saturating_duration_since(now).as_secs() + 1,
            tries_left: live.left,
        })
    }

    pub fn cancel(&mut self) {
        self.live = None;
    }

    /// Takes `given`: a right code is used up, so it works once. A wrong one
    /// costs a try, and the last wrong try takes the code away.
    pub fn attempt(&mut self, given: &str, now: Instant) -> Result<(), Refused> {
        let Some(live) = self.live.as_mut() else {
            return Err(Refused::None);
        };
        if now >= live.expires {
            self.live = None;
            return Err(Refused::Expired);
        }
        if super::store::same(plain(given).as_bytes(), live.code.as_bytes()) {
            self.live = None;
            return Ok(());
        }
        live.left = live.left.saturating_sub(1);
        if live.left == 0 {
            self.live = None;
            return Err(Refused::Spent);
        }
        Err(Refused::Wrong { left: live.left })
    }
}
