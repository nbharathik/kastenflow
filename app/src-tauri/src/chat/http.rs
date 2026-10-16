//! The model over HTTP: a provider from the vault's config, its key from
//! the keychain (or, for ChatGPT, the signed-in account), and one streamed
//! request per answer. Every wait looks at the stop flag several times a
//! second and gives up after a long silence. A request that fails for a
//! reason that passes is sent again (reply.rs), and every request leaves a
//! line in the connection report (run.rs).

use std::sync::{Arc, Mutex};
use std::time::Duration;

use kasten_core::config::Provider;
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE};

use super::capabilities::Applied;
use super::chatgpt::Account;
use super::clients::Shared;
use super::diagnostics::{self, Diagnostics, RequestOutcome};
pub use super::errors::{http_error, unreachable};
use super::model::Call;
use super::retry::Policy;
use super::{anthropic, openai, responses};

mod open;
mod reply;
mod run;

/// Output tokens per answer from OpenAI-compatible servers, whose local
/// models may have small context windows.
pub const MAX_TOKENS: u32 = 4096;
/// Output tokens per answer from Claude: its thinking counts against the
/// same limit, and recent models think unless told not to.
pub const ANTHROPIC_MAX_TOKENS: u32 = 16_000;
/// How long a provider may send nothing before the answer is given up.
pub const IDLE: Duration = Duration::from_secs(180);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Anthropic,
    OpenAi,
    /// OpenAI's Responses API, paid for by a ChatGPT plan the person
    /// signed in with.
    ChatGpt,
}

impl Kind {
    pub fn of(kind: &str) -> Result<Kind, String> {
        match kind.trim() {
            "anthropic" => Ok(Kind::Anthropic),
            "openai" => Ok(Kind::OpenAi),
            "chatgpt" => Ok(Kind::ChatGpt),
            other => Err(format!(
                "A provider is “anthropic”, “openai” or “chatgpt”, not “{other}”"
            )),
        }
    }

    /// The word the connection report uses for it.
    pub fn word(self) -> &'static str {
        match self {
            Kind::Anthropic => "anthropic",
            Kind::OpenAi => "openai",
            Kind::ChatGpt => "chatgpt",
        }
    }
}

/// One provider's model, ready to answer.
#[derive(Clone)]
pub struct HttpModel {
    http: reqwest::Client,
    /// Where the client comes from, so it can be made again after a
    /// connection failed (without it, the one given is used throughout).
    link: Option<Arc<Shared>>,
    kind: Kind,
    name: String,
    url: String,
    model: String,
    key: Option<String>,
    /// The ChatGPT sign-in, which gives the token of each request.
    account: Option<Arc<Account>>,
    /// What the person's settings come to for this model: none unless set.
    applied: Applied,
    /// Things to tell the person about the last request, given once.
    notices: Arc<Mutex<Vec<String>>>,
    /// Tries that are about to be repeated, for the turn to say as they happen.
    retries: Arc<Mutex<Vec<String>>>,
    /// How often and how fast a request is tried again.
    policy: Policy,
    /// Where each request's outcome is written.
    report: Arc<Diagnostics>,
    /// The outcome of this model's latest request.
    last: Arc<Mutex<Option<RequestOutcome>>>,
}

/// Shown without the key.
impl std::fmt::Debug for HttpModel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HttpModel")
            .field("kind", &self.kind)
            .field("name", &self.name)
            .field("url", &self.url)
            .field("model", &self.model)
            .field("key", &self.key.as_ref().map(|_| "<hidden>"))
            .field("account", &self.account.is_some())
            .finish()
    }
}

