//! Adversarial checks on `edit_page`'s byte edits that do not trust the
//! engine's own cutting: an independent oracle compares lines, so a wrong
//! cut can only show up as a refusal, never as lost or changed text. Hostile
//! pages are built from snippets that fool a line scanner (fences full of
//! markers, setext headings, html, footnotes, definitions, tabs, rules).

use std::collections::BTreeMap;
use std::sync::Mutex;

use kasten_core::pages::{Block, BlockRef, Kind, Page, PageStep, blocks_of, edit_text};

const SNIPPETS: &[&str] = &[
    "Plain paragraph",
    "Two line\nparagraph  ",
    "# Heading",
    "Setext\n======",
    "Setext two\n---",
    "---",
    "***",
    "- a\n- b\n  - c",
    "1. one\n2. two",
    "- [ ] task\n- [x] done",
    "> quote\n> - item\n>   - nested\n> > deeper",
    "> [!note] Callout\n> body",
    "```\ncode\n\n# not a heading\n<!-- columns -->\n```",
    "~~~md\n<details>\n~~~",
    "    indented code",
    "<div>\nraw html\n</div>",
    "<!-- a comment -->",
    "| a | b |\n|:--|--:|\n| 1 | 2 |",
    "a | b\n--|--\n1 | 2",
    "[ref]: http://example.com \"T\"",
    "[^1]: footnote\n\n    second paragraph",
    "$$\nx^2\n$$",
    "![[Other page#view]]",
    "<details>\n<summary>Sum</summary>\n\nInside\n\n</details>",
    "<!-- columns 40/60 -->\n\nL\n\n<!-- column -->\n\nR\n\n<!-- /columns -->",
    "ends with a backslash\\",
    "Ünïcödé 日本語 🙂",
    "- item\n\n  continued paragraph\n\n- second",
    "* star\n* list",
    "text\n- list interrupts",
    "text\n2. does not interrupt",
    "<br/>",
    "\t- tab list",
];

const SEPS: &[&str] = &["\n\n", "\n", "\n\n\n"];

fn r(b: &Block) -> BlockRef {
    BlockRef {
        block: b.id.clone(),
        hash: b.hash.clone(),
    }
}

fn blank(line: &str) -> bool {
    line.chars().all(|c| matches!(c, ' ' | '\t'))
}

/// The lines with something on them, line ends dropped, trailing spaces kept.
fn filled(text: &str) -> Vec<String> {
    text.split('\n')
        .map(|l| l.strip_suffix('\r').unwrap_or(l))
        .filter(|l| !blank(l))
        .map(str::to_owned)
        .collect()
}

fn joined(parts: &[&str]) -> Vec<String> {
    parts.iter().flat_map(|p| filled(p)).collect()
}

fn insert(block: &Block, after: bool, markdown: &str) -> PageStep {
    PageStep::Insert {
        before: (!after).then(|| r(block)),
        after: after.then(|| r(block)),
        at_end_of_heading: None,
        markdown: markdown.into(),
    }
}

/// Why simple steps were refused, counted by step, kind of block and reason.
static REFUSED: Mutex<BTreeMap<String, usize>> = Mutex::new(BTreeMap::new());

fn why(step: &str, kind: Kind, reason: &str) {
    let short: String = reason.chars().take(60).collect();
    let mut all = REFUSED.lock().unwrap();
    *all.entry(format!("{step} {kind:?}: {short}")).or_default() += 1;
}

