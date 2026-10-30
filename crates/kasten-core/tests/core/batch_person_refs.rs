//! A person's batch: changes that name notes an earlier change makes
//! (`{"$ref": n}`), and "Turn into database" as one batch: the tag's schema,
//! a note for each row, and the table in the page replaced by an embed of the
//! database, all one commit that one undo takes back to the byte.

use std::fs;

use kasten_core::Kasten;
use kasten_core::agent::AgentOp;
use kasten_core::history::History;
use kasten_core::pages::{BlockRef, Kind, PageStep};
use serde_json::{Value, json};

use crate::batch_person::{commits, note, person};
use crate::change_sets::{WELCOME, append, create, open, snapshot};
use crate::common::{NOW, TempVault};

const PAGE: &str = "library/reading-list.md";
const TABLE: &str =
    "| Title | Pages | Done |\n| --- | --- | --- |\n| Dune | 412 | yes |\n| Emma | 300 | no |\n";

fn page_text() -> String {
    format!("---\ntitle: Reading list\ntype: page\n---\n# Reading\n\n{TABLE}\nAfter the table.\n")
}

/// The dev vault with the page that holds the table.
fn with_page() -> (TempVault, Kasten) {
    let (t, k, _) = open();
    fs::write(t.vault.root().join(PAGE), page_text()).unwrap();
    k.commit_external().unwrap();
    k.reindex().unwrap();
    (t, k)
}

fn table_block(k: &Kasten) -> BlockRef {
    let blocks = k.read_page_blocks(PAGE, 1, 100).unwrap();
    let table = blocks
        .blocks
        .iter()
        .find(|b| b.kind == Kind::Table)
        .expect("a table");
    assert_eq!(
        (table.table.unwrap().rows, table.table.unwrap().columns),
        (3, 3)
    );
    BlockRef {
        block: table.id.clone(),
        hash: table.hash.clone(),
    }
}

fn replace_table(block: BlockRef, embed: &str) -> AgentOp {
    AgentOp::EditPage {
        path: PAGE.into(),
        steps: vec![PageStep::Replace {
            block,
            markdown: format!("{embed}\n"),
        }],
        reason: None,
    }
}

fn row(title: &str, pages: i64, done: bool) -> AgentOp {
    let mut op = note(title, &["books"], json!({"Pages": pages, "Done": done}));
    if let AgentOp::CreateNote { parent, .. } = &mut op {
        *parent = Some(PAGE.into());
    }
    op
}

fn books_schema() -> AgentOp {
    AgentOp::TagSchema {
        tag: "books".into(),
        schema: json!({
            "properties": [{"key": "Pages", "type": "number"}, {"key": "Done", "type": "checkbox"}],
            "views": [{"name": "Table", "type": "table"}]
        }),
    }
}

#[test]
fn turning_a_table_into_a_database_is_one_commit_and_one_undo_takes_back_every_byte() {
    let (t, k) = with_page();
    let h = History::open(t.vault.root()).unwrap().unwrap();
    let tree = h.tree_id("HEAD").unwrap();
    let files = snapshot(t.vault.root());
    let before = commits(&k);

    let block = table_block(&k);
    let done = person(
        &k,
        vec![
            books_schema(),
            row("Dune", 412, true),
            row("Emma", 300, false),
            replace_table(block, "![[tags/books.yaml#Table]]"),
        ],
    )
    .unwrap();

    assert_eq!(
        commits(&k),
        before + 1,
        "the schema, the notes and the page are one commit"
    );
    let page = fs::read_to_string(t.vault.root().join(PAGE)).unwrap();
    let want = page_text().replace(TABLE, "![[tags/books.yaml#Table]]\n");
    // The page only gained an id in its header (a page with sub-pages has one); the body is the old one with the table swapped.
    assert!(
        page.ends_with("# Reading\n\n![[tags/books.yaml#Table]]\n\nAfter the table.\n"),
        "{page}"
    );
    assert_eq!(
        page.rsplit_once("---\n").unwrap().1,
        want.rsplit_once("---\n").unwrap().1,
        "every other byte of the body is as it was"
    );
    assert!(t.vault.root().join("tags/books.yaml").exists());
    let dune = k.read(done.results[1]["path"].as_str().unwrap()).unwrap();
    assert!(
        dune.text.contains("Pages: 412") && dune.text.contains("Done: true"),
        "{}",
        dune.text
    );
    assert!(dune.meta.parent.is_some(), "a sub-page of the page");
    let rows = k
        .list()
        .unwrap()
        .iter()
        .filter(|n| n.tags.iter().any(|t| t == "books"))
        .count();
    assert_eq!(rows, 2);

    let undone = k.undo_commit(done.commit.as_deref().unwrap(), NOW).unwrap();
    assert!(undone.conflict.is_none());
    assert_eq!(
        h.tree_id("HEAD").unwrap(),
        tree,
        "the tree is the one before"
    );
    assert_eq!(snapshot(t.vault.root()), files, "every file, byte for byte");
}

