//! What a smart page may change through the bridge: every write is made by
//! the agent `smart:<page path>` under the agent mode that holds for the note,
//! one commit per call, and shows in History under that name.

use kasten_core::Instant;
use kasten_core::config_keys::AgentMode;
use kasten_core::history::Actor;
use kasten_core::smart::BridgeErrorCode;
use serde_json::{Value, json};

use super::bridge::{run, wire};
use super::{Smart, add_page_in, files, set_mode, smart};
use crate::smart::bridge::handle;
use crate::smart::runtime::{Runtime, actor_name};

const ROADMAP: &str = "01M36N8AA0SQP0DY9C54T2DXA1";
const ROADMAP_PATH: &str = "projects/photo-organiser/pages/photo-organiser-roadmap.md";
const REPORT_PATH: &str = "projects/note-taking-study/pages/report-draft.md";
const JOURNAL: &str = "01M36H4FJ0YWBWJ94S8SFCAVJ2";
const JOURNAL_PATH: &str = "journal/2026/2026-09-23.md";

fn update(
    s: &Smart,
    rt: &Runtime,
    id: &str,
    status: &str,
) -> Result<Value, kasten_core::smart::BridgeError> {
    run(
        s,
        rt,
        &wire("update", json!({ "id": id, "props": { "status": status } })),
    )
}

fn commits(s: &Smart) -> usize {
    s.k().log(None, 1000).unwrap().len()
}

fn text(s: &Smart, path: &str) -> String {
    s.k().read(path).unwrap().text
}

#[test]
fn a_write_is_one_commit_by_the_page_as_an_agent() {
    let s = smart();
    let rt = Runtime::default();
    let before = commits(&s);
    let out = update(&s, &rt, ROADMAP, "Submitted").unwrap();
    assert_eq!(out["status"], "done", "{out}");
    assert!(text(&s, ROADMAP_PATH).contains("status: Submitted"));
    assert_eq!(commits(&s), before + 1);
    let newest = &s.k().log(None, 1).unwrap()[0];
    assert!(newest.agent);
    assert_eq!(newest.author, format!("agent:smart:{}", s.path));
    assert!(newest.session.is_some());
    // The same page keeps the same session; another page has its own.
    update(&s, &rt, ROADMAP, "Revision").unwrap();
    let again = &s.k().log(None, 1).unwrap()[0];
    assert_eq!(again.session, newest.session);
    let (other, _) = add_page_in(s.k(), "Other", None, &files());
    handle(
        s.k(),
        &rt,
        &other,
        &wire(
            "update",
            json!({ "id": ROADMAP, "props": { "status": "Accepted" } }),
        ),
        Instant::now(),
    )
    .unwrap();
    let third = &s.k().log(None, 1).unwrap()[0];
    assert_ne!(third.session, newest.session);
    assert_eq!(third.author, format!("agent:smart:{other}"));
}

#[test]
fn in_review_mode_a_write_becomes_a_proposal_and_the_note_is_untouched() {
    let s = smart();
    let rt = Runtime::default();
    set_mode(s.k(), AgentMode::Review, &[]);
    // A proposal is kept in the vault's own folder, so the notes' history is what must not move.
    let history = |path: &str| s.k().log(Some(path), 100).unwrap().len();
    let before = (history(ROADMAP_PATH), history(JOURNAL_PATH));
    let note = text(&s, ROADMAP_PATH);
    let out = update(&s, &rt, ROADMAP, "Submitted").unwrap();
    assert_eq!(out["status"], "pending_review", "{out}");
    assert_eq!(text(&s, ROADMAP_PATH), note);
    assert_eq!((history(ROADMAP_PATH), history(JOURNAL_PATH)), before);
    let proposals = s.k().proposals().unwrap();
    assert_eq!(proposals.len(), 1);
    assert_eq!(proposals[0].client, actor_name(&s.path));
    assert_eq!(proposals[0].client, format!("smart:{}", s.path));
    // Every kind of write waits, not only an update.
    for call in [
        wire("addTags", json!({ "id": ROADMAP, "tags": ["urgent"] })),
        wire("append", json!({ "id": ROADMAP, "md": "\nmore\n" })),
        wire("createNote", json!({ "title": "A row" })),
        wire("toggleTodo", json!({ "id": JOURNAL, "index": 1 })),
    ] {
        let kind = call.kind();
        let out = run(&s, &rt, &call).unwrap();
        assert_eq!(out["status"], "pending_review", "{kind}: {out}");
    }
    assert_eq!(text(&s, ROADMAP_PATH), note);
    assert_eq!((history(ROADMAP_PATH), history(JOURNAL_PATH)), before);
    // The person says yes, and it happens, as the page's agent with the person's approval.
    let id = proposals[0].id.clone();
    s.k().accept_proposal(&id, "owner", Instant::now()).unwrap();
    assert!(text(&s, ROADMAP_PATH).contains("status: Submitted"));
    let newest = &s.k().log(None, 1).unwrap()[0];
    assert_eq!(newest.approved_by.as_deref(), Some("owner"));
}

