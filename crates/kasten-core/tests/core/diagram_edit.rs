//! Typed diagram edits end to end: an agent's steps run on the diagram as it
//! is, wait for review when they take out or move too much, merge with what
//! a person drew meanwhile, and are staged, applied and made again as steps.

use crate::change_sets::stage;
use crate::common::{NOW, dev_vault};

use std::fs;

use kasten_core::agent::{AgentOp, ApplyOutcome, Session};
use kasten_core::diagrams;
use kasten_core::history::Actor;
use kasten_core::{Error, Kasten, Outcome, content_hash};
use serde_json::{Value, json};

const XML: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../fixtures/diagrams/editor-output.drawio"
));

fn open() -> (crate::common::TempVault, Kasten, Session) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k, Session::start("claude-code", NOW))
}

fn edit(path: &str, steps: Value) -> AgentOp {
    AgentOp::EditDiagram {
        path: path.into(),
        page: None,
        preset: None,
        steps: serde_json::from_value(steps).unwrap(),
        reason: Some("Because".into()),
        summary: String::new(),
    }
}

/// The editor-made diagram, in the library, by the agent `s`.
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

fn done(outcome: Outcome) -> Value {
    match outcome {
        Outcome::Done { result } => result,
        other => panic!("expected done, got {other:?}"),
    }
}

fn text_of(t: &crate::common::TempVault, path: &str) -> String {
    fs::read_to_string(t.vault.root().join(path)).unwrap()
}

fn invalid<T: std::fmt::Debug>(r: Result<T, Error>) -> String {
    match r {
        Err(Error::Invalid(why)) => why,
        other => panic!("expected Error::Invalid, got {other:?}"),
    }
}

fn person_adds(k: &Kasten, path: &str, id: &str) {
    let read = k.diagram(path).unwrap();
    let steps: Vec<diagrams::steps::Step> = serde_json::from_value(
        json!([{"op": "add_node", "id": id, "label": "Mine", "x": 600, "y": 400}]),
    )
    .unwrap();
    let out = diagrams::steps::replay(&read.xml, None, None, &steps).unwrap();
    k.save_diagram(&Actor::Human, path, &out.xml, None, &read.hash, NOW)
        .unwrap();
    k.commit_edits().unwrap();
}

#[test]
fn steps_run_on_the_diagram_as_one_commit_named_for_what_they_did() {
    let (t, k, s) = open();
    let path = made(&k, &s);
    let op = edit(
        &path,
        json!([
            {"op": "add_node", "id": "cache", "label": "Cache", "kind": "cache", "near": "api", "side": "below"},
            {"op": "add_edge", "from": "api", "to": "cache", "label": "get"},
            {"op": "restyle", "ids": ["web"], "token": "purple"},
        ]),
    );
    let result = done(k.agent_run(&s, &op, NOW).unwrap());
    assert_eq!(
        (result["status"].as_str(), result["ids"].clone()),
        (Some("saved"), json!(["cache", "e-api-cache"]))
    );
    assert_eq!(result["hash"], content_hash(&text_of(&t, &path)));
    let now = k.diagram(&path).unwrap();
    assert!(now.xml.contains("id=\"cache\"") && now.xml.contains("fillColor=#e1d5e7"));
    // Cells the steps did not touch kept their bytes.
    for kept in [
        "id=\"db\" value=\"Orders &amp;amp; users\"",
        "id=\"e1\" value=\"HTTPS\"",
    ] {
        assert!(now.xml.contains(kept), "{kept}");
    }
    let log = k.log(None, 1).unwrap();
    assert_eq!(
        log[0].summary,
        "diagram: edit Login flow — add 1 node, 1 link, restyle 1 item"
    );
    assert!(log[0].agent, "{:?}", log[0]);
    assert_eq!(log[0].op.as_deref(), Some("edit_diagram"));
    // The same steps again make the same cells again: a taken id is refused and nothing is written.
    let again = invalid(k.agent_run(&s, &op, NOW).map(|_| ()));
    assert!(
        again.starts_with("Step 1 (add_node)") && again.contains("already used"),
        "{again}"
    );
    assert_eq!(k.diagram(&path).unwrap().xml, now.xml);
}

