//! Boards through the engine: agents build them as commits, people edit
//! them in batches committed after a pause, cards follow notes that are
//! renamed or moved, and trashing a board waits for review.

use crate::common;

use std::fs;

use common::{NOW, dev_vault};
use kasten_core::agent::{AgentOp, Session};
use kasten_core::board::BoardChange;
use kasten_core::history::Actor;
use kasten_core::{Kasten, Outcome};

const BRAINSTORM: &str = "projects/photo-organiser/boards/brainstorm.canvas";
const SKETCH: &str = "projects/photo-organiser/cards/duplicate-score-sketch.md";
const ZETTEL: &str = "library/zettelkasten-method.md";

fn open() -> (common::TempVault, Kasten) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k)
}

fn done(outcome: Outcome) -> serde_json::Value {
    match outcome {
        Outcome::Done { result } => result,
        other => panic!("expected done, got {other:?}"),
    }
}

#[test]
fn an_agent_builds_a_board() {
    let (_t, k) = open();
    let s = Session::start("claude-code", NOW);
    let board = done(
        k.agent_run(
            &s,
            &AgentOp::CreateBoard {
                title: "Trip ideas".into(),
                project: None,
            },
            NOW,
        )
        .unwrap(),
    );
    let board = board["board"].as_str().unwrap().to_owned();
    assert_eq!(board, "library/trip-ideas.canvas");
    let mut cards = Vec::new();
    for idea in ["Old town walk", "Night train", "Spa day"] {
        let made = done(
            k.agent_run(
                &s,
                &AgentOp::Capture {
                    markdown: idea.into(),
                    tags: vec!["trip".into()],
                },
                NOW,
            )
            .unwrap(),
        );
        cards.push(made["path"].as_str().unwrap().to_owned());
    }
    let added = done(
        k.agent_run(
            &s,
            &AgentOp::AddToBoard {
                board: board.clone(),
                notes: cards.clone(),
                layout: Some("cluster_by_tag".into()),
                positions: None,
            },
            NOW,
        )
        .unwrap(),
    );
    assert_eq!(added["nodes"].as_array().unwrap().len(), 3);
    assert_eq!(added["groups"].as_array().unwrap().len(), 1);
    let edge = done(
        k.agent_run(
            &s,
            &AgentOp::Connect {
                board: board.clone(),
                from: "Old town walk".into(),
                to: "Night train".into(),
                label: Some("then".into()),
            },
            NOW,
        )
        .unwrap(),
    );
    assert!(edge["edge"].is_string());
    done(
        k.agent_run(
            &s,
            &AgentOp::Group {
                board: board.clone(),
                nodes: vec!["Night train".into(), "Spa day".into()],
                label: "Week two".into(),
            },
            NOW,
        )
        .unwrap(),
    );

    let view = k.board(&board).unwrap();
    assert_eq!(view.title, "Trip ideas");
    let titles: Vec<_> = view.nodes.iter().filter_map(|n| n.title.clone()).collect();
    assert!(titles.contains(&"Night train".to_owned()), "{titles:?}");
    assert_eq!(view.edges[0].label.as_deref(), Some("then"));
    assert!(
        view.nodes
            .iter()
            .any(|n| n.label.as_deref() == Some("Week two"))
    );
    let summaries: Vec<String> = k
        .log(Some(&board), 10)
        .unwrap()
        .into_iter()
        .map(|c| c.summary)
        .collect();
    assert_eq!(summaries[0], "board: section Week two on Trip ideas");
    assert!(summaries.iter().any(|m| m == "board: create Trip ideas"));
    assert_eq!(k.resolve_board("trip ideas").unwrap(), board);
    assert!(
        k.boards()
            .unwrap()
            .iter()
            .any(|b| b.path == BRAINSTORM && b.project.as_deref() == Some("photo-organiser"))
    );

    // Trashing a board always waits for review.
    let outcome = k
        .agent_run(
            &s,
            &AgentOp::Trash {
                path: board.clone(),
                reason: None,
            },
            NOW,
        )
        .unwrap();
    assert!(
        matches!(outcome, Outcome::PendingReview { .. }),
        "{outcome:?}"
    );
    let err = k
        .agent_run(
            &s,
            &AgentOp::Connect {
                board: board.clone(),
                from: "Nowhere".into(),
                to: "Night train".into(),
                label: None,
            },
            NOW,
        )
        .unwrap_err();
    assert!(err.to_string().contains("Nowhere"), "{err}");
}

