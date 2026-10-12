//! Layouts a person makes: a slide saved as one, a layout designed, renamed, ordered, deleted and
//! imported, and the slides that follow it.

use serde_json::{Value, json};

use super::{add, bytes, element, engine, text_box};
use crate::error::Error;
use crate::model::{Element, Layout, PlaceholderKind};
use crate::ops::Engine;

fn layout<'a>(e: &'a Engine, name: &str) -> &'a Layout {
    e.deck().theme.layout(name).unwrap()
}

fn names(e: &Engine) -> Vec<String> {
    e.deck()
        .theme
        .layouts
        .iter()
        .map(|l| l.name.clone())
        .collect()
}

/// A slide on `blank` with a stripe, a heading and a list, ready to be saved as a layout.
fn designed(e: &mut Engine) -> (String, Vec<String>) {
    let s = add(e, "blank", json!({}));
    let stripe = e
        .apply(
            "add_elements",
            json!({ "slide": s, "elements": [{ "type": "shape", "shape": "rect", "x": 0, "y": 0, "w": 40, "h": 540, "style": { "fill": { "color": "accent2" } } }] }),
        )
        .unwrap()
        .output["ids"][0]
        .as_str()
        .unwrap()
        .to_owned();
    let heading = text_box(e, &s, 80.0, 40.0, 800.0, 90.0, "Heading goes here");
    let list = text_box(e, &s, 80.0, 160.0, 800.0, 300.0, "Words");
    (s, vec![stripe, heading, list])
}

fn save(e: &mut Engine, slide: &str, label: &str, roles: Value) -> Value {
    e.apply(
        "save_layout",
        json!({ "slide": slide, "label": label, "roles": roles }),
    )
    .unwrap()
    .output
}

#[test]
fn a_slide_saved_as_a_layout_keeps_its_decoration_and_makes_slots_of_what_was_marked() {
    let mut e = engine();
    let (s, ids) = designed(&mut e);
    e.apply(
        "set_background",
        json!({ "slide": s, "background": { "color": "bg2" } }),
    )
    .unwrap();
    let out = save(
        &mut e,
        &s,
        "Poster",
        json!({ ids[1].clone(): "title", ids[2].clone(): "body" }),
    );
    assert_eq!(out["layout"], "poster");

    let poster = layout(&e, "poster");
    assert_eq!(poster.label, "Poster");
    assert_eq!(
        poster.elements.len(),
        1,
        "the stripe stays behind every slide"
    );
    assert_eq!(poster.elements[0].id(), ids[0]);
    let roles: Vec<&str> = poster
        .placeholders
        .iter()
        .map(|p| p.role.as_str())
        .collect();
    assert_eq!(roles, ["title", "body"]);
    let title = poster.placeholder("title").unwrap();
    assert_eq!(
        (title.x, title.y, title.w, title.h),
        (80.0, 40.0, 800.0, 90.0)
    );
    assert_eq!(title.style.as_deref(), Some("title"));
    assert_eq!(
        title.prompt, "Click to add title",
        "the slide's words are its own"
    );
    assert_eq!(
        poster.placeholder("body").unwrap().list,
        Some(crate::model::ListKind::Bullet)
    );
    assert_eq!(
        poster.background.as_ref().and_then(|b| b.color.as_deref()),
        Some("bg2")
    );
    assert!(
        layout(&e, "blank").placeholders.is_empty(),
        "the layout it was on is unchanged"
    );
}

#[test]
fn the_slide_it_was_saved_from_goes_on_the_layout_with_its_words() {
    let mut e = engine();
    let (s, ids) = designed(&mut e);
    save(
        &mut e,
        &s,
        "Poster",
        json!({ ids[1].clone(): "title", ids[2].clone(): "body" }),
    );
    let slide = e.deck().slide(&s).unwrap();
    assert_eq!(slide.layout, "poster");
    assert_eq!(slide.elements.len(), 2, "the stripe moved to the layout");
    let heading = element(&e, &s, &ids[1]);
    assert_eq!(heading.base().placeholder.as_deref(), Some("title"));
    assert!(
        heading.base().rect().is_none(),
        "it follows the layout's slot now"
    );
    assert_eq!(heading.text().unwrap().plain_text(), "Heading goes here");
    assert!(
        slide.background.is_none(),
        "the background moved to the layout too"
    );
}