#[test]
fn a_table_that_changed_since_it_was_read_refuses_the_whole_database() {
    let (t, k) = with_page();
    let block = table_block(&k);
    // Someone adds a row after the blocks were read.
    let edited = page_text().replace(
        "| Emma | 300 | no |\n",
        "| Emma | 300 | no |\n| Kim | 120 | yes |\n",
    );
    fs::write(t.vault.root().join(PAGE), edited).unwrap();
    k.commit_external().unwrap();
    k.reindex().unwrap();
    let files = snapshot(t.vault.root());
    let before = commits(&k);
    let err = person(
        &k,
        vec![
            books_schema(),
            row("Dune", 412, true),
            replace_table(block, "![[tags/books.yaml#Table]]"),
        ],
    )
    .unwrap_err()
    .to_string();
    assert!(
        err.contains("Change 3 of 3 (edit_page)") && err.contains("changed since you read it"),
        "{err}"
    );
    assert_eq!(
        snapshot(t.vault.root()),
        files,
        "no schema, no note, the page as it was"
    );
    assert_eq!(commits(&k), before);
}

#[test]
fn a_second_page_edit_whose_ids_moved_refuses_the_batch() {
    // Block ids are those of the page before the batch: after one edit that
    // takes a block out, the second edit's ids no longer match.
    let (t, k) = with_page();
    let blocks = k.read_page_blocks(PAGE, 1, 100).unwrap();
    let heading = &blocks.blocks[0];
    let table = table_block(&k);
    let files = snapshot(t.vault.root());
    let del = AgentOp::EditPage {
        path: PAGE.into(),
        steps: vec![PageStep::Delete {
            block: BlockRef {
                block: heading.id.clone(),
                hash: heading.hash.clone(),
            },
        }],
        reason: None,
    };
    let err = person(
        &k,
        vec![del, replace_table(table, "![[tags/books.yaml#Table]]")],
    )
    .unwrap_err()
    .to_string();
    assert!(err.contains("Change 2 of 2 (edit_page)"), "{err}");
    assert_eq!(snapshot(t.vault.root()), files);
}

#[test]
fn a_later_change_can_name_a_note_an_earlier_one_makes() {
    let (t, k, _) = open();
    let before = commits(&k);
    let named = |n: usize| format!("$ref:{n}");
    let ops = vec![
        create("Parent page", "Body."),
        create("Child page", "Body."),
        AgentOp::SetParent {
            path: named(1),
            parent: Some(named(0)),
        },
        AgentOp::UpdateProps {
            path: named(1),
            props: json!({"stage": "draft"}).as_object().unwrap().clone(),
        },
        AgentOp::Tags {
            path: named(0),
            add: vec!["made".into()],
            remove: vec![],
        },
        AgentOp::Append {
            path: named(1),
            markdown: "Added.".into(),
            heading: None,
        },
    ];
    let done = person(&k, ops).unwrap();
    assert_eq!(commits(&k), before + 1);
    let parent = k.read(done.results[0]["path"].as_str().unwrap()).unwrap();
    let child = k.read(done.results[1]["path"].as_str().unwrap()).unwrap();
    assert_eq!(
        child.meta.parent, parent.meta.id,
        "the child is inside the parent"
    );
    assert!(
        child.text.contains("stage: draft") && child.text.contains("Added."),
        "{}",
        child.text
    );
    assert!(parent.meta.tags.contains(&"made".to_owned()));
    // One undo takes everything back.
    k.undo_commit(done.commit.as_deref().unwrap(), NOW).unwrap();
    assert!(
        k.list()
            .unwrap()
            .iter()
            .all(|n| n.title != "Child page" && n.title != "Parent page")
    );
    assert!(
        !t.vault
            .root()
            .join(done.results[0]["path"].as_str().unwrap())
            .exists()
    );
}

