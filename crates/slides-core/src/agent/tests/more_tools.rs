//! The tools that build a whole deck, write notes in bulk, swap a picture everywhere, place a diagram, fill a chart,
//! and export pictures; and what an agent is told when a deck is from a newer version.

use serde_json::{Value, json};

use super::{Kit, OUTLINE, with_picture};
use crate::agent::images::tests::png;
use crate::agent::{Drawn, tools};
use crate::model::{Element, SourceKind};

fn spec() -> Value {
    json!({
        "title": "Quarterly review", "theme": "Light",
        "slides": [
            { "layout": "title", "slots": { "title": "Quarterly review", "subtitle": "Q3" }, "notes": "Open warmly." },
            { "layout": "title-body", "slots": { "title": "Why now", "body": "- Costs fell\n- Demand grew" }, "notes": "Two points.", "steps": "reveal" },
            { "layout": "title-only", "slots": { "title": "Sales" }, "elements": [
                { "type": "chart", "x": 80, "y": 150, "w": 800, "h": 340, "kind": "bar", "categories": ["A", "B"], "series": [{ "name": "S", "values": [1, 2] }] }
            ] },
            { "layout": "section", "slots": { "title": "Part two" }, "hidden": true },
            { "layout": "title-body", "slots": { "title": "Only a title" } }
        ]
    })
}

#[test]
fn the_new_tools_are_listed_with_their_words() {
    let all = tools();
    for name in [
        "build_deck",
        "place_diagram",
        "replace_asset",
        "set_notes_bulk",
        "slides_help",
        "set_chart_data",
    ] {
        let tool = all
            .iter()
            .find(|t| t.name == name)
            .unwrap_or_else(|| panic!("{name}"));
        assert!(tool.description.len() > 60, "{name}");
    }
    assert!(
        all.iter()
            .find(|t| t.name == "slides_help")
            .unwrap()
            .read_only
    );
}

#[test]
fn a_whole_deck_is_built_from_one_spec_in_one_write() {
    let mut kit = Kit::new();
    let out = kit.ok("build_deck", spec());
    assert_eq!(out["title"], "Quarterly review");
    assert_eq!(
        out["slides"].as_array().unwrap().len(),
        5,
        "the spec's slides and no other"
    );
    assert!(out["lint"].is_object());
    let name = out["deck"].as_str().unwrap().to_owned();
    assert_eq!(kit.store.decks.len(), 1, "one deck, written once");
    assert_eq!(kit.store.versions.len(), 1, "one version in the history");
    let deck = kit.deck(&name);
    assert_eq!(deck.slides.len(), 5);
    assert_eq!(deck.slides[0].layout, "title");
    assert_eq!(deck.slides[0].notes, "Open warmly.");
    assert!(deck.slides[1].steps >= 1, "reveal gives the slide clicks");
    assert!(
        deck.slides[2]
            .elements
            .iter()
            .any(|e| matches!(e, Element::Chart(_)))
    );
    assert!(deck.slides[3].hidden);
    // A slot nothing was written for is not left asking to be filled.
    assert_eq!(
        deck.slides[4].elements.len(),
        1,
        "{:?}",
        deck.slides[4].elements.len()
    );
    // The agent can go on with it by the name it was given.
    kit.ok("get_deck", json!({ "deck": name }));
}