#[test]
fn a_project_on_review_holds_what_a_page_changes_in_it_and_nothing_else() {
    let s = smart();
    let rt = Runtime::default();
    set_mode(
        s.k(),
        AgentMode::Balanced,
        &[("photo-organiser", AgentMode::Review)],
    );
    assert_eq!(
        update(&s, &rt, ROADMAP, "Submitted").unwrap()["status"],
        "pending_review"
    );
    let report = "01K5Y2PAPERDRAFT0000000001";
    assert_eq!(
        update(&s, &rt, report, "Submitted").unwrap()["status"],
        "done"
    );
    assert!(text(&s, REPORT_PATH).contains("status: Submitted"));
}

#[test]
fn the_stricter_of_the_pages_own_project_and_the_note_decides() {
    let s = smart();
    let rt = Runtime::default();
    set_mode(
        s.k(),
        AgentMode::Balanced,
        &[("photo-organiser", AgentMode::Review)],
    );
    let report = "01K5Y2PAPERDRAFT0000000001";
    // A page in the library writes freely to a note in a Balanced project.
    assert_eq!(
        update(&s, &rt, report, "Submitted").unwrap()["status"],
        "done"
    );
    // A page that lives in the Review project is held wherever its write lands.
    let (inside, _) = add_page_in(s.k(), "Inside", Some("photo-organiser"), &files());
    let held = handle(
        s.k(),
        &rt,
        &inside,
        &wire(
            "update",
            json!({ "id": report, "props": { "status": "Revision" } }),
        ),
        Instant::now(),
    )
    .unwrap();
    assert_eq!(held["status"], "pending_review", "{held}");
    assert!(text(&s, REPORT_PATH).contains("status: Submitted"));
    // And the other way: the page in the library does not loosen a Review note.
    assert_eq!(
        update(&s, &rt, ROADMAP, "Submitted").unwrap()["status"],
        "pending_review"
    );
}

#[test]
fn a_page_that_loops_runs_into_the_soft_limits_and_turns_into_proposals() {
    let s = smart();
    let rt = Runtime::default();
    let mut done = 0;
    let mut waiting = 0;
    for n in 0..40 {
        let out = run(
            &s,
            &rt,
            &wire(
                "createNote",
                json!({ "title": format!("Row {n}"), "tags": ["paper"] }),
            ),
        )
        .unwrap();
        match out["status"].as_str() {
            Some("done") => done += 1,
            Some("pending_review") => waiting += 1,
            other => panic!("{other:?}: {out}"),
        }
    }
    assert!((20..=25).contains(&done), "{done} rows were made");
    assert_eq!(done + waiting, 40);
    assert!(waiting >= 10, "only {waiting} waited");
    assert_eq!(s.k().proposals().unwrap().len(), waiting);
}

