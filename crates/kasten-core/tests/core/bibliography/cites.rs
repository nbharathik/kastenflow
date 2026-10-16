//! Pandoc citations in pages: what counts as one, and what does not.

use kasten_core::cite::{citations, count_of, keys_in, rename_in};

fn found(text: &str) -> Vec<&str> {
    citations(text).into_iter().map(|c| &text[c.key]).collect()
}

#[test]
fn the_forms_pandoc_writes_are_citations() {
    for (text, keys) in [
        ("[@a]", vec!["a"]),
        ("see [@a, p. 4] here", vec!["a"]),
        ("[see @a; @b]", vec!["a", "b"]),
        ("[@a;@b]", vec!["a", "b"]),
        ("[-@a]", vec!["a"]),
        ("[see -@a and @b, ch. 2]", vec!["a", "b"]),
        ("one [@a] and two [@b].", vec!["a", "b"]),
        ("[@a] [@a]", vec!["a", "a"]),
        ("[@vaswani2017attention]", vec!["vaswani2017attention"]),
        ("[@knuth:1984]", vec!["knuth:1984"]),
        ("[@smith2020/a+b_c-d.e]", vec!["smith2020/a+b_c-d.e"]),
        ("[@müller2020]", vec!["müller2020"]),
        ("[@_private]", vec!["_private"]),
        ("[@a.]", vec!["a"]),
        ("[@a:]", vec!["a"]),
        ("[@a-]", vec!["a"]),
        ("a\n[@a]\nb [@b]\n", vec!["a", "b"]),
    ] {
        assert_eq!(found(text), keys, "{text:?}");
    }
}

#[test]
fn addresses_links_code_and_escapes_are_not() {
    for text in [
        "write to a@b.com",
        "[write to a@b.com]",
        "[see https://x.org/@user]",
        "[user@host]",
        "[[@a]]",
        "![[@a]]",
        "[@a](https://example.org)",
        "[the paper @a](https://example.org)",
        "[@a][ref]",
        "[@a]: https://example.org",
        "\\[@a]",
        "`[@a]`",
        "``[@a]``",
        "[x `@a` y]",
        "```\n[@a]\n```",
        "~~~rust\n[@a]\n~~~",
        "---\ntags: [@a]\n---\nbody",
        "@a without brackets",
        "[@]",
        "[ @ ]",
        "- [ ] call @bob",
        "[a @",
        "[@a",
        "plain [text] with no cite",
    ] {
        assert_eq!(found(text), Vec::<&str>::new(), "{text:?}");
    }
}

#[test]
fn text_around_code_is_still_read() {
    let text = "```\n[@in_fence]\n```\nafter [@outside] and `[@span]` and [@second]\n";
    assert_eq!(found(text), ["outside", "second"]);
    assert_eq!(keys_in(text), ["outside", "second"]);
}

#[test]
fn a_link_is_skipped_but_a_citation_after_it_is_read() {
    assert_eq!(
        found("[see](http://x.org) and [@a] then [more @b](http://y.org) [@c]"),
        ["a", "c"]
    );
}

#[test]
fn counting_and_listing_follow_the_scanner() {
    let text = "[@a] [see @b; @a] `[@a]`\n\n[@a, p. 3]";
    assert_eq!(count_of(text, "a"), 3);
    assert_eq!(count_of(text, "b"), 1);
    assert_eq!(count_of(text, "ab"), 0);
    assert_eq!(keys_in(text), ["a", "b"]);
}

#[test]
fn renaming_changes_the_bytes_of_the_key_and_nothing_else() {
    let text = "---\nid: 01\ntags: [@a]\n---\nSee [@a, p. 4] and [see @b; @a].\n`[@a]` and [@ab] and [@a](x).\r\n";
    let (renamed, n) = rename_in(text, "a", "longer-key2");
    assert_eq!(n, 2);
    assert_eq!(
        renamed,
        "---\nid: 01\ntags: [@a]\n---\nSee [@longer-key2, p. 4] and [see @b; @longer-key2].\n`[@a]` and [@ab] and [@a](x).\r\n"
    );
    let (same, none) = rename_in("nothing [@b]", "a", "c");
    assert_eq!((same.as_str(), none), ("nothing [@b]", 0));
}

#[test]
fn hostile_text_does_not_panic() {
    let long = format!("[{}]", "@a ".repeat(5_000));
    let deep = format!("{}@a{}", "[".repeat(10_000), "]".repeat(10_000));
    for text in [
        "[".repeat(100_000),
        "]".repeat(100_000),
        long,
        deep,
        "[@é\u{0}".to_owned(),
        "\\".repeat(1000),
        "[@a](".to_owned(),
        "`".repeat(5000),
    ] {
        let _ = citations(&text);
    }
}
