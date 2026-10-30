//! The four deck operations that used to be only the editor's, as tools:
//! `move_slides`, `set_rich_text`, `set_slide_steps` and `apply_deck_template`.

use serde_json::json;

use super::{Kit, OUTLINE};
use crate::agent::tools;
use crate::canonical;

fn tool(name: &str) -> crate::agent::ToolSpec {
    tools()
        .into_iter()
        .find(|t| t.name == name)
        .unwrap_or_else(|| panic!("no tool {name}"))
}

#[test]
fn the_four_tools_are_listed_with_plain_words_and_the_arguments_they_need() {
    for (name, required) in [
        ("move_slides", vec!["ids", "to"]),
        ("set_rich_text", vec!["slide", "id", "text"]),
        ("set_slide_steps", vec!["slide", "steps"]),
        ("apply_deck_template", vec!["template"]),
    ] {
        let spec = tool(name);
        assert!(!spec.read_only, "{name}");
        assert!(spec.description.len() > 90, "{name}: {}", spec.description);
        assert_eq!(spec.input_schema["type"], "object", "{name}");
        for key in &required {
            assert!(
                spec.input_schema["properties"].get(*key).is_some(),
                "{name} takes {key}"
            );
            assert!(
                spec.input_schema["required"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|r| r == key),
                "{name} needs {key}"
            );
        }
    }
    // The deck is named like for any tool, but a template is named too.
    assert!(
        tool("apply_deck_template").input_schema["properties"]["deck"].is_object(),
        "the deck to restyle is named like for any tool"
    );
    // The operation of that name takes a theme as data; the tool takes a deck.
    assert!(!tools().iter().any(|t| t.name == "apply_template"));
}

#[test]
fn slides_are_moved_by_id_keeping_their_order_among_themselves() {
    let mut kit = Kit::new();
    let name = kit.make(OUTLINE);
    let ids: Vec<String> = kit
        .deck(&name)
        .slides
        .iter()
        .map(|s| s.id.clone())
        .collect();
    assert_eq!(ids.len(), 6);
    let out = kit.ok(
        "move_slides",
        json!({ "deck": name, "ids": [ids[3], ids[4]], "to": 0 }),
    );
    assert_eq!(out["changed"], true);
    let now: Vec<String> = kit
        .deck(&name)
        .slides
        .iter()
        .map(|s| s.id.clone())
        .collect();
    assert_eq!(
        now,
        [&ids[3], &ids[4], &ids[0], &ids[1], &ids[2], &ids[5]]
            .map(|s| s.to_string())
            .to_vec()
    );
    // A slide that is not there is refused and nothing is written.
    let before = kit.store.decks[&name].clone();
    let why = kit.err(
        "move_slides",
        json!({ "deck": name, "ids": ["s-nope"], "to": 1 }),
    );
    assert!(why.contains("s-nope"), "{why}");
    assert_eq!(kit.store.decks[&name], before);
    // Putting them where they are is no change.
    let same = kit.ok(
        "move_slides",
        json!({ "deck": name, "ids": [ids[3]], "to": 0 }),
    );
    assert_eq!(same["changed"], false);
}

#[test]
fn a_move_that_makes_no_sense_never_loses_or_doubles_a_slide() {
    let mut kit = Kit::new();
    let name = kit.make(OUTLINE);
    let ids: Vec<String> = kit
        .deck(&name)
        .slides
        .iter()
        .map(|s| s.id.clone())
        .collect();
    let mut before = kit.store.decks[&name].clone();
    for args in [
        json!({ "deck": name, "ids": [], "to": 0 }),
        json!({ "deck": name, "ids": [ids[1]], "to": 99 }),
        json!({ "deck": name, "ids": [ids[1]], "to": -1 }),
        json!({ "deck": name, "ids": [ids[1]], "to": 1.5 }),
        json!({ "deck": name, "ids": [ids[1]], "to": "first" }),
        json!({ "deck": name, "ids": "all", "to": 0 }),
    ] {
        if kit.call("move_slides", args.clone()).is_ok() {
            // If a move is accepted, the slides are still exactly the same set.
            let mut now: Vec<String> = kit
                .deck(&name)
                .slides
                .iter()
                .map(|s| s.id.clone())
                .collect();
            now.sort();
            let mut all = ids.clone();
            all.sort();
            assert_eq!(now, all, "{args}");
            before = kit.store.decks[&name].clone();
        } else {
            assert!(
                kit.store.decks[&name] == before,
                "refused, yet changed: {args}"
            );
        }
    }
    // The same slide named twice is a move of that slide, never two copies of it.
    let _ = kit.call(
        "move_slides",
        json!({ "deck": name, "ids": [ids[2], ids[2]], "to": 0 }),
    );
    let mut now: Vec<String> = kit
        .deck(&name)
        .slides
        .iter()
        .map(|s| s.id.clone())
        .collect();
    now.sort();
    let mut all = ids.clone();
    all.sort();
    assert_eq!(now, all);
}

