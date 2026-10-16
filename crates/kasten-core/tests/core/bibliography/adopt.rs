//! External .bib files are read only; a managed copy of their entries is made with
//! `adopt_bib`, entry text as written and the macros it uses carried along.

use std::collections::BTreeMap;

use kasten_core::bib::NewReference;

use super::support::{MANAGED, NOW, fresh, human};

const EXTERNAL: &str = "% from a colleague\r\n@string{ieee = \"IEEE\"}\r\n@string{tpami = ieee # \" TPAMI\"}\r\n\r\n@article{alpha2020, journal = tpami, title = {Alpha}, year = {2020}}\r\n\r\n@book{beta2019, title = {Beta}}\r\n\r\n@article{gamma2018, title = {Gamma}\r\n";

#[test]
fn an_external_file_is_listed_and_never_edited() {
    let f = fresh();
    f.put("papers/colleague.bib", EXTERNAL);
    f.reindex();
    let bib = f.k.bibliography().unwrap();
    assert!(!bib.managed.exists);
    assert_eq!(bib.external.len(), 1);
    let file = &bib.external[0];
    assert_eq!(file.path, "papers/colleague.bib");
    assert!(!file.managed && file.exists);
    let keys: Vec<&str> = file.entries.iter().map(|e| e.key.as_str()).collect();
    assert_eq!(keys, ["alpha2020", "beta2019", "gamma2018"]);
    assert_eq!(file.entries[0].fields["journal"], "IEEE TPAMI");

    let err =
        f.k.update_reference(
            &human(),
            "alpha2020",
            &BTreeMap::from([("year".to_owned(), Some("1999".to_owned()))]),
            &f.hash(),
            NOW,
        )
        .unwrap_err()
        .to_string();
    assert!(err.contains("no reference with the key"), "{err}");
    let err =
        f.k.plan_key_rename("alpha2020", "alpha2021")
            .unwrap_err()
            .to_string();
    assert!(
        err.contains("read only") && err.contains("papers/colleague.bib"),
        "{err}"
    );
    assert_eq!(f.text("papers/colleague.bib"), EXTERNAL);
}

#[test]
fn a_managed_copy_carries_the_entries_and_their_macros_and_leaves_the_original() {
    let f = fresh();
    f.put("papers/colleague.bib", EXTERNAL);
    f.reindex();
    let done =
        f.k.adopt_bib(&human(), "papers/colleague.bib", None, &f.hash(), NOW)
            .unwrap();
    assert_eq!(done.added, ["alpha2020", "beta2019"]);
    assert_eq!(done.skipped.len(), 1);
    assert_eq!(done.skipped[0].key, "gamma2018");
    assert!(
        done.skipped[0].why.contains("never closes"),
        "{}",
        done.skipped[0].why
    );
    assert_eq!(
        f.text(MANAGED),
        "@string{ieee = \"IEEE\"}\n@string{tpami = ieee # \" TPAMI\"}\n@article{alpha2020, journal = tpami, title = {Alpha}, year = {2020}}\n\n@book{beta2019, title = {Beta}}\n"
    );
    assert_eq!(done.hash, f.hash());
    assert_eq!(done.commit.as_deref(), Some(f.head().as_str()));
    assert_eq!(
        f.text("papers/colleague.bib"),
        EXTERNAL,
        "the original is as it was"
    );

    let bib = f.k.bibliography().unwrap();
    assert_eq!(bib.managed.entries[0].fields["journal"], "IEEE TPAMI");
    assert_eq!(bib.duplicates.len(), 2, "both are now in two files");
}

#[test]
fn only_the_keys_asked_for_are_copied_and_a_key_the_managed_file_has_is_skipped() {
    let f = fresh();
    f.put("papers/colleague.bib", EXTERNAL);
    f.reindex();
    let only = vec!["beta2019".to_owned(), "nowhere".to_owned()];
    let done =
        f.k.adopt_bib(
            &human(),
            "papers/colleague.bib",
            Some(&only),
            &f.hash(),
            NOW,
        )
        .unwrap();
    assert_eq!(done.added, ["beta2019"]);
    assert_eq!(done.skipped.len(), 1);
    assert_eq!(done.skipped[0].key, "nowhere");
    assert!(done.skipped[0].why.contains("not in that file"));
    assert_eq!(f.text(MANAGED), "@book{beta2019, title = {Beta}}\n");

    let again =
        f.k.adopt_bib(&human(), "papers/colleague.bib", None, &f.hash(), NOW)
            .unwrap();
    assert_eq!(again.added, ["alpha2020"]);
    let skipped: Vec<&str> = again.skipped.iter().map(|s| s.key.as_str()).collect();
    assert_eq!(skipped, ["beta2019", "gamma2018"]);
    assert!(again.skipped[0].why.contains("managed file has that key"));
}

