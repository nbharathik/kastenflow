//! Each lint rule: what sets it off and what does not.

use serde_json::{Value, json};

use super::*;
use crate::diagrams::steps::{Step, from_steps};

fn wrap(cells: &str) -> String {
    format!(
        "<mxfile><diagram id=\"p\" name=\"Page-1\"><mxGraphModel pageWidth=\"850\" pageHeight=\"1100\"><root><mxCell id=\"0\"/><mxCell id=\"1\" parent=\"0\"/>{cells}</root></mxGraphModel></diagram></mxfile>"
    )
}

fn node(id: &str, label: &str, style: &str, at: (i32, i32, i32, i32)) -> String {
    format!(
        "<mxCell id=\"{id}\" value=\"{label}\" style=\"{style}\" vertex=\"1\" parent=\"1\"><mxGeometry x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" as=\"geometry\"/></mxCell>",
        at.0, at.1, at.2, at.3
    )
}

fn edge(id: &str, from: &str, to: &str, label: &str) -> String {
    format!(
        "<mxCell id=\"{id}\" value=\"{label}\" edge=\"1\" parent=\"1\" source=\"{from}\" target=\"{to}\"><mxGeometry relative=\"1\" as=\"geometry\"/></mxCell>"
    )
}

fn rules(xml: &str) -> Vec<(&'static str, Severity, Option<String>)> {
    lint(xml, None)
        .unwrap()
        .issues
        .into_iter()
        .map(|i| (i.rule, i.severity, i.cell))
        .collect()
}

fn has(xml: &str, rule: &str, severity: Severity) -> bool {
    rules(xml)
        .iter()
        .any(|(r, s, _)| *r == rule && *s == severity)
}

fn hit(xml: &str, rule: &str) -> bool {
    rules(xml).iter().any(|(r, _, _)| *r == rule)
}

const BOX: &str = "rounded=1;whiteSpace=wrap;html=1;";

#[test]
fn a_tidy_diagram_has_nothing_to_report() {
    let xml = wrap(&format!(
        "{}{}{}{}",
        node("a", "Web", BOX, (40, 40, 120, 60)),
        node("b", "API", BOX, (240, 40, 120, 60)),
        edge("e", "a", "b", ""),
        node("c", "DB", BOX, (440, 40, 120, 60)),
    ));
    let report = lint(&xml, None).unwrap();
    // The one loose end is a node nothing leads to; nothing else.
    assert_eq!(report.errors + report.warnings, 0, "{:?}", report.issues);
    assert_eq!(
        report.line(),
        format!("0 errors, 0 warnings, {} notes", report.infos)
    );
}

#[test]
fn overlap_is_found_between_boxes_beside_each_other_and_not_for_a_backdrop_or_a_label() {
    let xml = wrap(&format!(
        "{}{}{}{}{}",
        node("a", "A", BOX, (40, 40, 120, 60)),
        node("b", "B", BOX, (100, 60, 120, 60)),
        node(
            "g",
            "Group",
            "swimlane;fillColor=none;",
            (300, 40, 300, 200)
        ),
        node("c", "C", BOX, (320, 100, 100, 50)),
        node("t", "note", "text;html=1;", (60, 50, 60, 20)),
    ));
    let found = rules(&xml);
    let overlaps: Vec<_> = found.iter().filter(|(r, ..)| *r == "overlap").collect();
    assert_eq!(overlaps.len(), 1, "{found:?}");
    assert_eq!(overlaps[0].2.as_deref(), Some("a"));
}

