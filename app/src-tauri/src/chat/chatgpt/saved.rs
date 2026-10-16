//! What the keychain keeps of the ChatGPT sign-in: one entry,
//! `chatgpt @ https://auth.openai.com`, with only what a later start needs
//! to sign back in. The access token and the ID token stay in memory (the
//! keychain takes little per entry, and an access token lasts an hour).

use serde::{Deserialize, Serialize};

use crate::secrets::KeyStore;

/// The keychain account of the sign-in.
pub const ENTRY: &str = "chatgpt @ https://auth.openai.com";

/// What the keychain keeps.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Saved {
    pub refresh_token: String,
    pub client_id: String,
    pub email: Option<String>,
    /// OpenAI's id for the account, from the verified ID token of the
    /// sign-in. An entry from before accounts were checked has none: it is
    /// kept, and signing in again fills it in.
    #[serde(default)]
    pub sub: Option<String>,
}

/// Shown without the refresh token.
impl std::fmt::Debug for Saved {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Saved")
            .field("client_id", &self.client_id)
            .field("email", &self.email)
            .field("confirmed", &self.sub.is_some())
            .finish_non_exhaustive()
    }
}

impl Saved {
    /// Whether the account was confirmed by a verified ID token.
    pub fn confirmed(&self) -> bool {
        self.sub.as_deref().is_some_and(|s| !s.is_empty())
    }
}

pub fn read(keys: &dyn KeyStore) -> Result<Option<Saved>, String> {
    Ok(keys
        .get(ENTRY)?
        .and_then(|text| serde_json::from_str(&text).ok()))
}

pub fn write(keys: &dyn KeyStore, saved: &Saved) -> Result<(), String> {
    let text = serde_json::to_string(saved).map_err(|e| e.to_string())?;
    keys.set(ENTRY, &text)
}

/// Whether the keychain holds a sign-in that can be used: one whose account
/// was confirmed.
pub fn signed_in(keys: &dyn KeyStore) -> bool {
    read(keys).is_ok_and(|saved| saved.is_some_and(|s| s.confirmed()))
}