#[test]
fn a_slide_can_be_saved_without_going_on_the_layout() {
    let mut e = engine();
    let (s, ids) = designed(&mut e);
    let before = e.deck().slide(&s).unwrap().clone();
    e.apply(
        "save_layout",
        json!({ "slide": s, "label": "Poster", "roles": { ids[1].clone(): "title" }, "useForSlide": false }),
    )
    .unwrap();
    assert_eq!(e.deck().slide(&s).unwrap(), &before);
    assert!(e.deck().theme.layout("poster").is_some());
}

#[test]
fn saving_can_make_the_layout_the_one_new_slides_start_from() {
    let mut e = engine();
    let (s, ids) = designed(&mut e);
    e.apply(
        "save_layout",
        json!({ "slide": s, "label": "Poster", "roles": { ids[1].clone(): "title" }, "newSlideDefault": true }),
    )
    .unwrap();
    assert_eq!(e.deck().theme.new_slide_layout.as_deref(), Some("poster"));
}

#[test]
fn saving_is_one_step_of_undo_and_changes_nothing_when_refused() {
    let mut e = engine();
    let (s, ids) = designed(&mut e);
    let before = bytes(e.deck());
    save(&mut e, &s, "Poster", json!({ ids[1].clone(): "title" }));
    assert_ne!(bytes(e.deck()), before);
    e.undo().unwrap();
    assert_eq!(bytes(e.deck()), before);
    e.redo().unwrap();
    assert!(e.deck().theme.layout("poster").is_some());

    let before = bytes(e.deck());
    for input in [
        json!({ "slide": s, "label": "  ", "roles": {} }),
        json!({ "slide": s, "label": "X", "roles": { "e-nope": "title" } }),
        json!({ "slide": s, "label": "X", "roles": { ids[0].clone(): "title" } }),
        json!({ "slide": s, "label": "X", "roles": { ids[1].clone(): "heading" } }),
        json!({ "slide": "s-nope", "label": "X", "roles": {} }),
    ] {
        let err = e.apply("save_layout", input).unwrap_err();
        assert!(
            matches!(
                err,
                Error::BadInput { .. } | Error::NoSuchSlide { .. } | Error::NoSuchElement { .. }
            ),
            "{err}"
        );
    }
    assert_eq!(bytes(e.deck()), before, "a refused save changes nothing");
}

#[test]
fn a_layout_takes_a_name_no_other_has_and_the_label_is_what_people_see() {
    let mut e = engine();
    let (s, ids) = designed(&mut e);
    let roles = json!({ ids[1].clone(): "title" });
    let first = save(&mut e, &s, "Title + body", roles.clone());
    assert_eq!(first["layout"], "title-body-2", "built-in names are taken");
    let second = save(&mut e, &s, "Title + body", json!({}));
    assert_eq!(second["layout"], "title-body-3");
    assert_eq!(layout(&e, "title-body-2").label, "Title + body");
    let odd = save(&mut e, &s, "  Ünï!  ", json!({}));
    assert_eq!(odd["layout"], "n");
}

#[test]
fn two_slots_of_a_kind_are_numbered_and_a_picture_is_a_picture_slot() {
    let mut e = engine();
    let s = add(&mut e, "blank", json!({}));
    let a = text_box(&mut e, &s, 40.0, 40.0, 400.0, 200.0, "a");
    let b = text_box(&mut e, &s, 480.0, 40.0, 400.0, 200.0, "b");
    let pic = e
        .apply(
            "add_elements",
            json!({ "slide": s, "elements": [{ "type": "image", "src": "assets/a.png", "x": 40, "y": 300, "w": 300, "h": 200 }] }),
        )
        .unwrap()
        .output["ids"][0]
        .as_str()
        .unwrap()
        .to_owned();
    save(
        &mut e,
        &s,
        "Pair",
        json!({ a.clone(): "body", b.clone(): "body", pic.clone(): "picture" }),
    );
    let pair = layout(&e, "pair");
    let roles: Vec<&str> = pair.placeholders.iter().map(|p| p.role.as_str()).collect();
    assert_eq!(roles, ["body", "body2", "image"]);
    assert_eq!(pair.placeholders[2].kind, PlaceholderKind::Image);
    assert!(pair.elements.is_empty());
}

