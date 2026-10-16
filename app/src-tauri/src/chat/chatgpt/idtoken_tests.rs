use serde_json::json;

use super::*;
use crate::chat::chatgpt::test_keys::{
    JWKS_A, JWKS_AB, KID_A, KID_B, Signer, claims, keys, raw, resigned_by_nobody, sign, token,
    with, without,
};

const NOW: u64 = 1_900_000_000;
const CLIENT: &str = "oaiapp_abc";
const NONCE: &str = "n-1";

fn good() -> String {
    token(CLIENT, NONCE, NOW)
}

fn check(token: &str) -> Result<Identity, Rejected> {
    verify(token, &keys(JWKS_AB), CLIENT, Some(NONCE), NOW)
}

fn signed_with(claims: &serde_json::Value) -> String {
    sign(Signer::A, Some(KID_A), claims)
}

#[test]
fn a_good_token_names_the_account_and_its_email() {
    assert_eq!(
        check(&good()),
        Ok(Identity {
            sub: "user-1".into(),
            email: Some("me@example.com".into())
        })
    );
    // A token signed by B is as good, when its header says B.
    let by_b = sign(Signer::B, Some(KID_B), &claims(CLIENT, NONCE, NOW));
    assert!(check(&by_b).is_ok());
    // No email is fine; no nonce to compare (a refresh) is fine.
    let bare = signed_with(&without(&claims(CLIENT, NONCE, NOW), "email"));
    assert_eq!(check(&bare).unwrap().email, None);
    assert!(verify(&good(), &keys(JWKS_A), CLIENT, None, NOW).is_ok());
}

#[test]
fn a_signature_by_another_key_or_over_other_words_is_refused() {
    // Signed with B's private key but claiming to be A's.
    let forged = sign(Signer::B, Some(KID_A), &claims(CLIENT, NONCE, NOW));
    assert_eq!(check(&forged), Err(Rejected::BadSignature));
    // The claims changed after signing.
    let other = with(&claims(CLIENT, NONCE, NOW), "sub", json!("user-2"));
    assert_eq!(
        check(&resigned_by_nobody(&good(), &other)),
        Err(Rejected::BadSignature)
    );
    // A signature with one character changed in the middle (the last
    // character's spare bits would decode to the same signature).
    let whole = good();
    let (head, signature) = whole.rsplit_once('.').unwrap();
    let mut signature: Vec<char> = signature.chars().collect();
    signature[10] = if signature[10] == 'A' { 'B' } else { 'A' };
    let damaged = format!("{head}.{}", signature.iter().collect::<String>());
    assert_eq!(check(&damaged), Err(Rejected::BadSignature));
    // A signature that is not even a signature.
    assert_eq!(check(&format!("{head}.AAAA")), Err(Rejected::BadSignature));
}

#[test]
fn only_rs256_is_taken_and_before_any_key_is_looked_up() {
    let body = claims(CLIENT, NONCE, NOW);
    for alg in ["HS256", "none", "ES256", "RS384", "PS256", "rs256", "EdDSA"] {
        // A kid no key has: the algorithm is judged first.
        let header = json!({"alg": alg, "typ": "JWT", "kid": "nobody"});
        assert_eq!(
            check(&raw(&header, &body, b"whatever")),
            Err(Rejected::Unsupported(alg.to_owned())),
            "{alg}"
        );
    }
    // The classic confusion: HS256 over the public key as the secret.
    let header = json!({"alg": "HS256", "typ": "JWT", "kid": KID_A});
    assert_eq!(
        check(&raw(&header, &body, &[7; 32])),
        Err(Rejected::Unsupported("HS256".into()))
    );
    // No algorithm at all.
    assert_eq!(
        check(&raw(&json!({"kid": KID_A}), &body, b"x")),
        Err(Rejected::Malformed)
    );
}

#[test]
fn the_key_is_named_by_kid() {
    let body = claims(CLIENT, NONCE, NOW);
    assert_eq!(
        check(&sign(Signer::A, Some("rotated-away"), &body)),
        Err(Rejected::UnknownKey("rotated-away".into()))
    );
    assert_eq!(
        check(&sign(Signer::A, None, &body)),
        Err(Rejected::Malformed),
        "a token that names no key cannot be checked"
    );
    // A key set without B does not know B's tokens.
    let only_a = keys(JWKS_A);
    let by_b = sign(Signer::B, Some(KID_B), &body);
    assert_eq!(
        verify(&by_b, &only_a, CLIENT, Some(NONCE), NOW),
        Err(Rejected::UnknownKey(KID_B.into()))
    );
}

#[test]
fn a_token_ends_when_it_expires_with_a_minute_of_slack() {
    let at = |exp: u64| signed_with(&with(&claims(CLIENT, NONCE, NOW), "exp", json!(exp)));
    assert!(check(&at(NOW - 30)).is_ok(), "30 s ago is inside the slack");
    assert!(check(&at(NOW - 60)).is_ok(), "60 s ago is the edge");
    assert_eq!(check(&at(NOW - 61)), Err(Rejected::Claims("expired")));
    assert_eq!(check(&at(NOW - 86_400)), Err(Rejected::Claims("expired")));
    assert!(check(&at(NOW + 1)).is_ok());
    // A fractional NumericDate is a date too.
    let fractional = signed_with(&with(
        &claims(CLIENT, NONCE, NOW),
        "exp",
        json!((NOW - 100) as f64 + 0.5),
    ));
    assert_eq!(check(&fractional), Err(Rejected::Claims("expired")));
    assert_eq!(
        check(&signed_with(&without(&claims(CLIENT, NONCE, NOW), "exp"))),
        Err(Rejected::Claims("no expiry"))
    );
}

