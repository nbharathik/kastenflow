//! The chat's providers: endpoints in the vault's config (`ai.providers`),
//! keys in the keychain, each kept for the address it was saved for
//! (address.rs). The frontend learns whether a key is stored, never the key
//! itself.

use kasten_core::Kasten;
use kasten_core::config::Provider;
use serde::{Deserialize, Serialize};

use super::address;
use super::chatgpt;
use super::http::Kind;
use crate::secrets::KeyStore;

/// A provider as Settings and the chat's model picker show it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatProvider {
    pub name: String,
    pub kind: String,
    pub base_url: String,
    pub model: String,
    /// Whether the keychain holds a key for it; for a ChatGPT provider,
    /// whether Kasten is signed in with ChatGPT.
    pub has_key: bool,
    /// Whether notes may go to its address from this computer.
    pub confirmed: bool,
}

impl ChatProvider {
    /// The provider as the vault's config holds it.
    pub fn config(&self) -> Provider {
        Provider {
            name: self.name.clone(),
            kind: self.kind.clone(),
            base_url: self.base_url.clone(),
            model: self.model.clone(),
        }
    }
}

/// A provider as Settings saves it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInput {
    pub name: String,
    pub kind: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub model: String,
}

/// Every provider in the config, in order.
pub fn list(kasten: &Kasten, keys: &dyn KeyStore) -> Vec<ChatProvider> {
    kasten
        .config()
        .ai
        .providers
        .into_iter()
        .map(|p| ChatProvider {
            // A keychain that cannot be read holds no key the chat could use.
            has_key: if Kind::of(&p.kind) == Ok(Kind::ChatGpt) {
                chatgpt::signed_in(keys)
            } else {
                address::key_for(keys, &p).is_ok_and(|k| k.is_some())
            },
            // The commands say which are confirmed on this computer.
            confirmed: false,
            name: p.name,
            kind: p.kind,
            base_url: p.base_url,
            model: p.model,
        })
        .collect()
}

/// The provider called `name`.
pub fn find(kasten: &Kasten, name: &str) -> Result<Provider, String> {
    kasten
        .config()
        .ai
        .providers
        .into_iter()
        .find(|p| p.name == name.trim())
        .ok_or_else(|| format!("No AI provider called “{}”", name.trim()))
}

fn checked(input: ProviderInput) -> Result<Provider, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("A provider needs a name".to_owned());
    }
    if name.chars().count() > 60 {
        return Err("A provider's name is at most 60 characters".to_owned());
    }
    let kind = Kind::of(&input.kind)?;
    let base_url = input.base_url.trim().trim_end_matches('/');
    if !base_url.is_empty() && !base_url.starts_with("http://") && !base_url.starts_with("https://")
    {
        return Err(format!(
            "The base URL starts with http:// or https://, not “{base_url}”"
        ));
    }
    if kind == Kind::OpenAi {
        super::openai::url(base_url)?;
    }
    // Its requests go to OpenAI and nowhere else, so there is no address to
    // set (and none a vault's settings could redirect the sign-in to).
    if kind == Kind::ChatGpt && !base_url.is_empty() {
        return Err("A ChatGPT sign-in has a fixed address; leave the base URL empty".to_owned());
    }
    Ok(Provider {
        name: name.to_owned(),
        kind: input.kind.trim().to_owned(),
        base_url: base_url.to_owned(),
        model: input.model.trim().to_owned(),
    })
}

/// Adds the provider, or replaces the one of the same name where it is.
/// `key`: None leaves a stored key alone, empty deletes it, anything else
/// is stored. The key goes first, so a keychain that refuses it changes
/// nothing.
pub fn save(
    kasten: &Kasten,
    keys: &dyn KeyStore,
    input: ProviderInput,
    key: Option<String>,
) -> Result<Vec<ChatProvider>, String> {
    let provider = checked(input)?;
    match key.as_deref().map(str::trim) {
        None => {}
        Some("") => address::forget_key(keys, &provider)?,
        Some(key) => address::save_key(keys, &provider, key)?,
    }
    let mut config = kasten.config();
    let providers = &mut config.ai.providers;
    match providers.iter_mut().find(|p| p.name == provider.name) {
        Some(existing) => *existing = provider,
        None => providers.push(provider),
    }
    kasten.set_config(config).map_err(|e| e.to_string())?;
    Ok(list(kasten, keys))
}

/// Removes the provider and forgets its key.
pub fn remove(
    kasten: &Kasten,
    keys: &dyn KeyStore,
    name: &str,
) -> Result<Vec<ChatProvider>, String> {
    let name = name.trim();
    match find(kasten, name) {
        Ok(provider) => address::forget_key(keys, &provider)?,
        Err(_) => keys.delete(name)?,
    }
    let mut config = kasten.config();
    config.ai.providers.retain(|p| p.name != name);
    kasten.set_config(config).map_err(|e| e.to_string())?;
    Ok(list(kasten, keys))
}
