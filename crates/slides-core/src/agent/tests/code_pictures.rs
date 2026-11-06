//! Code pictures: an agent's program is run where programs run (the store's `run_generator`; here a
//! stand-in), the picture it draws is kept as an ordinary picture, and the program stays inside the
//! picture on the slide. Errors come back to the agent with the line.

use serde_json::{Value, json};

use super::{Kit, OUTLINE};
use crate::agent::images::tests::png;
use crate::agent::{GeneratorDrawn, ImageKind, StoreError, tools};
use crate::model::{Element, GeneratorInputKind, GeneratorOutput, ImageEl};

fn svg(w: u32, h: u32, inputs_hash: &str) -> GeneratorDrawn {
    GeneratorDrawn {
        kind: ImageKind::Svg,
        bytes: format!("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{w}\" height=\"{h}\" viewBox=\"0 0 {w} {h}\"><rect width=\"{w}\" height=\"{h}\" fill=\"#2563eb\"/></svg>").into_bytes(),
        width: w,
        height: h,
        preview: Some(png(w, h)),
        inputs_hash: inputs_hash.to_owned(),
        at: 1_762_000_000_000,
        warnings: vec!["a font was substituted".to_owned()],
        logs: vec!["rows: 3".to_owned()],
    }
}

fn picture(w: u32, h: u32) -> GeneratorDrawn {
    GeneratorDrawn {
        kind: ImageKind::Png,
        bytes: png(w, h),
        width: w,
        height: h,
        preview: None,
        inputs_hash: "in-1".to_owned(),
        at: 1_762_000_000_000,
        warnings: Vec::new(),
        logs: Vec::new(),
    }
}

/// The code pictures of the deck, with their slide numbers (from 1).
fn code_pictures(kit: &Kit, name: &str) -> Vec<(usize, ImageEl)> {
    let mut found = Vec::new();
    for (n, slide) in kit.deck(name).slides.iter().enumerate() {
        for element in &slide.elements {
            if let Element::Image(image) = element
                && image.generator().is_some()
            {
                found.push((n + 1, image.clone()));
            }
        }
    }
    found
}

const BOX: fn() -> Value = || json!({ "x": 100, "y": 200, "w": 400, "h": 300 });

fn deck(kit: &mut Kit) -> (String, String) {
    let name = kit.make(OUTLINE);
    let slide = kit.deck(&name).slides[3].id.clone();
    (name, slide)
}

fn place(kit: &mut Kit, name: &str, slide: &str, code: &str) -> Value {
    kit.store
        .generator_answers
        .push_back(Ok(svg(200, 100, "in-1")));
    kit.ok(
        "place_code_picture",
        json!({ "deck": name, "slide": slide, "code": code, "box": BOX(), "alt": "Sales by month",
            "inputs": [{ "name": "sales", "kind": "data", "value": "month,total\nJan,3\n" }] }),
    )
}

#[test]
fn a_program_is_run_and_its_picture_placed_with_the_program_inside_it() {
    let mut kit = Kit::new();
    let (name, slide) = deck(&mut kit);
    let saved = kit.store.versions.len();
    kit.store
        .generator_answers
        .push_back(Ok(svg(200, 100, "in-1")));
    let out = kit
        .call(
            "place_code_picture",
            json!({ "deck": name, "slide": slide, "code": "return kit.svg(200, 100, '');", "box": BOX(), "alt": "Sales by month",
                "inputs": [{ "name": "sales", "kind": "data", "value": "month,total\nJan,3\n" }] }),
        )
        .unwrap();
    let data = out.data.clone().unwrap();
    let told = &data["codePicture"];
    assert_eq!(
        (
            told["kind"].as_str(),
            told["width"].as_u64(),
            told["height"].as_u64()
        ),
        (Some("svg"), Some(200), Some(100))
    );
    assert_eq!(told["warnings"], json!(["a font was substituted"]));
    assert_eq!(told["logs"], json!(["rows: 3"]));
    let path = told["picture"].as_str().unwrap();
    assert!(
        path.starts_with("assets/code-") && path.ends_with(".svg"),
        "{path}"
    );
    assert!(kit.store.assets.contains_key(path));
    // The agent is shown the picture, and the text it reads says the same.
    assert_eq!(out.images.len(), 1);
    assert_eq!(out.images[0].mime, "image/png");
    assert!(out.text.contains("codePicture"));
    // One change to the deck: the picture and its program go in together.
    assert_eq!(kit.store.versions.len(), saved + 1);

    // What was run.
    let job = &kit.store.generated[0];
    assert_eq!(job.deck, name);
    assert_eq!(job.generator.code, "return kit.svg(200, 100, '');");
    assert_eq!(job.generator.output, GeneratorOutput::Svg);
    assert_eq!(job.generator.inputs[0].name, "sales");
    assert!(
        job.theme.keys().any(|token| token == "accent1"),
        "{:?}",
        job.theme
    );

    // What is on the slide: an ordinary picture, fitted to its own proportions, that holds its program.
    let found = code_pictures(&kit, &name);
    assert_eq!(found.len(), 1);
    let (number, image) = &found[0];
    assert_eq!(*number, 4);
    assert_eq!(image.src, path);
    assert_eq!(image.base.alt.as_deref(), Some("Sales by month"));
    assert_eq!(image.base.rect(), Some((100.0, 250.0, 400.0, 200.0)));
    let generator = image.generator().unwrap();
    assert_eq!(generator.made_by.as_deref(), Some("agent"));
    assert_eq!(generator.inputs[0].kind, GeneratorInputKind::Data);
    let run = generator.last_run.unwrap();
    assert_eq!(run.at, 1_762_000_000_000);
    assert_eq!(run.hash.len(), 16);
    assert!(path.contains(&run.hash[..8]));
}

