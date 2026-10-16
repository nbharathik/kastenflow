//! The draft picture in the vault: written with what an agent makes or
//! changes (directly, and when staged changes are applied), known as a draft,
//! replaced by the editor's picture and never over it.

use std::fs;

use crate::change_sets::stage;
use crate::common::{NOW, dev_vault};

use kasten_core::agent::{AgentOp, ApplyOutcome, Session};
use kasten_core::diagrams::{self, DRAFT_MARK, Preview};
use kasten_core::history::Actor;
use kasten_core::{Kasten, Outcome};
use serde_json::{Value, json};

const XML: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/diagrams/editor-output.drawio"
));
const EDITOR_SVG: &str =
    "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"81px\" height=\"41px\"><defs/><g/></svg>";

fn open() -> (crate::common::TempVault, Kasten, Session) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k, Session::start("claude-code", NOW))
}

fn made(k: &Kasten, s: &Session) -> String {
    let op = AgentOp::CreateDiagram {
        title: "Login flow".into(),
        project: None,
        xml: XML.into(),
    };
    match k.agent_run(s, &op, NOW).unwrap() {
        Outcome::Done { result } => result["path"].as_str().unwrap().to_owned(),
        other => panic!("{other:?}"),
    }
}

fn edit(path: &str, steps: Value) -> AgentOp {
    AgentOp::EditDiagram {
        path: path.into(),
        page: None,
        preset: None,
        steps: serde_json::from_value(steps).unwrap(),
        reason: None,
        summary: String::new(),
    }
}

fn picture(t: &crate::common::TempVault, path: &str) -> String {
    fs::read_to_string(t.vault.root().join(format!("{path}.svg"))).unwrap()
}

#[test]
fn what_an_agent_makes_comes_with_a_draft_picture_in_the_same_commit() {
    let (t, k, s) = open();
    let path = made(&k, &s);
    let svg = picture(&t, &path);
    assert!(svg.contains(">Web app</text>") && !svg.contains("foreignObject"));
    let diagram = k.diagram(&path).unwrap();
    assert_eq!(diagram.preview, Preview::Draft);
    assert!(
        svg.trim_end().ends_with(&format!(
            "{DRAFT_MARK}\n<!-- kasten-source: {} -->",
            diagram.hash
        )),
        "{}",
        &svg[svg.len() - 120..]
    );
    assert_eq!(
        serde_json::to_value(diagram.preview).unwrap(),
        json!("draft")
    );
    let listed = k.diagrams().unwrap();
    assert_eq!(listed[0].preview, Preview::Draft);
    // One commit holds both files; undoing the session takes the picture back with the source.
    let log = k.log(None, 1).unwrap();
    assert_eq!(log[0].summary, "diagram: create Login flow");
    let files: Vec<String> = k
        .commit_changes(&log[0].id)
        .unwrap()
        .into_iter()
        .map(|c| c.path)
        .collect();
    assert!(
        files.contains(&path) && files.contains(&format!("{path}.svg")),
        "{files:?}"
    );
    // A blank diagram, or one with nothing to draw, has no picture until the editor draws one.
    let blank = AgentOp::CreateDiagram {
        title: "Empty".into(),
        project: None,
        xml: String::new(),
    };
    let Outcome::Done { result } = k.agent_run(&s, &blank, NOW).unwrap() else {
        panic!()
    };
    assert_eq!(
        k.diagram(result["path"].as_str().unwrap()).unwrap().preview,
        Preview::Missing
    );
}

#[test]
fn an_edit_draws_the_new_picture_and_one_that_changes_nothing_leaves_it_alone() {
    let (t, k, s) = open();
    let path = made(&k, &s);
    let before = picture(&t, &path);
    k.agent_run(&s, &edit(&path, json!([{"op": "add_node", "id": "cache", "label": "Cache", "near": "api", "side": "below"}])), NOW).unwrap();
    let after = picture(&t, &path);
    assert!(after.contains(">Cache</text>") && !before.contains(">Cache</text>"));
    assert_eq!(k.diagram(&path).unwrap().preview, Preview::Draft);
    let head = k.log(None, 1).unwrap()[0].id.clone();
    k.agent_run(
        &s,
        &edit(
            &path,
            json!([{"op": "update", "id": "cache", "label": "Cache"}]),
        ),
        NOW,
    )
    .unwrap();
    assert_eq!(picture(&t, &path), after);
    assert_eq!(
        k.log(None, 1).unwrap()[0].id,
        head,
        "nothing changed, so nothing was committed"
    );
}

