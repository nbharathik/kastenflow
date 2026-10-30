//! Signing in with a pasted token: checked first, kept only if it passes.

use serde_json::json;

use super::mock::{Mock, Resp, client, run};
use super::repo;
use crate::backup::contract::BackupError;
use crate::git_host::endpoints::Endpoints;
use crate::git_host::github::ORIGIN;
use crate::git_host::token::sign_in;
use crate::secrets::{self, KeyStore, MemoryKeys};

/// A GitHub with one account, `ada`, and three repositories: one the token
/// can write to, one it can only read, and the rest it cannot see.
fn github() -> Mock {
    Mock::start(|req| {
        let signed = req.headers.get("authorization").map(String::as_str);
        match (signed, req.route()) {
            (Some("Bearer good"), "/user") => Resp::json(200, json!({"login":"ada"})),
            (_, "/user") => Resp::json(401, json!({"message":"Bad credentials"})),
            (_, "/repos/ada/notes") => Resp::json(200, repo("ada", "notes", true)),
            (_, "/repos/ada/readonly") => {
                let mut value = repo("ada", "readonly", true);
                value["permissions"] = json!({"admin": false, "push": false, "pull": true});
                Resp::json(200, value)
            }
            _ => Resp::json(404, json!({"message":"Not Found"})),
        }
    })
}

fn kept(keys: &MemoryKeys) -> Option<String> {
    secrets::git_token(keys, ORIGIN).unwrap().map(|t| t.secret)
}

#[test]
fn a_good_token_and_repository_sign_in_and_are_kept_for_github() {
    let mock = github();
    let ep = Endpoints::at(&mock.base());
    let keys = MemoryKeys::default();
    let (signed, token) = run(sign_in(
        &client(),
        &ep,
        &keys,
        "  good \n",
        Some(" ada/notes "),
    ))
    .unwrap();
    assert_eq!(signed.login, "ada");
    assert_eq!(signed.repo.unwrap().full_name, "ada/notes");
    assert!(signed.remembered);
    assert_eq!(token.secret, "good");
    assert_eq!(token.origin, ORIGIN);
    assert_eq!(kept(&keys).as_deref(), Some("good"));
}

#[test]
fn a_token_without_a_repository_signs_in_too() {
    let mock = github();
    let ep = Endpoints::at(&mock.base());
    let keys = MemoryKeys::default();
    let (signed, _) = run(sign_in(&client(), &ep, &keys, "good", None)).unwrap();
    assert!(signed.repo.is_none());
    assert_eq!(kept(&keys).as_deref(), Some("good"));
    assert_eq!(mock.seen().len(), 1);
}

#[test]
fn nothing_is_kept_when_the_token_is_refused() {
    let mock = github();
    let ep = Endpoints::at(&mock.base());
    let keys = MemoryKeys::default();
    let err = run(sign_in(&client(), &ep, &keys, "bad", Some("ada/notes"))).unwrap_err();
    assert!(matches!(&err, BackupError::SignedOut { .. }), "{err:?}");
    assert!(err.message().contains("does not accept this token"));
    assert_eq!(kept(&keys), None);
    // The repository was not even asked about.
    assert_eq!(mock.count("GET", "/repos/ada/notes"), 0);
}

#[test]
fn nothing_is_kept_when_the_token_cannot_see_the_repository() {
    let mock = github();
    let ep = Endpoints::at(&mock.base());
    let keys = MemoryKeys::default();
    let err = run(sign_in(&client(), &ep, &keys, "good", Some("ada/hidden"))).unwrap_err();
    assert!(matches!(&err, BackupError::NotFound { .. }), "{err:?}");
    assert!(err.message().contains("Only select repositories"));
    assert_eq!(kept(&keys), None);
}

#[test]
fn nothing_is_kept_when_the_token_can_only_read_the_repository() {
    let mock = github();
    let ep = Endpoints::at(&mock.base());
    let keys = MemoryKeys::default();
    let err = run(sign_in(&client(), &ep, &keys, "good", Some("ada/readonly"))).unwrap_err();
    assert!(matches!(&err, BackupError::CannotWrite { .. }), "{err:?}");
    assert!(err.message().contains("Read and write"));
    assert_eq!(kept(&keys), None);
}

#[test]
fn a_token_with_odd_characters_goes_nowhere() {
    let mock = github();
    let ep = Endpoints::at(&mock.base());
    let keys = MemoryKeys::default();
    for bad in ["", "two words", "a\nb", "x\r\nHost: evil"] {
        assert!(
            run(sign_in(&client(), &ep, &keys, bad, None)).is_err(),
            "{bad:?}"
        );
    }
    assert!(mock.seen().is_empty());
    assert_eq!(kept(&keys), None);
}

#[test]
fn a_repository_name_that_is_not_one_is_refused_before_anything_is_kept() {
    let mock = github();
    let ep = Endpoints::at(&mock.base());
    let keys = MemoryKeys::default();
    assert!(run(sign_in(&client(), &ep, &keys, "good", Some("../user"))).is_err());
    assert_eq!(kept(&keys), None);
}

/// A keychain that cannot keep anything.
struct NoKeychain;

impl KeyStore for NoKeychain {
    fn get(&self, _: &str) -> Result<Option<String>, String> {
        Ok(None)
    }
    fn set(&self, _: &str, _: &str) -> Result<(), String> {
        Err("The system keychain is not available".into())
    }
    fn delete(&self, _: &str) -> Result<(), String> {
        Ok(())
    }
}

#[test]
fn without_a_keychain_the_sign_in_works_but_says_it_is_not_remembered() {
    let mock = github();
    let ep = Endpoints::at(&mock.base());
    let (signed, token) = run(sign_in(&client(), &ep, &NoKeychain, "good", None)).unwrap();
    assert!(!signed.remembered);
    assert_eq!(token.secret, "good");
}

#[test]
fn the_token_is_in_no_message_and_no_body() {
    let mock = github();
    let ep = Endpoints::at(&mock.base());
    let keys = MemoryKeys::default();
    let err = run(sign_in(
        &client(),
        &ep,
        &keys,
        "secret-but-wrong",
        Some("ada/notes"),
    ))
    .unwrap_err();
    assert!(!err.message().contains("secret-but-wrong"));
    for seen in mock.seen() {
        assert!(!seen.path.contains("secret-but-wrong") && !seen.body.contains("secret-but-wrong"));
    }
}
