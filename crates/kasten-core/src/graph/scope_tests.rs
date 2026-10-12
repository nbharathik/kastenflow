//! What each scope keeps: a project and its outside neighbours, and the pages
//! within a few links of one page.

use super::tests::{board, ids, note, pair, pairs, row, vault};
use super::{Scope, build};
use crate::index::LinkRow;
use crate::note::NoteMeta;

#[test]
fn a_project_keeps_its_notes_and_marks_the_neighbours_outside() {
    let rows = [
        row("library/alpha.md", "idea"),
        row("projects/trip/pages/plan.md", "beta"),
        row("projects/trip/cards/idea.md", "missing idea"),
        row("library/alpha.md", "beta"),
        row("projects/work/pages/report.md", "alpha"),
    ];
    let g = build(
        &vault(),
        &rows,
        &[],
        &Scope::Project {
            path: "projects/trip/_project.md".to_owned(),
        },
    );
    assert_eq!(
        ids(&g),
        [
            "library/alpha.md",
            "library/beta.md",
            "projects/trip/cards/idea.md",
            "projects/trip/pages/plan.md",
            "ghost:missing idea",
        ]
    );
    let outside: Vec<&str> = g
        .nodes
        .iter()
        .filter(|n| n.outside)
        .map(|n| n.id.as_str())
        .collect();
    assert_eq!(outside, ["library/alpha.md", "library/beta.md"]);
    // Alpha to Beta joins two outsiders: it is not the project's.
    assert_eq!(
        pairs(&g),
        [
            pair("library/alpha.md", "projects/trip/cards/idea.md"),
            pair("projects/trip/cards/idea.md", "ghost:missing idea"),
            pair("projects/trip/pages/plan.md", "library/beta.md"),
        ]
    );
    // The folder, or its name, says the same.
    for path in ["projects/trip", "trip"] {
        let same = build(
            &vault(),
            &rows,
            &[],
            &Scope::Project {
                path: path.to_owned(),
            },
        );
        assert_eq!(same, g, "{path}");
    }
}

#[test]
fn a_project_with_no_links_still_lists_its_notes_and_boards() {
    let files = [board("projects/trip/boards/map.canvas", &[])];
    let g = build(
        &vault(),
        &[],
        &files,
        &Scope::Project {
            path: "trip".to_owned(),
        },
    );
    // Notes come first, then boards and decks.
    assert_eq!(
        ids(&g),
        [
            "projects/trip/cards/idea.md",
            "projects/trip/pages/plan.md",
            "projects/trip/boards/map.canvas",
        ]
    );
    assert!(g.nodes.iter().all(|n| !n.outside));
}

fn chain() -> (Vec<NoteMeta>, Vec<LinkRow>) {
    let notes = ["a", "b", "c", "d", "e"]
        .iter()
        .map(|t| note(&format!("library/{t}.md"), t))
        .collect();
    let rows = vec![
        row("library/a.md", "b"),
        row("library/b.md", "c"),
        row("library/d.md", "c"),
        row("library/d.md", "e"),
    ];
    (notes, rows)
}

fn around(depth: u8) -> Vec<String> {
    let (notes, rows) = chain();
    let g = build(
        &notes,
        &rows,
        &[],
        &Scope::Around {
            path: "library/b.md".to_owned(),
            depth,
        },
    );
    g.nodes.iter().map(|n| n.id.clone()).collect()
}

#[test]
fn around_a_page_reaches_as_far_as_the_depth_in_either_direction() {
    assert_eq!(around(1), ["library/a.md", "library/b.md", "library/c.md"]);
    assert_eq!(
        around(2),
        [
            "library/a.md",
            "library/b.md",
            "library/c.md",
            "library/d.md"
        ]
    );
    assert_eq!(around(3).len(), 5);
}

#[test]
fn around_keeps_the_edges_between_the_pages_it_reaches() {
    let (notes, mut rows) = chain();
    rows.push(row("library/a.md", "c"));
    let g = build(
        &notes,
        &rows,
        &[],
        &Scope::Around {
            path: "library/b.md".to_owned(),
            depth: 1,
        },
    );
    assert_eq!(
        pairs(&g),
        [
            pair("library/a.md", "library/b.md"),
            pair("library/a.md", "library/c.md"),
            pair("library/b.md", "library/c.md"),
        ]
    );
}

#[test]
fn the_depth_is_kept_between_one_and_three_and_an_unknown_page_has_no_graph() {
    assert_eq!(around(0), around(1));
    assert_eq!(around(9), around(3));
    let (notes, rows) = chain();
    let none = build(
        &notes,
        &rows,
        &[],
        &Scope::Around {
            path: "library/nope.md".to_owned(),
            depth: 2,
        },
    );
    assert!(none.nodes.is_empty() && none.edges.is_empty());
}

#[test]
fn around_a_ghost_or_a_board_works_by_its_id() {
    let files = [board(
        "projects/trip/boards/map.canvas",
        &["library/alpha.md"],
    )];
    let g = build(
        &vault(),
        &[row("library/beta.md", "nowhere")],
        &files,
        &Scope::Around {
            path: "projects/trip/boards/map.canvas".to_owned(),
            depth: 1,
        },
    );
    assert_eq!(
        ids(&g),
        ["library/alpha.md", "projects/trip/boards/map.canvas"]
    );
}
