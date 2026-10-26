use super::*;

fn summary(body: &str) -> Vec<(String, Kind, usize)> {
    Page::parse(body)
        .blocks
        .into_iter()
        .map(|b| (b.id, b.kind, b.depth))
        .collect()
}

#[test]
fn blocks_are_numbered_in_reading_order_with_their_depth() {
    let body = "# T\n\nIntro\n\n<!-- columns -->\n\nLeft\n\n<!-- column -->\n\n- [ ] r\n\n<!-- /columns -->\n\n<details>\n<summary>S</summary>\n\nIn\n\n</details>\n";
    let got = summary(body);
    let kinds: Vec<(&str, Kind, usize)> =
        got.iter().map(|(i, k, d)| (i.as_str(), *k, *d)).collect();
    assert_eq!(
        kinds,
        [
            ("b1", Kind::Heading, 0),
            ("b2", Kind::Paragraph, 0),
            ("b3", Kind::Columns, 0),
            ("b4", Kind::Column, 1),
            ("b5", Kind::Paragraph, 2),
            ("b6", Kind::Column, 1),
            ("b7", Kind::Todo, 2),
            ("b8", Kind::Toggle, 0),
            ("b9", Kind::Paragraph, 1),
        ]
    );
}

#[test]
fn a_block_knows_its_headings_its_bytes_and_its_hash() {
    let body = "# A\n\n## B\n\ntext\n\n## C\n\nmore\n";
    let page = Page::parse(body);
    let text = &page.blocks[2];
    assert_eq!(text.heading_path, ["A", "B"]);
    assert_eq!(page.source(text), "text");
    assert_eq!(text.hash, short_hash("text"));
    assert_eq!(page.blocks[4].heading_path, ["A", "C"]);
    assert_eq!(page.blocks[1].level, Some(2));
}

#[test]
fn a_step_finds_a_block_only_while_its_hash_matches() {
    let page = Page::parse("one\n\ntwo\n");
    let good = BlockRef {
        block: "b2".into(),
        hash: short_hash("two"),
    };
    assert_eq!(page.find(&good).unwrap().id, "b2");
    let stale = BlockRef {
        block: "b2".into(),
        hash: short_hash("TWO"),
    };
    assert!(
        page.find(&stale)
            .unwrap_err()
            .to_string()
            .contains("changed since")
    );
    let missing = BlockRef {
        block: "b9".into(),
        hash: String::new(),
    };
    assert!(
        page.find(&missing)
            .unwrap_err()
            .to_string()
            .contains("no block")
    );
}