impl HttpModel {
    /// `model` (else the provider's own) at `provider`, with its key: the
    /// Anthropic API needs one, a local server may not. A ChatGPT provider
    /// has no key and no address of its own: its requests go to OpenAI's
    /// Responses API, whatever a vault's settings say.
    pub fn new(
        http: reqwest::Client,
        provider: &Provider,
        key: Option<String>,
        model: &str,
    ) -> Result<HttpModel, String> {
        let kind = Kind::of(&provider.kind)?;
        let model = match model.trim() {
            "" => provider.model.trim(),
            chosen => chosen,
        };
        if model.is_empty() {
            return Err(format!("Choose a model for “{}”", provider.name));
        }
        let key = key.map(|k| k.trim().to_owned()).filter(|k| !k.is_empty());
        let url = match kind {
            Kind::Anthropic if key.is_none() => {
                return Err(format!(
                    "No API key for “{}”: add one in Settings",
                    provider.name
                ));
            }
            Kind::Anthropic => anthropic::url(&provider.base_url),
            Kind::OpenAi => openai::url(&provider.base_url)?,
            Kind::ChatGpt => responses::URL.to_owned(),
        };
        Ok(HttpModel {
            http,
            link: None,
            kind,
            name: provider.name.clone(),
            url,
            model: model.to_owned(),
            key: key.filter(|_| kind != Kind::ChatGpt),
            account: None,
            applied: Applied::default(),
            notices: Arc::default(),
            retries: Arc::default(),
            policy: Policy::default(),
            report: diagnostics::shared(),
            last: Arc::default(),
        })
    }

    /// Answers a ChatGPT provider's requests as `account`.
    pub fn with_account(mut self, account: Arc<Account>) -> HttpModel {
        self.account = Some(account);
        self
    }

    /// Asks with the person's settings, already checked against what the
    /// model takes (capabilities::resolve).
    pub fn with_settings(mut self, applied: Applied) -> HttpModel {
        self.applied = applied;
        self
    }

    /// Takes its client from `clients`, which makes a new one after a
    /// connection failed in a way that says the old one should not be trusted.
    pub fn with_clients(mut self, clients: Arc<Shared>) -> HttpModel {
        self.link = Some(clients);
        self
    }

    /// Writes each request's outcome to `report`, not the app's own.
    #[cfg(test)]
    pub fn with_report(mut self, report: Arc<Diagnostics>) -> HttpModel {
        self.report = report;
        self
    }

    pub fn kind(&self) -> Kind {
        self.kind
    }

    /// The address the requests go to.
    pub fn url(&self) -> &str {
        &self.url
    }

    /// The outcome of the latest request this model made.
    pub fn last_outcome(&self) -> Option<RequestOutcome> {
        self.last.lock().ok()?.clone()
    }

    /// The ChatGPT account this model asks as, if it is one.
    pub fn account(&self) -> Option<&Arc<Account>> {
        self.account.as_ref()
    }

    /// The client its requests start with.
    pub fn client(&self) -> reqwest::Client {
        self.http.clone()
    }

    fn say(&self, notice: &str) {
        if let Ok(mut notices) = self.notices.lock() {
            notices.push(notice.to_owned());
        }
    }

    /// Sends the requests to `url` instead, a server of a test.
    #[cfg(test)]
    pub(crate) fn at(mut self, url: &str) -> HttpModel {
        self.url = url.to_owned();
        self
    }

    /// The model this asks.
    pub fn model_name(&self) -> &str {
        &self.model
    }

    fn request(
        &self,
        http: &reqwest::Client,
        call: &Call<'_>,
        bearer: &str,
        shape: responses::Shape,
    ) -> reqwest::RequestBuilder {
        let key = self.key.as_deref().unwrap_or_default();
        let (request, body) = match self.kind {
            Kind::Anthropic => (
                http.post(&self.url)
                    .header("x-api-key", key)
                    .header("anthropic-version", anthropic::VERSION),
                anthropic::body(&self.model, ANTHROPIC_MAX_TOKENS, call, &self.applied),
            ),
            Kind::OpenAi if key.is_empty() => (
                http.post(&self.url),
                openai::body(&self.url, &self.model, MAX_TOKENS, call, &self.applied),
            ),
            Kind::OpenAi => (
                http.post(&self.url)
                    .header(AUTHORIZATION, format!("Bearer {key}")),
                openai::body(&self.url, &self.model, MAX_TOKENS, call, &self.applied),
            ),
            Kind::ChatGpt => (
                http.post(&self.url)
                    .header(AUTHORIZATION, format!("Bearer {bearer}")),
                responses::body(&self.model, call, shape, &self.applied),
            ),
        };
        request
            .header(CONTENT_TYPE, "application/json")
            .header(ACCEPT, "text/event-stream")
            .body(body.to_string())
    }

    fn silent_words(&self) -> String {
        format!(
            "{} sent nothing for {} minutes, so the answer was given up",
            self.name,
            IDLE.as_secs() / 60
        )
    }
}
