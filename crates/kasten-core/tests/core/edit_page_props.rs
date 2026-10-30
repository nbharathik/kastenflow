//! Random pages and random steps: whatever `edit_page` does with them, it
//! either refuses or leaves every block it was not asked about with the same
//! bytes in the same order, never touches the frontmatter, and keeps a page's
//! line ends (a page with only Windows line ends has no bare `\n` after).

use kasten_core::frontmatter::split;
use kasten_core::pages::{Block, BlockRef, Kind, Page, PageStep, blocks_of, edit_text};
use proptest::prelude::*;
use proptest::test_runner::TestRunner;

const SNIPPETS: &[&str] = &[
    "Plain paragraph one.",
    "Second line\nof a paragraph  ",
    "# Heading",
    "## Sub heading",
    "- a\n- b\n  - nested",
    "- [ ] todo\n- [x] done",
    "1. one\n2. two",
    "| a | b |\n|:--|--:|\n| 1 | 2 |",
    "```\nfence\n\nwith blank\n```",
    "> quote\nlazy",
    "> [!note] Call\n> out",
    "<!-- just a comment -->",
    "$$\nx\n$$",
    "![[Some page]]",
    "---",
    "<details>\n<summary>T</summary>\n\nInner\n\n</details>",
    "<!-- columns -->\n\nL\n\n<!-- column -->\n\nR\n\n<!-- /columns -->",
    "Setext\n======",
    "    indented code",
    "<div>\nhtml\n</div>",
    "Ünïcödé 日本語 text  \nsecond 🙂 line",
    "| α | β |\n|:-:|--:|\n| γ | 日本 |",
    "- [ ] ✓ tâche\n\t- [x] ünder",
    "> [!tip] 💡 Tip\n> bödy",
];

fn page_text(
    parts: &[usize],
    gaps: &[usize],
    front: bool,
    crlf: bool,
    final_newline: bool,
) -> String {
    let mut body = String::new();
    for (n, part) in parts.iter().enumerate() {
        if n > 0 {
            body.push_str(&"\n".repeat(2 + gaps[n % gaps.len()]));
        }
        body.push_str(SNIPPETS[*part]);
    }
    if final_newline {
        body.push('\n');
    }
    let mut text = if front {
        format!("---\ntitle: T\ncustom:   [a,   b]\n---\n{body}")
    } else {
        body
    };
    if crlf {
        text = text.replace('\n', "\r\n");
    }
    text
}

fn reference(block: &Block) -> BlockRef {
    BlockRef {
        block: block.id.clone(),
        hash: block.hash.clone(),
    }
}

/// A step of the `kind`th sort on blocks picked by `a` and `b`, if one fits.
fn step(kind: usize, a: usize, b: usize, blocks: &[Block]) -> Option<(PageStep, Vec<String>)> {
    let first = blocks.get(a % blocks.len())?;
    let second = blocks.get(b % blocks.len())?;
    let next = blocks.get(a % blocks.len() + 1);
    let ids = |list: &[&Block]| list.iter().map(|b| b.id.clone()).collect::<Vec<_>>();
    Some(match kind % 11 {
        0 => (
            PageStep::Delete {
                block: reference(first),
            },
            ids(&[first]),
        ),
        1 => (
            PageStep::Replace {
                block: reference(first),
                markdown: "Replaced text.".into(),
            },
            ids(&[first]),
        ),
        2 => (
            PageStep::Insert {
                before: None,
                after: Some(reference(first)),
                at_end_of_heading: None,
                markdown: "Inserted.".into(),
            },
            ids(&[first]),
        ),
        3 => (
            PageStep::Insert {
                before: Some(reference(first)),
                after: None,
                at_end_of_heading: None,
                markdown: "Before.".into(),
            },
            ids(&[first]),
        ),
        4 => (
            PageStep::Move {
                block: reference(first),
                after: Some(reference(second)),
                before: None,
            },
            ids(&[first, second]),
        ),
        5 => (
            PageStep::SetTodo {
                block: reference(first),
                line: 0,
                done: true,
            },
            ids(&[first]),
        ),
        6 => {
            let next = next?;
            (
                PageStep::WrapColumns {
                    blocks: vec![reference(first), reference(next)],
                    columns: vec![],
                    ratio: None,
                },
                ids(&[first, next]),
            )
        }
        7 => (
            PageStep::Toggle {
                blocks: vec![reference(first)],
                title: "Fold".into(),
            },
            ids(&[first]),
        ),
        8 => (
            PageStep::Callout {
                blocks: vec![reference(first)],
                kind: "tip".into(),
                title: String::new(),
            },
            ids(&[first]),
        ),
        9 => (
            PageStep::TableCells {
                block: reference(first),
                cells: vec![(1, 0, "cell".into())],
            },
            ids(&[first]),
        ),
        _ => (
            PageStep::UnwrapColumns {
                block: reference(first),
            },
            ids(&[first]),
        ),
    })
}

