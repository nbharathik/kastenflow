//! Layout through the `layout` step: where boxes end up, what they never do
//! (overlap, leave the grid, change from run to run) and how groups, lanes,
//! cycles and long edges come out.

use serde_json::{Value, json};

use crate::diagrams::model::{Doc, Page, Rect};
use crate::diagrams::steps::{Edited, Step, from_steps, replay};

fn steps(value: Value) -> Vec<Step> {
    serde_json::from_value(value).unwrap()
}

fn node(id: &str) -> Value {
    json!({"op": "add_node", "id": id, "label": id, "x": 40, "y": 40})
}

fn edge(a: &str, b: &str) -> Value {
    json!({"op": "add_edge", "from": a, "to": b})
}

/// A diagram of these nodes (all piled on one place) and edges, laid out.
fn laid(nodes: &[&str], edges: &[(&str, &str)], layout: Value) -> (Edited, Page) {
    let mut list: Vec<Value> = nodes.iter().map(|n| node(n)).collect();
    list.extend(edges.iter().map(|(a, b)| edge(a, b)));
    list.push(layout);
    let out = from_steps(None, &steps(json!(list))).unwrap();
    let page = Doc::parse(&out.xml).unwrap().pages.swap_remove(0);
    (out, page)
}

fn abs(page: &Page, id: &str) -> Rect {
    page.abs(id).unwrap()
}

fn assert_no_overlaps(page: &Page) {
    let boxes: Vec<(String, Option<String>, Rect)> = page
        .vertices()
        .map(|c| (c.id.clone(), c.parent.clone(), page.abs(&c.id).unwrap()))
        .collect();
    for (i, (a, pa, ra)) in boxes.iter().enumerate() {
        for (b, pb, rb) in &boxes[i + 1..] {
            // A group holds its boxes; only boxes beside each other must keep apart.
            if pa == pb {
                assert!(!ra.overlaps(rb, 0.0), "{a} {ra:?} overlaps {b} {rb:?}");
            }
        }
    }
}

#[test]
fn a_chain_goes_left_to_right_on_the_grid_with_the_gaps_the_flow_needs() {
    let (_, page) = laid(
        &["a", "b", "c"],
        &[("a", "b"), ("b", "c")],
        json!({"op": "layout"}),
    );
    let (a, b, c) = (abs(&page, "a"), abs(&page, "b"), abs(&page, "c"));
    assert!(
        a.right() + 80.0 <= b.x && b.right() + 80.0 <= c.x,
        "{a:?} {b:?} {c:?}"
    );
    assert_eq!((a.y, b.y, c.y), (a.y, a.y, a.y), "one row");
    for r in [a, b, c] {
        assert_eq!((r.x % 10.0, r.y % 10.0), (0.0, 0.0));
    }
    assert_eq!((a.x, a.y), (40.0, 40.0));
    // Top to bottom puts them in a column with 60 between.
    let (_, page) = laid(
        &["a", "b"],
        &[("a", "b")],
        json!({"op": "layout", "direction": "TB"}),
    );
    let (a, b) = (abs(&page, "a"), abs(&page, "b"));
    assert_eq!((a.x, b.x), (a.x, a.x));
    assert!(
        b.y >= a.bottom() + 60.0 && b.y < a.bottom() + 70.0,
        "{a:?} {b:?}"
    );
}

#[test]
fn edges_are_told_where_to_leave_and_arrive_and_parallel_edges_do_not_share_a_place() {
    let (_, page) = laid(
        &["a", "b"],
        &[("a", "b"), ("a", "b"), ("b", "a")],
        json!({"op": "layout"}),
    );
    let first = page.get("e-a-b").unwrap();
    assert_eq!(
        (first.style.get("exitX"), first.style.get("entryX")),
        (Some("1"), Some("0"))
    );
    let second = page.get("e-a-b-2").unwrap();
    assert_ne!(first.style.get("exitY"), second.style.get("exitY"));
    // The one that comes back leaves from the top and arrives at the top.
    let back = page.get("e-b-a").unwrap();
    assert_eq!(
        (back.style.get("exitY"), back.style.get("entryY")),
        (Some("0"), Some("0"))
    );
}

