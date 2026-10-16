use serde_json::{Value, json};

use super::*;
use crate::chat::chatgpt::test_keys::{JWKS_A, JWKS_AB, KID_A, KID_B};

/// The fixture's first key, to bend.
fn key_a() -> Value {
    serde_json::from_str::<Value>(JWKS_A).unwrap()["keys"][0].clone()
}

fn document(keys: &[Value]) -> String {
    json!({"keys": keys}).to_string()
}

fn with(key: &Value, field: &str, value: Value) -> Value {
    let mut changed = key.clone();
    changed[field] = value;
    changed
}

fn without(key: &Value, field: &str) -> Value {
    let mut changed = key.clone();
    changed.as_object_mut().unwrap().remove(field);
    changed
}

#[test]
fn the_published_keys_are_read_by_kid() {
    let one = KeySet::parse(JWKS_A).unwrap();
    assert_eq!(one.len(), 1);
    assert!(one.get(KID_A).is_some() && one.get(KID_B).is_none());
    let two = KeySet::parse(JWKS_AB).unwrap();
    assert!(two.get(KID_A).is_some() && two.get(KID_B).is_some());
    assert!(format!("{two:?}").contains(KID_B));
}

#[test]
fn only_rsa_signing_keys_with_a_kid_are_kept() {
    let a = key_a();
    let rejected = [
        json!({"kty": "EC", "crv": "P-256", "kid": "ec", "x": "AAAA", "y": "AAAA"}),
        json!({"kty": "oct", "kid": "secret", "k": "AAAA"}),
        with(&with(&a, "use", json!("enc")), "kid", json!("enc")),
        with(&with(&a, "alg", json!("RS512")), "kid", json!("rs512")),
        with(&with(&a, "alg", json!("HS256")), "kid", json!("hs")),
        with(&a, "use", json!(null)),
        without(&with(&a, "kid", json!("")), "use"),
        without(&a, "kid"),
        without(&with(&a, "kid", json!("no-n")), "n"),
        with(&with(&a, "kid", json!("small")), "n", json!("AQAB")),
        with(&with(&a, "kid", json!("junk")), "n", json!("!!!")),
        with(
            &with(&a, "kid", json!("long")),
            "kid",
            json!("k".repeat(201)),
        ),
    ];
    // A key that says nothing about `use` and `alg` is fine; so is the
    // fixture's own, which says both.
    let plain = without(&without(&with(&a, "kid", json!("plain")), "use"), "alg");
    let mut all: Vec<Value> = rejected.to_vec();
    all.push(a);
    all.push(plain);
    let set = KeySet::parse(&document(&all)).unwrap();
    assert_eq!(set.len(), 2, "{set:?}");
    assert!(set.get(KID_A).is_some() && set.get("plain").is_some());
    for kid in [
        "ec", "secret", "enc", "rs512", "hs", "small", "junk", "no-n", "",
    ] {
        assert!(set.get(kid).is_none(), "{kid}");
    }
}

#[test]
fn the_first_key_of_a_kid_wins() {
    let a = key_a();
    let b: Value = serde_json::from_str::<Value>(crate::chat::chatgpt::test_keys::JWKS_B).unwrap()
        ["keys"][0]
        .clone();
    // B's numbers under A's name, listed second: A's stay.
    let imposter = with(&b, "kid", json!(KID_A));
    let set = KeySet::parse(&document(&[a.clone(), imposter.clone()])).unwrap();
    let again = KeySet::parse(&document(&[imposter, a])).unwrap();
    // Which one was kept shows in what each verifies.
    let token = crate::chat::chatgpt::test_keys::token("c", "n", 1_900_000_000);
    let by = |keys: &KeySet| {
        crate::chat::chatgpt::idtoken::verify(&token, keys, "c", Some("n"), 1_900_000_000).is_ok()
    };
    assert!(by(&set), "A listed first: A's token passes");
    assert!(
        !by(&again),
        "the imposter listed first wins and A's token fails"
    );
}

#[test]
fn a_document_that_is_too_big_or_too_full_or_empty_is_refused() {
    let a = key_a();
    // Sixteen keys are fine, seventeen are not a key set of OpenAI's.
    let numbered = |count: usize| -> Vec<Value> {
        (0..count)
            .map(|i| with(&a, "kid", json!(format!("k{i}"))))
            .collect()
    };
    assert_eq!(
        KeySet::parse(&document(&numbered(MAX_KEYS))).unwrap().len(),
        MAX_KEYS
    );
    let err = KeySet::parse(&document(&numbered(MAX_KEYS + 1))).unwrap_err();
    assert!(err.contains("more than expected"), "{err}");

    let padded = format!("{}{}", document(&[a]), " ".repeat(MAX_BODY));
    let err = KeySet::parse(&padded).unwrap_err();
    assert!(err.contains("larger than expected"), "{err}");

    for (body, why) in [
        ("", "could not be read"),
        ("<html>", "could not be read"),
        ("{}", "could not be read"),
        (r#"{"keys": "none"}"#, "could not be read"),
        (r#"{"keys": []}"#, "no key it can use"),
        (r#"{"keys": [{"kty":"EC","kid":"x"}]}"#, "no key it can use"),
    ] {
        let err = KeySet::parse(body).unwrap_err();
        assert!(err.contains(why), "{body:?}: {err}");
    }
}

#[test]
fn a_key_set_is_kept_as_long_as_openai_says_within_limits() {
    let secs = |n| Duration::from_secs(n);
    assert_eq!(lifetime(None), secs(3600));
    assert_eq!(lifetime(Some("public, max-age=600")), secs(600));
    assert_eq!(
        lifetime(Some("max-age=\"900\", must-revalidate")),
        secs(900)
    );
    assert_eq!(lifetime(Some("MAX-AGE=1200")), secs(1200));
    assert_eq!(
        lifetime(Some("max-age=1")),
        secs(300),
        "at least five minutes"
    );
    assert_eq!(lifetime(Some("max-age=0")), secs(300));
    assert_eq!(
        lifetime(Some("max-age=999999999")),
        secs(86_400),
        "at most a day"
    );
    assert_eq!(lifetime(Some("no-store")), secs(3600));
    assert_eq!(lifetime(Some("max-age=soon")), secs(3600));
}
