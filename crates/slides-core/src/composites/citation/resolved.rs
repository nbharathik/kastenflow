//! A citation written from a bibliography and from the numbering of its deck.

use super::*;
use crate::citations::{Cites, Numbering, Refs};
use crate::composites::{expand_deck, expand_deck_with, expand_with};
use crate::model::{Base, Extra};
use crate::ops::Engine;
use serde_json::json;

const BIB: &str = r#"
@inproceedings{vaswani2017attention, title={Attention is all you need}, author={Vaswani, Ashish and Shazeer, Noam and Parmar, Niki}, booktitle={Advances in Neural Information Processing Systems}, year={2017}}
@article{lecun2015deep, title={Deep learning}, author={LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey}, journal={Nature}, year={2015}}
"#;

fn cite(keys: &[&str], format: Option<CitationStyle>, h: f64) -> Element {
    Element::Citation(CitationEl {
        base: Base::new("e-cite").place(64.0, 400.0, 700.0, h),
        keys: keys.iter().map(|k| (*k).to_owned()).collect(),
        format,
        links: false,
        extra: Extra::new(),
    })
}

fn words(element: &Element, cites: &Cites) -> Vec<String> {
    let theme = crate::themes::light();
    let parts = expand_with(&theme, "blank", element, cites).expect("a citation expands");
    parts[0]
        .text()
        .expect("text")
        .paragraphs
        .iter()
        .map(|p| p.text())
        .collect()
}

#[test]
fn with_a_bibliography_a_short_citation_names_who_and_when() {
    let refs = Refs::from_bibtex(BIB);
    let cites = Cites {
        refs: Some(&refs),
        numbering: None,
    };
    let e = cite(&["vaswani2017attention", "lecun2015deep"], None, 30.0);
    assert_eq!(
        words(&e, &cites),
        ["Vaswani et al., 2017 (NeurIPS); LeCun et al., 2015 (Nature)"]
    );
}

#[test]
fn a_key_the_bibliography_does_not_have_is_shown_marked_and_nothing_fails() {
    let refs = Refs::from_bibtex(BIB);
    let cites = Cites {
        refs: Some(&refs),
        numbering: None,
    };
    let e = cite(&["vaswani2017attention", "vaswani2017"], None, 30.0);
    assert_eq!(
        words(&e, &cites),
        ["Vaswani et al., 2017 (NeurIPS); vaswani2017?"]
    );
    let empty = Refs::default();
    let cites = Cites {
        refs: Some(&empty),
        numbering: None,
    };
    assert_eq!(words(&e, &cites), ["vaswani2017attention?; vaswani2017?"]);
}

#[test]
fn a_full_citation_is_a_whole_reference_for_each_key() {
    let refs = Refs::from_bibtex(BIB);
    let cites = Cites {
        refs: Some(&refs),
        numbering: None,
    };
    let e = cite(&["lecun2015deep"], Some(CitationStyle::Full), 60.0);
    assert_eq!(
        words(&e, &cites),
        ["Y. LeCun, Y. Bengio, and G. Hinton. Deep learning. Nature, 2015."]
    );
}

#[test]
fn a_list_and_numbers_follow_the_numbering_the_deck_gives() {
    let refs = Refs::from_bibtex(BIB);
    let numbering = Numbering::new(["lecun2015deep", "vaswani2017attention"]);
    let cites = Cites {
        refs: Some(&refs),
        numbering: Some(&numbering),
    };
    let numbered = cite(
        &["vaswani2017attention"],
        Some(CitationStyle::Numbered),
        30.0,
    );
    assert_eq!(words(&numbered, &cites), ["[2]"]);
    let list = cite(&[], Some(CitationStyle::List), 120.0);
    let lines = words(&list, &cites);
    assert_eq!(lines.len(), 2);
    assert!(lines[0].starts_with("[1] Y. LeCun"), "{}", lines[0]);
    assert!(
        lines[1].starts_with("[2] A. Vaswani, N. Shazeer, and N. Parmar."),
        "{}",
        lines[1]
    );
}

