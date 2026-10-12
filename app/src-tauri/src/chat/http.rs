//! The model over HTTP: a provider from the vault's config, its key from
//! the keychain (or, for ChatGPT, the signed-in account), and one streamed
//! request per answer. Every wait looks at the stop flag several times a
//! second and gives up after a long silence.

use std::future::Future;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use kasten_core::config::Provider;
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE};

use super::chatgpt::{self, Account};
use super::errors::chain;
pub use super::errors::{http_error, unreachable};
use super::model::{Call, Failure, Model, Reply};
use super::sse::{SseEvent, SseParser};
use super::{anthropic, openai, responses};

/// Output tokens per answer from OpenAI-compatible servers, whose local
/// models may have small context windows.
pub const MAX_TOKENS: u32 = 4096;
/// Output tokens per answer from Claude: its thinking counts against the
/// same limit, and recent models think unless told not to.
pub const ANTHROPIC_MAX_TOKENS: u32 = 16_000;
/// How long a provider may send nothing before the answer is given up.
pub const IDLE: Duration = Duration::from_secs(180);
/// How often a wait looks at the stop flag.
const TICK: Duration = Duration::from_millis(200);

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
}

/// One provider's model, ready to answer.
#[derive(Clone)]
pub struct HttpModel {
    http: reqwest::Client,
    kind: Kind,
    name: String,
    url: String,
    model: String,
    key: Option<String>,
    /// The ChatGPT sign-in, which gives the token of each request.
    account: Option<Arc<Account>>,
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
            kind,
            name: provider.name.clone(),
            url,
            model: model.to_owned(),
            key: key.filter(|_| kind != Kind::ChatGpt),
            account: None,
        })
    }

    /// Answers a ChatGPT provider's requests as `account`.
    pub fn with_account(mut self, account: Arc<Account>) -> HttpModel {
        self.account = Some(account);
        self
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
        call: &Call<'_>,
        bearer: &str,
        shape: responses::Shape,
    ) -> reqwest::RequestBuilder {
        let key = self.key.as_deref().unwrap_or_default();
        let (request, body) = match self.kind {
            Kind::Anthropic => (
                self.http
                    .post(&self.url)
                    .header("x-api-key", key)
                    .header("anthropic-version", anthropic::VERSION),
                anthropic::body(&self.model, ANTHROPIC_MAX_TOKENS, call),
            ),
            Kind::OpenAi if key.is_empty() => (
                self.http.post(&self.url),
                openai::body(&self.url, &self.model, MAX_TOKENS, call),
            ),
            Kind::OpenAi => (
                self.http
                    .post(&self.url)
                    .header(AUTHORIZATION, format!("Bearer {key}")),
                openai::body(&self.url, &self.model, MAX_TOKENS, call),
            ),
            Kind::ChatGpt => (
                self.http
                    .post(&self.url)
                    .header(AUTHORIZATION, format!("Bearer {bearer}")),
                responses::body(&self.model, call, shape),
            ),
        };
        request
            .header(CONTENT_TYPE, "application/json")
            .header(ACCEPT, "text/event-stream")
            .body(body.to_string())
    }

    fn silent(&self) -> String {
        format!(
            "{} sent nothing for {} minutes, so the answer was given up",
            self.name,
            IDLE.as_secs() / 60
        )
    }

    /// Sends the request until a server accepts it; None when the person
    /// stopped the turn first. A ChatGPT request is tried again with a
    /// fresh token after a 401, and without a feature the server named as
    /// unsupported.
    async fn open(
        &self,
        call: &Call<'_>,
        cancel: &AtomicBool,
    ) -> Result<Option<reqwest::Response>, String> {
        let account = self.account.as_deref();
        let mut token = String::new();
        let mut shape = responses::Shape::default();
        if self.kind == Kind::ChatGpt {
            let Some(account) = account else {
                return Err(chatgpt::SIGN_IN_FIRST.to_owned());
            };
            token = match wait(account.access(&self.http), cancel).await {
                Waited::Done(token) => token?,
                Waited::Cancelled => return Ok(None),
                Waited::TimedOut => return Err(self.silent()),
            };
            shape = account.shape();
        }
        let (mut refreshed, mut adapted) = (false, 0);
        loop {
            let response = match wait(self.request(call, &token, shape).send(), cancel).await {
                Waited::Done(Ok(response)) => response,
                Waited::Done(Err(err)) => {
                    return Err(unreachable(&self.name, &self.url, &err));
                }
                Waited::Cancelled => return Ok(None),
                Waited::TimedOut => return Err(self.silent()),
            };
            let status = response.status().as_u16();
            if response.status().is_success() {
                return Ok(Some(response));
            }
            let body = match wait(response.text(), cancel).await {
                Waited::Done(Ok(body)) => body,
                _ => String::new(),
            };
            if let Some(account) = account.filter(|_| self.kind == Kind::ChatGpt) {
                if status == 401 && !refreshed {
                    refreshed = true;
                    token = match wait(account.after_rejection(&self.http, &token), cancel).await {
                        Waited::Done(token) => token?,
                        Waited::Cancelled => return Ok(None),
                        Waited::TimedOut => return Err(self.silent()),
                    };
                    continue;
                }
                if status == 400
                    && adapted < 2
                    && let Some(next) = shape.adapted(&body)
                {
                    adapted += 1;
                    shape = next;
                    account.learn(shape);
                    continue;
                }
                return Err(chatgpt::words::refused(&self.name, status, &body));
            }
            return Err(http_error(&self.name, status, &body));
        }
    }
}

