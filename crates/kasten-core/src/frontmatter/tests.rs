use super::*;

#[test]
fn splits_after_the_closing_fence_and_keeps_every_byte() {
    let text = "---\r\ntitle: A\r\n---\r\nBody\r\n";
    let s = split(text);
    assert_eq!(s.prefix, "---\r\ntitle: A\r\n---\r\n");
    assert_eq!(s.body, "Body\r\n");
    for text in [
        "",
        "---",
        "---\n",
        "---\nx\n---\n---\n",
        "\u{feff}",
        "a\r\n---\r\n",
        "---\nnever closed\n",
    ] {
        let s = split(text);
        assert_eq!(format!("{}{}", s.prefix, s.body), text);
    }
}

#[test]
fn only_a_fence_at_the_very_top_opens_frontmatter() {
    assert_eq!(split("Intro\n---\nx: 1\n---\n").prefix, "");
    assert_eq!(
        split("---\nnotes: |\n  ---\n  still yaml\n---\nBody").body,
        "Body"
    );
    assert_eq!(
        split("\u{feff}---\nt: 1\n---\nB").prefix,
        "\u{feff}---\nt: 1\n---\n"
    );
    assert_eq!(split("---\nt: 1\n---").prefix, "---\nt: 1\n---");
}

#[test]
fn reads_every_key_as_json_for_readers_with_keys_of_their_own() {
    let prefix = "---\ntype: ai-action\nneeds: [selection, page]\nwhere:\n  - editor\nversion: 1\nnote: \"a: b\"\n---\n";
    let map = read_map(prefix).unwrap();
    assert_eq!(map["type"], "ai-action");
    assert_eq!(map["needs"], serde_json::json!(["selection", "page"]));
    assert_eq!(map["where"], serde_json::json!(["editor"]));
    assert_eq!(map["version"], 1);
    assert_eq!(map["note"], "a: b");
    // None, an empty block, and a block that is not a map.
    assert!(read_map("").unwrap().is_empty());
    assert!(read_map("---\n---\n").unwrap().is_empty());
    assert!(read_map("---\n- a\n- b\n---\n").is_err());
    assert!(read_map("---\nneeds: [a\n---\n").is_err());
}

#[test]
fn reads_known_keys_whatever_their_scalar_form() {
    let prefix = "---\nid: 01J8Z3K6Q2M4X7V9B1C5D8E0F2\ntitle: \"Diff: a \\\"study\\\"\"\ntype: page\nicon: bulb   # from the icon set\ntags: [idea, paper]\nprops:\n  title: nested, ignored\n---\n";
    let front = Front::read(prefix);
    assert_eq!(
        Front::text(&front.title).as_deref(),
        Some("Diff: a \"study\"")
    );
    assert_eq!(Front::text(&front.kind).as_deref(), Some("page"));
    assert_eq!(Front::text(&front.icon).as_deref(), Some("bulb"));
    assert_eq!(
        front.tags.map(|t| t.0),
        Some(vec!["idea".to_owned(), "paper".to_owned()])
    );

    let numeric = Front::read("---\ntitle: 2026\ntags: single\n---\n");
    assert_eq!(Front::text(&numeric.title).as_deref(), Some("2026"));
    assert_eq!(numeric.tags.map(|t| t.0), Some(vec!["single".to_owned()]));
}

#[test]
fn reads_broken_or_missing_frontmatter_as_empty() {
    assert_eq!(Front::read(""), Front::default());
    assert_eq!(Front::read("---\n---\n"), Front::default());
    assert_eq!(
        Front::read("---\ntitle: [unclosed\n---\n"),
        Front::default()
    );
}

#[test]
fn quotes_only_what_yaml_would_misread() {
    assert_eq!(yaml_scalar("Welcome to Kasten"), "Welcome to Kasten");
    assert_eq!(yaml_scalar("💡"), "💡");
    assert_eq!(yaml_scalar("a: b"), "\"a: b\"");
    assert_eq!(yaml_scalar("null"), "\"null\"");
    assert_eq!(yaml_scalar("1.5"), "\"1.5\"");
    assert_eq!(yaml_scalar(""), "\"\"");
    assert_eq!(yaml_scalar("say \"hi\""), "say \"hi\"");
    assert_eq!(yaml_scalar("- dash"), "\"- dash\"");
}

#[test]
fn values_read_back_the_same() {
    for value in [
        "plain",
        "a: b",
        " lead",
        "#hash",
        "true",
        "💡",
        "say \"hi\"",
        "back\\slash",
        "- dash",
        "it's",
        "1.5",
        "tab\there",
    ] {
        let prefix = set_key("", "title", Some(value), "\n");
        assert_eq!(
            Front::text(&Front::read(&prefix).title).as_deref(),
            Some(value.trim()),
            "{value:?} as {prefix:?}"
        );
    }
}

