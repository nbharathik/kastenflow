//! The parity ops for saved searches, the bibliography, diagram files and
//! the history: what agents may do under the three modes, what is refused,
//! and what always waits.

use std::collections::BTreeMap;

use crate::change_sets::open;
use crate::common::NOW;
use crate::parity::{lock, refused};
use crate::structure::{done, page, pending};
use crate::structure_agent::set_mode;
use kasten_core::agent::{AgentOp, Session};
use kasten_core::bib::NewReference;
use kasten_core::config_keys::AgentMode;
use kasten_core::history::Actor;
use kasten_core::{Instant, Kasten, Outcome};
use serde_json::{Map, Value, json};

fn map(value: Value) -> Map<String, Value> {
    value.as_object().unwrap().clone()
}

fn search(name: &str, query: &str) -> AgentOp {
    AgentOp::CreateCollection {
        name: name.into(),
        edits: map(json!({ "query": query })),
    }
}

#[test]
fn a_saved_search_is_made_and_changed_by_an_agent_and_refused_other_keys() {
    let (t, k, s) = open();
    let made = done(
        k.agent_run(&s, &search("Reading queue", "#capture"), NOW)
            .unwrap(),
    );
    assert_eq!(made["path"], "views/reading-queue.yaml");
    assert!(t.vault.root().join("views/reading-queue.yaml").exists());
    assert_eq!(k.collections().unwrap().len(), 1);

    let update = |query: &str, base: &str| AgentOp::UpdateCollection {
        path: "views/reading-queue.yaml".into(),
        edits: map(json!({ "query": query })),
        base: base.into(),
    };
    let hash = made["hash"].as_str().unwrap().to_owned();
    let changed = done(k.agent_run(&s, &update("#paper", &hash), NOW).unwrap());
    assert_eq!(changed["query"], "#paper");
    // The hash it listed is out of date now.
    let why = refused(&k, &s, &update("#idea", &hash));
    assert!(why.contains("changed since you listed it"), "{why}");

    let other = AgentOp::UpdateCollection {
        path: "views/reading-queue.yaml".into(),
        edits: map(json!({ "format": 2 })),
        base: changed["hash"].as_str().unwrap().into(),
    };
    assert!(refused(&k, &s, &other).contains("A saved search has"));
    let bad = search("Bad", "x".repeat(5000).as_str());
    assert!(k.agent_run(&s, &bad, NOW).is_err());
    // Renaming and trashing stay with the person.
    let why = k
        .rename_collection(&s.actor(), "views/reading-queue.yaml", "Other", &hash, NOW)
        .unwrap_err()
        .to_string();
    assert!(why.contains("A person saves collections"), "{why}");
}

#[test]
fn a_saved_search_waits_in_review() {
    let (t, k, s) = open();
    set_mode(&k, AgentMode::Review);
    let id = pending(k.agent_run(&s, &search("Later", "#idea"), NOW).unwrap());
    assert!(!t.vault.root().join("views/later.yaml").exists());
    k.accept_proposal(&id, "me", NOW).unwrap();
    assert!(t.vault.root().join("views/later.yaml").exists());
}

fn reference(key: &str) -> AgentOp {
    AgentOp::AddReference {
        kind: "article".into(),
        key: key.into(),
        fields: BTreeMap::from([
            ("title".to_owned(), "On saved things".to_owned()),
            ("author".to_owned(), "Rivera, Ana".to_owned()),
            ("year".to_owned(), "2026".to_owned()),
        ]),
        allow_duplicate: false,
    }
}

fn bib(t: &crate::common::TempVault) -> String {
    std::fs::read_to_string(t.vault.root().join("sources/references.bib")).unwrap_or_default()
}

#[test]
fn a_reference_always_waits_in_balanced_and_review_and_is_taken_in_autonomous() {
    let (t, k, s) = open();
    let proposal = k.agent_run(&s, &reference("rivera2026saved"), NOW).unwrap();
    let Outcome::PendingReview {
        proposal: id,
        reason,
    } = proposal
    else {
        panic!("balanced holds a reference");
    };
    assert!(reason.contains("reference"), "{reason}");
    assert!(!bib(&t).contains("rivera2026saved"));
    let words = &k.proposals().unwrap()[0].diff;
    assert!(
        words.contains("Add the article reference rivera2026saved"),
        "{words}"
    );
    k.accept_proposal(&id, "me", NOW).unwrap();
    assert!(bib(&t).contains("rivera2026saved"));

    set_mode(&k, AgentMode::Review);
    pending(k.agent_run(&s, &reference("rivera2026again"), NOW).unwrap());

    set_mode(&k, AgentMode::Autonomous);
    done(k.agent_run(&s, &reference("rivera2026auto"), NOW).unwrap());
    assert!(bib(&t).contains("rivera2026auto"));
    let head = &k.log(None, 1).unwrap()[0];
    assert!(
        head.message.contains("Kasten-Mode: autonomous"),
        "{}",
        head.message
    );
    assert!(
        head.message.contains("Approved-by: autonomous-mode"),
        "{}",
        head.message
    );
}

