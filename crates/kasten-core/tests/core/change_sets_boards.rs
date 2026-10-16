//! Change sets with whiteboards and diagrams: edits to a board are what the
//! real ops make, a board or diagram made in the set can be changed again, and
//! a drawing or board changed meanwhile makes the set stale.

use kasten_core::agent::{AgentOp, ApplyOutcome};
use kasten_core::board::BoardView;
use kasten_core::history::Actor;
use kasten_core::{Kasten, Outcome};

use crate::change_sets::{DRAFT, WELCOME, open, stage};
use crate::common::NOW;

const BOARD: &str = "projects/photo-organiser/boards/brainstorm.canvas";

/// A board without its ids, which are drawn at random: what is on it and where.
fn shape(view: &BoardView) -> (Vec<String>, Vec<String>) {
    let key = |id: &str| {
        view.nodes
            .iter()
            .find(|n| n.id == id)
            .map(|n| {
                let what = n.file.clone().or(n.label.clone()).or(n.text.clone());
                format!("{} {}", n.kind, what.unwrap_or_default())
            })
            .unwrap_or_default()
    };
    let mut nodes: Vec<String> = view
        .nodes
        .iter()
        .map(|n| format!("{} at {},{} {}x{}", key(&n.id), n.x, n.y, n.width, n.height))
        .collect();
    let mut edges: Vec<String> = view
        .edges
        .iter()
        .map(|e| format!("{} -> {} {:?}", key(&e.from), key(&e.to), e.label))
        .collect();
    nodes.sort();
    edges.sort();
    (nodes, edges)
}

fn applied(k: &Kasten, set: &kasten_core::agent::ChangeSet) -> Vec<String> {
    match k.apply_changes(set, "Ada", NOW).unwrap() {
        ApplyOutcome::Applied { paths, .. } => paths,
        stale => panic!("expected it to apply, got {stale:?}"),
    }
}

fn ops() -> Vec<AgentOp> {
    vec![
        AgentOp::AddToBoard {
            board: BOARD.into(),
            notes: vec![WELCOME.into(), DRAFT.into()],
            layout: Some("grid".into()),
            positions: None,
        },
        AgentOp::Connect {
            board: BOARD.into(),
            from: "Welcome to KastenFlow".into(),
            to: "Metric".into(),
            label: Some("leads to".into()),
        },
        AgentOp::Group {
            board: BOARD.into(),
            nodes: vec!["Welcome to KastenFlow".into()],
            label: "Intro".into(),
        },
    ]
}

#[test]
fn what_is_staged_for_a_board_is_what_the_ops_make() {
    let (_a, direct, ds) = open();
    let (_b, staging, ss) = open();
    let mut set = staging.begin_changes(&ss, NOW);
    for op in ops() {
        stage(&staging, &mut set, &ss, &op);
        assert!(matches!(
            direct.agent_run(&ds, &op, NOW).unwrap(),
            Outcome::Done { .. }
        ));
    }
    assert_eq!(set.files.len(), 1);
    assert_eq!(
        shape(&staging.board_in(&set, BOARD).unwrap()),
        shape(&direct.board(BOARD).unwrap())
    );
    // The vault's board is as it was.
    assert_eq!(staging.board(BOARD).unwrap().nodes.len(), 4);
    assert_eq!(staging.board_in(&set, BOARD).unwrap().nodes.len(), 7);
}

#[test]
fn a_board_made_in_the_set_can_be_filled_before_it_is_applied() {
    let (t, k, s) = open();
    let mut set = k.begin_changes(&s, NOW);
    let made = stage(
        &k,
        &mut set,
        &s,
        &AgentOp::CreateBoard {
            title: "Plan board".into(),
            project: None,
        },
    );
    let path = made["board"].as_str().unwrap().to_owned();
    assert_eq!(k.resolve_board_staged(&set, "Plan board").unwrap(), path);
    stage(
        &k,
        &mut set,
        &s,
        &AgentOp::AddToBoard {
            board: path.clone(),
            notes: vec![WELCOME.into()],
            layout: None,
            positions: None,
        },
    );
    assert_eq!(set.created_files.len(), 1, "one new board");
    assert!(k.board(&path).is_err(), "not in the vault yet");
    assert_eq!(k.board_in(&set, &path).unwrap().nodes.len(), 1);
    let paths = applied(&k, &set);
    assert_eq!(paths, std::slice::from_ref(&path));
    assert_eq!(k.board(&path).unwrap().nodes.len(), 1);
    assert!(t.vault.root().join(&path).is_file());
}