#[test]
fn every_problem_of_a_spec_is_told_at_once_and_nothing_is_written() {
    let mut kit = Kit::new();
    let why = kit.err(
        "build_deck",
        json!({ "title": "X", "slides": [
            { "layout": "nope", "slots": { "title": "A" } },
            { "layout": "title-body", "slots": { "headline": "B" } },
            { "layout": "title-body", "colour": "red" },
            { "layout": "title-body", "steps": "dance" },
            "text",
            { "layout": "title-only", "elements": [{ "type": "text", "x": 1 }] }
        ] }),
    );
    assert!(
        why.contains("Nothing was written") && why.contains("6 problems"),
        "{why}"
    );
    for wanted in [
        "`slides[0]` (nope)",
        "no slot `headline`",
        "`slides[2].colour` is not a field of a slide",
        "`slides[3].steps`",
        "`slides[4]` must be an object",
        "`slides[5]` (title-only)",
    ] {
        assert!(why.contains(wanted), "{wanted} in {why}");
    }
    assert!(kit.store.decks.is_empty());
    let few = kit.err("build_deck", json!({ "slides": [] }));
    assert!(
        few.contains("`title` is missing") && few.contains("`slides` is empty"),
        "{few}"
    );
    let theme = kit.err(
        "build_deck",
        json!({ "title": "X", "theme": "Neon", "slides": [{}] }),
    );
    assert!(theme.contains("`theme`"), "{theme}");
    let odd = kit.err(
        "build_deck",
        json!({ "title": "X", "colours": 1, "slides": [{}] }),
    );
    assert!(
        odd.contains("`colours` is not a field of the spec"),
        "{odd}"
    );
}

#[test]
fn notes_for_many_slides_are_written_together_or_not_at_all() {
    let mut kit = Kit::new();
    let name = kit.make(OUTLINE);
    let out = kit.ok(
        "set_notes_bulk",
        json!({ "deck": name, "notes": [{ "slide": 1, "notes": "Hello." }, { "slide": 2, "notes": "**Ask** first." }] }),
    );
    assert_eq!(out["result"]["slides"].as_array().unwrap().len(), 2);
    let deck = kit.deck(&name);
    assert_eq!(
        (deck.slides[0].notes.as_str(), deck.slides[1].notes.as_str()),
        ("Hello.", "**Ask** first.")
    );
    let before = kit.store.decks[&name].clone();
    let why = kit.err(
        "set_notes_bulk",
        json!({ "deck": name, "notes": [{ "slide": 3, "notes": "ok" }, { "slide": 99, "notes": "lost" }, { "slide": 1, "notes": 5 }, { "slide": 3, "notes": "twice" }] }),
    );
    assert!(why.contains("Nothing was changed"), "{why}");
    assert!(
        why.contains("`notes[2].notes` must be text") && why.contains("There is no slide `99`"),
        "{why}"
    );
    assert_eq!(kit.store.decks[&name], before, "nothing was written");
    // An object of slide to notes is taken too, and an empty note clears one.
    kit.ok(
        "set_notes_bulk",
        json!({ "deck": name, "notes": { "1": "" } }),
    );
    assert_eq!(kit.deck(&name).slides[0].notes, "");
    assert!(
        kit.err("set_notes_bulk", json!({ "deck": name }))
            .contains("`notes` is a list")
    );
}

#[test]
fn a_picture_is_swapped_everywhere_a_deck_uses_it_and_the_old_one_stays() {
    let mut kit = Kit::new();
    let name = kit.make(OUTLINE);
    let old = with_picture(&mut kit, "old.png", 64, 32);
    let new = with_picture(&mut kit, "new.png", 32, 32);
    kit.ok("place_image", json!({ "deck": name, "slide": 2, "src": old, "box": { "x": 60, "y": 150, "w": 200, "h": 100 } }));
    kit.ok(
        "add_elements",
        json!({ "deck": name, "slide": 3, "elements": [
        { "type": "group", "id": "g", "x": 0, "y": 0, "w": 300, "h": 200, "children": [
            { "type": "image", "id": "inner", "src": old, "x": 10, "y": 10, "w": 100, "h": 50 } ] }
    ] }),
    );
    kit.ok(
        "set_background",
        json!({ "deck": name, "slide": 4, "background": { "image": old } }),
    );
    let out = kit.ok(
        "replace_asset",
        json!({ "deck": name, "from": old, "to": new }),
    );
    assert_eq!(
        (
            out["result"]["pictures"].as_u64(),
            out["result"]["backgrounds"].as_u64()
        ),
        (Some(2), Some(1))
    );
    let text = kit.store.decks[&name].clone();
    assert!(
        !text.contains(&old) && text.matches(&new).count() == 3,
        "{text}"
    );
    assert!(kit.store.assets.contains_key(&old), "nothing is deleted");
    // A picture that is not used, one that is not there, and the same picture twice.
    let again = kit.ok(
        "replace_asset",
        json!({ "deck": name, "from": old, "to": new }),
    );
    assert_eq!(again["changed"], false);
    assert!(
        again["result"]["note"]
            .as_str()
            .unwrap()
            .contains("No slide")
    );
    assert!(
        kit.err(
            "replace_asset",
            json!({ "deck": name, "from": new, "to": "assets/missing.png" })
        )
        .contains("There is no picture")
    );
    assert!(
        kit.err(
            "replace_asset",
            json!({ "deck": name, "from": new, "to": new })
        )
        .contains("same picture")
    );
}