#[test]
fn a_png_program_keeps_a_png_and_shows_it() {
    let mut kit = Kit::new();
    let (name, slide) = deck(&mut kit);
    kit.store.generator_answers.push_back(Ok(picture(300, 150)));
    let out = kit
        .call(
            "place_code_picture",
            json!({ "deck": name, "slide": slide, "code": "return kit.svg(300, 150, '');", "output": "png", "box": BOX() }),
        )
        .unwrap();
    let data = out.data.unwrap();
    assert!(
        data["codePicture"]["picture"]
            .as_str()
            .unwrap()
            .ends_with(".png")
    );
    assert_eq!(out.images.len(), 1);
    assert_eq!(out.images[0].bytes, png(300, 150));
    let (_, image) = &code_pictures(&kit, &name)[0];
    assert_eq!(image.generator().unwrap().output, GeneratorOutput::Png);
    // Without alt words it is described plainly.
    assert_eq!(image.base.alt.as_deref(), Some("A picture drawn by code"));
}

#[test]
fn what_the_program_got_wrong_comes_back_with_the_line_and_nothing_is_written() {
    let mut kit = Kit::new();
    let (name, slide) = deck(&mut kit);
    let before = kit.store.decks.get(&name).cloned();
    let assets = kit.store.assets.len();
    kit.store
        .generator_answers
        .push_back(Err(StoreError::Invalid(
            "Line 2: sales is not defined".to_owned(),
        )));
    let why = kit.err(
        "place_code_picture",
        json!({ "deck": name, "slide": slide, "code": "const a = 1;\nreturn sales;", "box": BOX() }),
    );
    assert!(why.contains("Line 2"), "{why}");
    assert_eq!(kit.store.decks.get(&name).cloned(), before);
    assert_eq!(kit.store.assets.len(), assets);
    assert!(code_pictures(&kit, &name).is_empty());

    // The window being closed is said as it is.
    kit.store
        .generator_answers
        .push_back(Err(StoreError::Unavailable(
            "Running code is not available right now: open KastenFlow on this vault and ask again."
                .to_owned(),
        )));
    let why = kit.err(
        "place_code_picture",
        json!({ "deck": name, "slide": slide, "code": "return 1", "box": BOX() }),
    );
    assert!(why.contains("open KastenFlow"), "{why}");
    // Without a store that runs code, the tool says so and writes nothing.
    let why = kit.err(
        "place_code_picture",
        json!({ "deck": name, "slide": slide, "code": "return 1", "box": BOX() }),
    );
    assert!(why.contains("not available"), "{why}");
}

#[test]
fn a_program_that_cannot_be_run_is_refused_before_the_window_is_asked() {
    let mut kit = Kit::new();
    let (name, slide) = deck(&mut kit);
    let base = json!({ "deck": name, "slide": slide, "box": BOX() });
    let with = |extra: Value| {
        let mut args = base.clone();
        args.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        args
    };
    for (extra, says) in [
        (json!({ "code": "   " }), "program"),
        (json!({}), "program"),
        (json!({ "code": "x", "output": "gif" }), "svg"),
        (json!({ "code": "x", "inputs": "sales" }), "inputs"),
        (
            json!({ "code": "x", "inputs": [{ "name": "a", "kind": "file", "value": "b" }] }),
            "kind",
        ),
        (
            json!({ "code": "x", "inputs": [{ "name": "1a", "kind": "data", "value": "b" }] }),
            "cannot name",
        ),
        (
            json!({ "code": "x", "inputs": [{ "name": "a", "kind": "data" }] }),
            "value",
        ),
    ] {
        let why = kit.err("place_code_picture", with(extra.clone()));
        assert!(why.contains(says), "{extra}: {why}");
    }
    assert!(kit.store.generated.is_empty(), "the window was never asked");
}

