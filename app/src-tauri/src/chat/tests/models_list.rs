//! The models a ChatGPT sign-in lists: the account's own list is kept, and
//! when it cannot be read the picker gets the reason and the last list that
//! was read, with its date. The built-in names are only for an account that
//! never listed anything, and say they are not confirmed for the plan.

use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use super::block_on;
use super::chatgpt::{account, signed_in, token};
use super::flaky::{say, serve_acts};
use super::http::client;
use crate::chat::chatgpt::models::{self, DEFAULTS};
use crate::chat::chatgpt::saved::{ENTRY, Saved};
use crate::secrets::{KeyStore, MemoryKeys};

const LIST: &str = r#"{"models":[
    {"slug":"gpt-6.1-sol","visibility":"list"},
    {"slug":"gpt-6-luna","visibility":"list"},
    {"slug":"hidden","visibility":"hide"}]}"#;

fn folder(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("kasten-models-{name}-{}", std::process::id()))
}

fn signed_in_as(sub: &str) -> Arc<MemoryKeys> {
    let keys = Arc::new(MemoryKeys::default());
    let saved = Saved {
        refresh_token: "rt-1".into(),
        client_id: "oaiapp_x".into(),
        email: None,
        sub: Some(sub.into()),
    };
    keys.set(ENTRY, &serde_json::to_string(&saved).unwrap())
        .unwrap();
    keys
}

#[test]
fn a_fresh_list_is_kept_and_comes_back_with_its_date_when_the_next_one_fails() {
    let dir = folder("kept");
    let (base, server) = serve_acts(vec![
        say(200, token("at-1", "rt-2", 3600)),
        say(200, LIST),
        say(503, r#"{"error":{"message":"Overloaded"}}"#),
    ]);
    let keys = signed_in("rt-1");
    let account = account(&keys, &base);
    let url = format!("{base}/v1/models");
    block_on(async {
        let http = client();
        let first = models::listing(&account, &http, &url, Some(dir.clone())).await;
        assert_eq!(first.models, ["gpt-6.1-sol", "gpt-6-luna"]);
        assert!(first.confirmed && first.error.is_none());
        let fetched = first.fetched_at.unwrap();
        assert!(fetched > 1_700_000_000_000, "milliseconds since 1970");

        let second = models::listing(&account, &http, &url, Some(dir.clone())).await;
        let error = second.error.unwrap();
        assert!(
            error.starts_with("Could not load your models: ") && error.contains("503"),
            "{error}"
        );
        assert_eq!(second.models, first.models, "the last list that was read");
        assert!(second.confirmed, "they are the account's own names");
        assert_eq!(second.fetched_at, Some(fetched), "and when it was read");
    });
    server.join().unwrap();
    // Only this test's own folder under the system temp folder.
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn an_account_that_never_listed_gets_the_built_in_names_marked_as_not_confirmed() {
    let dir = folder("never");
    let (base, server) = serve_acts(vec![
        say(200, token("at-1", "rt-2", 3600)),
        say(401, "{}"),
        say(200, token("at-2", "rt-3", 3600)),
        say(401, "{}"),
    ]);
    let keys = signed_in("rt-1");
    let account = account(&keys, &base);
    let url = format!("{base}/v1/models");
    block_on(async {
        let listing = models::listing(&account, &client(), &url, Some(dir.clone())).await;
        assert_eq!(listing.models, DEFAULTS);
        assert!(!listing.confirmed && listing.fetched_at.is_none());
        let error = listing.error.unwrap();
        assert!(
            error.starts_with("Could not load your models: ")
                && error.contains("Sign in with ChatGPT again"),
            "{error}"
        );
    });
    server.join().unwrap();
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_list_kept_for_another_account_is_not_believed() {
    let dir = folder("other");
    let (base, server) = serve_acts(vec![say(200, token("at-1", "rt-2", 3600)), say(200, LIST)]);
    let first = account(&signed_in_as("user-1"), &base);
    let url = format!("{base}/v1/models");
    block_on(async {
        let listing = models::listing(&first, &client(), &url, Some(dir.clone())).await;
        assert!(listing.confirmed);
    });
    server.join().unwrap();

    // Someone else signed in on this computer; the list cannot be read now.
    let (base, server) = serve_acts(vec![say(200, token("at-9", "rt-9", 3600)), say(503, "{}")]);
    let second = account(&signed_in_as("user-2"), &base);
    let url = format!("{base}/v1/models");
    block_on(async {
        let listing = models::listing(&second, &client(), &url, Some(dir.clone())).await;
        assert_eq!(listing.models, DEFAULTS);
        assert!(!listing.confirmed && listing.error.is_some());
    });
    server.join().unwrap();
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn the_old_call_still_gives_a_list_whatever_happens() {
    // Nothing is listening and nothing is cached: the built-in names.
    let keys = signed_in("rt-1");
    let account = account(&keys, "http://127.0.0.1:9");
    let names = block_on(models::or_defaults(&account, &client()));
    assert_eq!(names, DEFAULTS);
}
