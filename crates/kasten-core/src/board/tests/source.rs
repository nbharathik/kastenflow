//! What a board keeps about the page it was made from (`x-kasten.source`):
//! one object the app writes whole, which the core checks, carries through
//! every other edit, and reads the page's id from.

use serde_json::{Value, json};

use super::{NOW, invalid, keys};
use crate::board::{BoardChange, BoardView, Canvas};

fn canvas() -> Canvas {
    let text = r#"{"nodes": [], "edges": [], "x-kasten": {"title": "Trip map", "theirs": 1}}"#;
    Canvas::parse(text).unwrap()
}

fn source() -> Value {
    json!({
        "page": "01J8ZQ6K3V",
        "root": "a1",
        "synced": "3f9a",
        "branches": {"b1": {"p": "a1", "t": "Where to stay"}, "b2": {"p": "b1", "t": "Baixa"}},
    })
}

fn put(canvas: &mut Canvas, source: Value) -> crate::error::Result<Vec<String>> {
    canvas.apply(
        &[BoardChange::Source {
            source: Some(source),
        }],
        NOW,
    )
}

fn extras(canvas: &Canvas) -> Value {
    canvas.to_value()["x-kasten"].clone()
}

#[test]
fn a_board_remembers_the_page_it_was_made_from() {
    let mut canvas = canvas();
    assert_eq!(canvas.source_page(), None);
    put(&mut canvas, source()).unwrap();
    assert_eq!(extras(&canvas)["source"], source());
    assert_eq!(extras(&canvas)["theirs"], 1, "other extras stay");
    assert_eq!(keys(&extras(&canvas)), ["title", "theirs", "source"]);
    assert_eq!(canvas.source_page(), Some("01J8ZQ6K3V"));
    let view = BoardView::with_titles("library/trip-map.canvas", &canvas, |_| None);
    assert_eq!(view.source, Some(source()));
    let shown = serde_json::to_value(&view).unwrap();
    assert_eq!(shown["source"]["branches"]["b2"]["t"], "Baixa");
}

#[test]
fn a_board_without_one_shows_none() {
    let view = BoardView::with_titles("library/trip-map.canvas", &canvas(), |_| None);
    assert_eq!(view.source, None);
    assert!(serde_json::to_value(&view).unwrap().get("source").is_none());
}

#[test]
fn replacing_it_keeps_its_place_and_clearing_removes_it() {
    let mut canvas = canvas();
    put(&mut canvas, source()).unwrap();
    canvas
        .apply(
            &[BoardChange::Sticky {
                text: "Mine".into(),
                x: 0,
                y: 0,
            }],
            NOW,
        )
        .unwrap();
    let mut next = source();
    next["synced"] = "77aa".into();
    put(&mut canvas, next.clone()).unwrap();
    assert_eq!(extras(&canvas)["source"], next);
    assert_eq!(keys(&extras(&canvas)), ["title", "theirs", "source"]);

    canvas
        .apply(&[BoardChange::Source { source: None }], NOW)
        .unwrap();
    assert!(extras(&canvas).get("source").is_none());
    assert_eq!(canvas.source_page(), None);
    assert_eq!(extras(&canvas)["theirs"], 1);
    // Clearing what is not there is fine.
    canvas
        .apply(&[BoardChange::Source { source: None }], NOW)
        .unwrap();
}

#[test]
fn other_edits_carry_it_along_and_it_survives_a_write() {
    let mut canvas = canvas();
    put(&mut canvas, source()).unwrap();
    let made = canvas
        .apply(
            &[BoardChange::Sticky {
                text: "Idea".into(),
                x: 0,
                y: 0,
            }],
            NOW,
        )
        .unwrap();
    canvas
        .apply(&[BoardChange::Remove { ids: made }], NOW)
        .unwrap();
    // The branches it names are only remembered: a node taken off by hand
    // stays out when the page is read again, so nothing here follows it.
    assert_eq!(extras(&canvas)["source"], source());
    let again = Canvas::parse(&canvas.to_text()).unwrap();
    assert_eq!(extras(&again)["source"], source());
    assert_eq!(again.source_page(), Some("01J8ZQ6K3V"));
}

#[test]
fn comes_from_the_app_as_json() {
    let set: BoardChange =
        serde_json::from_value(json!({"kind": "source", "source": {"page": "p1"}})).unwrap();
    assert_eq!(
        set,
        BoardChange::Source {
            source: Some(json!({"page": "p1"}))
        }
    );
    for clear in [
        json!({"kind": "source", "source": null}),
        json!({"kind": "source"}),
    ] {
        let clear: BoardChange = serde_json::from_value(clear).unwrap();
        assert_eq!(clear, BoardChange::Source { source: None });
    }
}

#[test]
fn refuses_what_is_not_a_page_source() {
    let many: serde_json::Map<String, Value> =
        (0..1_001).map(|i| (format!("n{i}"), json!({}))).collect();
    let cases = [
        (json!("page"), "an object"),
        (json!([]), "an object"),
        (json!({"root": "a"}), "names its page"),
        (json!({"page": ""}), "names its page"),
        (json!({"page": "  "}), "names its page"),
        (json!({"page": 7}), "names its page"),
        (json!({"page": "p", "branches": []}), "branches"),
        (json!({"page": "p", "branches": {"a": "x"}}), "branches"),
        (json!({"page": "p", "branches": many}), "at most"),
    ];
    for (bad, why) in cases {
        let mut canvas = canvas();
        let before = canvas.to_value();
        let message = invalid(put(&mut canvas, bad.clone()));
        assert!(message.contains(why), "{bad}: {message}");
        assert_eq!(canvas.to_value(), before, "{bad}: nothing changes");
    }
}

#[test]
fn a_refused_batch_leaves_the_whole_board_as_it_was() {
    let mut canvas = canvas();
    let before = canvas.to_value();
    let result = canvas.apply(
        &[
            BoardChange::Sticky {
                text: "Never".into(),
                x: 0,
                y: 0,
            },
            BoardChange::Source {
                source: Some(json!({"page": ""})),
            },
        ],
        NOW,
    );
    assert!(result.is_err());
    assert_eq!(canvas.to_value(), before);
}
