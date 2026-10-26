//! `edit_page` and `read_page_blocks` through the engine: one commit per call,
//! the guardrails of any page write (locked pages, the size limit, the 40 %
//! rule in each mode), all-or-nothing steps, and a page a person changed since
//! the agent read it.

use crate::common;

use std::fs;

use common::{NOW, dev_vault};
use kasten_core::agent::{AgentOp, Session};
use kasten_core::config_keys::{AgentMode, AgentsConfig};
use kasten_core::history::Actor;
use kasten_core::pages::{Block, BlockRef, PageStep};
use kasten_core::{Error, Kasten, Outcome};
use serde_json::Value;

pub const PAGE: &str = "library/edit-page-test.md";

const BODY: &str = "# Plan\n\nIntro paragraph.\n\n## Tasks\n\n- [ ] first\n- [x] second\n\n## Numbers\n\n| Item | Qty |\n|:-----|----:|\n| apple | 3 |\n| pear | 12 |\n\nClosing words.\n";

pub fn file(front: &str, body: &str) -> String {
    format!(
        "---\ntitle: Edit page test\ntype: page\ncreated: 2026-09-01T10:00:00Z\nupdated: 2026-09-01T10:00:00Z\ncustom:   [a,   b]\n{front}---\n{body}"
    )
}

pub fn open_with(front: &str, body: &str) -> (common::TempVault, Kasten, Session) {
    let t = dev_vault();
    fs::write(t.vault.root().join(PAGE), file(front, body)).unwrap();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k, Session::start("claude-code", NOW))
}

pub fn open() -> (common::TempVault, Kasten, Session) {
    open_with("", BODY)
}

pub fn set_mode(k: &Kasten, mode: AgentMode) {
    let mut config = k.config();
    config.agents = Some(AgentsConfig {
        mode: Some(mode),
        ..AgentsConfig::default()
    });
    k.set_config(config).unwrap();
}

pub fn text(t: &common::TempVault) -> String {
    fs::read_to_string(t.vault.root().join(PAGE)).unwrap()
}

pub fn blocks(k: &Kasten) -> Vec<Block> {
    k.read_page_blocks(PAGE, 1, 1000).unwrap().blocks
}

pub fn r(block: &Block) -> BlockRef {
    BlockRef {
        block: block.id.clone(),
        hash: block.hash.clone(),
    }
}

pub fn edit(steps: Vec<PageStep>) -> AgentOp {
    AgentOp::EditPage {
        path: PAGE.into(),
        steps,
        reason: Some("test".into()),
    }
}

pub fn replace(block: &Block, markdown: &str) -> PageStep {
    PageStep::Replace {
        block: r(block),
        markdown: markdown.into(),
    }
}

pub fn done(outcome: Outcome) -> Value {
    match outcome {
        Outcome::Done { result } => result,
        other => panic!("expected done, got {other:?}"),
    }
}

pub fn refused(result: Result<Outcome, Error>) -> String {
    match result {
        Err(Error::Invalid(why)) => why,
        other => panic!("expected a refusal, got {other:?}"),
    }
}

pub fn commits(k: &Kasten) -> usize {
    k.log(None, 10_000).unwrap().len()
}

