use super::*;
use crate::model::{Align, Background, Fill, Run, Style};
use crate::ops::Engine;

fn deck() -> Deck {
    Engine::create("Design", "Light", 1).unwrap().deck().clone()
}

fn read(deck: &Deck, design: &Deck, prompts: Prompts) -> Read {
    let base = deck.theme.layout(&design.slides[0].layout).unwrap();
    layout_from_slide(&design.theme, base, &design.slides[0], prompts)
}

fn rect(id: &str, x: f64, y: f64, w: f64, h: f64, color: &str) -> Element {
    let mut base = Base::new(id).place(x, y, w, h);
    base.style = Some(Style {
        fill: Some(Fill {
            color: color.to_owned(),
            alpha: None,
            extra: Extra::new(),
        }),
        ..Style::default()
    });
    Element::shape(base, "rect", None)
}

fn words(id: &str, role: &str, x: f64, text: Text) -> Element {
    let mut base = Base::new(id).place(x, 40.0, 300.0, 80.0);
    base.placeholder = Some(role.to_owned());
    Element::text_el(base, text)
}

#[test]
fn a_layout_is_a_slide_of_its_slots_and_reads_back_as_the_layout_it_was() {
    let deck = deck();
    for layout in &deck.theme.layouts {
        let design = design_deck(&deck, &layout.name).unwrap();
        let slide = &design.slides[0];
        assert_eq!(slide.id, DESIGN_SLIDE);
        assert_eq!(slide.layout, layout.name);
        assert_eq!(slide.elements.len(), layout.placeholders.len());
        for (element, def) in slide.elements.iter().zip(&layout.placeholders) {
            assert_eq!(
                element.base().placeholder.as_deref(),
                Some(def.role.as_str())
            );
            assert_eq!(
                element.base().rect(),
                Some((def.x, def.y, def.w, def.h)),
                "the slot is where it is on the layout"
            );
        }
        let back = read(&deck, &design, Prompts::FromWords);
        assert_eq!(&back.layout, layout, "{} reads back unchanged", layout.name);
        assert!(back.styles.is_empty(), "nothing of its own to name");
    }
}

#[test]
fn the_prompt_is_what_the_slot_shows_while_the_layout_is_designed() {
    let deck = deck();
    let design = design_deck(&deck, "title-body").unwrap();
    let title = design.slides[0].elements[0].text().unwrap();
    assert_eq!(title.plain_text(), "Click to add title");
    let body = design.slides[0].elements[1].text().unwrap();
    assert_eq!(body.paragraphs[0].list, Some(ListKind::Bullet));
}

#[test]
fn decoration_and_background_come_back_as_they_went() {
    let mut deck = deck();
    let at = deck
        .theme
        .layouts
        .iter()
        .position(|l| l.name == "title-only")
        .unwrap();
    deck.theme.layouts[at].elements = vec![rect("stripe", 0.0, 0.0, 40.0, 540.0, "accent1")];
    deck.theme.layouts[at].background = Some(Background {
        color: Some("bg2".to_owned()),
        image: None,
        extra: Extra::new(),
    });
    let design = design_deck(&deck, "title-only").unwrap();
    let slide = &design.slides[0];
    assert_eq!(slide.elements.len(), 2, "the stripe, then the title slot");
    assert_eq!(slide.elements[0].id(), "stripe");
    assert!(slide.elements[1].base().placeholder.is_some());
    assert_eq!(
        slide.background.as_ref().and_then(|b| b.color.as_deref()),
        Some("bg2")
    );
    let back = read(&deck, &design, Prompts::FromWords);
    assert_eq!(back.layout, deck.theme.layouts[at]);
}

#[test]
fn what_is_changed_on_the_slide_is_what_the_layout_becomes() {
    let deck = deck();
    let mut design = design_deck(&deck, "title-only").unwrap();
    let slide = &mut design.slides[0];
    slide
        .elements
        .insert(0, rect("band", 0.0, 480.0, 960.0, 60.0, "accent2"));
    slide.elements[1].base_mut().x = Some(120.0);
    slide.elements[1].base_mut().w = Some(700.0);
    slide.background = Some(Background {
        color: Some("accent3".to_owned()),
        image: None,
        extra: Extra::new(),
    });
    let back = read(&deck, &design, Prompts::FromWords).layout;
    assert_eq!(back.elements.len(), 1);
    assert_eq!(back.elements[0].id(), "band");
    let title = back.placeholder("title").unwrap();
    assert_eq!((title.x, title.w), (120.0, 700.0));
    assert_eq!(
        back.background.as_ref().and_then(|b| b.color.as_deref()),
        Some("accent3")
    );
    assert_eq!(
        (back.name.as_str(), back.label.as_str()),
        ("title-only", "Title only")
    );
}

#[test]
fn words_set_in_a_slot_become_a_text_style_named_for_the_layout_and_the_slot() {
    let deck = deck();
    let mut design = design_deck(&deck, "title-only").unwrap();
    let Element::Text(title) = &mut design.slides[0].elements[0] else {
        panic!("a text slot")
    };
    title.text.paragraphs[0].align = Some(Align::Center);
    title.text.paragraphs[0].runs[0] = Run {
        size: Some(60.0),
        color: Some("accent2".to_owned()),
        italic: true,
        ..Run::plain("Click to add title")
    };
    let back = read(&deck, &design, Prompts::FromWords);
    let def = back.layout.placeholder("title").unwrap();
    assert_eq!(def.style.as_deref(), Some("title-only.title"));
    let style = &back.styles["title-only.title"];
    assert_eq!(style.size, 60.0);
    assert_eq!(style.color, "accent2");
    assert!(style.italic);
    assert_eq!(style.align, Some(Align::Center));
    assert_eq!(
        style.font,
        deck.theme.text_style("title").unwrap().font,
        "what it did not say stays the title's"
    );
}

