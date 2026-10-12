//! Layouts a person made are real layouts of the PowerPoint file: their decoration and background
//! are on the layout, their slots are its placeholders, and a slide of them points at them.

mod common;

use serde_json::json;
use slides_core::Deck;
use slides_pptx::import::{ImportOptions, import};
use slides_pptx::{Options, export};

use common::{Builder, Files, inspect};

/// A deck with a layout called Poster: a stripe on every slide, a background of its own, a title and a list.
fn poster() -> (Deck, String, String) {
    let mut b = Builder::new("Light", "Layouts", 4);
    let made = b.slide("blank", json!({}));
    let ids = b.add(
        &made.id,
        json!([
            { "type": "shape", "shape": "rect", "x": 0, "y": 0, "w": 40, "h": 540, "style": { "fill": { "color": "accent2" } } },
            { "type": "text", "x": 80, "y": 40, "w": 800, "h": 90, "text": { "paragraphs": [{ "runs": [{ "t": "A heading" }] }] } },
            { "type": "text", "x": 80, "y": 160, "w": 800, "h": 300, "text": { "paragraphs": [{ "runs": [{ "t": "Some words" }] }] } },
        ]),
    );
    b.apply(
        "set_background",
        json!({ "slide": made.id, "background": { "color": "bg2" } }),
    );
    b.apply(
        "save_layout",
        json!({ "slide": made.id, "label": "Poster", "roles": { ids[1].clone(): "title", ids[2].clone(): "body" } }),
    );
    let other = b.slide("poster", json!({ "title": "Second", "body": "- one" }));
    (b.deck(), made.id, other.id)
}

fn text(package: &inspect::Package, name: &str) -> String {
    String::from_utf8_lossy(
        package
            .parts
            .get(name)
            .unwrap_or_else(|| panic!("{name} is not in the file")),
    )
    .into_owned()
}

/// The layout part that is called `label`.
fn layout_named(package: &inspect::Package, label: &str) -> (String, String) {
    package
        .parts
        .keys()
        .filter(|n| n.starts_with("ppt/slideLayouts/slideLayout") && n.ends_with(".xml"))
        .map(|n| (n.clone(), text(package, n)))
        .find(|(_, xml)| xml.contains(&format!(r#"<p:cSld name="{label}">"#)))
        .unwrap_or_else(|| panic!("no layout called {label}"))
}

#[test]
fn a_layout_of_a_person_is_a_layout_of_the_file_with_its_decoration_background_and_slots() {
    let (deck, _, _) = poster();
    let file =
        export(&deck, &Files::default(), &Options::default()).unwrap_or_else(|e| panic!("{e}"));
    assert!(file.warnings.is_empty(), "{:?}", file.warnings);
    let package = inspect::open(&file.bytes);
    for (name, bytes) in &package.parts {
        if inspect::is_xml(name) {
            inspect::elements(name, bytes);
        }
    }
    let (name, xml) = layout_named(&package, "Poster");
    assert_eq!(
        name, "ppt/slideLayouts/slideLayout13.xml",
        "after the twelve of the theme"
    );
    assert!(
        xml.contains(r#"<p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg2"/>"#),
        "{xml}"
    );
    let decoration = xml.find(r#"userDrawn="1"/>"#).unwrap_or(usize::MAX);
    let title = xml.find(r#"<p:ph type="title"/>"#).unwrap_or(0);
    assert!(decoration < title, "the stripe, then the slots: {xml}");
    assert!(xml.contains(r#"<a:schemeClr val="accent2"/>"#), "{xml}");
    assert!(xml.contains(r#"<p:ph type="body" idx="1"/>"#), "{xml}");
    assert!(xml.contains("<a:t>Click to add title</a:t>"), "{xml}");
    let master = text(&package, "ppt/slideMasters/slideMaster1.xml");
    assert_eq!(master.matches("<p:sldLayoutId ").count(), 13);
}

#[test]
fn a_slide_of_that_layout_points_at_it_and_leaves_the_background_to_it() {
    let (deck, first, second) = poster();
    let file =
        export(&deck, &Files::default(), &Options::default()).unwrap_or_else(|e| panic!("{e}"));
    let package = inspect::open(&file.bytes);
    for (n, id) in [first, second].iter().enumerate() {
        let part = format!("ppt/slides/slide{}.xml", n + 2);
        let rels = text(
            &package,
            &format!("ppt/slides/_rels/slide{}.xml.rels", n + 2),
        );
        assert!(
            rels.contains("../slideLayouts/slideLayout13.xml"),
            "{id}: {rels}"
        );
        let xml = text(&package, &part);
        assert!(
            !xml.contains("<p:bg>"),
            "the layout's background shows: {xml}"
        );
    }
}

#[test]
fn what_is_exported_imports_again_with_the_layout_and_its_slides_on_it() {
    let (deck, _, _) = poster();
    let file =
        export(&deck, &Files::default(), &Options::default()).unwrap_or_else(|e| panic!("{e}"));
    let imported = import(&file.bytes, &ImportOptions::default()).unwrap_or_else(|e| panic!("{e}"));
    let back = &imported.deck;
    assert_eq!(back.slides.len(), deck.slides.len());
    let poster = back
        .theme
        .layouts
        .iter()
        .find(|l| l.label == "Poster")
        .unwrap_or_else(|| {
            panic!(
                "the layout came back: {:?}",
                back.theme
                    .layouts
                    .iter()
                    .map(|l| &l.label)
                    .collect::<Vec<_>>()
            )
        });
    let roles: Vec<&str> = poster
        .placeholders
        .iter()
        .map(|p| p.role.as_str())
        .collect();
    assert_eq!(roles.len(), 2, "{roles:?}");
    assert!(back.slides.iter().skip(1).all(|s| s.layout == poster.name));
}
