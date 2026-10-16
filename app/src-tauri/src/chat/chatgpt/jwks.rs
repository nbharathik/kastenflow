//! OpenAI's published signing keys, which the ID token checks need. The key
//! set is fetched from the address OpenAI's discovery document names (on
//! auth.openai.com alone), read defensively, and kept for as long as OpenAI
//! says (clamped to between five minutes and a day). A token that names a
//! key not in the set earns one new fetch, and no more than one a minute,
//! so a rotation is followed and a stream of strange tokens costs nothing.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use jsonwebtoken::DecodingKey;
use reqwest::header::{ACCEPT, CACHE_CONTROL};
use serde_json::Value;

use super::authorize::WAIT;
use super::idtoken::{self, Identity, Rejected};

/// The most a key set document may weigh.
pub const MAX_BODY: usize = 64 * 1024;
/// The most keys a key set may list; more is not a key set of OpenAI's.
pub const MAX_KEYS: usize = 16;
/// An RSA key smaller than 2048 bits (256 bytes) is not trusted.
const MIN_MODULUS: usize = 256;
/// How long a key set is kept when OpenAI does not say, and the bounds of
/// what it may say.
const DEFAULT_LIFETIME: Duration = Duration::from_secs(3600);
const LEAST: Duration = Duration::from_secs(300);
const MOST: Duration = Duration::from_secs(86_400);
/// The least time between two fetches made for an unknown key.
const REFETCH_GAP: Duration = Duration::from_secs(60);

/// The keys that may sign an ID token, by `kid`.
pub struct KeySet {
    keys: HashMap<String, DecodingKey>,
}

impl std::fmt::Debug for KeySet {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut kids: Vec<&String> = self.keys.keys().collect();
        kids.sort();
        f.debug_struct("KeySet").field("kids", &kids).finish()
    }
}

/// A member of the key set document that may be used: an RSA key for
/// signatures (`use` and `alg` may be left out, not say otherwise), with a
/// `kid`, and a modulus of at least 2048 bits.
fn usable(key: &Value) -> Option<(String, DecodingKey)> {
    let says = |name: &str, wanted: &str| key.get(name).is_none_or(|v| v.as_str() == Some(wanted));
    if key["kty"].as_str() != Some("RSA") || !says("use", "sig") || !says("alg", "RS256") {
        return None;
    }
    let kid = key["kid"]
        .as_str()
        .filter(|k| !k.is_empty() && k.len() <= 200)?;
    let (n, e) = (key["n"].as_str()?, key["e"].as_str()?);
    let modulus = URL_SAFE_NO_PAD.decode(n.trim_end_matches('=')).ok()?;
    if modulus.len() < MIN_MODULUS {
        return None;
    }
    DecodingKey::from_rsa_components(n, e)
        .ok()
        .map(|decoding| (kid.to_owned(), decoding))
}

impl KeySet {
    /// Reads a key set document, keeping only the keys that may sign an ID
    /// token. A document that is too large or lists too many keys, or that
    /// leaves nothing usable, is refused.
    pub fn parse(body: &str) -> Result<KeySet, String> {
        let bad = |why: &str| format!("ChatGPT's keys for checking the sign-in {why}");
        if body.len() > MAX_BODY {
            return Err(bad("were larger than expected"));
        }
        let document: Value = serde_json::from_str(body).map_err(|_| bad("could not be read"))?;
        let listed = document["keys"]
            .as_array()
            .ok_or_else(|| bad("could not be read"))?;
        if listed.len() > MAX_KEYS {
            return Err(bad("were more than expected"));
        }
        let mut keys = HashMap::new();
        for (kid, key) in listed.iter().filter_map(usable) {
            keys.entry(kid).or_insert(key);
        }
        if keys.is_empty() {
            return Err(bad("held no key it can use"));
        }
        Ok(KeySet { keys })
    }

    pub fn get(&self, kid: &str) -> Option<&DecodingKey> {
        self.keys.get(kid)
    }

    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.keys.len()
    }
}

/// How long to keep a key set, from the response's `Cache-Control`.
pub fn lifetime(cache_control: Option<&str>) -> Duration {
    let max_age = cache_control.and_then(|value| {
        value.split(',').find_map(|directive| {
            let directive = directive.trim().to_ascii_lowercase();
            let age = directive.strip_prefix("max-age=")?;
            age.trim_matches('"').parse::<u64>().ok()
        })
    });
    max_age
        .map_or(DEFAULT_LIFETIME, Duration::from_secs)
        .clamp(LEAST, MOST)
}

