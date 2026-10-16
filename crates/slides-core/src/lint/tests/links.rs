//! The rule about links: `broken-link` is an error for a link to a slide that is not in the deck and
//! for an address that cannot be one.

use std::collections::HashSet;

use serde_json::json;

use super::{bench, expect, found, of_rule, styled};
use crate::lint::Severity::Error;
use crate::lint::rules::link_problem;

fn problem(link: &str) -> Option<String> {
    let slides: HashSet<&str> = ["s-here"].into();
    link_problem(link, &slides)
}

#[test]
fn a_link_to_a_slide_that_is_not_there_is_an_error_on_an_element_or_on_words() {
    let mut b = bench();
    let (other, _) = b.add_slide("title-only", json!({ "title": "Other" }));
    let mut shape = super::shape("box", "rect", 64.0, 100.0, 100.0, 60.0, "accent1");
    shape["link"] = json!("slide:s-nope");
    let mut fine = super::shape("fine", "rect", 200.0, 100.0, 100.0, 60.0, "accent2");
    fine["link"] = json!(format!("slide:{other}"));
    b.add(json!([
        shape,
        fine,
        styled(
            "words",
            64.0,
            200.0,
            400.0,
            40.0,
            "see the appendix",
            json!({ "size": 20, "link": "slide:s-gone" })
        ),
        styled(
            "web",
            64.0,
            300.0,
            400.0,
            40.0,
            "docs",
            json!({ "size": 20, "link": "https://example.org/docs" })
        ),
    ]));
    let report = b.report();
    assert_eq!(
        found(&report),
        expect(&[
            ("broken-link", Error, Some("box")),
            ("broken-link", Error, Some("words")),
        ])
    );
    let issues = of_rule(&report, "broken-link");
    assert!(
        issues[0].message.contains("goes to the slide \"s-nope\"")
            && issues[0].message.contains("not in the deck"),
        "{}",
        issues[0].message
    );
    assert!(
        issues[1].message.contains("see the appendix") && issues[1].message.contains("s-gone"),
        "{}",
        issues[1].message
    );
    assert!(
        issues[0]
            .hint
            .as_deref()
            .is_some_and(|h| h.contains("take the link off")),
        "{:?}",
        issues[0].hint
    );
}

#[test]
fn a_link_to_a_slide_that_was_deleted_is_found() {
    let mut b = bench();
    let (gone, _) = b.add_slide("title-only", json!({ "title": "Doomed" }));
    let mut shape = super::shape("pointer", "rect", 64.0, 100.0, 100.0, 60.0, "accent1");
    shape["link"] = json!(format!("slide:{gone}"));
    b.add(json!([shape]));
    assert!(of_rule(&b.report(), "broken-link").is_empty());
    b.engine
        .apply("delete_slides", json!({ "ids": [gone] }))
        .unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(
        found(&b.report()),
        expect(&[("broken-link", Error, Some("pointer"))])
    );
}

#[test]
fn an_address_is_fine_when_it_could_be_opened_and_broken_when_it_could_not() {
    for fine in [
        "https://example.org",
        "http://example.org/a?b=c#d",
        "https://user@example.org:8080/p",
        "example.org/page",
        "mailto:a@b.org",
        "mailto:a@b.org?subject=hi",
        "tel:+441234",
        "slide:s-here",
        "page:library/plan.md#Risks",
        "PAGE:library/plan.md",
        "",
        "   ",
    ] {
        assert_eq!(problem(fine), None, "{fine:?}");
    }
    for (broken, why) in [
        ("https://", "no web address after \"https:\""),
        ("https:///path", "no web address"),
        ("http://", "no web address after \"http:\""),
        ("https://exa mple.org", "has a space"),
        ("https://exam<ple.org", "no web address"),
        ("javascript:alert(1)", "starts with \"javascript:\""),
        ("data:text/html,x", "starts with \"data:\""),
        ("file:///etc/passwd", "starts with \"file:\""),
        ("mailto:nobody", "not a mail address"),
        ("mailto:@b.org", "not a mail address"),
        ("tel:abc", "no number"),
        ("slide:s-gone", "goes to the slide \"s-gone\""),
        ("slide:", "names no slide"),
        ("two words", "has a space"),
    ] {
        let said = problem(broken).unwrap_or_else(|| panic!("{broken:?} is broken"));
        assert!(said.contains(why), "{broken:?}: {said}");
    }
}