#[test]
fn a_long_label_shrinks_the_type_and_never_below_eight_points() {
    let refs = Refs::from_bibtex(BIB);
    let cites = Cites {
        refs: Some(&refs),
        numbering: None,
    };
    let many = ["vaswani2017attention", "lecun2015deep"].repeat(6);
    let e = cite(&many, Some(CitationStyle::Full), 40.0);
    let theme = crate::themes::light();
    let parts = expand_with(&theme, "blank", &e, &cites).expect("expands");
    let size = parts[0].text().expect("text").paragraphs[0].runs[0].size;
    assert_eq!(size, Some(8.0), "as small as it goes");
}

fn deck() -> crate::model::Deck {
    let mut e = Engine::create("Deck", "Light", 1).unwrap();
    for (n, keys) in [(1, json!(["b"])), (2, json!(["a", "b"]))] {
        let s = e
            .apply("add_slide", json!({ "layout": "blank" }))
            .unwrap()
            .output["slide"]
            .as_str()
            .unwrap()
            .to_owned();
        e.apply(
            "add_elements",
            json!({ "slide": s, "elements": [{ "type": "citation", "id": format!("c{n}"), "x": 64, "y": 480, "w": 700, "h": 30, "format": "numbered", "keys": keys }] }),
        )
        .unwrap();
    }
    let last = e.deck().slides.last().unwrap().id.clone();
    e.apply(
        "add_elements",
        json!({ "slide": last, "elements": [{ "type": "citation", "id": "refs", "x": 64, "y": 100, "w": 800, "h": 200, "format": "list", "keys": [] }] }),
    )
    .unwrap();
    e.deck().clone()
}

fn texts(deck: &crate::model::Deck, slide: usize, id: &str) -> Vec<String> {
    let Some(Element::Group(g)) = deck.slides[slide].element(id) else {
        panic!("{id} is a group once expanded")
    };
    g.children[0]
        .text()
        .expect("text")
        .paragraphs
        .iter()
        .map(|p| p.text())
        .collect()
}

#[test]
fn a_deck_is_expanded_with_one_numbering_for_all_its_slides() {
    let deck = deck();
    // b is cited first, so it is [1] on both slides, and a is [2].
    for expanded in [expand_deck(&deck), expand_deck_with(&deck, None)] {
        assert_eq!(texts(&expanded, 1, "c1"), ["[1]"]);
        assert_eq!(texts(&expanded, 2, "c2"), ["[2][1]"]);
        assert_eq!(texts(&expanded, 2, "refs"), ["[1] b", "[2] a"]);
    }
}

#[test]
fn a_deck_expanded_with_a_bibliography_writes_the_works() {
    let deck = deck();
    let refs = Refs::from_bibtex(
        "@book{b, title={Book B}, author={Bee, Bo}, year={2001}}\n@book{a, title={Book A}, author={Ay, Al}, year={2002}}",
    );
    let expanded = expand_deck_with(&deck, Some(&refs));
    assert_eq!(texts(&expanded, 2, "c2"), ["[2][1]"]);
    assert_eq!(
        texts(&expanded, 2, "refs"),
        ["[1] B. Bee. Book B. 2001.", "[2] A. Ay. Book A. 2002."]
    );
}

#[test]
fn ungrouping_or_exporting_never_sees_a_different_citation_than_the_editor_draws() {
    let deck = deck();
    let refs = Refs::from_bibtex(BIB);
    let numbering = Numbering::of(&deck);
    let cites = Cites {
        refs: Some(&refs),
        numbering: Some(&numbering),
    };
    let theme = &deck.theme;
    let drawn = crate::composites::expanded_group_with(
        theme,
        &deck.slides[2].layout,
        deck.slides[2].element("c2").unwrap(),
        &cites,
    )
    .unwrap();
    let exported = expand_deck_with(&deck, Some(&refs));
    assert_eq!(&drawn, exported.slides[2].element("c2").unwrap());
}
