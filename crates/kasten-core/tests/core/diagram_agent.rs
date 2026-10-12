//! Agents and diagrams: an agent makes a diagram and rewrites its source; a
//! rewrite that takes a lot out of the drawing, and a diagram for the trash,
//! wait for review; a request that is not a diagram is refused; and a
//! proposal accepted after a person changed the diagram never overwrites it.

use crate::common;

use std::fs;

use common::{NOW, dev_vault};
use kasten_core::agent::{AgentOp, Session};
use kasten_core::diagrams::Preview;
use kasten_core::history::Actor;
use kasten_core::{Error, Kasten, Outcome, content_hash};
use serde_json::Value;

const PROJECT: &str = "photo-organiser";

fn diagram(cells: &[&str]) -> String {
    let body: String = cells
        .iter()
        .map(|id| {
            format!("        <mxCell id=\"{id}\" value=\"{id}\" vertex=\"1\" parent=\"1\" />\n")
        })
        .collect();
    format!(
        "<mxfile host=\"test\">\n  <diagram id=\"p1\" name=\"Page-1\">\n    <mxGraphModel>\n      <root>\n        <mxCell id=\"0\" />\n        <mxCell id=\"1\" parent=\"0\" />\n{body}      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>\n"
    )
}

const SVG: &str =
    "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"81px\" height=\"41px\"><defs/><g/></svg>";

fn open() -> (common::TempVault, Kasten, Session) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k, Session::start("claude-code", NOW))
}

fn create(title: &str, project: Option<&str>, xml: &str) -> AgentOp {
    AgentOp::CreateDiagram {
        title: title.into(),
        project: project.map(str::to_owned),
        xml: xml.into(),
    }
}

fn update(path: &str, xml: &str, base: &str) -> AgentOp {
    AgentOp::UpdateDiagram {
        path: path.into(),
        xml: xml.into(),
        base: base.into(),
        reason: Some("Tidying".into()),
    }
}

fn done(outcome: Outcome) -> Value {
    match outcome {
        Outcome::Done { result } => result,
        other => panic!("expected done, got {other:?}"),
    }
}

fn proposed(k: &Kasten, s: &Session, op: &AgentOp) -> (String, String) {
    match k.agent_run(s, op, NOW).unwrap() {
        Outcome::PendingReview { proposal, reason } => (proposal, reason),
        Outcome::Done { result } => panic!("expected a proposal, got {result}"),
    }
}

/// A diagram of six cells, made by `s`.
fn made(k: &Kasten, s: &Session) -> (String, String) {
    let xml = diagram(&["a", "b", "c", "d"]);
    let path = done(
        k.agent_run(s, &create("Login flow", None, &xml), NOW)
            .unwrap(),
    )["path"]
        .as_str()
        .unwrap()
        .to_owned();
    (path, xml)
}

fn text_of(t: &common::TempVault, path: &str) -> String {
    fs::read_to_string(t.vault.root().join(path)).unwrap()
}

fn exists(t: &common::TempVault, path: &str) -> bool {
    t.vault.root().join(path).exists()
}

fn invalid<T: std::fmt::Debug>(result: Result<T, Error>) -> String {
    match result {
        Err(Error::Invalid(why)) => why,
        other => panic!("expected Error::Invalid, got {other:?}"),
    }
}

#[test]
fn an_agent_makes_a_diagram_as_a_commit_with_no_picture_until_the_editor_draws_one() {
    let (t, k, s) = open();
    let (path, xml) = made(&k, &s);
    assert_eq!(path, "library/Login-flow.drawio");
    assert_eq!(text_of(&t, &path), xml);
    assert!(!exists(&t, "library/Login-flow.drawio.svg"));
    let listed = k.diagrams().unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(
        (listed[0].title.as_str(), listed[0].pages),
        ("Login flow", 1)
    );
    assert_eq!(listed[0].preview, Preview::Missing);
    assert_eq!(
        k.log(None, 1).unwrap()[0].summary,
        "diagram: create Login flow"
    );

    // A project's diagram goes in its folder; with no source it is a blank page.
    let blank = done(
        k.agent_run(&s, &create("Notes", Some(PROJECT), ""), NOW)
            .unwrap(),
    );
    let blank = blank["path"].as_str().unwrap();
    assert_eq!(blank, "projects/photo-organiser/diagrams/Notes.drawio");
    assert!(text_of(&t, blank).contains("<mxfile"));
    assert_eq!(k.diagram(blank).unwrap().xml, text_of(&t, blank));
    // Never over another diagram: the next with the same name is numbered.
    let again = done(
        k.agent_run(&s, &create("Login flow", None, &xml), NOW)
            .unwrap(),
    );
    assert_eq!(again["path"], "library/Login-flow-2.drawio");
}

