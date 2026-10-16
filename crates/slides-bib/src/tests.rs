use std::collections::BTreeMap;

use crate::{
    Kind, MOST_BYTES, MOST_ENTRIES, MOST_VALUE, PieceKind, arxiv_key, doi_key, normalise_arxiv,
    normalise_doi, read, scan,
};

fn keys(text: &str) -> Vec<String> {
    read(text).into_iter().map(|r| r.key).collect()
}

fn field(text: &str, key: &str, name: &str) -> Option<String> {
    read(text)
        .into_iter()
        .find(|r| r.key == key)?
        .fields
        .get(name)
        .cloned()
}

/// The texts of the spans put together.
fn joined(text: &str) -> String {
    scan(text).iter().map(|s| &text[s.whole.clone()]).collect()
}

/// Every span starts where the one before ended, and the last ends at the end.
fn tiles(text: &str) -> bool {
    let spans = scan(text);
    let mut at = 0;
    for span in &spans {
        if span.whole.start != at || span.whole.end < span.whole.start {
            return false;
        }
        at = span.whole.end;
    }
    at == text.len() && joined(text) == text
}

/// A small deterministic generator, so these tests need no crate.
struct Lcg(u64);

impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.0 >> 33
    }
}

const PIECES: [&str; 22] = [
    "@article",
    "@string",
    "@comment",
    "@preamble",
    "{",
    "}",
    "(",
    ")",
    ",",
    "=",
    "\"",
    "#",
    "\\",
    "\n@",
    " ",
    "é",
    "\r\n",
    "title",
    "key",
    "2020",
    "%",
    "@",
];

#[test]
fn reads_the_keys_of_entries_and_skips_what_is_not_one() {
    let bib = "@string{ieee = \"IEEE\"}\n@comment{ignored}\n@article{vaswani2017,\n  title={Attention}\n}\n@Book {knuth:1984 ,\n}\n@inproceedings(he16, x={y})\n@preamble{\"x\"}\nan email a@b.c is not an entry";
    assert_eq!(keys(bib), ["vaswani2017", "knuth:1984", "he16"]);
}

