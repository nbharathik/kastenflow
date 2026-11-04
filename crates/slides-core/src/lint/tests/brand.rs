//! The off-brand colour check: it needs a brand, finds what uses a colour outside it and the theme,
//! and leaves theme names, neutrals and the theme's own colours alone.

use serde_json::json;

use super::{bench, shape, styled};
use crate::lint::{Brand, OFF_BRAND, Severity, off_brand};

#[test]
fn the_rule_is_a_warning_with_a_name_and_a_sentence() {
    assert_eq!(OFF_BRAND.name, "off-brand-colour");
    assert_eq!(OFF_BRAND.severity, Severity::Warning);
    assert!(OFF_BRAND.summary.len() > 15);
}

#[test]
fn a_colour_is_read_in_any_of_its_spellings_and_a_name_is_not_a_colour() {
    use crate::lint::brand::normalise;
    assert_eq!(normalise("#0B5CAD").as_deref(), Some("#0b5cad"));
    assert_eq!(normalise("#abc").as_deref(), Some("#aabbcc"));
    assert_eq!(normalise(" #12345680 ").as_deref(), Some("#123456"));
    assert_eq!(normalise("accent1"), None);
    assert_eq!(normalise("#12345"), None);
    assert_eq!(normalise("#12345g"), None);
}

#[test]
fn it_finds_the_elements_that_use_another_colour_and_says_which() {
    let mut b = bench();
    b.add(json!([
        shape("red", "rect", 64.0, 100.0, 100.0, 60.0, "#FF0000"),
        shape("blue", "rect", 200.0, 100.0, 100.0, 60.0, "#0b5cad"),
        shape("named", "rect", 340.0, 100.0, 100.0, 60.0, "accent2"),
        styled(
            "words",
            64.0,
            300.0,
            300.0,
            40.0,
            "Hello there",
            json!({ "color": "#00FF00" })
        ),
    ]));
    let brand = Brand::new(["#0B5CAD", "#222222"]);
    let issues = off_brand(b.deck(), &brand);
    let got: Vec<(&str, Option<&str>, Severity)> = issues
        .iter()
        .map(|i| (i.rule.as_str(), i.element.as_deref(), i.severity))
        .collect();
    assert_eq!(
        got,
        [
            ("off-brand-colour", Some("red"), Severity::Warning),
            ("off-brand-colour", Some("words"), Severity::Warning)
        ]
    );
    assert_eq!(issues[0].slide, b.slide);
    assert!(
        issues[0].message.contains("#ff0000"),
        "{}",
        issues[0].message
    );
    assert!(
        issues[0]
            .hint
            .as_deref()
            .is_some_and(|h| h.contains("#0b5cad")),
        "{:?}",
        issues[0].hint
    );
}

#[test]
fn black_white_and_the_themes_own_colours_are_never_off_brand() {
    let mut b = bench();
    let accent = b.deck().theme.colors.accent3.clone();
    b.add(json!([
        shape("black", "rect", 64.0, 100.0, 100.0, 60.0, "#000000"),
        shape("white", "rect", 200.0, 100.0, 100.0, 60.0, "#FFFFFF"),
        shape("theme", "rect", 340.0, 100.0, 100.0, 60.0, &accent),
    ]));
    assert_eq!(off_brand(b.deck(), &Brand::new(["#0b5cad"])), vec![]);
}

#[test]
fn a_colour_inside_a_group_is_the_groups_and_a_colour_used_twice_is_said_once() {
    let mut b = bench();
    b.add(json!([{
        "type": "group", "id": "g", "x": 64.0, "y": 100.0, "w": 300.0, "h": 100.0,
        "children": [
            shape("a", "rect", 64.0, 100.0, 100.0, 60.0, "#ff0000"),
            shape("b", "rect", 200.0, 100.0, 100.0, 60.0, "#FF0000"),
        ]
    }]));
    let issues = off_brand(b.deck(), &Brand::new(["#0b5cad"]));
    assert_eq!(issues.len(), 1, "{issues:?}");
    assert_eq!(issues[0].element.as_deref(), Some("g"));
}

#[test]
fn a_deck_with_no_brand_colours_is_not_checked_and_the_ordinary_lint_does_not_ask() {
    let mut b = bench();
    b.add(json!([shape(
        "red", "rect", 64.0, 100.0, 100.0, 60.0, "#ff0000"
    )]));
    assert_eq!(
        off_brand(b.deck(), &Brand::new(Vec::<String>::new())),
        vec![]
    );
    assert!(Brand::new(["accent1", "nonsense"]).is_empty());
    // The deck's own report never carries this rule: only a host with a brand kit asks.
    assert!(b.report().issues.iter().all(|i| i.rule != OFF_BRAND.name));
}
