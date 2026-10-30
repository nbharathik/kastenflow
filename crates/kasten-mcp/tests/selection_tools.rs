//! `get_selection`: the user's selection over MCP. No plugin is needed, so the
//! tool is always listed and read-only; the app is a stand-in thread that
//! shares what it holds once it is asked (the real one shares what the window
//! has selected, for two minutes after each ask). Each state is told in plain
//! words, and the selection never reaches the vault's history.

mod common;

use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};

use common::{Client, TempDir, vault};
use kasten_core::agent::Session;
use kasten_core::bridge::{Call, Handler, Published, Server, Snippet, serve};
use kasten_core::{Instant, Kasten};
use kasten_mcp::tools::{call, specs};
use serde_json::json;

fn open() -> (TempDir, Kasten, Session) {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    (v, k, Session::start("claude-code", Instant::now()))
}

fn snippet(text: &str) -> Snippet {
    Snippet {
        kind: "page".into(),
        path: "library/notes.md".into(),
        title: "Notes".into(),
        heading: Some("Method".into()),
        range: None,
        elements: Vec::new(),
        text: text.into(),
        truncated: false,
        time: 0,
    }
}

/// An app that shares what `held` holds, as the real one does once it is asked.
fn app_that_shares(root: &Path, held: &Arc<Mutex<Vec<Snippet>>>) -> Server {
    let held = Arc::clone(held);
    let mailbox = kasten_mcp::bridge::mailbox(root).unwrap();
    let writer = mailbox.clone();
    let handler: Handler = Arc::new(move |_, call| match call {
        Call::WatchSelection {} => {
            let now = Instant::now().millis;
            let published = Published::of(&held.lock().unwrap(), &[], now);
            writer
                .write_selection(&published)
                .map_err(|e| e.to_string())?;
            Ok(json!({"shared": true}))
        }
        _ => Err("not asked in this test".to_owned()),
    });
    serve(mailbox, "1.2.2", handler).unwrap()
}

#[test]
fn the_tool_is_described_plainly_read_only_and_always_listed() {
    let all = specs();
    let selection = all.iter().find(|t| t.name == "get_selection").unwrap();
    assert!(selection.read_only, "reading the selection changes nothing");
    assert_eq!(selection.input_schema["type"], json!("object"));
    for jargon in [
        "commit",
        "sidecar",
        "AgentOp",
        "mailbox",
        "bridge",
        "dev/",
        "ADR",
        "selection.json",
    ] {
        assert!(!selection.description.contains(jargon), "{jargon}");
    }
    for words in ["nothing is selected", "the app is closed", "out of date"] {
        assert!(selection.description.contains(words), "{words}");
    }
    // With every plugin off it is still there, and the instructions carry the rule.
    let v = vault();
    let mut client = Client::start(&v.0, "test-agent");
    assert!(client.tools().iter().any(|t| t == "get_selection"));
    assert!(client.instructions.contains("`get_selection`"));
}