/// Runs each simple step on each block of `text`; every success must satisfy
/// the oracle. Returns (succeeded, refused).
fn sweep(text: &str) -> (usize, usize) {
    // A page that opens with two rules has frontmatter, and its blocks are those of what follows.
    if !kasten_core::frontmatter::split(text).prefix.is_empty() {
        return (0, 0);
    }
    let page = Page::parse(text);
    let crlf = text.contains("\r\n");
    let (mut ok, mut no) = (0, 0);
    for block in &page.blocks {
        let (s, e) = page.range_of(block);
        let me = &text[s..e];
        let tops: Vec<&Block> = page.blocks.iter().filter(|b| b.depth == 0).collect();
        let last = tops.last().copied();
        let moved = last.filter(|t| {
            let (ts, _) = page.range_of(t);
            block.depth == 0 && ts >= e
        });
        let mut cases: Vec<(&str, PageStep, Vec<String>)> = vec![
            (
                "delete",
                PageStep::Delete { block: r(block) },
                joined(&[&text[..s], &text[e..]]),
            ),
            (
                "insert after",
                insert(block, true, "INSERTED"),
                joined(&[&text[..e], "INSERTED", &text[e..]]),
            ),
            (
                "insert before",
                insert(block, false, "INSERTED"),
                joined(&[&text[..s], "INSERTED", &text[s..]]),
            ),
        ];
        if let Some(t) = moved {
            let (_, te) = page.range_of(t);
            cases.push((
                "move",
                PageStep::Move {
                    block: r(block),
                    after: Some(r(t)),
                    before: None,
                },
                joined(&[&text[..s], &text[e..te], me, &text[te..]]),
            ));
        }
        for (name, step, want) in cases {
            match edit_text(text, &[step]) {
                Ok((out, _)) => {
                    ok += 1;
                    assert_eq!(
                        filled(&out),
                        want,
                        "{name} of {} ({:?}) in {text:?} gave {out:?}",
                        block.id,
                        block.kind
                    );
                    if crlf {
                        assert_eq!(
                            out.matches('\n').count(),
                            out.matches("\r\n").count(),
                            "{name}: a bare LF in a CRLF page: {out:?}"
                        );
                    }
                    let _ = blocks_of(&out);
                }
                Err(err) => {
                    no += 1;
                    why(name, block.kind, &err.to_string());
                }
            }
        }
        // A replace is exact: the block's bytes become the text, nothing else moves.
        let step = PageStep::Replace {
            block: r(block),
            markdown: "REPLACED".into(),
        };
        match edit_text(text, &[step]) {
            Ok((out, _)) => {
                ok += 1;
                assert_eq!(
                    out,
                    format!("{}REPLACED{}", &text[..s], &text[e..]),
                    "replace of {} in {text:?}",
                    block.id
                );
            }
            Err(_) => no += 1,
        }
    }
    (ok, no)
}

#[test]
fn every_pair_of_hostile_blocks_keeps_every_line_it_was_not_asked_to_touch() {
    let (mut pages, mut ok, mut no) = (0, 0, 0);
    for (a, x) in SNIPPETS.iter().enumerate() {
        for (b, y) in SNIPPETS.iter().enumerate() {
            let sep = SEPS[(a + b) % SEPS.len()];
            let lf = format!("{x}{sep}{y}\n");
            let mut variants = vec![lf.clone()];
            if (a + b) % 3 == 0 {
                variants.push(lf.replace('\n', "\r\n"));
                variants.push(format!("{x}{sep}{y}"));
            }
            for text in variants {
                let (o, n) = sweep(&text);
                (pages, ok, no) = (pages + 1, ok + o, no + n);
            }
        }
    }
    eprintln!("pairs: {pages} pages, {ok} edits made, {no} refused");
    let mut counts: Vec<(usize, String)> = REFUSED
        .lock()
        .unwrap()
        .iter()
        .map(|(k, n)| (*n, k.clone()))
        .collect();
    counts.sort_by(|a, b| b.cmp(a));
    for (n, what) in counts.iter().take(25) {
        eprintln!("  refused {n:5}  {what}");
    }
    assert!(ok > no, "most simple edits must succeed: {ok} vs {no}");
}

#[test]
fn sampled_triples_of_hostile_blocks_keep_every_line_too() {
    let n = SNIPPETS.len();
    let (mut pages, mut ok, mut no) = (0, 0, 0);
    for k in (0..n * n * n).step_by(53) {
        let (a, b, c) = (k / (n * n), (k / n) % n, k % n);
        let text = format!(
            "{}{}{}{}{}\n",
            SNIPPETS[a],
            SEPS[(a + c) % 3],
            SNIPPETS[b],
            SEPS[(b + a) % 3],
            SNIPPETS[c]
        );
        let (o, m) = sweep(&text);
        (pages, ok, no) = (pages + 1, ok + o, no + m);
    }
    eprintln!("triples: {pages} pages, {ok} edits made, {no} refused");
    assert!(ok > no);
}

fn kinds(text: &str) -> Vec<Kind> {
    blocks_of(text).iter().map(|b| b.kind).collect()
}

