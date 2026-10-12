//! The random values of a sign-in, and PKCE (RFC 7636): a verifier kept in
//! memory, and the S256 challenge of it that goes to the browser. There is
//! no client secret; the verifier is what proves the app that asked for a
//! code is the one that exchanges it.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use sha2::{Digest, Sha256};

/// Cryptographic bytes from the OS; there is no weaker fallback.
fn random<const N: usize>() -> Result<[u8; N], String> {
    let mut bytes = [0u8; N];
    getrandom::fill(&mut bytes)
        .map_err(|e| format!("This computer gave no random numbers for the sign-in: {e}"))?;
    Ok(bytes)
}

/// 32 random bytes as 43 base64url characters: a PKCE verifier, a `state`
/// or a nonce.
pub fn secret() -> Result<String, String> {
    Ok(URL_SAFE_NO_PAD.encode(random::<32>()?))
}

/// The S256 challenge of a verifier: the unpadded base64url of its SHA-256.
pub fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// A new host id: a random version 4 UUID in its `urn:uuid:` form, which
/// names this installation of Kasten to OpenAI.
pub fn host_id() -> Result<String, String> {
    Ok(uuid_urn(random::<16>()?))
}

fn uuid_urn(mut bytes: [u8; 16]) -> String {
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!(
        "urn:uuid:{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    )
}

/// Whether two secrets are equal, taking as long whatever they share, so
/// the time a check takes tells a guess nothing.
pub fn same(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |diff, (x, y)| diff | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_challenge_is_the_one_in_rfc_7636_appendix_b() {
        assert_eq!(
            challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn a_verifier_is_43_url_safe_characters_and_never_repeats() {
        let a = secret().unwrap();
        let b = secret().unwrap();
        assert_ne!(a, b);
        for value in [&a, &b] {
            assert_eq!(value.len(), 43, "RFC 7636 asks for 43 to 128");
            assert!(
                value
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'),
                "{value}"
            );
        }
    }

    #[test]
    fn a_host_id_is_a_version_4_uuid_urn() {
        assert_eq!(
            uuid_urn([0xff; 16]),
            "urn:uuid:ffffffff-ffff-4fff-bfff-ffffffffffff"
        );
        assert_eq!(
            uuid_urn([0; 16]),
            "urn:uuid:00000000-0000-4000-8000-000000000000"
        );
        let id = host_id().unwrap();
        assert_eq!(id.len(), "urn:uuid:".len() + 36);
        assert_ne!(id, host_id().unwrap());
    }

    #[test]
    fn secrets_are_compared_whole() {
        assert!(same("abc", "abc"));
        assert!(!same("abc", "abd"));
        assert!(!same("abc", "abcd"));
        assert!(!same("", "a"));
        assert!(same("", ""));
    }
}