#[test]
fn a_program_that_answers_the_wrong_kind_of_picture_is_refused() {
    let mut kit = Kit::new();
    let (name, slide) = deck(&mut kit);
    kit.store.generator_answers.push_back(Ok(picture(10, 10)));
    let why = kit.err(
        "place_code_picture",
        json!({ "deck": name, "slide": slide, "code": "return 1", "box": BOX() }),
    );
    assert!(why.contains("PNG") && why.contains("SVG"), "{why}");
    assert!(code_pictures(&kit, &name).is_empty());
}

#[test]
fn running_a_picture_again_swaps_its_picture_and_keeps_its_place() {
    let mut kit = Kit::new();
    let (name, slide) = deck(&mut kit);
    let placed = place(&mut kit, &name, &slide, "return kit.svg(200, 100, '');");
    let element = placed["result"]["element"].as_str().unwrap().to_owned();
    let first = placed["codePicture"]["picture"]
        .as_str()
        .unwrap()
        .to_owned();

    // What it reads changed: a new picture of the same shape takes the old one's place.
    kit.store
        .generator_answers
        .push_back(Ok(svg(200, 100, "in-2")));
    let out = kit
        .call(
            "run_code_picture",
            json!({ "deck": name, "slide": slide, "element": element }),
        )
        .unwrap();
    let data = out.data.unwrap();
    assert_eq!(data["changed"], true);
    let now = data["codePicture"]["picture"].as_str().unwrap().to_owned();
    assert_ne!(
        now, first,
        "other inputs, another picture; the old one stays in the store"
    );
    assert!(kit.store.assets.contains_key(&first) && kit.store.assets.contains_key(&now));
    let (_, image) = &code_pictures(&kit, &name)[0];
    assert_eq!(image.src, now);
    assert_eq!(image.base.rect(), Some((100.0, 250.0, 400.0, 200.0)));
    assert_eq!(kit.store.generated[1].generator.inputs[0].name, "sales");

    // New code, and a picture of other proportions: the box follows within where it was.
    kit.store
        .generator_answers
        .push_back(Ok(svg(100, 100, "in-2")));
    kit.ok(
        "run_code_picture",
        json!({ "deck": name, "slide": slide, "element": element, "code": "return kit.svg(100, 100, '');" }),
    );
    let (_, image) = &code_pictures(&kit, &name)[0];
    assert_eq!(
        image.generator().unwrap().code,
        "return kit.svg(100, 100, '');"
    );
    let (x, y, w, h) = image.base.rect().unwrap();
    assert_eq!((w, h), (200.0, 200.0), "the largest square in the old box");
    assert_eq!((x, y), (200.0, 250.0));
}

#[test]
fn only_a_picture_with_a_program_can_be_run() {
    let mut kit = Kit::new();
    let (name, slide) = deck(&mut kit);
    kit.ok("add_elements", json!({ "deck": name, "slide": slide, "elements": [
        { "type": "image", "id": "plain", "src": "assets/none.png", "x": 10, "y": 10, "w": 100, "h": 100, "alt": "x" },
        { "type": "text", "id": "words", "x": 10, "y": 200, "w": 100, "h": 40, "markdown": "hi" },
    ] }));
    let why = kit.err(
        "run_code_picture",
        json!({ "deck": name, "slide": slide, "element": "plain" }),
    );
    assert!(why.contains("no program"), "{why}");
    let why = kit.err(
        "run_code_picture",
        json!({ "deck": name, "slide": slide, "element": "words" }),
    );
    assert!(why.contains("not a picture"), "{why}");
    let why = kit.err("run_code_picture", json!({ "deck": name, "slide": slide }));
    assert!(why.contains("element"), "{why}");
    assert!(kit.store.generated.is_empty());
}