#[test]
fn markers_inside_code_and_comments_are_text_and_cannot_be_paired() {
    let body = "Intro\n\n```md\n<!-- columns 50/50 -->\nA\n<!-- column -->\nB\n<!-- /columns -->\n<details>\n<summary>S</summary>\n```\n\nAfter\n";
    assert_eq!(
        kinds(body),
        [Kind::Paragraph, Kind::Code, Kind::Paragraph],
        "{:?}",
        blocks_of(body)
    );
    // A comment that opens before a marker makes the marker's line part of an html block that is no marker.
    let body = "<!--\n<!-- columns -->\nfoo\n<!-- /columns -->\n-->\n\nTail\n";
    assert!(!kinds(body).contains(&Kind::Columns), "{:?}", kinds(body));
    // A marker inside a sentence is no marker.
    let body = "See <details> and <!-- columns --> here.\n\nTail\n";
    assert_eq!(kinds(body), [Kind::Paragraph, Kind::Paragraph]);
    // Wrapping the code and the paragraph after it keeps the code's bytes.
    let blocks = blocks_of(body);
    let (out, _) = edit_text(
        body,
        &[PageStep::WrapColumns {
            blocks: blocks.iter().map(r).collect(),
            columns: vec![],
            ratio: None,
        }],
    )
    .unwrap();
    assert!(out.contains("See <details> and <!-- columns --> here.\n\n<!-- column -->\n\nTail"));
}

#[test]
fn a_stray_marker_elsewhere_never_changes_what_a_new_wrapper_pairs_with() {
    // A stray closer above and a stray opener below the blocks that get wrapped.
    let body = "</details>\n\nA\n\nB\n\n<details>\n\nC\n\n<!-- /columns -->\n\nD\n";
    let blocks = blocks_of(body);
    let a = blocks.iter().find(|b| b.text == "A").unwrap();
    let b = blocks.iter().find(|b| b.text == "B").unwrap();
    for step in [
        PageStep::Toggle {
            blocks: vec![r(a), r(b)],
            title: "T".into(),
        },
        PageStep::Callout {
            blocks: vec![r(a), r(b)],
            kind: "tip".into(),
            title: String::new(),
        },
        PageStep::WrapColumns {
            blocks: vec![r(a), r(b)],
            columns: vec![],
            ratio: None,
        },
    ] {
        let name = step.name();
        let (out, _) = edit_text(body, &[step]).unwrap_or_else(|e| panic!("{name}: {e}"));
        for stray in ["</details>", "<details>\n\nC", "<!-- /columns -->", "D"] {
            assert!(out.contains(stray), "{name}: {stray} in {out:?}");
        }
        let after = blocks_of(&out);
        assert!(
            after
                .iter()
                .any(|b| matches!(b.kind, Kind::Toggle | Kind::Callout | Kind::Columns)),
            "{name}: {after:?}"
        );
    }
}

#[test]
fn a_title_cannot_break_out_of_its_toggle_or_callout() {
    let body = "A\n\nB\n";
    let blocks = blocks_of(body);
    for title in [
        "</summary></details><script>alert(1)</script>",
        "x</SUMMARY>\n\n# injected",
        "<details>",
        "multi\nline\r\ntitle",
    ] {
        let toggle = PageStep::Toggle {
            blocks: vec![r(&blocks[0])],
            title: title.into(),
        };
        let (out, _) = edit_text(body, &[toggle]).unwrap();
        let after = blocks_of(&out);
        assert_eq!(after[0].kind, Kind::Toggle, "{title:?}: {out:?}");
        assert_eq!(after.len(), 3, "{title:?}: {out:?}");
        assert!(
            !out.contains("# injected\n\nA") || out.contains("&lt;"),
            "{out:?}"
        );
        let callout = PageStep::Callout {
            blocks: vec![r(&blocks[0])],
            kind: "note".into(),
            title: title.into(),
        };
        let (out, _) = edit_text(body, &[callout]).unwrap();
        assert_eq!(blocks_of(&out)[0].kind, Kind::Callout, "{title:?}: {out:?}");
    }
    for kind in ["note] x", "", "a b", "1x", "note]\n> [!tip"] {
        let callout = PageStep::Callout {
            blocks: vec![r(&blocks[0])],
            kind: kind.into(),
            title: String::new(),
        };
        assert!(edit_text(body, &[callout]).is_err(), "{kind:?}");
    }
    for (target, view) in [
        ("a]]\n# h", None),
        ("ok", Some("v#w")),
        ("ok", Some("v]]")),
        ("", None),
        ("a|b", None),
    ] {
        let embed = PageStep::Embed {
            after: r(&blocks[0]),
            target: target.into(),
            view: view.map(Into::into),
        };
        assert!(edit_text(body, &[embed]).is_err(), "{target:?} {view:?}");
    }
}

