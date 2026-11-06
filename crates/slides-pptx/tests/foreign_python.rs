//! A deck made with python-pptx, in `fixtures/decks/pptx`, that holds what a deck cannot: a chart,
//! a diagram, a freeform. Everything imports and nothing is dropped: those three become `raw`,
//! said so in the report, and are written back whole.

mod common;

use slides_core::Element;
use slides_pptx::import::{ImportOptions, import};
use slides_pptx::{Options, export};

use common::foreign::{all, count, fixture, title, words};
use common::{Files, inspect};

#[test]
fn a_python_pptx_deck_imports_with_nothing_dropped() {
    let imported = fixture("python-pptx.pptx");
    let deck = &imported.deck;
    assert_eq!(deck.title, "Import test deck");
    // The default template is four by three.
    assert_eq!((deck.size.w, deck.size.h), (960.0, 720.0));
    assert_eq!(deck.slides.len(), 9);
    assert_eq!(imported.report.slides, 9);
    assert_eq!(imported.report.hidden, 1);
    assert_eq!(imported.report.pictures, 2);
    assert_eq!(
        deck.slides
            .iter()
            .filter(|s| s.hidden)
            .map(title)
            .collect::<Vec<_>>(),
        ["A hidden slide"]
    );
    assert_eq!(
        deck.slides[0].notes.trim(),
        "Welcome the room.\n\nThen the first slide."
    );
    assert_eq!(deck.slides[7].notes.trim(), "Only for questions.");
    assert_eq!(
        deck.sections
            .iter()
            .map(|s| s.title.as_str())
            .collect::<Vec<_>>(),
        ["Opening", "Objects", "Extras"]
    );
    let titles: Vec<String> = deck.slides.iter().map(title).collect();
    assert_eq!(titles[2], "A chart");
    assert_eq!(titles[8], "A diagram");
}

#[test]
fn the_chart_the_freeform_and_the_diagram_are_kept_raw_and_said_so() {
    let imported = fixture("python-pptx.pptx");
    let mut raw: Vec<String> = imported
        .report
        .raw
        .iter()
        .map(|r| r.original.clone())
        .collect();
    raw.sort();
    assert_eq!(raw, ["pptx:chart", "pptx:custom-shape", "pptx:smartart"]);
    assert_eq!(count(&imported.deck, "raw"), 3);
    for note in &imported.report.raw {
        let slide = imported
            .deck
            .slide(&note.slide)
            .unwrap_or_else(|| panic!("slide {}", note.slide));
        let found = all(slide).into_iter().find(|e| e.id() == note.element);
        let Some(Element::Raw(r)) = found else {
            panic!("{} is not a raw element", note.element)
        };
        assert!(
            r.xml.is_some()
                && r.base
                    .alt
                    .as_deref()
                    .is_some_and(|a| a.contains("kept as it was")),
            "{r:?}"
        );
        assert!(r.base.w.is_some_and(|w| w > 0.0), "it keeps its place");
    }
    let said: Vec<&str> = imported
        .report
        .warnings
        .iter()
        .map(|w| w.message.as_str())
        .collect();
    for wanted in [
        "chart was kept as it was",
        "freeform shape was kept as it was",
        "SmartArt diagram was kept as it was",
    ] {
        assert!(
            said.iter().any(|m| m.contains(wanted)),
            "no warning about {wanted:?} in {said:#?}"
        );
    }
    // Every warning names its slide, and no warning is a lie about something that was dropped.
    assert!(imported.report.warnings.iter().all(|w| w.slide.is_some()));
    assert!(!said.iter().any(|m| m.contains("left out")), "{said:#?}");
}

