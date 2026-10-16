//! The ID token OpenAI's token endpoint hands back: whose it says it is, and
//! that OpenAI signed it. The signature is checked against OpenAI's
//! published keys (jwks.rs) before a word of the token is believed. Only
//! RS256 is taken, and the algorithm is judged from the header before any
//! key is looked up, so a token that names HS256 (signed with the public
//! key as a secret), `none` or anything else never reaches a key.
//!
//! The library checks the signature, the issuer and the audience. The
//! clock is read here, against the time the caller gives, so the limits are
//! exact in tests: a minute of slack for clocks that differ.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use jsonwebtoken::errors::ErrorKind;
use jsonwebtoken::{Algorithm, Validation};
use serde_json::Value;

use super::authorize::ISSUER;
use super::jwks::KeySet;
use super::pkce;

/// The signature algorithms a token may use.
pub const ALLOWED: [&str; 1] = ["RS256"];

/// How far a clock may differ from OpenAI's, in seconds.
const LEEWAY: u64 = 60;

/// Whose token it is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Identity {
    /// OpenAI's own id for the account: it does not change with the email.
    pub sub: String,
    pub email: Option<String>,
}

/// Why a token is not taken.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Rejected {
    /// Its header names a key OpenAI does not publish (now).
    UnknownKey(String),
    /// Its header names an algorithm that is not allowed.
    Unsupported(String),
    /// The signature is not OpenAI's over these words.
    BadSignature,
    /// Signed, but not for this sign-in.
    Claims(&'static str),
    /// Not a token.
    Malformed,
}

impl Rejected {
    /// One sentence for the person.
    pub fn sentence(&self) -> String {
        match self {
            Rejected::UnknownKey(_) => {
                "ChatGPT's sign-in answer could not be verified (it names a key ChatGPT does not publish)".to_owned()
            }
            Rejected::Unsupported(alg) => {
                format!("ChatGPT's sign-in answer could not be verified (it is signed with “{alg}”)")
            }
            Rejected::BadSignature => {
                "ChatGPT's sign-in answer could not be verified (the signature does not match)".to_owned()
            }
            Rejected::Malformed => {
                "ChatGPT's sign-in answer could not be verified (it is not readable)".to_owned()
            }
            Rejected::Claims(why @ ("expired" | "not valid yet")) => format!(
                "ChatGPT's answer did not say who signed in ({why}). Check that this computer's date and time are right"
            ),
            Rejected::Claims(why) => format!("ChatGPT's answer did not say who signed in ({why})"),
        }
    }
}

/// The header's `alg` and `kid`, read before anything is trusted.
fn header(token: &str) -> Result<(String, Option<String>), Rejected> {
    let mut parts = token.split('.');
    let (Some(head), Some(_), Some(_), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(Rejected::Malformed);
    };
    let bytes = URL_SAFE_NO_PAD
        .decode(head.trim_end_matches('='))
        .map_err(|_| Rejected::Malformed)?;
    let header: Value = serde_json::from_slice(&bytes).map_err(|_| Rejected::Malformed)?;
    let alg = header["alg"].as_str().ok_or(Rejected::Malformed)?;
    Ok((alg.to_owned(), header["kid"].as_str().map(str::to_owned)))
}

/// What the library is asked to check: the signature, and OpenAI as the
/// issuer, this client in the audience. Time is checked by `verify`.
fn validation(client_id: &str) -> Validation {
    let mut validation = Validation::new(Algorithm::RS256);
    validation.validate_exp = false;
    validation.validate_nbf = false;
    validation.leeway = LEEWAY;
    validation.set_issuer(&[ISSUER]);
    validation.set_audience(&[client_id]);
    validation.set_required_spec_claims(&["iss", "aud"]);
    validation
}

/// What the library's refusal means.
fn refused(kind: &ErrorKind) -> Rejected {
    match kind {
        ErrorKind::InvalidIssuer => Rejected::Claims("another issuer"),
        ErrorKind::InvalidAudience => Rejected::Claims("another client"),
        ErrorKind::MissingRequiredClaim(name) => Rejected::Claims(match name.as_str() {
            "iss" => "no issuer",
            "aud" => "no audience",
            _ => "a claim is missing",
        }),
        ErrorKind::InvalidToken
        | ErrorKind::Base64(_)
        | ErrorKind::Json(_)
        | ErrorKind::Utf8(_) => Rejected::Malformed,
        // A bad signature, a key that does not fit, anything unforeseen:
        // all are refusals.
        _ => Rejected::BadSignature,
    }
}

fn seconds(claim: &Value) -> Option<f64> {
    claim.as_f64()
}

/// Checks `token` against OpenAI's `keys`: signed by one of them, issued by
/// OpenAI to `client_id`, not expired or early at `now` (seconds since
/// 1970), from the sign-in with `nonce` when one is given, and naming an
/// account.
pub fn verify(
    token: &str,
    keys: &KeySet,
    client_id: &str,
    nonce: Option<&str>,
    now: u64,
) -> Result<Identity, Rejected> {
    let (alg, kid) = header(token)?;
    if !ALLOWED.contains(&alg.as_str()) {
        return Err(Rejected::Unsupported(alg));
    }
    let kid = kid.filter(|k| !k.is_empty()).ok_or(Rejected::Malformed)?;
    let key = keys.get(&kid).ok_or(Rejected::UnknownKey(kid))?;
    let claims = jsonwebtoken::decode::<Value>(token, key, &validation(client_id))
        .map_err(|e| refused(e.kind()))?
        .claims;

    let now = now as f64;
    let slack = LEEWAY as f64;
    let Some(exp) = seconds(&claims["exp"]) else {
        return Err(Rejected::Claims("no expiry"));
    };
    if exp + slack < now {
        return Err(Rejected::Claims("expired"));
    }
    // "Not before" is optional; one that is there and is not a date, or is
    // still ahead, is not good yet.
    if !claims["nbf"].is_null() && seconds(&claims["nbf"]).is_none_or(|nbf| nbf > now + slack) {
        return Err(Rejected::Claims("not valid yet"));
    }
    let sub = claims["sub"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or(Rejected::Claims("no account"))?;
    if let Some(expected) = nonce
        && !claims["nonce"]
            .as_str()
            .is_some_and(|got| pkce::same(got, expected))
    {
        return Err(Rejected::Claims("another sign-in"));
    }
    // The authorised party, when the token names one, is this client.
    if let Some(azp) = claims.get("azp").filter(|a| !a.is_null())
        && azp.as_str() != Some(client_id)
    {
        return Err(Rejected::Claims("another client"));
    }
    Ok(Identity {
        sub: sub.to_owned(),
        email: claims["email"]
            .as_str()
            .map(str::trim)
            .filter(|e| !e.is_empty())
            .map(str::to_owned),
    })
}

#[cfg(test)]
#[path = "idtoken_tests.rs"]
mod tests;
