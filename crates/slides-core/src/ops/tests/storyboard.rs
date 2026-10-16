//! A storyboard made into slides, the slides kept in step with the page they came from, and a person's edits left alone.

use serde_json::{Value, json};

use super::{bytes, element, engine, first_slide, text_box};
use crate::error::Error;
use crate::model::{Element, SourceKind};
use crate::ops::Engine;
use crate::page::{self, StorySource, draft, fingerprint, made_of, section_markdown};

const PAGE: &str =
    "## Plan\n\nBook early. Then pack.\n\n- flights\n- guesthouse\n\n## Budget\n\n- bed: 40\n";
const CHANGED: &str = "## Plan\n\nBook late. Then pack.\n\n- flights\n- guesthouse\n- insurance\n\n## Budget\n\n- bed: 40\n";

fn story(markdown: &str) -> Vec<Value> {
    let source = StorySource {
        page: "library/plan.md".to_owned(),
        id: Some("n-1".to_owned()),
        title: Some("Plan".to_owned()),
        section: None,
        markdown: markdown.to_owned(),
    };
    serde_json::to_value(draft(&source, 0))
        .unwrap()
        .as_array()
        .unwrap()
        .clone()
}

fn make(e: &mut Engine, entries: Vec<Value>) -> Value {
    e.apply("add_storyboard_slides", json!({ "entries": entries }))
        .unwrap()
        .output
}

/// The element of a slide that came from the page.
fn body_of(e: &Engine, slide: &str) -> Element {
    e.deck()
        .slide(slide)
        .unwrap()
        .elements
        .iter()
        .find(|x| x.base().source.is_some())
        .expect("an element from the page")
        .clone()
}

fn ids(out: &Value) -> Vec<String> {
    out["slides"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s.as_str().unwrap().to_owned())
        .collect()
}

fn update(e: &mut Engine, slide: &str, id: &str, markdown: &str, keep_edits: bool) -> Value {
    e.apply(
        "update_page_contents",
        json!({ "slide": slide, "id": id, "markdown": markdown, "keepEdits": keep_edits }),
    )
    .unwrap()
    .output
}

#[test]
fn generation_keeps_source_identity_and_fingerprints() {
    let mut e = engine();
    let before = bytes(e.deck());
    let out = make(&mut e, story(PAGE));
    let made = ids(&out);
    assert_eq!(made.len(), 2);
    assert_eq!(out["omitted"], json!([]));
    assert_eq!(
        e.deck().slides.len(),
        3,
        "the title slide, then one for each entry"
    );

    let plan = e.deck().slide(&made[0]).unwrap();
    assert_eq!(plan.layout, "title-body");
    assert_eq!(plan.notes, "Book early. Then pack.");
    let title = plan
        .elements
        .iter()
        .find(|x| x.base().placeholder.as_deref() == Some("title"))
        .unwrap();
    assert_eq!(title.text().unwrap().plain_text(), "Plan");

    let body = body_of(&e, &made[0]);
    let source = body.base().source.as_ref().unwrap();
    assert_eq!(
        (
            source.page.as_str(),
            source.id.as_deref(),
            source.title.as_deref(),
            source.section.as_deref()
        ),
        ("library/plan.md", Some("n-1"), Some("Plan"), Some("Plan"))
    );
    assert_eq!(source.kind, SourceKind::Section);
    assert!(source.sync);
    assert_eq!(
        source.hash,
        Some(fingerprint(&section_markdown(PAGE, "Plan").unwrap()))
    );
    assert_eq!(source.made, Some(made_of(&body)));
    assert_eq!(source.markdown, None);
    assert_eq!(body.base().name.as_deref(), Some("Section: Plan"));
    // The point leads, the evidence follows as a list.
    let words = body.text().unwrap();
    assert_eq!(words.paragraphs[0].runs[0].t, "Book early.");
    assert!(words.paragraphs[0].list.is_none());
    assert_eq!(words.plain_text(), "Book early.\nflights\nguesthouse");

    let budget = body_of(&e, &made[1]);
    assert_eq!(budget.text().unwrap().plain_text(), "bed: 40");
    assert_eq!(e.deck().slide(&made[1]).unwrap().notes, "");

    // A deck that remembers what its slides were made of is written as format 2, and reads back the same.
    let text = bytes(e.deck());
    let parsed: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(parsed["formatVersion"], 2);
    assert_eq!(bytes(&crate::canonical::parse(&text).unwrap()), text);

    e.undo().unwrap();
    assert_eq!(bytes(e.deck()), before);
}

