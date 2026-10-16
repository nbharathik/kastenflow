//! Adding and updating references: house style for a new entry, and for an edit
//! only the bytes asked for, so comments, macros and unknown fields stay.

use std::collections::BTreeMap;

use kasten_core::bib::{MatchKind, NewReference};
use kasten_core::content_hash;
use kasten_core::history::Actor;

use super::support::{MANAGED, NOW, fresh, human};

fn reference(kind: &str, key: &str, fields: &[(&str, &str)]) -> NewReference {
    NewReference {
        kind: kind.to_owned(),
        key: key.to_owned(),
        fields: fields
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect(),
        allow_duplicate: false,
    }
}

fn changes(pairs: &[(&str, Option<&str>)]) -> BTreeMap<String, Option<String>> {
    pairs
        .iter()
        .map(|(k, v)| ((*k).to_owned(), v.map(str::to_owned)))
        .collect()
}

const SEED: &str = "% Papers I read\n@string{nips = \"Advances in NIPS\"}\n\n@inproceedings{vaswani2017attention,\n  title     = {Attention is all you need},\n  booktitle = nips,\n  year      = 2017,\n  mynote    = {keep me},\n  pages     = \"1--9\"\n}\n\n@comment{keep this too}\n";

#[test]
fn a_vault_without_the_managed_file_reports_it_as_not_made_yet() {
    let f = fresh();
    let bib = f.k.bibliography().unwrap();
    assert_eq!(bib.managed.path, MANAGED);
    assert!(bib.managed.managed && !bib.managed.exists);
    assert_eq!(bib.managed.hash, content_hash(""));
    assert!(bib.managed.entries.is_empty() && bib.external.is_empty() && bib.duplicates.is_empty());
}

#[test]
fn the_first_reference_makes_the_file_in_house_style() {
    let f = fresh();
    let saved =
        f.k.add_reference(
            &human(),
            &reference(
                "Article",
                "doe2020thing",
                &[
                    ("year", "2020"),
                    ("title", "A thing"),
                    ("author", "Doe, Jane"),
                    ("doi", "10.1000/xyz"),
                    ("empty", "   "),
                ],
            ),
            &content_hash(""),
            NOW,
        )
        .unwrap();
    assert_eq!(saved.key, "doe2020thing");
    assert_eq!(
        f.text(MANAGED),
        "@article{doe2020thing,\n  author = {Doe, Jane},\n  title = {A thing},\n  year = {2020},\n  doi = {10.1000/xyz},\n}\n"
    );
    assert_eq!(saved.hash, f.hash());
    assert_eq!(saved.commit.as_deref(), Some(f.head().as_str()));
    let bib = f.k.bibliography().unwrap();
    assert!(bib.managed.exists);
    assert_eq!(bib.managed.entries.len(), 1);
    assert_eq!(bib.managed.entries[0].kind, "article");
    assert_eq!(bib.managed.entries[0].fields["title"], "A thing");
}

#[test]
fn a_new_entry_follows_a_blank_line_and_the_files_own_line_endings() {
    let f = fresh();
    f.put(MANAGED, "@book{old,\r\n  title = {Old}\r\n}\r\n");
    f.reindex();
    let before = f.text(MANAGED);
    f.k.add_reference(
        &human(),
        &reference("book", "new1", &[("title", "New")]),
        &f.hash(),
        NOW,
    )
    .unwrap();
    let after = f.text(MANAGED);
    assert!(after.starts_with(&before), "what was there is untouched");
    assert_eq!(
        &after[before.len()..],
        "\r\n@book{new1,\r\n  title = {New},\r\n}\r\n"
    );
}

#[test]
fn an_edit_changes_only_the_bytes_of_the_values_it_sets() {
    let f = fresh();
    f.put(MANAGED, SEED);
    f.reindex();
    let saved =
        f.k.update_reference(
            &human(),
            "vaswani2017attention",
            &changes(&[
                ("title", Some("Attention Is All You Need")),
                ("year", Some("2018")),
                ("pages", Some("5--9")),
                ("volume", Some("30")),
                ("mynote", None),
            ]),
            &f.hash(),
            NOW,
        )
        .unwrap();
    assert_eq!(
        f.text(MANAGED),
        "% Papers I read\n@string{nips = \"Advances in NIPS\"}\n\n@inproceedings{vaswani2017attention,\n  title     = {Attention Is All You Need},\n  booktitle = nips,\n  year      = 2018,\n  pages     = \"5--9\",\n  volume    = {30}\n}\n\n@comment{keep this too}\n"
    );
    assert_eq!(saved.hash, f.hash());
    assert!(saved.commit.is_some());
}