#[test]
fn rich_text_keeps_its_marks_and_the_file_stays_canonical() {
    let mut kit = Kit::new();
    let name = kit.make(OUTLINE);
    let slide = kit.deck(&name).slides[1].clone();
    let body = slide
        .elements
        .iter()
        .find(|e| e.text().is_some() && e.base().placeholder.as_deref() == Some("body"))
        .expect("a body")
        .id()
        .to_owned();
    let out = kit.ok(
        "set_rich_text",
        json!({ "deck": name, "slide": 2, "id": body, "text": { "paragraphs": [
            { "runs": [{ "t": "Plain " }, { "t": "bold", "b": true }, { "t": " and ", "i": true }, { "t": "red", "color": "#cc0000" }, { "t": " link", "link": "https://example.org" }], "list": "bullet" },
            { "runs": [{ "t": "second", "u": true, "size": 24 }], "list": "bullet" }
        ] } }),
    );
    assert_eq!(out["changed"], true);
    let deck = kit.deck(&name);
    let text = deck.slides[1].element(&body).unwrap().text().unwrap();
    assert_eq!(text.paragraphs.len(), 2);
    assert!(text.paragraphs[0].runs[1].bold);
    assert!(text.paragraphs[0].runs[2].italic);
    assert_eq!(text.paragraphs[0].runs[3].color.as_deref(), Some("#cc0000"));
    assert_eq!(
        text.paragraphs[0].runs[4].link.as_deref(),
        Some("https://example.org")
    );
    assert!(text.paragraphs[1].runs[0].underline);
    assert_eq!(
        canonical::write(&deck).unwrap(),
        kit.store.decks[&name],
        "the file is canonical"
    );
    // Not a colour: refused whole.
    let before = kit.store.decks[&name].clone();
    let why = kit.err(
        "set_rich_text",
        json!({ "deck": name, "slide": 2, "id": body, "text": { "paragraphs": [{ "runs": [{ "t": "x", "color": "nope" }] }] } }),
    );
    assert!(!why.is_empty());
    assert_eq!(kit.store.decks[&name], before);
    // An element that is not there is named.
    let none = kit.err(
        "set_rich_text",
        json!({ "deck": name, "slide": 2, "id": "e-none", "text": { "paragraphs": [{ "runs": [{ "t": "x" }] }] } }),
    );
    assert!(none.contains("e-none"), "{none}");
}

#[test]
fn a_slide_gets_its_number_of_clicks_between_none_and_fifty() {
    let mut kit = Kit::new();
    let name = kit.make(OUTLINE);
    let out = kit.ok(
        "set_slide_steps",
        json!({ "deck": name, "slide": 2, "steps": 3 }),
    );
    assert_eq!(out["changed"], true);
    assert_eq!(kit.deck(&name).slides[1].steps, 3);
    kit.ok(
        "set_slide_steps",
        json!({ "deck": name, "slide": 2, "steps": 0 }),
    );
    assert_eq!(kit.deck(&name).slides[1].steps, 0);
    let before = kit.store.decks[&name].clone();
    for bad in [json!(51), json!(-1)] {
        kit.err(
            "set_slide_steps",
            json!({ "deck": name, "slide": 2, "steps": bad }),
        );
    }
    assert_eq!(kit.store.decks[&name], before);
}

#[test]
fn another_decks_look_is_put_on_a_deck_and_its_words_stay() {
    let mut kit = Kit::new();
    let mine = kit.make(OUTLINE);
    let made = kit.ok(
        "create_deck",
        json!({ "outline": "# Dark look\n\n## Only a title", "theme": "Dark" }),
    );
    let template = made["deck"].as_str().unwrap().to_owned();
    let words_before: Vec<_> = kit
        .deck(&mine)
        .slides
        .iter()
        .map(|s| s.elements.len())
        .collect();
    let theme_before = kit.deck(&mine).theme.name.clone();
    let template_theme = kit.deck(&template).theme.clone();
    assert_ne!(theme_before, template_theme.name);

    let out = kit.ok(
        "apply_deck_template",
        json!({ "deck": mine, "template": template }),
    );
    assert_eq!(out["changed"], true);
    let deck = kit.deck(&mine);
    assert_eq!(deck.theme.name, template_theme.name);
    assert_eq!(
        deck.slides
            .iter()
            .map(|s| s.elements.len())
            .collect::<Vec<_>>(),
        words_before,
        "every slide keeps its elements"
    );
    assert_eq!(deck.title, "Tool use in models");
    // The template itself is not touched.
    assert_eq!(kit.deck(&template).title, "Dark look");
    // Applying it again changes nothing.
    let again = kit.ok(
        "apply_deck_template",
        json!({ "deck": mine, "template": template }),
    );
    assert_eq!(again["changed"], false);
}

#[test]
fn a_template_that_is_not_there_or_is_the_deck_itself_is_refused_and_says_what_to_do() {
    let mut kit = Kit::new();
    let mine = kit.make(OUTLINE);
    let before = kit.store.decks[&mine].clone();
    let missing = kit.err(
        "apply_deck_template",
        json!({ "deck": mine, "template": "no-such-look" }),
    );
    assert!(missing.contains("no-such-look"), "{missing}");
    let itself = kit.err(
        "apply_deck_template",
        json!({ "deck": mine, "template": mine }),
    );
    assert!(itself.contains("itself"), "{itself}");
    let none = kit.err("apply_deck_template", json!({ "deck": mine }));
    assert!(none.contains("template"), "{none}");
    assert_eq!(kit.store.decks[&mine], before);
}

#[test]
fn a_batch_still_takes_the_operations_and_the_template_tool_is_a_tool_of_its_own() {
    let mut kit = Kit::new();
    let name = kit.make(OUTLINE);
    let third = kit.deck(&name).slides[2].id.clone();
    kit.ok(
        "update_elements",
        json!({ "deck": name, "operations": [
            { "op": "set_slide_steps", "input": { "slide": 2, "steps": 2 } },
            { "op": "move_slides", "input": { "ids": [third], "to": 0 } },
        ] }),
    );
    assert_eq!(kit.deck(&name).slides[0].id, third);
    let why = kit.err(
        "update_elements",
        json!({ "deck": name, "operations": [{ "op": "apply_deck_template", "input": { "template": "x" } }] }),
    );
    assert!(why.contains("a tool of its own"), "{why}");
}
