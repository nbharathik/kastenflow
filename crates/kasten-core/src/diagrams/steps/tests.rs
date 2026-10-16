//! Steps on the golden diagrams: what each one does, what it refuses, and
//! that cells it does not touch keep their bytes.

use serde_json::{Value, json};

use super::*;
use crate::diagrams::model::{Doc, Rect, cell_blocks};

macro_rules! fixture {
    ($name:literal) => {
        include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/diagrams/",
            $name
        ))
    };
}

const EDITOR: &str = fixture!("editor-output.drawio");
const C4: &str = fixture!("c4-objects.drawio");
const NESTED: &str = fixture!("nested-container.drawio");
const COMPRESSED: &str = fixture!("compressed.drawio");

fn steps(value: Value) -> Vec<Step> {
    serde_json::from_value(value).unwrap()
}

fn run(xml: &str, value: Value) -> Edited {
    replay(xml, None, None, &steps(value)).unwrap()
}

fn fails(xml: &str, value: Value) -> String {
    replay(xml, None, None, &steps(value))
        .unwrap_err()
        .to_string()
}

fn page(edited: &Edited) -> crate::diagrams::model::Page {
    Doc::parse(&edited.xml).unwrap().pages.swap_remove(0)
}

/// Every cell whose values did not change keeps its text exactly.
fn untouched_cells_keep_their_bytes(before: &str, after: &str) {
    let old = Doc::parse(before).unwrap();
    let new = Doc::parse(after).unwrap();
    let kept = cell_blocks(after).unwrap();
    for (id, block) in cell_blocks(before).unwrap() {
        let same = old.pages[0]
            .get(&id)
            .zip(new.pages[0].get(&id))
            .is_some_and(|(a, b)| a.values() == b.values());
        if same {
            assert!(
                kept.iter().any(|(i, b)| *i == id && *b == block),
                "{id} changed its bytes"
            );
        }
    }
}

#[test]
fn no_steps_give_the_text_back_unchanged_and_a_compressed_page_is_refused() {
    for text in [EDITOR, C4, NESTED] {
        let out = replay(text, None, None, &[]).unwrap();
        assert_eq!((out.xml.as_str(), out.changed), (text, false));
    }
    let err = replay(COMPRESSED, None, None, &[]).unwrap_err().to_string();
    assert!(err.contains("saved compressed"), "{err}");
}

#[test]
fn a_node_is_added_with_a_kind_a_size_for_its_words_and_a_free_place() {
    let out = run(
        EDITOR,
        json!([
            {"op": "add_node", "id": "queue", "label": "Order events", "kind": "queue"},
            {"op": "add_node", "id": "auth", "label": "Authentication and authorisation gateway"},
        ]),
    );
    assert_eq!(out.applied.ids, ["queue", "auth"]);
    let p = page(&out);
    let queue = p.get("queue").unwrap();
    assert_eq!(queue.style.get("shape"), Some("process"));
    assert_eq!(queue.text(), "Order events");
    let auth = p.abs("auth").unwrap();
    assert_eq!((auth.w, auth.h), (220.0, 60.0));
    // Nothing overlaps what was there.
    for other in ["web", "api", "db", "queue"] {
        assert!(!auth.overlaps(&p.abs(other).unwrap(), 0.0), "{other}");
    }
    untouched_cells_keep_their_bytes(EDITOR, &out.xml);
    // Labels are plain words: markup is escaped, never run.
    let out = run(
        EDITOR,
        json!([{"op": "add_node", "id": "x", "label": "<b>bold</b> & more\nsecond line"}]),
    );
    assert_eq!(
        page(&out).get("x").unwrap().text(),
        "<b>bold</b> & more\nsecond line"
    );
    assert!(out.xml.contains("&lt;br&gt;"));
}

#[test]
fn a_node_goes_near_another_inside_its_group_and_keeps_to_page_coordinates() {
    let out = run(
        NESTED,
        json!([
            {"op": "add_node", "id": "queue", "label": "Jobs", "near": "app", "side": "below"},
            {"op": "add_node", "id": "far", "label": "Far", "x": 600, "y": 40},
            {"op": "add_node", "id": "in", "label": "Inside", "group": "vpc", "x": 300, "y": 250},
        ]),
    );
    let p = page(&out);
    // Placed under "app", in the same group, in the group's own space.
    assert_eq!(p.get("queue").unwrap().parent.as_deref(), Some("vpc"));
    let (app, queue) = (p.abs("app").unwrap(), p.abs("queue").unwrap());
    assert!(queue.y > app.bottom() && (queue.center().0 - app.center().0).abs() < 1.0);
    assert_eq!(
        p.abs("far"),
        Some(Rect {
            x: 600.0,
            y: 40.0,
            w: 120.0,
            h: 60.0
        })
    );
    // Explicit coordinates are page coordinates, kept whatever the group.
    assert_eq!(p.abs("in").unwrap().x, 300.0);
    assert_eq!(p.get("in").unwrap().geo.as_ref().unwrap().x, 200.0);
    untouched_cells_keep_their_bytes(NESTED, &out.xml);
}