#[test]
fn the_selection_is_read_from_the_app_and_each_state_is_said_in_plain_words() {
    let (v, k, s) = open();
    // The app is closed.
    let told = call(&k, &s, "get_selection", json!({})).unwrap();
    assert_eq!(told["status"], json!("app_closed"));
    assert_eq!(told["selection"], json!([]));
    assert!(
        told["message"]
            .as_str()
            .unwrap()
            .starts_with("The app is closed")
    );

    let held = Arc::new(Mutex::new(Vec::new()));
    let app = app_that_shares(&v.0, &held);
    // Open, and nothing selected.
    let told = call(&k, &s, "get_selection", json!({})).unwrap();
    assert_eq!(told["status"], json!("nothing_selected"));
    assert!(
        told["message"]
            .as_str()
            .unwrap()
            .starts_with("Nothing is selected")
    );
    // Something selected: the snippets come back with everything they say.
    held.lock().unwrap().push(snippet("the words I selected"));
    let mut slide = snippet("");
    slide.kind = "slide".into();
    slide.path = "library/talk.deck".into();
    slide.elements = vec!["e1".into(), "e2".into()];
    held.lock().unwrap().push(slide);
    let told = call(&k, &s, "get_selection", json!({})).unwrap();
    assert_eq!(told["status"], json!("selected"));
    assert_eq!(told["selection"].as_array().unwrap().len(), 2);
    assert_eq!(told["selection"][0]["kind"], json!("page"));
    assert_eq!(told["selection"][0]["path"], json!("library/notes.md"));
    assert_eq!(told["selection"][0]["heading"], json!("Method"));
    assert_eq!(told["selection"][0]["text"], json!("the words I selected"));
    assert!(told["selection"][0]["time"].is_u64());
    assert_eq!(told["selection"][1]["elements"], json!(["e1", "e2"]));
    assert!(told["message"].as_str().unwrap().contains("2 pieces"));
    // A selection the app did not renew for a minute is out of date.
    let mailbox = kasten_mcp::bridge::mailbox(&v.0).unwrap();
    let old = Instant::now().millis - 61_000;
    let handler: Handler = Arc::new(move |_, _| Ok(json!({})));
    drop(app);
    let _stale_app = serve(mailbox.clone(), "1.2.2", handler).unwrap();
    mailbox
        .write_selection(&Published::of(&[snippet("old")], &[], old))
        .unwrap();
    let told = call(&k, &s, "get_selection", json!({})).unwrap();
    assert_eq!(told["status"], json!("out_of_date"));
    assert!(told["message"].as_str().unwrap().contains("out of date"));
}

#[test]
fn an_app_that_is_open_but_never_answers_is_timed_out_in_words() {
    let (v, k, s) = open();
    kasten_mcp::bridge::mailbox(&v.0)
        .unwrap()
        .mark_alive("1.2.2", Instant::now().millis)
        .unwrap();
    let why = call(&k, &s, "get_selection", json!({})).unwrap_err();
    assert!(why.starts_with("The app did not answer in time"), "{why}");
    assert!(
        fs::read_dir(v.0.join(".kasten/cache/bridge/requests"))
            .unwrap()
            .next()
            .is_none(),
        "the request was withdrawn"
    );
}

#[test]
fn what_the_app_refuses_is_passed_on_in_its_words() {
    let (v, k, s) = open();
    let handler: Handler = Arc::new(|_, _| Err("The window is busy".to_owned()));
    let _app = serve(kasten_mcp::bridge::mailbox(&v.0).unwrap(), "1.2.2", handler).unwrap();
    assert_eq!(
        call(&k, &s, "get_selection", json!({})).unwrap_err(),
        "The window is busy"
    );
}

#[test]
fn over_the_wire_the_selection_is_read_and_the_app_is_asked_each_time() {
    let (v, _k, _s) = open();
    let mut client = Client::start(&v.0, "test-agent");
    let closed = client.call("get_selection", json!({})).unwrap();
    assert_eq!(closed["status"], json!("app_closed"));
    let held = Arc::new(Mutex::new(vec![snippet("seen from outside")]));
    let _app = app_that_shares(&v.0, &held);
    let told = client.call("get_selection", json!({})).unwrap();
    assert_eq!(told["status"], json!("selected"), "{told}");
    assert_eq!(told["selection"][0]["text"], json!("seen from outside"));
}

#[test]
fn the_selection_never_reaches_the_vaults_history_or_its_changed_files() {
    let (v, k, s) = open();
    k.start_history().unwrap();
    let held = Arc::new(Mutex::new(vec![snippet("a private thought")]));
    let _app = app_that_shares(&v.0, &held);
    let before = k.log(None, 50).unwrap().len();
    call(&k, &s, "get_selection", json!({})).unwrap();
    assert!(v.0.join(".kasten/cache/bridge/selection.json").is_file());
    let dirty = k.dirty().unwrap();
    assert!(
        dirty
            .iter()
            .all(|p| !p.contains("selection") && !p.contains("bridge")),
        "{dirty:?}"
    );
    k.commit_edits().unwrap();
    assert_eq!(k.log(None, 50).unwrap().len(), before);
}