#[test]
fn a_cycle_is_laid_out_in_order_and_the_edge_that_closes_it_goes_back_over_the_top() {
    let (_, page) = laid(
        &["a", "b", "c"],
        &[("a", "b"), ("b", "c"), ("c", "a")],
        json!({"op": "layout"}),
    );
    let xs: Vec<f64> = ["a", "b", "c"].iter().map(|n| abs(&page, n).x).collect();
    assert!(xs[0] < xs[1] && xs[1] < xs[2], "{xs:?}");
    assert_eq!(page.get("e-c-a").unwrap().style.get("exitY"), Some("0"));
    assert_no_overlaps(&page);
}

#[test]
fn a_long_edge_bends_round_the_boxes_in_between() {
    let (_, page) = laid(
        &["a", "b", "c"],
        &[("a", "b"), ("b", "c"), ("a", "c")],
        json!({"op": "layout"}),
    );
    let long = page.get("e-a-c").unwrap();
    let points = &long.geo.as_ref().unwrap().points;
    assert_eq!(points.len(), 1, "{points:?}");
    let b = abs(&page, "b");
    assert!(
        points[0].1 < b.y - 10.0 || points[0].1 > b.bottom() + 10.0,
        "{points:?} {b:?}"
    );
    assert!(
        page.get("e-a-b")
            .unwrap()
            .geo
            .as_ref()
            .unwrap()
            .points
            .is_empty()
    );
}

#[test]
fn boxes_with_no_edges_go_into_a_grid_after_the_connected_ones() {
    let names = ["a", "b", "c", "d", "e", "f", "g"];
    let (_, page) = laid(&names, &[("a", "b")], json!({"op": "layout"}));
    assert_no_overlaps(&page);
    let lone: Vec<Rect> = ["c", "d", "e", "f", "g"]
        .iter()
        .map(|n| abs(&page, n))
        .collect();
    // Three columns of up to three rows; below the connected pair.
    let mut columns: Vec<f64> = lone.iter().map(|r| r.x).collect();
    columns.sort_by(f64::total_cmp);
    columns.dedup();
    assert_eq!(columns.len(), 3, "{lone:?}");
    assert!(lone.iter().all(|r| r.y > abs(&page, "a").bottom()));
    // With no edges at all, everything is a grid from the corner.
    let (_, page) = laid(&["a", "b", "c", "d"], &[], json!({"op": "layout"}));
    assert_eq!((abs(&page, "a").x, abs(&page, "a").y), (40.0, 40.0));
    assert_no_overlaps(&page);
}

#[test]
fn a_group_is_laid_out_inside_and_sized_to_hold_what_it_has() {
    let list = json!([
        node("a"), node("b"), node("c"), node("d"),
        edge("a", "b"), edge("b", "c"), edge("c", "d"),
        {"op": "group", "id": "g", "label": "Group", "members": ["b", "c"]},
        {"op": "layout"},
    ]);
    let out = from_steps(None, &steps(list)).unwrap();
    let page = Doc::parse(&out.xml).unwrap().pages.swap_remove(0);
    let g = abs(&page, "g");
    for inner in ["b", "c"] {
        let r = abs(&page, inner);
        assert!(g.contains(&r), "{inner} {r:?} in {g:?}");
        assert!(r.y >= g.y + 30.0, "room for the title");
        assert_eq!(page.get(inner).unwrap().parent.as_deref(), Some("g"));
    }
    assert_eq!((g.w % 10.0, g.h % 10.0), (0.0, 0.0));
    // The group is a box of the level above: a, then the group, then d, in order.
    let (a, d) = (abs(&page, "a"), abs(&page, "d"));
    assert!(a.right() < g.x && g.right() < d.x, "{a:?} {g:?} {d:?}");
    // The edges into and out of the group still join the boxes inside it.
    assert_eq!(page.get("e-a-b").unwrap().target.as_deref(), Some("b"));
    assert_no_overlaps(&page);
    // Laying out the group alone leaves it where it is.
    let again = replay(
        &out.xml,
        None,
        None,
        &steps(json!([{"op": "layout", "scope": "g", "direction": "TB"}])),
    )
    .unwrap();
    let page = Doc::parse(&again.xml).unwrap().pages.swap_remove(0);
    let g2 = abs(&page, "g");
    assert_eq!((g2.x, g2.y), (g.x, g.y));
    assert!(abs(&page, "c").y > abs(&page, "b").y, "now top to bottom");
}

