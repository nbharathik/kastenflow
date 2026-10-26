//! The block scanner and the steps on real pages: every Markdown file in the
//! fixtures is cut into blocks that cover all its text, and deleting or
//! inserting at any block either leaves the others with their bytes or is
//! refused. Also line ends and byte order marks, and columns' edges.

use crate::edit_page_golden::untouched_keep_bytes;

use std::fs;
use std::path::{Path, PathBuf};

use kasten_core::frontmatter::split;
use kasten_core::pages::{BlockRef, Kind, Page, PageStep, blocks_of, edit_text};

fn markdown_files() -> Vec<(String, String)> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                walk(&path, out);
            } else if path.extension().is_some_and(|e| e == "md") {
                out.push(path);
            }
        }
    }
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures");
    let mut files = Vec::new();
    for folder in ["roundtrip", "dev-vault"] {
        walk(&root.join(folder), &mut files);
    }
    files.sort();
    files
        .into_iter()
        .filter_map(|p| Some((p.display().to_string(), fs::read_to_string(&p).ok()?)))
        .collect()
}

fn blank(line: &str) -> bool {
    line.trim().is_empty()
}

#[test]
fn the_blocks_of_every_fixture_cover_all_of_its_text_and_nothing_else() {
    let files = markdown_files();
    assert!(files.len() > 100, "{}", files.len());
    for (name, text) in &files {
        let body = split(text).body;
        let page = Page::parse(body);
        let mut tops: Vec<(usize, usize)> = page
            .blocks
            .iter()
            .filter(|b| b.depth == 0)
            .map(|b| page.range_of(b))
            .collect();
        tops.sort_unstable();
        let mut at = 0;
        for (start, end) in tops {
            assert!(start >= at, "{name}: blocks overlap at {start}");
            assert!(
                blank(&body[at..start]),
                "{name}: text between blocks: {:?}",
                &body[at..start]
            );
            let source = &body[start..end];
            assert!(
                !blank(source.lines().next().unwrap_or(""))
                    && !blank(source.lines().last().unwrap_or("")),
                "{name}: a block with blank edges: {source:?}"
            );
            at = end;
        }
        assert!(
            blank(&body[at..]),
            "{name}: text after the last block: {:?}",
            &body[at..]
        );
    }
}

/// Writes the leaf blocks of every fixture (first and last line, kind) as JSON
/// to the temporary folder, to compare with the editor's parser:
/// `cargo test -p kasten-core --test core dump_blocks -- --ignored`.
#[test]
#[ignore = "a tool for comparing the scanner with the editor's parser, not a check"]
fn dump_blocks() {
    let mut all = Vec::new();
    for (name, text) in markdown_files() {
        let body = split(&text).body;
        let page = Page::parse(body);
        let line = |at: usize| body[..at].matches('\n').count();
        let leaves: Vec<serde_json::Value> = page
            .blocks
            .iter()
            .filter(|b| !matches!(b.kind, Kind::Toggle | Kind::Columns | Kind::Column))
            .map(|b| {
                let (start, end) = page.range_of(b);
                serde_json::json!([line(start), line(end), b.kind])
            })
            .collect();
        all.push(serde_json::json!({ "name": name, "blocks": leaves }));
    }
    let path = std::env::temp_dir().join("kasten-scan-dump.json");
    fs::write(path, serde_json::to_string(&all).unwrap()).unwrap();
    // Made-up documents, if some were left in the temporary folder as a JSON list of texts.
    let docs = std::env::temp_dir().join("kasten-scan-docs.json");
    if let Ok(list) = fs::read_to_string(docs) {
        let list: Vec<String> = serde_json::from_str(&list).unwrap();
        let cuts: Vec<serde_json::Value> = list
            .iter()
            .map(|doc| {
                let page = Page::parse(doc);
                let line = |at: usize| doc[..at].matches('\n').count();
                let leaves: Vec<serde_json::Value> = page
                    .blocks
                    .iter()
                    .map(|b| {
                        let (start, end) = page.range_of(b);
                        serde_json::json!([line(start), line(end), b.kind])
                    })
                    .collect();
                serde_json::json!(leaves)
            })
            .collect();
        let out = std::env::temp_dir().join("kasten-scan-docs-dump.json");
        fs::write(out, serde_json::to_string(&cuts).unwrap()).unwrap();
    }
}

fn reference(text: &str, n: usize) -> BlockRef {
    let block = &blocks_of(text)[n - 1];
    BlockRef {
        block: block.id.clone(),
        hash: block.hash.clone(),
    }
}

/// What a refusal is allowed to say here: new text that fuses with a
/// neighbour, or a column that is not a block of its own.
fn expected_refusal(why: &str) -> bool {
    why.contains("run together")
        || why.contains("cannot be taken out on its own")
        || why.contains("reads as the start of frontmatter")
        || why.contains("break or join a toggle")
}

