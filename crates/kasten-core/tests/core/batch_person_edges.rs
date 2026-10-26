//! More attacks on a person's batch: references that follow a rename or a
//! move, JSON that only looks like a reference, and two engines making the
//! schema of one new tag at once.

use std::fs;

use kasten_core::Kasten;
use kasten_core::agent::AgentOp;

use crate::batch_person::{commits, person};
use crate::change_sets::{append, create, open, snapshot};
use crate::common::NOW;

#[test]
fn a_reference_follows_a_rename_and_never_writes_to_a_stale_path() {
    let (t, k, _) = open();
    let ops = vec![
        create("Plain name", "Body."),
        AgentOp::Rename {
            path: "$ref:0".into(),
            title: "Better name".into(),
        },
        append("$ref:0", "After the rename."),
        AgentOp::Tags {
            path: "$ref:0".into(),
            add: vec!["fine".into()],
            remove: vec![],
        },
    ];
    let done = person(&k, ops).unwrap();
    let path = done.results[0]["path"].as_str().unwrap();
    assert!(path.contains("better-name"), "{path}");
    let text = fs::read_to_string(t.vault.root().join(path)).unwrap();
    assert!(
        text.contains("After the rename.") && text.contains("fine"),
        "{text}"
    );
}

#[test]
fn a_reference_to_a_sub_page_after_its_parent_moved_works_or_refuses_the_whole_batch() {
    let (t, k, _) = open();
    let files = snapshot(t.vault.root());
    let mut child = create("Child", "");
    if let AgentOp::CreateNote { parent, .. } = &mut child {
        *parent = Some("$ref:0".into());
    }
    let ops = vec![
        create("Parent", ""),
        child,
        AgentOp::Move {
            path: "$ref:0".into(),
            project: Some("photo-organiser".into()),
        },
        append("$ref:1", "After the parent moved."),
    ];
    match person(&k, ops) {
        Ok(done) => {
            let path = done.results[1]["path"].as_str().unwrap();
            let text = fs::read_to_string(t.vault.root().join(path)).unwrap();
            assert!(text.contains("After the parent moved."), "{path}: {text}");
        }
        Err(err) => {
            assert!(
                err.to_string().contains("Nothing in the batch was changed"),
                "{err}"
            );
            assert_eq!(snapshot(t.vault.root()), files, "nothing written");
        }
    }
}

#[test]
fn json_that_only_looks_like_a_reference_is_refused_and_writes_nothing() {
    let (t, k, _) = open();
    let files = snapshot(t.vault.root());
    let bad = [
        serde_json::json!({"$ref": -1}),
        serde_json::json!({"$ref": "0"}),
        serde_json::json!({"$ref": 1.5}),
        serde_json::json!({"$ref": null}),
        serde_json::json!({"$ref": 0, "extra": 1}),
        serde_json::json!({"$ref": 18_446_744_073_709_551_615u64}),
        serde_json::json!({"ref": 0}),
        serde_json::json!(["$ref:0"]),
    ];
    for path in bad {
        let changes = vec![
            serde_json::json!({"kind": "create_note", "type": "page", "title": "A"}),
            serde_json::json!({"kind": "append", "path": path, "markdown": "x"}),
        ];
        let result = kasten_core::batch::refs::ops_from_json(changes)
            .and_then(|ops| k.batch_as_person(&ops, None, NOW));
        assert!(result.is_err(), "{path}");
        assert_eq!(snapshot(t.vault.root()), files, "{path}");
    }
}

#[test]
fn two_batches_making_the_schema_of_one_new_tag_let_exactly_one_win() {
    let (t, k, _) = open();
    let other = Kasten::open(t.vault.root()).unwrap();
    let before = commits(&k);
    let run = |engine: &Kasten, title: &str| {
        engine.batch_as_person(
            &[crate::batch_person::schema("Racers"), create(title, "")],
            None,
            NOW,
        )
    };
    let (first, second) = std::thread::scope(|scope| {
        let a = scope.spawn(|| run(&k, "From the first"));
        let b = scope.spawn(|| run(&other, "From the second"));
        (a.join().unwrap(), b.join().unwrap())
    });
    assert_eq!(
        usize::from(first.is_ok()) + usize::from(second.is_ok()),
        1,
        "exactly one batch wins: {first:?} / {second:?}"
    );
    let loser = first.err().or(second.err()).unwrap().to_string();
    assert!(loser.contains("already has a schema"), "{loser}");
    assert_eq!(commits(&k), before + 1);
    let titles: Vec<String> = k.list().unwrap().into_iter().map(|n| n.title).collect();
    assert_eq!(
        titles.iter().filter(|t| t.starts_with("From the ")).count(),
        1,
        "only the winner's note exists: {titles:?}"
    );
    assert!(t.vault.root().join("tags/racers.yaml").exists());
    // Capitals make no other tag: the same file.
    let err = k
        .batch_as_person(&[crate::batch_person::schema("RACERS")], None, NOW)
        .unwrap_err()
        .to_string();
    assert!(err.contains("already has a schema"), "{err}");
}