/// Every leaf block no step names is in `output` with the same bytes, in order.
fn untouched_keep_their_bytes(input: &str, output: &str, named: &[String]) -> Result<(), String> {
    let page = Page::parse(split(input).body);
    let ranges: Vec<(usize, usize)> = page
        .blocks
        .iter()
        .filter(|b| named.contains(&b.id))
        .map(|b| page.range_of(b))
        .collect();
    let out = split(output).body;
    let mut at = 0;
    for block in &page.blocks {
        let (start, end) = page.range_of(block);
        let container = matches!(block.kind, Kind::Toggle | Kind::Columns | Kind::Column);
        if container || ranges.iter().any(|&(s, e)| start < e && s < end) {
            continue;
        }
        let source = &page.body()[start..end];
        match out[at..].find(source) {
            Some(found) => at += found + source.len(),
            None => return Err(format!("{} {source:?} did not keep its bytes", block.id)),
        }
    }
    Ok(())
}

type Case = (
    Vec<usize>,
    Vec<usize>,
    bool,
    bool,
    bool,
    Vec<(usize, usize, usize)>,
);

fn cases() -> impl Strategy<Value = Case> {
    (
        proptest::collection::vec(0..SNIPPETS.len(), 1..8),
        proptest::collection::vec(0usize..3, 1..4),
        any::<bool>(),
        any::<bool>(),
        any::<bool>(),
        proptest::collection::vec((0usize..11, 0usize..40, 0usize..40), 1..4),
    )
}

/// What a case checks; `made` is bumped for each edit that was made.
fn check(case: Case, made: &std::cell::Cell<usize>) -> Result<(), TestCaseError> {
    let (parts, gaps, front, crlf, final_newline, picks) = case;
    let input = page_text(&parts, &gaps, front, crlf, final_newline);
    let blocks = blocks_of(&input);
    prop_assume!(!blocks.is_empty());
    let mut steps = Vec::new();
    let mut named = Vec::new();
    for (kind, a, b) in picks {
        if let Some((step, ids)) = step(kind, a, b, &blocks) {
            steps.push(step);
            named.extend(ids);
        }
    }
    prop_assume!(!steps.is_empty());
    let Ok((output, edited)) = edit_text(&input, &steps) else {
        return Ok(());
    };
    made.set(made.get() + usize::from(edited.changed));
    // The frontmatter is never touched.
    prop_assert_eq!(split(&input).prefix, split(&output).prefix);
    prop_assert_eq!(edited.changed, output != input);
    if let Err(why) = untouched_keep_their_bytes(&input, &output, &named) {
        return Err(TestCaseError::fail(format!(
            "{why}\ninput {input:?}\noutput {output:?}\nsteps {steps:?}"
        )));
    }
    // (A page with no line end at all has no line-end habit to keep.)
    if input.contains("\r\n") {
        prop_assert!(
            !output.replace("\r\n", "").contains('\n'),
            "a bare line feed in a Windows page: {:?}",
            output
        );
    }
    // The same call twice gives the same answer.
    prop_assert_eq!(edit_text(&input, &steps).unwrap().0, output);
    Ok(())
}

#[test]
fn steps_either_refuse_or_leave_every_other_block_as_it_was() {
    let made = std::cell::Cell::new(0);
    let mut runner = TestRunner::new(ProptestConfig::with_cases(5000));
    runner.run(&cases(), |case| check(case, &made)).unwrap();
    // The test is not vacuous: a good share of the cases made an edit.
    assert!(made.get() > 1000, "only {} edits were made", made.get());
}