#[test]
fn a_c4_node_is_an_object_with_its_fields() {
    let out = run(
        C4,
        json!([{"op": "add_node", "id": "api", "label": "API [Spring Boot]\nHandles orders", "kind": "container"}]),
    );
    assert!(out.xml.contains("<object placeholders=\"1\" c4Name=\"API\" c4Type=\"Container\" c4Technology=\"Spring Boot\" c4Description=\"Handles orders\""), "{}", out.xml);
    let p = page(&out);
    assert_eq!(
        p.get("api").unwrap().text(),
        "API\n[Container: Spring Boot]\nHandles orders"
    );
    // Renaming it changes the field, not the template.
    let out = run(
        &out.xml,
        json!([{"op": "update", "id": "api", "label": "Orders API"}]),
    );
    assert!(out.xml.contains("c4Name=\"Orders API\"") && out.xml.contains("%c4Name%"));
}

#[test]
fn an_edge_joins_two_nodes_in_the_nearest_group_that_holds_both() {
    let out = run(
        NESTED,
        json!([
            {"op": "add_node", "id": "db", "label": "DB", "kind": "database", "x": 700, "y": 100},
            {"op": "add_edge", "from": "app", "to": "cache", "label": "get", "kind": "async"},
            {"op": "add_edge", "from": "cache", "to": "db", "id": "persist", "waypoints": [{"x": 600, "y": 130}]},
        ]),
    );
    let p = page(&out);
    let inner = p.get("e-app-cache").unwrap();
    assert_eq!(inner.parent.as_deref(), Some("vpc"));
    assert!(inner.style.flag("dashed"));
    let outer = p.get("persist").unwrap();
    assert_eq!(outer.parent.as_deref(), Some("1"));
    assert_eq!(outer.geo.as_ref().unwrap().points, vec![(600.0, 130.0)]);
    assert!(outer.geo.as_ref().unwrap().relative);
    // An edge is placed in its group with waypoints in the group's space.
    let out = run(
        NESTED,
        json!([{"op": "add_edge", "from": "app", "to": "cache", "waypoints": [{"x": 300, "y": 300}]}]),
    );
    assert_eq!(
        page(&out)
            .get("e-app-cache")
            .unwrap()
            .geo
            .as_ref()
            .unwrap()
            .points,
        vec![(200.0, 200.0)]
    );
}

#[test]
fn update_changes_words_kind_and_style_and_restyle_colours_many() {
    let out = run(
        EDITOR,
        json!([
            {"op": "update", "id": "web", "label": "Customer web app", "set": {"dashed": "1"}},
            {"op": "update", "id": "e1", "kind": "async"},
            {"op": "restyle", "ids": ["api", "db"], "token": "red"},
            {"op": "restyle", "ids": ["api"], "unset": ["arcSize"]},
        ]),
    );
    let p = page(&out);
    assert_eq!(p.get("web").unwrap().text(), "Customer web app");
    assert!(p.get("web").unwrap().style.flag("dashed"));
    assert!(p.get("e1").unwrap().style.flag("dashed"));
    assert_eq!(
        p.get("api").unwrap().style.get("fillColor"),
        Some("#f8cecc")
    );
    assert!(!p.get("api").unwrap().style.has("arcSize"));
    assert_eq!(
        p.get("db").unwrap().style.get("strokeColor"),
        Some("#b85450")
    );
    // An edge is only given a line colour.
    let out = run(
        EDITOR,
        json!([{"op": "restyle", "ids": ["e1"], "token": "green"}]),
    );
    let e1 = page(&out).get("e1").unwrap().clone();
    assert_eq!(e1.style.get("strokeColor"), Some("#82b366"));
    assert!(!e1.style.has("fillColor"));
    untouched_cells_keep_their_bytes(EDITOR, &out.xml);
}