#[test]
fn swimlanes_share_the_flow_and_hold_their_own_boxes() {
    let list = json!([
        node("ask"), node("check"), node("ship"), node("pay"),
        edge("ask", "check"), edge("check", "ship"), edge("ship", "pay"),
        {"op": "group", "id": "customer", "label": "Customer", "members": ["ask", "pay"], "kind": "lane"},
        {"op": "group", "id": "shop", "label": "Shop", "members": ["check", "ship"], "kind": "lane"},
        {"op": "layout"},
    ]);
    let out = from_steps(None, &steps(list)).unwrap();
    let page = Doc::parse(&out.xml).unwrap().pages.swap_remove(0);
    let (customer, shop) = (abs(&page, "customer"), abs(&page, "shop"));
    assert_eq!(
        (customer.x, customer.w),
        (shop.x, shop.w),
        "lanes are as wide as each other"
    );
    assert!(
        shop.y >= customer.bottom(),
        "stacked: {customer:?} {shop:?}"
    );
    for (id, lane) in [
        ("ask", customer),
        ("pay", customer),
        ("check", shop),
        ("ship", shop),
    ] {
        assert!(lane.contains(&abs(&page, id)), "{id} in its lane");
    }
    // The flow runs across the lanes: ask, check, ship, pay.
    let xs: Vec<f64> = ["ask", "check", "ship", "pay"]
        .iter()
        .map(|n| abs(&page, n).x)
        .collect();
    assert!(xs.windows(2).all(|w| w[0] < w[1]), "{xs:?}");
    assert_no_overlaps(&page);
}

#[test]
fn rows_of_an_entity_are_stacked_under_its_title() {
    let list = json!([
        {"op": "add_node", "id": "id", "label": "id: uuid", "kind": "field", "x": 0, "y": 0},
        {"op": "add_node", "id": "email", "label": "email: text", "kind": "field", "x": 0, "y": 0},
        {"op": "group", "id": "user", "label": "User", "members": ["id", "email"], "kind": "entity"},
        {"op": "layout"},
    ]);
    let out = from_steps(Some("er"), &steps(list)).unwrap();
    let page = Doc::parse(&out.xml).unwrap().pages.swap_remove(0);
    let user = abs(&page, "user");
    let (id, email) = (abs(&page, "id"), abs(&page, "email"));
    assert_eq!((id.y, email.y), (user.y + 30.0, user.y + 56.0));
    assert_eq!((id.x, id.w), (user.x, user.w));
    assert_eq!(user.h, 30.0 + 26.0 * 2.0 + 6.0);
}

#[test]
fn the_same_diagram_is_always_laid_out_the_same_way_and_a_second_layout_changes_nothing() {
    let nodes: Vec<String> = (0..24).map(|i| format!("n{i}")).collect();
    let refs: Vec<&str> = nodes.iter().map(String::as_str).collect();
    let edges: Vec<(String, String)> = (0..24)
        .flat_map(|i| [(i, (i * 7 + 3) % 24), (i, (i * 5 + 1) % 24)])
        .filter(|(a, b)| a != b)
        .map(|(a, b)| (format!("n{a}"), format!("n{b}")))
        .collect();
    let pairs: Vec<(&str, &str)> = edges
        .iter()
        .map(|(a, b)| (a.as_str(), b.as_str()))
        .collect();
    let (one, page) = laid(&refs, &pairs, json!({"op": "layout"}));
    let (two, _) = laid(&refs, &pairs, json!({"op": "layout"}));
    assert_eq!(one.xml, two.xml);
    assert_no_overlaps(&page);
    for c in page.vertices() {
        let r = abs(&page, &c.id);
        assert_eq!((r.x % 10.0, r.y % 10.0), (0.0, 0.0), "{}", c.id);
    }
    let again = replay(&one.xml, None, None, &steps(json!([{"op": "layout"}]))).unwrap();
    assert_eq!(again.xml, one.xml);
    assert_eq!(again.applied.moved, 0);
}

#[test]
fn spacing_loosens_and_tightens_the_gaps() {
    let gap = |spacing: &str| {
        let (_, page) = laid(
            &["a", "b"],
            &[("a", "b")],
            json!({"op": "layout", "spacing": spacing}),
        );
        abs(&page, "b").x - abs(&page, "a").right()
    };
    assert!(gap("compact") < gap("normal") && gap("normal") < gap("wide"));
}

#[test]
fn a_layout_reports_the_boxes_it_moved() {
    let (out, _) = laid(
        &["a", "b", "c"],
        &[("a", "b"), ("b", "c")],
        json!({"op": "layout"}),
    );
    assert_eq!(out.applied.layouts, 1);
    assert!(out.applied.moved >= 2, "{}", out.applied.moved);
}
