//! Comments on a deck, as an assistant uses them through the deck tools: it adds
//! one (marked as its own), lists them, answers and settles, each as a commit of
//! the agent, and the deck keeps what it wrote.

mod common;

use common::{TempDir, deck_of_eight, vault};
use kasten_core::agent::Session;
use kasten_core::{Instant, Kasten};
use kasten_mcp::tools::{call, specs};
use serde_json::{Value, json};

fn open() -> (TempDir, Kasten, Session) {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    let s = Session::start("kasten-chat", Instant::now());
    (v, k, s)
}

#[test]
fn the_comment_tools_are_listed_and_only_listing_is_a_read() {
    let all = specs();
    for (name, read_only) in [
        ("list_deck_comments", true),
        ("add_deck_comment", false),
        ("reply_deck_comment", false),
        ("resolve_deck_comment", false),
        ("set_slide_access", false),
    ] {
        let tool = all
            .iter()
            .find(|s| s.name == name)
            .unwrap_or_else(|| panic!("no {name}"));
        assert_eq!(tool.read_only, read_only, "{name}");
    }
}

#[test]
fn an_assistant_comments_lists_answers_and_settles_and_its_comments_are_marked() {
    let (_v, k, s) = open();
    let (path, ids) = deck_of_eight(&k, &s);
    let slide = &ids[1];

    let made = call(
        &k,
        &s,
        "add_deck_comment",
        json!({"deck": path, "slide": slide, "text": "This claim needs a source", "x": 120.0, "y": 80.0}),
    )
    .unwrap();
    assert_eq!(made["status"], json!("done"), "{made}");
    // The change's envelope holds the tool's answer, which holds the operation's own.
    let id = made["result"]["result"]["comment"]
        .as_str()
        .unwrap()
        .to_owned();
    let last = &k.log(Some(&path), 1).unwrap()[0];
    assert_eq!(last.author, "agent:kasten-chat");
    assert_eq!(last.op.as_deref(), Some("add_deck_comment"));

    let listed = call(&k, &s, "list_deck_comments", json!({"deck": path})).unwrap();
    assert_eq!(
        (listed["open"].as_u64(), listed["resolved"].as_u64()),
        (Some(1), Some(0))
    );
    let one = &listed["comments"][0];
    assert_eq!(one["id"], json!(id));
    assert_eq!(
        one["agent"],
        json!(true),
        "an assistant's comment is marked, whatever it passed"
    );
    assert_eq!(one["author"], json!("Assistant"));
    assert_eq!(one["slideNumber"], json!(2));
    assert!(
        one["created"]
            .as_str()
            .is_some_and(|t| t.len() == 20 && t.ends_with('Z')),
        "{one}"
    );
    assert_eq!(one["pin"], json!({"x": 120.0, "y": 80.0}));

    // It cannot pass itself off as a person.
    let tried = call(
        &k,
        &s,
        "reply_deck_comment",
        json!({"deck": path, "comment": id, "text": "Added one", "agent": false, "author": "Claude"}),
    )
    .unwrap();
    assert_eq!(tried["status"], json!("done"), "{tried}");
    call(
        &k,
        &s,
        "resolve_deck_comment",
        json!({"deck": path, "comment": id}),
    )
    .unwrap();

    let open_only = call(
        &k,
        &s,
        "list_deck_comments",
        json!({"deck": path, "status": "open"}),
    )
    .unwrap();
    assert_eq!(open_only["comments"], json!([]));
    assert_eq!(open_only["resolved"], json!(1));
    let all: Value = call(
        &k,
        &s,
        "list_deck_comments",
        json!({"deck": path, "slide": 2}),
    )
    .unwrap();
    let reply = &all["comments"][0]["replies"][0];
    assert_eq!(
        (reply["agent"].clone(), reply["author"].clone()),
        (json!(true), json!("Claude"))
    );
    assert_eq!(all["comments"][0]["resolved"], json!(true));

    let other = call(
        &k,
        &s,
        "list_deck_comments",
        json!({"deck": path, "slide": 3}),
    )
    .unwrap();
    assert_eq!(other["comments"], json!([]));
    let bad = call(
        &k,
        &s,
        "list_deck_comments",
        json!({"deck": path, "status": "nope"}),
    )
    .unwrap_err();
    assert!(bad.contains("status"), "{bad}");
}

#[test]
fn a_comment_on_a_slide_that_is_not_there_is_refused_and_the_deck_is_not_written() {
    let (_v, k, s) = open();
    let (path, _) = deck_of_eight(&k, &s);
    let before = k.log(Some(&path), 5).unwrap().len();
    let refused = call(
        &k,
        &s,
        "add_deck_comment",
        json!({"deck": path, "slide": "s-nowhere", "text": "x"}),
    )
    .unwrap_err();
    assert!(refused.contains("s-nowhere"), "{refused}");
    assert_eq!(k.log(Some(&path), 5).unwrap().len(), before);
}
