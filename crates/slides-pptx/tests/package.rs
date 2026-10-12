//! Whole decks, exported and read back the way a strict consumer reads them:
//! every part present, every relationship and content type resolving, every
//! part well-formed, every number unique, and the same bytes on a second run.

mod common;

use std::collections::BTreeSet;
use std::sync::OnceLock;

use slides_core::Deck;
use slides_pptx::{Exported, Options, export};

use common::inspect::{self, Package, package_with};
use common::{Files, decks, lists, variety};

type Sample = (String, Deck, Files);

/// Decks in every theme and of every kind, built once for all the tests.
fn everything() -> &'static [Sample] {
    static ALL: OnceLock<Vec<Sample>> = OnceLock::new();
    ALL.get_or_init(|| {
        let mut all: Vec<Sample> = Vec::new();
        let mut add = |name: String, (deck, files): (Deck, Files)| all.push((name, deck, files));
        add("demo".into(), decks::demo());
        for theme in ["Light", "Dark", "Serif", "Lecture"] {
            add(
                format!("every element in {theme}"),
                decks::every_element(theme),
            );
        }
        for (name, deck, files) in variety::every_theme() {
            add(format!("theme {name}"), (deck, files));
        }
        add("text heavy".into(), variety::text_heavy());
        add("list looks".into(), lists::list_looks());
        add("turned".into(), variety::turned());
        add("four by three".into(), variety::four_three());
        add("sectioned".into(), variety::sectioned());
        add("large".into(), variety::large(6, 3));
        all
    })
}

fn exported(deck: &Deck, files: &Files) -> Exported {
    export(deck, files, &Options::default()).unwrap_or_else(|e| panic!("{}: {e}", deck.title))
}

#[test]
fn every_deck_makes_a_package_that_holds_together() {
    for (name, deck, files) in everything() {
        let package = inspect::open(&exported(deck, files).bytes);
        let problems = inspect::problems(&package);
        assert!(problems.is_empty(), "{name}: {problems:#?}");
    }
}

#[test]
fn every_id_a_part_uses_is_a_relationship_of_that_part() {
    for (name, deck, files) in everything() {
        let package = inspect::open(&exported(deck, files).bytes);
        for part in package
            .parts
            .keys()
            .filter(|n| inspect::is_xml(n) && !n.ends_with(".rels"))
        {
            let rels_name = match part.rsplit_once('/') {
                Some((dir, file)) => format!("{dir}/_rels/{file}.rels"),
                None => format!("_rels/{part}.rels"),
            };
            let have: BTreeSet<String> = if package.parts.contains_key(&rels_name) {
                inspect::relationships(&package, &rels_name)
                    .into_iter()
                    .map(|r| r.id)
                    .collect()
            } else {
                BTreeSet::new()
            };
            for id in inspect::used_ids(&package, part) {
                assert!(
                    have.contains(&id),
                    "{name}: {part} uses {id}, which {rels_name} does not define"
                );
            }
        }
    }
}

#[test]
fn shape_numbers_are_unique_on_each_slide_and_slide_numbers_in_the_presentation() {
    for (name, deck, files) in everything() {
        let package = inspect::open(&exported(deck, files).bytes);
        let trees = package.parts.keys().filter(|n| {
            !n.contains("_rels")
                && [
                    "ppt/slides/",
                    "ppt/slideMasters/",
                    "ppt/slideLayouts/",
                    "ppt/notes",
                ]
                .iter()
                .any(|p| n.starts_with(p))
        });
        for part in trees {
            let ids = inspect::shape_ids(&package, part);
            let unique: BTreeSet<_> = ids.iter().collect();
            assert_eq!(
                unique.len(),
                ids.len(),
                "{name}: {part} numbers a shape twice: {ids:?}"
            );
            assert!(ids.iter().all(|id| *id >= 1), "{name}: {part}: {ids:?}");
        }
        let presentation =
            inspect::elements("presentation", &package.parts["ppt/presentation.xml"]);
        let slide_ids: Vec<&String> = presentation
            .iter()
            .filter(|(n, _)| n == "p:sldId")
            .map(|(_, a)| &a["id"])
            .collect();
        let unique: BTreeSet<_> = slide_ids.iter().collect();
        assert_eq!(slide_ids.len(), deck.slides.len(), "{name}");
        assert_eq!(unique.len(), slide_ids.len(), "{name}: {slide_ids:?}");
        assert!(
            slide_ids.iter().all(|id| id
                .parse::<u32>()
                .is_ok_and(|n| (256..2_147_483_648).contains(&n))),
            "{name}: {slide_ids:?}"
        );
    }
}