#[test]
fn the_editors_picture_replaces_a_draft_and_a_draft_never_replaces_the_editors() {
    let (t, k, s) = open();
    let path = made(&k, &s);
    let read = k.diagram(&path).unwrap();
    k.save_diagram_preview(&Actor::Human, &path, EDITOR_SVG, &read.hash, NOW)
        .unwrap();
    assert_eq!(k.diagram(&path).unwrap().preview, Preview::Fresh);
    assert!(!picture(&t, &path).contains(DRAFT_MARK));
    // For this very source the editor's picture is the better one.
    let svg = diagrams::draft_for(&read.xml).unwrap();
    assert!(!diagrams::write_draft(k.vault(), &path, &svg).unwrap());
    assert_eq!(k.diagram(&path).unwrap().preview, Preview::Fresh);
    // A change by an agent makes the editor's picture old, and the draft is the picture of what is there.
    k.agent_run(
        &s,
        &edit(
            &path,
            json!([{"op": "restyle", "ids": ["web"], "token": "red"}]),
        ),
        NOW,
    )
    .unwrap();
    assert_eq!(k.diagram(&path).unwrap().preview, Preview::Draft);
    assert!(picture(&t, &path).contains("#f8cecc"));
    // And the editor draws again when it is next at hand.
    let again = k.diagram(&path).unwrap();
    k.save_diagram_preview(&Actor::Human, &path, EDITOR_SVG, &again.hash, NOW)
        .unwrap();
    assert_eq!(k.diagram(&path).unwrap().preview, Preview::Fresh);
}

#[test]
fn a_picture_that_could_run_something_is_refused_but_the_editors_html_labels_are_not() {
    let (_t, k, s) = open();
    let path = made(&k, &s);
    let read = k.diagram(&path).unwrap();
    for bad in [
        "<svg xmlns=\"http://www.w3.org/2000/svg\" onload=\"x()\"><g/></svg>",
        "<svg xmlns=\"http://www.w3.org/2000/svg\"><a href=\"javascript:alert(1)\"><text>x</text></a></svg>",
        "<svg xmlns=\"http://www.w3.org/2000/svg\"><iframe src=\"https://evil.example\"/></svg>",
    ] {
        let err = k
            .save_diagram_preview(&Actor::Human, &path, bad, &read.hash, NOW)
            .unwrap_err()
            .to_string();
        assert!(err.contains("may not hold"), "{bad}: {err}");
    }
    let labelled = "<svg xmlns=\"http://www.w3.org/2000/svg\"><switch><foreignObject><div xmlns=\"http://www.w3.org/1999/xhtml\">hi</div></foreignObject><text>hi</text></switch><a href=\"https://example.com\"><text>go</text></a></svg>";
    k.save_diagram_preview(&Actor::Human, &path, labelled, &read.hash, NOW)
        .unwrap();
    assert_eq!(k.diagram(&path).unwrap().preview, Preview::Fresh);
}

#[test]
fn a_whole_rewrite_by_an_agent_gets_a_draft_too() {
    let (t, k, s) = open();
    let path = made(&k, &s);
    let next = XML.replace("Web app", "Browser");
    let op = AgentOp::UpdateDiagram {
        path: path.clone(),
        xml: next,
        base: XML.into(),
        reason: None,
    };
    k.agent_run(&s, &op, NOW).unwrap();
    assert!(picture(&t, &path).contains(">Browser</text>"));
    assert_eq!(k.diagram(&path).unwrap().preview, Preview::Draft);
}

#[test]
fn staged_diagrams_get_their_drafts_when_the_set_is_applied_in_the_same_commit() {
    let (t, k, s) = open();
    let existing = made(&k, &s);
    let mut set = k.begin_changes(&s, NOW);
    let new = stage(
        &k,
        &mut set,
        &s,
        &AgentOp::CreateDiagram {
            title: "Second".into(),
            project: None,
            xml: XML.into(),
        },
    );
    let new_path = new["path"].as_str().unwrap().to_owned();
    stage(
        &k,
        &mut set,
        &s,
        &edit(
            &existing,
            json!([{"op": "update", "id": "web", "label": "Customer web"}]),
        ),
    );
    stage(
        &k,
        &mut set,
        &s,
        &edit(
            &new_path,
            json!([{"op": "update", "id": "db", "label": "Records"}]),
        ),
    );
    let before = picture(&t, &existing);
    match k.apply_changes(&set, "Ada", NOW).unwrap() {
        ApplyOutcome::Applied { paths, .. } => {
            for p in [&existing, &new_path] {
                assert!(
                    paths.contains(p) && paths.contains(&format!("{p}.svg")),
                    "{paths:?}"
                );
            }
        }
        other => panic!("{other:?}"),
    }
    assert!(
        picture(&t, &existing).contains(">Customer web</text>") && !before.contains("Customer web")
    );
    assert!(picture(&t, &new_path).contains(">Records</text>"));
    for p in [&existing, &new_path] {
        assert_eq!(k.diagram(p).unwrap().preview, Preview::Draft, "{p}");
    }
    // A set whose write fails part way puts the pictures back with the rest.
    let mut set = k.begin_changes(&s, NOW);
    for path in [&existing, &new_path] {
        stage(
            &k,
            &mut set,
            &s,
            &edit(
                path,
                json!([{"op": "update", "id": "api", "label": "Gateway"}]),
            ),
        );
    }
    let held: Vec<(String, String)> = [&existing, &new_path]
        .iter()
        .map(|p| (picture(&t, p), k.diagram(p).unwrap().xml))
        .collect();
    k.fail_changes_writes_after(1);
    assert!(k.apply_changes(&set, "Ada", NOW).is_err());
    let now: Vec<(String, String)> = [&existing, &new_path]
        .iter()
        .map(|p| (picture(&t, p), k.diagram(p).unwrap().xml))
        .collect();
    assert_eq!(now, held);
}
