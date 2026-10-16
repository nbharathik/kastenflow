//! How far one turn goes before it pauses. A turn is a series of steps (each
//! a request to the model) with tool calls between them; it has a budget of
//! steps, of tool calls and of minutes, and stops *paused* when one runs out:
//! the thread keeps everything, and Continue lets it go on with a fresh
//! budget. Two guards stop work that goes nowhere: a call repeated with the
//! same result, and a run of failing calls.
//!
//! The budgets are the person's, kept in a small file in the app's config
//! folder (Settings, AI: "Agent limits").

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use super::model::{ToolCall, ToolOutput};
use super::store::disk;

/// The budgets' file in the app's config folder.
pub const FILE: &str = "chat-budgets.json";

/// What each budget may be set to.
pub const ROUNDS: (u32, u32) = (1, 1000);
pub const CALLS: (u32, u32) = (1, 5000);
pub const MINUTES: (u32, u32) = (1, 240);

/// The same call with the same result this many times in a row is a loop.
const SAME_CALLS: u32 = 3;
/// This many failing calls in a row is a loop.
const FAILING_CALLS: u32 = 5;

/// What one turn may do before it pauses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ChatBudgets {
    /// Steps: requests to the model.
    pub rounds: u32,
    /// Tool calls.
    pub calls: u32,
    pub minutes: u32,
}

impl Default for ChatBudgets {
    fn default() -> ChatBudgets {
        ChatBudgets {
            rounds: 80,
            calls: 250,
            minutes: 30,
        }
    }
}

fn within(name: &str, value: u32, (least, most): (u32, u32)) -> Result<u32, String> {
    if (least..=most).contains(&value) {
        Ok(value)
    } else {
        Err(format!("{name} must be between {least} and {most}"))
    }
}

impl ChatBudgets {
    /// These budgets if each is in its range, else a sentence saying which is not.
    pub fn checked(self) -> Result<ChatBudgets, String> {
        within("Steps", self.rounds, ROUNDS)?;
        within("Tool calls", self.calls, CALLS)?;
        within("Minutes", self.minutes, MINUTES)?;
        Ok(self)
    }

    /// Each budget brought into its range: what a damaged file comes to.
    pub fn clamped(self) -> ChatBudgets {
        ChatBudgets {
            rounds: self.rounds.clamp(ROUNDS.0, ROUNDS.1),
            calls: self.calls.clamp(CALLS.0, CALLS.1),
            minutes: self.minutes.clamp(MINUTES.0, MINUTES.1),
        }
    }

    /// The budgets kept in `dir`; the defaults when there are none or the
    /// file cannot be read.
    pub fn load(dir: &Path) -> ChatBudgets {
        std::fs::read_to_string(dir.join(FILE))
            .ok()
            .and_then(|text| serde_json::from_str::<ChatBudgets>(&text).ok())
            .map(ChatBudgets::clamped)
            .unwrap_or_default()
    }

    /// Keeps these budgets in `dir`, after checking them.
    pub fn save(self, dir: &Path) -> Result<ChatBudgets, String> {
        let budgets = self.checked()?;
        let text = serde_json::to_string_pretty(&budgets).map_err(|e| e.to_string())?;
        disk::write_atomic(&dir.join(FILE), text.as_bytes())
            .map_err(|e| format!("The limits could not be kept: {e}"))?;
        Ok(budgets)
    }
}

/// Why a turn stopped before it was done.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PauseReason {
    /// The steps ran out.
    Rounds,
    /// The tool calls ran out.
    Calls,
    /// The minutes ran out.
    Minutes,
    /// The same step again and again.
    Loop,
    /// The answer kept running past the length limit.
    Length,
    /// The app closed while it worked.
    Interrupted,
}

/// A pause: why, and the sentence the person reads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pause {
    pub reason: PauseReason,
    pub detail: String,
}

impl Pause {
    pub fn new(reason: PauseReason, detail: impl Into<String>) -> Pause {
        Pause {
            reason,
            detail: detail.into(),
        }
    }
}