#[test]
fn every_code_picture_is_run_again_in_one_change_and_each_says_how_it_went() {
    let mut kit = Kit::new();
    let (name, slide) = deck(&mut kit);
    let other = kit.deck(&name).slides[1].id.clone();
    place(&mut kit, &name, &slide, "return kit.svg(200, 100, 'a');");
    kit.store
        .generator_answers
        .push_back(Ok(svg(200, 100, "in-1")));
    kit.ok(
        "place_code_picture",
        json!({ "deck": name, "slide": other, "code": "return kit.svg(200, 100, 'b');", "box": BOX() }),
    );
    assert_eq!(code_pictures(&kit, &name).len(), 2);
    let saved = kit.store.versions.len();

    // The first draws what it drew; the second reads other data and draws something else.
    kit.store
        .generator_answers
        .push_back(Ok(svg(200, 100, "in-1")));
    kit.store
        .generator_answers
        .push_back(Ok(svg(200, 100, "in-9")));
    let done = kit.ok("rerun_code_pictures", json!({ "deck": name }));
    let statuses: Vec<&str> = done["pictures"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["status"].as_str().unwrap())
        .collect();
    assert_eq!(statuses, ["unchanged", "updated"], "{done}");
    assert_eq!(
        kit.store.versions.len(),
        saved + 1,
        "one change for the picture that came out different"
    );

    // Nothing differs: nothing is saved.
    kit.store
        .generator_answers
        .push_back(Ok(svg(200, 100, "in-1")));
    kit.store
        .generator_answers
        .push_back(Ok(svg(200, 100, "in-9")));
    let again = kit.ok("rerun_code_pictures", json!({ "deck": name }));
    assert_eq!(again["changed"], false);
    assert_eq!(kit.store.versions.len(), saved + 1);
}

#[test]
fn a_picture_that_fails_to_run_is_reported_and_the_others_still_run() {
    let mut kit = Kit::new();
    let (name, slide) = deck(&mut kit);
    let other = kit.deck(&name).slides[1].id.clone();
    place(&mut kit, &name, &slide, "return kit.svg(200, 100, 'a');");
    kit.store
        .generator_answers
        .push_back(Ok(svg(200, 100, "in-1")));
    kit.ok(
        "place_code_picture",
        json!({ "deck": name, "slide": other, "code": "return kit.svg(200, 100, 'b');", "box": BOX() }),
    );
    kit.store
        .generator_answers
        .push_back(Err(StoreError::Invalid("Line 3: boom".to_owned())));
    kit.store
        .generator_answers
        .push_back(Ok(svg(200, 100, "in-9")));
    let done = kit.ok("rerun_code_pictures", json!({ "deck": name }));
    let pictures = done["pictures"].as_array().unwrap();
    assert_eq!(pictures[0]["status"], "failed");
    assert!(pictures[0]["error"].as_str().unwrap().contains("Line 3"));
    assert_eq!(pictures[1]["status"], "updated");
}

#[test]
fn a_deck_without_code_pictures_says_so() {
    let mut kit = Kit::new();
    let (name, _) = deck(&mut kit);
    let done = kit.ok("rerun_code_pictures", json!({ "deck": name }));
    assert_eq!(done["changed"], false);
    assert!(
        done["message"]
            .as_str()
            .unwrap()
            .contains("no code pictures")
    );
    assert!(kit.store.generated.is_empty());
}

#[test]
fn the_hashes_are_the_ones_the_editor_makes() {
    // The standard FNV-1a test vectors over 64 bits: the editor's package checks the same two, so a picture run there and one run
    // here (or by an agent) agree on whether it changed.
    assert_eq!(crate::agent::hash_of(""), "cbf29ce484222325");
    assert_eq!(crate::agent::hash_of("a"), "af63dc4c8601ec8c");
    let a = crate::model::run_hash("code", "in", GeneratorOutput::Svg);
    assert_eq!(a, crate::agent::hash_of("code\0in\0svg"));
    assert_eq!(
        crate::model::run_hash("code", "in", GeneratorOutput::Png),
        crate::agent::hash_of("code\0in\0png")
    );
}

#[test]
fn the_three_tools_are_listed_with_what_they_need() {
    let all = tools();
    for (name, needs) in [
        ("place_code_picture", vec!["slide", "code"]),
        ("run_code_picture", vec!["slide", "element"]),
        ("rerun_code_pictures", vec![]),
    ] {
        let tool = all
            .iter()
            .find(|t| t.name == name)
            .unwrap_or_else(|| panic!("{name} is not a tool"));
        assert!(!tool.read_only, "{name} changes the deck");
        assert_eq!(tool.input_schema["type"], "object");
        // A tool that needs nothing leaves `required` out.
        let required: Vec<&str> = tool.input_schema["required"]
            .as_array()
            .map_or_else(Vec::new, |list| {
                list.iter().map(|r| r.as_str().unwrap()).collect()
            });
        assert_eq!(required, needs, "{name}");
        assert!(
            tool.description.len() < 2_000,
            "{name}: {}",
            tool.description.len()
        );
    }
    let place = all.iter().find(|t| t.name == "place_code_picture").unwrap();
    for word in ["kit", "inputs", "theme", "sandbox", "Allow to run"] {
        assert!(place.description.contains(word), "{word}");
    }
}