#[test]
fn a_reference_is_checked_before_it_waits() {
    let (t, k, s) = open();
    set_mode(&k, AgentMode::Autonomous);
    done(k.agent_run(&s, &reference("rivera2026saved"), NOW).unwrap());
    // The same key again, and a key that cannot be written in a page.
    let why = refused(&k, &s, &reference("rivera2026saved"));
    assert!(why.contains("same work"), "{why}");
    assert!(k.agent_run(&s, &reference("not a key"), NOW).is_err());
    assert!(bib(&t).matches("rivera2026saved").count() == 1);
    // Direct calls by an agent stay refused: only the op above, through the modes, adds one.
    let wanted = NewReference {
        kind: "article".into(),
        key: "direct2026".into(),
        fields: BTreeMap::new(),
        allow_duplicate: false,
    };
    let why = k
        .add_reference(&s.actor(), &wanted, "any", NOW)
        .unwrap_err()
        .to_string();
    assert!(why.contains("done by the person"), "{why}");
}

fn drawing() -> AgentOp {
    AgentOp::CreateDiagram {
        title: "Login flow".into(),
        project: None,
        xml: "<mxfile host=\"test\">\n  <diagram id=\"p1\" name=\"Page-1\">\n    <mxGraphModel>\n      <root>\n        <mxCell id=\"0\" />\n        <mxCell id=\"1\" parent=\"0\" />\n        <mxCell id=\"a\" value=\"a\" vertex=\"1\" parent=\"1\" />\n      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>\n".into(),
    }
}

fn made_diagram(k: &Kasten, s: &Session) -> String {
    done(k.agent_run(s, &drawing(), NOW).unwrap())["path"]
        .as_str()
        .unwrap()
        .to_owned()
}

#[test]
fn a_diagram_is_renamed_moved_and_copied_and_refused_when_a_locked_note_names_it() {
    let (_t, k, s) = open();
    let path = made_diagram(&k, &s);
    let renamed = done(
        k.agent_run(
            &s,
            &AgentOp::RenameDiagram {
                path: path.clone(),
                title: "Sign in flow".into(),
            },
            NOW,
        )
        .unwrap(),
    );
    let path = renamed["path"].as_str().unwrap().to_owned();
    assert_eq!(k.diagrams().unwrap()[0].title, "Sign in flow");
    let moved = done(
        k.agent_run(
            &s,
            &AgentOp::MoveDiagram {
                path: path.clone(),
                project: Some("photo-organiser".into()),
            },
            NOW,
        )
        .unwrap(),
    );
    let path = moved["path"].as_str().unwrap().to_owned();
    assert!(path.starts_with("projects/photo-organiser/"), "{path}");
    done(
        k.agent_run(&s, &AgentOp::DuplicateDiagram { path: path.clone() }, NOW)
            .unwrap(),
    );
    assert_eq!(k.diagrams().unwrap().len(), 2);

    let notes = AgentOp::RenameDiagram {
        path: "library/welcome-to-kasten.md".into(),
        title: "X".into(),
    };
    assert!(refused(&k, &s, &notes).contains("not a diagram"));
    let holder = page(&k, "Holder", None, None);
    let name = path.rsplit('/').next().unwrap();
    k.append(
        &Actor::Human,
        &holder.meta.path,
        &format!("see {name}"),
        None,
        NOW,
    )
    .unwrap();
    lock(&k, &holder.meta.path);
    let rename = AgentOp::RenameDiagram {
        path: path.clone(),
        title: "Again".into(),
    };
    let why = refused(&k, &s, &rename);
    assert!(why.contains("is locked and names"), "{why}");
    let mv = AgentOp::MoveDiagram {
        path,
        project: None,
    };
    assert!(refused(&k, &s, &mv).contains("is locked and names"));
}