#[test]
fn merged_cells_groups_connectors_and_pictures_come_over_as_objects_of_the_deck() {
    let imported = fixture("python-pptx.pptx");
    let deck = &imported.deck;
    // A table with a cell across two columns and one down two rows, and a header row.
    let Some(Element::Table(table)) = all(&deck.slides[3])
        .into_iter()
        .find(|e| e.kind() == "table")
    else {
        panic!("no table")
    };
    assert_eq!((table.columns.len(), table.rows.len()), (4, 4));
    assert!(table.header_row);
    assert_eq!(table.rows[0].cells[0].col_span, Some(2));
    assert_eq!(table.rows[1].cells[0].row_span, Some(2));
    assert!(
        table.rows[3]
            .cells
            .iter()
            .any(|c| c.fill.as_ref().is_some_and(|f| f.color == "#fbbc04"))
    );

    // The style the table names (PowerPoint's default) paints its header in the accent, in bold white, and bands the body.
    let head = &table.rows[0].cells[0];
    assert_eq!(
        head.fill.as_ref().map(|f| f.color.as_str()),
        Some("accent1")
    );
    let run = &head.text.paragraphs[0].runs[0];
    assert!(run.bold && run.color.as_deref() == Some("bg1"), "{run:?}");
    let band = |row: usize| {
        table.rows[row]
            .cells
            .last()
            .and_then(|c| c.fill.as_ref())
            .map(|f| f.color.clone())
    };
    assert!(
        band(1).is_some() && band(2).is_some() && band(1) != band(2),
        "{:?} {:?}",
        band(1),
        band(2)
    );
    assert!(
        table.rows[1].cells[1].text.paragraphs[0]
            .runs
            .iter()
            .all(|r| !r.bold),
        "the body is in the ordinary type"
    );

    // A group inside a group, with the boxes in slide coordinates.
    let slide = &deck.slides[4];
    let Some(Element::Group(outer)) = slide.elements.iter().find(|e| e.kind() == "group") else {
        panic!("no group")
    };
    let Some(Element::Group(inner)) = outer.children.iter().find(|e| e.kind() == "group") else {
        panic!("no inner group")
    };
    assert_eq!((outer.children.len(), inner.children.len()), (2, 2));
    assert_eq!(
        inner.children[0].base().rect().map(|r| (r.0, r.2)),
        Some((345.6, 134.4))
    );

    // The connector joins the shapes called From and To, on the sides it left and reached.
    let by_words = |w: &str| {
        all(slide)
            .into_iter()
            .find(|e| words(e) == w)
            .map(|e| e.id().to_owned())
    };
    let Some(Element::Connector(c)) = all(slide).into_iter().find(|e| e.kind() == "connector")
    else {
        panic!("no connector")
    };
    assert_eq!(
        c.from
            .as_ref()
            .map(|a| (Some(a.el.clone()), format!("{:?}", a.side))),
        Some((by_words("From"), "Right".to_owned()))
    );
    assert_eq!(
        c.to.as_ref()
            .map(|a| (Some(a.el.clone()), format!("{:?}", a.side))),
        Some((by_words("To"), "Left".to_owned()))
    );
    assert_eq!(count(deck, "line"), 1);

    // The cropped picture keeps its crop and alt text; the other one its rounded cut.
    let images: Vec<&slides_core::ImageEl> = all(&deck.slides[5])
        .into_iter()
        .filter_map(|e| match e {
            Element::Image(i) => Some(i),
            _ => None,
        })
        .collect();
    assert_eq!(images.len(), 2);
    let crop = images[0]
        .crop
        .as_ref()
        .map(|c| (c.left, c.top, c.right, c.bottom));
    assert_eq!(crop, Some((0.15, 0.1, 0.15, 0.2)));
    assert_eq!(images[0].base.alt.as_deref(), Some("A cropped picture"));
    assert_eq!(images[1].mask, Some(slides_core::Mask::RoundRect));
    let names: Vec<&str> = imported.media.iter().map(|m| m.path.as_str()).collect();
    assert!(
        images.iter().all(|i| names.contains(&i.src.as_str())),
        "{names:?}"
    );
    assert!(
        imported
            .media
            .iter()
            .all(|m| m.bytes.starts_with(b"\x89PNG"))
    );

    // Text in the look it had: a link, a numbered list, a turned shape.
    let body = all(&deck.slides[1]);
    assert!(body.iter().any(|e| matches!(e, Element::Text(t) if t.text.paragraphs.iter().flat_map(|p| &p.runs).any(|r| r.link.as_deref() == Some("https://example.com/docs")))));
    assert!(body.iter().any(|e| matches!(e, Element::Text(t) if t.text.paragraphs.iter().any(|p| p.list == Some(slides_core::ListKind::Number)))));
    let turned = all(&deck.slides[6])
        .into_iter()
        .find(|e| words(e) == "Turned 20")
        .map(|e| e.base().rotation);
    assert_eq!(turned, Some(Some(20.0)));
}

#[test]
fn what_was_kept_raw_is_written_back_whole() {
    let imported = fixture("python-pptx.pptx");
    let exported = export(
        &imported.deck,
        &Files(
            imported
                .media
                .iter()
                .map(|m| (m.path.clone(), m.bytes.clone()))
                .collect(),
        ),
        &Options::default(),
    )
    .unwrap_or_else(|e| panic!("{e}"));
    let package = inspect::open(&exported.bytes);
    // The strict reader finds every part parsed, every relationship followed, every type listed.
    assert!(
        inspect::problems(&package).is_empty(),
        "{:?}",
        inspect::problems(&package)
    );
    let names: Vec<&str> = package.parts.keys().map(String::as_str).collect();
    for part in [
        "ppt/charts/chart1.xml",
        "ppt/diagrams/data1.xml",
        "ppt/diagrams/layout1.xml",
        "ppt/diagrams/quickStyle1.xml",
        "ppt/diagrams/colors1.xml",
        "ppt/diagrams/drawing1.xml",
    ] {
        assert!(names.contains(&part), "{part} is missing from {names:#?}");
    }
    assert!(
        names
            .iter()
            .any(|n| n.starts_with("ppt/embeddings/") && n.ends_with(".xlsx")),
        "{names:#?}"
    );
    assert!(
        exported
            .warnings
            .iter()
            .all(|w| !w.message.contains("no picture to show")),
        "{:?}",
        exported.warnings
    );
    // The freeform's own geometry is in its slide, and the diagram's data still names its drawing.
    let slides: String = package
        .parts
        .iter()
        .filter(|(n, _)| n.starts_with("ppt/slides/slide"))
        .map(|(_, b)| String::from_utf8_lossy(b).into_owned())
        .collect();
    assert!(
        slides.contains("<a:custGeom>")
            && slides.contains("<c:chart")
            && slides.contains("dgm:relIds"),
        "raw objects are in the slides"
    );
    let data = String::from_utf8_lossy(&package.parts["ppt/diagrams/data1.xml"]).into_owned();
    assert!(data.contains("dataModelExt"));

    // And it imports again as the same three kept things.
    let again =
        import(&exported.bytes, &ImportOptions::default()).unwrap_or_else(|e| panic!("{e}"));
    let mut raw: Vec<String> = again
        .report
        .raw
        .iter()
        .map(|r| r.original.clone())
        .collect();
    raw.sort();
    assert_eq!(raw, ["pptx:chart", "pptx:custom-shape", "pptx:smartart"]);
    assert_eq!(again.deck.slides.len(), imported.deck.slides.len());
}
