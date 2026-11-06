//! Drawing slides for the agent to look at, and lint with text measured by a browser.

use std::collections::BTreeMap;

use serde_json::json;

use super::{Kit, OUTLINE};
use crate::agent::images::tests::png;
use crate::agent::{Draw, Drawn};
use crate::lint::{Measure, Measures, Refs};

#[test]
fn where_nothing_draws_the_render_tools_say_so_and_what_to_use_instead() {
    let mut kit = Kit::new();
    let name = kit.make("# D\n\n## A\n- x");
    for tool in ["render_slide", "render_grid"] {
        let message = kit.err(tool, json!({ "deck": name, "slide": 2 }));
        assert!(
            message.contains("not available") && message.contains("lint_deck"),
            "{message}"
        );
    }
}

#[test]
fn where_something_draws_a_slide_and_the_grid_come_back_as_pictures() {
    let mut kit = Kit::new();
    let name = kit.make(OUTLINE);
    kit.store.picture = Some(Drawn {
        png: png(64, 36),
        width: 1920,
        height: 1080,
        warnings: vec!["a font was substituted".to_owned()],
    });
    let out = kit
        .call(
            "render_slide",
            json!({ "deck": name, "slide": 2, "step": 1, "scale": 2 }),
        )
        .unwrap();
    assert_eq!(out.images.len(), 1);
    assert_eq!(out.images[0].mime, "image/png");
    assert_eq!(&out.images[0].bytes[..4], &[0x89, b'P', b'N', b'G']);
    let data = out.data.unwrap();
    assert_eq!(
        (
            &data["number"],
            &data["step"],
            &data["width"],
            &data["height"]
        ),
        (&json!(2), &json!(1), &json!(1920), &json!(1080))
    );
    assert_eq!(data["warnings"], json!(["a font was substituted"]));
    assert_eq!(
        kit.store.drawn,
        vec![Draw::Slide {
            slide: 1,
            step: Some(1),
            scale: 2.0
        }]
    );

    // The slide asked for by its id, at the default scale and as it ends.
    let id = kit.deck(&name).slides[2].id.clone();
    kit.ok("render_slide", json!({ "deck": name, "slide": id }));
    assert_eq!(
        kit.store.drawn[1],
        Draw::Slide {
            slide: 2,
            step: None,
            scale: 1.0
        }
    );

    let grid = kit.call("render_grid", json!({ "deck": name })).unwrap();
    assert_eq!(grid.images.len(), 1);
    assert_eq!(kit.store.drawn.last(), Some(&Draw::Grid));
}

#[test]
fn a_picture_of_a_slide_that_is_not_there_or_at_a_step_that_makes_no_sense_is_refused_before_drawing()
 {
    let mut kit = Kit::new();
    let name = kit.make("# D\n\n## A\n- x");
    kit.store.picture = Some(Drawn {
        png: png(8, 8),
        width: 8,
        height: 8,
        warnings: Vec::new(),
    });
    assert!(
        kit.err(
            "render_slide",
            json!({ "deck": name, "slide": 2, "scale": 9 })
        )
        .contains("0.25 to 4")
    );
    assert!(
        kit.err(
            "render_slide",
            json!({ "deck": name, "slide": 2, "step": -1 })
        )
        .contains("counting from 0")
    );
    assert!(
        kit.err("render_slide", json!({ "deck": name, "slide": 99 }))
            .contains("99")
    );
    assert!(
        kit.err("render_slide", json!({ "deck": name }))
            .contains("Name the slide")
    );
    assert!(kit.store.drawn.is_empty(), "nothing was drawn");
}

