use super::*;

fn words(block: &Block) -> String {
    match block {
        Block::Heading { runs, .. }
        | Block::Paragraph { runs }
        | Block::Item { runs, .. }
        | Block::Quote { runs, .. } => plain(runs),
        other => panic!("not a block of words: {other:?}"),
    }
}

#[test]
fn frontmatter_is_taken_off_the_top_and_nothing_else() {
    let page = "---\nid: 01\ntitle: Plan\n---\nBody line.\n";
    assert_eq!(strip_frontmatter(page), "Body line.\n");
    assert_eq!(
        strip_frontmatter("\u{feff}---\r\nx: 1\r\n---\r\nBody"),
        "Body"
    );
    // Not closed, or not at the top: it is the page's own words.
    assert_eq!(strip_frontmatter("---\nno end\n"), "---\nno end\n");
    assert_eq!(
        strip_frontmatter("Words\n---\nmore\n---\n"),
        "Words\n---\nmore\n---\n"
    );
    assert_eq!(strip_frontmatter(""), "");
}

#[test]
fn headings_and_paragraphs_are_blocks_and_a_soft_wrap_is_a_space() {
    let found = blocks(
        "# One\n\nKasten keeps pages in\nyour own folder.\n\n## Two ##\n\nA hard  \nbreak.\n",
    );
    assert_eq!(found.len(), 4);
    assert!(matches!(&found[0], Block::Heading { level: 1, .. }));
    assert_eq!(words(&found[0]), "One");
    assert_eq!(words(&found[1]), "Kasten keeps pages in your own folder.");
    assert!(matches!(&found[2], Block::Heading { level: 2, .. }));
    assert_eq!(words(&found[2]), "Two");
    assert_eq!(words(&found[3]), "A hard\nbreak.");
    // A `#` that is part of a word is no closing mark.
    assert_eq!(words(&blocks("## Learning C#\n")[0]), "Learning C#");
    // Seven hashes, or none of a space after them, are words.
    assert!(matches!(
        &blocks("####### no\n#nope\n")[0],
        Block::Paragraph { .. }
    ));
}

#[test]
fn lists_keep_their_kind_their_level_and_their_ticks() {
    let found = blocks(
        "- one\n  - nested\n    - deeper\n- two\n\n1. first\n2. second\n\n- [ ] to do\n- [x] done\n",
    );
    let shape: Vec<(u8, bool, Option<bool>, String)> = found
        .iter()
        .map(|b| match b {
            Block::Item {
                level,
                ordered,
                checked,
                runs,
            } => (*level, *ordered, *checked, plain(runs)),
            other => panic!("{other:?}"),
        })
        .collect();
    assert_eq!(
        shape,
        [
            (0, false, None, "one".to_owned()),
            (1, false, None, "nested".to_owned()),
            (2, false, None, "deeper".to_owned()),
            (0, false, None, "two".to_owned()),
            (0, true, None, "first".to_owned()),
            (0, true, None, "second".to_owned()),
            (0, false, Some(false), "to do".to_owned()),
            (0, false, Some(true), "done".to_owned()),
        ]
    );
}

#[test]
fn a_deeper_item_is_a_level_down_whatever_the_width_of_its_indent() {
    let found = blocks("- a\n    - b\n        - c\n    - d\n- e\n");
    let levels: Vec<u8> = found
        .iter()
        .map(|b| match b {
            Block::Item { level, .. } => *level,
            other => panic!("{other:?}"),
        })
        .collect();
    assert_eq!(levels, [0, 1, 2, 1, 0]);
}

#[test]
fn an_item_runs_on_over_lines_that_are_not_a_block_of_their_own() {
    let found = blocks("- first line\n  carried on\n- second\n");
    assert_eq!(found.len(), 2);
    assert_eq!(words(&found[0]), "first line carried on");
}

#[test]
fn quotes_and_callouts_are_told_apart_and_a_callout_names_its_kind() {
    let found = blocks(
        "> [!tip]\n> **Ctrl+K** finds any page.\n\n> Quotes stay quotes.\n\n> [!note] Callouts\n> Click the icon.\n",
    );
    assert_eq!(found.len(), 4);
    let Block::Quote { callout, runs } = &found[0] else {
        panic!("a quote")
    };
    assert_eq!(callout.as_deref(), Some("tip"));
    assert_eq!(plain(runs), "Ctrl+K finds any page.");
    assert!(runs[0].bold);
    let Block::Quote { callout, .. } = &found[1] else {
        panic!("a quote")
    };
    assert_eq!(*callout, None);
    // A title on the marker line is a bold line of its own, and the body follows.
    let Block::Quote { callout, runs } = &found[2] else {
        panic!("a quote")
    };
    assert_eq!(
        (callout.as_deref(), plain(runs)),
        (Some("note"), "Callouts".to_owned())
    );
    assert!(runs.iter().all(|r| r.bold));
    assert_eq!(words(&found[3]), "Click the icon.");
}