#[test]
fn cards_follow_notes_that_are_renamed_or_moved() {
    let (_t, k) = open();
    let renamed = k
        .rename(&Actor::Human, SKETCH, "Metric sketch", NOW)
        .unwrap();
    let path = renamed.note.meta.path.clone();
    assert_eq!(path, "projects/photo-organiser/cards/metric-sketch.md");
    let view = k.board(BRAINSTORM).unwrap();
    assert!(
        view.nodes
            .iter()
            .any(|n| n.file.as_deref() == Some(path.as_str())
                && n.title.as_deref() == Some("Metric sketch"))
    );
    // The board changed in the rename's own commit.
    let last = &k.log(None, 1).unwrap()[0];
    assert!(last.summary.starts_with("rename: "));
    assert_eq!(k.log(Some(BRAINSTORM), 1).unwrap()[0].id, last.id);

    let moved = k.move_note(&Actor::Human, &path, None).unwrap();
    assert_eq!(moved.meta.path, "library/metric-sketch.md");
    let view = k.board(BRAINSTORM).unwrap();
    assert!(
        view.nodes
            .iter()
            .any(|n| n.file.as_deref() == Some("library/metric-sketch.md"))
    );
}

#[test]
fn a_person_edits_a_board_in_batches_committed_after_a_pause() {
    let (t, k) = open();
    let commits = k.log(None, 500).unwrap().len();
    let applied = k
        .board_apply(
            &Actor::Human,
            BRAINSTORM,
            &[
                BoardChange::Place {
                    id: "n1".into(),
                    x: 40,
                    y: 20,
                    width: Some(360),
                    height: None,
                },
                BoardChange::Sticky {
                    text: "Ask Lena".into(),
                    x: 0,
                    y: 500,
                },
                BoardChange::Card {
                    path: ZETTEL.into(),
                    x: 400,
                    y: 500,
                    width: None,
                    height: None,
                },
                BoardChange::Edge {
                    id: "e1".into(),
                    label: None,
                    color: Some("5".into()),
                    from_end: None,
                    to_end: Some("none".into()),
                    from_side: None,
                    to_side: None,
                },
            ],
            NOW,
        )
        .unwrap();
    assert_eq!(applied.made.len(), 2, "a sticky and a card");
    let node = |id: &str| {
        applied
            .board
            .nodes
            .iter()
            .find(|n| n.id == id)
            .unwrap()
            .clone()
    };
    let moved = node("n1");
    assert_eq!(
        (moved.x, moved.y, moved.width, moved.height),
        (40, 20, 360, 180)
    );
    assert_eq!(
        node(&applied.made[1]).title.as_deref(),
        Some("Zettelkasten method")
    );
    assert_eq!(applied.board.edges[0].to_end.as_deref(), Some("none"));
    assert_eq!(k.board(BRAINSTORM).unwrap(), applied.board);

    // Written at once, committed after a pause, like typing.
    assert_eq!(k.pending_edits(), [BRAINSTORM]);
    assert_eq!(k.log(None, 500).unwrap().len(), commits);
    k.commit_edits().unwrap();
    let last = &k.log(None, 1).unwrap()[0];
    assert_eq!(last.summary, "edit: brainstorm");
    assert!(!last.agent);

    // A refused batch writes nothing.
    let file = t.vault.root().join(BRAINSTORM);
    let text = fs::read_to_string(&file).unwrap();
    let place = |id: &str| BoardChange::Place {
        id: id.into(),
        x: 0,
        y: 0,
        width: None,
        height: None,
    };
    assert!(
        k.board_apply(
            &Actor::Human,
            BRAINSTORM,
            &[place("n1"), place("nope")],
            NOW
        )
        .is_err()
    );
    let missing = BoardChange::Card {
        path: "library/nothing.md".into(),
        x: 0,
        y: 0,
        width: None,
        height: None,
    };
    assert!(
        k.board_apply(&Actor::Human, BRAINSTORM, &[missing], NOW)
            .is_err()
    );
    assert_eq!(fs::read_to_string(&file).unwrap(), text);

    // Taking a card off the board leaves its note.
    k.board_apply(
        &Actor::Human,
        BRAINSTORM,
        &[BoardChange::Remove {
            ids: vec!["n2".into()],
        }],
        NOW,
    )
    .unwrap();
    assert!(t.vault.root().join(SKETCH).is_file());
    assert!(k.board(BRAINSTORM).unwrap().edges.is_empty());
}

