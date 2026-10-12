//! The graph from hand-made notes and link rows: how links resolve and what
//! becomes a ghost. What each scope keeps is in `scope_tests`.

use super::{FileNode, Graph, Scope, build};
use crate::index::LinkRow;
use crate::note::{NoteMeta, meta_for};

pub(super) fn note(path: &str, title: &str) -> NoteMeta {
    meta_for(path, &format!("---\ntitle: \"{title}\"\n---\n"), 0)
}

pub(super) fn row(from: &str, target: &str) -> LinkRow {
    LinkRow {
        path: from.to_owned(),
        target: target.to_owned(),
        embed: false,
    }
}

fn embed(from: &str, target: &str) -> LinkRow {
    LinkRow {
        embed: true,
        ..row(from, target)
    }
}

pub(super) fn vault() -> Vec<NoteMeta> {
    vec![
        note("library/alpha.md", "Alpha"),
        note("library/beta.md", "Beta"),
        note("projects/trip/pages/plan.md", "Plan"),
        note("projects/trip/cards/idea.md", "Idea"),
        note("projects/work/pages/plan.md", "Plan"),
        note("projects/work/pages/report.md", "Report"),
        note("journal/2026/2026-10-01.md", "2026-10-01"),
        note("templates/page.md", "Page template"),
    ]
}

/// Edges as (from id, to id), sorted.
pub(super) fn pairs(g: &Graph) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = g
        .edges
        .iter()
        .map(|e| {
            (
                g.nodes[e.from as usize].id.clone(),
                g.nodes[e.to as usize].id.clone(),
            )
        })
        .collect();
    out.sort();
    out
}

pub(super) fn ids(g: &Graph) -> Vec<&str> {
    g.nodes.iter().map(|n| n.id.as_str()).collect()
}

pub(super) fn pair(a: &str, b: &str) -> (String, String) {
    (a.to_owned(), b.to_owned())
}

fn whole(rows: &[LinkRow], files: &[FileNode]) -> Graph {
    build(&vault(), rows, files, &Scope::Vault)
}

pub(super) fn board(path: &str, cards: &[&str]) -> FileNode {
    FileNode {
        path: path.to_owned(),
        title: "Map".to_owned(),
        kind: "board".to_owned(),
        project: path.split('/').nth(1).map(str::to_owned),
        cards: cards.iter().map(|c| (*c).to_owned()).collect(),
    }
}

#[test]
fn links_by_title_and_by_path_become_edges() {
    let g = whole(
        &[
            row("library/alpha.md", "beta"),
            row("library/alpha.md", "projects/trip/cards/idea"),
            row("library/beta.md", "projects/work/pages/report.md"),
        ],
        &[],
    );
    assert_eq!(
        pairs(&g),
        [
            pair("library/alpha.md", "library/beta.md"),
            pair("library/alpha.md", "projects/trip/cards/idea.md"),
            pair("library/beta.md", "projects/work/pages/report.md"),
        ]
    );
}

#[test]
fn templates_are_neither_nodes_nor_link_targets() {
    let g = whole(&[row("library/alpha.md", "page template")], &[]);
    assert!(!ids(&g).contains(&"templates/page.md"));
    // The title names no note, so it is a ghost like any other missing page.
    assert_eq!(pairs(&g), [pair("library/alpha.md", "ghost:page template")]);
}

#[test]
fn a_shared_title_goes_to_the_note_in_the_linking_notes_project() {
    let g = whole(
        &[
            row("projects/work/pages/report.md", "plan"),
            row("projects/trip/cards/idea.md", "plan"),
        ],
        &[],
    );
    assert_eq!(
        pairs(&g),
        [
            pair("projects/trip/cards/idea.md", "projects/trip/pages/plan.md"),
            pair(
                "projects/work/pages/report.md",
                "projects/work/pages/plan.md"
            ),
        ]
    );
    assert!(g.edges.iter().all(|e| !e.ambiguous));
}

#[test]
fn a_title_nothing_picks_between_is_flagged_on_every_candidate() {
    let g = whole(&[row("library/alpha.md", "plan")], &[]);
    assert_eq!(
        pairs(&g),
        [
            pair("library/alpha.md", "projects/trip/pages/plan.md"),
            pair("library/alpha.md", "projects/work/pages/plan.md"),
        ]
    );
    assert!(g.edges.iter().all(|e| e.ambiguous));
}

#[test]
fn a_missing_page_is_one_ghost_however_many_notes_link_it() {
    let g = whole(
        &[
            row("library/alpha.md", "nowhere"),
            row("library/beta.md", "nowhere"),
            row("library/beta.md", "other gap"),
        ],
        &[],
    );
    let ghosts: Vec<_> = g.nodes.iter().filter(|n| n.kind == "ghost").collect();
    assert_eq!(
        ghosts.iter().map(|n| n.id.as_str()).collect::<Vec<_>>(),
        ["ghost:nowhere", "ghost:other gap"]
    );
    assert_eq!(ghosts[0].title, "nowhere");
    assert_eq!(ghosts[0].path, None);
    assert_eq!(ghosts[0].links, 2);
    assert_eq!(ghosts[1].links, 1);
    assert_eq!(g.edges.len(), 3);
}