#[test]
fn what_cannot_be_edited_is_refused_before_anything_waits() {
    let (t, k, s) = open();
    let path = made(&k, &s);
    for (op, why) in [
        (
            edit("library/zettelkasten-method.md", json!([{"op": "layout"}])),
            "not a diagram",
        ),
        (edit(&path, json!([])), "at least one step"),
        (
            edit(&path, json!([{"op": "delete", "ids": ["ghost"]}])),
            "No node or edge",
        ),
        (
            edit(
                &path,
                json!([{"op": "add_edge", "from": "web", "to": "ghost"}]),
            ),
            "ghost",
        ),
        (
            edit("library/Nowhere.drawio", json!([{"op": "layout"}])),
            "Nowhere",
        ),
        (
            edit("../outside.drawio", json!([{"op": "layout"}])),
            "outside",
        ),
    ] {
        let message = match k.agent_run(&s, &op, NOW) {
            Err(e) => e.to_string(),
            other => panic!("{why}: {other:?}"),
        };
        assert!(message.contains(why), "{why}: {message}");
    }
    assert_eq!(text_of(&t, &path), XML);
    assert!(k.proposals().unwrap().is_empty());
    // What an agent sends is limited like any write: 200 KB of steps.
    let big: Vec<Value> = (0..200)
        .map(|i| json!({"op": "add_node", "id": format!("n{i}"), "label": "x".repeat(1900)}))
        .collect();
    let message = invalid(k.agent_run(&s, &edit(&path, json!(big)), NOW).map(|_| ()));
    assert!(message.contains("KB"), "{message}");
}

#[test]
fn an_edit_that_takes_a_lot_out_waits_and_is_made_on_the_diagram_as_it_is_when_accepted() {
    let (t, k, s) = open();
    let path = made(&k, &s);
    // Three of the five cells (and the arrows with them): more than the limit.
    let op = edit(&path, json!([{"op": "delete", "ids": ["api", "db"]}]));
    let (id, reason) = match k.agent_run(&s, &op, NOW).unwrap() {
        Outcome::PendingReview { proposal, reason } => (proposal, reason),
        other => panic!("{other:?}"),
    };
    assert!(
        reason.contains("elements out") && reason.contains("limit"),
        "{reason}"
    );
    assert_eq!(text_of(&t, &path), XML);
    let proposal = &k.proposals().unwrap()[0];
    assert_eq!(proposal.op.name(), "edit_diagram");
    assert!(
        proposal
            .diff
            .contains("Edit the diagram “Login flow”: delete 2 items"),
        "{}",
        proposal.diff
    );
    assert!(
        proposal.diff.contains("delete api, db")
            && proposal
                .after
                .as_deref()
                .is_some_and(|a| !a.contains("id=\"api\""))
    );
    assert_eq!(proposal.note.as_deref(), Some("Because"));

    // A person adds a box while it waits. Accepting makes the steps on that, with no copy.
    person_adds(&k, &path, "mine");
    let value = k.accept_proposal(&id, "me", NOW).unwrap();
    assert_eq!(value["status"], "saved", "{value}");
    let now = k.diagram(&path).unwrap().xml;
    assert!(
        now.contains("id=\"mine\"") && !now.contains("id=\"api\"") && now.contains("id=\"web\"")
    );
    let copies = fs::read_dir(t.vault.root().join("library"))
        .unwrap()
        .filter(|e| {
            e.as_ref()
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains("conflict")
        })
        .count();
    assert_eq!(copies, 0);

    // A trusted session may take things out at once.
    let (_t, k, s) = open();
    let path = made(&k, &s);
    k.trust_session(&s.id, NOW.millis + 3_600_000).unwrap();
    assert_eq!(
        done(k.agent_run(&s, &op_for(&path), NOW).unwrap())["status"],
        "saved"
    );
}