#[test]
fn a_macro_the_managed_file_defines_the_same_way_is_not_copied_twice() {
    let f = fresh();
    f.put(MANAGED, "@string{ieee = \"IEEE\"}\n");
    f.put("papers/colleague.bib", EXTERNAL);
    f.reindex();
    let done =
        f.k.adopt_bib(
            &human(),
            "papers/colleague.bib",
            Some(&["alpha2020".to_owned()]),
            &f.hash(),
            NOW,
        )
        .unwrap();
    assert_eq!(done.added, ["alpha2020"]);
    let text = f.text(MANAGED);
    assert_eq!(text.matches("@string{ieee").count(), 1, "{text}");
    assert!(text.contains("@string{tpami"));
    assert_eq!(
        f.k.bibliography().unwrap().managed.entries[0].fields["journal"],
        "IEEE TPAMI"
    );
}

#[test]
fn an_entry_that_needs_a_macro_the_managed_file_defines_differently_is_left_out() {
    let f = fresh();
    f.put(MANAGED, "@string{ieee = \"Another\"}\n");
    f.put("papers/colleague.bib", EXTERNAL);
    f.reindex();
    let before = f.text(MANAGED);
    let done =
        f.k.adopt_bib(
            &human(),
            "papers/colleague.bib",
            Some(&["alpha2020".to_owned()]),
            &f.hash(),
            NOW,
        )
        .unwrap();
    assert!(done.added.is_empty());
    assert!(
        done.skipped[0].why.contains("macro ieee"),
        "{}",
        done.skipped[0].why
    );
    assert_eq!(done.commit, None);
    assert_eq!(f.text(MANAGED), before);
}

#[test]
fn what_cannot_be_adopted_is_refused() {
    let f = fresh();
    f.put("notes.bib", "@misc{x}\n");
    f.reindex();
    let base = f.hash();
    assert!(f.k.adopt_bib(&human(), MANAGED, None, &base, NOW).is_err());
    assert!(
        f.k.adopt_bib(&human(), "missing.bib", None, &base, NOW)
            .is_err()
    );
    assert!(
        f.k.adopt_bib(&human(), "../outside.bib", None, &base, NOW)
            .is_err()
    );
    assert!(
        f.k.adopt_bib(&human(), "notes.txt", None, &base, NOW)
            .is_err()
    );
    assert!(
        f.k.adopt_bib(&human(), "notes.bib", None, "stale", NOW)
            .is_err()
    );
    assert!(!f.exists(MANAGED));
}

#[test]
fn the_managed_file_comes_first_in_the_text_decks_read() {
    let f = fresh();
    f.put(
        "a-first.bib",
        "@article{shared, title = {From the external file}}\n",
    );
    f.k.add_reference(
        &human(),
        &NewReference {
            kind: "article".to_owned(),
            key: "shared".to_owned(),
            fields: BTreeMap::from([("title".to_owned(), "From the managed file".to_owned())]),
            allow_duplicate: true,
        },
        &f.hash(),
        NOW,
    )
    .unwrap();
    f.reindex();
    let text = f.k.references().unwrap();
    assert!(
        text.find("From the managed file").unwrap() < text.find("From the external file").unwrap(),
        "{text}"
    );
    let first = slides_bib_first(&text);
    assert_eq!(first, "From the managed file");
}

/// The title of the first entry a reader takes for `shared`.
fn slides_bib_first(text: &str) -> String {
    let start = text.find("@article{shared").unwrap();
    let rest = &text[start..];
    let open = rest.find("title = {").unwrap() + "title = {".len();
    rest[open..rest[open..].find('}').unwrap() + open].to_owned()
}