#[test]
fn a_value_with_a_quote_in_a_quoted_field_gets_braces_and_a_number_gets_braces_for_words() {
    let f = fresh();
    f.put(MANAGED, "@misc{k,\n  title = \"Old\",\n  year = 2017,\n}\n");
    f.reindex();
    f.k.update_reference(
        &human(),
        "k",
        &changes(&[("title", Some("Say \"hi\"")), ("year", Some("in press"))]),
        &f.hash(),
        NOW,
    )
    .unwrap();
    assert_eq!(
        f.text(MANAGED),
        "@misc{k,\n  title = {Say \"hi\"},\n  year = {in press},\n}\n"
    );
}

#[test]
fn a_field_is_added_after_a_trailing_comma_and_on_one_line_entries_inline() {
    let f = fresh();
    f.put(
        MANAGED,
        "@misc{multi,\n  title = {T},\n}\n@misc{inline, title = {T}}\n@misc{bare}\n",
    );
    f.reindex();
    let add = changes(&[("year", Some("2020"))]);
    for key in ["multi", "inline", "bare"] {
        f.k.update_reference(&human(), key, &add, &f.hash(), NOW)
            .unwrap();
    }
    assert_eq!(
        f.text(MANAGED),
        "@misc{multi,\n  title = {T},\n  year = {2020},\n}\n@misc{inline, title = {T}, year = {2020}}\n@misc{bare, year = {2020}}\n"
    );
}

#[test]
fn taking_fields_out_leaves_the_rest() {
    let f = fresh();
    f.put(
        MANAGED,
        "@misc{a,\n  title = {T},\n  year = {2020}\n}\n@misc{b, title = {T}, year = {2020}}\n",
    );
    f.reindex();
    let drop = changes(&[("year", None)]);
    f.k.update_reference(&human(), "a", &drop, &f.hash(), NOW)
        .unwrap();
    f.k.update_reference(&human(), "b", &drop, &f.hash(), NOW)
        .unwrap();
    assert_eq!(
        f.text(MANAGED),
        "@misc{a,\n  title = {T},\n}\n@misc{b, title = {T}}\n"
    );
}

#[test]
fn saying_what_is_so_already_writes_nothing() {
    let f = fresh();
    f.put(MANAGED, SEED);
    f.reindex();
    let head = f.head();
    let saved =
        f.k.update_reference(
            &human(),
            "vaswani2017attention",
            &changes(&[
                ("year", Some("2017")),
                ("title", Some("Attention is all you need")),
                ("nothing", None),
            ]),
            &f.hash(),
            NOW,
        )
        .unwrap();
    assert_eq!(f.text(MANAGED), SEED);
    assert_eq!(saved.commit, None);
    assert_eq!(f.head(), head);
}

#[test]
fn a_stale_base_hash_is_refused_and_nothing_is_written() {
    let f = fresh();
    f.put(MANAGED, SEED);
    f.reindex();
    let stale = f.hash();
    f.put(MANAGED, &format!("{SEED}% edited elsewhere\n"));
    let err =
        f.k.add_reference(
            &human(),
            &reference("misc", "k", &[("title", "T")]),
            &stale,
            NOW,
        )
        .unwrap_err()
        .to_string();
    assert!(err.contains("changed since"), "{err}");
    let err =
        f.k.update_reference(
            &human(),
            "vaswani2017attention",
            &changes(&[("year", Some("1"))]),
            &stale,
            NOW,
        )
        .unwrap_err()
        .to_string();
    assert!(err.contains("changed since"), "{err}");
    assert_eq!(f.text(MANAGED), format!("{SEED}% edited elsewhere\n"));
}