#[test]
fn a_card_for_a_note_only_the_set_has_is_refused() {
    let (_t, k, s) = open();
    let mut set = k.begin_changes(&s, NOW);
    let note = stage(
        &k,
        &mut set,
        &s,
        &crate::change_sets::create("Only staged", "x"),
    );
    let err = k
        .stage(
            &mut set,
            &s,
            &AgentOp::AddToBoard {
                board: BOARD.into(),
                notes: vec![note["path"].as_str().unwrap().into()],
                layout: None,
                positions: None,
            },
            NOW,
        )
        .unwrap_err()
        .to_string();
    assert!(err.contains("only in the staged changes"), "{err}");
}

#[test]
fn a_board_changed_meanwhile_makes_the_set_stale() {
    let (_t, k, s) = open();
    let mut set = k.begin_changes(&s, NOW);
    stage(&k, &mut set, &s, &ops()[0]);
    stage(
        &k,
        &mut set,
        &s,
        &crate::change_sets::append(WELCOME, "also here"),
    );
    // A person puts a sticky on the board meanwhile.
    k.add_sticky(&Actor::Human, BOARD, "Mine", None, NOW)
        .unwrap();
    match k.apply_changes(&set, "Ada", NOW).unwrap() {
        ApplyOutcome::Stale { files } => assert_eq!(files, [BOARD]),
        other => panic!("expected stale, got {other:?}"),
    }
    assert!(!k.read(WELCOME).unwrap().text.contains("also here"));
    // Recalculating plans the same cards on the board as it is now.
    let (fresh, dropped) = k.rebase_changes(&set, NOW).unwrap();
    assert!(dropped.is_empty());
    applied(&k, &fresh);
    let board = k.board(BOARD).unwrap();
    assert!(
        board
            .nodes
            .iter()
            .any(|n| n.text.as_deref() == Some("Mine"))
    );
    assert!(
        board
            .nodes
            .iter()
            .any(|n| n.file.as_deref() == Some(WELCOME))
    );
}

const XML: &str = "<mxfile host=\"test\">\n  <diagram id=\"p1\" name=\"Page-1\">\n    <mxGraphModel>\n      <root>\n        <mxCell id=\"0\" />\n        <mxCell id=\"1\" parent=\"0\" />\n        <mxCell id=\"a\" value=\"A\" vertex=\"1\" parent=\"1\" />\n      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>\n";

fn more(cell: &str) -> String {
    XML.replace(
        "      </root>",
        &format!("        <mxCell id=\"{cell}\" value=\"{cell}\" vertex=\"1\" parent=\"1\" />\n      </root>"),
    )
}

#[test]
fn a_diagram_made_in_the_set_is_rewritten_before_it_is_applied() {
    let (t, k, s) = open();
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
    assert_eq!(k.resolve_diagram_staged(&set, "Flow").unwrap(), path);
    assert_eq!(k.diagram_in(&set, &path).unwrap().xml, XML);
    stage(
        &k,
        &mut set,
        &s,
        &AgentOp::UpdateDiagram {
            path: path.clone(),
            xml: more("b"),
            base: XML.into(),
            reason: None,
        },
    );
    assert_eq!(set.created_files.len(), 1);
    assert!(k.diagram(&path).is_err());
    assert_eq!(applied(&k, &set), std::slice::from_ref(&path));
    assert_eq!(k.diagram(&path).unwrap().xml, more("b"));
    assert!(t.vault.root().join(&path).is_file());
}

#[test]
fn a_diagram_a_person_redrew_meanwhile_makes_the_set_stale() {
    let (_t, k, s) = open();
    let path = k
        .create_diagram(&Actor::Human, "Flow", None, Some(XML), NOW)
        .unwrap();
    let mut set = k.begin_changes(&s, NOW);
    stage(
        &k,
        &mut set,
        &s,
        &AgentOp::UpdateDiagram {
            path: path.clone(),
            xml: more("b"),
            base: XML.into(),
            reason: None,
        },
    );
    let hash = kasten_core::content_hash(XML);
    k.save_diagram(&Actor::Human, &path, &more("c"), None, &hash, NOW)
        .unwrap();
    match k.apply_changes(&set, "Ada", NOW).unwrap() {
        ApplyOutcome::Stale { files } => assert_eq!(files, std::slice::from_ref(&path)),
        other => panic!("expected stale, got {other:?}"),
    }
    assert_eq!(k.diagram(&path).unwrap().xml, more("c"));
}
