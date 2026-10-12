//! The models the signed-in account can use, from the API's own list. When
//! it cannot be read, Settings shows a short built-in list to start from.

use std::time::Duration;

use serde_json::Value;

use super::authorize::RESOURCE;
use super::session::Account;
use super::words;
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

/// The account's models, else the built-in ones.
pub async fn or_defaults(account: &Account, http: &reqwest::Client) -> Vec<String> {
    match list(account, http, &url()).await {
        Ok(models) => models,
        Err(_) => DEFAULTS.iter().map(|m| (*m).to_owned()).collect(),
    }
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
