//! Where an entry can be read on the web: the DOI first, then the address, then the arXiv, and
//! never anything but a web address.

use super::super::Refs;

/// The link of an entry with these fields.
fn link(fields: &str) -> Option<String> {
    let refs = Refs::from_bibtex(&format!("@article{{k, title={{T}}, {fields}}}"));
    refs.get("k")
        .unwrap_or_else(|| panic!("the entry is read: {fields}"))
        .web_link()
}

#[test]
fn a_doi_in_any_of_its_usual_forms_is_the_doi_org_address() {
    let want = Some("https://doi.org/10.1000/xyz123".to_owned());
    for doi in [
        "10.1000/xyz123",
        "doi:10.1000/xyz123",
        "DOI: 10.1000/xyz123",
        "https://doi.org/10.1000/xyz123",
        "http://doi.org/10.1000/xyz123",
        "https://dx.doi.org/10.1000/xyz123",
        "dx.doi.org/10.1000/xyz123",
        "  10.1000/xyz123  ",
        "{10.1000/xyz123}",
    ] {
        assert_eq!(link(&format!("doi={{{doi}}}")), want, "{doi}");
    }
}

#[test]
fn what_a_doi_cannot_hold_in_an_address_is_written_as_percent_codes() {
    assert_eq!(
        link("doi={10.1002/(SICI)1097-4571(199806)49:8<693::AID-ASI4>3.0.CO;2-O}"),
        Some(
            "https://doi.org/10.1002/(SICI)1097-4571(199806)49:8%3C693::AID-ASI4%3E3.0.CO;2-O"
                .to_owned()
        )
    );
    assert_eq!(
        link(r"doi={10.1000/a\_b\%c\#d}"),
        Some("https://doi.org/10.1000/a_b%25c%23d".to_owned())
    );
    assert_eq!(
        link("doi={10.1000/caf\u{e9}}"),
        Some("https://doi.org/10.1000/caf%C3%A9".to_owned())
    );
    // Two hyphens stay two hyphens: an address is not prose.
    assert_eq!(
        link("doi={10.1000/a--b}"),
        Some("https://doi.org/10.1000/a--b".to_owned())
    );
}

#[test]
fn something_that_is_not_a_doi_is_not_one_and_the_next_best_address_is_used() {
    for doi in [
        "javascript:alert(1)//10.1000/x",
        "11.1000/xyz",
        "10./xyz",
        "10.1000",
        "10.1000/",
        "10.abc/xyz",
        "10.1000/has space",
        "",
        "https://example.org/10.1000/xyz",
    ] {
        assert_eq!(link(&format!("doi={{{doi}}}")), None, "{doi}");
    }
    assert_eq!(
        link("doi={nonsense}, url={https://example.org/p.pdf}"),
        Some("https://example.org/p.pdf".to_owned())
    );
}

#[test]
fn the_doi_comes_before_the_address_and_the_address_before_the_arxiv() {
    assert_eq!(
        link(
            "doi={10.1/x}, url={https://example.org/p}, eprint={2005.14165}, archiveprefix={arXiv}"
        ),
        Some("https://doi.org/10.1/x".to_owned())
    );
    assert_eq!(
        link("url={https://example.org/p}, eprint={2005.14165}, archiveprefix={arXiv}"),
        Some("https://example.org/p".to_owned())
    );
    assert_eq!(
        link("eprint={2005.14165}, archiveprefix={arXiv}"),
        Some("https://arxiv.org/abs/2005.14165".to_owned())
    );
    assert_eq!(
        link("eprint={hep-th/9901001}, eprinttype={arxiv}"),
        Some("https://arxiv.org/abs/hep-th/9901001".to_owned())
    );
    // An identifier that looks like the arXiv's is one, whatever the prefix says.
    assert_eq!(
        link("eprint={2101.00001v2}"),
        Some("https://arxiv.org/abs/2101.00001v2".to_owned())
    );
    assert_eq!(
        link("eprint={some other archive}, archiveprefix={ssrn}"),
        None
    );
    assert_eq!(link(""), None);
}

#[test]
fn an_address_is_a_link_only_when_it_is_a_web_address_with_a_host() {
    assert_eq!(
        link(r"url={\url{https://example.org/a_b?x=1&y=2#top}}"),
        Some("https://example.org/a_b?x=1&y=2#top".to_owned())
    );
    assert_eq!(
        link(r"url={http://user@example.org:8080/p}"),
        Some("http://user@example.org:8080/p".to_owned())
    );
    for url in [
        "javascript:alert(1)",
        "JAVASCRIPT:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "file:///etc/passwd",
        "ftp://example.org/p",
        "mailto:a@b.c",
        "example.org/p",
        "//example.org/p",
        "https://",
        "https:///p",
        "https://exa mple.org",
        "https://example.org/<b>",
        r"https://example.org/\p",
        "https://exam<ple.org",
    ] {
        assert_eq!(link(&format!("url={{{url}}}")), None, "{url}");
    }
}

#[test]
fn whatever_an_entry_holds_a_link_is_a_doi_org_web_or_arxiv_address() {
    for fields in [
        "doi={javascript:1}, url={vbscript:1}, eprint={javascript:1}",
        "doi={10.1/x}, url={javascript:1}",
        "url={https://a.b/c}",
        "eprint={x y}, archiveprefix={arxiv}",
        "doi={https://doi.org/https://doi.org/10.1/x}",
    ] {
        if let Some(found) = link(fields) {
            assert!(
                found.starts_with("https://doi.org/10.")
                    || found.starts_with("https://arxiv.org/abs/")
                    || found.starts_with("http://")
                    || found.starts_with("https://"),
                "{fields} gave {found}"
            );
            assert!(!found.to_lowercase().contains("javascript"), "{found}");
        }
    }
}