#[test]
fn a_deck_has_the_parts_a_presentation_needs() {
    let (deck, files) = decks::demo();
    let package = package_with(&deck, &files, &Options::default());
    for part in [
        "[Content_Types].xml",
        "_rels/.rels",
        "docProps/core.xml",
        "docProps/app.xml",
        "ppt/presentation.xml",
        "ppt/_rels/presentation.xml.rels",
        "ppt/presProps.xml",
        "ppt/viewProps.xml",
        "ppt/tableStyles.xml",
        "ppt/theme/theme1.xml",
        "ppt/theme/theme2.xml",
        "ppt/slideMasters/slideMaster1.xml",
        "ppt/slideMasters/_rels/slideMaster1.xml.rels",
        "ppt/notesMasters/notesMaster1.xml",
    ] {
        assert!(package.parts.contains_key(part), "{part} is missing");
    }
    let count = |prefix: &str| {
        package
            .parts
            .keys()
            .filter(|n| n.starts_with(prefix) && !n.contains("_rels"))
            .count()
    };
    assert_eq!(count("ppt/slideLayouts/"), deck.theme.layouts.len());
    assert_eq!(count("ppt/slides/"), deck.slides.len());
    assert_eq!(
        count("ppt/notesSlides/"),
        deck.slides.len(),
        "every slide has a marker line in its notes, so every slide has notes"
    );
    let bare = package_with(
        &deck,
        &files,
        &Options {
            markers: false,
            ..Options::default()
        },
    );
    assert_eq!(
        bare.parts
            .keys()
            .filter(|n| n.starts_with("ppt/notesSlides/") && !n.contains("_rels"))
            .count(),
        deck.slides.iter().filter(|s| !s.notes.is_empty()).count(),
        "without markers, notes only where the deck has them"
    );
    assert_eq!(
        count("ppt/media/"),
        1,
        "the one picture of the demo is stored once"
    );
}

#[test]
fn the_slide_size_is_the_decks_in_emu() {
    let size = |package: &Package| {
        let e = inspect::elements("presentation", &package.parts["ppt/presentation.xml"]);
        let s = e
            .iter()
            .find(|(n, _)| n == "p:sldSz")
            .map(|(_, a)| a.clone())
            .unwrap_or_default();
        (s["cx"].clone(), s["cy"].clone())
    };
    let (deck, files) = decks::demo();
    assert_eq!(
        size(&package_with(&deck, &files, &Options::default())),
        ("9144000".to_owned(), "5143500".to_owned())
    );
    let (small, files) = variety::four_three();
    assert_eq!(
        size(&package_with(&small, &files, &Options::default())),
        ("6858000".to_owned(), "5143500".to_owned())
    );
}

#[test]
fn the_same_deck_and_pictures_make_the_same_bytes() {
    for (name, deck, files) in everything() {
        let first = exported(deck, files);
        let second = exported(&deck.clone(), &files.clone());
        assert!(first.bytes == second.bytes, "{name}: two exports differ");
        assert_eq!(first.warnings, second.warnings, "{name}");
    }
}

#[test]
fn the_theme_part_carries_the_decks_colours_and_fonts_for_every_theme() {
    for (name, deck, files) in everything()
        .iter()
        .filter(|(n, ..)| n.starts_with("theme "))
    {
        let package = inspect::open(&exported(deck, files).bytes);
        let theme = String::from_utf8_lossy(&package.parts["ppt/theme/theme1.xml"]).into_owned();
        let c = &deck.theme.colors;
        let slots = [
            ("dk1", &c.text1),
            ("lt1", &c.bg1),
            ("dk2", &c.text2),
            ("lt2", &c.bg2),
            ("accent1", &c.accent1),
            ("accent6", &c.accent6),
        ];
        for (slot, value) in slots {
            let want = format!(
                "<a:{slot}><a:srgbClr val=\"{}\"/></a:{slot}>",
                value.trim_start_matches('#').to_uppercase()
            );
            assert!(theme.contains(&want), "{name}: {want} not in the theme");
        }
        assert!(
            theme.contains(&format!(
                "<a:majorFont><a:latin typeface=\"{}\"",
                deck.theme.fonts.heading.family
            )),
            "{name}"
        );
        assert!(
            theme.contains(&format!(
                "<a:minorFont><a:latin typeface=\"{}\"",
                deck.theme.fonts.body.family
            )),
            "{name}"
        );
    }
}

#[test]
fn a_slide_size_powerpoint_cannot_hold_is_refused() {
    let (mut deck, files) = decks::demo();
    deck.size = slides_core::Size {
        w: 10.0,
        h: 10.0,
        extra: slides_core::Extra::new(),
    };
    let error = export(&deck, &files, &Options::default())
        .err()
        .map(|e| e.to_string())
        .unwrap_or_default();
    assert!(
        error.contains("PowerPoint") && error.contains("96"),
        "{error}"
    );
}

#[test]
fn a_deck_with_no_layouts_still_makes_a_valid_package() {
    let (mut deck, files) = decks::demo();
    deck.theme.layouts.clear();
    let out = exported(&deck, &files);
    let package = inspect::open(&out.bytes);
    assert!(
        inspect::problems(&package).is_empty(),
        "{:?}",
        inspect::problems(&package)
    );
    let layouts = package
        .parts
        .keys()
        .filter(|n| n.starts_with("ppt/slideLayouts/slideLayout"))
        .count();
    assert_eq!(layouts, 1);
    assert!(
        out.warnings
            .iter()
            .any(|w| w.message.contains("not in the theme")),
        "{:?}",
        out.warnings
    );
}

#[test]
fn the_checks_notice_a_number_the_schemas_forbid() {
    let (deck, files) = decks::demo();
    let mut package = package_with(&deck, &files, &Options::default());
    assert!(inspect::problems(&package).is_empty());
    let slide = package
        .parts
        .get_mut("ppt/slides/slide2.xml")
        .unwrap_or_else(|| panic!("slide 2"));
    let changed = String::from_utf8_lossy(slide).replace(r#"sz="2200""#, r#"sz="9""#);
    *slide = changed.into_bytes();
    let problems = inspect::problems(&package);
    assert!(
        problems
            .iter()
            .any(|p| p.contains(r#"sz="9""#) && p.contains("outside")),
        "{problems:?}"
    );
}