#[test]
fn a_diagram_is_placed_in_one_call_and_the_picture_remembers_it() {
    let mut kit = Kit::new();
    let name = kit.make(OUTLINE);
    kit.store.diagrams.insert(
        "projects/talk/flow.drawio".to_owned(),
        b"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"400\" height=\"200\"></svg>".to_vec(),
    );
    let out = kit.ok(
        "place_diagram",
        json!({ "deck": name, "slide": 2, "diagram": "Flow" }),
    );
    assert_eq!(out["diagram"], "projects/talk/flow.drawio");
    assert_eq!(out["asset"], "assets/flow.svg");
    assert_eq!(
        out["result"]["mode"], "auto",
        "the largest free space, without being asked"
    );
    assert!(kit.store.assets.contains_key("assets/flow.svg"));
    let deck = kit.deck(&name);
    let picture = deck.slides[1]
        .elements
        .iter()
        .find_map(|e| match e {
            Element::Image(i) if i.src == "assets/flow.svg" => Some(i),
            _ => None,
        })
        .expect("the picture is on the slide");
    let source = picture
        .base
        .source
        .as_ref()
        .expect("it remembers the diagram");
    assert_eq!(
        (
            source.diagram.as_deref(),
            source.kind.clone(),
            source.hash.is_some()
        ),
        (Some("projects/talk/flow.drawio"), SourceKind::Link, true)
    );
    assert!(picture.base.alt.as_deref().unwrap().contains("flow"));
    assert!(
        kit.err(
            "place_diagram",
            json!({ "deck": name, "slide": 2, "diagram": "nowhere" })
        )
        .contains("There is no diagram")
    );
    assert!(
        kit.err("place_diagram", json!({ "deck": name, "slide": 2 }))
            .contains("`diagram`")
    );
}

#[test]
fn a_chart_is_filled_through_the_tool_and_a_mistake_names_its_field() {
    let mut kit = Kit::new();
    let name = kit.make("# D\n\n## A\n- x");
    kit.ok("add_elements", json!({ "deck": name, "slide": 2, "elements": [
        { "type": "chart", "id": "ch", "x": 60, "y": 150, "w": 700, "h": 320, "kind": "bar", "categories": [], "series": [] }
    ] }));
    let out = kit.ok(
        "set_chart_data",
        json!({ "deck": name, "slide": 2, "id": "ch", "csv": "Quarter,Sales\nQ1,10\nQ2,20", "kind": "area", "yTitle": "Units", "format": "#,##0" }),
    );
    assert_eq!(out["result"]["kind"], "area");
    assert_eq!(out["result"]["series"], json!(["Sales"]));
    let text = kit.store.decks[&name].clone();
    assert!(
        text.contains("\"mark\": \"area\"") && text.contains("\"title\": \"Units\""),
        "{text}"
    );
    let why = kit.err(
        "set_chart_data",
        json!({ "deck": name, "slide": 2, "id": "ch", "csv": "Quarter,Sales\nQ1,ten" }),
    );
    assert!(why.contains("`csv` row 2, column"), "{why}");
}

