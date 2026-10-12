use super::*;

fn spec(query: &str) -> FindSpec {
    FindSpec {
        query: query.to_owned(),
        match_case: false,
        whole_word: false,
    }
}

fn exact(query: &str) -> FindSpec {
    FindSpec {
        match_case: true,
        ..spec(query)
    }
}

fn word(query: &str) -> FindSpec {
    FindSpec {
        whole_word: true,
        ..spec(query)
    }
}

fn count(body: &str, spec: &FindSpec) -> usize {
    find_in_body(body, spec).len()
}

fn replaced(body: &str, spec: &FindSpec, with: &str) -> String {
    replace_in_body(body, spec, with).unwrap().0
}

#[test]
fn matches_with_or_without_case_in_any_script() {
    let body = "Straße straße STRASSE\nÄrger ärger ÄRGER\nİ i\n";
    assert_eq!(count(body, &spec("straße")), 2);
    assert_eq!(count(body, &exact("straße")), 1);
    assert_eq!(count(body, &exact("Straße")), 1);
    assert_eq!(count(body, &spec("ärger")), 3);
    assert_eq!(count(body, &exact("ärger")), 1);
    // Matched text is kept as written when read back.
    let found = find_in_body(body, &spec("ärger"));
    let text: Vec<&str> = found.iter().map(|f| &body[f.start..f.end]).collect();
    assert_eq!(text, ["Ärger", "ärger", "ÄRGER"]);
}

#[test]
fn whole_word_means_no_letter_digit_or_underscore_beside() {
    let body = "cat cat_1 cat2 concat cats (cat) cat. Cat-like\n";
    assert_eq!(count(body, &spec("cat")), 8);
    assert_eq!(
        count(body, &word("cat")),
        4,
        "cat, (cat), cat. and Cat-like"
    );
    assert_eq!(
        count(
            body,
            &FindSpec {
                match_case: true,
                ..word("cat")
            }
        ),
        3
    );
    // Letters beyond ASCII are letters.
    let body = "Ärger Ärgerlich ärger_ ÄÄrger über überall\n";
    assert_eq!(count(body, &word("ärger")), 1);
    assert_eq!(count(body, &word("über")), 1);
    // A mark that follows a letter belongs to it.
    assert_eq!(count("cafe\u{301} cafe", &word("cafe")), 1);
}

#[test]
fn matches_do_not_overlap_and_never_cross_lines() {
    assert_eq!(count("aaaa", &spec("aa")), 2);
    assert_eq!(replaced("aaaaa", &spec("aa"), "b"), "bba");
    assert_eq!(count("foo\nbar", &spec("foo bar")), 0);
    assert_eq!(count("anything", &spec("zzz")), 0);
}

