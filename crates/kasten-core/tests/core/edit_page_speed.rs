//! `edit_page` on big and malformed pages: an edit of a 200 KB page of 5,000
//! blocks takes well under a second, thousands of stray markers do not make
//! it quadratic, and odd input (deep quotes, huge lines, endless fences) is
//! read without a panic. The limits are generous because tests run unoptimised.

use std::time::Instant;

use kasten_core::pages::{Block, BlockRef, PageStep, blocks_of, edit_text};

fn r(b: &Block) -> BlockRef {
    BlockRef {
        block: b.id.clone(),
        hash: b.hash.clone(),
    }
}

/// A page of `n` short paragraphs.
fn paragraphs(n: usize) -> String {
    let mut out = String::with_capacity(n * 40);
    for i in 0..n {
        out.push_str(&format!("Paragraph number {i} with a few words.\n\n"));
    }
    out
}

fn timed<T>(what: &str, f: impl FnOnce() -> T) -> (T, f64) {
    let start = Instant::now();
    let value = f();
    let secs = start.elapsed().as_secs_f64();
    eprintln!("{what}: {secs:.3}s");
    (value, secs)
}

fn replace_first(text: &str, what: &str) {
    let ((), secs) = timed(what, || {
        let blocks = blocks_of(text);
        assert_eq!(blocks.len(), 1, "{what}");
        let step = PageStep::Replace {
            block: r(&blocks[0]),
            markdown: "gone".into(),
        };
        edit_text(text, &[step]).unwrap();
    });
    assert!(secs < 1.5, "{what}: {secs}s");
}

#[test]
fn a_200_kb_page_of_5000_blocks_is_edited_quickly() {
    let text = paragraphs(5000);
    assert!(text.len() > 190_000, "{}", text.len());
    let (blocks, _) = timed("read 5000 blocks", || blocks_of(&text));
    assert_eq!(blocks.len(), 5000);
    let steps: Vec<PageStep> = (0..200)
        .map(|i| PageStep::Replace {
            block: r(&blocks[i * 25]),
            markdown: format!("Rewritten {i}"),
        })
        .collect();
    let (out, secs) = timed("200 replaces", || edit_text(&text, &steps).unwrap());
    assert!(secs < 1.5, "{secs}s");
    assert!(out.0.contains("Rewritten 199"));
    let steps: Vec<PageStep> = (0..200)
        .map(|i| PageStep::Delete {
            block: r(&blocks[2000 + i * 3]),
        })
        .collect();
    let (_, secs) = timed("200 deletes", || edit_text(&text, &steps).unwrap());
    assert!(secs < 1.5, "{secs}s");
    let step = PageStep::Move {
        block: r(&blocks[10]),
        after: Some(r(&blocks[4990])),
        before: None,
    };
    let (_, secs) = timed("one move", || edit_text(&text, &[step]).unwrap());
    assert!(secs < 1.5, "{secs}s");
    // One big code block and one huge line.
    replace_first(
        &format!("```\n{}```\n", "line of code\n".repeat(15_000)),
        "200 KB code block",
    );
    replace_first(&"word ".repeat(40_000), "200 KB single line");
}

#[test]
fn thousands_of_unmatched_markers_do_not_make_an_edit_slow() {
    for marker in [
        "<details>",
        "<!-- columns -->",
        "</details>",
        "<!-- column -->",
    ] {
        let text = format!("{marker}\n\n").repeat(5000);
        let ((blocks, out), secs) = timed(&format!("5000 x {marker}"), || {
            let blocks = blocks_of(&text);
            let step = PageStep::Replace {
                block: r(&blocks[2500]),
                markdown: "X".into(),
            };
            let out = edit_text(&text, &[step]);
            (blocks, out)
        });
        assert_eq!(blocks.len(), 5000, "{marker}");
        assert!(out.is_ok(), "{marker}: {:?}", out.err());
        assert!(secs < 1.5, "{marker}: {secs}s");
    }
}

#[test]
fn nesting_and_odd_input_never_panic() {
    let mut texts = vec![
        "> ".repeat(20_000),
        format!("{}x", "- ".repeat(5_000)),
        format!("{}x", "  ".repeat(5_000)),
        "|".repeat(50_000),
        "| a |\n|---|\n".to_owned() + &"| x |\n".repeat(20_000),
        "\u{feff}\u{0}\u{7}\r\r\r\n\n\r".to_owned(),
        "```".repeat(10_000),
        "$$\n".repeat(10_000),
        "<!--\n".repeat(10_000),
        "[^1]: a\n".repeat(10_000),
        "* * *\n".repeat(10_000),
        "日本語\n".repeat(10_000) + "=== \n",
        "\x0c\n".repeat(10_000),
    ];
    texts.push(texts[0].replace(' ', "\t"));
    for text in texts {
        let ((), secs) = timed("odd input", || {
            let blocks = blocks_of(&text);
            if let Some(first) = blocks.first() {
                let step = PageStep::Delete { block: r(first) };
                let _ = edit_text(&text, &[step]);
            }
        });
        assert!(secs < 3.0, "{secs}s for {:?}", &text[..text.len().min(20)]);
    }
}