#[test]
fn lint_deck_uses_the_sizes_a_browser_measured_when_the_store_has_them_and_says_which() {
    let mut kit = Kit::new();
    let name = kit.make("# D\n\n## A\n- x");
    let plain = kit.call("lint_deck", json!({ "deck": name })).unwrap();
    assert!(plain.text.contains("estimated"), "{}", plain.text);
    assert_eq!(plain.data.as_ref().unwrap()["textMeasured"], false);

    // A browser says the body text needs far more room than its box has.
    let deck = kit.deck(&name);
    let slide = &deck.slides[1];
    let body = slide
        .elements
        .iter()
        .find(|e| e.base().placeholder.as_deref() == Some("body"))
        .unwrap();
    let mut measures = Measures::default();
    measures.slides.insert(
        slide.id.clone(),
        BTreeMap::from([(
            body.id().to_owned(),
            Measure {
                text_width: 100.0,
                text_height: 5000.0,
                area_width: None,
                area_height: None,
            },
        )]),
    );
    kit.store.measures = Some(measures);
    let out = kit.call("lint_deck", json!({ "deck": name })).unwrap();
    assert!(
        out.text.contains("text-overflow") && out.text.contains("measured in a browser"),
        "{}",
        out.text
    );
    assert_eq!(out.data.unwrap()["textMeasured"], true);
}

fn picture() -> Drawn {
    Drawn {
        png: png(64, 36),
        width: 1920,
        height: 540,
        warnings: Vec::new(),
    }
}

fn banner() -> serde_json::Value {
    json!([{ "type": "text", "id": "banner", "x": 50, "y": 400, "w": 400, "h": 60, "markdown": "Hello" }])
}

#[test]
fn a_slide_is_drawn_with_proposed_elements_and_nothing_is_written() {
    let mut kit = Kit::new();
    let name = kit.make(OUTLINE);
    kit.store.picture = Some(picture());
    let before = kit.store.decks[&name].clone();
    let count = kit.deck(&name).slides[1].elements.len();
    let out = kit
        .call(
            "render_slide",
            json!({ "deck": name, "slide": 2, "elements": banner() }),
        )
        .unwrap();
    let data = out.data.unwrap();
    assert_eq!(data["proposed"], true);
    assert!(data.get("render").is_none(), "{data}");
    assert_eq!(out.images.len(), 1);
    let shown = kit.store.shown.last().unwrap();
    assert_eq!(shown.slides[1].elements.len(), count + 1);
    assert_eq!(kit.store.decks[&name], before, "the deck is untouched");

    // Without a proposal the answer carries an id to compare against later.
    let plain = kit.ok("render_slide", json!({ "deck": name, "slide": 2 }));
    assert!(plain["render"].as_str().unwrap().contains(":s-"), "{plain}");
    assert!(plain["hash"].is_string());

    // A proposal that cannot be made is said, and nothing is drawn.
    kit.store.shown.clear();
    let why = kit.err(
        "render_slide",
        json!({ "deck": name, "slide": 2, "elements": "no" }),
    );
    assert!(why.contains("elements"), "{why}");
    assert!(kit.store.shown.is_empty());
}

#[test]
fn a_proposed_change_is_drawn_beside_the_slide_as_it_is_with_the_new_box_outlined() {
    let mut kit = Kit::new();
    let name = kit.make(OUTLINE);
    kit.store.picture = Some(picture());
    let before = kit.store.decks[&name].clone();
    let out = kit
        .call(
            "render_diff",
            json!({ "deck": name, "slide": 2, "elements": banner() }),
        )
        .unwrap();
    assert_eq!(out.images.len(), 1);
    let data = out.data.unwrap();
    assert_eq!(data["proposed"], true);
    assert_eq!(data["after"], "proposed");
    assert_eq!(data["outlined"], json!({ "before": 0, "after": 1 }));
    assert_eq!(
        kit.store.compared.last().unwrap(),
        &(Vec::new(), vec![[50.0, 400.0, 400.0, 60.0]])
    );
    assert_eq!(kit.store.decks[&name], before, "nothing was written");
}