#[test]
fn values_and_keys_that_would_break_the_file_are_refused() {
    let f = fresh();
    let base = content_hash("");
    for (key, fields) in [
        ("bad key", vec![("title", "T")]),
        ("a,b", vec![("title", "T")]),
        ("k", vec![("title", "open { brace")]),
        ("k", vec![("title", "close } brace")]),
        ("k", vec![("title", "ends with a slash \\")]),
        ("k", vec![("bad name", "T")]),
        ("", vec![("title", "T")]),
    ] {
        let err =
            f.k.add_reference(&human(), &reference("misc", key, &fields), &base, NOW);
        assert!(err.is_err(), "{key:?} {fields:?}");
    }
    for kind in ["", "string", "comment", "two words"] {
        assert!(
            f.k.add_reference(&human(), &reference(kind, "k", &[]), &base, NOW)
                .is_err(),
            "{kind:?}"
        );
    }
    assert!(!f.exists(MANAGED), "nothing was written");
}

#[test]
fn a_value_over_several_lines_is_written_on_one() {
    let f = fresh();
    f.k.add_reference(
        &human(),
        &reference("misc", "k", &[("note", "first\r\nsecond  \n third")]),
        &content_hash(""),
        NOW,
    )
    .unwrap();
    assert_eq!(
        f.text(MANAGED),
        "@misc{k,\n  note = {first second third},\n}\n"
    );
}

#[test]
fn the_same_key_doi_or_arxiv_number_is_refused_unless_allowed() {
    let f = fresh();
    f.put(
        MANAGED,
        "@article{one,\n  title = {One},\n  doi = {10.1000/ABC},\n}\n@article{two,\n  title = {Two},\n  eprint = {2005.14165},\n  archiveprefix = {arXiv},\n}\n",
    );
    f.put(
        "other.bib",
        "@article{three, title = {Three}, doi = {10.5555/zzz}}\n",
    );
    f.reindex();
    let try_add = |reference: NewReference| {
        let base = f.hash();
        f.k.add_reference(&human(), &reference, &base, NOW)
    };
    let err = try_add(reference("misc", "ONE", &[("title", "x")]))
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("key") && err.contains("one"),
        "case alone does not make a new key: {err}"
    );
    let err = try_add(reference(
        "misc",
        "fresh1",
        &[("doi", "https://doi.org/10.1000/abc")],
    ))
    .unwrap_err()
    .to_string();
    assert!(err.contains("DOI") && err.contains("one"), "{err}");
    let err = try_add(reference(
        "misc",
        "fresh2",
        &[("eprint", "arXiv:2005.14165v3")],
    ))
    .unwrap_err()
    .to_string();
    assert!(err.contains("arXiv") && err.contains("two"), "{err}");
    let err = try_add(reference("misc", "fresh3", &[("doi", "10.5555/ZZZ")]))
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("other.bib"),
        "an external file counts too: {err}"
    );

    let mut again = reference("misc", "fresh1", &[("doi", "10.1000/abc")]);
    again.allow_duplicate = true;
    try_add(again).unwrap();
    assert!(f.text(MANAGED).contains("@misc{fresh1,"));
}

#[test]
fn checking_a_reference_lists_what_it_would_repeat_without_writing() {
    let f = fresh();
    f.put(
        MANAGED,
        "@article{one, title = {One}, doi = {10.1000/abc}}\n",
    );
    f.put(
        "other.bib",
        "@article{two, title = {Two}, eprint = {1706.03762}}\n",
    );
    f.reindex();
    let before = f.text(MANAGED);
    let found =
        f.k.check_reference(&reference(
            "misc",
            "one",
            &[("doi", "doi:10.1000/ABC"), ("eprint", "1706.03762v5")],
        ))
        .unwrap();
    let seen: Vec<(MatchKind, &str, &str)> = found
        .iter()
        .map(|m| (m.by, m.file.as_str(), m.key.as_str()))
        .collect();
    assert_eq!(
        seen,
        [
            (MatchKind::Key, MANAGED, "one"),
            (MatchKind::Doi, MANAGED, "one"),
            (MatchKind::Arxiv, "other.bib", "two"),
        ]
    );
    assert_eq!(f.text(MANAGED), before);
}

