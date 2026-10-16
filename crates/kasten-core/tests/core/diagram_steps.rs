//! Typed steps against the golden diagrams under random sequences: whatever
//! a run does, the result is a diagram the editor can open, a cell no step
//! changed keeps its bytes, and the same run twice gives the same text.

use kasten_core::diagrams::check_xml;
use kasten_core::diagrams::model::{Doc, cell_blocks};
use kasten_core::diagrams::steps::{Step, replay, replay_tolerant};
use proptest::prelude::*;
use serde_json::{Value, json};

macro_rules! fixture {
    ($name:literal) => {
        include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/diagrams/",
            $name
        ))
    };
}

const FILES: [&str; 4] = [
    fixture!("editor-output.drawio"),
    fixture!("nested-container.drawio"),
    fixture!("c4-objects.drawio"),
    fixture!("bare-model.drawio"),
];

/// Ids that exist in some fixture, ids a step makes, and ids that exist nowhere.
const IDS: [&str; 18] = [
    "web", "api", "db", "e1", "e2", "vpc", "app", "cache", "user", "cust", "shop", "docs", "a",
    "b", "n0", "n1", "n2", "ghost",
];

fn id() -> impl Strategy<Value = &'static str> {
    prop::sample::select(IDS.to_vec())
}

fn step() -> impl Strategy<Value = Value> {
    prop_oneof![
        (
            id(),
            "[a-zA-Z <>&\n]{0,24}",
            prop::option::of(prop::sample::select(vec![
                "service", "database", "queue", "decision", "unicorn"
            ]))
        )
            .prop_map(
                |(i, label, kind)| json!({"op": "add_node", "id": i, "label": label, "kind": kind})
            ),
        (id(), id(), prop::option::of("[a-z ]{0,10}")).prop_map(
            |(a, b, label)| json!({"op": "add_edge", "from": a, "to": b, "label": label})
        ),
        (id(), "[a-z ]{0,10}").prop_map(|(i, l)| json!({"op": "update", "id": i, "label": l})),
        (
            id(),
            prop::sample::select(vec!["blue", "red", "green", "mauve"])
        )
            .prop_map(|(i, t)| json!({"op": "restyle", "ids": [i], "token": t})),
        (id(), -300i32..300, -300i32..300)
            .prop_map(|(i, dx, dy)| json!({"op": "move", "id": i, "dx": dx, "dy": dy})),
        (id(), 10i32..400).prop_map(|(i, w)| json!({"op": "resize", "id": i, "w": w})),
        (id(), id()).prop_map(
            |(a, b)| json!({"op": "group", "id": format!("g-{a}-{b}"), "members": [a, b]})
        ),
        id().prop_map(|i| json!({"op": "ungroup", "id": i})),
        id().prop_map(|i| json!({"op": "delete", "ids": [i]})),
        Just(json!({"op": "layout"})),
    ]
}

fn kept_bytes(before: &str, after: &str) -> Result<(), TestCaseError> {
    let old = Doc::parse(before).unwrap();
    let new = Doc::parse(after).unwrap();
    let blocks = cell_blocks(after).unwrap();
    for (id, block) in cell_blocks(before).unwrap() {
        let same = old.pages[0]
            .get(&id)
            .zip(new.pages[0].get(&id))
            .is_some_and(|(a, b)| a.values() == b.values());
        if same {
            prop_assert!(
                blocks.iter().any(|(i, b)| *i == id && *b == block),
                "{} changed its bytes",
                id
            );
        }
    }
    Ok(())
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(96))]

    #[test]
    fn whatever_steps_do_the_result_opens_and_untouched_cells_keep_their_bytes(
        file in 0usize..4,
        steps in prop::collection::vec(step(), 0..14),
    ) {
        let xml = FILES[file];
        let steps: Vec<Step> = steps.into_iter().filter_map(|s| serde_json::from_value(s).ok()).collect();
        let (out, kept, _) = replay_tolerant(xml, None, None, &steps).unwrap();
        prop_assert!(check_xml(&out.xml).is_ok());
        prop_assert!(Doc::parse(&out.xml).is_ok());
        kept_bytes(xml, &out.xml)?;
        // The steps that were made, made strictly, give the same text; twice, the same again.
        let again = replay(xml, None, None, &kept).unwrap();
        prop_assert_eq!(&again.xml, &out.xml);
        prop_assert_eq!(replay(xml, None, None, &kept).unwrap().xml, again.xml);
        prop_assert_eq!(out.changed, out.xml != xml);
    }

    #[test]
    fn no_steps_is_the_identity(file in 0usize..4) {
        let out = replay(FILES[file], None, None, &[]).unwrap();
        prop_assert_eq!(out.xml, FILES[file]);
    }
}