#[test]
fn move_and_resize_work_in_page_coordinates_and_reparent_into_groups() {
    let out = run(
        NESTED,
        json!([
            {"op": "move", "id": "user", "dx": 10, "dy": 20},
            {"op": "move", "id": "user", "group": "vpc", "x": 400, "y": 250},
            {"op": "resize", "id": "cache", "w": 150, "h": 90},
        ]),
    );
    let p = page(&out);
    assert_eq!(p.get("user").unwrap().parent.as_deref(), Some("vpc"));
    assert_eq!(
        (p.abs("user").unwrap().x, p.abs("user").unwrap().y),
        (400.0, 250.0)
    );
    assert_eq!(p.get("user").unwrap().geo.as_ref().unwrap().x, 300.0);
    assert_eq!(p.abs("cache").unwrap().w, 150.0);
    // The edge now has both ends in the group, so it belongs to it.
    assert_eq!(p.get("outer").unwrap().parent.as_deref(), Some("vpc"));
    // Out of the group again: back to the page, in page coordinates.
    let out = run(
        &out.xml,
        json!([{"op": "move", "id": "user", "group": "page", "x": 20, "y": 150}]),
    );
    let p = page(&out);
    assert_eq!(p.get("user").unwrap().parent.as_deref(), Some("1"));
    assert_eq!(p.abs("user").unwrap().x, 20.0);
    assert!(fails(NESTED, json!([{"op": "move", "id": "vpc", "group": "app"}])).contains("itself"));
}

#[test]
fn a_group_holds_its_members_and_the_edges_between_them() {
    let out = run(
        EDITOR,
        json!([
            {"op": "group", "id": "backend", "label": "Backend", "members": ["api", "db"], "kind": "boundary"},
        ]),
    );
    let p = page(&out);
    let group = p.abs("backend").unwrap();
    assert!(group.contains(&p.abs("api").unwrap()) && group.contains(&p.abs("db").unwrap()));
    assert_eq!(
        (
            group.x % 10.0,
            group.y % 10.0,
            group.w % 10.0,
            group.h % 10.0
        ),
        (0.0, 0.0, 0.0, 0.0)
    );
    assert!(
        group.y + 30.0 <= p.abs("api").unwrap().y.min(p.abs("db").unwrap().y),
        "room for the title"
    );
    assert_eq!(p.get("api").unwrap().parent.as_deref(), Some("backend"));
    assert_eq!(
        p.get("api").unwrap().geo.as_ref().unwrap().x,
        p.abs("api").unwrap().x - group.x
    );
    // Page positions are what they were; the edge between the members moved in with them.
    assert_eq!(
        p.abs("api").unwrap(),
        Doc::parse(EDITOR).unwrap().pages[0].abs("api").unwrap()
    );
    assert_eq!(p.get("e2").unwrap().parent.as_deref(), Some("backend"));
    assert_eq!(p.get("e1").unwrap().parent.as_deref(), Some("1"));
    // The waypoint stays where it is on the page.
    assert_eq!(
        p.get("e2").unwrap().geo.as_ref().unwrap().points,
        vec![(400.0 - group.x, 110.0 - group.y)]
    );

    // Ungroup puts everything back in page space and takes the group away.
    let back = run(&out.xml, json!([{"op": "ungroup", "id": "backend"}]));
    let p = page(&back);
    assert!(p.get("backend").is_none());
    assert_eq!(p.get("api").unwrap().parent.as_deref(), Some("1"));
    assert_eq!(p.abs("db"), Doc::parse(EDITOR).unwrap().pages[0].abs("db"));
    assert_eq!(
        p.get("e2").unwrap().geo.as_ref().unwrap().points,
        vec![(400.0, 110.0)]
    );
}

#[test]
fn members_of_different_groups_cannot_be_grouped_and_a_lane_has_its_title_on_the_left() {
    assert!(
        fails(
            NESTED,
            json!([{"op": "group", "id": "g", "members": ["app", "user"]}])
        )
        .contains("same group")
    );
    let out = run(
        EDITOR,
        json!([{"op": "group", "id": "lane1", "label": "Customer", "members": ["web"], "kind": "lane"}]),
    );
    let p = page(&out);
    let (lane, web) = (p.abs("lane1").unwrap(), p.abs("web").unwrap());
    assert!(web.x - lane.x >= 30.0 && web.y - lane.y >= 10.0);
}

#[test]
fn delete_takes_the_arrows_and_what_a_group_holds() {
    let out = run(EDITOR, json!([{"op": "delete", "ids": ["api"]}]));
    let p = page(&out);
    assert!(p.get("api").is_none() && p.get("e1").is_none() && p.get("e2").is_none());
    assert!(p.get("web").is_some() && p.get("db").is_some());
    assert_eq!(out.applied.deleted, 3);
    let out = run(NESTED, json!([{"op": "delete", "ids": ["vpc"]}]));
    let p = page(&out);
    assert_eq!(
        (p.count(), p.get("app").is_none(), p.get("outer").is_none()),
        (1, true, true)
    );
    assert!(fails(EDITOR, json!([{"op": "delete", "ids": ["1"]}])).contains("No node or edge"));
    assert!(fails(EDITOR, json!([{"op": "delete", "ids": []}])).contains("Name the cells"));
}