#[test]
fn a_lock_the_typed_reader_cannot_see_still_protects_the_notes_that_name_a_diagram() {
    let (t, k, s) = open();
    let path = made_diagram(&k, &s);
    let holder = page(&k, "Holder", None, None);
    let name = path.rsplit('/').next().unwrap();
    // A header the known keys cannot read (a title that is a list) but that says it is locked.
    std::fs::write(
        t.vault.root().join(&holder.meta.path),
        format!("---\ntitle: [a, b]\nlocked: true\n---\nsee {name}\n"),
    )
    .unwrap();
    k.reindex().unwrap();
    let rename = AgentOp::RenameDiagram {
        path,
        title: "Again".into(),
    };
    let why = refused(&k, &s, &rename);
    assert!(why.contains("is locked and names"), "{why}");
}

#[test]
fn a_diagram_rename_waits_in_review() {
    let (_t, k, s) = open();
    let path = made_diagram(&k, &s);
    set_mode(&k, AgentMode::Review);
    let op = AgentOp::RenameDiagram {
        path,
        title: "Renamed".into(),
    };
    let id = pending(k.agent_run(&s, &op, NOW).unwrap());
    assert_eq!(k.diagrams().unwrap()[0].title, "Login flow");
    assert!(
        k.proposals().unwrap()[0]
            .diff
            .contains("Rename the diagram")
    );
    k.accept_proposal(&id, "me", NOW).unwrap();
    assert_eq!(k.diagrams().unwrap()[0].title, "Renamed");
}

fn capture(text: &str) -> AgentOp {
    AgentOp::Capture {
        markdown: text.into(),
        tags: vec![],
    }
}

#[test]
fn an_agent_takes_back_its_own_session_and_nothing_twice() {
    let (_t, k, s) = open();
    let made = done(k.agent_run(&s, &capture("Remember the milk"), NOW).unwrap());
    let path = made["path"].as_str().unwrap().to_owned();
    assert!(k.read(&path).is_ok());
    let undo = AgentOp::UndoSession {
        session: s.id.clone(),
    };
    let told = done(k.agent_run(&s, &undo, NOW).unwrap());
    assert_eq!(told["reverted"].as_array().unwrap().len(), 1);
    assert!(k.read(&path).is_err());
    let why = refused(&k, &s, &undo);
    assert!(why.contains("nothing left to undo"), "{why}");
    let unknown = AgentOp::UndoSession {
        session: "no-such-session".into(),
    };
    assert!(refused(&k, &s, &unknown).contains("nothing left to undo"));
}

#[test]
fn another_sessions_changes_are_taken_back_only_after_review() {
    let (_t, k, s) = open();
    let path = done(k.agent_run(&s, &capture("Remember the milk"), NOW).unwrap())["path"]
        .as_str()
        .unwrap()
        .to_owned();
    let other = Session::start(
        "other-agent",
        Instant {
            millis: NOW.millis + 1,
        },
    );
    let undo = AgentOp::UndoSession {
        session: s.id.clone(),
    };
    let Outcome::PendingReview { proposal, reason } = k.agent_run(&other, &undo, NOW).unwrap()
    else {
        panic!("another session's undo waits");
    };
    assert!(reason.contains("another session"), "{reason}");
    assert!(k.read(&path).is_ok());
    // The reviewer is told which notes come back, not only how many changes.
    let title = k.read(&path).unwrap().meta.title;
    let held = k.proposals().unwrap();
    let shown = &held.iter().find(|p| p.id == proposal).unwrap().diff;
    assert!(
        shown.contains("Take back the 1 changes of the session of"),
        "{shown}"
    );
    assert!(shown.contains(&format!("“{title}”")), "{shown}");
    k.accept_proposal(&proposal, "me", NOW).unwrap();
    assert!(k.read(&path).is_err());
}

#[test]
fn a_session_is_not_taken_back_over_a_note_that_is_locked_now() {
    let (_t, k, s) = open();
    let made = AgentOp::CreateNote {
        note_type: "page".into(),
        title: "Scratch".into(),
        body: "x".into(),
        project: None,
        tags: vec![],
        props: Map::new(),
        parent: None,
        template: None,
    };
    let path = done(k.agent_run(&s, &made, NOW).unwrap())["path"]
        .as_str()
        .unwrap()
        .to_owned();
    lock(&k, &path);
    let undo = AgentOp::UndoSession {
        session: s.id.clone(),
    };
    let why = refused(&k, &s, &undo);
    assert!(why.contains("locked now"), "{why}");
    assert!(k.read(&path).is_ok());
}
