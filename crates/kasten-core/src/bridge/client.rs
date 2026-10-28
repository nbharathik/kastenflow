//! Asking the app: the side the MCP server is on.

use std::time::{Duration, Instant as Clock};

use super::MAX_WAITING;
use super::call::{Call, Reply, Request};
use super::files::Mailbox;
use crate::agent::Session;
use crate::error::{Error, Result};
use crate::time::Instant;

/// How often the answer is looked for.
const POLL: Duration = Duration::from_millis(50);
/// How often the app is checked to be still there, while waiting.
const RECHECK: Duration = Duration::from_secs(1);

/// What came of asking.
#[derive(Debug, Clone, PartialEq)]
pub enum Answer {
    /// The app answered, well or not.
    Reply(Reply),
    /// The app is not open on this vault (no sign of it in the last 15 s).
    AppClosed,
    /// The app is there but did not answer in time; the request was withdrawn.
    TimedOut,
}

impl Mailbox {
    /// Asks the app to do `call` for `session` and waits up to `timeout` for
    /// the answer. The call is checked first: it may only name things inside
    /// the vault. A request that cannot be made (too many waiting, a folder
    /// that is a link) is an error.
    pub fn ask(&self, call: &Call, session: Option<&Session>, timeout: Duration) -> Result<Answer> {
        call.check()?;
        let now = Instant::now().millis;
        if self.alive(now).is_none() {
            return Ok(Answer::AppClosed);
        }
        self.sweep(now);
        if self.waiting_count() >= MAX_WAITING {
            return Err(Error::Invalid(
                "Too many requests are waiting for the app: try again in a minute".to_owned(),
            ));
        }
        let id = self.new_id()?;
        self.put_request(&Request::new(id.clone(), call, session, now))?;
        let started = Clock::now();
        let mut checked = started;
        loop {
            if let Some(reply) = self.take_reply(&id)? {
                return Ok(Answer::Reply(reply));
            }
            if started.elapsed() >= timeout {
                self.withdraw(&id);
                return Ok(Answer::TimedOut);
            }
            if checked.elapsed() >= RECHECK {
                checked = Clock::now();
                if self.alive(Instant::now().millis).is_none() {
                    self.withdraw(&id);
                    return Ok(Answer::AppClosed);
                }
            }
            std::thread::sleep(POLL.min(timeout.saturating_sub(started.elapsed())));
        }
    }
}