#[test]
fn ids_parents_and_edges_that_are_broken_are_errors() {
    let xml = wrap(&format!(
        "{}{}{}{}",
        node("a", "A", BOX, (0, 0, 80, 40)),
        node("a", "Again", BOX, (100, 0, 80, 40)),
        "<mxCell id=\"lost\" value=\"L\" vertex=\"1\" parent=\"nowhere\"><mxGeometry x=\"0\" y=\"100\" width=\"80\" height=\"40\" as=\"geometry\"/></mxCell>",
        edge("e", "a", "ghost", "x"),
    ));
    for rule in ["duplicate-id", "bad-parent", "dangling-edge"] {
        assert!(
            has(&xml, rule, Severity::Error),
            "{rule}: {:?}",
            rules(&xml)
        );
    }
    // An edge with one end free is a warning, one with both ends free and a floating line is left alone.
    let half = wrap(&format!(
        "{}{}",
        node("a", "A", BOX, (0, 0, 80, 40)),
        "<mxCell id=\"e\" edge=\"1\" parent=\"1\" source=\"a\"><mxGeometry relative=\"1\" as=\"geometry\"/></mxCell>"
    ));
    assert!(has(&half, "dangling-edge", Severity::Warning));
    let floating = wrap(
        "<mxCell id=\"e\" edge=\"1\" parent=\"1\"><mxGeometry relative=\"1\" as=\"geometry\"><mxPoint x=\"0\" y=\"0\" as=\"sourcePoint\"/><mxPoint x=\"90\" y=\"0\" as=\"targetPoint\"/></mxGeometry></mxCell>",
    );
    assert!(!hit(&floating, "dangling-edge"));
}

#[test]
fn words_that_are_missing_long_or_absent_on_edges_are_reported() {
    let long = "w".repeat(90);
    let back = edge("e2", "b", "a", "back") + &edge("e3", "a", "b", "");
    let xml = wrap(&format!(
        "{}{}{}{}{}{}{}{back}",
        node("empty", "", BOX, (0, 0, 120, 60)),
        node("long", &long, BOX, (200, 0, 120, 60)),
        node("icon", "", "shape=mxgraph.aws4.lambda;", (400, 0, 60, 60)),
        node("dot", "", "ellipse;", (500, 0, 16, 16)),
        node("a", "A", BOX, (0, 200, 80, 40)),
        node("b", "B", BOX, (200, 200, 80, 40)),
        edge("e1", "a", "b", ""),
    ));
    let found = rules(&xml);
    let cells = |rule: &str| -> Vec<String> {
        found
            .iter()
            .filter(|(r, ..)| *r == rule)
            .filter_map(|(_, _, c)| c.clone())
            .collect()
    };
    assert_eq!(cells("empty-label"), ["empty"]);
    assert_eq!(cells("long-label"), ["long"]);
    assert_eq!(cells("unlabeled-edge"), ["e1", "e3"]);
    // Two unlabelled edges in a diagram of three is too few to ask for words on them.
    let few = wrap(&format!(
        "{}{}{}",
        node("a", "A", BOX, (0, 0, 80, 40)),
        node("b", "B", BOX, (200, 0, 80, 40)),
        edge("e", "a", "b", "")
    ));
    assert!(!hit(&few, "unlabeled-edge"));
}

#[test]
fn many_findings_of_one_rule_are_told_a_few_at_a_time_and_counted() {
    let cells: String = (0..14)
        .map(|i| node(&format!("n{i}"), "", BOX, (i * 130, 0, 120, 60)))
        .collect();
    let found = rules(&wrap(&cells));
    let empty: Vec<_> = found.iter().filter(|(r, ..)| *r == "empty-label").collect();
    assert_eq!(empty.len(), 9, "8 by name and one that counts the rest");
    assert!(empty.iter().filter(|(.., c)| c.is_none()).count() == 1);
}

#[test]
fn a_page_with_too_many_nodes_warns_and_with_far_too_many_fails() {
    let nodes = |n: i32| -> String {
        (0..n)
            .map(|i| {
                node(
                    &format!("n{i}"),
                    "x",
                    BOX,
                    ((i % 20) * 130, (i / 20) * 80, 120, 60),
                )
            })
            .collect()
    };
    assert!(!hit(&wrap(&nodes(40)), "too-many-nodes"));
    assert!(has(&wrap(&nodes(41)), "too-many-nodes", Severity::Warning));
    assert!(has(&wrap(&nodes(121)), "too-many-nodes", Severity::Error));
}

