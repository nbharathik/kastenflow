//! The schema of a new tag, and the order of a view's rows, in a batch: a
//! person's, and an agent's, which waits for review.

use std::fs;

use kasten_core::Outcome;
use kasten_core::agent::AgentOp;
use kasten_core::history::Actor;
use serde_json::json;

use crate::batch_person::{commits, note, person, schema};
use crate::change_sets::{WELCOME, append, open, snapshot};
use crate::common::NOW;

#[test]
fn a_new_tags_schema_is_made_with_its_notes_as_one_commit() {
    let (t, k, _) = open();
    let before = commits(&k);
    let done = person(
        &k,
        vec![
            schema("books"),
            note("Dune", &["books"], json!({"Pages": 412})),
            note("Emma", &["books"], json!({"Pages": "300"})),
        ],
    )
    .unwrap();
    assert_eq!(
        commits(&k),
        before + 1,
        "the schema and the notes are one commit"
    );
    assert_eq!(done.results[0]["path"], "tags/books.yaml");
    let yaml = fs::read_to_string(t.vault.root().join("tags/books.yaml")).unwrap();
    assert!(
        yaml.contains("name: books") && yaml.contains("Table"),
        "{yaml}"
    );
    let dune = k.read(done.results[1]["path"].as_str().unwrap()).unwrap();
    assert!(dune.text.contains("Pages: 412"), "{}", dune.text);
}

#[test]
fn a_tag_that_has_a_schema_is_never_given_another_by_a_batch() {
    let (t, k, _) = open();
    person(&k, vec![schema("books")]).unwrap();
    let before = commits(&k);
    let files = snapshot(t.vault.root());
    // The same tag however it is spelled, and one that was there from the start.
    for tag in ["books", "Books", "#books", " BOOKS ", "task"] {
        let err = person(&k, vec![append(WELCOME, "x"), schema(tag)])
            .unwrap_err()
            .to_string();
        assert!(
            err.contains("Change 2 of 2") && err.contains("already has a schema"),
            "{tag}: {err}"
        );
    }
    assert_eq!((snapshot(t.vault.root()), commits(&k)), (files, before));
}

#[test]
fn a_file_of_another_name_that_holds_the_new_tags_file_name_is_not_overwritten() {
    let (t, k, _) = open();
    fs::write(
        t.vault.root().join("tags/reading-list.yaml"),
        "name: Reading\n",
    )
    .unwrap();
    k.commit_external().unwrap();
    let files = snapshot(t.vault.root());
    let err = person(&k, vec![schema("reading-list")])
        .unwrap_err()
        .to_string();
    assert!(err.contains("already has a schema"), "{err}");
    assert_eq!(snapshot(t.vault.root()), files);
}

#[test]
fn two_schemas_for_one_new_tag_refuse_the_whole_batch() {
    let (t, k, _) = open();
    let files = snapshot(t.vault.root());
    let err = person(&k, vec![schema("films"), schema("films")])
        .unwrap_err()
        .to_string();
    assert!(err.contains("Change 2 of 2"), "{err}");
    assert_eq!(snapshot(t.vault.root()), files, "the first is put back too");
}

#[test]
fn a_schema_that_would_not_pass_update_tag_schema_refuses_the_batch() {
    let (t, k, _) = open();
    let files = snapshot(t.vault.root());
    for bad in [
        json!({"properties": [{"key": "x", "type": "nonsense"}]}),
        json!({"views": [{"name": "A", "type": "table"}, {"name": "a", "type": "table"}]}),
        json!({"views": [{"type": "table"}]}),
        json!("not a mapping"),
    ] {
        let op = AgentOp::TagSchema {
            tag: "books".into(),
            schema: bad,
        };
        let err = person(&k, vec![append(WELCOME, "x"), op])
            .unwrap_err()
            .to_string();
        assert!(
            err.contains("Change 2 of 2") && err.contains("Tag schema for “books”"),
            "{err}"
        );
    }
    assert_eq!(snapshot(t.vault.root()), files);
}

#[test]
fn a_view_order_follows_a_schema_made_in_the_same_batch() {
    let (t, k, _) = open();
    let before = commits(&k);
    let order = AgentOp::SetViewOrder {
        tag: "books".into(),
        view: "Table".into(),
        ids: vec!["01HAAA".into(), "01HBBB".into()],
    };
    person(
        &k,
        vec![schema("books"), note("Dune", &["books"], json!({})), order],
    )
    .unwrap();
    assert_eq!(commits(&k), before + 1);
    let yaml = fs::read_to_string(t.vault.root().join("tags/books.yaml")).unwrap();
    assert!(yaml.contains("order: [01HAAA, 01HBBB]"), "{yaml}");
    // Naming a view that is not there refuses the batch.
    let bad = AgentOp::SetViewOrder {
        tag: "books".into(),
        view: "Nope".into(),
        ids: vec![],
    };
    let err = person(&k, vec![append(WELCOME, "x"), bad])
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("Change 2 of 2 (set_view_order)") && err.contains("no view called"),
        "{err}"
    );
}

#[test]
fn an_agents_batch_with_a_schema_waits_for_review_and_one_for_an_existing_tag_is_refused() {
    let (t, k, s) = open();
    let batch = |ops: Vec<AgentOp>| AgentOp::Batch { ops, reason: None };
    let ops = vec![
        schema("books"),
        note("Dune", &["books"], json!({"Pages": 412})),
    ];
    let Outcome::PendingReview { proposal, reason } = k.agent_run(&s, &batch(ops), NOW).unwrap()
    else {
        panic!("a schema an agent makes waits, in a batch as alone");
    };
    assert!(reason.to_lowercase().contains("schema"), "{reason}");
    assert!(!t.vault.root().join("tags/books.yaml").exists());
    k.accept_proposal(&proposal, "me", NOW).unwrap();
    assert!(t.vault.root().join("tags/books.yaml").exists());
    let made: Vec<_> = k
        .log(None, 100)
        .unwrap()
        .into_iter()
        .filter(|c| c.message.contains("Kasten-Batch: 2"))
        .collect();
    assert_eq!(
        made.len(),
        1,
        "accepting makes the schema and the note in one commit"
    );
    assert_eq!(made[0].approved_by.as_deref(), Some("me"));
    let err = k
        .agent_run(&s, &batch(vec![schema("books")]), NOW)
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("Change 1 of 1 (update_tag_schema)") && err.contains("already has a schema"),
        "{err}"
    );
}

#[test]
fn a_batch_makes_the_same_files_as_the_changes_one_by_one() {
    // The batch is a way to group changes, never to make different ones.
    let (t1, k1, _) = open();
    let (t2, k2, _) = open();
    let pages = json!({"Pages": 412});
    person(
        &k1,
        vec![schema("books"), note("Dune", &["books"], pages.clone())],
    )
    .unwrap();
    k2.write_tag_schema(
        &Actor::Human,
        "books",
        &json!({
            "properties": [{"key": "Pages", "type": "number"}],
            "views": [{"name": "Table", "type": "table"}]
        }),
        NOW,
    )
    .unwrap();
    k2.batch_as_person(&[note("Dune", &["books"], pages)], None, NOW)
        .unwrap();
    let schema_of = |t: &crate::common::TempVault| {
        fs::read_to_string(t.vault.root().join("tags/books.yaml")).unwrap()
    };
    assert_eq!(schema_of(&t1), schema_of(&t2));
    assert_eq!(k1.list().unwrap().len(), k2.list().unwrap().len());
}