fn op_for(path: &str) -> AgentOp {
    edit(path, json!([{"op": "delete", "ids": ["api", "db"]}]))
}

#[test]
fn a_layout_that_moves_most_of_the_boxes_waits_but_a_few_moved_do_not() {
    let (t, k, s) = open();
    let path = made(&k, &s);
    // Six boxes in all; five of them move.
    let more: Vec<Value> = (0..3)
        .map(|i| json!({"op": "add_node", "id": format!("n{i}"), "x": 40 + i * 140, "y": 300}))
        .collect();
    done(k.agent_run(&s, &edit(&path, json!(more)), NOW).unwrap());
    let shuffle = edit(
        &path,
        json!([
            {"op": "move", "id": "web", "dx": 200}, {"op": "move", "id": "api", "dx": 200},
            {"op": "move", "id": "db", "dx": 200}, {"op": "move", "id": "n0", "dy": 100}, {"op": "move", "id": "n1", "dy": 100},
        ]),
    );
    let before = text_of(&t, &path);
    match k.agent_run(&s, &shuffle, NOW).unwrap() {
        Outcome::PendingReview { reason, .. } => assert!(
            reason.contains("Moves 5 of the diagram's 6 boxes"),
            "{reason}"
        ),
        other => panic!("{other:?}"),
    }
    assert_eq!(text_of(&t, &path), before);
    // Moving two boxes is a nudge, not a rearrangement.
    let nudge = edit(
        &path,
        json!([{"op": "move", "id": "web", "dx": 20}, {"op": "move", "id": "api", "dx": 20}]),
    );
    assert_eq!(
        done(k.agent_run(&s, &nudge, NOW).unwrap())["status"],
        "saved"
    );
}

#[test]
fn staged_edits_are_what_the_real_op_makes_and_a_persons_edit_meanwhile_is_kept() {
    let (t, k, s) = open();
    let path = made(&k, &s);
    let mut set = k.begin_changes(&s, NOW);
    let steps = json!([
        {"op": "add_node", "id": "cache", "label": "Cache", "kind": "cache", "x": 600, "y": 80},
        {"op": "add_edge", "from": "api", "to": "cache"},
    ]);
    let told = stage(&k, &mut set, &s, &edit(&path, steps.clone()));
    assert_eq!(told["ids"], json!(["cache", "e-api-cache"]));
    assert_eq!(set.steps[0].name, "edit_diagram");
    assert_eq!(text_of(&t, &path), XML, "nothing is in the vault yet");
    // What is staged is what the op writes.
    let (_t2, direct, ds) = open();
    let dpath = made(&direct, &ds);
    done(direct.agent_run(&ds, &edit(&dpath, steps), NOW).unwrap());
    assert_eq!(
        k.diagram_in(&set, &path).unwrap().xml,
        direct.diagram(&dpath).unwrap().xml
    );

    // A person adds a box meanwhile: the set is not stale, it is put together with it.
    person_adds(&k, &path, "mine");
    assert!(k.stale_changes(&set, NOW).unwrap().is_empty());
    match k.apply_changes(&set, "Ada", NOW).unwrap() {
        // The diagram, and the draft picture that comes with it.
        ApplyOutcome::Applied { paths, .. } => {
            assert_eq!(paths, [path.clone(), format!("{path}.svg")])
        }
        other => panic!("{other:?}"),
    }
    let now = k.diagram(&path).unwrap().xml;
    assert!(
        now.contains("id=\"mine\"")
            && now.contains("id=\"cache\"")
            && now.contains("id=\"e-api-cache\"")
    );
}