#[test]
fn a_page_is_read_as_blocks_with_ids_paths_and_hashes() {
    let (_t, k, _s) = open();
    let page = k.read_page_blocks(PAGE, 1, 1000).unwrap();
    let got: Vec<(String, String)> = page
        .blocks
        .iter()
        .map(|b| {
            let kind = serde_json::to_value(b.kind).unwrap();
            (b.id.clone(), kind.as_str().unwrap().to_owned())
        })
        .collect();
    let want: Vec<(String, String)> = [
        ("b1", "heading"),
        ("b2", "paragraph"),
        ("b3", "heading"),
        ("b4", "todo"),
        ("b5", "heading"),
        ("b6", "table"),
        ("b7", "paragraph"),
    ]
    .iter()
    .map(|(id, kind)| ((*id).to_owned(), (*kind).to_owned()))
    .collect();
    assert_eq!(got, want);
    assert_eq!(page.total, 7);
    assert!(!page.truncated);
    let tasks = &page.blocks[3];
    assert_eq!(tasks.heading_path, ["Plan", "Tasks"]);
    assert_eq!(tasks.todos.len(), 2);
    assert!(!tasks.todos[0].done && tasks.todos[1].done);
    assert_eq!(
        page.blocks[5].table.map(|t| (t.rows, t.columns)),
        Some((3, 2))
    );
    assert!(
        page.blocks
            .iter()
            .all(|b| b.hash.len() == 12 && b.text.chars().count() <= 400)
    );
    // Pages are read in parts: the ids stay those of the whole page.
    let part = k.read_page_blocks(PAGE, 3, 2).unwrap();
    assert_eq!(
        part.blocks
            .iter()
            .map(|b| b.id.as_str())
            .collect::<Vec<_>>(),
        ["b3", "b4"]
    );
    assert!(part.truncated);
    assert!(
        k.read_page_blocks("library/welcome-to-kasten.md", 1, 5)
            .is_ok()
    );
    assert!(k.read_page_blocks("nowhere.md", 1, 5).is_err());
}

#[test]
fn one_call_is_one_commit_made_by_the_agent_and_changes_only_what_it_names() {
    let (t, k, s) = open();
    let before = text(&t);
    let all = blocks(&k);
    let told = done(
        k.agent_run(&s, &edit(vec![replace(&all[1], "Rewritten intro.")]), NOW)
            .unwrap(),
    );
    assert_eq!(told["changed"], true);
    assert_eq!(told["steps"], 1);
    let after = text(&t);
    assert_eq!(
        after.replace("Rewritten intro.", "Intro paragraph."),
        before.replace("updated: 2026-09-01T10:00:00Z", &updated_line(&after))
    );
    assert!(after.contains("custom:   [a,   b]\n"));
    let log = k.log(Some(PAGE), 1).unwrap();
    assert_eq!(log[0].op.as_deref(), Some("edit_page"));
    assert!(log[0].agent);
    assert_eq!(log[0].summary, "page edit: Edit page test");
}

fn updated_line(text: &str) -> String {
    text.lines()
        .find(|l| l.starts_with("updated:"))
        .unwrap()
        .to_owned()
}

#[test]
fn wrapping_two_paragraphs_in_columns_and_filling_a_cell_changes_only_those_bytes() {
    let body = "Lead.\n\nLeft words.\n\nRight words.\n\n| A | B |\n|---|---|\n| 1 |   |\n\nTail.\n";
    let (t, k, s) = open_with("", body);
    let all = blocks(&k);
    done(
        k.agent_run(
            &s,
            &edit(vec![
                PageStep::WrapColumns {
                    blocks: vec![r(&all[1]), r(&all[2])],
                    columns: vec![],
                    ratio: Some("40/60".into()),
                },
                PageStep::TableCells {
                    block: r(&all[3]),
                    cells: vec![(1, 1, "x".into())],
                },
            ]),
            NOW,
        )
        .unwrap(),
    );
    let after = text(&t);
    let got = after.rsplit_once("---\n").unwrap().1;
    assert_eq!(
        got,
        "Lead.\n\n<!-- columns 40/60 -->\n\nLeft words.\n\n<!-- column -->\n\nRight words.\n\n<!-- /columns -->\n\n| A | B |\n|---|---|\n| 1 | x |\n\nTail.\n"
    );
    // Everything before the wrapped paragraphs and after the table row is as it was.
    assert!(got.starts_with("Lead.\n\n"));
    assert!(got.ends_with("|\n\nTail.\n"));
}

#[test]
fn a_step_on_a_block_that_changed_since_it_was_read_refuses_everything_and_writes_nothing() {
    let (t, k, s) = open();
    let all = blocks(&k);
    // A person edits the intro after the agent read the page.
    let note = k.read(PAGE).unwrap();
    let human = note
        .text
        .replace("Intro paragraph.", "Intro, as a person wrote it.");
    k.save_body(
        &Actor::Human,
        PAGE,
        kasten_core::frontmatter::split(&human).body,
        &note.hash,
        NOW,
    )
    .unwrap();
    let kept = text(&t);
    let n = commits(&k);
    let why = refused(k.agent_run(
        &s,
        &edit(vec![replace(&all[6], "Fine."), replace(&all[1], "Stale.")]),
        NOW,
    ));
    assert!(why.contains("changed since"), "{why}");
    assert!(why.contains("Step 2"), "{why}");
    assert_eq!(text(&t), kept, "not even the first step was made");
    assert_eq!(commits(&k), n);
}

