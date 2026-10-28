use super::*;

fn cite(text: &str, at: Option<&str>) -> String {
    cite_into(text, at, "smith2020", "main.tex").unwrap().text
}

#[test]
fn the_citation_goes_at_the_end_of_the_paragraph_and_nothing_else_moves() {
    let doc =
        "\\begin{document}\nFirst line of it\nsecond line.\n\nOther paragraph.\n\\end{document}\n";
    assert_eq!(
        cite(doc, Some("First line")),
        "\\begin{document}\nFirst line of it\nsecond line. \\cite{smith2020}\n\nOther paragraph.\n\\end{document}\n"
    );
    assert_eq!(
        cite(doc, Some("Other")),
        "\\begin{document}\nFirst line of it\nsecond line.\n\nOther paragraph. \\cite{smith2020}\n\\end{document}\n"
    );
    // No place named: the end of the file's text, inside the document.
    assert_eq!(
        cite(doc, None),
        "\\begin{document}\nFirst line of it\nsecond line.\n\nOther paragraph. \\cite{smith2020}\n\\end{document}\n"
    );
    assert_eq!(
        cite("Plain end\n\n\n", None),
        "Plain end \\cite{smith2020}\n\n\n"
    );
    assert_eq!(cite("(see~", None), "(see~\\cite{smith2020}");
}

#[test]
fn a_comment_after_the_text_stays_after_the_citation() {
    let doc = "Text here. % note\n% only a comment\n\nNext\n";
    assert_eq!(
        cite(doc, Some("Text")),
        "Text here. \\cite{smith2020} % note\n% only a comment\n\nNext\n"
    );
    let why = cite_into("A % hidden text\n", Some("hidden"), "k", "m.tex")
        .unwrap_err()
        .to_string();
    assert!(why.contains("in a comment"), "{why}");
    // An escaped percent is text.
    assert_eq!(cite("100\\% sure", None), "100\\% sure \\cite{smith2020}");
}

#[test]
fn blocks_end_a_paragraph_and_windows_line_breaks_stay() {
    let doc = "Intro text\n\\begin{itemize}\n\\item a\n\\end{itemize}\n";
    assert_eq!(
        cite(doc, Some("Intro")),
        "Intro text \\cite{smith2020}\n\\begin{itemize}\n\\item a\n\\end{itemize}\n"
    );
    let crlf = "One\r\ntwo\r\n\r\nThree\r\n";
    assert_eq!(
        cite(crlf, Some("One\ntwo")),
        "One\r\ntwo \\cite{smith2020}\r\n\r\nThree\r\n"
    );
}

#[test]
fn the_place_is_found_once_or_the_citation_is_refused() {
    let doc = "ab ab\n\nab\n";
    let why = cite_into(doc, Some("ab"), "k", "m.tex")
        .unwrap_err()
        .to_string();
    assert!(
        why.contains("3 times") && why.contains("matches once"),
        "{why}"
    );
    let why = cite_into(doc, Some("zzz"), "k", "m.tex")
        .unwrap_err()
        .to_string();
    assert!(why.contains("is not in m.tex"), "{why}");
    assert!(cite_into(doc, Some(" "), "k", "m.tex").is_err());
    assert!(cite_into("% nothing\n", None, "k", "m.tex").is_err());
    // A key that could break out of the braces is refused.
    for key in ["a}b", "a,b", "a b", "a\\input{x}", "a%b", ""] {
        assert!(cite_into(doc, None, key, "m.tex").is_err(), "{key}");
    }
}

#[test]
fn inside_a_citation_the_key_joins_the_list_as_in_the_editor() {
    assert_eq!(citation_text("see ", " now", "k"), "\\cite{k}");
    assert_eq!(citation_text("\\cite{", "}", "k"), "k");
    assert_eq!(citation_text("\\cite{a", "}", "k"), ",k");
    assert_eq!(citation_text("\\cite{a,", "}", "k"), "k");
    assert_eq!(citation_text("\\cite{", "b}", "k"), "k,");
    assert_eq!(citation_text("\\cite{", ",b}", "k"), "k");
    assert_eq!(citation_text("\\citep*[p. 3]{a", " }", "k"), ",k");
    assert_eq!(citation_text("\\parencite[a][b]{", "}", "k"), "k");
    // Not a citation, or not closed.
    assert_eq!(citation_text("\\label{", "}", "k"), "\\cite{k}");
    assert_eq!(citation_text("\\cite{a", "", "k"), "\\cite{k}");
    assert_eq!(citation_text("\\cite{a}", "}", "k"), "\\cite{k}");
}

#[test]
fn a_hostile_title_or_author_cannot_leave_its_entry() {
    let hostile = [
        "Evil} @article{pwn, title = {y",
        "Ends in a backslash \\",
        "{{{{ unclosed",
        "}} closed twice",
        "Line one\n@comment{\nline two",
        "quote\" and {braces} \\} done",
    ];
    for title in hostile {
        let fields = BTreeMap::from([
            ("title".to_owned(), title.to_owned()),
            ("author".to_owned(), "Smith, Jo".to_owned()),
            ("bad name".to_owned(), "dropped".to_owned()),
        ]);
        let entry = bib_entry("article", "smith2020", &fields, "\n").unwrap();
        let read = slides_bib::read(&entry);
        assert_eq!(read.len(), 1, "{title:?} -> {entry}");
        assert_eq!(read[0].key, "smith2020");
        assert_eq!(read[0].kind, "article");
        assert_eq!(
            read[0].fields.get("author").map(String::as_str),
            Some("Smith, Jo")
        );
        assert!(!read[0].fields.contains_key("bad name"));
        assert!(read[0].fields.len() <= 2, "{entry}");
        assert!(
            !entry.contains("@article{pwn") && !entry.contains("\n@comment"),
            "{entry}"
        );
    }
    // Balanced braces and escapes are kept as they are.
    let fields = BTreeMap::from([("title".to_owned(), "On {DNA} and \\{braces\\}".to_owned())]);
    let entry = bib_entry("book", "k1", &fields, "\r\n").unwrap();
    assert_eq!(
        entry,
        "@book{k1,\r\n  title = {On {DNA} and \\{braces\\}},\r\n}\r\n"
    );
    // A key that is not plain, and a type that is not one.
    assert!(bib_entry("article", "a}b", &fields, "\n").is_err());
    assert!(bib_entry("article", "a,b", &fields, "\n").is_err());
    assert!(
        bib_entry("comment", "k", &fields, "\n")
            .unwrap()
            .starts_with("@misc{k,")
    );
}

#[test]
fn a_key_is_found_in_a_bib_text_whatever_its_case() {
    let bib = "@article{Smith2020,\n  title = {T},\n}\n";
    assert!(bib_has_key(bib, "smith2020") && bib_has_key(bib, "Smith2020"));
    assert!(!bib_has_key(bib, "smith2021"));
    assert!(!bib_has_key("", "k"));
}