#[test]
fn a_staged_edit_whose_cells_a_person_took_out_goes_stale_and_is_made_again_without_that_step() {
    let (t, k, s) = open();
    let path = made(&k, &s);
    let mut set = k.begin_changes(&s, NOW);
    stage(
        &k,
        &mut set,
        &s,
        &edit(
            &path,
            json!([
                {"op": "add_node", "id": "cache", "label": "Cache", "x": 600, "y": 80},
                {"op": "add_edge", "from": "db", "to": "cache"},
                {"op": "restyle", "ids": ["web"], "token": "green"},
            ]),
        ),
    );
    // A person takes the database out.
    let read = k.diagram(&path).unwrap();
    let out = diagrams::steps::replay(
        &read.xml,
        None,
        None,
        &serde_json::from_value::<Vec<_>>(json!([{"op": "delete", "ids": ["db"]}])).unwrap(),
    )
    .unwrap();
    k.save_diagram(&Actor::Human, &path, &out.xml, None, &read.hash, NOW)
        .unwrap();
    k.commit_edits().unwrap();
    match k.apply_changes(&set, "Ada", NOW).unwrap() {
        ApplyOutcome::Stale { files } => assert_eq!(files, std::slice::from_ref(&path)),
        other => panic!("expected stale, got {other:?}"),
    }
    assert!(!text_of(&t, &path).contains("id=\"cache\""));
    // Recalculating leaves out only the step that cannot be made again.
    let (fresh, dropped) = k.rebase_changes(&set, NOW).unwrap();
    assert_eq!(dropped.len(), 1, "{dropped:?}");
    assert!(
        dropped[0].summary.contains("connect db → cache") && dropped[0].why.contains("db"),
        "{:?}",
        dropped[0]
    );
    assert!(matches!(
        k.apply_changes(&fresh, "Ada", NOW).unwrap(),
        ApplyOutcome::Applied { .. }
    ));
    let now = k.diagram(&path).unwrap().xml;
    assert!(
        now.contains("id=\"cache\"")
            && !now.contains("id=\"db\"")
            && now.contains("fillColor=#d5e8d4")
    );
}

#[test]
fn a_whole_rewrite_staged_earlier_is_not_put_over_a_persons_redraw_when_made_again() {
    let (t, k, s) = open();
    let path = made(&k, &s);
    let mut set = k.begin_changes(&s, NOW);
    let rewritten = XML.replace("Web app", "Browser app");
    stage(
        &k,
        &mut set,
        &s,
        &AgentOp::UpdateDiagram {
            path: path.clone(),
            xml: rewritten,
            base: XML.into(),
            reason: None,
        },
    );
    person_adds(&k, &path, "mine");
    assert!(matches!(
        k.apply_changes(&set, "Ada", NOW).unwrap(),
        ApplyOutcome::Stale { .. }
    ));
    // Recalculating does not stage the old whole file over the new one: the step is left out and said.
    let (fresh, dropped) = k.rebase_changes(&set, NOW).unwrap();
    assert_eq!(dropped.len(), 1);
    assert!(
        dropped[0].why.contains("changed since it was read"),
        "{}",
        dropped[0].why
    );
    assert!(fresh.files.is_empty());
    let kept = text_of(&t, &path);
    assert!(kept.contains("id=\"mine\"") && kept.contains("Web app"));
}

#[test]
fn an_edit_of_a_diagram_made_in_the_same_set_is_staged_and_applied_with_it() {
    let (_t, k, s) = open();
    let mut set = k.begin_changes(&s, NOW);
    let made = stage(
        &k,
        &mut set,
        &s,
        &AgentOp::CreateDiagram {
            title: "Flow".into(),
            project: None,
            xml: XML.into(),
        },
    );
    let path = made["path"].as_str().unwrap().to_owned();
    stage(
        &k,
        &mut set,
        &s,
        &edit(
            &path,
            json!([{"op": "update", "id": "web", "label": "Customer"}]),
        ),
    );
    assert_eq!(set.created_files.len(), 1);
    assert!(k.diagram(&path).is_err());
    assert!(
        k.diagram_in(&set, &path)
            .unwrap()
            .xml
            .contains("value=\"Customer\"")
    );
    assert!(matches!(
        k.apply_changes(&set, "Ada", NOW).unwrap(),
        ApplyOutcome::Applied { .. }
    ));
    assert!(k.diagram(&path).unwrap().xml.contains("value=\"Customer\""));
}
