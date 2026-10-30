//! A batch a person runs from the app (`Kasten::batch_as_person`): the agent
//! batch's engine under a person's rules. All or nothing, one commit that one
//! undo takes back, the same limits, no agent guardrail, and the vault's own
//! folders never written.

use std::fs;

use kasten_core::agent::AgentOp;
use kasten_core::history::History;
use kasten_core::{Kasten, Outcome, PersonBatch};
use serde_json::{Value, json};

use crate::change_sets::{DRAFT, WELCOME, append, create, open, snapshot};
use crate::common::{NOW, TempVault};

const SKETCH: &str = "projects/photo-organiser/cards/duplicate-score-sketch.md";

pub fn commits(k: &Kasten) -> usize {
    k.log(None, 10_000).unwrap().len()
}

pub fn person(k: &Kasten, ops: Vec<AgentOp>) -> kasten_core::Result<PersonBatch> {
    k.batch_as_person(&ops, None, NOW)
}

pub fn note(title: &str, tags: &[&str], props: Value) -> AgentOp {
    let Value::Object(props) = props else {
        panic!("props are an object");
    };
    AgentOp::CreateNote {
        note_type: "page".into(),
        title: title.into(),
        body: String::new(),
        project: None,
        tags: tags.iter().map(|t| (*t).to_owned()).collect(),
        props,
        parent: None,
        template: None,
    }
}

pub fn schema(tag: &str) -> AgentOp {
    AgentOp::TagSchema {
        tag: tag.into(),
        schema: json!({
            "properties": [{"key": "Pages", "type": "number"}],
            "views": [{"name": "Table", "type": "table"}]
        }),
    }
}

fn lock(t: &TempVault, k: &Kasten, path: &str) {
    let file = t.vault.root().join(path);
    let text = fs::read_to_string(&file)
        .unwrap()
        .replacen("---\n", "---\nlocked: true\n", 1);
    fs::write(&file, text).unwrap();
    k.reindex().unwrap();
}

#[test]
fn fifty_changes_are_one_commit_by_the_person_and_one_undo_takes_them_all_back() {
    let (t, k, _) = open();
    let h = History::open(t.vault.root()).unwrap().unwrap();
    let tree = h.tree_id("HEAD").unwrap();
    let files = snapshot(t.vault.root());
    let before = commits(&k);
    let ops = (0..50)
        .map(|n| append([WELCOME, SKETCH][n % 2], &format!("Batch line {n}.")))
        .collect();
    let done = person(&k, ops).unwrap();
    assert_eq!(done.changes, 50);
    assert_eq!(done.results.len(), 50);
    assert_eq!(commits(&k), before + 1, "one commit for all 50");
    let head = &k.log(None, 1).unwrap()[0];
    assert_eq!(done.commit.as_deref(), Some(head.id.as_str()));
    assert_eq!(head.op.as_deref(), Some("batch"));
    assert!(
        head.message.contains("Kasten-Batch: 50"),
        "{}",
        head.message
    );
    assert!(
        !head.agent && head.session.is_none(),
        "a person's commit, no session"
    );
    assert!(
        head.summary.starts_with("batch: 50 additions"),
        "{}",
        head.summary
    );

    let undone = k.undo_commit(done.commit.as_deref().unwrap(), NOW).unwrap();
    assert!(undone.conflict.is_none());
    assert_eq!(h.tree_id("HEAD").unwrap(), tree, "every byte back");
    assert_eq!(snapshot(t.vault.root()), files);
}

#[test]
fn the_reason_is_the_commit_summary_on_one_line() {
    let (_t, k, _) = open();
    k.batch_as_person(
        &[append(WELCOME, "Hi.")],
        Some("Turn the table into a database: Books\nKasten-Op: forged"),
        NOW,
    )
    .unwrap();
    let head = &k.log(None, 1).unwrap()[0];
    assert_eq!(
        head.summary,
        "Turn the table into a database: Books Kasten-Op: forged"
    );
    assert_eq!(head.op.as_deref(), Some("batch"));
}

#[test]
fn one_refused_change_refuses_all_and_nothing_is_written() {
    let (t, k, _) = open();
    let files = snapshot(t.vault.root());
    let before = commits(&k);
    let ops = vec![
        append(WELCOME, "First."),
        create("Made by the batch", "Body."),
        append("inbox/gone.md", "Third, to a note that is not there."),
        append(SKETCH, "Fourth."),
    ];
    let err = person(&k, ops).unwrap_err().to_string();
    assert!(err.contains("Change 3 of 4 (append)"), "{err}");
    assert!(err.contains("Nothing in the batch was changed"), "{err}");
    assert_eq!(snapshot(t.vault.root()), files);
    assert_eq!(commits(&k), before);
}