enum Decoder {
    Anthropic(anthropic::Stream),
    OpenAi(openai::Stream),
    Responses(responses::Stream),
}

impl Decoder {
    fn of(kind: Kind) -> Decoder {
        match kind {
            Kind::Anthropic => Decoder::Anthropic(anthropic::Stream::default()),
            Kind::OpenAi => Decoder::OpenAi(openai::Stream::default()),
            Kind::ChatGpt => Decoder::Responses(responses::Stream::default()),
        }
    }

    fn event(&mut self, event: &SseEvent) -> Result<Option<String>, String> {
        match self {
            Decoder::Anthropic(s) => s.event(event),
            Decoder::OpenAi(s) => s.event(event),
            Decoder::Responses(s) => s.event(event),
        }
    }

    fn ended(&self) -> bool {
        match self {
            Decoder::Anthropic(s) => s.ended(),
            Decoder::OpenAi(s) => s.ended(),
            Decoder::Responses(s) => s.ended(),
        }
    }

    fn complete(&self) -> bool {
        match self {
            Decoder::Anthropic(s) => s.complete(),
            Decoder::OpenAi(s) => s.complete(),
            Decoder::Responses(s) => s.complete(),
        }
    }

    fn reply(self, cancelled: bool) -> Reply {
        match self {
            Decoder::Anthropic(s) => s.reply(cancelled),
            Decoder::OpenAi(s) => s.reply(cancelled),
            Decoder::Responses(s) => s.reply(cancelled),
        }
    }

    /// A failure that keeps the text said so far.
    fn failed(self, message: String) -> Failure {
        let partial = self.reply(true);
        Failure {
            message,
            partial: (!partial.text.trim().is_empty()).then_some(partial),
        }
    }
}

enum Waited<T> {
    Done(T),
    Cancelled,
    TimedOut,
}

/// Awaits `future` unless the person stops the turn or nothing happens
/// for `IDLE`.
async fn wait<F: Future>(future: F, cancel: &AtomicBool) -> Waited<F::Output> {
    let mut future = std::pin::pin!(future);
    let mut quiet = Duration::ZERO;
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Waited::Cancelled;
        }
        match tokio::time::timeout(TICK, future.as_mut()).await {
            Ok(output) => return Waited::Done(output),
            Err(_) => {
                quiet += TICK;
                if quiet >= IDLE {
                    return Waited::TimedOut;
                }
            }
        }
    }
}

impl Model for HttpModel {
    async fn reply(
        &self,
        call: &Call<'_>,
        text: &(dyn Fn(&str) + Sync),
        cancel: &AtomicBool,
    ) -> Result<Reply, Failure> {
        let mut decoder = Decoder::of(self.kind);
        let Some(mut response) = self.open(call, cancel).await.map_err(Failure::new)? else {
            return Ok(decoder.reply(true));
        };
        let mut sse = SseParser::default();
        loop {
            let (events, end) = match wait(response.chunk(), cancel).await {
                Waited::Done(Ok(Some(chunk))) => (sse.push(&chunk), false),
                Waited::Done(Ok(None)) => (sse.finish(), true),
                Waited::Done(Err(err)) => {
                    let why = chain(&err);
                    let message = format!("The connection to {} broke: {why}", self.name);
                    return Err(decoder.failed(message));
                }
                Waited::Cancelled => return Ok(decoder.reply(true)),
                Waited::TimedOut => return Err(decoder.failed(self.silent())),
            };
            if sse.overflowed() {
                let message = format!("{} sent more in one piece than KastenFlow reads", self.name);
                return Err(decoder.failed(message));
            }
            for event in &events {
                match decoder.event(event) {
                    Ok(Some(piece)) => text(&piece),
                    Ok(None) => {}
                    Err(why) => {
                        let message = format!("{} stopped with an error: {why}", self.name);
                        return Err(decoder.failed(message));
                    }
                }
            }
            if end || decoder.ended() {
                break;
            }
        }
        if !decoder.complete() {
            let message = format!(
                "The connection to {} closed before the answer was complete",
                self.name
            );
            return Err(decoder.failed(message));
        }
        Ok(decoder.reply(false))
    }
}