#[test]
fn tags_lines_notes_and_to_dos_each_change_one_note_in_one_commit() {
    let s = smart();
    let rt = Runtime::default();
    let before = commits(&s);

    let out = run(
        &s,
        &rt,
        &wire("addTags", json!({ "id": ROADMAP, "tags": ["urgent"] })),
    )
    .unwrap();
    assert_eq!(out["status"], "done", "{out}");
    assert!(
        s.k()
            .read(ROADMAP_PATH)
            .unwrap()
            .meta
            .tags
            .contains(&"urgent".to_owned())
    );

    let out = run(
        &s,
        &rt,
        &wire(
            "append",
            json!({ "id": ROADMAP, "md": "\n- added by the page\n" }),
        ),
    )
    .unwrap();
    assert_eq!(out["status"], "done", "{out}");
    assert!(text(&s, ROADMAP_PATH).contains("- added by the page"));

    let out = run(&s, &rt, &wire("createNote", json!({ "title": "A venue", "tags": ["paper"], "props": { "status": "Idea" }, "body": "Somewhere." }))).unwrap();
    assert_eq!(out["status"], "done", "{out}");
    let made = s
        .k()
        .list()
        .unwrap()
        .into_iter()
        .find(|n| n.title == "A venue")
        .unwrap();
    assert_eq!(made.kind, "card");
    assert_eq!(made.props["status"], "Idea");

    // The to-do numbered 1 in the note is ticked, then unticked again.
    assert!(text(&s, JOURNAL_PATH).contains("- [ ] Draft the evaluation"));
    run(
        &s,
        &rt,
        &wire("toggleTodo", json!({ "id": JOURNAL, "index": 1 })),
    )
    .unwrap();
    assert!(text(&s, JOURNAL_PATH).contains("- [x] Draft the evaluation"));
    run(
        &s,
        &rt,
        &wire("toggleTodo", json!({ "id": JOURNAL, "index": 1 })),
    )
    .unwrap();
    assert!(text(&s, JOURNAL_PATH).contains("- [ ] Draft the evaluation"));
    assert_eq!(commits(&s), before + 5);
    for commit in s.k().log(None, 5).unwrap() {
        assert!(commit.agent, "{}", commit.summary);
        assert_eq!(commit.author, format!("agent:smart:{}", s.path));
    }
    let missing = run(
        &s,
        &rt,
        &wire("toggleTodo", json!({ "id": JOURNAL, "index": 99 })),
    )
    .unwrap_err();
    assert_eq!(missing.code, BridgeErrorCode::Refused);
    assert!(
        missing.message.contains("no to-do number 99"),
        "{}",
        missing.message
    );
}

#[test]
fn a_note_a_page_in_a_project_makes_belongs_to_the_project() {
    let s = smart();
    let rt = Runtime::default();
    let (path, _) = add_page_in(s.k(), "Dashboard", Some("photo-organiser"), &files());
    handle(
        s.k(),
        &rt,
        &path,
        &wire("createNote", json!({ "title": "Here" })),
        Instant::now(),
    )
    .unwrap();
    let here = s
        .k()
        .list()
        .unwrap()
        .into_iter()
        .find(|n| n.title == "Here")
        .unwrap();
    assert_eq!(here.project.as_deref(), Some("photo-organiser"));
    handle(
        s.k(),
        &rt,
        &path,
        &wire(
            "createNote",
            json!({ "title": "There", "project": "note-taking-study" }),
        ),
        Instant::now(),
    )
    .unwrap();
    let there = s
        .k()
        .list()
        .unwrap()
        .into_iter()
        .find(|n| n.title == "There")
        .unwrap();
    assert_eq!(there.project.as_deref(), Some("note-taking-study"));
}

#[test]
fn the_rules_that_hold_for_every_agent_hold_for_a_page() {
    let s = smart();
    let rt = Runtime::default();
    // A locked note is read-only for it.
    s.k()
        .set_meta(
            &Actor::Human,
            ROADMAP_PATH,
            "locked",
            Some("true"),
            Instant::now(),
        )
        .unwrap();
    let before = text(&s, ROADMAP_PATH);
    for call in [
        wire(
            "update",
            json!({ "id": ROADMAP, "props": { "status": "Submitted" } }),
        ),
        wire("addTags", json!({ "id": ROADMAP, "tags": ["x"] })),
        wire("append", json!({ "id": ROADMAP, "md": "x" })),
    ] {
        let error = run(&s, &rt, &call).unwrap_err();
        assert_eq!(error.code, BridgeErrorCode::Refused, "{}", call.kind());
        assert!(
            error.message.to_lowercase().contains("locked"),
            "{}",
            error.message
        );
    }
    assert_eq!(text(&s, ROADMAP_PATH), before);
    // Kasten's own folders are not notes it can write.
    for id in [
        ".kasten/config.yaml",
        ".git/config",
        "../outside.md",
        "nothing at all",
    ] {
        let result = run(&s, &rt, &wire("append", json!({ "id": id, "md": "x" })));
        assert!(result.is_err(), "{id}");
    }
    // A note's id that is not there is not found.
    let missing = run(
        &s,
        &rt,
        &wire(
            "update",
            json!({ "id": "01NOSUCHNOTE0000000000000", "props": {} }),
        ),
    )
    .unwrap_err();
    assert_eq!(missing.code, BridgeErrorCode::NotFound);
    // It cannot reach its own folder's code through a note write either: the page's code folder is not a note.
    let code = format!("{}/index.html", s.path.replace(".md", ".smart"));
    assert!(
        run(
            &s,
            &rt,
            &wire("append", json!({ "id": code, "md": "<script>" }))
        )
        .is_err()
    );
}
