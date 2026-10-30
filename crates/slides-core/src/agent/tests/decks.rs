//! Making a deck from an outline, and looking at decks.

use serde_json::json;

use super::{Kit, OUTLINE, with_picture};
use crate::canonical;

#[test]
fn a_deck_is_made_from_an_outline_with_a_layout_chosen_for_each_slide() {
    let mut kit = Kit::new();
    let made = kit.ok("create_deck", json!({ "outline": OUTLINE }));
    let layouts: Vec<&str> = made["slides"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["layout"].as_str().unwrap())
        .collect();
    assert_eq!(
        layouts,
        [
            "title",
            "title-body",
            "two-columns",
            "section",
            "quote",
            "code"
        ]
    );
    let name = made["deck"].as_str().unwrap();
    assert_eq!(name, "tool-use-in-models.deck");
    let deck = kit.deck(name);
    assert_eq!(deck.title, "Tool use in models");
    assert_eq!(deck.slides.len(), 6);
    // The deck on the store is a canonical, readable file.
    let text = &kit.store.decks[name];
    assert_eq!(&canonical::write(&deck).unwrap(), text);
    assert_eq!(
        deck.slides[1].notes,
        "Start with a question: what could the model not answer alone?"
    );
    // Nothing needs fixing: no errors, and the cover has no empty slot.
    assert_eq!(made["lint"]["errors"], 0, "{}", made["lint"]);
    assert_eq!(made["lint"]["warnings"], 0, "{}", made["lint"]);
}

#[test]
fn a_title_slide_of_the_outline_becomes_the_cover_and_pictures_take_their_slot() {
    let mut kit = Kit::new();
    with_picture(&mut kit, "loop.png", 800, 400);
    let outline = "# Deck\n\n## The story <!-- layout: title -->\nA subtitle line\n\n## The loop\n- ask\n- act\n\n![The agent loop](assets/loop.png)\n\n## Missing\n![Nothing](assets/nope.png)\n";
    let made = kit.ok("create_deck", json!({ "outline": outline }));
    let layouts: Vec<&str> = made["slides"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["layout"].as_str().unwrap())
        .collect();
    assert_eq!(layouts, ["title", "title-image", "image-caption"]);
    let deck = kit.deck(made["deck"].as_str().unwrap());
    let cover = deck.slides[0]
        .elements
        .iter()
        .map(|e| e.text().map(|t| t.plain_text()).unwrap_or_default())
        .collect::<Vec<_>>();
    assert_eq!(cover, ["The story", "A subtitle line"]);
    let picture = deck.slides[1].elements.iter().find_map(|e| match e {
        crate::model::Element::Image(i) => Some(i),
        _ => None,
    });
    let picture = picture.unwrap();
    assert_eq!(
        (picture.src.as_str(), picture.base.alt.as_deref()),
        ("assets/loop.png", Some("The agent loop"))
    );
    let warnings = made["warnings"].as_array().unwrap();
    assert_eq!(warnings.len(), 1, "{warnings:?}");
    assert!(warnings[0].as_str().unwrap().contains("assets/nope.png"));
}

#[test]
fn an_outline_that_cannot_be_laid_out_is_refused_with_the_fix() {
    let mut kit = Kit::new();
    assert!(kit.err("create_deck", json!({})).contains("`outline`"));
    assert!(
        kit.err("create_deck", json!({ "outline": "# Only a title" }))
            .contains("## Title")
    );
    let unknown = kit.err(
        "create_deck",
        json!({ "outline": "## A <!-- layout: nonsense -->\n- x" }),
    );
    assert!(
        unknown.contains("nonsense") && unknown.contains("two-columns"),
        "{unknown}"
    );
    let theme = kit.err(
        "create_deck",
        json!({ "outline": "## A\n- x", "theme": "Neon" }),
    );
    assert!(
        theme.contains("Neon") && theme.contains("Lecture"),
        "{theme}"
    );
    assert!(kit.store.decks.is_empty(), "nothing was made");
}

