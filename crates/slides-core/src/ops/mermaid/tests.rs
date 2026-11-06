use serde_json::json;

use super::parse::parse;
use super::{SOURCE_KEY, source_of};
use crate::model::Element;
use crate::ops::diagram::Direction;
use crate::ops::tests::{add, bytes, engine, first_slide};

fn ids(flow: &super::parse::Flow) -> Vec<&str> {
    flow.nodes.iter().map(|n| n.id.as_str()).collect()
}

#[test]
fn a_chain_of_boxes_and_arrows_is_read_with_its_words_and_shapes() {
    let flow = parse(
        "flowchart LR\n  A[Start] --> B{Ready?}\n  B -->|yes| C((Go))\n  B -- no --> D(Wait)\n  D --> A",
    )
    .expect("a flowchart");
    assert_eq!(flow.direction, Direction::LeftToRight);
    assert_eq!(ids(&flow), ["A", "B", "C", "D"]);
    let shapes: Vec<_> = flow.nodes.iter().map(|n| n.shape.as_deref()).collect();
    assert_eq!(
        shapes,
        [
            Some("rect"),
            Some("diamond"),
            Some("ellipse"),
            Some("roundRect")
        ]
    );
    assert_eq!(flow.nodes[1].label, "Ready?");
    let edges: Vec<_> = flow
        .edges
        .iter()
        .map(|e| (e.from.as_str(), e.to.as_str(), e.label.as_deref()))
        .collect();
    assert_eq!(
        edges,
        [
            ("A", "B", None),
            ("B", "C", Some("yes")),
            ("B", "D", Some("no")),
            ("D", "A", None)
        ]
    );
}

#[test]
fn chains_fans_semicolons_and_line_breaks_in_words_work() {
    let flow = parse("graph TD; A & B --> C --> D[\"Line one<br/>line two\"]; %% a comment\n")
        .expect("a flowchart");
    assert_eq!(flow.direction, Direction::TopDown);
    assert_eq!(flow.edges.len(), 3, "A to C, B to C, C to D");
    assert_eq!(flow.nodes[3].label, "Line one\nline two");
}

#[test]
fn a_later_label_names_a_box_and_a_bare_mention_does_not_rename_it() {
    let flow =
        parse("flowchart TD\nA --> B\nA[First]\nA --> C\nA\nB[Second]").expect("a flowchart");
    assert_eq!(flow.nodes[0].label, "First");
    assert_eq!(flow.nodes[1].label, "Second");
}

#[test]
fn styling_groups_and_self_loops_are_skipped_not_refused() {
    let flow = parse(
        "flowchart TD\nsubgraph one [Part one]\n  direction LR\n  A --> B\nend\nstyle A fill:#f9f\nclassDef hot fill:#f00\nclass B hot\nA:::hot --> A\nlinkStyle 0 stroke:red",
    )
    .expect("a flowchart");
    assert_eq!(ids(&flow), ["A", "B"]);
    assert_eq!(flow.edges.len(), 1, "the arrow from A to itself is dropped");
}

#[test]
fn text_that_is_not_a_flowchart_or_is_broken_says_what_is_wrong() {
    assert!(parse("").expect_err("empty").contains("empty"));
    assert!(
        parse("sequenceDiagram\nA->>B: hi")
            .expect_err("other kind")
            .contains("only flowcharts")
    );
    assert!(
        parse("flowchart XY\nA-->B")
            .expect_err("direction")
            .contains("not a direction")
    );
    assert!(
        parse("flowchart TD\nA[open --> B")
            .expect_err("unclosed")
            .contains("never closes")
    );
    assert!(
        parse("flowchart TD\nA --> ")
            .expect_err("no target")
            .contains("name of a box")
    );
    assert!(
        parse("flowchart TD\nA - B")
            .expect_err("no arrow")
            .contains("arrow")
    );
    assert!(
        parse("flowchart TD\n%% nothing")
            .expect_err("no boxes")
            .contains("no boxes")
    );
    let huge = format!("flowchart TD\n{}", "A-->B\n".repeat(5000));
    assert!(parse(&huge).expect_err("too long").contains("at most"));
}