#[test]
fn what_is_not_a_diagram_is_refused_before_anything_is_written() {
    let (t, k, s) = open();
    let (path, xml) = made(&k, &s);
    for (op, why) in [
        (create("X", None, "<html><body/></html>"), "not a diagram"),
        (create("X", None, "<mxfile><diagram></mxfile>"), "closing"),
        (
            create("X", None, "<!DOCTYPE mxfile><mxfile/>"),
            "declaration",
        ),
        (create("A|B", None, ""), "title"),
        (create("X", Some("nope"), ""), "nope"),
        (
            update(&path, "<svg xmlns=\"http://www.w3.org/2000/svg\"/>", &xml),
            "not a diagram",
        ),
        (
            update("library/zettelkasten-method.md", &xml, &xml),
            "not a diagram",
        ),
    ] {
        let message = invalid(k.agent_run(&s, &op, NOW).map(|_| ()));
        assert!(message.contains(why), "{op:?}: {message}");
    }
    assert!(
        k.agent_run(&s, &update("library/Gone.drawio", &xml, &xml), NOW)
            .is_err()
    );
    assert_eq!(text_of(&t, &path), xml);
    assert_eq!(k.diagrams().unwrap().len(), 1);
    // Nothing waits either: a refusal is not a proposal.
    assert!(k.proposals().unwrap().is_empty());
    // A picture is never written by an agent, and a path is not a way out of the vault.
    assert!(
        k.agent_run(
            &s,
            &update("library/Login-flow.drawio.svg", &xml, &xml),
            NOW
        )
        .is_err()
    );
    assert!(
        k.agent_run(&s, &update("../outside.drawio", &xml, &xml), NOW)
            .is_err()
    );
}

#[test]
fn a_rewrite_that_keeps_most_of_the_drawing_is_done_at_once_and_marks_the_picture_out_of_date() {
    let (t, k, s) = open();
    let (path, xml) = made(&k, &s);
    // A person's editor drew the picture.
    let read = k.diagram(&path).unwrap();
    k.save_diagram(&Actor::Human, &path, &xml, Some(SVG), &read.hash, NOW)
        .unwrap();
    k.commit_edits().unwrap();
    assert_eq!(k.diagram(&path).unwrap().preview, Preview::Fresh);

    // One cell out of six, and one in: well under the limit.
    let next = diagram(&["a", "b", "c", "e"]);
    let result = done(k.agent_run(&s, &update(&path, &next, &xml), NOW).unwrap());
    assert_eq!(result["status"], "saved");
    assert_eq!(result["hash"], content_hash(&next));
    assert_eq!(text_of(&t, &path), next);
    assert_eq!(k.diagram(&path).unwrap().preview, Preview::Stale);
    let log = k.log(None, 1).unwrap();
    assert_eq!(log[0].summary, "diagram: edit Login flow");
    // The commit is the agent's.
    assert!(log[0].agent, "{:?}", log[0]);
    assert_eq!(log[0].op.as_deref(), Some("save_diagram"));
    // The same source again changes nothing.
    let same = done(k.agent_run(&s, &update(&path, &next, &next), NOW).unwrap());
    assert_eq!(same["status"], "unchanged");
}

#[test]
fn a_rewrite_that_takes_a_lot_out_waits_for_review_and_a_trusted_session_may_make_it() {
    let (t, k, s) = open();
    let (path, xml) = made(&k, &s);
    // Four of the six cells are gone: more than the 40% the guardrails allow.
    let small = diagram(&["a"]);
    let (id, reason) = proposed(&k, &s, &update(&path, &small, &xml));
    assert!(
        reason.contains("elements out") && reason.contains("limit"),
        "{reason}"
    );
    assert_eq!(text_of(&t, &path), xml, "nothing was written");
    let waiting = k.proposals().unwrap();
    assert_eq!(waiting.len(), 1);
    let proposal = &waiting[0];
    assert_eq!(proposal.op.name(), "update_diagram");
    assert_eq!(proposal.target.as_ref().unwrap().title, "Login flow");
    assert_eq!(proposal.before.as_deref(), Some(xml.as_str()));
    assert_eq!(proposal.after.as_deref(), Some(small.as_str()));
    assert!(
        proposal.diff.contains("Rewrite the diagram “Login flow”"),
        "{}",
        proposal.diff
    );
    assert_eq!(proposal.note.as_deref(), Some("Tidying"));
    k.reject_proposal(&id, "me", NOW).unwrap();
    assert_eq!(text_of(&t, &path), xml);

    // Written again under new ids, which is the same as taking everything out.
    let renamed = xml
        .replace("id=\"a\"", "id=\"w\"")
        .replace("id=\"b\"", "id=\"x\"")
        .replace("id=\"c\"", "id=\"y\"")
        .replace("id=\"d\"", "id=\"z\"");
    proposed(&k, &s, &update(&path, &renamed, &xml));

    // A person who trusts the session lifts the soft limit.
    k.trust_session(&s.id, NOW.millis + 3_600_000).unwrap();
    let result = done(k.agent_run(&s, &update(&path, &small, &xml), NOW).unwrap());
    assert_eq!(result["status"], "saved");
    assert_eq!(text_of(&t, &path), small);
}