fn failed(err: &reqwest::Error) -> String {
    if err.is_timeout() {
        "ChatGPT took too long to give the keys that check the sign-in; try again".to_owned()
    } else {
        "Could not reach ChatGPT to check the sign-in. Check the connection and try again"
            .to_owned()
    }
}

/// Asks for the key set at `url`.
async fn fetch(http: &reqwest::Client, url: &str) -> Result<(KeySet, Duration), String> {
    let mut response = http
        .get(url)
        .header(ACCEPT, "application/json")
        .timeout(WAIT)
        .send()
        .await
        .map_err(|e| failed(&e))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "ChatGPT answered {} when asked for the keys that check the sign-in. Try again in a moment",
            status.as_u16()
        ));
    }
    let kept = lifetime(
        response
            .headers()
            .get(CACHE_CONTROL)
            .and_then(|v| v.to_str().ok()),
    );
    let too_big = || "ChatGPT's keys for checking the sign-in were larger than expected".to_owned();
    if response
        .content_length()
        .is_some_and(|n| n > MAX_BODY as u64)
    {
        return Err(too_big());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| failed(&e))? {
        if body.len() + chunk.len() > MAX_BODY {
            return Err(too_big());
        }
        body.extend_from_slice(&chunk);
    }
    let text = String::from_utf8(body)
        .map_err(|_| "ChatGPT's keys for checking the sign-in could not be read".to_owned())?;
    Ok((KeySet::parse(&text)?, kept))
}

/// Why an ID token was not taken.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Failed {
    /// The keys could not be had: nothing is known about the token.
    Keys(String),
    /// The token itself is no good.
    Token(Rejected),
}

struct Held {
    keys: Arc<KeySet>,
    until: Instant,
}

#[derive(Default)]
struct State {
    held: Option<Held>,
    /// When an unknown key last earned a new fetch.
    unknown_at: Option<Instant>,
}

/// The key set, fetched when first needed and kept.
#[derive(Default)]
pub struct Cache {
    state: tokio::sync::Mutex<State>,
}

impl State {
    async fn fetch(&mut self, http: &reqwest::Client, url: &str) -> Result<Arc<KeySet>, String> {
        let (keys, kept) = fetch(http, url).await?;
        let keys = Arc::new(keys);
        self.held = Some(Held {
            keys: Arc::clone(&keys),
            until: Instant::now() + kept,
        });
        Ok(keys)
    }

    async fn current(&mut self, http: &reqwest::Client, url: &str) -> Result<Arc<KeySet>, String> {
        match &self.held {
            Some(held) if held.until > Instant::now() => Ok(Arc::clone(&held.keys)),
            _ => self.fetch(http, url).await,
        }
    }
}

impl Cache {
    /// Checks an ID token against OpenAI's keys, fetched from `url` if they
    /// are not held. Concurrent checks take turns, so one fetch serves them.
    pub async fn identity(
        &self,
        http: &reqwest::Client,
        url: &str,
        token: &str,
        client_id: &str,
        nonce: Option<&str>,
        now: u64,
    ) -> Result<Identity, Failed> {
        let mut state = self.state.lock().await;
        let keys = state.current(http, url).await.map_err(Failed::Keys)?;
        let first = idtoken::verify(token, &keys, client_id, nonce, now);
        let Err(Rejected::UnknownKey(_)) = first else {
            return first.map_err(Failed::Token);
        };
        // A key OpenAI added since: one new look, then not again for a while.
        if state
            .unknown_at
            .is_some_and(|at| at.elapsed() < REFETCH_GAP)
        {
            return first.map_err(Failed::Token);
        }
        state.unknown_at = Some(Instant::now());
        let keys = state.fetch(http, url).await.map_err(Failed::Keys)?;
        idtoken::verify(token, &keys, client_id, nonce, now).map_err(Failed::Token)
    }

    /// Makes the held keys out of date, as if their lifetime had passed.
    #[cfg(test)]
    pub(crate) async fn expire(&self) {
        if let Some(held) = &mut self.state.lock().await.held {
            held.until = Instant::now();
        }
    }

    /// Lets the next unknown key earn a fetch, as if a minute had passed.
    #[cfg(test)]
    pub(crate) async fn forget_last_look(&self) {
        self.state.lock().await.unknown_at = None;
    }
}

#[cfg(test)]
#[path = "jwks_tests.rs"]
mod tests;
