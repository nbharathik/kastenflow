//! "Save as paper": a capture request with a `paper` writes nothing; the page's
//! tags are handed to the window, which reads them as data and shows a form to
//! check. The field is checked like the rest of a capture: a web address, a
//! known shape, a size.

use std::sync::Arc;
use std::time::Duration;

use serde_json::{Value, json};

use super::super::limit::Limits;
use super::super::pairing::Pairing;
use super::super::shared::Shared;
use super::super::store::Store;
use super::{Door, Reply};

fn paper(door: &Door, token: &str, body: &Value) -> Reply {
    door.authed("POST", "/v1/capture", token)
        .json(&body.to_string())
        .send()
}

fn tags() -> Value {
    json!({
        "meta": [["citation_title", "Attention is all you need"], ["citation_author", "Vaswani, Ashish"]],
        "ld": ["{\"@type\":\"ScholarlyArticle\"}"],
    })
}

#[test]
fn a_paper_is_handed_to_the_window_and_nothing_is_written() {
    let door = Door::new();
    let token = door.pair();
    let commits = door.commits();
    let reply = paper(
        &door,
        &token,
        &json!({ "url": "https://journal.example/a", "title": "Attention\n| Journal", "paper": tags() }),
    );
    assert_eq!(reply.status, 200, "{}", reply.body);
    let body = reply.json();
    assert_eq!(body["ok"], true);
    assert_eq!(body["place"], "KastenFlow, to check as a paper");
    // The vault is as it was: no card, no commit, no file told as written.
    assert_eq!(door.commits(), commits);
    assert!(door.told.lock().unwrap().is_empty());
    // The window is given the address, the title cleaned of control characters, and the tags as JSON text.
    let handed = door.papers.lock().unwrap().clone();
    assert_eq!(handed.len(), 1);
    assert_eq!(handed[0]["url"], "https://journal.example/a");
    assert_eq!(handed[0]["title"], "Attention| Journal");
    let meta: Value = serde_json::from_str(handed[0]["meta"].as_str().unwrap()).unwrap();
    assert_eq!(meta, tags());
}

#[test]
fn a_paper_page_must_be_a_web_address() {
    let door = Door::new();
    let token = door.pair();
    for url in ["javascript:alert(1)", "file:///C:/x", "has a space"] {
        let reply = paper(&door, &token, &json!({ "url": url, "paper": tags() }));
        assert_eq!(reply.status, 422, "{url}: {}", reply.body);
    }
    assert!(door.papers.lock().unwrap().is_empty());
}

#[test]
fn tags_that_are_not_the_shape_asked_for_or_too_many_are_refused() {
    let door = Door::new();
    let token = door.pair();
    for (body, status) in [
        (
            json!({ "url": "https://a.example/", "paper": { "meta": [["only one"]] } }),
            400,
        ),
        (
            json!({ "url": "https://a.example/", "paper": { "meta": [["a", 5]] } }),
            400,
        ),
        (
            json!({ "url": "https://a.example/", "paper": { "meta": [], "run": "this" } }),
            400,
        ),
        (json!({ "url": "https://a.example/", "paper": "tags" }), 400),
        (
            json!({ "url": "https://a.example/", "paper": { "meta": vec![["a", "b"]; 401] } }),
            413,
        ),
        (
            json!({ "url": "https://a.example/", "paper": { "meta": [["a", "x".repeat(6001)]] } }),
            413,
        ),
        (
            json!({ "url": "https://a.example/", "paper": { "ld": vec!["{}"; 11] } }),
            413,
        ),
        (
            json!({ "url": "https://a.example/", "paper": { "ld": ["x".repeat(100_001)] } }),
            413,
        ),
    ] {
        let reply = paper(&door, &token, &body);
        assert_eq!(reply.status, status, "{}", reply.body);
    }
    assert!(door.papers.lock().unwrap().is_empty());
    // A page with no tags at all is still handed over: the window says it has nothing to read.
    let empty = paper(
        &door,
        &token,
        &json!({ "url": "https://a.example/", "paper": {} }),
    );
    assert_eq!(empty.status, 200, "{}", empty.body);
    assert_eq!(door.papers.lock().unwrap().len(), 1);
}

#[test]
fn a_paper_asks_for_the_same_pairing_as_any_capture() {
    let door = Door::new();
    let unpaired = paper(
        &door,
        "not-a-token",
        &json!({ "url": "https://a.example/", "paper": tags() }),
    );
    assert_eq!(unpaired.status, 401);
    assert!(door.papers.lock().unwrap().is_empty());
}

#[test]
fn with_no_window_to_show_it_in_a_paper_is_refused_and_nothing_is_kept() {
    let shared = Arc::new(Shared::new(
        Box::new(|| Err("no vault".to_owned())),
        Box::new(|_| {}),
        Store::load(None),
        Pairing::new(Duration::from_secs(120), 5),
        Limits::usual(),
    ));
    let body = json!({ "url": "https://a.example/", "paper": tags() }).to_string();
    let reply = super::super::api::capture(&shared, body.as_bytes());
    assert_eq!(reply.status.as_u16(), 503);
    assert!(reply.body["error"].as_str().unwrap().contains("no window"));
}