#[test]
fn a_change_elsewhere_in_the_page_is_kept_when_the_blocks_named_are_as_they_were() {
    let (t, k, s) = open();
    let all = blocks(&k);
    let note = k.read(PAGE).unwrap();
    let human = note.text.replace("Closing words.", "Closing, by a person.");
    k.save_body(
        &Actor::Human,
        PAGE,
        kasten_core::frontmatter::split(&human).body,
        &note.hash,
        NOW,
    )
    .unwrap();
    done(
        k.agent_run(&s, &edit(vec![replace(&all[1], "Agent intro.")]), NOW)
            .unwrap(),
    );
    let after = text(&t);
    assert!(after.contains("Agent intro.") && after.contains("Closing, by a person."));
}

#[test]
fn a_block_added_above_since_the_read_moves_the_ids_and_refuses_the_edit() {
    let (t, k, s) = open();
    let all = blocks(&k);
    let note = k.read(PAGE).unwrap();
    let human = note
        .text
        .replace("# Plan\n", "# Plan\n\nA new first paragraph.\n");
    k.save_body(
        &Actor::Human,
        PAGE,
        kasten_core::frontmatter::split(&human).body,
        &note.hash,
        NOW,
    )
    .unwrap();
    let kept = text(&t);
    let why = refused(k.agent_run(&s, &edit(vec![replace(&all[6], "Late.")]), NOW));
    assert!(why.contains("changed since"), "{why}");
    assert_eq!(text(&t), kept);
}

#[test]
fn an_edit_that_changes_nothing_makes_no_commit() {
    let (t, k, s) = open();
    let all = blocks(&k);
    let n = commits(&k);
    let before = text(&t);
    let told = done(
        k.agent_run(
            &s,
            &edit(vec![PageStep::SetTodo {
                block: r(&all[3]),
                line: 1,
                done: true,
            }]),
            NOW,
        )
        .unwrap(),
    );
    assert_eq!(told["changed"], false);
    assert_eq!(text(&t), before);
    assert_eq!(commits(&k), n);
}

#[test]
fn undoing_the_session_gives_back_every_byte() {
    let (t, k, s) = open();
    let before = text(&t);
    let all = blocks(&k);
    done(
        k.agent_run(
            &s,
            &edit(vec![
                PageStep::Delete { block: r(&all[1]) },
                PageStep::SetTodo {
                    block: r(&all[3]),
                    line: 0,
                    done: true,
                },
            ]),
            NOW,
        )
        .unwrap(),
    );
    assert_ne!(text(&t), before);
    k.undo_session(&s.id, NOW).unwrap();
    assert_eq!(text(&t), before);
}

#[test]
fn only_markdown_notes_that_are_not_private_can_be_edited() {
    let (_t, k, s) = open();
    let all = blocks(&k);
    for path in [
        "templates/blank.md",
        "library/missing.md",
        "projects/note-taking-study/boards/ideas.canvas",
    ] {
        let op = AgentOp::EditPage {
            path: path.into(),
            steps: vec![replace(&all[0], "x")],
            reason: None,
        };
        assert!(k.agent_run(&s, &op, NOW).is_err(), "{path}");
    }
}

#[test]
fn the_op_is_stored_in_proposals_as_json() {
    let (_t, k, _s) = open();
    let op = edit(vec![replace(&blocks(&k)[1], "x")]);
    let json = serde_json::to_value(&op).unwrap();
    assert_eq!(json["kind"], "edit_page");
    assert_eq!(json["steps"][0]["op"], "replace");
    assert_eq!(serde_json::from_value::<AgentOp>(json).unwrap(), op);
    assert_eq!(op.name(), "edit_page");
    assert_eq!(op.path(), Some(PAGE));
}