#[test]
fn flow_values_read_back_the_same() {
    // Inside `[…]` or `{…}`, a comma or bracket ends a plain value.
    assert_eq!(yaml_flow_scalar("sources/paper.pdf"), "sources/paper.pdf");
    assert_eq!(yaml_flow_scalar("a, b"), "\"a, b\"");
    assert_eq!(yaml_flow_scalar("draft {final}"), "\"draft {final}\"");
    let tags = [
        "travel",
        "a, b",
        "[x]",
        "{y}",
        "c]",
        "d: e",
        "#f",
        "plain words",
    ];
    let items: Vec<String> = tags.iter().map(|t| t.to_string()).collect();
    let prefix = set_key_raw("", "tags", Some(&yaml_list(&items)), "\n");
    let read = Front::read(&prefix).tags.map(|t| t.0);
    assert_eq!(read, Some(items.clone()), "{prefix:?}");
}

#[test]
fn renames_a_key_in_its_place() {
    let prefix = "---\ntags: [a]\ntype: trip   # mine\nlist:\n  - x\n---\n";
    assert_eq!(
        rename_key(prefix, "type", "note-type"),
        "---\ntags: [a]\nnote-type: trip   # mine\nlist:\n  - x\n---\n"
    );
    assert_eq!(
        rename_key(prefix, "list", "items"),
        "---\ntags: [a]\ntype: trip   # mine\nitems:\n  - x\n---\n"
    );
    assert_eq!(rename_key(prefix, "typ", "x"), prefix);
    assert_eq!(rename_key("", "type", "x"), "");
}

#[test]
fn tells_frontmatter_that_reads_from_what_does_not() {
    assert!(yaml_ok(""));
    assert!(yaml_ok("---\n---\n"));
    assert!(yaml_ok("---\ntitle: A\ntags: [a, b]\n---\n"));
    assert!(!yaml_ok("---\ntitle: [unclosed\n---\n"));
    assert!(!yaml_ok("---\n- a list\n---\n"));
    assert!(!yaml_ok("---\njust text\n---\n"));
}

#[test]
fn rewrites_only_the_changed_line() {
    let prefix = "---\nid: 1\ntitle: Old  title\nicon: bulb        # from the icon set\nunknown:   {kept: exactly}\n---\n";
    assert_eq!(
        set_key(prefix, "title", Some("New"), "\n"),
        prefix.replace("title: Old  title", "title: New")
    );
    assert_eq!(
        set_key(prefix, "icon", Some("💡"), "\n"),
        prefix.replace("icon: bulb ", "icon: 💡 ")
    );
    let added = set_key(prefix, "cover", Some("gradient-dawn"), "\n");
    assert_eq!(
        added,
        prefix.replace("exactly}\n---", "exactly}\ncover: gradient-dawn\n---")
    );
    assert_eq!(set_key(&added, "cover", None, "\n"), prefix);
}

#[test]
fn keeps_line_endings_and_replaces_block_scalars_whole() {
    assert_eq!(
        set_key("---\r\ntitle: A\r\n---\r\n", "title", Some("B"), "\n"),
        "---\r\ntitle: B\r\n---\r\n"
    );
    assert_eq!(
        set_key(
            "---\ntitle: |\n  Two\n  lines\nid: 2\n---\n",
            "title",
            Some("One"),
            "\n"
        ),
        "---\ntitle: One\nid: 2\n---\n"
    );
    assert_eq!(
        set_key("\u{feff}", "icon", Some("📝"), "\r\n"),
        "\u{feff}---\r\nicon: 📝\r\n---\r\n"
    );
    assert_eq!(set_key("", "icon", None, "\n"), "");
    assert_eq!(
        set_key("---\nt: 1\n---", "x", Some("z"), "\n"),
        "---\nt: 1\nx: z\n---"
    );
}

#[test]
fn does_not_mistake_a_longer_key_or_a_nested_one() {
    let prefix = "---\ntitles: many\nprops:\n  title: nested\n---\n";
    assert_eq!(
        set_key(prefix, "title", Some("Top"), "\n"),
        "---\ntitles: many\nprops:\n  title: nested\ntitle: Top\n---\n"
    );
}

#[test]
fn a_list_at_the_keys_own_indent_is_part_of_its_value() {
    let prefix = "---\nid: X\ntitle: T\ntags:\n- a\n- b\n---\n";
    assert_eq!(
        set_key_raw(prefix, "tags", Some("[a, c]"), "\n"),
        "---\nid: X\ntitle: T\ntags: [a, c]\n---\n"
    );
    assert_eq!(
        set_key_raw(prefix, "tags", None, "\n"),
        "---\nid: X\ntitle: T\n---\n"
    );
    // Items after a blank line still belong to it; the next key does not.
    let spaced = "---\ntags:\n- a\n\n-\n  b\ntitle: T\n---\n";
    assert_eq!(
        set_key_raw(spaced, "tags", Some("[c]"), "\n"),
        "---\ntags: [c]\ntitle: T\n---\n"
    );
    // A key with a value on its own line keeps the lines below it.
    let inline = "---\ntags: [a]\n- stray\n---\n";
    assert_eq!(
        set_key_raw(inline, "tags", Some("[b]"), "\n"),
        "---\ntags: [b]\n- stray\n---\n"
    );
}

