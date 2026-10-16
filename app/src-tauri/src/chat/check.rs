//! "Test connection" in Settings: one short request down the same path a
//! chat takes, with a function tool, the reasoning the plan keeps between
//! steps and the effort the person set, so a test that passes means a chat
//! will work, and one that fails fails where a chat would. For a ChatGPT
//! sign-in the stages before the request are tried too, and the one that
//! failed is named. It says what came back and how long it took, or why it
//! failed in the HTTP layer's own words (status, the provider's message
//! and what to check).

use std::sync::atomic::AtomicBool;
use std::time::{Duration, Instant};

use kasten_mcp::tools::ToolSpec;
use serde::Serialize;
use serde_json::json;

use super::chatgpt::{Account, models};
use super::diagnostics::Stage;
use super::http::{HttpModel, Kind};
use super::model::{Call, Message, Model};

/// How long a test waits for the whole answer.
const LIMIT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCheck {
    pub ok: bool,
    /// The model asked.
    pub model: String,
    /// How long the answer took, in milliseconds.
    pub millis: u64,
    /// The start of what the model said.
    pub reply: String,
    /// One sentence for the person: that it works, or why not.
    pub message: String,
    /// Where it failed, for a test that did: `signIn`, `renewal`,
    /// `modelList`, `request` or `stream`.
    pub stage: Option<Stage>,
    /// How many tries the request took.
    pub attempts: u32,
}

/// The tool every chat request carries, as small as one can be.
fn probe_tool() -> ToolSpec {
    ToolSpec {
        name: "connection_test".to_owned(),
        description: "Does nothing. Present only to check that tools are accepted.".to_owned(),
        input_schema: json!({"type": "object", "properties": {}}),
        read_only: true,
    }
}

fn millis_since(started: Instant) -> u64 {
    u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX)
}

fn failed(model: &str, started: Instant, stage: Stage, message: String) -> ProviderCheck {
    ProviderCheck {
        ok: false,
        model: model.to_owned(),
        millis: millis_since(started),
        reply: String::new(),
        message,
        stage: Some(stage),
        attempts: 0,
    }
}

/// The stages before the request that a ChatGPT sign-in has: being signed
/// in, renewing the token, listing the models. The first that fails.
async fn before_the_request(
    account: &Account,
    model: &HttpModel,
    name: &str,
    started: Instant,
) -> Option<ProviderCheck> {
    let http = model.client();
    let status = account.status().await;
    if let Some(why) = status.keychain_error {
        return Some(failed(name, started, Stage::SignIn, why));
    }
    if status.reauth {
        let message = super::chatgpt::SIGN_IN_AGAIN.to_owned();
        return Some(failed(name, started, Stage::SignIn, message));
    }
    if !status.signed_in {
        let message = super::chatgpt::SIGN_IN_FIRST.to_owned();
        return Some(failed(name, started, Stage::SignIn, message));
    }
    if let Err(denied) = account.token(&http).await {
        let message = format!("Renewing the ChatGPT sign-in failed: {}", denied.message);
        return Some(failed(name, started, denied.stage, message));
    }
    // The models are listed where the requests go (api.openai.com/v1).
    let listed = format!("{}/models", model.url().trim_end_matches("/responses"));
    match models::list(account, &http, &listed).await {
        Ok(_) => None,
        Err(why) => {
            let message = format!("Listing the models failed: {why}");
            Some(failed(name, started, Stage::ModelList, message))
        }
    }
}

/// Asks `model` (named `name`) for one word, with a tool, and reports how it
/// went.
pub async fn check(model: &HttpModel, name: &str) -> ProviderCheck {
    let started = Instant::now();
    if model.kind() == Kind::ChatGpt
        && let Some(account) = model.account()
        && let Some(stopped) = before_the_request(account, model, name, started).await
    {
        return stopped;
    }
    let messages = [Message::User("Reply with the one word OK.".to_owned())];
    let tools = [probe_tool()];
    let call = Call {
        system: "You are answering a connection test. Reply with one word.",
        messages: &messages,
        tools: &tools,
    };
    let cancel = AtomicBool::new(false);
    let answer = tokio::time::timeout(LIMIT, model.reply(&call, &|_| {}, &cancel)).await;
    let millis = millis_since(started);
    let outcome = model.last_outcome();
    let attempts = outcome.as_ref().map_or(1, |o| o.attempts);
    let (ok, reply, message, stage) = match answer {
        Err(_) => (
            false,
            String::new(),
            format!(
                "No answer from {name} within a minute. The server may be busy, or the model still loading"
            ),
            Some(Stage::Stream),
        ),
        Ok(Err(failure)) => (
            false,
            String::new(),
            failure.message,
            Some(outcome.map_or(Stage::Request, |o| o.stage)),
        ),
        Ok(Ok(reply)) => {
            let text: String = reply.text.trim().chars().take(80).collect();
            let seconds = millis as f64 / 1000.0;
            let tries = if attempts > 1 {
                format!(" (after {attempts} tries)")
            } else {
                String::new()
            };
            (
                true,
                text,
                format!("{name} answered in {seconds:.1} s{tries}"),
                None,
            )
        }
    };
    ProviderCheck {
        ok,
        model: name.to_owned(),
        millis,
        reply,
        message,
        stage,
        attempts,
    }
}
