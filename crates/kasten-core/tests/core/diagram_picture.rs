//! The picture of a diagram the app draws as a PNG: the editor's own picture
//! when it drew one for this very source, else the program's draft, always
//! cleaned (nothing that runs or fetches), with the background the diagram
//! says it has.

use crate::common;

use common::{NOW, dev_vault};
use kasten_core::diagrams::{Background, background_of};
use kasten_core::history::Actor;
use kasten_core::{Kasten, content_hash};

const XML: &str = "<mxfile host=\"test\"><diagram id=\"p1\" name=\"Page-1\"><mxGraphModel><root><mxCell id=\"0\"/><mxCell id=\"1\" parent=\"0\"/><mxCell id=\"2\" value=\"Hello\" style=\"rounded=0;whiteSpace=wrap;html=1;\" vertex=\"1\" parent=\"1\"><mxGeometry x=\"40\" y=\"40\" width=\"120\" height=\"60\" as=\"geometry\"/></mxCell></root></mxGraphModel></diagram></mxfile>";

const EDITOR_SVG: &str = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"121px\" height=\"61px\" viewBox=\"-0.5 -0.5 121 61\"><defs/><g><rect x=\"0\" y=\"0\" width=\"120\" height=\"60\" fill=\"#ffffff\"/><text x=\"60\" y=\"30\">Hello</text></g></svg>";

/// A picture someone planted beside the source, with a script in it.
const HOSTILE_SVG: &str = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"121px\" height=\"61px\" viewBox=\"-0.5 -0.5 121 61\" onload=\"alert(2)\"><defs/><g><rect x=\"0\" y=\"0\" width=\"120\" height=\"60\" fill=\"#ffffff\"/><text x=\"60\" y=\"30\">Hello</text></g><script>alert(1)</script></svg>";

fn open() -> (common::TempVault, Kasten, String) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    let path = k
        .create_diagram(&Actor::Human, "Flow", None, Some(XML), NOW)
        .unwrap();
    (t, k, path)
}

#[test]
fn a_diagram_with_no_picture_is_drawn_by_the_program_as_a_draft() {
    let (_t, k, path) = open();
    let picture = k.diagram_picture(&path, None, true).unwrap();
    assert_eq!(picture.from, "draft");
    assert!(picture.svg.contains("<svg") && picture.svg.contains("Hello"));
    assert!(!picture.svg.contains("foreignObject"));
}

#[test]
fn the_editors_picture_is_used_when_it_was_drawn_for_this_very_source_and_it_is_cleaned() {
    let (t, k, path) = open();
    let hash = content_hash(XML);
    k.save_diagram_preview(&Actor::Human, &path, EDITOR_SVG, &hash, NOW)
        .unwrap();
    let picture = k.diagram_picture(&path, None, true).unwrap();
    assert_eq!(picture.from, "editor");
    assert!(picture.svg.contains("Hello"));
    // A picture put there by hand with a script in it is cleaned before it is handed on:
    // what runs never reaches the window that draws it.
    let sidecar = t
        .vault
        .root()
        .join(kasten_core::diagrams::sidecar_of(&path));
    std::fs::write(&sidecar, kasten_core::diagrams::stamped(HOSTILE_SVG, &hash)).unwrap();
    let picture = k.diagram_picture(&path, None, true).unwrap();
    assert_eq!(picture.from, "editor");
    assert!(picture.svg.contains("Hello"));
    assert!(!picture.svg.contains("<script") && !picture.svg.contains("alert"));
    // The draft can be asked for on purpose (the window could not draw the other).
    assert_eq!(k.diagram_picture(&path, None, false).unwrap().from, "draft");
}

#[test]
fn a_page_is_drawn_by_the_program_and_an_unknown_page_is_said_in_a_sentence() {
    let (_t, k, path) = open();
    let hash = content_hash(XML);
    k.save_diagram_preview(&Actor::Human, &path, EDITOR_SVG, &hash, NOW)
        .unwrap();
    assert_eq!(
        k.diagram_picture(&path, Some("Page-1"), true).unwrap().from,
        "draft"
    );
    let why = k
        .diagram_picture(&path, Some("Nope"), true)
        .unwrap_err()
        .to_string();
    assert!(why.contains("Nope"), "{why}");
}

#[test]
fn no_such_diagram_and_a_path_that_is_not_one_are_refused() {
    let (_t, k, _path) = open();
    assert!(
        k.diagram_picture("library/none.drawio", None, true)
            .is_err()
    );
    assert!(k.diagram_picture("../x.drawio", None, true).is_err());
    assert!(k.diagram_picture("library/x.md", None, true).is_err());
}

#[test]
fn the_background_is_what_the_diagram_says_and_white_when_it_says_nothing() {
    let with = |attr: &str| {
        format!("<mxfile><diagram><mxGraphModel {attr}><root/></mxGraphModel></diagram></mxfile>")
    };
    assert_eq!(background_of(XML), Background::White);
    assert_eq!(
        background_of(&with("background=\"none\"")),
        Background::Transparent
    );
    assert_eq!(
        background_of(&with("dx=\"1\" background=\"#FFEECC\"")),
        Background::Color("#ffeecc".to_owned())
    );
    assert_eq!(
        background_of(&with("background=\"#fec\"")),
        Background::Color("#ffeecc".to_owned())
    );
    // Anything else (a name, a style that runs, a bad colour) is white.
    for odd in [
        "background=\"red\"",
        "background=\"url(javascript:1)\"",
        "background=\"#12345\"",
        "background=\"#gggggg\"",
        "background=\"\"",
    ] {
        assert_eq!(background_of(&with(odd)), Background::White, "{odd}");
    }
    // A compressed page hides its model: white.
    assert_eq!(
        background_of(
            "<mxfile><diagram>7VzbctowEP0aHpvxBZvyCC3tZHrJtGTapi8dYS/YxbY8soTD39cQMBkwI8zQYSvYS8MkWskKO9JEZ</diagram></mxfile>"
        ),
        Background::White
    );
    assert_eq!(Background::Color("#ffeecc".to_owned()).css(), "#ffeecc");
    assert_eq!(Background::White.css(), "#ffffff");
    assert_eq!(Background::Transparent.css(), "transparent");
}
