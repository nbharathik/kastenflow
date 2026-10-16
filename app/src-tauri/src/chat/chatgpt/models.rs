//! The models the signed-in account can use, from the API's own list. When
//! it cannot be read, the picker is told why and given the last list that was
//! read (with its date); only when none ever was, a short built-in list to
//! start from, marked as not confirmed for the plan.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::authorize::RESOURCE;
use super::session::Account;
use super::words;
use crate::chat::cache;
use crate::chat::errors::unreachable;

const LIMIT: Duration = Duration::from_secs(20);

/// Where the API lists the models.
pub fn url() -> String {
    format!("{RESOURCE}/models")
}

/// Models to start from when the account's own list cannot be read. They
/// are OpenAI's documented names, not a promise that every plan has them.
pub const DEFAULTS: [&str; 3] = ["gpt-6.1-sol", "gpt-6-sol", "gpt-5.6-sol"];

/// The slugs of the models offered for choosing (`visibility: "list"`),
/// once each, in the order given.
pub fn parse(body: &str) -> Vec<String> {
    let parsed: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let mut out: Vec<String> = Vec::new();
    for slug in parsed["models"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|m| m["visibility"].as_str() == Some("list"))
        .filter_map(|m| m["slug"].as_str())
    {
        let slug = slug.trim();
        if !slug.is_empty() && slug.len() <= 200 && !out.iter().any(|o| o == slug) {
            out.push(slug.to_owned());
        }
    }
    out
}

/// The account's models, asked at `url`.
pub async fn list(
    account: &Account,
    http: &reqwest::Client,
    url: &str,
) -> Result<Vec<String>, String> {
    let mut token = account.access(http).await?;
    let mut refreshed = false;
    loop {
        let response = http
            .get(url)
            .bearer_auth(&token)
            .timeout(LIMIT)
            .send()
            .await
            .map_err(|e| unreachable("ChatGPT", url, &e))?;
        let status = response.status().as_u16();
        let body = response
            .text()
            .await
            .map_err(|e| unreachable("ChatGPT", url, &e))?;
        if status == 401 && !refreshed {
            refreshed = true;
            token = account.after_rejection(http, &token).await?;
            continue;
        }
        if status != 200 {
            return Err(words::refused("ChatGPT", status, &body));
        }
        let models = parse(&body);
        if models.is_empty() {
            return Err("ChatGPT listed no models for this account".to_owned());
        }
        return Ok(models);
    }
}

const CACHE: &str = "chatgpt-models.json";

/// The last list the account's own API gave, kept in the app's cache folder
/// for the account it was read for.
#[derive(Debug, Serialize, Deserialize)]
struct Cached {
    version: u32,
    owner: String,
    /// Milliseconds since 1970.
    fetched_at: u64,
    models: Vec<String>,
}

/// What the model picker gets: a list, and how far it can be trusted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub models: Vec<String>,
    /// The names are the account's own: read now, or the last time they
    /// could be. False for the built-in names, which are only a place to
    /// start and not confirmed for the plan.
    pub confirmed: bool,
    /// When the account's list was read, in milliseconds since 1970.
    pub fetched_at: Option<u64>,
    /// Why the list could not be read just now, in words for the person.
    pub error: Option<String>,
}

/// The account's models. When they cannot be read, the error is returned
/// with the last list that was read (and when), and only when none ever was,
/// with the built-in names, marked as not confirmed for the plan. `dir` is
/// where the last list is kept (else the app's cache folder).
pub async fn listing(
    account: &Account,
    http: &reqwest::Client,
    url: &str,
    dir: Option<std::path::PathBuf>,
) -> Listing {
    let dir = dir.or_else(cache::folder);
    let owner = account.owner().await;
    match list(account, http, url).await {
        Ok(models) => {
            let fetched_at = kasten_core::Instant::now().millis;
            if let (Some(dir), Some(owner)) = (&dir, &owner) {
                let kept = Cached {
                    version: 1,
                    owner: owner.clone(),
                    fetched_at,
                    models: models.clone(),
                };
                // A list that cannot be kept is only asked for again.
                let _ = cache::write(dir, CACHE, &kept);
            }
            Listing {
                models,
                confirmed: true,
                fetched_at: Some(fetched_at),
                error: None,
            }
        }
        Err(why) => {
            let error = Some(format!("Could not load your models: {why}"));
            let earlier = dir
                .as_deref()
                .and_then(|dir| cache::read::<Cached>(dir, CACHE))
                .filter(|c| c.version == 1 && Some(&c.owner) == owner.as_ref());
            match earlier {
                Some(cached) if !cached.models.is_empty() => Listing {
                    models: cached.models,
                    confirmed: true,
                    fetched_at: Some(cached.fetched_at),
                    error,
                },
                _ => Listing {
                    models: DEFAULTS.iter().map(|m| (*m).to_owned()).collect(),
                    confirmed: false,
                    fetched_at: None,
                    error,
                },
            }
        }
    }
}

/// The account's models, else the last list read, else the built-in names.
pub async fn or_defaults(account: &Account, http: &reqwest::Client) -> Vec<String> {
    listing(account, http, &url(), None).await.models
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_the_models_offered_for_choosing() {
        let body = r#"{"models":[
            {"slug":"gpt-6.1-sol","display_name":"GPT-6.1 Sol","visibility":"list"},
            {"slug":"hidden-one","display_name":"Hidden","visibility":"hide"},
            {"slug":"gpt-6.1-sol","display_name":"Again","visibility":"list"},
            {"slug":" gpt-6-luna ","visibility":"list"},
            {"slug":"","visibility":"list"},
            {"display_name":"No slug","visibility":"list"}]}"#;
        assert_eq!(parse(body), ["gpt-6.1-sol", "gpt-6-luna"]);
        assert!(parse("<html>").is_empty());
        assert!(parse(r#"{"models":"none"}"#).is_empty());
    }
}
