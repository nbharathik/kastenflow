//! The link graph of a real vault: links by title, path, alias and heading,
//! embeds, missing and ambiguous links, boards and decks as nodes, and the
//! three scopes.

use crate::common;

use std::fs;

use common::{NOW, dev_vault};
use kasten_core::graph::{Graph, Scope};
use kasten_core::history::Actor;
use kasten_core::{Kasten, Kind, NewNote};

const A: &str = "library/graph-a.md";
const B: &str = "library/graph-b.md";
const SAME_PHOTOS: &str = "projects/photo-organiser/pages/same-name.md";
const SAME_STUDY: &str = "projects/note-taking-study/pages/same-name.md";
const BOARD: &str = "projects/photo-organiser/boards/brainstorm.canvas";
const DECK: &str = "library/tool-use-in-language-models.deck";
const ROADMAP: &str = "projects/photo-organiser/pages/photo-organiser-roadmap.md";
const SKETCH: &str = "projects/photo-organiser/cards/duplicate-score-sketch.md";
const SCORE: &str = "projects/photo-organiser/cards/duplicate-score-for-photos.md";

/// The dev vault with a few pages added that make every kind of link.
fn vault() -> (common::TempVault, Kasten) {
    let t = dev_vault();
    let write = |path: &str, text: &str| {
        let file = t.vault.root().join(path);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(file, text).unwrap();
    };
    write(
        A,
        "---\ntitle: Graph A\n---\nSee [[Graph B#Intro|the intro]] twice: [[Graph B]].\n\
         A gap: [[Not written yet]], and a day [[2026-09-23]] and one with no page [[2031-01-01]].\n\
         Shared: [[Same name]]. The board [[projects/photo-organiser/boards/brainstorm.canvas]] \
         and a deck ![[library/tool-use-in-language-models.deck]] and a picture ![[assets/x.png]].\n\
         Itself: [[Graph A]].\n",
    );
    write(
        B,
        "---\ntitle: Graph B\n---\n## Intro\nBack to [[Graph A]].\n",
    );
    write(SAME_PHOTOS, "---\ntitle: Same name\n---\nOne.\n");
    write(SAME_STUDY, "---\ntitle: Same name\n---\nTwo.\n");
    let k = Kasten::open(t.vault.root()).unwrap();
    (t, k)
}

fn id(g: &Graph, path: &str) -> u32 {
    g.nodes
        .iter()
        .position(|n| n.id == path)
        .unwrap_or_else(|| {
            panic!(
                "no node {path} in {:?}",
                g.nodes.iter().map(|n| &n.id).collect::<Vec<_>>()
            )
        }) as u32
}

fn edge<'a>(g: &'a Graph, from: &str, to: &str) -> Option<&'a kasten_core::graph::Edge> {
    let (from, to) = (id(g, from), id(g, to));
    g.edges.iter().find(|e| e.from == from && e.to == to)
}

#[test]
fn links_by_title_alias_heading_and_embed_make_edges() {
    let (_t, k) = vault();
    let g = k.graph(&Scope::Vault).unwrap();
    // `[[Graph B#Intro|the intro]]` and `[[Graph B]]` are one edge.
    let ab = edge(&g, A, B).expect("A links B");
    assert!(!ab.embed && !ab.ambiguous);
    assert_eq!(
        g.edges
            .iter()
            .filter(|e| e.from == id(&g, A) && e.to == id(&g, B))
            .count(),
        1
    );
    assert!(edge(&g, B, A).is_some());
    // No edge from a page to itself.
    assert!(g.edges.iter().all(|e| e.from != e.to));
    // The dev vault's own `![[Duplicate score sketch]]` and alias link.
    assert!(edge(&g, SCORE, SKETCH).unwrap().embed);
    assert!(edge(&g, "library/zettelkasten-method.md", SCORE).is_some());
    assert!(edge(&g, "journal/2026/2026-09-23.md", ROADMAP).is_some());
    // Templates are nowhere.
    assert!(g.nodes.iter().all(|n| n.kind != "template"));
    assert!(g.nodes.iter().all(|n| !n.id.starts_with("templates/")));
}

#[test]
fn missing_pages_are_ghosts_and_ambiguous_links_go_to_every_candidate() {
    let (_t, k) = vault();
    let g = k.graph(&Scope::Vault).unwrap();
    let ghost = &g.nodes[id(&g, "ghost:not written yet") as usize];
    assert_eq!(ghost.kind, "ghost");
    assert_eq!(ghost.path, None);
    assert_eq!(ghost.links, 1);
    assert!(edge(&g, A, "ghost:not written yet").is_some());
    // A day with no journal page, a picture and a file that is not here are no ghosts.
    let ghosts: Vec<&str> = g
        .nodes
        .iter()
        .filter(|n| n.kind == "ghost")
        .map(|n| n.id.as_str())
        .collect();
    assert_eq!(ghosts, ["ghost:not written yet"]);
    // Two pages share the title, and A is in neither project.
    for same in [SAME_PHOTOS, SAME_STUDY] {
        assert!(edge(&g, A, same).unwrap().ambiguous, "{same}");
    }
    // The day with a journal page is linked.
    assert!(edge(&g, A, "journal/2026/2026-09-23.md").is_some());
}