#[test]
fn joining_gives_a_bare_closing_fence_its_line_end() {
    assert_eq!(
        join("---\ntitle: T\n---", "Hello\n", "\n"),
        "---\ntitle: T\n---\nHello\n"
    );
    assert_eq!(
        join("---\r\ntitle: T\r\n---", "Hello\r\n", "\r\n"),
        "---\r\ntitle: T\r\n---\r\nHello\r\n"
    );
    assert_eq!(
        join("---\ntitle: T\n---\n", "Hello\n", "\n"),
        "---\ntitle: T\n---\nHello\n"
    );
    assert_eq!(join("\u{feff}", "Hello\n", "\n"), "\u{feff}Hello\n");
    assert_eq!(join("", "Hello\n", "\n"), "Hello\n");
    assert_eq!(join("---\ntitle: T\n---", "", "\n"), "---\ntitle: T\n---");
}

#[test]
fn a_body_under_no_frontmatter_never_reads_as_frontmatter() {
    // A rule on the first line with another below would open frontmatter,
    // so the first is written `***`, the same rule in Markdown.
    let body = "---\nIntro\n\n---\nMore\n";
    assert_eq!(join("", body, "\n"), "***\nIntro\n\n---\nMore\n");
    assert_eq!(
        join("\u{feff}", "--- \r\nA\r\n---\r\n", "\r\n"),
        "\u{feff}*** \r\nA\r\n---\r\n"
    );
    assert_eq!(split(&join("", body, "\n")).prefix, "");
    assert_eq!(body_under("", body), "***\nIntro\n\n---\nMore\n");
    // A rule with none below, or a body under real frontmatter, stays as it is.
    assert_eq!(join("", "---\nIntro\n", "\n"), "---\nIntro\n");
    assert_eq!(join("", "----\nA\n---\n", "\n"), "----\nA\n---\n");
    assert_eq!(join("", "\u{feff}A\n---\n", "\n"), "\u{feff}A\n---\n");
    assert_eq!(
        join("---\ntitle: T\n---\n", body, "\n"),
        format!("---\ntitle: T\n---\n{body}")
    );
}

#[test]
fn an_edit_that_would_break_the_yaml_is_refused() {
    let good = "---\ntitle: T\n---\n";
    assert!(still_readable(good, "---\ntitle: U\n---\n").is_ok());
    assert!(still_readable(good, "---\ntitle: [\n---\n").is_err());
    // Frontmatter that was already broken is not made anyone's problem.
    assert!(still_readable("---\ntitle: [\n---\n", "---\ntitle: [\nupdated: x\n---\n").is_ok());
}

#[test]
fn every_scalar_reads_back_as_the_string_it_was() {
    let values = [
        "y",
        "Y",
        "n",
        "N",
        "yes",
        "No",
        "on",
        "OFF",
        "true",
        "null",
        "Null",
        "~",
        "0x1F",
        "0o7",
        "0b1",
        "+.inf",
        "-.inf",
        ".NaN",
        "1e3",
        "12",
        "-3.5",
        "1_000",
        "12:30",
        "2024-01-01",
        "a\u{1}b",
        "a\u{7f}b",
        "a\u{85}b",
        "a\u{9f}b",
        "a\u{2028}b",
        "\u{feff}x",
        "x\u{fffe}",
        "-",
        "- x",
        "x: y",
        "#x",
        "@x",
        "`x",
        "%x",
        "!x",
        "&x",
        "*x",
        "|",
        ">",
        "'x",
        "\"x",
        " x",
        "x ",
        "",
        "a #b",
        "a:",
        "a\tb",
        "a\nb",
        "Café",
        "日本語",
        "🙂",
    ];
    let wrong: Vec<String> = values
        .into_iter()
        .filter_map(|value| {
            let yaml = format!(
                "k: {}\nl: [{}]\n",
                yaml_scalar(value),
                yaml_flow_scalar(value)
            );
            let read = serde_saphyr::from_str::<serde_json::Value>(&yaml);
            let same = read.as_ref().is_ok_and(|read| {
                read["k"] == serde_json::json!(value) && read["l"][0] == serde_json::json!(value)
            });
            (!same).then(|| format!("{value:?} as {yaml:?}: {read:?}"))
        })
        .collect();
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}