#[test]
fn accepting_a_proposal_never_overwrites_what_a_person_drew_since() {
    let (t, k, s) = open();
    let (path, xml) = made(&k, &s);
    let small = diagram(&["a"]);
    let (id, _) = proposed(&k, &s, &update(&path, &small, &xml));
    // The person adds a box while the proposal waits.
    let theirs = diagram(&["a", "b", "c", "d", "mine"]);
    let read = k.diagram(&path).unwrap();
    k.save_diagram(&Actor::Human, &path, &theirs, None, &read.hash, NOW)
        .unwrap();
    k.commit_edits().unwrap();

    let value = k.accept_proposal(&id, "me", NOW).unwrap();
    assert_eq!(value["status"], "conflict", "{value}");
    assert_eq!(text_of(&t, &path), theirs, "the person's version stands");
    let copy = value["copy"].as_str().unwrap();
    assert!(copy.starts_with("library/Login-flow (conflict "), "{copy}");
    assert_eq!(
        text_of(&t, copy),
        small,
        "the agent's version is kept beside it"
    );
    assert!(k.proposals().unwrap().is_empty());

    // Accepted while the diagram is still the one it was made against, it is written.
    let (path, xml) = {
        let again = done(k.agent_run(&s, &create("Other", None, &xml), NOW).unwrap());
        (again["path"].as_str().unwrap().to_owned(), xml)
    };
    let (id, _) = proposed(&k, &s, &update(&path, &small, &xml));
    let value = k.accept_proposal(&id, "me", NOW).unwrap();
    assert_eq!(value["status"], "saved", "{value}");
    assert_eq!(text_of(&t, &path), small);
}

#[test]
fn a_diagram_for_the_trash_always_waits_even_for_a_trusted_session_and_takes_its_picture() {
    let (t, k, s) = open();
    let (path, xml) = made(&k, &s);
    let read = k.diagram(&path).unwrap();
    k.save_diagram(&Actor::Human, &path, &xml, Some(SVG), &read.hash, NOW)
        .unwrap();
    k.commit_edits().unwrap();
    k.trust_session(&s.id, NOW.millis + 3_600_000).unwrap();

    let trash = AgentOp::Trash {
        path: path.clone(),
        reason: Some("Out of date".into()),
    };
    let (id, reason) = proposed(&k, &s, &trash);
    assert_eq!(reason, "Trashing a diagram always waits for review");
    assert!(exists(&t, &path) && exists(&t, "library/Login-flow.drawio.svg"));
    let proposal = &k.proposals().unwrap()[0];
    assert_eq!(proposal.diff, "Move the diagram “Login flow” to the trash");
    assert_eq!(proposal.before.as_deref(), Some(xml.as_str()));
    assert_eq!(proposal.note.as_deref(), Some("Out of date"));

    k.accept_proposal(&id, "me", NOW).unwrap();
    assert!(!exists(&t, &path) && !exists(&t, "library/Login-flow.drawio.svg"));
    let items = k.list_trash().unwrap();
    assert!(items.iter().any(|i| i.original == path), "{items:?}");
    // It can be put back, picture and all.
    let item = items.iter().find(|i| i.original == path).unwrap();
    k.restore_diagram(&Actor::Human, &item.trashed).unwrap();
    assert!(exists(&t, &path) && exists(&t, "library/Login-flow.drawio.svg"));
}

#[test]
fn what_an_agent_may_send_is_limited_like_any_other_write() {
    let (_t, k, s) = open();
    let big = format!(
        "<mxfile><diagram>{}</diagram></mxfile>",
        "x".repeat(300 * 1024)
    );
    let message = invalid(k.agent_run(&s, &create("Big", None, &big), NOW).map(|_| ()));
    assert!(message.contains("KB"), "{message}");
    assert!(k.diagrams().unwrap().is_empty());
}