#[test]
fn embeds_are_marked_and_a_link_to_the_same_note_wins() {
    let g = whole(
        &[
            embed("library/alpha.md", "beta"),
            embed("library/alpha.md", "idea"),
            row("library/alpha.md", "idea"),
        ],
        &[],
    );
    let of = |to: &str| {
        let e = g
            .edges
            .iter()
            .find(|e| g.nodes[e.to as usize].title == to)
            .unwrap();
        e.embed
    };
    assert!(of("Beta"));
    assert!(!of("Idea"));
    assert_eq!(g.edges.len(), 2);
}

#[test]
fn a_note_linking_itself_makes_no_edge() {
    let g = whole(&[row("library/alpha.md", "alpha")], &[]);
    assert!(g.edges.is_empty());
}

#[test]
fn a_day_link_goes_to_its_journal_page_and_a_day_without_one_is_no_ghost() {
    let g = whole(
        &[
            row("library/alpha.md", "2026-10-01"),
            row("library/alpha.md", "2026-10-09"),
        ],
        &[],
    );
    assert_eq!(
        pairs(&g),
        [pair("library/alpha.md", "journal/2026/2026-10-01.md")]
    );
    assert!(g.nodes.iter().all(|n| n.kind != "ghost"));
}

#[test]
fn a_board_is_a_node_linked_to_the_notes_it_shows() {
    let files = [board(
        "projects/trip/boards/map.canvas",
        &[
            "projects/trip/cards/idea.md",
            "library/alpha.md",
            "library/gone.md",
            "assets/picture.png",
        ],
    )];
    let g = whole(&[], &files);
    let map = g
        .nodes
        .iter()
        .find(|n| n.id == "projects/trip/boards/map.canvas")
        .unwrap();
    assert_eq!(map.kind, "board");
    assert_eq!(map.title, "Map");
    assert_eq!(map.project.as_deref(), Some("trip"));
    assert_eq!(map.links, 2);
    assert_eq!(
        pairs(&g),
        [
            pair("projects/trip/boards/map.canvas", "library/alpha.md"),
            pair(
                "projects/trip/boards/map.canvas",
                "projects/trip/cards/idea.md"
            ),
        ]
    );
    assert!(g.edges.iter().all(|e| e.board));
}

#[test]
fn a_link_to_a_board_or_deck_file_reaches_its_node_and_other_files_are_no_ghosts() {
    let deck = FileNode {
        path: "library/talk.deck".to_owned(),
        title: "Talk".to_owned(),
        kind: "deck".to_owned(),
        project: None,
        cards: Vec::new(),
    };
    // The board shows the deck as a card.
    let files = [
        board("projects/trip/boards/map.canvas", &["library/talk.deck"]),
        deck,
    ];
    let g = whole(
        &[
            row("library/alpha.md", "projects/trip/boards/map.canvas"),
            embed("library/beta.md", "library/talk.deck"),
            // By file name alone, case aside, when only one file has it.
            row("library/beta.md", "Map.canvas"),
            row("library/alpha.md", "assets/picture.png"),
            row("library/alpha.md", "papers/missing.pdf"),
        ],
        &files,
    );
    assert_eq!(
        pairs(&g),
        [
            pair("library/alpha.md", "projects/trip/boards/map.canvas"),
            pair("library/beta.md", "library/talk.deck"),
            pair("library/beta.md", "projects/trip/boards/map.canvas"),
            pair("projects/trip/boards/map.canvas", "library/talk.deck"),
        ]
    );
    assert!(g.nodes.iter().all(|n| n.kind != "ghost"));
}

#[test]
fn every_node_counts_its_distinct_neighbours() {
    let g = whole(
        &[
            row("library/alpha.md", "beta"),
            row("library/beta.md", "alpha"),
            row("library/alpha.md", "idea"),
        ],
        &[],
    );
    let links = |title: &str| g.nodes.iter().find(|n| n.title == title).unwrap().links;
    assert_eq!(links("Alpha"), 2);
    assert_eq!(links("Beta"), 1);
    assert_eq!(links("Idea"), 1);
    assert_eq!(links("Report"), 0);
}

#[test]
fn the_result_does_not_depend_on_the_order_of_the_rows() {
    let rows = [
        row("library/alpha.md", "beta"),
        row("library/alpha.md", "zed"),
        row("library/beta.md", "yak"),
        row("library/beta.md", "plan"),
    ];
    let mut reversed = rows.to_vec();
    reversed.reverse();
    assert_eq!(whole(&rows, &[]), whole(&reversed, &[]));
}

#[test]
fn the_wire_form_leaves_out_what_is_false() {
    let g = whole(&[row("library/alpha.md", "beta")], &[]);
    let at = |id: &str| g.nodes.iter().position(|n| n.id == id).unwrap();
    let edge = serde_json::to_value(g.edges[0]).unwrap();
    assert_eq!(
        edge,
        serde_json::json!({"from": at("library/alpha.md"), "to": at("library/beta.md")})
    );
    let node = serde_json::to_value(&g.nodes[at("library/alpha.md")]).unwrap();
    assert_eq!(node["id"], "library/alpha.md");
    assert_eq!(node["path"], "library/alpha.md");
    assert_eq!(node["kind"], "page");
    assert!(node.get("outside").is_none());
    let scope: Scope =
        serde_json::from_str(r#"{"kind":"around","path":"a.md","depth":2}"#).unwrap();
    assert_eq!(
        scope,
        Scope::Around {
            path: "a.md".to_owned(),
            depth: 2
        }
    );
    let vault: Scope = serde_json::from_str(r#"{"kind":"vault"}"#).unwrap();
    assert_eq!(vault, Scope::Vault);
}