#[test]
fn the_chart_tool_refuses_what_is_not_a_chart_and_a_field_it_does_not_know() {
    let mut kit = Kit::new();
    let name = kit.make("# D\n\n## A\n- x");
    kit.ok(
        "add_elements",
        json!({ "deck": name, "slide": 2, "elements": [
        { "type": "shape", "id": "box", "shape": "rect", "x": 0, "y": 0, "w": 50, "h": 50 }
    ] }),
    );
    let why = kit.err(
        "set_chart_data",
        json!({ "deck": name, "slide": 2, "id": "box", "title": "x" }),
    );
    assert!(why.contains("is a shape element, not a chart"), "{why}");
    let missing = kit.err(
        "set_chart_data",
        json!({ "deck": name, "slide": 2, "id": "nope" }),
    );
    assert!(missing.contains("There is no element `nope`"), "{missing}");
    assert!(
        kit.err("set_chart_data", json!({ "deck": name, "slide": 2 }))
            .contains("`id`")
    );
    let odd = kit.err(
        "set_chart_data",
        json!({ "deck": name, "slide": 2, "id": "box", "colour": 1 }),
    );
    assert!(odd.contains("`colour` is not a field"), "{odd}");
}

#[test]
fn png_pictures_of_the_slides_are_kept_in_the_assets_and_pdf_and_html_say_who_writes_them() {
    let mut kit = Kit::new();
    let name = kit.make(OUTLINE);
    let blind = kit.err("export", json!({ "deck": name, "format": "png" }));
    assert!(
        blind.contains("not available") && blind.contains("lint_deck"),
        "{blind}"
    );
    kit.store.picture = Some(Drawn {
        png: png(64, 36),
        width: 1920,
        height: 1080,
        warnings: Vec::new(),
    });
    let out = kit.ok("export", json!({ "deck": name, "format": "png" }));
    let slides = kit.deck(&name).slides.len();
    assert_eq!(out["files"].as_array().unwrap().len(), slides);
    let stem = name.trim_end_matches(".deck");
    assert!(
        kit.store
            .assets
            .contains_key(&format!("assets/{stem}-01.png"))
    );
    assert_eq!(out["files"][0]["width"], 1920);
    for format in ["pdf", "html"] {
        let why = kit.err("export", json!({ "deck": name, "format": format }));
        assert!(
            why.contains("KastenFlow Slides itself") && why.contains("png"),
            "{why}"
        );
    }
    let many: String = std::iter::once("# Long\n".to_owned())
        .chain((0..21).map(|i| format!("\n## Slide {i}\n- point\n")))
        .collect();
    let long = kit.make(&many);
    let why = kit.err("export", json!({ "deck": long, "format": "png" }));
    assert!(
        why.contains("too many") && why.contains("render_grid"),
        "{why}"
    );
}

#[test]
fn the_help_gives_the_order_of_work() {
    let mut kit = Kit::new();
    let out = kit.call("slides_help", json!({})).unwrap();
    assert!(
        out.text.contains("Outline") && out.text.contains("lint_deck"),
        "{}",
        out.text
    );
}

#[test]
fn a_deck_from_a_newer_version_says_what_it_uses_and_to_update() {
    let mut kit = Kit::new();
    let name = kit.make("# D\n\n## A\n- x");
    kit.ok("add_elements", json!({ "deck": name, "slide": 2, "elements": [
        { "type": "chart", "id": "ch", "x": 60, "y": 150, "w": 700, "h": 320, "kind": "bar", "categories": ["a"], "series": [{ "name": "S", "values": [1] }] }
    ] }));
    let newer = kit.store.decks[&name].replace("\"kind\": \"bar\"", "\"kind\": \"waterfall\"");
    kit.store.put(&name, &newer);
    let why = kit.err("get_deck", json!({ "deck": name }));
    assert!(
        why.contains(".kind` is `waterfall`") && why.contains("update KastenFlow"),
        "{why}"
    );
    assert!(!why.contains("unknown variant"), "{why}");
}