#[test]
fn pages_are_added_chosen_renamed_and_resized() {
    let out = run(
        EDITOR,
        json!([
            {"op": "add_page", "name": "Details"},
            {"op": "add_node", "id": "d1", "label": "Only here"},
            {"op": "set_page", "page": "Page-1", "name": "Overview", "width": 1169, "height": 827},
            {"op": "add_node", "id": "o1", "label": "Back on the first"},
        ]),
    );
    let doc = Doc::parse(&out.xml).unwrap();
    assert_eq!(doc.pages.len(), 2);
    assert!(doc.pages[1].get("d1").is_some() && doc.pages[0].get("d1").is_none());
    assert!(doc.pages[0].get("o1").is_some());
    assert_eq!(
        (
            doc.pages[0].name.as_str(),
            doc.pages[0].width,
            doc.pages[0].height
        ),
        ("Overview", Some(1169.0), Some(827.0))
    );
    // The same id may be used on another page.
    assert!(
        replay(
            &out.xml,
            Some("Details"),
            None,
            &steps(json!([{"op": "add_node", "id": "o1"}]))
        )
        .is_ok()
    );
    assert!(fails(EDITOR, json!([{"op": "set_page", "page": "Nope"}])).contains("No page called"));
}

#[test]
fn a_page_may_be_as_wide_as_a_long_pipeline_but_not_without_end() {
    let out = run(
        EDITOR,
        json!([{"op": "set_page", "page": "Page-1", "width": 20880, "height": 900}]),
    );
    assert_eq!(Doc::parse(&out.xml).unwrap().pages[0].width, Some(20880.0));
    let why = fails(
        EDITOR,
        json!([{"op": "set_page", "page": "Page-1", "width": 250000}]),
    );
    assert!(why.contains("between 1 and 100000"), "{why}");
}

#[test]
fn refusals_say_which_step_and_why_and_change_nothing() {
    for (step, want) in [
        (json!({"op": "add_node", "id": "web"}), "already used"),
        (json!({"op": "add_node", "id": "bad id"}), "not a good id"),
        (
            json!({"op": "add_node", "id": "n", "kind": "unicorn"}),
            "No node kind",
        ),
        (
            json!({"op": "add_node", "id": "n", "shape": "nope.nothing"}),
            "diagram_find_shapes",
        ),
        (json!({"op": "add_node", "id": "n", "x": 1}), "both x and y"),
        (
            json!({"op": "add_node", "id": "n", "near": "ghost"}),
            "No node called",
        ),
        (
            json!({"op": "add_node", "id": "n", "w": 0}),
            "between 1 and 5000",
        ),
        (
            json!({"op": "add_node", "id": "n", "set": {"image": "https://x.example/a.png"}}),
            "picture",
        ),
        (
            json!({"op": "add_node", "id": "n", "set": {"fillColor": "#fff;strokeColor=red"}}),
            "semicolon",
        ),
        (
            json!({"op": "add_edge", "from": "web", "to": "ghost"}),
            "No node called “ghost”",
        ),
        (
            json!({"op": "add_edge", "from": "web", "to": "api", "kind": "wormhole"}),
            "No edge kind",
        ),
        (
            json!({"op": "update", "id": "ghost", "label": "x"}),
            "No node or edge",
        ),
        (
            json!({"op": "restyle", "ids": ["web"], "token": "mauve"}),
            "No colour",
        ),
        (
            json!({"op": "restyle", "ids": ["web"], "kind": "service", "preset": "service"}),
            "not both",
        ),
        (json!({"op": "layout", "direction": "diagonal"}), "LR or TB"),
        (json!({"op": "resize", "id": "e1", "w": 10}), "No node"),
    ] {
        let message = fails(EDITOR, json!([step.clone()]));
        assert!(
            message.contains(want) && message.starts_with("Step 1"),
            "{step}: {message}"
        );
    }
    let message = fails(
        EDITOR,
        json!([{"op": "add_node", "id": "ok"}, {"op": "delete", "ids": ["nope"]}]),
    );
    assert!(message.starts_with("Step 2 (delete)"), "{message}");
    // A step the format does not know, or a word it does not take, is refused when it is read.
    assert!(serde_json::from_value::<Vec<Step>>(json!([{"op": "teleport"}])).is_err());
    assert!(
        serde_json::from_value::<Vec<Step>>(
            json!([{"op": "add_node", "id": "a", "colour": "red"}])
        )
        .is_err()
    );
}

