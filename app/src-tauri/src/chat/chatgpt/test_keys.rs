//! Keys and tokens for the tests of the ID token checks: two throwaway RSA
//! key pairs from the fixtures folder, and tokens signed with them the way
//! OpenAI would sign one. Nothing here is compiled into the app.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use jsonwebtoken::{Algorithm, EncodingKey, Header};
use serde_json::{Value, json};

use super::authorize::ISSUER;
use super::jwks::KeySet;

/// The `kid` of key pair A and of key pair B.
pub const KID_A: &str = "test-key-a";
pub const KID_B: &str = "test-key-b";

const KEY_A: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/oidc/key-a.pkcs1.der"
));
const KEY_B: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/oidc/key-b.pkcs1.der"
));

/// A key set document, as OpenAI's key address would answer.
pub const JWKS_A: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/oidc/jwks-a.json"
));
pub const JWKS_B: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/oidc/jwks-b.json"
));
pub const JWKS_AB: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/oidc/jwks-ab.json"
));

/// The keys of a published document.
pub fn keys(document: &str) -> KeySet {
    KeySet::parse(document).expect("the fixture key sets are well formed")
}

/// Which private key signs.
#[derive(Debug, Clone, Copy)]
pub enum Signer {
    A,
    B,
}

/// `claims` signed with RS256 by `signer`, naming `kid` in the header.
pub fn sign(signer: Signer, kid: Option<&str>, claims: &Value) -> String {
    let mut header = Header::new(Algorithm::RS256);
    header.kid = kid.map(str::to_owned);
    let der = match signer {
        Signer::A => KEY_A,
        Signer::B => KEY_B,
    };
    jsonwebtoken::encode(&header, claims, &EncodingKey::from_rsa_der(der))
        .expect("the fixture keys sign")
}

/// The claims of a good ID token for `client` and `nonce`, at `now`.
pub fn claims(client: &str, nonce: &str, now: u64) -> Value {
    json!({
        "iss": ISSUER, "aud": client, "sub": "user-1", "nonce": nonce,
        "iat": now, "exp": now + 3600, "email": " me@example.com "
    })
}

/// `claims` with `key` set to `value`.
pub fn with(claims: &Value, key: &str, value: Value) -> Value {
    let mut changed = claims.clone();
    changed[key] = value;
    changed
}

/// `claims` without `key`.
pub fn without(claims: &Value, key: &str) -> Value {
    let mut changed = claims.clone();
    if let Some(object) = changed.as_object_mut() {
        object.remove(key);
    }
    changed
}

/// A good token: signed by A, naming A.
pub fn token(client: &str, nonce: &str, now: u64) -> String {
    sign(Signer::A, Some(KID_A), &claims(client, nonce, now))
}

fn part(value: &Value) -> String {
    URL_SAFE_NO_PAD.encode(value.to_string())
}

/// A token with the header and claims given and any signature at all: for
/// tokens the checks must refuse before they look at it.
pub fn raw(header: &Value, claims: &Value, signature: &[u8]) -> String {
    format!(
        "{}.{}.{}",
        part(header),
        part(claims),
        URL_SAFE_NO_PAD.encode(signature)
    )
}

/// `token` with its claims replaced and its signature kept.
pub fn resigned_by_nobody(token: &str, claims: &Value) -> String {
    let mut parts = token.split('.');
    let (header, _, signature) = (
        parts.next().unwrap_or_default(),
        parts.next(),
        parts.next().unwrap_or_default(),
    );
    format!("{header}.{}.{signature}", part(claims))
}