#[test]
fn places_off_the_grid_or_off_the_page_and_uneven_sizes_are_noticed() {
    let xml = wrap(&format!(
        "{}{}{}{}{}",
        node("a", "A", BOX, (43, 40, 120, 60)),
        node("b", "B", BOX, (1000, 40, 120, 60)),
        node("c", "C", BOX, (40, 300, 120, 60)),
        node("d", "D", BOX, (240, 300, 120, 60)),
        node("e", "E", BOX, (440, 300, 130, 60)),
    ));
    let found = rules(&xml);
    let on = |rule: &str, cell: &str| {
        found
            .iter()
            .any(|(r, _, c)| *r == rule && c.as_deref() == Some(cell))
    };
    assert!(on("off-grid", "a") && !on("off-grid", "c"));
    assert!(on("off-page", "b") && !on("off-page", "a"));
    assert!(on("inconsistent-size", "e"));
    assert!(
        found
            .iter()
            .filter(|(r, ..)| *r == "off-grid")
            .all(|(_, s, _)| *s == Severity::Info)
    );
}

#[test]
fn links_and_pictures_that_could_run_or_fetch_are_errors() {
    let xml = wrap(&format!(
        "{}{}{}{}{}",
        "<UserObject label=\"Docs\" link=\"javascript:alert(1)\" id=\"u\"><mxCell style=\"text;html=1;\" vertex=\"1\" parent=\"1\"><mxGeometry x=\"0\" y=\"0\" width=\"60\" height=\"20\" as=\"geometry\"/></mxCell></UserObject>",
        node(
            "l",
            "&lt;a href=&quot;data:text/html,x&quot;&gt;go&lt;/a&gt;",
            "html=1;",
            (100, 0, 80, 40)
        ),
        node(
            "i",
            "pic",
            "shape=image;image=https://tracker.example/p.png;",
            (200, 0, 80, 40)
        ),
        node(
            "m",
            "&lt;img src=&quot;http://x.example/a.png&quot;&gt;",
            "html=1;",
            (300, 0, 80, 40)
        ),
        node(
            "ok",
            "&lt;a href=&quot;https://example.com&quot;&gt;fine&lt;/a&gt;",
            "html=1;",
            (400, 0, 80, 40)
        ),
    ));
    let found = rules(&xml);
    let on = |rule: &str, cell: &str| {
        found
            .iter()
            .any(|(r, s, c)| *r == rule && *s == Severity::Error && c.as_deref() == Some(cell))
    };
    assert!(on("unsafe-link", "u") && on("unsafe-link", "l"));
    assert!(on("external-image", "i") && on("external-image", "m"));
    assert!(!found.iter().any(|(_, _, c)| c.as_deref() == Some("ok")));
}

#[test]
fn text_that_is_tiny_or_hard_to_read_is_reported() {
    let xml = wrap(&format!(
        "{}{}{}{}",
        node("tiny", "small", "fontSize=8;html=1;", (0, 0, 80, 40)),
        node(
            "pale",
            "pale",
            "fillColor=#ffff00;fontColor=#ffffff;html=1;",
            (100, 0, 80, 40)
        ),
        node(
            "fine",
            "fine",
            "fillColor=#dae8fc;html=1;",
            (200, 0, 80, 40)
        ),
        node(
            "html",
            "&lt;font style=&quot;font-size: 9px&quot;&gt;tiny&lt;/font&gt;",
            "html=1;",
            (300, 0, 80, 40)
        ),
    ));
    let found = rules(&xml);
    let on = |rule: &str, cell: &str| {
        found
            .iter()
            .any(|(r, _, c)| *r == rule && c.as_deref() == Some(cell))
    };
    assert!(on("tiny-text", "tiny") && on("tiny-text", "html") && !on("tiny-text", "fine"));
    assert!(on("contrast", "pale") && !on("contrast", "fine"));
}