#[test]
fn omitted_pictures_are_reported() {
    let mut e = engine();
    let mut entries = story(PAGE);
    entries[0]["evidence"] = json!([
        "![far](https://example.com/a.png)",
        "![near](assets/a.png)",
        "- kept"
    ]);
    entries[0]["media"] = json!(true);
    let out = make(&mut e, entries);
    // The entry was rewritten, which is also reported (it is not kept in step); the picture is the one this test is about.
    let omitted: Vec<&Value> = out["omitted"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|o| o["what"] == "picture")
        .collect();
    assert_eq!(omitted.len(), 1);
    assert_eq!(omitted[0]["entry"], 0);
    assert!(
        omitted[0]["reason"]
            .as_str()
            .unwrap()
            .contains("https://example.com/a.png"),
        "{omitted:?}"
    );
    let slide = &ids(&out)[0];
    let body = body_of(&e, slide);
    let Element::Group(group) = &body else {
        panic!("words with a picture are a group")
    };
    let pictures: Vec<&str> = group
        .children
        .iter()
        .filter_map(|c| match c {
            Element::Image(i) => Some(i.src.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(pictures, ["assets/a.png"]);
}

#[test]
fn a_merged_entry_keeps_its_first_source_without_sync_and_is_listed() {
    let mut e = engine();
    let entries = story(PAGE);
    let mut merged = entries[0].clone();
    merged["title"] = json!("Plan and budget");
    merged["sources"] = json!([entries[0]["sources"][0], entries[1]["sources"][0]]);
    let out = make(&mut e, vec![merged]);
    let source = body_of(&e, &ids(&out)[0]).base().source.clone().unwrap();
    assert_eq!(
        source.section.as_deref(),
        Some("Plan"),
        "the first section is the one remembered"
    );
    assert!(!source.sync, "a merged slide is not kept in step");
    assert_eq!(
        source.hash,
        Some(fingerprint(&section_markdown(PAGE, "Plan").unwrap()))
    );
    let omitted = out["omitted"].as_array().unwrap();
    assert_eq!(omitted.len(), 1);
    assert_eq!(
        (omitted[0]["entry"].clone(), omitted[0]["what"].clone()),
        (json!(0), json!("source"))
    );
    assert!(
        omitted[0]["reason"].as_str().unwrap().contains("Budget"),
        "{omitted:?}"
    );
}

#[test]
fn an_entry_rewritten_in_the_storyboard_is_not_kept_in_step() {
    let mut e = engine();
    let mut entries = story(PAGE);
    entries[0]["evidence"] = json!(["- only this"]);
    let out = make(&mut e, entries);
    let source = body_of(&e, &ids(&out)[0]).base().source.clone().unwrap();
    assert!(!source.sync);
    assert_eq!(source.section.as_deref(), Some("Plan"));
    assert!(source.made.is_some());
    let omitted = out["omitted"].as_array().unwrap();
    assert_eq!(omitted.len(), 1);
    assert_eq!(omitted[0]["what"], "update");
}

#[test]
fn a_slide_with_nothing_to_show_is_a_section_slide_and_a_layout_can_be_chosen() {
    let mut e = engine();
    let thanks = json!({ "title": "Thanks", "evidence": [], "media": false, "sources": [] });
    let mut only = json!({ "title": "Only a title", "point": "Said.", "evidence": [], "media": false, "sources": [] });
    only["layout"] = json!("title-only");
    let out = make(&mut e, vec![thanks, only]);
    let made = ids(&out);
    let thanks = e.deck().slide(&made[0]).unwrap();
    assert_eq!(thanks.layout, "section");
    assert!(thanks.elements.iter().all(|x| x.base().source.is_none()));
    assert_eq!(
        thanks
            .elements
            .iter()
            .find(|x| x.base().placeholder.as_deref() == Some("title"))
            .unwrap()
            .text()
            .unwrap()
            .plain_text(),
        "Thanks"
    );
    let only = e.deck().slide(&made[1]).unwrap();
    assert_eq!(only.layout, "title-only");
    let body = only
        .elements
        .iter()
        .find(|x| x.base().placeholder.is_none())
        .unwrap();
    assert_eq!(body.text().unwrap().plain_text(), "Said.");
    assert!(
        body.base().source.is_none(),
        "an entry with no source remembers no page"
    );
}

#[test]
fn a_bad_storyboard_changes_nothing() {
    let mut e = engine();
    let before = bytes(e.deck());
    let mut entries = story(PAGE);
    entries[1]["layout"] = json!("nope");
    let Error::BadInput { message, .. } = e
        .apply("add_storyboard_slides", json!({ "entries": entries }))
        .unwrap_err()
    else {
        panic!("bad input")
    };
    assert!(message.contains("title-body"), "{message}");
    assert!(matches!(
        e.apply("add_storyboard_slides", json!({ "entries": [] })),
        Err(Error::BadInput { .. })
    ));
    assert!(matches!(
        e.apply(
            "add_storyboard_slides",
            json!({ "entries": story(PAGE), "after": "s-nope" })
        ),
        Err(Error::NoSuchSlide { .. })
    ));
    assert_eq!(bytes(e.deck()), before);
    assert!(!e.can_undo());
}

#[test]
fn the_slides_go_after_the_one_named_and_its_backups() {
    let mut e = engine();
    let first = first_slide(&e);
    e.apply("add_slide", json!({ "layout": "blank" })).unwrap();
    let out = e
        .apply(
            "add_storyboard_slides",
            json!({ "entries": story(PAGE), "after": first }),
        )
        .unwrap()
        .output;
    let made = ids(&out);
    assert_eq!(e.deck().slides[1].id, made[0]);
    assert_eq!(e.deck().slides[2].id, made[1]);
    assert_eq!(e.deck().slides.len(), 4);
}

#[test]
fn acknowledging_a_source_sets_its_fingerprint_and_nothing_else() {
    let mut e = engine();
    let slide = ids(&make(&mut e, story(PAGE)))[0].clone();
    let body = body_of(&e, &slide);
    let id = body.id().to_owned();
    let before = bytes(e.deck());
    let out = e
        .apply(
            "acknowledge_source",
            json!({ "slide": slide, "id": id, "markdown": "## Plan\n\nOther words." }),
        )
        .unwrap()
        .output;
    let want = fingerprint("## Plan\n\nOther words.");
    assert_eq!(out["hash"], want.as_str());
    let after = body_of(&e, &slide);
    let mut was = serde_json::to_value(&body).unwrap();
    was["source"]["hash"] = json!(want);
    assert_eq!(
        serde_json::to_value(&after).unwrap(),
        was,
        "only the fingerprint moved"
    );
    e.undo().unwrap();
    assert_eq!(bytes(e.deck()), before);
    // An element with no page behind it has nothing to acknowledge.
    let first = first_slide(&e);
    let plain = text_box(&mut e, &first, 10.0, 10.0, 100.0, 40.0, "mine");
    assert!(matches!(
        e.apply(
            "acknowledge_source",
            json!({ "slide": first, "id": plain, "markdown": "x" })
        ),
        Err(Error::Refused { .. })
    ));
}

#[test]
fn update_with_keep_edits_leaves_an_edited_slide_alone() {
    let mut e = engine();
    let slide = ids(&make(&mut e, story(PAGE)))[0].clone();
    let id = body_of(&e, &slide).id().to_owned();
    e.apply(
        "set_text",
        json!({ "slide": slide, "id": id, "markdown": "My own words." }),
    )
    .unwrap();
    let before = bytes(e.deck());
    let section = section_markdown(CHANGED, "Plan").unwrap();
    let out = update(&mut e, &slide, &id, &section, true);
    assert_eq!(out, json!({ "changed": true, "edited": true }));
    assert_eq!(bytes(e.deck()), before, "nothing was touched");
    // Replace: the page's words come back, the id stays, and the slide is untouched afterwards.
    let out = update(&mut e, &slide, &id, &section, false);
    assert_eq!(out["changed"], true);
    let body = body_of(&e, &slide);
    assert_eq!(body.id(), id);
    assert_eq!(
        body.text().unwrap().plain_text(),
        "Book late.\nflights\nguesthouse\ninsurance"
    );
    let source = body.base().source.as_ref().unwrap();
    assert_eq!(source.hash, Some(fingerprint(&section)));
    assert_eq!(
        source.made,
        Some(made_of(&body)),
        "what it says now is what it was made with"
    );
    let again = update(&mut e, &slide, &id, &section, true);
    assert_eq!(again["edited"], Value::Null);
}

#[test]
fn an_untouched_slide_is_updated_the_way_it_was_made() {
    let mut e = engine();
    let slide = ids(&make(&mut e, story(PAGE)))[0].clone();
    let id = body_of(&e, &slide).id().to_owned();
    let section = section_markdown(CHANGED, "Plan").unwrap();
    let out = update(&mut e, &slide, &id, &section, true);
    assert_eq!(out["changed"], true);
    assert_eq!(out["edited"], Value::Null, "nobody touched the slide");
    let body = body_of(&e, &slide);
    // The heading is the slide's title and not part of the words; the point still leads.
    assert_eq!(
        body.text().unwrap().plain_text(),
        "Book late.\nflights\nguesthouse\ninsurance"
    );
    let source = body.base().source.as_ref().unwrap();
    assert_eq!(source.hash, Some(fingerprint(&section)));
    assert_eq!(source.made, Some(made_of(&body)));
    assert!(source.sync && source.section.as_deref() == Some("Plan"));
    // The same page again changes nothing.
    let before = bytes(e.deck());
    let same = update(&mut e, &slide, &id, &section, true);
    assert_eq!(same["changed"], false);
    assert_eq!(bytes(e.deck()), before);
}

#[test]
fn moving_an_element_is_not_an_edit() {
    let mut e = engine();
    let slide = ids(&make(&mut e, story(PAGE)))[0].clone();
    let id = body_of(&e, &slide).id().to_owned();
    e.apply(
        "transform_elements",
        json!({ "slide": slide, "items": [{ "id": id, "x": 300.0, "y": 200.0, "w": 400.0 }] }),
    )
    .unwrap();
    e.apply(
        "patch_elements",
        json!({ "slide": slide, "patches": [{ "id": id, "patch": { "name": "My name" } }] }),
    )
    .unwrap();
    let out = update(
        &mut e,
        &slide,
        &id,
        &section_markdown(CHANGED, "Plan").unwrap(),
        true,
    );
    assert_eq!(
        out["edited"],
        Value::Null,
        "a moved, renamed element was not changed"
    );
    let body = body_of(&e, &slide);
    assert_eq!(
        body.base().rect().map(|r| (r.0, r.1, r.2)),
        Some((300.0, 200.0, 400.0)),
        "it stays where it was put"
    );
    assert_eq!(body.base().name.as_deref(), Some("My name"));
}

#[test]
fn a_word_a_host_put_in_made_is_not_a_fingerprint_and_is_left_alone() {
    let mut e = engine();
    let slide = e
        .apply("add_slide", json!({ "layout": "blank" }))
        .unwrap()
        .output["slide"]
        .as_str()
        .unwrap()
        .to_owned();
    let source = json!({ "page": "library/plan.md", "kind": "section", "section": "Plan", "sync": true, "made": "my-importer" });
    let plan = section_markdown(PAGE, "Plan").unwrap();
    let id = e
        .apply(
            "add_page_contents",
            json!({ "slide": slide, "markdown": plan, "source": source }),
        )
        .unwrap()
        .output["id"]
        .as_str()
        .unwrap()
        .to_owned();
    e.apply(
        "set_text",
        json!({ "slide": slide, "id": id, "markdown": "Mine." }),
    )
    .unwrap();
    let out = update(
        &mut e,
        &slide,
        &id,
        &section_markdown(CHANGED, "Plan").unwrap(),
        true,
    );
    assert_eq!(out["edited"], Value::Null, "it cannot tell, so it updates");
    let made = element(&e, &slide, &id)
        .base()
        .source
        .as_ref()
        .unwrap()
        .made
        .clone();
    assert_eq!(made.as_deref(), Some("my-importer"));
    assert!(page::is_fingerprint(&made_of(element(&e, &slide, &id))));
    assert!(!page::is_fingerprint("my-importer") && !page::is_fingerprint("ABCDEF0123456789"));
}

#[test]
fn what_add_page_contents_made_cannot_tell_whether_it_was_edited_and_is_updated() {
    let mut e = engine();
    let slide = e
        .apply("add_slide", json!({ "layout": "blank" }))
        .unwrap()
        .output["slide"]
        .as_str()
        .unwrap()
        .to_owned();
    let source =
        json!({ "page": "library/plan.md", "kind": "section", "section": "Plan", "sync": true });
    let plan = section_markdown(PAGE, "Plan").unwrap();
    let id = e
        .apply(
            "add_page_contents",
            json!({ "slide": slide, "markdown": plan, "source": source }),
        )
        .unwrap()
        .output["id"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(
        element(&e, &slide, &id)
            .base()
            .source
            .as_ref()
            .unwrap()
            .made,
        None
    );
    let out = update(
        &mut e,
        &slide,
        &id,
        &section_markdown(CHANGED, "Plan").unwrap(),
        true,
    );
    assert_eq!(out["edited"], Value::Null);
    assert_eq!(out["changed"], true);
    assert_eq!(
        element(&e, &slide, &id)
            .base()
            .source
            .as_ref()
            .unwrap()
            .made,
        None,
        "it stays an element that is not tracked"
    );
}