#[test]
fn the_limits_on_steps_and_cells_hold() {
    let many: Vec<Value> = (0..201)
        .map(|i| json!({"op": "add_node", "id": format!("n{i}")}))
        .collect();
    assert!(fails(EDITOR, json!(many)).contains("At most 200 steps"));
    // The cell limit counts what a run adds, however the steps are spread:
    // the 501st cell is the one refused.
    let nodes = steps(json!(
        (0..501)
            .map(|i| json!({"op": "add_node", "id": format!("n{i}"), "x": (i % 25) * 30, "y": (i / 25) * 30, "w": 20, "h": 20}))
            .collect::<Vec<_>>()
    ));
    let mut run = Runner::new(EDITOR, None, None).unwrap();
    let mut failed = None;
    for (i, s) in nodes.iter().enumerate() {
        if let Err(e) = run.step(s) {
            failed = Some((i, e.to_string()));
            break;
        }
    }
    let (at, why) = failed.unwrap();
    assert_eq!(at, 500);
    assert!(why.contains("at most 500 cells"), "{why}");
    // A diagram may hold 2,000 cells in all.
    let mut big = EDITOR.to_owned();
    for call in 0..10 {
        let batch = steps(json!(
            (0..200)
                .map(|i| json!({"op": "add_node", "id": format!("c{call}-{i}"), "x": i * 5, "y": call * 5, "w": 5, "h": 5}))
                .collect::<Vec<_>>()
        ));
        match replay(&big, None, None, &batch) {
            Ok(out) => big = out.xml,
            Err(err) => {
                assert_eq!(call, 9, "{err}");
                assert!(err.to_string().contains("at most 2000 cells"), "{err}");
            }
        }
    }
    assert_eq!(Doc::parse(&big).unwrap().count(), 1805);
}

#[test]
fn a_run_made_again_on_a_diagram_that_changed_drops_only_the_steps_that_cannot_be_made() {
    let list = steps(json!([
        {"op": "add_node", "id": "cache", "label": "Cache", "kind": "cache"},
        {"op": "add_edge", "from": "api", "to": "cache"},
        {"op": "add_edge", "from": "api", "to": "gone", "id": "bad"},
        {"op": "restyle", "ids": ["web"], "token": "purple"},
    ]));
    let (out, kept, skipped) = replay_tolerant(EDITOR, None, None, &list).unwrap();
    assert_eq!(kept.len(), 3);
    assert_eq!(skipped.len(), 1);
    assert_eq!(skipped[0].step, 2);
    assert!(skipped[0].why.contains("gone"), "{}", skipped[0].why);
    assert_eq!(out.applied.nodes, 1);
    assert!(page(&out).get("bad").is_none() && page(&out).get("e-api-cache").is_some());
    // The same list, strictly, stops at the step that cannot be made.
    assert!(replay(EDITOR, None, None, &list).is_err());
}

#[test]
fn steps_are_told_in_words_and_survive_json() {
    let list = steps(json!([
        {"op": "add_node", "id": "a"}, {"op": "add_node", "id": "b"}, {"op": "add_node", "id": "c"},
        {"op": "add_edge", "from": "a", "to": "b"}, {"op": "add_edge", "from": "b", "to": "c"},
        {"op": "layout"},
    ]));
    assert_eq!(summarize(&list), "add 3 nodes, 2 links, layout");
    assert_eq!(summarize(&[]), "no changes");
    let back: Vec<Step> = serde_json::from_value(serde_json::to_value(&list).unwrap()).unwrap();
    assert_eq!(back, list);
    assert!(describe(&list).contains("connect a → b"));
}

#[test]
fn a_diagram_is_made_from_nothing() {
    let out = from_steps(
        Some("flowchart"),
        &steps(json!([
            {"op": "add_node", "id": "s", "label": "Start", "kind": "terminator"},
            {"op": "add_node", "id": "q", "label": "Ready?", "kind": "decision"},
            {"op": "add_edge", "from": "s", "to": "q"},
        ])),
    )
    .unwrap();
    let p = page(&out);
    assert_eq!(p.count(), 3);
    assert_eq!(p.get("q").unwrap().style.bare(), Some("rhombus"));
    assert!(replay(&crate::diagrams::blank_xml(), None, Some("nope"), &[]).is_err());
}