#[test]
fn every_common_entry_type_is_read_with_braces_or_quotes() {
    let bib = r#"
@article{a1, title = {A {T}itle}, author = "Doe, Jane", year = 2020, journal = {Nature}}
@inproceedings{a2, title = "Quoted {\"o}", booktitle = {Conf}, year = {2019}}
@book{a3, title={Book}, publisher={MIT Press}, year=2016}
@misc{a4, title={Misc}, howpublished={\url{http://x.y}}}
@MastersThesis{a7, title={Small}}
"#;
    assert_eq!(keys(bib), ["a1", "a2", "a3", "a4", "a7"]);
    assert_eq!(field(bib, "a1", "title").as_deref(), Some("A {T}itle"));
    assert_eq!(field(bib, "a1", "year").as_deref(), Some("2020"));
    assert_eq!(field(bib, "a1", "author").as_deref(), Some("Doe, Jane"));
    assert_eq!(field(bib, "a2", "title").as_deref(), Some("Quoted {\\\"o}"));
    assert_eq!(read(bib)[4].kind, "mastersthesis");
    assert_eq!(
        field(bib, "a4", "howpublished").as_deref(),
        Some("\\url{http://x.y}")
    );
}

#[test]
fn field_names_are_lower_case_and_unknown_fields_are_kept() {
    let bib = "@Article{k, TITLE={T}, ArchivePrefix={arXiv}, EPrint={1706.03762}, x-custom_1={y}}";
    assert_eq!(field(bib, "k", "title").as_deref(), Some("T"));
    assert_eq!(field(bib, "k", "archiveprefix").as_deref(), Some("arXiv"));
    assert_eq!(field(bib, "k", "eprint").as_deref(), Some("1706.03762"));
    assert_eq!(field(bib, "k", "x-custom_1").as_deref(), Some("y"));
}

#[test]
fn string_macros_and_concatenation_are_expanded() {
    let bib = r#"
@string{ieee = "IEEE"}
@string{ tpami = ieee # " Trans. Pattern Anal. Mach. Intell." }
@article{k1, journal = tpami, month = jan, note = "see " # ieee # " and {braces}", year = 2001}
@article{k2, journal = undefinedmacro}
"#;
    assert_eq!(
        field(bib, "k1", "journal").as_deref(),
        Some("IEEE Trans. Pattern Anal. Mach. Intell.")
    );
    assert_eq!(field(bib, "k1", "month").as_deref(), Some("January"));
    assert_eq!(
        field(bib, "k1", "note").as_deref(),
        Some("see IEEE and {braces}")
    );
    assert_eq!(
        field(bib, "k2", "journal").as_deref(),
        Some("undefinedmacro")
    );
    assert_eq!(keys(bib), ["k1", "k2"], "a string is not a reference");
}

#[test]
fn a_macro_is_known_only_to_the_entries_after_it() {
    let bib = "@article{before, journal = later}\n@string{later = \"Late\"}\n@article{after, journal = later}";
    assert_eq!(field(bib, "before", "journal").as_deref(), Some("later"));
    assert_eq!(field(bib, "after", "journal").as_deref(), Some("Late"));
}

#[test]
fn braces_and_quotes_nest_and_a_quote_inside_braces_does_not_end_a_quoted_value() {
    let bib = r#"@article{k, title = "A {\"quoted\"} word", note = {a {b {c}} d}, x = "M\"uller"}"#;
    assert_eq!(
        field(bib, "k", "title").as_deref(),
        Some("A {\\\"quoted\\\"} word")
    );
    assert_eq!(field(bib, "k", "note").as_deref(), Some("a {b {c}} d"));
    assert_eq!(field(bib, "k", "x").as_deref(), Some("M\\\"uller"));
}

#[test]
fn a_trailing_comma_a_missing_comma_and_odd_spacing_are_fine() {
    let bib = "@article{ one ,\n  title = {T} ,\n  year = 2001 ,\n}\n@article{two,title={T}year=2002}\n@article  (  three  ,  title  =  {T}  )\n@article{four}";
    assert_eq!(keys(bib), ["one", "two", "three", "four"]);
    assert_eq!(field(bib, "one", "year").as_deref(), Some("2001"));
    assert_eq!(field(bib, "three", "title").as_deref(), Some("T"));
    assert_eq!(field(bib, "four", "title"), None);
}

#[test]
fn an_entry_that_never_closes_does_not_swallow_the_ones_after_it() {
    let bib = "@article{broken,\n  title = {Never closed,\n  year = 2001\n\n@article{after1, title={Fine}}\n@article{after2, title={Also fine}}\n";
    assert_eq!(keys(bib), ["broken", "after1", "after2"]);
    assert_eq!(field(bib, "after2", "title").as_deref(), Some("Also fine"));
    let spans = scan(bib);
    let broken = spans.iter().find(|s| s.kind == Kind::Entry).unwrap();
    assert!(!broken.closed, "the broken entry says it never closed");
    assert!(!broken.fields[0].complete);
}

#[test]
fn text_between_entries_is_ignored_but_kept_in_a_span() {
    let bib = "% a comment line\nThis file was made by hand.\n@article{k, title={T}}\nmore words @ here\n@online{web, url={https://x.y}}\n";
    assert_eq!(keys(bib), ["k", "web"]);
    let kinds: Vec<Kind> = scan(bib).iter().map(|s| s.kind).collect();
    assert_eq!(
        kinds,
        [Kind::Text, Kind::Entry, Kind::Text, Kind::Entry, Kind::Text]
    );
    assert!(tiles(bib));
}

#[test]
fn keys_are_taken_as_written_and_may_hold_punctuation() {
    assert_eq!(
        keys("@article{Smith_2020-a:b.c/d, title={T}}\n@article{ÄÖ2020, title={T}}"),
        ["Smith_2020-a:b.c/d", "ÄÖ2020"]
    );
}

#[test]
fn an_entry_without_a_key_or_a_type_is_no_entry() {
    for bib in [
        "@article{}",
        "@article{,}",
        "@{k, a=b}",
        "@ {k}",
        "@",
        "@@@",
        "@article",
        "@article k",
    ] {
        assert!(read(bib).is_empty(), "{bib}");
        assert!(tiles(bib), "{bib}");
    }
}

#[test]
fn a_long_value_is_cut_and_a_huge_file_is_read_only_as_far_as_the_limit() {
    let long = format!("@article{{k, title = {{{}}}}}", "x".repeat(200_000));
    let title = field(&long, "k", "title").unwrap();
    assert!(title.len() <= MOST_VALUE, "{}", title.len());
    assert!(tiles(&long));

    let many: String = (0..MOST_ENTRIES + 500)
        .map(|n| format!("@misc{{k{n}, title={{t}}}}\n"))
        .collect();
    assert_eq!(read(&many).len(), MOST_ENTRIES);
    assert!(
        tiles(&many),
        "the entries past the limit are one span of text"
    );

    let filler = " ".repeat(MOST_BYTES + 10);
    let late = format!("{filler}@article{{late, title={{t}}}}");
    assert!(read(&late).is_empty(), "past the limit nothing is read");
    assert!(tiles(&late));
}

#[test]
fn a_cut_never_lands_inside_a_character() {
    let text = format!("@article{{k, title={{{}}}}}", "é".repeat(MOST_VALUE));
    assert!(
        field(&text, "k", "title")
            .unwrap()
            .chars()
            .all(|c| c == 'é')
    );
    let padded = format!("{}é@article{{k}}", "a".repeat(MOST_BYTES - 1));
    let _ = read(&padded);
    assert!(tiles(&padded));
}

#[test]
fn hostile_text_is_read_without_panicking_and_still_tiles() {
    let deep = "{".repeat(50_000);
    let nested = format!("@article{{k, title={deep}");
    let closers = format!("@article{{k, title={}}}", "}".repeat(50_000));
    for bib in [
        "@article{k, title=",
        "@article{k, title={",
        "@article{k, title=\"",
        "@article{k, title=#",
        "@article{k, title={a}#",
        "@article{k, = {x}}",
        "@article{k, title={a}}}}}}}}",
        "@string{",
        "@string{a}",
        "@string{a=}",
        "@comment{",
        "@comment",
        "@preamble",
        "@article{k,,,,title={a},,,,}",
        "@article{k, title={é",
        "@é{k}",
        "@article{é",
        "\u{0}@article{k}\u{0}",
        "@article{k, title=\\",
        "@comment(\\",
        nested.as_str(),
        closers.as_str(),
    ] {
        let _ = read(bib);
        assert!(tiles(bib), "{:?}", &bib[..bib.len().min(40)]);
    }
}

#[test]
fn text_made_of_bibtex_pieces_reads_without_panicking_and_tiles() {
    let mut random = Lcg(7);
    for _ in 0..600 {
        let count = (random.next() % 60) as usize;
        let text: String = (0..count)
            .map(|_| PIECES[(random.next() as usize) % PIECES.len()])
            .collect();
        for entry in read(&text) {
            assert!(
                text.contains(&entry.key),
                "{:?} is not in {text:?}",
                entry.key
            );
        }
        assert!(tiles(&text), "{text:?}");
    }
}

#[test]
fn the_places_of_an_entrys_parts_are_the_bytes_that_hold_them() {
    let bib =
        "@Article{ key1 ,\n  title = {A {T}itle},\n  year = 2020,\n  note = \"q\" # \" r\",\n}\n";
    let spans = scan(bib);
    let entry = &spans[0];
    assert_eq!(entry.kind, Kind::Entry);
    assert_eq!(entry.text(bib), bib.trim_end());
    assert_eq!(entry.key_in(bib), Some("key1"));
    assert_eq!(entry.type_in(bib), "article");
    assert!(entry.closed);
    let title = entry.field("title").unwrap();
    assert_eq!(&bib[title.name_at.clone()], "title");
    assert_eq!(title.value_in(bib), "{A {T}itle}");
    assert_eq!(&bib[title.inner.clone().unwrap()], "A {T}itle");
    assert_eq!(&bib[title.whole.clone()], "title = {A {T}itle}");
    let year = entry.field("year").unwrap();
    assert_eq!(year.value_in(bib), "2020");
    assert_eq!(year.pieces[0].kind, PieceKind::Word);
    assert!(year.inner.is_none(), "a bare number has no inside");
    let note = entry.field("note").unwrap();
    assert_eq!(note.value_in(bib), "\"q\" # \" r\"");
    assert_eq!(note.pieces.len(), 2);
    assert!(note.inner.is_none(), "a joined value has no one inside");
    assert_eq!(spans[1].kind, Kind::Text);
    assert!(tiles(bib));
}

#[test]
fn macros_comments_and_preambles_have_spans_of_their_own() {
    let bib =
        "@string{ieee = \"IEEE\"}\n@comment{x {y} z}\n@preamble{\"\\newcommand\"}\n@misc{k}\n";
    let spans = scan(bib);
    let kinds: Vec<Kind> = spans.iter().map(|s| s.kind).collect();
    assert_eq!(
        kinds,
        [
            Kind::String,
            Kind::Text,
            Kind::Comment,
            Kind::Text,
            Kind::Preamble,
            Kind::Text,
            Kind::Entry,
            Kind::Text
        ]
    );
    assert_eq!(spans[0].key_in(bib), Some("ieee"));
    assert_eq!(spans[0].fields[0].name, "ieee");
    assert_eq!(spans[2].text(bib), "@comment{x {y} z}");
    assert!(spans[2].closed && spans[4].closed);
    assert!(tiles(bib));
}

#[test]
fn windows_line_endings_are_kept() {
    let bib =
        "@article{k,\r\n  title = {T},\r\n  year = {2020}\r\n}\r\n\r\n@book{b, title={B}}\r\n";
    assert_eq!(keys(bib), ["k", "b"]);
    assert!(tiles(bib));
    assert_eq!(joined(bib), bib);
}

#[test]
fn identifiers_are_read_out_of_the_ways_they_are_written() {
    for written in [
        "10.1000/XYZ123",
        "doi:10.1000/xyz123",
        "https://doi.org/10.1000/xyz123",
        "http://dx.doi.org/10.1000/XYZ123.",
        "\\url{https://doi.org/10.1000/xyz123}",
        " 10.1000%2Fxyz123 ",
    ] {
        assert_eq!(
            normalise_doi(written).as_deref(),
            Some("10.1000/xyz123"),
            "{written}"
        );
    }
    for not in ["", "no doi here", "10.12/short", "abc10.1000/x", "10.1000/"] {
        assert_eq!(normalise_doi(not), None, "{not}");
    }
    for (written, id) in [
        ("1706.03762", "1706.03762"),
        ("arXiv:1706.03762v5", "1706.03762"),
        ("https://arxiv.org/abs/2005.14165v2", "2005.14165"),
        ("arxiv.org/pdf/1706.03762.pdf", "1706.03762"),
        ("hep-th/9901001", "hep-th/9901001"),
        ("arXiv:math.GT/0309136v1", "math.gt/0309136"),
        ("2101.0001", "2101.0001"),
    ] {
        assert_eq!(normalise_arxiv(written).as_deref(), Some(id), "{written}");
    }
    for not in ["", "2020.01.15", "12345.67890", "hello", "10.1234/abc"] {
        assert_eq!(normalise_arxiv(not), None, "{not}");
    }
}

fn fields(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
    pairs
        .iter()
        .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
        .collect()
}

#[test]
fn an_entry_has_a_doi_and_an_arxiv_key_when_its_fields_say_so() {
    assert_eq!(
        doi_key(&fields(&[("doi", "10.1000/ABC")])).as_deref(),
        Some("10.1000/abc")
    );
    assert_eq!(
        doi_key(&fields(&[("url", "https://doi.org/10.1000/abc")])).as_deref(),
        Some("10.1000/abc")
    );
    assert_eq!(
        doi_key(&fields(&[("url", "https://example.org/10.1000/abc")])),
        None
    );
    assert_eq!(doi_key(&fields(&[("title", "x")])), None);

    let key = |pairs: &[(&str, &str)]| arxiv_key(&fields(pairs));
    assert_eq!(
        key(&[("eprint", "2005.14165"), ("archiveprefix", "arXiv")]).as_deref(),
        Some("2005.14165")
    );
    assert_eq!(
        key(&[("eprint", "1706.03762v5")]).as_deref(),
        Some("1706.03762")
    );
    assert_eq!(
        key(&[
            ("eprint", "2005.14165"),
            ("archiveprefix", "somewhere else")
        ]),
        None,
        "another archive's number is not arXiv's"
    );
    assert_eq!(
        key(&[("doi", "10.48550/arXiv.2005.14165")]).as_deref(),
        Some("2005.14165")
    );
    assert_eq!(
        key(&[("url", "https://arxiv.org/abs/hep-th/9901001")]).as_deref(),
        Some("hep-th/9901001")
    );
    assert_eq!(
        key(&[("journal", "arXiv preprint arXiv:2005.14165")]).as_deref(),
        Some("2005.14165")
    );
    assert_eq!(key(&[("journal", "Nature")]), None);
}