#[test]
fn a_token_for_later_is_not_good_yet() {
    let from = |nbf: u64| signed_with(&with(&claims(CLIENT, NONCE, NOW), "nbf", json!(nbf)));
    assert!(
        check(&from(NOW + 30)).is_ok(),
        "30 s ahead is inside the slack"
    );
    assert!(check(&from(NOW - 10)).is_ok());
    assert_eq!(
        check(&from(NOW + 61)),
        Err(Rejected::Claims("not valid yet"))
    );
    assert_eq!(
        check(&from(NOW + 3600)),
        Err(Rejected::Claims("not valid yet"))
    );
}

#[test]
fn the_issuer_and_the_audience_must_be_openais_and_this_clients() {
    let body = claims(CLIENT, NONCE, NOW);
    let by = |key: &str, value: serde_json::Value| signed_with(&with(&body, key, value));
    assert_eq!(
        check(&by("iss", json!("https://evil.example"))),
        Err(Rejected::Claims("another issuer"))
    );
    assert_eq!(
        check(&by("iss", json!("https://auth.openai.com/"))),
        Err(Rejected::Claims("another issuer")),
        "the issuer is compared exactly"
    );
    assert_eq!(
        check(&by("aud", json!("oaiapp_other"))),
        Err(Rejected::Claims("another client"))
    );
    assert_eq!(
        check(&by("aud", json!(["a", "b"]))),
        Err(Rejected::Claims("another client"))
    );
    assert!(check(&by("aud", json!(["a", CLIENT]))).is_ok());
    for missing in ["iss", "aud"] {
        assert!(
            matches!(
                check(&signed_with(&without(&body, missing))),
                Err(Rejected::Claims(_))
            ),
            "{missing}"
        );
    }
    // The authorised party, when the token names one, is this client.
    assert!(check(&by("azp", json!(CLIENT))).is_ok());
    assert_eq!(
        check(&by("azp", json!("oaiapp_other"))),
        Err(Rejected::Claims("another client"))
    );
    assert_eq!(
        check(&by("azp", json!(7))),
        Err(Rejected::Claims("another client"))
    );
}

#[test]
fn the_token_names_an_account() {
    let body = claims(CLIENT, NONCE, NOW);
    for gone in [json!(""), json!(null), json!(5)] {
        assert_eq!(
            check(&signed_with(&with(&body, "sub", gone.clone()))),
            Err(Rejected::Claims("no account")),
            "{gone}"
        );
    }
    // Some other shape is refused, whichever way the library reads it.
    assert!(check(&signed_with(&with(&body, "sub", json!(["u"])))).is_err());
    assert_eq!(
        check(&signed_with(&without(&body, "sub"))),
        Err(Rejected::Claims("no account"))
    );
}

#[test]
fn the_nonce_is_this_sign_ins_when_one_is_expected() {
    let body = claims(CLIENT, NONCE, NOW);
    let other = signed_with(&with(&body, "nonce", json!("n-2")));
    assert_eq!(check(&other), Err(Rejected::Claims("another sign-in")));
    let none = signed_with(&without(&body, "nonce"));
    assert_eq!(check(&none), Err(Rejected::Claims("another sign-in")));
    let number = signed_with(&with(&body, "nonce", json!(1)));
    assert_eq!(check(&number), Err(Rejected::Claims("another sign-in")));
    // Not expected (a refresh): whatever it holds is not compared.
    assert!(verify(&other, &keys(JWKS_AB), CLIENT, None, NOW).is_ok());
    assert!(verify(&none, &keys(JWKS_AB), CLIENT, None, NOW).is_ok());
}

#[test]
fn what_is_not_a_token_is_malformed() {
    for text in [
        "",
        "only-one-part",
        "a.b",
        "a.b.c.d",
        "!!!.e30.AAAA",
        "e30..AAAA",
        "bm90IGpzb24.e30.AAAA",
    ] {
        assert_eq!(check(text), Err(Rejected::Malformed), "{text:?}");
    }
    // Claims that are not an object.
    let header = json!({"alg": "RS256", "kid": KID_A});
    assert!(check(&raw(&header, &json!([1, 2]), b"x")).is_err());
}

#[test]
fn a_refusal_says_why_in_words() {
    assert_eq!(
        Rejected::Claims("another client").sentence(),
        "ChatGPT's answer did not say who signed in (another client)"
    );
    assert!(
        Rejected::BadSignature
            .sentence()
            .contains("could not be verified")
    );
    assert!(Rejected::UnknownKey("k".into()).sentence().contains("key"));
    assert!(
        Rejected::Unsupported("none".into())
            .sentence()
            .contains("none")
    );
    // A clock that is wrong makes a good token look old or early.
    assert!(
        Rejected::Claims("expired")
            .sentence()
            .contains("date and time")
    );
    assert!(
        Rejected::Claims("not valid yet")
            .sentence()
            .contains("date and time")
    );
}