#[test]
fn a_slide_with_nothing_under_its_title_is_a_divider_and_the_answer_says_how_to_make_it_more() {
    let mut kit = Kit::new();
    let made = kit.ok(
        "create_deck",
        json!({ "outline": "# D\n\n## The loop\n\n## Part two <!-- layout: section -->\n\n## Points\n- one" }),
    );
    let layouts: Vec<&str> = made["slides"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["layout"].as_str().unwrap())
        .collect();
    assert_eq!(layouts, ["title", "section", "section", "title-body"]);
    let warnings = made["warnings"].as_array().unwrap();
    assert_eq!(
        warnings.len(),
        1,
        "a divider that was asked for is not a surprise: {warnings:?}"
    );
    let warning = warnings[0].as_str().unwrap();
    assert!(
        warning.starts_with("Slide 2 (\"The loop\")")
            && warning.contains("<!-- layout: title-only -->"),
        "{warning}"
    );
}

#[test]
fn a_deck_is_never_replaced_by_making_another_of_the_same_title() {
    let mut kit = Kit::new();
    let one = kit.make("# Same\n\n## A\n- x");
    let two = kit.make("# Same\n\n## B\n- y");
    assert_ne!(one, two);
    assert_eq!(kit.store.decks.len(), 2);
}

#[test]
fn get_deck_is_one_line_a_slide_and_the_ids_it_shows_are_the_ones_tools_take() {
    let mut kit = Kit::new();
    let name = kit.make(OUTLINE);
    let out = kit.call("get_deck", json!({ "deck": name })).unwrap();
    let lines: Vec<&str> = out.text.lines().collect();
    assert_eq!(lines.len(), 7, "{}", out.text);
    assert!(
        lines[0].contains("Tool use in models")
            && lines[0].contains("6 slides")
            && lines[0].contains("Lint: 0 errors"),
        "{}",
        lines[0]
    );
    assert!(
        lines[2].contains("title-body") && lines[2].contains("\"Why tools?\""),
        "{}",
        lines[2]
    );
    let id = out.data.unwrap()["slides"][1]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(lines[2].contains(&id));
    let slide = kit.ok("get_slide", json!({ "deck": name, "slide": id }));
    assert_eq!(slide["position"], 2);
    assert_eq!(slide["slide"]["layout"], "title-body");
    let by_number = kit.ok("get_slide", json!({ "deck": name, "slide": 2 }));
    assert_eq!(by_number["slide"]["id"], slide["slide"]["id"]);
    assert!(
        kit.err("get_slide", json!({ "deck": name, "slide": "s-nope" }))
            .contains("s-nope")
    );
}