#[test]
fn boards_and_decks_are_nodes() {
    let (_t, k) = vault();
    let g = k.graph(&Scope::Vault).unwrap();
    let board = &g.nodes[id(&g, BOARD) as usize];
    assert_eq!(board.kind, "board");
    assert_eq!(board.project.as_deref(), Some("photo-organiser"));
    // The cards it shows.
    assert!(edge(&g, BOARD, SCORE).unwrap().board);
    assert!(edge(&g, BOARD, SKETCH).unwrap().board);
    // A link to the board's file, and an embedded deck.
    assert!(edge(&g, A, BOARD).is_some());
    let deck = &g.nodes[id(&g, DECK) as usize];
    assert_eq!(deck.kind, "deck");
    assert!(!deck.title.is_empty());
    assert!(edge(&g, A, DECK).unwrap().embed);
}

#[test]
fn a_project_marks_the_neighbours_that_are_not_in_it() {
    let (_t, k) = vault();
    let g = k
        .graph(&Scope::Project {
            path: "projects/photo-organiser/_project.md".to_owned(),
        })
        .unwrap();
    assert!(g.nodes.iter().any(|n| n.id == BOARD && !n.outside));
    assert!(g.nodes.iter().any(|n| n.id == ROADMAP && !n.outside));
    for node in &g.nodes {
        let inside = node.project.as_deref() == Some("photo-organiser");
        assert_eq!(node.outside, !inside && node.kind != "ghost", "{}", node.id);
    }
    // Graph A links the board and the journal links the roadmap.
    for outside in [
        A,
        "journal/2026/2026-09-23.md",
        "library/zettelkasten-method.md",
    ] {
        assert!(
            g.nodes.iter().any(|n| n.id == outside && n.outside),
            "{outside}"
        );
    }
    // The other project is not here, and A's other links are not either.
    assert!(
        g.nodes
            .iter()
            .all(|n| n.project.as_deref() != Some("note-taking-study"))
    );
    assert!(g.nodes.iter().all(|n| n.id != B));
    // Every edge touches the project.
    for e in &g.edges {
        let (from, to) = (&g.nodes[e.from as usize], &g.nodes[e.to as usize]);
        assert!(!from.outside || !to.outside);
    }
}

#[test]
fn around_a_page_reaches_its_neighbours_and_their_neighbours() {
    let (_t, k) = vault();
    let around = |depth: u8| {
        k.graph(&Scope::Around {
            path: SCORE.to_owned(),
            depth,
        })
        .unwrap()
    };
    let one = around(1);
    let ids: Vec<&str> = one.nodes.iter().map(|n| n.id.as_str()).collect();
    for near in [
        SCORE,
        SKETCH,
        ROADMAP,
        BOARD,
        "library/zettelkasten-method.md",
    ] {
        assert!(ids.contains(&near), "{near} in {ids:?}");
    }
    assert!(!ids.contains(&B));
    // Two links out reaches Graph A through the board's neighbour, the journal and the project.
    let two = around(2);
    assert!(two.nodes.len() > one.nodes.len());
    assert!(two.nodes.iter().any(|n| n.id == A));
    assert!(around(3).nodes.len() >= two.nodes.len());
}

#[test]
fn a_ghost_becomes_a_node_when_its_page_is_made() {
    let (_t, k) = vault();
    assert!(
        k.graph(&Scope::Vault)
            .unwrap()
            .nodes
            .iter()
            .any(|n| n.id == "ghost:not written yet")
    );
    let note = k
        .create(
            &Actor::Human,
            &NewNote {
                kind: Kind::Page,
                title: "Not written yet".to_owned(),
                date: "2026-10-06".to_owned(),
                project: Some("photo-organiser".to_owned()),
                parent: None,
                template: None,
                icon: None,
            },
            NOW,
        )
        .unwrap();
    let g = k.graph(&Scope::Vault).unwrap();
    assert!(g.nodes.iter().all(|n| n.kind != "ghost"));
    assert!(edge(&g, A, &note.meta.path).is_some());
}

#[test]
fn every_note_outside_templates_is_a_node_linked_or_not() {
    let (_t, k) = vault();
    let g = k.graph(&Scope::Vault).unwrap();
    // Every note outside templates is a node, linked or not.
    let notes = k
        .list()
        .unwrap()
        .into_iter()
        .filter(|n| n.kind != "template")
        .count();
    let files = g
        .nodes
        .iter()
        .filter(|n| matches!(n.kind.as_str(), "board" | "deck" | "diagram" | "ghost"))
        .count();
    assert_eq!(g.nodes.len(), notes + files);
}

#[test]
fn the_graph_reads_only_what_links_need_of_each_note() {
    let (_t, k) = vault();
    let g = k.graph(&Scope::Vault).unwrap();
    // Titles, kinds and projects are those the index holds.
    let listed: Vec<_> = k
        .list()
        .unwrap()
        .into_iter()
        .filter(|n| n.kind != "template")
        .collect();
    for note in listed {
        let node = g
            .nodes
            .iter()
            .find(|n| n.id == note.path)
            .unwrap_or_else(|| panic!("no node for {}", note.path));
        assert_eq!(node.title, note.title, "{}", note.path);
        assert_eq!(node.kind, note.kind, "{}", note.path);
        assert_eq!(node.project, note.project, "{}", note.path);
    }
}