#[test]
fn deleting_or_inserting_at_any_block_of_any_fixture_is_exact_or_refused() {
    let mut made = 0;
    let mut refused = 0;
    for (name, text) in markdown_files() {
        let count = blocks_of(&text).len().min(60);
        for n in 1..=count {
            let steps = [
                (
                    PageStep::Delete {
                        block: reference(&text, n),
                    },
                    "delete",
                ),
                (
                    PageStep::Insert {
                        before: None,
                        after: Some(reference(&text, n)),
                        at_end_of_heading: None,
                        markdown: "Inserted by the test.".into(),
                    },
                    "insert",
                ),
            ];
            for (step, what) in steps {
                match edit_text(&text, std::slice::from_ref(&step)) {
                    Ok((out, _)) => {
                        made += 1;
                        if let Err(why) = untouched_keep_bytes(&text, &out, &[n]) {
                            panic!("{name}: {what} at block {n}: {why}");
                        }
                        assert_eq!(split(&text).prefix, split(&out).prefix, "{name}");
                    }
                    Err(err) => {
                        refused += 1;
                        let why = err.to_string();
                        assert!(expected_refusal(&why), "{name}: {what} at block {n}: {why}");
                    }
                }
            }
        }
    }
    assert!(made > 1000, "{made} made, {refused} refused");
    // Refusals are for blocks that touch their neighbours: a small share of the whole.
    assert!(refused * 10 < made, "{made} made, {refused} refused");
}

#[test]
fn a_page_with_mixed_line_ends_keeps_every_byte_it_is_not_asked_about() {
    let text = "a\r\n\r\nb\n\nc\n";
    let step = PageStep::Replace {
        block: reference(text, 2),
        markdown: "NEW\nTEXT".into(),
    };
    let (out, _) = edit_text(text, &[step]).unwrap();
    // The page's habit is Windows line ends once it has one; the other blocks are as they were.
    assert_eq!(out, "a\r\n\r\nNEW\r\nTEXT\n\nc\n");
}

#[test]
fn a_byte_order_mark_and_the_frontmatter_after_it_stay() {
    let text = "\u{feff}---\ntitle: T\n---\nOne\n\nTwo\n";
    let step = PageStep::Delete {
        block: reference(text, 1),
    };
    let (out, _) = edit_text(text, &[step]).unwrap();
    assert_eq!(out, "\u{feff}---\ntitle: T\n---\nTwo\n");
}

#[test]
fn a_new_block_goes_at_the_end_of_the_column_it_follows() {
    let text = "<!-- columns -->\n\nLeft\n\n<!-- column -->\n\nRight\n\n<!-- /columns -->\n";
    let blocks = blocks_of(text);
    let kinds: Vec<Kind> = blocks.iter().map(|b| b.kind).collect();
    assert_eq!(
        kinds,
        [
            Kind::Columns,
            Kind::Column,
            Kind::Paragraph,
            Kind::Column,
            Kind::Paragraph
        ]
    );
    let after = |n: usize, md: &str| PageStep::Insert {
        before: None,
        after: Some(reference(text, n)),
        at_end_of_heading: None,
        markdown: md.into(),
    };
    let (out, _) = edit_text(text, &[after(2, "Left 2."), after(4, "Right 2.")]).unwrap();
    assert_eq!(
        out,
        "<!-- columns -->\n\nLeft\n\nLeft 2.\n\n<!-- column -->\n\nRight\n\nRight 2.\n\n<!-- /columns -->\n"
    );
    // Nothing goes before a column: insert after the block above it, or in the column before.
    let before = PageStep::Insert {
        before: Some(reference(text, 4)),
        after: None,
        at_end_of_heading: None,
        markdown: "x".into(),
    };
    assert!(
        edit_text(text, &[before])
            .unwrap_err()
            .to_string()
            .contains("Nothing goes before a column")
    );
}

#[test]
fn an_empty_column_takes_a_block_and_a_column_cannot_be_deleted_alone() {
    let text = "<!-- columns -->\n\nLeft\n\n<!-- column -->\n\n<!-- /columns -->\n";
    let fill = PageStep::Insert {
        before: None,
        after: Some(reference(text, 4)),
        at_end_of_heading: None,
        markdown: "Filled.".into(),
    };
    let (out, _) = edit_text(text, &[fill]).unwrap();
    assert_eq!(
        out,
        "<!-- columns -->\n\nLeft\n\n<!-- column -->\n\nFilled.\n\n<!-- /columns -->\n"
    );
    let gone = PageStep::Delete {
        block: reference(text, 4),
    };
    assert!(
        edit_text(text, &[gone])
            .unwrap_err()
            .to_string()
            .contains("cannot be taken out on its own")
    );
    // Taking the only block out of a column leaves the two markers apart by a blank line.
    let one = "<!-- columns -->\n\nLeft\n\n<!-- column -->\n\nRight\n\n<!-- /columns -->\n";
    let gone = PageStep::Delete {
        block: reference(one, 5),
    };
    let (out, _) = edit_text(one, &[gone]).unwrap();
    assert_eq!(
        out,
        "<!-- columns -->\n\nLeft\n\n<!-- column -->\n\n<!-- /columns -->\n"
    );
}
