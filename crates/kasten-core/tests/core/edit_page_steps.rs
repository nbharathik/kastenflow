//! Steps that meet on one page: tasks ticked, neighbouring blocks deleted in
//! one call, a block named by two steps (a move cannot copy it), and toggles
//! nested thousands deep.

use kasten_core::pages::{Block, BlockRef, Kind, PageStep, blocks_of, edit_text};

fn r(b: &Block) -> BlockRef {
    BlockRef {
        block: b.id.clone(),
        hash: b.hash.clone(),
    }
}

fn tasks(text: &str, line: usize, done: bool) -> Result<String, String> {
    let blocks = blocks_of(text);
    let list = blocks.first().unwrap();
    let step = PageStep::SetTodo {
        block: r(list),
        line,
        done,
    };
    edit_text(text, &[step])
        .map(|(out, _)| out)
        .map_err(|e| e.to_string())
}

#[test]
fn ticking_a_task_changes_one_byte_and_names_the_tasks_when_the_line_is_wrong() {
    let text = "- [ ] a\n  - [x] b\n- [X] c\n- plain [ ] d\n1. [ ] e\n";
    for text in [text.to_owned(), text.replace('\n', "\r\n")] {
        assert_eq!(
            tasks(&text, 0, true).unwrap(),
            text.replacen("[ ] a", "[x] a", 1)
        );
        assert_eq!(
            tasks(&text, 1, false).unwrap(),
            text.replacen("[x] b", "[ ] b", 1)
        );
        assert_eq!(
            tasks(&text, 2, false).unwrap(),
            text.replacen("[X] c", "[ ] c", 1)
        );
        assert_eq!(
            tasks(&text, 2, true).unwrap(),
            text,
            "already done: no change"
        );
        let why = tasks(&text, 3, true).unwrap_err();
        assert!(
            why.contains("lines 0, 1, 2") && !why.contains("lines 0, 1, 2,"),
            "{why}"
        );
        assert!(tasks(&text, 99, true).is_err());
    }
    assert_eq!(
        tasks("-\t[ ] tab\n", 0, true).unwrap(),
        "-\t[x] tab\n",
        "a tab after the marker"
    );
    assert_eq!(tasks("- [ ]\n", 0, true).unwrap(), "- [x]\n");
    assert!(tasks("- [ ]x\n", 0, true).is_err(), "no space: not a task");
    assert!(
        tasks("- [ ] 日本語\n", 0, true)
            .unwrap()
            .starts_with("- [x] 日本語")
    );
    // A task under a quote is inside a quote block, which is not a list.
    assert!(tasks("> - [ ] q\n", 0, true).is_err());
    // A fence in an item hides the task-like lines in it.
    let fenced = "- [ ] a\n  ```\n  - [ ] not a task\n  ```\n- [ ] b\n";
    assert!(tasks(fenced, 2, true).is_err());
    assert_eq!(
        tasks(fenced, 4, true).unwrap(),
        fenced.replace("[ ] b", "[x] b")
    );
}

#[test]
fn deleting_neighbouring_blocks_in_one_call_works_at_the_end_and_the_start() {
    let text = "A\n\nB\n\nC\n\nD\n\nE\n";
    let blocks = blocks_of(text);
    let delete = |ids: &[usize]| -> String {
        let steps: Vec<PageStep> = ids
            .iter()
            .map(|&i| PageStep::Delete {
                block: r(&blocks[i]),
            })
            .collect();
        edit_text(text, &steps)
            .map(|(out, _)| out)
            .unwrap_or_else(|e| panic!("{ids:?}: {e}"))
    };
    let kept = |out: &str| -> Vec<String> {
        out.split('\n')
            .filter(|l| !l.is_empty())
            .map(str::to_owned)
            .collect()
    };
    assert_eq!(kept(&delete(&[3, 4])), ["A", "B", "C"]);
    assert_eq!(kept(&delete(&[0, 1])), ["C", "D", "E"]);
    assert_eq!(kept(&delete(&[1, 2])), ["A", "D", "E"]);
    assert_eq!(kept(&delete(&[0, 2, 4])), ["B", "D"]);
    assert_eq!(kept(&delete(&[1, 2, 3, 4])), ["A"]);
    assert_eq!(kept(&delete(&[0, 1, 2, 3, 4])), Vec::<String>::new());
}

#[test]
fn a_block_named_by_two_steps_is_refused_so_a_move_cannot_copy_it() {
    let text = "A\n\nB\n\nC\n";
    let blocks = blocks_of(text);
    let go = |block: &Block, after: &Block| PageStep::Move {
        block: r(block),
        after: Some(r(after)),
        before: None,
    };
    for steps in [
        vec![go(&blocks[0], &blocks[1]), go(&blocks[0], &blocks[2])],
        vec![
            PageStep::Delete {
                block: r(&blocks[1]),
            },
            PageStep::Delete {
                block: r(&blocks[1]),
            },
        ],
    ] {
        let why = edit_text(text, &steps).unwrap_err().to_string();
        assert!(why.contains("same part"), "{why}");
    }
}

#[test]
fn a_page_of_nested_toggles_cannot_overflow_the_stack() {
    for depth in [10usize, 3000] {
        let text = format!(
            "{}x\n\n{}",
            "<details>\n\n".repeat(depth),
            "</details>\n\n".repeat(depth)
        );
        let blocks = blocks_of(&text);
        let toggles = blocks.iter().filter(|b| b.kind == Kind::Toggle).count();
        assert_eq!(toggles, depth.min(64), "depth {depth}");
        let x = blocks.iter().find(|b| b.text == "x").unwrap();
        let step = PageStep::Replace {
            block: r(x),
            markdown: "y".into(),
        };
        let (out, _) = edit_text(&text, &[step]).unwrap();
        assert!(out.contains("\ny\n") && !out.contains("\nx\n"));
    }
}

#[test]
fn a_form_feed_line_is_text_inside_its_paragraph_not_a_gap_between_blocks() {
    let text = "A\n\x0c\nB\n\nC\n";
    let blocks = blocks_of(text);
    assert_eq!(blocks.len(), 2, "{blocks:?}");
    assert!(blocks[0].text.contains('\x0c'));
    let step = PageStep::Delete {
        block: r(&blocks[0]),
    };
    let (out, _) = edit_text(text, &[step]).unwrap();
    assert_eq!(out, "C\n");
}