#[test]
fn words_formatted_on_the_slide_become_the_look_of_the_slot() {
    let mut e = engine();
    let s = add(&mut e, "blank", json!({}));
    let heading = e
        .apply(
            "add_elements",
            json!({ "slide": s, "elements": [{ "type": "text", "x": 80, "y": 40, "w": 800, "h": 90, "text": { "paragraphs": [{ "align": "center", "runs": [{ "t": "Big", "size": 54, "color": "accent2", "b": true }] }] } }] }),
        )
        .unwrap()
        .output["ids"][0]
        .as_str()
        .unwrap()
        .to_owned();
    save(&mut e, &s, "Banner", json!({ heading.clone(): "title" }));
    let style = e.deck().theme.text_style("banner.title").unwrap();
    assert_eq!(
        (style.size, style.color.as_str(), style.bold),
        (54.0, "accent2", true)
    );
    assert_eq!(
        layout(&e, "banner")
            .placeholder("title")
            .unwrap()
            .style
            .as_deref(),
        Some("banner.title")
    );
    // A new slide of it is set in that look without anything of its own on it.
    let t = add(&mut e, "banner", json!({ "title": "Hello" }));
    let words = &e.deck().slide(&t).unwrap().elements[0];
    assert_eq!(words.text().unwrap().plain_text(), "Hello");
    assert!(words.text().unwrap().paragraphs[0].runs[0].size.is_none());
}

#[test]
fn a_new_slide_from_a_custom_layout_has_its_slots_ready_and_the_agent_tools_name_it() {
    let mut e = engine();
    let (s, ids) = designed(&mut e);
    save(
        &mut e,
        &s,
        "Poster",
        json!({ ids[1].clone(): "title", ids[2].clone(): "body" }),
    );
    let t = add(&mut e, "poster", json!({ "title": "Hi", "body": "- one" }));
    let slide = e.deck().slide(&t).unwrap();
    assert_eq!(slide.layout, "poster");
    assert_eq!(slide.elements.len(), 2);
    assert!(slide.elements.iter().all(|x| x.base().rect().is_none()));
    let Err(Error::BadInput { message, .. }) = e.apply(
        "add_slide",
        json!({ "layout": "poster", "content": { "caption": "x" } }),
    ) else {
        panic!("a slot the layout lacks is refused")
    };
    assert!(message.contains("title, body"), "{message}");
}

#[test]
fn designing_a_layout_moves_the_slots_of_every_slide_that_follows_it() {
    let mut e = engine();
    let (s, ids) = designed(&mut e);
    save(
        &mut e,
        &s,
        "Poster",
        json!({ ids[1].clone(): "title", ids[2].clone(): "body" }),
    );
    let first = add(&mut e, "poster", json!({ "title": "One", "body": "a" }));
    let second = add(&mut e, "poster", json!({ "title": "Two", "body": "b" }));
    // The second slide's title was moved by hand: it keeps its own place.
    let moved = e.deck().slide(&second).unwrap().elements[0].id().to_owned();
    e.apply(
        "transform_elements",
        json!({ "slide": second, "items": [{ "id": moved, "x": 300.0, "y": 300.0 }] }),
    )
    .unwrap();

    let mut design = crate::design::design_deck(e.deck(), "poster")
        .unwrap()
        .slides[0]
        .clone();
    for el in &mut design.elements {
        if el.base().placeholder.as_deref() == Some("title") {
            el.base_mut().x = Some(200.0);
            el.base_mut().w = Some(500.0);
        }
    }
    design
        .elements
        .retain(|el| el.base().placeholder.as_deref() != Some("body"));
    let out = e
        .apply(
            "set_layout_design",
            json!({ "name": "poster", "design": design }),
        )
        .unwrap();
    assert_eq!(
        out.output["detached"].as_array().unwrap().len(),
        3,
        "the list on each of the three slides that use it"
    );

    let poster = layout(&e, "poster");
    assert_eq!(poster.placeholders.len(), 1);
    assert_eq!(poster.placeholder("title").unwrap().x, 200.0);
    assert_eq!(poster.elements.len(), 1, "the stripe is still there");

    let one = e.deck().slide(&first).unwrap();
    let title = one
        .elements
        .iter()
        .find(|x| x.base().placeholder.as_deref() == Some("title"))
        .unwrap();
    assert!(title.base().rect().is_none(), "it follows the layout");
    assert_eq!(
        title.text().unwrap().plain_text(),
        "One",
        "with the words it has"
    );
    let body = one
        .elements
        .iter()
        .find(|x| x.base().placeholder.is_none())
        .unwrap();
    assert_eq!(
        body.text().unwrap().plain_text(),
        "a",
        "the words of a slot that went stay, where they were"
    );
    assert!(body.base().rect().is_some());

    let two = e.deck().slide(&second).unwrap();
    let title = two
        .elements
        .iter()
        .find(|x| x.base().placeholder.as_deref() == Some("title"))
        .unwrap();
    assert_eq!(
        title.base().x,
        Some(300.0),
        "a placeholder moved by hand stays where it was put"
    );
}