#[test]
fn hashes_follow_the_bytes_so_a_page_saved_with_other_line_ends_is_stale() {
    let lf = "# T\n\nOne\n\nTwo\n";
    let crlf = lf.replace('\n', "\r\n");
    let (a, b) = (blocks_of(lf), blocks_of(&crlf));
    assert_eq!(a.len(), b.len());
    // A one-line block has the same bytes either way; a block of lines does not.
    assert_eq!(a[1].hash, b[1].hash);
    let multi_lf = "A\nB\n";
    let multi_crlf = "A\r\nB\r\n";
    assert_ne!(blocks_of(multi_lf)[0].hash, blocks_of(multi_crlf)[0].hash);
    // Refs read from the LF page are refused on the CRLF page: nothing is made.
    let step = PageStep::Replace {
        block: r(&blocks_of(multi_lf)[0]),
        markdown: "X".into(),
    };
    let why = edit_text(multi_crlf, &[step]).unwrap_err().to_string();
    assert!(why.contains("changed since"), "{why}");
}

#[test]
fn frontmatter_bytes_survive_in_every_shape() {
    let front = "---\ntitle:   Odd   spacing\nunknown_key: [1,   2]\n# comment\n---\n";
    for (name, text) in [
        ("lf", format!("{front}Intro\n\nBody\n")),
        (
            "crlf",
            format!("{front}Intro\n\nBody\n").replace('\n', "\r\n"),
        ),
        ("bom", format!("\u{feff}{front}Intro\n\nBody\n")),
        ("no final newline", format!("{front}Intro\n\nBody")),
        ("body starts with a rule", format!("{front}---\n\nBody\n")),
        (
            "body is a rule and text",
            format!("{front}Intro\n---\nBody\n"),
        ),
    ] {
        let blocks = blocks_of(&text);
        let last = blocks.last().unwrap();
        let (out, _) = edit_text(
            &text,
            &[PageStep::Replace {
                block: r(last),
                markdown: "Changed".into(),
            }],
        )
        .unwrap_or_else(|e| panic!("{name}: {e}"));
        let prefix_len = text.len() - kasten_core::frontmatter::split(&text).body.len();
        assert_eq!(&out[..prefix_len], &text[..prefix_len], "{name}");
        assert!(out[prefix_len..].contains("Changed"), "{name}: {out:?}");
        if name == "crlf" {
            assert_eq!(out.matches('\n').count(), out.matches("\r\n").count());
        }
    }
}

#[test]
fn a_page_cannot_be_edited_into_one_that_starts_with_frontmatter() {
    // No frontmatter; removing the first block leaves a rule that, with the rule below, is frontmatter.
    let text = "Intro\n\n---\n\nMiddle\n\n---\n\nEnd\n";
    let blocks = blocks_of(text);
    let step = PageStep::Delete {
        block: r(&blocks[0]),
    };
    let why = kasten_core::pages::edit_note(text, &[step]).unwrap_err();
    assert!(why.to_string().contains("three dashes"), "{why}");
    // With a rule only once, the same edit is fine and leaves the rule as it was.
    let text = "Intro\n\n---\n\nEnd\n";
    let blocks = blocks_of(text);
    let step = PageStep::Delete {
        block: r(&blocks[0]),
    };
    let edited = kasten_core::pages::edit_note(text, &[step]).unwrap();
    assert_eq!(edited.body, "---\n\nEnd\n");
    // `+++` is no frontmatter here: it is text.
    let text = "+++\ntitle = 'x'\n+++\n\nBody\n";
    assert_eq!(kinds(text).len(), 2, "{:?}", blocks_of(text));
}