#[test]
fn a_reference_follows_a_note_the_batch_moved() {
    let (t, k, _) = open();
    let mut inside = create("In a project", "Body.");
    if let AgentOp::CreateNote { project, .. } = &mut inside {
        *project = Some("photo-organiser".into());
    }
    let ops = vec![
        inside,
        create("In the library", "Body."),
        // Puts the library page inside the project page: it moves to the project.
        AgentOp::SetParent {
            path: "$ref:1".into(),
            parent: Some("$ref:0".into()),
        },
        AgentOp::Append {
            path: "$ref:1".into(),
            markdown: "After the move.".into(),
            heading: None,
        },
    ];
    let done = person(&k, ops).unwrap();
    let moved = done.results[1]["path"].as_str().unwrap();
    assert!(
        moved.starts_with("projects/photo-organiser/"),
        "the answer tells where it ended up: {moved}"
    );
    assert!(
        fs::read_to_string(t.vault.root().join(moved))
            .unwrap()
            .contains("After the move.")
    );
}

#[test]
fn references_that_cannot_be_followed_refuse_the_batch_and_write_nothing() {
    let (t, k, _) = open();
    let files = snapshot(t.vault.root());
    let props = |path: &str| AgentOp::UpdateProps {
        path: path.into(),
        props: serde_json::Map::new(),
    };
    let cases: Vec<(Vec<AgentOp>, &str)> = vec![
        (
            vec![create("A", ""), props("$ref:1")],
            "only name one before it",
        ),
        (
            vec![props("$ref:0"), create("A", "")],
            "only name one before it",
        ),
        (vec![create("A", ""), props("$ref:9")], "names change 10"),
        (
            vec![append(WELCOME, "x"), props("$ref:0")],
            "does not make a note",
        ),
        (
            vec![create("A", ""), props("$ref:x")],
            "not a note made by an earlier change",
        ),
        (
            vec![create("A", ""), props("$ref:-1")],
            "not a note made by an earlier change",
        ),
    ];
    for (ops, said) in cases {
        let err = person(&k, ops).unwrap_err().to_string();
        assert!(
            err.contains(said) && err.contains("Nothing in the batch was changed"),
            "{said}: {err}"
        );
        assert_eq!(snapshot(t.vault.root()), files);
    }
}

#[test]
fn an_agents_batch_cannot_name_a_note_the_batch_makes() {
    let (t, k, s) = open();
    let files = snapshot(t.vault.root());
    let batch = AgentOp::Batch {
        ops: vec![
            create("A", ""),
            AgentOp::Append {
                path: "$ref:0".into(),
                markdown: "x".into(),
                heading: None,
            },
        ],
        reason: None,
    };
    let err = k.agent_run(&s, &batch, NOW).unwrap_err().to_string();
    assert!(
        err.contains("cannot name a note made by an earlier change"),
        "{err}"
    );
    assert_eq!(snapshot(t.vault.root()), files);
}

#[test]
fn changes_are_read_from_the_json_the_app_sends() {
    let (_t, k, _) = open();
    let changes: Vec<Value> = vec![
        json!({"kind": "create_note", "type": "page", "title": "From JSON", "tags": ["x"]}),
        json!({"kind": "update_props", "path": {"$ref": 0}, "props": {"rating": 3}}),
    ];
    let ops = kasten_core::batch::refs::ops_from_json(changes).unwrap();
    let done = k.batch_as_person(&ops, None, NOW).unwrap();
    let made = k.read(done.results[0]["path"].as_str().unwrap()).unwrap();
    assert!(made.text.contains("rating: 3"), "{}", made.text);
}