#[test]
fn designing_a_layout_is_one_undoable_step_that_changes_slides_and_theme_together() {
    let mut e = engine();
    let (s, ids) = designed(&mut e);
    save(
        &mut e,
        &s,
        "Poster",
        json!({ ids[1].clone(): "title", ids[2].clone(): "body" }),
    );
    let t = add(&mut e, "poster", json!({ "title": "One", "body": "a" }));
    let before = bytes(e.deck());
    let mut design = crate::design::design_deck(e.deck(), "poster")
        .unwrap()
        .slides[0]
        .clone();
    design.elements.clear();
    e.apply(
        "set_layout_design",
        json!({ "name": "poster", "design": design, "hideMaster": true }),
    )
    .unwrap();
    assert!(layout(&e, "poster").hide_master);
    assert!(
        e.deck()
            .slide(&t)
            .unwrap()
            .elements
            .iter()
            .all(|x| x.base().placeholder.is_none())
    );
    e.undo().unwrap();
    assert_eq!(bytes(e.deck()), before);
}

#[test]
fn a_slide_can_be_reset_to_its_layout() {
    let mut e = engine();
    let t = add(
        &mut e,
        "title-body",
        json!({ "title": "T", "body": "kept" }),
    );
    let body = e.deck().slide(&t).unwrap().elements[1].id().to_owned();
    e.apply(
        "transform_elements",
        json!({ "slide": t, "items": [{ "id": body, "x": 10.0, "y": 10.0, "w": 50.0 }] }),
    )
    .unwrap();
    let title = e.deck().slide(&t).unwrap().elements[0].id().to_owned();
    e.apply("delete_elements", json!({ "slide": t, "ids": [title] }))
        .unwrap();
    assert_eq!(e.deck().slide(&t).unwrap().elements.len(), 1);
    let out = e.apply("reset_slides", json!({ "ids": [t] })).unwrap();
    assert_eq!(out.output["reset"], 1);
    assert_eq!(
        out.output["added"].as_array().unwrap().len(),
        1,
        "the title slot came back, empty"
    );
    let slide = e.deck().slide(&t).unwrap();
    let body = slide
        .elements
        .iter()
        .find(|x| x.base().placeholder.as_deref() == Some("body"))
        .unwrap();
    assert!(
        body.base().rect().is_none(),
        "the moved slot is back in its place"
    );
    assert_eq!(body.text().unwrap().plain_text(), "kept", "with its words");
    // Nothing to do the second time.
    let again = e.apply("reset_slides", json!({ "ids": [t] })).unwrap();
    assert_eq!(again.output["reset"], 0);
    assert!(again.changes.is_empty());
}

#[test]
fn a_layout_is_added_blank_or_as_a_copy_that_does_not_share_its_looks() {
    let mut e = engine();
    let (s, ids) = designed(&mut e);
    save(&mut e, &s, "Banner", json!({ ids[1].clone(): "title" }));
    let blank = e
        .apply("add_layout", json!({ "label": "Blank (mine)" }))
        .unwrap()
        .output;
    assert_eq!(blank["layout"], "blank-mine");
    assert!(layout(&e, "blank-mine").placeholders.is_empty());
    assert_eq!(names(&e).last().map(String::as_str), Some("blank-mine"));

    let copy = e
        .apply(
            "add_layout",
            json!({ "label": "Banner 2", "from": "banner" }),
        )
        .unwrap()
        .output;
    assert_eq!(copy["layout"], "banner-2");
    let c = layout(&e, "banner-2");
    assert_eq!(c.elements, layout(&e, "banner").elements);
    assert_eq!(
        c.placeholders.len(),
        layout(&e, "banner").placeholders.len()
    );
    assert!(matches!(
        e.apply("add_layout", json!({ "label": "X", "from": "nope" })),
        Err(Error::BadInput { .. })
    ));
}