#[test]
fn a_busy_diagram_wants_a_title_and_a_legend() {
    let styled = |i: usize| {
        [
            "fillColor=#dae8fc;",
            "fillColor=#d5e8d4;",
            "fillColor=#f8cecc;",
        ][i % 3]
    };
    let nodes: String = (0..6)
        .map(|i| {
            node(
                &format!("n{i}"),
                "x",
                &format!("{BOX}{}", styled(i)),
                (i as i32 * 130, 100, 120, 60),
            )
        })
        .collect();
    assert!(hit(&wrap(&nodes), "no-title") && hit(&wrap(&nodes), "no-legend"));
    let with = format!(
        "{nodes}{}{}",
        node(
            "title",
            "Order flow",
            "text;html=1;fontSize=20;fontStyle=1;",
            (0, 20, 300, 30)
        ),
        node(
            "key",
            "Legend: blue is ours",
            "text;html=1;",
            (700, 20, 100, 30)
        ),
    );
    assert!(!hit(&wrap(&with), "no-title") && !hit(&wrap(&with), "no-legend"));
    // A few boxes of one colour need neither.
    let small: String = (0..3)
        .map(|i| node(&format!("n{i}"), "x", BOX, (i * 130, 100, 120, 60)))
        .collect();
    assert!(!hit(&wrap(&small), "no-title") && !hit(&wrap(&small), "no-legend"));
}

fn laid(list: Value) -> String {
    let steps: Vec<Step> = serde_json::from_value(list).unwrap();
    from_steps(None, &steps).unwrap().xml
}

#[test]
fn edges_that_cross_or_run_through_a_box_are_found_and_a_layout_clears_them() {
    let build = |layout: bool| {
        let mut list = vec![
            json!({"op": "add_node", "id": "a", "label": "A", "x": 40, "y": 40}),
            json!({"op": "add_node", "id": "b", "label": "B", "x": 440, "y": 240}),
            json!({"op": "add_node", "id": "c", "label": "C", "x": 40, "y": 240}),
            json!({"op": "add_node", "id": "d", "label": "D", "x": 440, "y": 40}),
            json!({"op": "add_node", "id": "m", "label": "M", "x": 240, "y": 140}),
            json!({"op": "add_edge", "from": "a", "to": "b", "label": "1"}),
            json!({"op": "add_edge", "from": "c", "to": "d", "label": "2"}),
        ];
        if layout {
            list.push(json!({"op": "layout"}));
        }
        laid(json!(list))
    };
    let messy = build(false);
    let found = rules(&messy);
    assert!(found.iter().any(|(r, ..)| *r == "crossings"), "{found:?}");
    assert!(
        found
            .iter()
            .any(|(r, _, c)| *r == "edge-through-node" && c.as_deref() == Some("e-a-b")),
        "{found:?}"
    );
    let tidy = rules(&build(true));
    assert!(
        !tidy
            .iter()
            .any(|(r, ..)| matches!(*r, "crossings" | "edge-through-node" | "overlap")),
        "{tidy:?}"
    );
}

#[test]
fn a_page_can_be_chosen_and_a_report_counts_what_it_found() {
    let report = lint(&wrap(&node("e", "", BOX, (3, 0, 80, 40))), Some("Page-1")).unwrap();
    assert_eq!((report.errors, report.warnings), (0, 1));
    assert!(report.infos >= 1);
    assert!(lint(&wrap(""), Some("Nope")).is_err());
    assert!(report.issues[0].page == "Page-1" && !report.issues[0].hint.is_empty());
    let big = lint(
        &wrap(
            &(0..3)
                .map(|i| edge(&format!("e{i}"), "x", "y", ""))
                .collect::<String>(),
        ),
        None,
    )
    .unwrap();
    assert!(big.skipped.is_empty());
}