/// What a turn has used of its budgets.
pub struct Meter {
    budgets: ChatBudgets,
    started: Instant,
    /// Time spent before this meter started: a test's clock.
    before: Duration,
    rounds: u32,
    calls: u32,
}

impl Meter {
    pub fn new(budgets: ChatBudgets, before: Duration) -> Meter {
        Meter {
            budgets,
            started: Instant::now(),
            before,
            rounds: 0,
            calls: 0,
        }
    }

    fn spent(&self) -> Duration {
        self.before + self.started.elapsed()
    }

    fn out_of_time(&self) -> Option<Pause> {
        (self.spent() >= Duration::from_secs(u64::from(self.budgets.minutes) * 60)).then(|| {
            Pause::new(
                PauseReason::Minutes,
                format!(
                    "Paused after {} minutes — Continue to let it go on",
                    self.budgets.minutes
                ),
            )
        })
    }

    /// Whether another step may start.
    pub fn round(&self) -> Result<(), Pause> {
        if self.rounds >= self.budgets.rounds {
            return Err(Pause::new(
                PauseReason::Rounds,
                format!(
                    "Paused after {} steps — Continue to let it go on",
                    self.budgets.rounds
                ),
            ));
        }
        self.out_of_time().map_or(Ok(()), Err)
    }

    /// Whether another tool call may run.
    pub fn call(&self) -> Result<(), Pause> {
        if self.calls >= self.budgets.calls {
            return Err(Pause::new(
                PauseReason::Calls,
                format!(
                    "Paused after {} tool calls — Continue to let it go on",
                    self.budgets.calls
                ),
            ));
        }
        self.out_of_time().map_or(Ok(()), Err)
    }

    /// A step started: its number.
    pub fn took_round(&mut self) -> u32 {
        self.rounds += 1;
        self.rounds
    }

    pub fn took_call(&mut self) {
        self.calls += 1;
    }

    pub fn calls(&self) -> u32 {
        self.calls
    }

    /// Tool calls left in the budget.
    pub fn calls_left(&self) -> u32 {
        self.budgets.calls.saturating_sub(self.calls)
    }
}

/// What the loop guard makes of a step.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Fine,
    /// The first time: tell the model to change approach.
    Nudge,
    /// The second time: pause.
    Pause,
}

/// Watches the calls of a turn for a loop.
#[derive(Default)]
pub struct LoopGuard {
    last: Option<(u64, u64)>,
    same: u32,
    failing: u32,
    nudged: bool,
}

fn hashed(parts: &[&str]) -> u64 {
    let mut hasher = DefaultHasher::new();
    for part in parts {
        part.hash(&mut hasher);
    }
    hasher.finish()
}

impl LoopGuard {
    /// A call and what came of it, in the order they ran.
    pub fn saw(&mut self, call: &ToolCall, output: &ToolOutput) {
        let key = (
            hashed(&[&call.name, &call.arguments]),
            hashed(&[
                &output.content,
                if output.is_error { "error" } else { "ok" },
            ]),
        );
        if self.last == Some(key) {
            self.same += 1;
        } else {
            self.same = 1;
            self.last = Some(key);
        }
        if output.is_error {
            self.failing += 1;
        } else {
            self.failing = 0;
        }
    }

    /// After a step: whether the calls so far are a loop.
    pub fn verdict(&mut self) -> Verdict {
        if self.same < SAME_CALLS && self.failing < FAILING_CALLS {
            return Verdict::Fine;
        }
        self.last = None;
        self.same = 0;
        self.failing = 0;
        if self.nudged {
            Verdict::Pause
        } else {
            self.nudged = true;
            Verdict::Nudge
        }
    }
}

/// What the model is told the first time it loops.
pub const NUDGE: &str = "You are repeating a call that gave the same result, or calls that keep failing. Change approach, or ask the person what they want.";

/// What the pause for a loop says.
pub fn looped() -> Pause {
    Pause::new(
        PauseReason::Loop,
        "Paused because it kept repeating the same step — Continue to let it try again, or send it a hint",
    )
}

#[cfg(test)]
mod tests;