#[test]
fn skips_what_is_not_prose_but_matches_text_between_tags() {
    let body = "\
plain foo here
see [[foo]] and [[foo|foo alias]] and ![[foo]]
a [foo](https://foo.example/foo \"foo title\") link
an ![foo](foo.png) picture
auto <https://foo.example> and <me@foo.example> done
<a href=\"foo\">foo</a> html
<details>
<summary>foo title</summary>

visit https://foo.example/foo now, foo
[foo]: https://foo.example/foo
[^1]: foo note
> [!tip] foo callout
- [ ] foo task
";
    let found = find_in_body(body, &spec("foo"));
    let lines: Vec<usize> = found.iter().map(|f| f.line).collect();
    // Line 0 once, line 2 (the link text), line 3 (the alt text), line 5 (text
    // between tags), line 7 (summary), line 9 (after the address), footnote,
    // callout and to-do.
    assert_eq!(lines, [0, 2, 3, 5, 7, 9, 11, 12, 13], "{found:?}");
    let new = replaced(body, &spec("foo"), "BAR");
    assert!(new.contains("see [[foo]] and [[foo|foo alias]] and ![[foo]]\n"));
    assert!(new.contains("a [BAR](https://foo.example/foo \"foo title\") link\n"));
    assert!(new.contains("an ![BAR](foo.png) picture\n"));
    assert!(new.contains("auto <https://foo.example> and <me@foo.example> done\n"));
    assert!(new.contains("<a href=\"foo\">BAR</a> html\n"));
    assert!(new.contains("<summary>BAR title</summary>\n"));
    assert!(new.contains("visit https://foo.example/foo now, BAR\n"));
    assert!(new.contains("[foo]: https://foo.example/foo\n"));
    assert!(new.contains("[^1]: BAR note\n"));
    assert!(new.contains("> [!tip] BAR callout\n"));
    assert!(new.contains("- [ ] BAR task\n"));
    assert!(new.starts_with("plain BAR here\n"));
}

#[test]
fn a_match_that_reaches_into_a_protected_span_is_not_one() {
    assert_eq!(count("see [[foo bar]] now", &spec("see [[foo")), 0);
    assert_eq!(count("a [x](url) b", &spec("x](url)")), 0);
    assert_eq!(count("a <b>x</b>", &spec("<b>x")), 0);
    // A match on either side of one is fine.
    assert_eq!(count("foo [[foo]] foo", &spec("foo")), 2);
    // Reference labels and tags with quotes holding a `>`.
    assert_eq!(count("[a][foo] and foo", &spec("foo")), 1);
    assert_eq!(count("<a title=\"x > foo\">foo</a>", &spec("foo")), 1);
    // Escaped brackets are text; an unclosed `[[` is text.
    assert_eq!(count("a \\[[foo]] b", &spec("foo")), 1);
    assert_eq!(count("a [[foo and foo", &spec("foo")), 2);
    // A comment, over lines.
    assert_eq!(count("<!-- foo\nstill foo\n--> foo", &spec("foo")), 1);
    assert_eq!(count("<!-- foo --> foo", &spec("foo")), 1);
}

#[test]
fn code_is_matched_and_gets_the_text_raw_prose_gets_it_escaped() {
    let body = "prose foo and `foo` and ``a ` foo``\n\n```rust\nlet foo = 1;\n```\n\nafter foo\n";
    assert_eq!(count(body, &spec("foo")), 5);
    let raw = "a*b_c [x] <y> | ~ $ \\";
    let escaped = "a\\*b_c \\[x\\] \\<y\\> \\| \\~ \\$ \\\\";
    let new = replaced(body, &spec("foo"), raw);
    assert!(
        new.starts_with(&format!("prose {escaped} and `{raw}` and ``a ` {raw}``\n")),
        "{new}"
    );
    assert!(
        new.contains(&format!("```rust\nlet {raw} = 1;\n```\n")),
        "{new}"
    );
    assert!(new.ends_with(&format!("after {escaped}\n")), "{new}");
    // The fence lines themselves, and a language name, are left alone.
    assert_eq!(count("```foo\nx\n```\n", &spec("foo")), 0);
    // An opened fence runs to the end.
    assert_eq!(count("```\nfoo\nfoo", &spec("foo")), 2);
    // A tilde fence, and backticks in a longer fence.
    assert_eq!(count("~~~\nfoo\n~~~\nfoo", &spec("foo")), 2);
    assert_eq!(count("````\n```\nfoo\n````\nfoo", &spec("foo")), 2);
}

#[test]
fn an_underscore_inside_a_word_needs_no_escape() {
    assert_eq!(
        replaced("x", &spec("x"), "snake_case_name"),
        "snake_case_name"
    );
    assert_eq!(replaced("x", &spec("x"), "_lead"), "\\_lead");
    assert_eq!(replaced("x", &spec("x"), "trail_"), "trail\\_");
    assert_eq!(replaced("x", &spec("x"), "a _b_ c"), "a \\_b\\_ c");
    // An ampersand only when it would start an entity.
    assert_eq!(replaced("x", &spec("x"), "AT&T"), "AT&T");
    assert_eq!(replaced("x", &spec("x"), "a &amp; b"), "a \\&amp; b");
    assert_eq!(replaced("x", &spec("x"), "&#35; b"), "\\&#35; b");
}

#[test]
fn text_that_would_start_a_block_is_escaped_at_the_start_of_a_line() {
    assert_eq!(
        replaced("old rest\n", &spec("old"), "# New"),
        "\\# New rest\n"
    );
    assert_eq!(
        replaced("old rest\n", &spec("old"), "- New"),
        "\\- New rest\n"
    );
    assert_eq!(
        replaced("old rest\n", &spec("old"), "+ New"),
        "\\+ New rest\n"
    );
    assert_eq!(
        replaced("old rest\n", &spec("old"), "1. New"),
        "1\\. New rest\n"
    );
    assert_eq!(
        replaced("old rest\n", &spec("old"), "12) New"),
        "12\\) New rest\n"
    );
    assert_eq!(
        replaced("  old rest\n", &spec("old"), "# New"),
        "  \\# New rest\n"
    );
    assert_eq!(
        replaced("> old rest\n", &spec("old"), "# New"),
        "> \\# New rest\n"
    );
    assert_eq!(
        replaced("- old rest\n", &spec("old"), "# New"),
        "- \\# New rest\n"
    );
    assert_eq!(
        replaced("2. old rest\n", &spec("old"), "- New"),
        "2. \\- New rest\n"
    );
    // Not at the start: nothing to escape.
    assert_eq!(replaced("a old\n", &spec("old"), "# New"), "a # New\n");
    assert_eq!(replaced("a old\n", &spec("old"), "1. New"), "a 1. New\n");
    // A number that is not a list marker.
    assert_eq!(replaced("old\n", &spec("old"), "2026 New"), "2026 New\n");
}

#[test]
fn text_between_tags_is_escaped_as_html() {
    let body = "<details>\n<summary>Old title</summary>\n\nOld body\n";
    let new = replaced(body, &spec("old"), "a < b & c &amp; *d*");
    // In the HTML block the text is HTML: `<`, `>` and entities are
    // escaped, Markdown marks are not. Below it, the text is Markdown.
    assert_eq!(
        new,
        "<details>\n<summary>a &lt; b & c &amp;amp; *d* title</summary>\n\na \\< b & c \\&amp; \\*d\\* body\n"
    );
}

#[test]
fn a_replacement_that_would_break_code_is_refused() {
    let err = replace_in_body("a `foo` b", &spec("foo"), "x`y").unwrap_err();
    assert!(err.to_string().contains("backtick"), "{err}");
    // In prose a backtick is only escaped.
    assert_eq!(replaced("a foo b", &spec("foo"), "x`y"), "a x\\`y b");
    let err = replace_in_body("```\nfoo\n```\n", &spec("foo"), "```").unwrap_err();
    assert!(err.to_string().contains("fence"), "{err}");
    assert_eq!(
        replaced("```\na foo\n```\n", &spec("foo"), "```"),
        "```\na ```\n```\n"
    );
}

#[test]
fn line_endings_and_everything_else_stay_byte_for_byte() {
    let body = "\u{feff}Old one\r\nkeep  \r\n\r\nOld two  \r\n\tOld three\r\nlast Old";
    let new = replaced(body, &spec("old"), "New");
    assert_eq!(
        new,
        "\u{feff}New one\r\nkeep  \r\n\r\nNew two  \r\n\tNew three\r\nlast New"
    );
    // Nothing found: the same text back.
    assert_eq!(replaced(body, &spec("absent"), "New"), body);
    // An empty replacement deletes.
    assert_eq!(replaced("a foo b\n", &spec(" foo"), ""), "a b\n");
}

#[test]
fn counts_and_samples_show_the_text_around_each_match() {
    let body =
        "first line\nthe quick brown fox jumps over the lazy dog and more words after it\nfox\n";
    let found = find_in_body(body, &spec("fox"));
    assert_eq!(found.len(), 2);
    let samples = samples_of(body, &found, 5);
    assert_eq!(samples.len(), 2);
    assert_eq!(samples[0].line, 1);
    assert_eq!(samples[0].text, "fox");
    assert_eq!(samples[0].before, "the quick brown ");
    assert!(samples[0].after.starts_with(" jumps over the lazy dog"));
    assert!(samples[0].after.chars().count() <= 40);
    assert_eq!(samples[1].line, 2);
    assert_eq!(
        (samples[1].before.as_str(), samples[1].after.as_str()),
        ("", "")
    );
    assert_eq!(samples_of(body, &found, 1).len(), 1);
}

#[test]
fn page_titles_are_matched_with_the_same_options() {
    assert!(title_matches("Photo organiser", &spec("ORGANISER")));
    assert!(!title_matches("Photo organiser", &exact("ORGANISER")));
    assert!(!title_matches("Photo organisers", &word("organiser")));
    assert!(title_matches("Photo organiser", &word("organiser")));
}

#[test]
fn checks_the_search_and_replacement_text() {
    assert!(spec("a").check().is_ok());
    assert!(spec(&"x".repeat(200)).check().is_ok());
    let long = "x".repeat(201);
    for bad in [
        "",
        long.as_str(),
        "a\nb",
        "a\rb",
        "a\tb",
        "a\u{0}b",
        "a\u{7f}b",
    ] {
        assert!(spec(bad).check().is_err(), "{bad:?}");
    }
    assert!(check_with("").is_ok());
    assert!(check_with(&"y".repeat(1000)).is_ok());
    let long = "y".repeat(1001);
    for bad in [long.as_str(), "a\nb", "a\r\nb", "a\tb", "a\u{1b}b"] {
        assert!(check_with(bad).is_err(), "{bad:?}");
    }
    // Long in letters, not in bytes.
    assert!(spec(&"é".repeat(200)).check().is_ok());
    assert!(check_with(&"é".repeat(1000)).is_ok());
}