#[test]
fn a_copy_gets_text_styles_of_its_own() {
    let mut e = engine();
    let s = add(&mut e, "blank", json!({}));
    let heading = e
        .apply(
            "add_elements",
            json!({ "slide": s, "elements": [{ "type": "text", "x": 80, "y": 40, "w": 800, "h": 90, "text": { "paragraphs": [{ "runs": [{ "t": "Big", "size": 54 }] }] } }] }),
        )
        .unwrap()
        .output["ids"][0]
        .as_str()
        .unwrap()
        .to_owned();
    save(&mut e, &s, "Banner", json!({ heading: "title" }));
    e.apply(
        "add_layout",
        json!({ "label": "Banner copy", "from": "banner" }),
    )
    .unwrap();
    let copy = layout(&e, "banner-copy");
    assert_eq!(
        copy.placeholder("title").unwrap().style.as_deref(),
        Some("banner-copy.title")
    );
    e.apply(
        "delete_layout",
        json!({ "name": "banner", "moveTo": "blank" }),
    )
    .unwrap();
    assert!(
        e.deck().theme.text_style("banner.title").is_none(),
        "the original's own style went with it"
    );
    assert!(e.deck().theme.text_style("banner-copy.title").is_some());
}

#[test]
fn a_layout_can_be_renamed_hidden_from_the_master_and_made_the_default() {
    let mut e = engine();
    e.apply("add_layout", json!({ "label": "Mine" })).unwrap();
    e.apply(
        "edit_layout",
        json!({ "name": "mine", "label": "  My own  ", "hideMaster": true, "defaultForNew": true }),
    )
    .unwrap();
    let mine = layout(&e, "mine");
    assert_eq!((mine.label.as_str(), mine.hide_master), ("My own", true));
    assert_eq!(e.deck().theme.new_slide_layout.as_deref(), Some("mine"));
    e.apply(
        "edit_layout",
        json!({ "name": "mine", "defaultForNew": false }),
    )
    .unwrap();
    assert_eq!(e.deck().theme.new_slide_layout, None);
    for bad in [
        json!({ "name": "mine", "label": " " }),
        json!({ "name": "nope", "label": "x" }),
    ] {
        assert!(matches!(
            e.apply("edit_layout", bad),
            Err(Error::BadInput { .. })
        ));
    }
}

#[test]
fn layouts_are_ordered_and_a_built_in_one_can_be_moved_too() {
    let mut e = engine();
    e.apply("add_layout", json!({ "label": "Mine" })).unwrap();
    e.apply("move_layout", json!({ "name": "mine", "to": 0 }))
        .unwrap();
    assert_eq!(names(&e)[0], "mine");
    e.apply("move_layout", json!({ "name": "mine", "to": 99 }))
        .unwrap();
    assert_eq!(names(&e).last().map(String::as_str), Some("mine"));
    assert!(matches!(
        e.apply("move_layout", json!({ "name": "nope", "to": 1 })),
        Err(Error::BadInput { .. })
    ));
}

#[test]
fn deleting_a_layout_that_slides_use_says_where_they_go_and_keeps_what_is_on_them() {
    let mut e = engine();
    let (s, ids) = designed(&mut e);
    save(
        &mut e,
        &s,
        "Poster",
        json!({ ids[1].clone(): "title", ids[2].clone(): "body" }),
    );
    let t = add(&mut e, "poster", json!({ "title": "One", "body": "a" }));
    e.apply(
        "edit_layout",
        json!({ "name": "poster", "defaultForNew": true }),
    )
    .unwrap();
    let before = bytes(e.deck());
    let Err(Error::Refused { message }) = e.apply("delete_layout", json!({ "name": "poster" }))
    else {
        panic!("slides use it")
    };
    assert!(
        message.contains("2 slides") && message.contains("moveTo"),
        "{message}"
    );
    assert_eq!(bytes(e.deck()), before);

    e.apply(
        "delete_layout",
        json!({ "name": "poster", "moveTo": "title-only" }),
    )
    .unwrap();
    assert!(e.deck().theme.layout("poster").is_none());
    assert_eq!(
        e.deck().theme.new_slide_layout,
        None,
        "the default went with it"
    );
    let slide = e.deck().slide(&t).unwrap();
    assert_eq!(slide.layout, "title-only");
    assert!(
        slide
            .elements
            .iter()
            .any(|x| x.base().placeholder.is_none()
                && x.text().is_some_and(|t| t.plain_text() == "a"))
    );
    crate::canonical::check_structure(e.deck()).unwrap();
    e.undo().unwrap();
    assert_eq!(bytes(e.deck()), before);
}

