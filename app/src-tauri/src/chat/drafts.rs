//! Setting up a provider in Settings before it is saved: the models it
//! offers, and whether it answers. The key is the one typed in the form,
//! held in memory for the request only; with none typed, the key kept for
//! the same name at the same address, if that address is confirmed on
//! this computer (a vault's settings can name any server).

use std::time::Duration;

use kasten_core::config::Provider;
use serde_json::Value;
use tauri::State;

use super::anthropic;
use super::chatgpt::models;
use super::check::{self, ProviderCheck};
use super::commands::ChatState;
use super::http::{HttpModel, Kind, http_error, unreachable};
use super::providers::ProviderInput;
use super::{address, openai};

/// How long listing models may take.
const LIMIT: Duration = Duration::from_secs(20);

/// Where `kind`'s API lists its models, under `base`.
pub fn models_url(kind: Kind, base: &str) -> Result<String, String> {
    Ok(match kind {
        Kind::Anthropic => {
            let messages = anthropic::url(base);
            format!(
                "{}/models?limit=100",
                messages.trim_end_matches("/messages")
            )
        }
        Kind::OpenAi => {
            let chat = openai::url(base)?;
            format!("{}/models", chat.trim_end_matches("/chat/completions"))
        }
        // The same address whatever the settings say.
        Kind::ChatGpt => models::url(),
    })
}

/// The model ids in a models list (`data[].id`, as both APIs give them),
/// once each, in the order given.
pub fn parse_models(body: &str) -> Vec<String> {
    let parsed: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let mut out: Vec<String> = Vec::new();
    for id in parsed["data"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|m| m["id"].as_str())
    {
        let id = id.trim();
        if !id.is_empty() && !out.iter().any(|o| o == id) {
            out.push(id.to_owned());
        }
    }
    out
}

/// The models `provider` offers, asked with `key`.
pub async fn list_models(
    http: &reqwest::Client,
    provider: &Provider,
    key: Option<&str>,
) -> Result<Vec<String>, String> {
    let kind = Kind::of(&provider.kind)?;
    if kind == Kind::ChatGpt {
        return Err("ChatGPT lists its models for the account that is signed in".to_owned());
    }
    let url = models_url(kind, &provider.base_url)?;
    let key = key.map(str::trim).filter(|k| !k.is_empty());
    let mut request = http.get(&url).timeout(LIMIT);
    match (kind, key) {
        // Returned above: it has no key to send.
        (Kind::ChatGpt, _) => {}
        (Kind::Anthropic, None) => {
            return Err(format!("Add the API key for “{}” first", provider.name));
        }
        (Kind::Anthropic, Some(key)) => {
            request = request
                .header("x-api-key", key)
                .header("anthropic-version", anthropic::VERSION);
        }
        (Kind::OpenAi, Some(key)) => request = request.bearer_auth(key),
        (Kind::OpenAi, None) => {}
    }
    let response = request
        .send()
        .await
        .map_err(|err| unreachable(&provider.name, &url, &err))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|err| unreachable(&provider.name, &url, &err))?;
    if !status.is_success() {
        return Err(http_error(&provider.name, status.as_u16(), &body));
    }
    let models = parse_models(&body);
    if models.is_empty() {
        return Err(format!(
            "{} listed no models; type the model's name",
            provider.name
        ));
    }
    Ok(models)
}

fn draft(input: ProviderInput) -> Provider {
    Provider {
        name: input.name.trim().to_owned(),
        kind: input.kind,
        base_url: input.base_url.trim().to_owned(),
        model: input.model.trim().to_owned(),
    }
}

/// The key to ask with: the one typed, if it may travel there, else the
/// one kept for this provider, if its address is confirmed here.
async fn draft_key(
    state: &ChatState,
    provider: &Provider,
    typed: Option<String>,
) -> Result<Option<String>, String> {
    if let Some(key) = typed.map(|k| k.trim().to_owned()).filter(|k| !k.is_empty()) {
        if !address::may_carry_key(provider)? {
            return Err(
                "A key is only sent over https, or to a server on this computer".to_owned(),
            );
        }
        return Ok(Some(key));
    }
    if !state.confirmed(provider) {
        return Ok(None);
    }
    state.key(provider).await
}

/// The models a provider being set up offers, for the model picker.
#[tauri::command]
pub async fn list_provider_models(
    state: State<'_, ChatState>,
    provider: ProviderInput,
    key: Option<String>,
) -> Result<Vec<String>, String> {
    let provider = draft(provider);
    if Kind::of(&provider.kind)? == Kind::ChatGpt {
        // The signed-in account's own list, else a few names to start from.
        return Ok(models::or_defaults(&state.chatgpt(), &state.http()?).await);
    }
    let key = draft_key(&state, &provider, key).await?;
    list_models(&state.http()?, &provider, key.as_deref()).await
}

/// "Test connection" before saving: one short request, as a chat sends it.
#[tauri::command]
pub async fn test_provider_draft(
    state: State<'_, ChatState>,
    provider: ProviderInput,
    key: Option<String>,
) -> Result<ProviderCheck, String> {
    let provider = draft(provider);
    let model = if Kind::of(&provider.kind)? == Kind::ChatGpt {
        state.model_of(&provider, "").await?
    } else {
        let key = draft_key(&state, &provider, key).await?;
        HttpModel::new(state.http()?, &provider, key, "")?
    };
    let asked = model.model_name().to_owned();
    Ok(check::check(&model, &asked).await)
}
