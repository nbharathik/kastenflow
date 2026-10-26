//! What a smart page may read through the bridge, with the messages as the
//! page sends them.

use kasten_core::Instant;
use kasten_core::smart::{BridgeCall, BridgeError, BridgeErrorCode};
use serde_json::{Value, json};

use super::{Smart, add_page_in, files, smart};
use crate::smart::bridge::handle;
use crate::smart::runtime::Runtime;

const ROADMAP: &str = "01M36N8AA0SQP0DY9C54T2DXA1";
const JOURNAL: &str = "01M36H4FJ0YWBWJ94S8SFCAVJ2";

/// The call as a page sends it: `{ kind, args }`.
pub fn wire(kind: &str, args: Value) -> BridgeCall {
    serde_json::from_value(json!({ "kind": kind, "args": args })).unwrap()
}

/// Runs the call for the smart page of `s`.
pub fn run(s: &Smart, runtime: &Runtime, call: &BridgeCall) -> Result<Value, BridgeError> {
    handle(s.k(), runtime, &s.path, call, Instant::now())
}

fn ask(s: &Smart, kind: &str, args: Value) -> Result<Value, BridgeError> {
    run(s, &Runtime::default(), &wire(kind, args))
}

fn titles(rows: &Value) -> Vec<&str> {
    rows.as_array()
        .unwrap()
        .iter()
        .map(|r| r["title"].as_str().unwrap())
        .collect()
}

fn code(result: Result<Value, BridgeError>) -> BridgeErrorCode {
    result.unwrap_err().code
}

#[test]
fn a_query_gives_the_notes_of_a_tag_filtered_and_sorted_like_a_view() {
    let s = smart();
    let all = ask(&s, "query", json!({ "tag": "paper" })).unwrap();
    assert_eq!(all.as_array().unwrap().len(), 3);
    // The shape the kit's starters read: id, title, props.<key>.
    let roadmap = all
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == ROADMAP)
        .unwrap();
    assert_eq!(roadmap["title"], "Photo organiser roadmap");
    assert_eq!(roadmap["props"]["status"], "Drafting");
    assert_eq!(roadmap["project"], "photo-organiser");
    assert!(
        roadmap["path"]
            .as_str()
            .unwrap()
            .ends_with("photo-organiser-roadmap.md")
    );

    let drafting = ask(
        &s,
        "query",
        json!({
            "tag": "#paper",
            "filter": [{ "key": "status", "value": "drafting" }],
            "sort": [{ "key": "deadline", "dir": "desc" }]
        }),
    )
    .unwrap();
    assert_eq!(
        titles(&drafting),
        [
            "Report draft: How people find old notes",
            "Photo organiser roadmap"
        ]
    );
    let not_drafting = ask(
        &s,
        "query",
        json!({ "tag": "paper", "filter": [{ "key": "status", "op": "is_not", "value": "Drafting" }] }),
    )
    .unwrap();
    assert_eq!(titles(&not_drafting), ["Duplicate score for photos"]);
    let one = ask(&s, "query", json!({ "tag": "paper", "limit": 1 })).unwrap();
    assert_eq!(one.as_array().unwrap().len(), 1);
    assert!(
        ask(&s, "query", json!({ "tag": "nothing-has-this" }))
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[test]
fn lists_filter_by_project_tag_and_type() {
    let s = smart();
    let by_project = ask(&s, "list", json!({ "project": "photo-organiser" })).unwrap();
    assert!(titles(&by_project).contains(&"Photo organiser roadmap"));
    assert!(!titles(&by_project).contains(&"Report draft: How people find old notes"));
    let ideas = ask(&s, "list", json!({ "tag": "idea" })).unwrap();
    assert!(titles(&ideas).contains(&"Duplicate score for photos"));
    let journals = ask(&s, "list", json!({ "type": "journal" })).unwrap();
    assert_eq!(titles(&journals), ["2026-09-23"]);
    // Templates are never listed.
    let all = ask(&s, "list", json!({})).unwrap();
    assert!(
        all.as_array()
            .unwrap()
            .iter()
            .all(|n| n["type"] != "template")
    );
}

#[test]
fn reads_one_note_searches_and_finds_a_journal_day() {
    let s = smart();
    let note = ask(&s, "read", json!({ "id": ROADMAP })).unwrap();
    assert_eq!(note["title"], "Photo organiser roadmap");
    assert!(note["body"].as_str().unwrap().contains("Open questions"));
    assert_eq!(note["props"]["venue"], "Tech conference 2027");
    assert_eq!(
        code(ask(
            &s,
            "read",
            json!({ "id": "01NOSUCHNOTE0000000000000" })
        )),
        BridgeErrorCode::NotFound
    );

    let hits = ask(&s, "search", json!({ "q": "perceptual", "limit": 5 })).unwrap();
    assert!(
        hits.to_string().contains("duplicate-score-for-photos"),
        "{hits}"
    );

    let day = ask(&s, "journal", json!({ "date": "2026-09-23" })).unwrap();
    assert_eq!(day["id"], JOURNAL);
    let empty = ask(&s, "journal", json!({ "date": "2020-01-01" })).unwrap();
    assert_eq!(empty["exists"], false);
}

#[test]
fn a_page_in_a_project_knows_its_project_and_one_outside_does_not() {
    let s = smart();
    assert_eq!(ask(&s, "project", json!(null)).unwrap(), Value::Null);
    let (path, _) = add_page_in(s.k(), "Dashboard", Some("photo-organiser"), &files());
    let project = handle(
        s.k(),
        &Runtime::default(),
        &path,
        &wire("project", json!(null)),
        Instant::now(),
    )
    .unwrap();
    assert_eq!(project["slug"], "photo-organiser");
    assert_eq!(project["folder"], "projects/photo-organiser");
    assert_eq!(project["mode"], "balanced");
    assert!(project["title"].as_str().unwrap().len() > 3);
}

#[test]
fn to_dos_come_with_their_note_and_line_and_filter_by_state_project_and_tag() {
    let s = smart();
    let open = ask(&s, "tasks", json!({ "done": false })).unwrap();
    let texts: Vec<&str> = open
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["text"].as_str().unwrap())
        .collect();
    assert!(
        texts.iter().any(|t| t.contains("Book the room")),
        "{texts:?}"
    );
    assert!(open.as_array().unwrap().iter().all(|t| t["done"] == false));
    let book = open
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["text"].as_str().unwrap().contains("Book the room"))
        .unwrap();
    assert_eq!(book["id"], JOURNAL);
    assert_eq!(book["line"], 2);
    let done = ask(&s, "tasks", json!({ "done": true })).unwrap();
    assert!(done.as_array().unwrap().iter().all(|t| t["done"] == true));
    let study = ask(&s, "tasks", json!({ "project": "note-taking-study" })).unwrap();
    assert!(!study.as_array().unwrap().is_empty());
    assert!(study.as_array().unwrap().iter().all(|t| {
        t["path"]
            .as_str()
            .unwrap()
            .starts_with("projects/note-taking-study/")
    }));
    let tagged = ask(&s, "tasks", json!({ "tag": "paper" })).unwrap();
    assert!(
        tagged
            .as_array()
            .unwrap()
            .iter()
            .all(|t| t["path"].as_str().unwrap().contains("report-draft"))
    );
}

