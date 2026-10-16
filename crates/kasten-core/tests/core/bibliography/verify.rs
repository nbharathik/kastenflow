//! What `verify` says about the bibliography: entries cut short, keys used twice and
//! files that cannot be read. It reports and changes nothing.

use super::support::{MANAGED, fresh};

#[test]
fn a_clean_bibliography_has_no_problems() {
    let v = fresh();
    v.put(
        MANAGED,
        "@article{one2020,\n  title = {One},\n  year = {2020},\n}\n\n@book{two2021,\n  title = {Two},\n}\n",
    );
    v.reindex();
    assert_eq!(v.k.bibliography_problems().unwrap(), vec![]);
    assert!(
        !v.k.verify()
            .unwrap()
            .problems
            .iter()
            .any(|p| p.kind.starts_with("bibliography"))
    );
}

#[test]
fn an_entry_that_is_not_closed_is_named() {
    let v = fresh();
    v.put(MANAGED, "@article{open2020,\n  title = {Never closed\n");
    v.reindex();
    let problems = v.k.bibliography_problems().unwrap();
    assert_eq!(problems.len(), 1, "{problems:?}");
    assert_eq!(problems[0].kind, "bibliography");
    assert_eq!(problems[0].path.as_deref(), Some(MANAGED));
    assert!(problems[0].detail.contains("open2020"), "{problems:?}");
}

#[test]
fn a_key_used_twice_is_named_with_both_files() {
    let v = fresh();
    v.put(MANAGED, "@article{same2020,\n  title = {Mine},\n}\n");
    v.put(
        "sources/zotero.bib",
        "@article{same2020,\n  title = {Theirs},\n}\n",
    );
    v.reindex();
    let problems = v.k.bibliography_problems().unwrap();
    let twice: Vec<_> = problems
        .iter()
        .filter(|p| p.kind == "bibliography-duplicate")
        .collect();
    assert_eq!(twice.len(), 1, "{problems:?}");
    assert!(twice[0].detail.contains("same2020"));
    assert!(twice[0].detail.contains("sources/zotero.bib"));
}

#[test]
fn the_same_doi_under_two_keys_is_not_a_problem() {
    let v = fresh();
    v.put(
        MANAGED,
        "@article{a2020,\n  doi = {10.1000/x},\n}\n\n@article{b2020,\n  doi = {10.1000/x},\n}\n",
    );
    v.reindex();
    assert_eq!(v.k.bibliography_problems().unwrap(), vec![]);
}

#[test]
fn checking_changes_nothing() {
    let v = fresh();
    v.put(MANAGED, "@article{open2020,\n  title = {Never closed\n");
    v.reindex();
    let before = v.text(MANAGED);
    let head = v.head();
    v.k.verify().unwrap();
    assert_eq!(v.text(MANAGED), before);
    assert_eq!(v.head(), head);
}