#[test]
fn the_bibliography_lists_duplicates_among_all_its_files() {
    let f = fresh();
    f.put(
        MANAGED,
        "@article{a, title = {A}, doi = {10.1001/x}}\n@article{dup, title = {First}}\n",
    );
    f.put(
        "b.bib",
        "@article{b, title = {B}, doi = {https://doi.org/10.1001/X}}\n@article{dup, title = {Second}}\n",
    );
    f.reindex();
    let found = f.k.bibliography().unwrap().duplicates;
    let seen: Vec<(MatchKind, &str, usize)> = found
        .iter()
        .map(|d| (d.by, d.value.as_str(), d.entries.len()))
        .collect();
    assert_eq!(
        seen,
        [(MatchKind::Key, "dup", 2), (MatchKind::Doi, "10.1001/x", 2)]
    );
}

#[test]
fn replacing_an_entry_with_raw_text_needs_one_whole_entry_with_the_same_key() {
    let f = fresh();
    f.put(MANAGED, SEED);
    f.reindex();
    let key = "vaswani2017attention";
    let raw = "@inproceedings{vaswani2017attention,\n  title = {Attention},\n  year = {2017}\n}";
    f.k.replace_reference(&human(), key, &format!("\n{raw}\n\n"), &f.hash(), NOW)
        .unwrap();
    assert_eq!(
        f.text(MANAGED),
        format!(
            "% Papers I read\n@string{{nips = \"Advances in NIPS\"}}\n\n{raw}\n\n@comment{{keep this too}}\n"
        )
    );
    for bad in [
        "@article{other, title = {x}}",
        "@article{vaswani2017attention, title = {x}",
        "@article{vaswani2017attention, title = {x}} and a stray word",
        "@article{vaswani2017attention, title = {x}}\n@article{second, title = {y}}",
        "just words",
        "",
    ] {
        let base = f.hash();
        assert!(
            f.k.replace_reference(&human(), key, bad, &base, NOW)
                .is_err(),
            "{bad:?}"
        );
    }
}

#[test]
fn an_agent_is_refused_every_write() {
    let f = fresh();
    let agent = Actor::Agent {
        client: "test".to_owned(),
        session: "s1".to_owned(),
    };
    let base = content_hash("");
    let err =
        f.k.add_reference(&agent, &reference("misc", "k", &[]), &base, NOW)
            .unwrap_err()
            .to_string();
    assert!(err.contains("not by an agent"), "{err}");
    assert!(
        f.k.update_reference(&agent, "k", &changes(&[]), &base, NOW)
            .is_err()
    );
    assert!(f.k.adopt_bib(&agent, "x.bib", None, &base, NOW).is_err());
    assert!(!f.exists(MANAGED));
}

#[test]
fn a_key_is_suggested_from_who_when_and_what_and_numbered_when_taken() {
    use kasten_core::bib::KeyHints;
    let f = fresh();
    f.put("extra.bib", "@article{Doe2020Deep, title = {x}}\n");
    f.reindex();
    let hint = |author: &str, year: &str, title: &str| KeyHints {
        author: Some(author.to_owned()),
        year: Some(year.to_owned()),
        title: Some(title.to_owned()),
    };
    let suggest = |h: KeyHints| f.k.suggest_key(&h).unwrap();
    assert_eq!(
        suggest(hint(
            "Vaswani, Ashish and Shazeer, Noam",
            "2017",
            "Attention is all you need"
        )),
        "vaswani2017attention"
    );
    assert_eq!(
        suggest(hint(
            "Ashish Vaswani and Noam Shazeer",
            "2017",
            "The Attention"
        )),
        "vaswani2017attention"
    );
    assert_eq!(
        suggest(hint("Müller, Jörg", "in 2019 (preprint)", "Über {BERT}")),
        "muller2019uber"
    );
    assert_eq!(
        suggest(hint("{World Health Organization}", "2021", "A report")),
        "world2021report"
    );
    assert_eq!(suggest(KeyHints::default()), "ref");
    assert_eq!(
        suggest(hint("Doe, Jane", "2020", "Deep learning")),
        "doe2020deep-2",
        "taken, compared without regard to case"
    );
}