#[test]
fn the_vaults_own_folders_are_refused_for_a_person_too_and_the_whole_batch_with_them() {
    let (t, k, _) = open();
    let files = snapshot(t.vault.root());
    let before = commits(&k);
    let one = |op: AgentOp| vec![append(WELCOME, "First."), create("Second", "Body."), op];
    let mut bad = vec![
        append(".kasten/config.yaml", "x"),
        append(".git/HEAD", "x"),
        append(".Git/config", "x"),
        append(".KASTEN/agents.md", "x"),
        append("library/../.kasten/config.yaml", "x"),
        append("library/.hidden/a.md", "x"),
        append(".trash/a.md", "x"),
        append("C:/Windows/x.md", "x"),
        append("library\\welcome-to-kasten.md", "x"),
    ];
    bad.push(AgentOp::EditPage {
        path: ".kasten/x.md".into(),
        steps: vec![],
        reason: None,
    });
    bad.push(AgentOp::SetParent {
        path: WELCOME.into(),
        parent: Some(".kasten/p.md".into()),
    });
    let mut parent = create("Child", "");
    if let AgentOp::CreateNote { parent: p, .. } = &mut parent {
        *p = Some(".git/p.md".into());
    }
    bad.push(parent);
    bad.push(AgentOp::AddToBoard {
        board: "projects/photo-organiser/board.canvas".into(),
        notes: vec![".git/x.md".into()],
        layout: None,
        positions: None,
    });
    for op in bad {
        let name = op.name();
        let err = person(&k, one(op)).unwrap_err().to_string();
        assert!(
            err.contains("Change 3 of 3") && err.contains("Nothing in the batch was changed"),
            "{name}: {err}"
        );
        assert_eq!(snapshot(t.vault.root()), files, "{name}");
        assert_eq!(commits(&k), before, "{name}");
    }
}

#[test]
fn a_project_name_cannot_lead_a_new_note_out_of_the_vault() {
    let (t, k, _) = open();
    for project in ["../outside", "..", ".kasten", "a/../../b"] {
        let mut op = create("Escapee", "Body.");
        if let AgentOp::CreateNote { project: p, .. } = &mut op {
            *p = Some(project.into());
        }
        let files = snapshot(t.vault.root());
        let outcome = person(&k, vec![op]);
        // Either refused, or made inside the vault's projects folder; never elsewhere.
        match outcome {
            Err(_) => assert_eq!(snapshot(t.vault.root()), files, "{project}"),
            Ok(done) => {
                let path = done.results[0]["path"].as_str().unwrap().to_owned();
                assert!(
                    !path.contains("..") && !path.starts_with(['.', '/']) && !path.contains("/."),
                    "{project}: {path}"
                );
            }
        }
        assert!(!t.vault.root().join("../outside").exists());
    }
}

#[test]
fn a_hundred_changes_are_fine_and_more_are_not() {
    let (t, k, _) = open();
    let files = snapshot(t.vault.root());
    let many = |n: usize| {
        (0..n)
            .map(|i| append(WELCOME, &format!("Line {i}.")))
            .collect()
    };
    let why = person(&k, many(101)).unwrap_err().to_string();
    assert!(why.contains("at most 100"), "{why}");
    let big = AgentOp::Append {
        path: WELCOME.into(),
        markdown: "x".repeat(600 * 1024),
        heading: None,
    };
    let why = person(&k, vec![big.clone(), big]).unwrap_err().to_string();
    assert!(why.contains("at most 1024 KB"), "{why}");
    assert!(
        person(&k, vec![])
            .unwrap_err()
            .to_string()
            .contains("at least one")
    );
    assert_eq!(snapshot(t.vault.root()), files);
    assert_eq!(person(&k, many(100)).unwrap().changes, 100);
}

#[test]
fn only_the_changes_a_batch_may_hold_are_taken() {
    let (t, k, _) = open();
    let files = snapshot(t.vault.root());
    for op in [
        AgentOp::Trash {
            path: WELCOME.into(),
            reason: None,
        },
        AgentOp::Template {
            name: "x".into(),
            text: "t".into(),
            base: None,
            reason: None,
        },
        AgentOp::Batch {
            ops: vec![append(WELCOME, "x")],
            reason: None,
        },
        AgentOp::CreateProject {
            title: "P".into(),
            setup: None,
        },
        AgentOp::UndoSession {
            session: "s".into(),
        },
    ] {
        let name = op.name();
        let err = person(&k, vec![append(WELCOME, "x"), op])
            .unwrap_err()
            .to_string();
        assert!(
            err.contains("Change 2 of 2") && err.contains("cannot be part of a batch"),
            "{name}: {err}"
        );
    }
    assert_eq!(snapshot(t.vault.root()), files);
}