#[test]
fn reads_a_board_and_finds_what_to_open() {
    let s = smart();
    let board = ask(
        &s,
        "board",
        json!({ "path": "projects/photo-organiser/boards/brainstorm.canvas" }),
    )
    .unwrap();
    assert!(board["nodes"].is_array(), "{board}");
    assert_eq!(
        code(ask(
            &s,
            "board",
            json!({ "path": "projects/none/boards/x.canvas" })
        )),
        BridgeErrorCode::NotFound
    );

    assert_eq!(
        ask(&s, "open", json!({ "target": ROADMAP })).unwrap()["path"],
        "projects/photo-organiser/pages/photo-organiser-roadmap.md"
    );
    assert_eq!(
        ask(&s, "open", json!({ "target": "Photo organiser roadmap" })).unwrap()["path"],
        "projects/photo-organiser/pages/photo-organiser-roadmap.md"
    );
    assert_eq!(
        ask(
            &s,
            "open",
            json!({ "target": "projects/photo-organiser/boards/brainstorm.canvas" })
        )
        .unwrap()["path"],
        "projects/photo-organiser/boards/brainstorm.canvas"
    );
    // Nothing private, nothing outside the vault, nothing that is not there.
    for target in [
        "../x",
        ".git/config",
        ".kasten/config.yaml",
        "/etc/passwd",
        "C:\\x",
        "projects/../../x",
        "nothing here at all",
    ] {
        assert!(
            ask(&s, "open", json!({ "target": target })).is_err(),
            "{target}"
        );
    }
}

#[test]
fn the_window_answers_its_own_calls_and_a_page_that_is_not_smart_gets_nothing() {
    let s = smart();
    for (kind, args) in [
        ("theme", json!(null)),
        ("resize", json!({ "px": 300 })),
        ("log", json!({ "args": ["hi"] })),
        ("unwatch", json!({ "watchId": "w" })),
        (
            "watch",
            json!({ "watchId": "w", "query": { "tag": "paper" } }),
        ),
        ("report", json!({ "kind": "error", "message": "m" })),
    ] {
        let parsed = wire(kind, args);
        assert_eq!(
            code(run(&s, &Runtime::default(), &parsed)),
            BridgeErrorCode::BadRequest,
            "{kind}"
        );
    }
    // The page the call is for must be a smart page of the vault.
    for path in [
        "projects/photo-organiser/pages/photo-organiser-roadmap.md",
        "nothing.md",
        "../x.md",
        ".kasten/config.yaml",
    ] {
        let result = handle(
            s.k(),
            &Runtime::default(),
            path,
            &wire("theme", json!(null)),
            Instant::now(),
        );
        assert_eq!(code(result), BridgeErrorCode::Refused, "{path}");
    }
}

#[test]
fn an_answer_over_two_megabytes_is_cut_with_an_error() {
    let s = smart();
    // A page of the vault with a body larger than an answer may be.
    let big = format!(
        "---\nid: 01BIG0000000000000000000000\ntitle: Big\ntype: page\n---\n{}\n",
        "word ".repeat(500_000)
    );
    std::fs::write(s.vault.dir.join("library/big.md"), big).unwrap();
    s.k().reindex().unwrap();
    let result = ask(&s, "read", json!({ "id": "01BIG0000000000000000000000" }));
    let error = result.unwrap_err();
    assert_eq!(error.code, BridgeErrorCode::TooLarge, "{}", error.message);
    assert!(error.message.contains("2 MB"));
}
