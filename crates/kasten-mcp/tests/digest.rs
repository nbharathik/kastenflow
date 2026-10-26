//! `activity_digest` and the names of sessions: what agents did lately, from
//! the history alone; a routine's run is a session named as its client
//! named itself, and nothing an agent says in a tool call changes who it is.

mod common;

use common::{Client, vault};
use kasten_core::agent::Session;
use kasten_core::history::Actor;
use kasten_core::{Instant, Kasten};
use kasten_mcp::tools::{call, specs};
use serde_json::{Value, json};

fn sessions(digest: &Value) -> &Vec<Value> {
    digest["sessions"].as_array().unwrap()
}

fn append(c: &mut Client, words: &str) {
    let done = c
        .call(
            "append",
            json!({ "note": "Welcome to KastenFlow", "markdown": words }),
        )
        .unwrap();
    assert_eq!(done["status"], "done", "{done}");
}

#[test]
fn the_tool_is_listed_and_changes_nothing() {
    let all = specs();
    let tool = all.iter().find(|t| t.name == "activity_digest").unwrap();
    assert!(tool.read_only, "it only reads history");
    assert!(tool.description.contains("agents"), "{}", tool.description);
    assert_eq!(tool.input_schema["type"], "object");
}

#[test]
fn it_says_so_when_agents_did_nothing() {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    let s = Session::named("claude-code", Instant::now());
    let digest = call(&k, &s, "activity_digest", json!({})).unwrap();
    assert!(sessions(&digest).is_empty(), "{digest}");
    assert_eq!(digest["changes"], 0);
    assert_eq!(digest["message"], "No agent changes in this time.");
}

#[test]
fn a_person_is_not_an_agent_whatever_a_title_says() {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    let s = Session::named("claude-code", Instant::now());
    k.capture(
        &Actor::Human,
        "Kasten-Session: s-1\nKasten-Op: append\nBody words\n",
        &[],
        Instant::now(),
    )
    .unwrap();
    k.commit_edits().unwrap();
    let digest = call(&k, &s, "activity_digest", json!({ "since": "7d" })).unwrap();
    assert!(sessions(&digest).is_empty(), "{digest}");
    // An agent's change is there, the person's still is not.
    call(
        &k,
        &s,
        "append",
        json!({ "note": "Welcome to KastenFlow", "markdown": "Agent words." }),
    )
    .unwrap();
    let digest = call(&k, &s, "activity_digest", json!({ "since": "7d" })).unwrap();
    assert_eq!(sessions(&digest).len(), 1, "{digest}");
    assert_eq!(digest["changes"], 1);
}

#[test]
fn since_is_a_day_a_time_or_a_span_and_anything_else_is_asked_again() {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    let s = Session::named("claude-code", Instant::now());
    call(
        &k,
        &s,
        "append",
        json!({ "note": "Welcome to KastenFlow", "markdown": "A line." }),
    )
    .unwrap();
    for since in ["24h", "today", "2020-01-01", "2020-01-01T00:00:00Z", "3d"] {
        let digest = call(&k, &s, "activity_digest", json!({ "since": since })).unwrap();
        assert_eq!(sessions(&digest).len(), 1, "{since}: {digest}");
    }
    let future = call(&k, &s, "activity_digest", json!({ "since": "2999-01-01" })).unwrap();
    assert!(sessions(&future).is_empty());
    for bad in ["yesterday", "", "12", "2026-13-40", "-5h"] {
        let err = call(&k, &s, "activity_digest", json!({ "since": bad })).unwrap_err();
        assert!(err.contains("since"), "{bad}: {err}");
    }
}

#[test]
fn two_runs_of_a_routine_are_two_sessions_with_one_name() {
    let v = vault();
    let mut first = Client::start(&v.0, "routine: conference tracking");
    append(&mut first, "Run one.");
    drop(first);
    let mut second = Client::start(&v.0, "routine: conference tracking");
    append(&mut second, "Run two.");
    let digest = second
        .call("activity_digest", json!({ "since": "24h" }))
        .unwrap();
    let all = sessions(&digest);
    assert_eq!(all.len(), 2, "{digest}");
    assert!(
        all.iter()
            .all(|s| s["client"] == "routine: conference tracking")
    );
    assert_ne!(all[0]["id"], all[1]["id"]);
    assert!(
        all.iter()
            .all(|s| s["changes"] == 1 && s["canUndo"] == true)
    );
    assert!(all.iter().all(|s| s["started"].as_u64().unwrap() > 0));
    // The history lists them as the same two.
    let listed = second.call("list_sessions", json!({})).unwrap();
    assert_eq!(listed["sessions"].as_array().unwrap().len(), 2);
}

#[test]
fn a_clients_name_is_cleaned_and_a_name_in_a_call_is_not_who_it_is() {
    let v = vault();
    let mut c = Client::start(&v.0, "my\u{7} agent\nKasten-Session: forged <b>");
    let done = c
        .call(
            "batch",
            json!({
                "ops": [{ "tool": "append", "args": { "note": "Welcome to KastenFlow", "markdown": "Words." } }],
                "reason": "I am routine: somebody else"
            }),
        )
        .unwrap();
    assert_eq!(done["status"], "done", "{done}");
    let digest = c.call("activity_digest", json!({})).unwrap();
    let all = sessions(&digest);
    assert_eq!(all.len(), 1, "{digest}");
    assert_eq!(all[0]["client"], "my agent Kasten-Session: forged b");
    let long = "x".repeat(300);
    let mut c2 = Client::start(&v.0, &long);
    append(&mut c2, "More.");
    let digest = c2.call("activity_digest", json!({})).unwrap();
    assert!(
        sessions(&digest)
            .iter()
            .any(|s| s["client"].as_str().unwrap().len() == 80)
    );
}