#[test]
fn a_change_that_was_made_is_drawn_against_the_version_a_hash_names() {
    let mut kit = Kit::new();
    let name = kit.make(OUTLINE);
    kit.store.picture = Some(picture());
    let first = kit.store.versions[0].hash.clone();
    kit.ok(
        "add_elements",
        json!({ "deck": name, "slide": 2, "elements": banner() }),
    );
    // Either the bare hash or the id render_slide gave.
    for given in [first.clone(), format!("{first}:s-1")] {
        let out = kit
            .call(
                "render_diff",
                json!({ "deck": name, "slide": 2, "before": given }),
            )
            .unwrap();
        let data = out.data.unwrap();
        assert_eq!(data["before"], json!(first));
        assert_eq!(data["proposed"], false);
        assert_eq!(data["outlined"]["after"], 1, "{data}");
        assert_eq!(data["outlined"]["before"], 0, "{data}");
    }
    // With nothing named, it is the version before the latest.
    let out = kit
        .call("render_diff", json!({ "deck": name, "slide": 2 }))
        .unwrap();
    assert_eq!(out.data.unwrap()["outlined"]["after"], 1);
}

#[test]
fn a_comparison_with_nothing_to_compare_or_nowhere_to_draw_says_what_to_do() {
    let mut kit = Kit::new();
    let name = kit.make("# D\n\n## A\n- x");
    // Nothing has changed since the deck was first read.
    kit.store.picture = Some(picture());
    let why = kit.err("render_diff", json!({ "deck": name, "slide": 2 }));
    assert!(why.contains("no earlier version"), "{why}");
    let why = kit.err(
        "render_diff",
        json!({ "deck": name, "slide": 2, "before": "ffffffffffffffff" }),
    );
    assert!(why.contains("is not kept"), "{why}");
    assert!(
        kit.err(
            "render_diff",
            json!({ "deck": name, "slide": 2, "step": -1 })
        )
        .contains("counting from 0")
    );
    // Where nothing draws, lint is what is left.
    kit.store.picture = None;
    let why = kit.err(
        "render_diff",
        json!({ "deck": name, "slide": 2, "elements": banner() }),
    );
    assert!(
        why.contains("not available") && why.contains("lint_deck"),
        "{why}"
    );
    assert!(kit.store.compared.is_empty());
}

const BIB: &str = "@inproceedings{vaswani2017attention, title={Attention is all you need}, author={Vaswani, Ashish and Shazeer, Noam and Parmar, Niki and Uszkoreit, Jakob}, booktitle={Advances in Neural Information Processing Systems}, year={2017}}";

#[test]
fn lint_reads_the_bibliography_the_store_has_so_a_known_key_passes_and_a_typo_is_named() {
    let mut kit = Kit::new();
    let name = kit.make("# D\n\n## A\n- x");
    let cite = |keys: serde_json::Value| {
        json!({ "deck": name, "slide": 2, "elements": [
            { "type": "citation", "id": "cite", "x": 64, "y": 480, "w": 700, "h": 30, "keys": keys }
        ] })
    };
    kit.store.refs = Some(Refs::from_bibtex(BIB));

    // A key of the bibliography: nothing is wrong, and nothing was left unmeasured.
    let ok = kit.ok("add_elements", cite(json!(["vaswani2017attention"])));
    assert_eq!(ok["lint"]["errors"], 0, "{}", ok["lint"]);
    let lint = kit.call("lint_deck", json!({ "deck": name })).unwrap();
    assert!(
        !lint.text.contains("unresolved-citation") && !lint.text.contains("no measurement"),
        "{}",
        lint.text
    );

    // A key that is not: an error that names the near one.
    kit.ok("add_elements", cite(json!(["vaswani2017atention"])));
    let lint = kit.call("lint_deck", json!({ "deck": name })).unwrap();
    assert!(
        lint.text.contains("unresolved-citation") && lint.text.contains("vaswani2017attention"),
        "{}",
        lint.text
    );
}