#[test]
fn a_person_is_not_held_by_the_lock_or_the_agent_limits_but_an_agent_is() {
    let (t, k, s) = open();
    lock(&t, &k, DRAFT);
    // A person's change to a locked page is made, as their other changes are.
    let done = person(
        &k,
        vec![append(DRAFT, "Mine."), append(WELCOME, "Also mine.")],
    )
    .unwrap();
    assert_eq!(done.changes, 2);
    assert!(
        fs::read_to_string(t.vault.root().join(DRAFT))
            .unwrap()
            .contains("Mine.")
    );
    // An agent's batch with the same change is refused whole.
    let batch = AgentOp::Batch {
        ops: vec![append(DRAFT, "Theirs.")],
        reason: None,
    };
    let err = k.agent_run(&s, &batch, NOW).unwrap_err().to_string();
    assert!(err.contains("locked"), "{err}");
    // Thirty new notes are over an agent's limit (it waits for review) and not a person's.
    let thirty = |_: ()| {
        (0..30)
            .map(|n| create(&format!("Made {n}"), ""))
            .collect::<Vec<_>>()
    };
    let batch = AgentOp::Batch {
        ops: thirty(()),
        reason: None,
    };
    assert!(matches!(
        k.agent_run(&s, &batch, NOW).unwrap(),
        Outcome::PendingReview { .. }
    ));
    assert_eq!(person(&k, thirty(())).unwrap().changes, 30);
}

#[test]
fn a_failure_part_way_puts_back_every_file_the_batch_wrote_and_only_those() {
    let (t, k, _) = open();
    // Changed outside before the batch: committed first as its own change, and kept.
    fs::write(
        t.vault.root().join(SKETCH),
        "---\ntitle: Sketch\ntype: card\n---\nEdited elsewhere.\n",
    )
    .unwrap();
    k.reindex().unwrap();
    let h = History::open(t.vault.root()).unwrap().unwrap();
    k.fail_batch_after(5);
    let ops = vec![
        create("One", ""),
        create("Two", ""),
        append(WELCOME, "Three."),
        append(WELCOME, "Four."),
        create("Five", ""),
        append(WELCOME, "Six."),
        append(WELCOME, "Seven."),
    ];
    let err = person(&k, ops).unwrap_err().to_string();
    assert!(
        err.contains("Change 6 of 7") && err.contains("No space left"),
        "{err}"
    );
    let after = snapshot(t.vault.root());
    assert!(
        after[SKETCH].starts_with(b"---\ntitle: Sketch"),
        "the outside edit stays"
    );
    assert!(!String::from_utf8_lossy(&after[WELCOME]).contains("Three."));
    assert!(
        k.list()
            .unwrap()
            .iter()
            .all(|n| !["One", "Two", "Five"].contains(&n.title.as_str()))
    );
    assert!(
        h.dirty().unwrap().is_empty(),
        "nothing is left half-staged or half-written"
    );
}

#[test]
fn an_outside_edit_to_a_file_the_batch_writes_is_committed_first_and_survives_an_undo() {
    let (t, k, _) = open();
    let original = fs::read_to_string(t.vault.root().join(WELCOME)).unwrap();
    let outside = format!("{original}\nTyped in another editor.\n");
    fs::write(t.vault.root().join(WELCOME), &outside).unwrap();
    k.reindex().unwrap();
    let before = commits(&k);
    let done = person(
        &k,
        vec![append(WELCOME, "From the batch."), create("Extra", "")],
    )
    .unwrap();
    assert_eq!(
        commits(&k),
        before + 2,
        "the outside edit has its own commit, then the batch"
    );
    let undone = k.undo_commit(done.commit.as_deref().unwrap(), NOW).unwrap();
    assert!(undone.conflict.is_none());
    let text = fs::read_to_string(t.vault.root().join(WELCOME)).unwrap();
    assert!(text.contains("Typed in another editor.") && !text.contains("From the batch."));
}

#[test]
fn a_batch_needs_the_vaults_history() {
    let t = crate::common::dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    let files = snapshot(t.vault.root());
    let err = person(&k, vec![append(WELCOME, "x")])
        .unwrap_err()
        .to_string();
    assert!(err.contains("needs the vault's history"), "{err}");
    assert_eq!(snapshot(t.vault.root()), files);
}