#[test]
fn adding_a_chart_draws_native_shapes_in_one_group_that_keeps_the_source() {
    let mut e = engine();
    let slide = first_slide(&e);
    let before = bytes(e.deck());
    let source = "flowchart LR\nA[Idea] --> B[Draft]\nB --> C[Ship]";
    let out = e
        .apply("add_mermaid", json!({ "slide": slide, "source": source }))
        .expect("a chart");
    let group_id = out.output["group"].as_str().expect("a group id").to_owned();
    let slide_ref = e.deck().slide(&slide).expect("slide");
    let group = slide_ref.element(&group_id).expect("the group");
    assert_eq!(source_of(group), Some(source));
    let Element::Group(g) = group else {
        panic!("a group")
    };
    assert_eq!(g.children.len(), 5, "three boxes and two arrows");
    assert_eq!(
        g.children
            .iter()
            .filter(|c| matches!(c, Element::Shape(_)))
            .count(),
        3
    );
    assert_eq!(
        g.children
            .iter()
            .filter(|c| matches!(c, Element::Connector(_)))
            .count(),
        2
    );
    assert!(g.extra.contains_key(SOURCE_KEY));
    e.undo().expect("undo");
    assert_eq!(bytes(e.deck()), before, "undo takes the whole chart away");
    e.redo().expect("redo");
    assert!(bytes(e.deck()).contains("\"mermaid\""));
}

#[test]
fn a_refused_chart_leaves_the_deck_as_it_was() {
    let mut e = engine();
    let slide = first_slide(&e);
    let before = bytes(e.deck());
    let err = e
        .apply(
            "add_mermaid",
            json!({ "slide": slide, "source": "pie title x" }),
        )
        .expect_err("not a flowchart")
        .to_string();
    assert!(err.contains("flowchart"), "{err}");
    assert_eq!(bytes(e.deck()), before);
}

#[test]
fn writing_the_chart_again_replaces_it_in_place_and_keeps_the_group_id() {
    let mut e = engine();
    // A slide with room under its title: the cover's free area is too short for three boxes in a column.
    let slide = add(&mut e, "title-only", json!({ "title": "Flow" }));
    let out = e
        .apply(
            "add_mermaid",
            json!({ "slide": slide, "source": "flowchart TD\nA --> B" }),
        )
        .expect("a chart");
    let id = out.output["group"].as_str().expect("id").to_owned();
    let before = bytes(e.deck());
    let again = e
        .apply(
            "update_mermaid",
            json!({ "slide": slide, "id": id, "source": "flowchart TD\nA --> B --> C" }),
        )
        .expect("updated");
    assert_eq!(again.output["group"], json!(id));
    let slide_ref = e.deck().slide(&slide).expect("slide");
    let Element::Group(g) = slide_ref.element(&id).expect("same id") else {
        panic!("a group")
    };
    assert_eq!(g.children.len(), 5);
    assert_eq!(
        source_of(&Element::Group(g.clone())),
        Some("flowchart TD\nA --> B --> C")
    );
    e.undo().expect("undo");
    assert_eq!(bytes(e.deck()), before);
}

#[test]
fn only_a_group_made_from_a_chart_can_be_written_again() {
    let mut e = engine();
    let slide = first_slide(&e);
    let title = e.deck().slide(&slide).expect("slide").elements[0]
        .id()
        .to_owned();
    let before = bytes(e.deck());
    let err = e
        .apply(
            "update_mermaid",
            json!({ "slide": slide, "id": title, "source": "flowchart TD\nA-->B" }),
        )
        .expect_err("not a chart")
        .to_string();
    assert!(err.contains("not a Mermaid"), "{err}");
    assert_eq!(bytes(e.deck()), before);
}