#[test]
fn a_new_slot_is_understood_from_its_role_and_what_is_in_it() {
    let deck = deck();
    let mut design = design_deck(&deck, "blank").unwrap();
    let list = Paragraph {
        list: Some(ListKind::Bullet),
        style: Some("body".to_owned()),
        ..Paragraph::plain("Click to add text")
    };
    let slide = &mut design.slides[0];
    slide
        .elements
        .push(words("a", "body", 40.0, Text::from_paragraphs(vec![list])));
    let sub = Paragraph {
        style: Some("subtitle".to_owned()),
        ..Paragraph::plain("Click to add subtitle")
    };
    slide.elements.push(words(
        "b",
        "subtitle",
        400.0,
        Text::from_paragraphs(vec![sub]),
    ));
    let mut picture = Base::new("c").place(40.0, 200.0, 300.0, 200.0);
    picture.placeholder = Some("image".to_owned());
    slide.elements.push(Element::Image(ImageEl {
        base: picture,
        src: String::new(),
        crop: None,
        mask: None,
        extra: Extra::new(),
    }));
    let back = read(&deck, &design, Prompts::FromWords).layout;
    let roles: Vec<&str> = back.placeholders.iter().map(|p| p.role.as_str()).collect();
    assert_eq!(roles, ["body", "subtitle", "image"]);
    assert_eq!(back.placeholders[0].list, Some(ListKind::Bullet));
    assert_eq!(back.placeholders[0].style.as_deref(), Some("body"));
    assert_eq!(back.placeholders[1].style.as_deref(), Some("subtitle"));
    assert_eq!(back.placeholders[2].kind, PlaceholderKind::Image);
    assert_eq!(back.placeholders[2].w, 300.0);
}

#[test]
fn a_slot_that_two_elements_claim_is_two_slots() {
    let deck = deck();
    let mut design = design_deck(&deck, "title-only").unwrap();
    let again = words("dup", "title", 500.0, Text::plain("Another"));
    design.slides[0].elements.push(again);
    let back = read(&deck, &design, Prompts::FromWords).layout;
    let roles: Vec<&str> = back.placeholders.iter().map(|p| p.role.as_str()).collect();
    assert_eq!(roles, ["title", "title2"]);
    assert_eq!(back.placeholders[1].prompt, "Another");
}

#[test]
fn a_prompt_is_kept_when_the_words_are_a_slide_s_own() {
    let deck = deck();
    let mut design = design_deck(&deck, "title-only").unwrap();
    let Element::Text(title) = &mut design.slides[0].elements[0] else {
        panic!("a text slot")
    };
    title.text = Text::plain("Quarterly results");
    let typed = read(&deck, &design, Prompts::FromWords).layout;
    assert_eq!(
        typed.placeholder("title").unwrap().prompt,
        "Quarterly results"
    );
    let kept = read(&deck, &design, Prompts::Kept).layout;
    assert_eq!(
        kept.placeholder("title").unwrap().prompt,
        "Click to add title"
    );
}

#[test]
fn something_that_is_not_words_or_a_picture_cannot_be_a_slot_and_a_slot_without_a_place_is_dropped()
{
    let deck = deck();
    let mut design = design_deck(&deck, "blank").unwrap();
    let slide = &mut design.slides[0];
    let mut shape = rect("s", 10.0, 10.0, 50.0, 50.0, "accent1");
    shape.base_mut().placeholder = Some("title".to_owned());
    slide.elements.push(shape);
    let mut lost = Element::text_el(Base::new("l"), Text::plain("nowhere"));
    lost.base_mut().placeholder = Some("body".to_owned());
    slide.elements.push(lost);
    let back = read(&deck, &design, Prompts::FromWords).layout;
    assert!(back.placeholders.is_empty());
    assert_eq!(
        back.elements.len(),
        1,
        "the shape is decoration; the lost text has no place to draw"
    );
    assert!(back.elements[0].base().placeholder.is_none());
}

#[test]
fn a_code_block_on_the_design_is_drawn_as_the_shapes_it_is_made_of() {
    let deck = deck();
    let mut design = design_deck(&deck, "blank").unwrap();
    let code: Element = serde_json::from_value(serde_json::json!({
        "type": "code", "id": "snippet", "x": 100, "y": 100, "w": 400, "h": 200,
        "code": "print(1)", "language": "python"
    }))
    .unwrap();
    design.slides[0].elements.push(code);
    let back = read(&deck, &design, Prompts::FromWords).layout;
    assert_eq!(back.elements.len(), 1);
    assert!(
        matches!(back.elements[0], Element::Group(_)),
        "{:?}",
        back.elements[0].kind()
    );
}

#[test]
fn a_layout_that_is_not_there_is_refused_with_the_names_that_are() {
    let err = design_deck(&deck(), "nope").unwrap_err().to_string();
    assert!(err.contains("nope") && err.contains("title-body"), "{err}");
}

#[test]
fn roles_are_numbered_when_they_repeat_and_understood_with_their_numbers() {
    assert_eq!(free_role(SlotKind::Body, &[]), "body");
    assert_eq!(free_role(SlotKind::Body, &["body", "body2"]), "body3");
    assert_eq!(free_role(SlotKind::Picture, &["image"]), "image2");
    assert_eq!(SlotKind::of_role("body2"), SlotKind::Body);
    assert_eq!(SlotKind::of_role("label"), SlotKind::Subtitle);
    assert_eq!(SlotKind::of_role("anything"), SlotKind::Text);
    assert_eq!(SlotKind::parse("picture"), Some(SlotKind::Picture));
    assert_eq!(SlotKind::parse("heading"), None);
}