#[test]
fn a_deck_keeps_a_layout_and_a_move_goes_to_another_one() {
    let mut e = engine();
    let Err(Error::BadInput { .. }) = e.apply(
        "delete_layout",
        json!({ "name": "blank", "moveTo": "blank" }),
    ) else {
        panic!("not to itself")
    };
    e.apply("add_layout", json!({ "label": "Mine" })).unwrap();
    e.apply("delete_layout", json!({ "name": "mine" })).unwrap();
    let all = names(&e);
    for name in &all[..all.len() - 1] {
        e.apply(
            "delete_layout",
            json!({ "name": name, "moveTo": all.last().unwrap() }),
        )
        .unwrap();
    }
    let Err(Error::Refused { .. }) = e.apply(
        "delete_layout",
        json!({ "name": all.last().unwrap(), "moveTo": "x" }),
    ) else {
        panic!("a theme keeps a layout")
    };
}

#[test]
fn layouts_of_another_deck_come_in_under_names_that_are_free_with_their_looks() {
    let mut other = engine();
    let (s, ids) = designed(&mut other);
    save(&mut other, &s, "Poster", json!({ ids[1].clone(): "title" }));
    other
        .apply("add_layout", json!({ "label": "Poster", "from": "poster" }))
        .unwrap();
    let theirs: Vec<Layout> = other
        .deck()
        .theme
        .layouts
        .iter()
        .filter(|l| l.name.starts_with("poster"))
        .cloned()
        .collect();
    let styles = other.deck().theme.text_styles.clone();

    let mut e = engine();
    let out = e
        .apply(
            "import_layouts",
            json!({ "layouts": theirs, "textStyles": styles }),
        )
        .unwrap();
    assert_eq!(out.output["added"], json!(["poster", "poster-2"]));
    assert_eq!(layout(&e, "poster").label, "Poster");
    let again = e
        .apply(
            "import_layouts",
            json!({ "layouts": [layout(&e, "poster")], "textStyles": {} }),
        )
        .unwrap();
    assert_eq!(again.output["added"], json!(["poster-3"]));
    crate::canonical::check_structure(e.deck()).unwrap();
    assert!(matches!(
        e.apply("import_layouts", json!({ "layouts": [], "textStyles": {} })),
        Err(Error::BadInput { .. })
    ));
}

#[test]
fn a_slide_the_layout_gives_its_own_background_shows_it_unless_it_has_one() {
    let mut e = engine();
    let (s, ids) = designed(&mut e);
    e.apply(
        "set_background",
        json!({ "slide": s, "background": { "color": "accent3" } }),
    )
    .unwrap();
    save(&mut e, &s, "Poster", json!({ ids[1].clone(): "title" }));
    let t = add(&mut e, "poster", json!({}));
    let deck = e.deck();
    let theme = &deck.theme;
    let slide = deck.slide(&t).unwrap();
    assert_eq!(
        crate::resolve::background_of(theme, slide).and_then(|b| b.color.as_deref()),
        Some("accent3")
    );
    e.apply(
        "set_background",
        json!({ "slide": t, "background": { "color": "bg2" } }),
    )
    .unwrap();
    let deck = e.deck();
    assert_eq!(
        crate::resolve::background_of(&deck.theme, deck.slide(&t).unwrap())
            .and_then(|b| b.color.as_deref()),
        Some("bg2")
    );
}

#[test]
fn a_built_in_theme_leaves_the_layouts_a_person_made_where_they_are() {
    let mut e = engine();
    let (s, ids) = designed(&mut e);
    save(&mut e, &s, "Poster", json!({ ids[1].clone(): "title" }));
    e.apply(
        "edit_layout",
        json!({ "name": "poster", "defaultForNew": true }),
    )
    .unwrap();
    e.apply("apply_theme", json!({ "name": "Dark" })).unwrap();
    assert_eq!(e.deck().theme.name, "Dark");
    let slide = e.deck().slide(&s).unwrap();
    assert_eq!(slide.layout, "poster", "its slides stay on it");
    let poster = layout(&e, "poster");
    assert!(
        poster
            .elements
            .iter()
            .any(|x| matches!(x, Element::Shape(_))),
        "with its decoration"
    );
    assert_eq!(e.deck().theme.new_slide_layout.as_deref(), Some("poster"));
    assert!(
        names(&e)
            .iter()
            .take(12)
            .eq(crate::themes::BUILT_IN_LAYOUTS.iter()),
        "the theme's own twelve come first"
    );
}