#[test]
fn the_outline_layouts_and_theme_can_be_read_and_the_only_deck_need_not_be_named() {
    let mut kit = Kit::new();
    kit.make(OUTLINE);
    let outline = kit.call("get_outline", json!({})).unwrap().text;
    assert!(
        outline.starts_with("# Tool use in models") && outline.contains("## Why tools?"),
        "{outline}"
    );
    let layouts = kit.ok("list_layouts", json!({}));
    let names: Vec<&str> = layouts["layouts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| l["name"].as_str().unwrap())
        .collect();
    assert!(names.contains(&"two-columns") && names.contains(&"big-number"));
    let title_body = layouts["layouts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["name"] == "title-body")
        .unwrap();
    assert_eq!(title_body["slots"][1]["role"], "body");
    let theme = kit.ok("get_theme", json!({}));
    assert_eq!(theme["name"], "Light");
    assert_eq!(theme["textStyles"]["body"]["size"], 22.0);
    assert!(
        theme["themes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|t| t == "Lecture")
    );
    let decks = kit.ok("list_decks", json!({}));
    assert_eq!(decks["decks"][0]["slides"], 6);
    // With two decks the name is needed, and the message lists them.
    kit.make("# Second\n\n## A\n- x");
    let ask = kit.err("get_deck", json!({}));
    assert!(
        ask.contains("tool-use-in-models.deck") && ask.contains("second.deck"),
        "{ask}"
    );
}

#[test]
fn a_layout_a_person_made_is_listed_used_and_checked_like_the_built_in_ones() {
    use crate::ops::Engine;

    // A deck with a layout of its own: a dark page, with the title and subtitle slots of the slide it was saved from.
    let mut made = Engine::create("Mine", "Light", 1).unwrap();
    let slide = made.deck().slides[0].id.clone();
    made.apply(
        "add_elements",
        json!({ "slide": slide, "elements": [{ "type": "shape", "shape": "rect", "x": 0, "y": 0, "w": 40, "h": 540 }] }),
    )
    .unwrap();
    made.apply(
        "set_background",
        json!({ "slide": slide, "background": { "color": "text1" } }),
    )
    .unwrap();
    made.apply(
        "save_layout",
        json!({ "slide": slide, "label": "Night", "roles": {} }),
    )
    .unwrap();
    let mut kit = Kit::new();
    kit.store
        .decks
        .insert("mine.deck".into(), canonical::write(made.deck()).unwrap());

    let layouts = kit.ok("list_layouts", json!({ "deck": "mine.deck" }));
    let all = layouts["layouts"].as_array().unwrap();
    let night = all.iter().find(|l| l["name"] == "night").unwrap();
    assert_eq!(night["custom"], true);
    assert_eq!(night["label"], "Night");
    assert_eq!(
        night["decoration"], 1,
        "the stripe it draws behind its slides"
    );
    assert_eq!(night["background"]["color"], "text1");
    assert_eq!(night["slots"][0]["role"], "title");
    let title_body = all.iter().find(|l| l["name"] == "title-body").unwrap();
    assert_eq!(title_body["custom"], false);
    assert_eq!(title_body["decoration"], 0);

    // A slide made of it is filled by role, as for any layout.
    let added = kit.ok(
        "add_slide",
        json!({ "deck": "mine.deck", "layout": "night", "content": { "title": "Hello" } }),
    );
    assert_eq!(added["slides"], 2, "{added}");
    assert_eq!(kit.deck("mine.deck").slides[1].layout, "night");
    assert!(
        kit.err(
            "add_slide",
            json!({ "deck": "mine.deck", "layout": "night", "content": { "body": "x" } })
        )
        .contains("title"),
        "a slot the layout lacks is named"
    );

    // Lint reads the layout's dark page: the dark words on it cannot be read.
    let lint = kit.ok("lint_deck", json!({ "deck": "mine.deck" }));
    assert!(lint.to_string().contains("contrast"), "{lint}");

    // Nothing here is a tool of its own: an assistant uses layouts and does not make them.
    let tools: Vec<String> = crate::agent::tools().into_iter().map(|t| t.name).collect();
    for editor_only in [
        "save_layout",
        "set_layout_design",
        "apply_template",
        "delete_layout",
    ] {
        assert!(!tools.iter().any(|t| t == editor_only), "{editor_only}");
    }
}

#[test]
fn an_operation_that_is_not_on_the_list_is_not_callable_by_its_name() {
    let mut kit = Kit::new();
    let name = kit.make(OUTLINE);
    let before = kit.store.decks[&name].clone();
    // The list leaves these out; called by name they are not tools, as in any other client.
    for hidden in [
        "apply_template",
        "save_layout",
        "add_slides",
        "replace_deck",
        "reset_slides",
    ] {
        let message = kit.err(hidden, json!({ "deck": name }));
        assert!(
            message.contains(&format!("There is no tool called `{hidden}`")),
            "{message}"
        );
    }
    assert_eq!(kit.store.decks[&name], before);
    // The person's own still says whose it is.
    assert!(
        kit.err("accept_marks", json!({ "deck": name }))
            .contains("the person's")
    );
}

#[test]
fn an_unknown_tool_lists_the_tools() {
    let mut kit = Kit::new();
    let message = kit.err("make_it_pretty", json!({}));
    assert!(
        message.contains("make_it_pretty")
            && message.contains("create_deck")
            && message.contains("lint_deck"),
        "{message}"
    );
    assert!(kit.err("get_deck", json!([1])).contains("JSON object"));
}
