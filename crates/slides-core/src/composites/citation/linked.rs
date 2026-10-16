//! A citation that links its works: one run for each work, the words between them not linked.

use super::*;
use crate::citations::{Cites, Refs};
use crate::composites::expand_with;
use crate::model::{Base, Extra};

const BIB: &str = r#"
@article{a, title={A}, author={Ay, Al}, year={2001}, doi={10.1000/aaa}}
@article{b, title={B}, author={Bee, Bo}, year={2002}, url={https://example.org/b}}
@article{c, title={C}, author={Sea, Cy}, year={2003}}
@misc{d, title={D}, author={Dee, Di}, year={2004}, eprint={2005.14165}, archiveprefix={arXiv}}
@article{e, title={E}, author={Eff, Em}, year={2005}, url={javascript:alert(1)}}
"#;

const DOI: &str = "https://doi.org/10.1000/aaa";
const SITE: &str = "https://example.org/b";
const ARXIV: &str = "https://arxiv.org/abs/2005.14165";

fn cite(keys: &[&str], format: Option<CitationStyle>, links: bool) -> Element {
    Element::Citation(CitationEl {
        base: Base::new("e-cite").place(64.0, 380.0, 700.0, 120.0),
        keys: keys.iter().map(|k| (*k).to_owned()).collect(),
        format,
        links,
        extra: Extra::new(),
    })
}

/// Each line of the citation as its runs: the words, and the address they link to.
fn runs(element: &Element, refs: Option<&Refs>) -> Vec<Vec<(String, Option<String>)>> {
    let theme = crate::themes::light();
    let cites = Cites {
        refs,
        numbering: None,
    };
    let parts = expand_with(&theme, "blank", element, &cites).expect("a citation expands");
    parts[0]
        .text()
        .expect("text")
        .paragraphs
        .iter()
        .map(|p| {
            p.runs
                .iter()
                .map(|r| (r.t.clone(), r.link.clone()))
                .collect()
        })
        .collect()
}

fn words(lines: &[Vec<(String, Option<String>)>]) -> Vec<String> {
    lines
        .iter()
        .map(|line| line.iter().map(|(t, _)| t.as_str()).collect())
        .collect()
}

fn links(line: &[(String, Option<String>)]) -> Vec<Option<&str>> {
    line.iter().map(|(_, l)| l.as_deref()).collect()
}

#[test]
fn with_links_off_a_line_is_one_run_and_nothing_is_a_link() {
    let refs = Refs::from_bibtex(BIB);
    let lines = runs(&cite(&["a", "b"], None, false), Some(&refs));
    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0].len(), 1);
    assert_eq!(lines[0][0].1, None);
}

#[test]
fn each_work_is_a_run_of_its_own_and_the_words_between_are_not_links() {
    let refs = Refs::from_bibtex(BIB);
    let element = cite(&["a", "b", "c", "d", "e"], None, true);
    let lines = runs(&element, Some(&refs));
    assert_eq!(lines.len(), 1);
    // Five works and four separators.
    assert_eq!(lines[0].len(), 9, "{:?}", lines[0]);
    assert_eq!(
        links(&lines[0]),
        [
            Some(DOI),
            None,
            Some(SITE),
            None,
            None,
            None,
            Some(ARXIV),
            None,
            None
        ],
        "a work with no address, and one whose address is no web address, is no link"
    );
    assert!(lines[0].iter().skip(1).step_by(2).all(|(t, _)| t == "; "));
    // The words are the words there were without links.
    let plain = runs(&cite(&["a", "b", "c", "d", "e"], None, false), Some(&refs));
    assert_eq!(words(&lines), words(&plain));
}

#[test]
fn numbers_full_references_and_lists_link_their_works_too() {
    let refs = Refs::from_bibtex(BIB);
    let numbered = runs(
        &cite(&["a", "b", "c"], Some(CitationStyle::Numbered), true),
        Some(&refs),
    );
    assert_eq!(links(&numbered[0]), [Some(DOI), Some(SITE), None]);
    assert_eq!(words(&numbered), ["[1][2][3]"]);

    let full = runs(
        &cite(&["a", "d"], Some(CitationStyle::Full), true),
        Some(&refs),
    );
    assert_eq!(full.len(), 2);
    assert_eq!(links(&full[0]), [Some(DOI)]);
    assert_eq!(links(&full[1]), [Some(ARXIV)]);

    let list = runs(
        &cite(&["a", "b"], Some(CitationStyle::List), true),
        Some(&refs),
    );
    assert_eq!(list.len(), 2);
    assert_eq!(
        links(&list[0]),
        [None, Some(DOI)],
        "the number is not linked"
    );
    assert!(list[0][0].0.starts_with("[1] "));
    assert_eq!(links(&list[1]), [None, Some(SITE)]);
}

#[test]
fn without_a_bibliography_or_for_a_key_it_lacks_nothing_is_linked() {
    let element = cite(&["a", "zzz"], None, true);
    let none = runs(&element, None);
    assert!(none[0].iter().all(|(_, l)| l.is_none()), "{none:?}");
    let refs = Refs::from_bibtex(BIB);
    let lines = runs(&element, Some(&refs));
    assert_eq!(links(&lines[0]), [Some(DOI), None, None]);
    assert_eq!(words(&lines), ["Ay, 2001; zzz?"]);
}

#[test]
fn the_runs_are_set_alike_and_the_whole_line_still_fits_by_the_same_rule() {
    let refs = Refs::from_bibtex(BIB);
    let theme = crate::themes::light();
    let cites = Cites {
        refs: Some(&refs),
        numbering: None,
    };
    for links in [false, true] {
        let element = cite(&["a", "b", "c", "d"], Some(CitationStyle::Full), links);
        let parts = expand_with(&theme, "blank", &element, &cites).expect("expands");
        let text = parts[0].text().expect("text");
        let sizes: Vec<_> = text
            .paragraphs
            .iter()
            .flat_map(|p| p.runs.iter().map(|r| r.size))
            .collect();
        assert!(sizes.windows(2).all(|w| w[0] == w[1]), "{links}: {sizes:?}");
        assert!(
            text.paragraphs
                .iter()
                .all(|p| p.style.as_deref() == Some("citation"))
        );
    }
}
