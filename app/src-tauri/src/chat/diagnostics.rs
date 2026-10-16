//! The connection report: the outcome of the last requests, for finding out
//! why a chat or a sign-in does not work. Each line says when, which kind of
//! provider and which model, the route, how far the request got, the
//! status, how it failed, how many tries it took and how long. It never
//! holds a token, an email, a prompt or an answer: only numbers, the names
//! of models and routes, and a word from a short list (or a provider's own
//! error code, cleaned to letters and digits).

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

use serde::{Deserialize, Serialize};

use super::cache;
use super::errors::FailKind;

/// Lines `chat_diagnostics` gives back.
pub const SHOWN: usize = 50;
/// Lines kept in the cache folder, across runs.
pub const KEPT: usize = 200;
const FILE: &str = "connection-report.json";

/// How far a request got, or where it stopped.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Stage {
    /// Being signed in at all.
    SignIn,
    /// Renewing the access token.
    Renewal,
    /// Listing the models.
    ModelList,
    /// Sending the request, up to the first answer.
    Request,
    /// Reading the answer.
    Stream,
}

/// One request, as the report shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestOutcome {
    /// Milliseconds since 1970.
    pub at: u64,
    /// `anthropic`, `openai` or `chatgpt`.
    pub provider: String,
    pub model: String,
    /// The host and path asked, without a user name, password or query.
    pub route: String,
    pub ok: bool,
    /// The last stage reached; the one that failed when `ok` is false.
    pub stage: Stage,
    pub status: Option<u16>,
    pub kind: Option<FailKind>,
    /// Why, in one word (`timeout`, `closed`, `cut`, a provider's error
    /// code); empty when it worked.
    pub reason: String,
    pub attempts: u32,
    /// Until the first piece of the answer, in milliseconds.
    pub first_byte_ms: Option<u64>,
    pub total_ms: u64,
    /// The sign-in's token was renewed for it.
    pub renewed: bool,
    /// The connection pool was made again for it.
    pub rebuilt: bool,
}

#[derive(Serialize, Deserialize)]
struct File {
    version: u32,
    outcomes: Vec<RequestOutcome>,
}

#[derive(Default)]
struct Inner {
    dir: Option<PathBuf>,
    loaded: bool,
    list: VecDeque<RequestOutcome>,
}

/// The report.
#[derive(Default)]
pub struct Diagnostics {
    inner: Mutex<Inner>,
}

/// The report every chat in this run writes to.
pub fn shared() -> Arc<Diagnostics> {
    static REPORT: OnceLock<Arc<Diagnostics>> = OnceLock::new();
    Arc::clone(REPORT.get_or_init(Arc::default))
}

/// A provider's error code, cleaned to what is safe to show: lower-case
/// letters, digits and `_ . -`, at most 48 of them.
pub fn tidy(code: &str) -> String {
    code.trim()
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
        .take(48)
        .collect()
}

/// The host and path of `url`, as the report shows a route.
pub fn route_of(url: &str) -> String {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return "unknown".to_owned();
    };
    let host = parsed.host_str().unwrap_or("unknown");
    match parsed.port() {
        Some(port) => format!("{host}:{port}{}", parsed.path()),
        None => format!("{host}{}", parsed.path()),
    }
}

impl Diagnostics {
    fn inner(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Keeps the report in `dir` instead of the app's cache folder, and picks
    /// up what an earlier run left there.
    #[cfg(test)]
    pub fn keep_in(&self, dir: PathBuf) {
        let mut inner = self.inner();
        inner.dir = Some(dir);
        inner.loaded = false;
        Self::load(&mut inner);
    }

    fn load(inner: &mut Inner) {
        if inner.loaded {
            return;
        }
        let Some(dir) = inner.dir.clone().or_else(cache::folder) else {
            return;
        };
        inner.loaded = true;
        let earlier = cache::read::<File>(&dir, FILE)
            .filter(|f| f.version == 1)
            .map(|f| f.outcomes)
            .unwrap_or_default();
        // What this run already wrote comes after what the file held.
        let now: Vec<_> = inner.list.drain(..).collect();
        inner.list = earlier.into_iter().chain(now).collect();
        while inner.list.len() > KEPT {
            inner.list.pop_front();
        }
    }

    fn save(inner: &Inner) {
        let Some(dir) = inner.dir.clone().or_else(cache::folder) else {
            return;
        };
        let file = File {
            version: 1,
            outcomes: inner.list.iter().cloned().collect(),
        };
        // A report that cannot be kept is only a report lost.
        let _ = cache::write(&dir, FILE, &file);
    }

    /// Adds a request's outcome.
    pub fn record(&self, outcome: RequestOutcome) {
        let mut inner = self.inner();
        Self::load(&mut inner);
        inner.list.push_back(outcome);
        while inner.list.len() > KEPT {
            inner.list.pop_front();
        }
        Self::save(&inner);
    }

    /// The last requests, the newest first.
    pub fn recent(&self) -> Vec<RequestOutcome> {
        let mut inner = self.inner();
        Self::load(&mut inner);
        inner.list.iter().rev().take(SHOWN).cloned().collect()
    }

    /// Forgets every line, here and in the file.
    pub fn clear(&self) {
        let mut inner = self.inner();
        Self::load(&mut inner);
        inner.list.clear();
        Self::save(&inner);
    }
}

/// The last requests' outcomes, the newest first, for Settings' connection
/// report.
#[tauri::command(async)]
pub fn chat_diagnostics() -> Vec<RequestOutcome> {
    shared().recent()
}

/// Clears the connection report.
#[tauri::command(async)]
pub fn clear_chat_diagnostics() {
    shared().clear();
}

#[cfg(test)]
#[path = "diagnostics_tests.rs"]
mod tests;