#[test]
fn nested_boards_on_a_board_are_titled_not_missing() {
    let (_t, k) = open();
    let nested = k
        .create_board(
            &Actor::Human,
            "Metric details",
            Some("photo-organiser"),
            NOW,
        )
        .unwrap();
    let card = BoardChange::Card {
        path: nested.clone(),
        x: 0,
        y: 600,
        width: None,
        height: None,
    };
    let applied = k
        .board_apply(&Actor::Human, BRAINSTORM, &[card], NOW)
        .unwrap();
    let node = applied
        .board
        .nodes
        .iter()
        .find(|n| n.id == applied.made[0])
        .unwrap();
    assert_eq!(node.file.as_deref(), Some(nested.as_str()));
    assert_eq!(node.title.as_deref(), Some("Metric details"));
    assert!(!node.missing);
    assert_eq!(k.board(BRAINSTORM).unwrap(), applied.board);
}

#[test]
fn lists_the_boards_a_note_is_on() {
    let (_t, k) = open();
    let on = |path: &str| -> Vec<String> {
        k.boards_with(path)
            .unwrap()
            .into_iter()
            .map(|b| b.path)
            .collect()
    };
    assert_eq!(on(SKETCH), [BRAINSTORM]);
    assert!(on(ZETTEL).is_empty());
    let other = k.create_board(&Actor::Human, "Reading", None, NOW).unwrap();
    let card = BoardChange::Card {
        path: SKETCH.into(),
        x: 0,
        y: 0,
        width: None,
        height: None,
    };
    k.board_apply(&Actor::Human, &other, &[card], NOW).unwrap();
    assert_eq!(
        on(SKETCH),
        [BRAINSTORM, other.as_str()],
        "sorted by title: brainstorm, Reading"
    );
}

#[test]
fn the_list_names_the_page_a_board_is_a_map_of() {
    let (_t, k) = open();
    let map = k
        .create_board(&Actor::Human, "Plan map", Some("photo-organiser"), NOW)
        .unwrap();
    let source = serde_json::json!({"page": "01J8ZQ6K3V", "branches": {}});
    let applied = k
        .board_apply(
            &Actor::Human,
            &map,
            &[BoardChange::Source {
                source: Some(source.clone()),
            }],
            NOW,
        )
        .unwrap();
    assert_eq!(applied.board.source, Some(source.clone()));
    assert_eq!(k.board(&map).unwrap().source, Some(source));
    let sources: Vec<_> = k
        .boards()
        .unwrap()
        .into_iter()
        .map(|b| (b.path, b.source))
        .collect();
    assert!(sources.contains(&(map.clone(), Some("01J8ZQ6K3V".to_owned()))));
    assert!(
        sources.contains(&(BRAINSTORM.to_owned(), None)),
        "{sources:?}"
    );

    // Other edits leave it alone, and a bad one is refused whole.
    k.board_apply(
        &Actor::Human,
        &map,
        &[BoardChange::Sticky {
            text: "Mine".into(),
            x: 0,
            y: 0,
        }],
        NOW,
    )
    .unwrap();
    assert_eq!(
        k.boards()
            .unwrap()
            .iter()
            .find(|b| b.path == map)
            .and_then(|b| b.source.clone()),
        Some("01J8ZQ6K3V".to_owned())
    );
    let refused = k.board_apply(
        &Actor::Human,
        &map,
        &[BoardChange::Source {
            source: Some(serde_json::json!({"page": ""})),
        }],
        NOW,
    );
    assert!(refused.is_err());
    assert_eq!(k.board(&map).unwrap().nodes.len(), 1);
}

#[test]
fn a_trashed_board_comes_back_as_a_commit() {
    let (_t, k) = open();
    let trashed = k.trash(&Actor::Human, BRAINSTORM, NOW).unwrap();
    assert!(k.boards().unwrap().iter().all(|b| b.path != BRAINSTORM));
    let back = k.restore_board(&Actor::Human, &trashed).unwrap();
    assert_eq!(back, BRAINSTORM);
    assert_eq!(k.board(BRAINSTORM).unwrap().nodes.len(), 4);
    assert_eq!(k.log(None, 1).unwrap()[0].summary, "restore: brainstorm");
}