#[test]
fn code_math_pictures_tables_and_rules_are_blocks_of_their_own() {
    let found = blocks(
        "```rust\nfn main() {\n    // # not a heading\n}\n```\n\n$$\n\\sum_k k\n$$\n\n$$x^2$$\n\n![A cat](assets/cat.png \"title\")\n\n| a | b |\n|---|:-:|\n| 1 | **2** |\n| 3 |\n\n---\n",
    );
    assert_eq!(found.len(), 6, "{found:#?}");
    assert_eq!(
        found[0],
        Block::Code {
            language: "rust".to_owned(),
            code: "fn main() {\n    // # not a heading\n}".to_owned()
        }
    );
    assert_eq!(
        found[1],
        Block::Math {
            latex: "\\sum_k k".to_owned()
        }
    );
    assert_eq!(
        found[2],
        Block::Math {
            latex: "x^2".to_owned()
        }
    );
    assert_eq!(
        found[3],
        Block::Image {
            src: "assets/cat.png".to_owned(),
            alt: "A cat".to_owned()
        }
    );
    let Block::Table { header, rows } = &found[4] else {
        panic!("a table")
    };
    assert!(*header);
    assert_eq!(rows.len(), 3);
    assert_eq!(plain(&rows[0][0]), "a");
    assert!(rows[1][1][0].bold);
    assert_eq!(
        rows[2].len(),
        2,
        "a short row is filled out to the header's width"
    );
    assert_eq!(found[5], Block::Rule);
}

#[test]
fn a_picture_among_words_is_not_a_block_of_its_own() {
    let found = blocks("See ![x](a.png) here.\n\n![x](a.png) and more\n");
    assert!(found.iter().all(|b| matches!(b, Block::Paragraph { .. })));
}

#[test]
fn wiki_links_become_links_to_a_page_and_pictures_in_double_brackets_are_pictures() {
    let found = blocks(
        "See [[Duplicate score|a worked example]] and [[Plan#Risks]].\n\n![[figure one.png]]\n",
    );
    let Block::Paragraph { runs } = &found[0] else {
        panic!("words")
    };
    let links: Vec<(&str, &str)> = runs
        .iter()
        .filter_map(|r| r.link.as_deref().map(|l| (r.t.as_str(), l)))
        .collect();
    assert_eq!(
        links,
        [
            ("a worked example", "page:Duplicate%20score"),
            ("Plan \u{203a} Risks", "page:Plan#Risks")
        ]
    );
    assert_eq!(
        found[1],
        Block::Image {
            src: "figure one.png".to_owned(),
            alt: String::new()
        }
    );
}

#[test]
fn html_that_pages_hold_is_dropped_but_its_words_stay() {
    let found = blocks(
        "Text can be <span style=\"color: red\">red</span> or <u>underlined</u>.<br>Next.\n\n<details>\n<summary>Writing</summary>\n\n- inside\n\n</details>\n",
    );
    assert_eq!(words(&found[0]), "Text can be red or underlined.\nNext.");
    assert!(found[0].clone() != Block::Rule);
    // The toggle's name is a bold line, and what is inside it stays.
    assert_eq!(found.len(), 3);
    let Block::Paragraph { runs } = &found[1] else {
        panic!("words")
    };
    assert!(plain(runs) == "Writing" && runs[0].bold);
    assert_eq!(words(&found[2]), "inside");
}

#[test]
fn code_spans_are_left_as_they_are() {
    let found = blocks("Type `[[x]]` and `<span>` for nothing.\n");
    assert_eq!(words(&found[0]), "Type [[x]] and <span> for nothing.");
}

#[test]
fn sections_run_to_the_next_heading_at_their_level_or_above() {
    let page = "---\ntitle: T\n---\nIntro.\n\n# Top\n\nWords.\n\n## Part A\n\nA.\n\n### Deep\n\nD.\n\n## Part B\n\nB.\n\n```\n# not a heading\n```\n";
    let all = sections(page);
    let names: Vec<(&str, u8)> = all.iter().map(|s| (s.title.as_str(), s.level)).collect();
    assert_eq!(
        names,
        [("Top", 1), ("Part A", 2), ("Deep", 3), ("Part B", 2)]
    );
    let a = section_markdown(page, "part a").expect("found without regard to case");
    assert!(
        a.starts_with("## Part A") && a.contains("### Deep") && a.ends_with("D."),
        "{a}"
    );
    assert!(!a.contains("Part B"));
    let top = section_markdown(page, "Top").expect("the whole of it");
    assert!(top.contains("Part B") && top.contains("# not a heading"));
    assert!(top.ends_with("```"), "no blank lines at the end");
    assert_eq!(section_markdown(page, "Nowhere"), None);
    assert!(all[0].line < all[1].line && all[1].end == all[3].line);
}

#[test]
fn a_heading_is_found_by_its_marks_or_without_them() {
    let page = "## The **bold** one\n\ntext\n";
    assert_eq!(sections(page)[0].heading, "The **bold** one");
    assert_eq!(sections(page)[0].title, "The bold one");
    assert!(section_markdown(page, "The **bold** one").is_some());
    assert!(section_markdown(page, "The bold one").is_some());
}

#[test]
fn a_fingerprint_follows_the_words_and_not_the_line_endings_or_the_blank_space_at_the_end() {
    let a = fingerprint("One\ntwo\n");
    assert_eq!(a.len(), 16);
    assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    assert_eq!(a, fingerprint("One\r\ntwo\r\n\r\n"));
    assert_ne!(a, fingerprint("One\ntwo!\n"));
    assert_ne!(fingerprint(""), fingerprint("x"));
}
