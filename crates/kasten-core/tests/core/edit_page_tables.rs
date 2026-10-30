//! Table and task steps on awkward input: ragged rows, escaped bars, bars in
//! code, tables with no outer bars, an indented header, alignment rows, CRLF,
//! no final newline. A table is read back with a splitter written here, not
//! the engine's, and every line a step did not name must be byte-identical.

use kasten_core::pages::{Block, BlockRef, Kind, PageStep, blocks_of, edit_text};

fn r(b: &Block) -> BlockRef {
    BlockRef {
        block: b.id.clone(),
        hash: b.hash.clone(),
    }
}

/// A table line cut at unescaped bars (a backslash escapes the next character),
/// each cell trimmed, the outer bars dropped.
fn cells(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut chars = line.chars();
    while let Some(c) = chars.next() {
        match c {
            '\\' => {
                cur.push(c);
                if let Some(next) = chars.next() {
                    cur.push(next);
                }
            }
            '|' => out.push(std::mem::take(&mut cur)),
            _ => cur.push(c),
        }
    }
    out.push(cur);
    let mut out: Vec<String> = out.into_iter().map(|c| c.trim().to_owned()).collect();
    if out.first().is_some_and(String::is_empty) {
        out.remove(0);
    }
    if out.last().is_some_and(String::is_empty) {
        out.pop();
    }
    out
}

fn table(text: &str) -> BlockRef {
    let blocks = blocks_of(text);
    let block = blocks
        .iter()
        .find(|b| b.kind == Kind::Table)
        .unwrap_or_else(|| panic!("no table in {text:?}: {blocks:?}"));
    r(block)
}

fn run(text: &str, step: impl FnOnce(BlockRef) -> PageStep) -> Result<String, String> {
    let step = step(table(text));
    edit_text(text, &[step])
        .map(|(out, _)| out)
        .map_err(|e| e.to_string())
}

fn lines(text: &str) -> Vec<&str> {
    text.split('\n')
        .map(|l| l.strip_suffix('\r').unwrap_or(l))
        .collect()
}

/// Every line but those in `changed` is as it was.
fn same_but(before: &str, after: &str, changed: &[usize]) {
    let (a, b) = (lines(before), lines(after));
    assert_eq!(a.len(), b.len(), "{before:?} -> {after:?}");
    for (n, (x, y)) in a.iter().zip(&b).enumerate() {
        if !changed.contains(&n) {
            assert_eq!(x, y, "line {n} changed: {before:?} -> {after:?}");
        }
    }
}

fn set(row: usize, col: usize, text: &str) -> impl FnOnce(BlockRef) -> PageStep {
    let text = text.to_owned();
    move |block| PageStep::TableCells {
        block,
        cells: vec![(row, col, text)],
    }
}

#[test]
fn cell_text_that_could_swallow_its_neighbour_stays_in_its_cell() {
    let table_text = "|a|b|\n|-|-|\n|c|d|\n";
    for new in [
        "x\\",
        "x\\\\",
        "a|b",
        "a\\|b",
        "a\\\\|b",
        "`p|q`",
        "end\\\\\\",
        "tab\there",
        "x\ny",
        "<b>|</b>",
        "日本語|🙂",
    ] {
        let out = run(table_text, set(1, 0, new)).unwrap_or_else(|e| panic!("{new:?}: {e}"));
        same_but(table_text, &out, &[2]);
        let row = cells(lines(&out)[2]);
        assert_eq!(row.len(), 2, "{new:?} made {:?}", lines(&out)[2]);
        assert_eq!(row[1], "d", "{new:?} made {:?}", lines(&out)[2]);
    }
}

#[test]
fn an_edited_cell_changes_only_its_own_bytes() {
    let cases = [
        // (table, cell to set, the line it must become)
        (
            "| a \\| b | c |\n|---|---|\n| 1 | 2 |\n",
            (0, 1),
            "| a \\| b | Z |",
        ),
        (
            "| `x\\|y` | c |\n|---|---|\n| 1 | 2 |\n",
            (0, 0),
            "| Z | c |",
        ),
        ("a | b\n--|--\n1 | 2\n", (1, 1), "1 | Z"),
        (
            "  | a | b |\n  |---|---|\n  | 1 | 2 |\n",
            (1, 0),
            "  | Z | 2 |",
        ),
        ("| a | b |\n|:--|--:|\n|   | 2 |\n", (1, 0), "| Z | 2 |"),
        (
            "| a | b | c |\n|---|---|---|\n| 1 |\n| 4 | 5 | 6 |\n",
            (2, 2),
            "| 4 | 5 | Z |",
        ),
    ];
    for (text, (row, col), want) in cases {
        for text in [
            text.to_owned(),
            text.replace('\n', "\r\n"),
            text.trim_end().to_owned(),
        ] {
            let out = run(&text, set(row, col, "Z")).unwrap_or_else(|e| panic!("{text:?}: {e}"));
            let n = lines(&out).iter().position(|l| *l == want);
            let n = n.unwrap_or_else(|| panic!("{want:?} not in {out:?}"));
            same_but(&text, &out, &[n]);
            if text.contains("\r\n") {
                assert_eq!(out.matches('\n').count(), out.matches("\r\n").count());
            }
        }
    }
}

#[test]
fn a_cell_a_ragged_row_does_not_have_is_refused_not_invented() {
    let text = "| a | b | c |\n|---|---|---|\n| 1 |\n| 4 | 5 | 6 |\n";
    assert!(
        run(text, set(1, 2, "z"))
            .unwrap_err()
            .contains("no column 2")
    );
    assert!(run(text, set(9, 0, "z")).unwrap_err().contains("no row 9"));
    // A column cannot be added at the end of a row too short to hold the others.
    let add_end = |b| PageStep::TableColumns {
        block: b,
        insert_at: Some(3),
        header: "N".into(),
        align: None,
        cells: vec![],
        delete: vec![],
    };
    assert!(run(text, add_end).is_err());
    // Deleting a column the short row does not have leaves that row alone.
    let out = run(text, |b| PageStep::TableColumns {
        block: b,
        insert_at: None,
        header: String::new(),
        align: None,
        cells: vec![],
        delete: vec![2],
    })
    .unwrap();
    assert_eq!(
        lines(&out)[..4],
        ["| a | b |", "|---|---|", "| 1 |", "| 4 | 5 |"]
    );
}

#[test]
fn columns_are_added_and_taken_out_with_the_alignment_row_in_step() {
    let text = "| a | b |\n|:--|--:|\n| 1 | 2 |\n";
    let out = run(text, |b| PageStep::TableColumns {
        block: b,
        insert_at: Some(0),
        header: "N".into(),
        align: Some("right".into()),
        cells: vec!["x".into()],
        delete: vec![],
    })
    .unwrap();
    let l = lines(&out);
    assert_eq!(cells(l[0]), ["N", "a", "b"], "{out:?}");
    assert_eq!(cells(l[1]), ["--:", ":--", "--:"], "{out:?}");
    assert_eq!(cells(l[2]), ["x", "1", "2"], "{out:?}");
    // Between, and at the end, in a table with no outer bars and one with an indent.
    for text in [
        "a | b\n--|--\n1 | 2\n",
        "  | a | b |\n  |---|---|\n  | 1 | 2 |\n",
    ] {
        for at in [1, 2] {
            let out = run(text, |b| PageStep::TableColumns {
                block: b,
                insert_at: Some(at),
                header: "N".into(),
                align: Some("center".into()),
                cells: vec!["x".into()],
                delete: vec![],
            })
            .unwrap_or_else(|e| panic!("{text:?} at {at}: {e}"));
            let l = lines(&out);
            let mut want = vec!["a".to_owned(), "b".to_owned()];
            want.insert(at, "N".to_owned());
            assert_eq!(cells(l[0]), want, "{out:?}");
            assert_eq!(cells(l[2]).len(), 3, "{out:?}");
            assert_eq!(cells(l[1])[at], ":-:", "{out:?}");
            assert_eq!(cells(l[2])[at], "x", "{out:?}");
        }
    }
    // Taking a column out keeps the others, even the first of a table with no outer bars.
    let out = run("| a | b | c |\n|---|:-:|---|\n| 1 | 2 | 3 |\n", |b| {
        PageStep::TableColumns {
            block: b,
            insert_at: None,
            header: String::new(),
            align: None,
            cells: vec![],
            delete: vec![1],
        }
    })
    .unwrap();
    assert_eq!(out, "| a | c |\n|---|---|\n| 1 | 3 |\n");
    let out = run("a | b | c\n--|:-:|--\n1 | 2 | 3\n", |b| {
        PageStep::TableColumns {
            block: b,
            insert_at: None,
            header: String::new(),
            align: None,
            cells: vec![],
            delete: vec![0],
        }
    })
    .unwrap();
    assert_eq!(out, "b | c\n:-:|--\n2 | 3\n");
    // Down to one column without bars is no table: refused, nothing written.
    let one = run("a | b\n--|--\n1 | 2\n", |b| PageStep::TableColumns {
        block: b,
        insert_at: None,
        header: String::new(),
        align: None,
        cells: vec![],
        delete: vec![0],
    });
    assert!(one.is_err(), "{one:?}");
}

#[test]
fn rows_are_added_and_taken_out_without_touching_the_others() {
    let text = "| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |\n";
    for text in [
        text.to_owned(),
        text.replace('\n', "\r\n"),
        text.trim_end().to_owned(),
    ] {
        let add = |at| {
            move |b| PageStep::TableRows {
                block: b,
                insert_at: Some(at),
                rows: vec![vec!["x".into()], vec!["y".into(), "z|w".into()]],
                delete: vec![],
            }
        };
        for at in 1..=4 {
            let out = run(&text, add(at)).unwrap_or_else(|e| panic!("{at}: {e}"));
            let l = lines(&out);
            assert_eq!(cells(l[at + 1]), ["x", ""], "{at}: {out:?}");
            assert_eq!(cells(l[at + 2]), ["y", "z\\|w"], "{at}: {out:?}");
            let kept: Vec<&str> = l
                .iter()
                .copied()
                .enumerate()
                .filter(|(n, _)| *n != at + 1 && *n != at + 2)
                .map(|(_, line)| line)
                .collect();
            let had = lines(&text);
            let had: Vec<&str> = had.into_iter().filter(|l| !l.is_empty()).collect();
            let kept: Vec<&str> = kept.into_iter().filter(|l| !l.is_empty()).collect();
            assert_eq!(kept, had, "{at}");
        }
        // Too many cells, the header, and rows that are not there.
        let wide = run(&text, |b| PageStep::TableRows {
            block: b,
            insert_at: Some(1),
            rows: vec![vec!["1".into(), "2".into(), "3".into()]],
            delete: vec![],
        });
        assert!(wide.is_err());
        for bad in [vec![0], vec![9]] {
            let gone = run(&text, |b| PageStep::TableRows {
                block: b,
                insert_at: None,
                rows: vec![],
                delete: bad.clone(),
            });
            assert!(gone.is_err(), "{bad:?}");
        }
        // The first two rows, the last row, and every row.
        for (delete, left) in [
            (vec![1, 2], vec!["| 5 | 6 |"]),
            (vec![3], vec!["| 1 | 2 |", "| 3 | 4 |"]),
            (vec![1, 2, 3], vec![]),
            (vec![3, 2, 1, 1], vec![]),
        ] {
            let out = run(&text, |b| PageStep::TableRows {
                block: b,
                insert_at: None,
                rows: vec![],
                delete: delete.clone(),
            })
            .unwrap_or_else(|e| panic!("{delete:?}: {e}"));
            let l: Vec<&str> = lines(&out).into_iter().filter(|l| !l.is_empty()).collect();
            let mut want = vec!["| a | b |", "|---|---|"];
            want.extend(left);
            assert_eq!(l, want, "{delete:?}: {out:?}");
        }
    }
}

#[test]
fn a_table_after_other_blocks_edits_only_itself() {
    let text = "Intro\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- list\n- items\n\nTail";
    let out = run(text, set(1, 1, "Z")).unwrap();
    assert_eq!(out, text.replace("| 2 |", "| Z |"));
    let out = run(text, |b| PageStep::TableRows {
        block: b,
        insert_at: Some(2),
        rows: vec![vec!["3".into(), "4".into()]],
        delete: vec![],
    })
    .unwrap();
    assert_eq!(
        out,
        "Intro\n\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\n- list\n- items\n\nTail"
    );
}

#[test]
fn rows_added_to_a_table_and_a_block_put_after_it_land_in_their_own_places() {
    let text = "| a | b |\n|---|---|\n| 1 | 2 |\n\nTail\n";
    let blocks = blocks_of(text);
    let t = r(&blocks[0]);
    let rows = PageStep::TableRows {
        block: t.clone(),
        insert_at: Some(2),
        rows: vec![vec!["3".into(), "4".into()]],
        delete: vec![],
    };
    let after = PageStep::Insert {
        before: None,
        after: Some(t),
        at_end_of_heading: None,
        markdown: "Para".into(),
    };
    let want = "| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\nPara\n\nTail\n";
    for steps in [vec![rows.clone(), after.clone()], vec![after, rows]] {
        let (out, _) = edit_text(text, &steps).unwrap();
        assert_eq!(out, want);
    }
    // A column put first in a table with no outer bars goes after text put before the table.
    let text = "Intro\n\na | b\n--|--\n1 | 2\n";
    let blocks = blocks_of(text);
    let t = r(&blocks[1]);
    let column = PageStep::TableColumns {
        block: t.clone(),
        insert_at: Some(0),
        header: "N".into(),
        align: None,
        cells: vec!["x".into()],
        delete: vec![],
    };
    let before = PageStep::Insert {
        before: Some(t),
        after: None,
        at_end_of_heading: None,
        markdown: "Before".into(),
    };
    for steps in [vec![column.clone(), before.clone()], vec![before, column]] {
        let (out, _) = edit_text(text, &steps).unwrap();
        let l = lines(&out);
        assert_eq!(l[0], "Intro", "{out:?}");
        assert_eq!(l[2], "Before", "{out:?}");
        assert_eq!(cells(l[4]), ["N", "a", "b"], "{out:?}");
        assert_eq!(cells(l[6]), ["x", "1", "2"], "{out:?}");
    }
}

#[test]
fn table_steps_that_are_fine_alone_but_not_together_are_refused() {
    let text = "| a | b |\n|---|---|\n| 1 | 2 |\n";
    let blocks = blocks_of(text);
    let t = r(&blocks[0]);
    let gone = |col| PageStep::TableColumns {
        block: t.clone(),
        insert_at: None,
        header: String::new(),
        align: None,
        cells: vec![],
        delete: vec![col],
    };
    // Each keeps a column; together none is left.
    assert!(edit_text(text, &[gone(0)]).is_ok());
    assert!(edit_text(text, &[gone(1)]).is_ok());
    let why = edit_text(text, &[gone(0), gone(1)])
        .unwrap_err()
        .to_string();
    assert!(why.contains("table"), "{why}");
}

#[test]
fn an_empty_cell_at_the_edge_of_a_table_with_no_outer_bars_keeps_its_place() {
    let text = "a | b\n--|--\n1 | 2\n";
    // A first cell emptied: the next cell must not become the first.
    let out = run(text, set(1, 0, "")).unwrap();
    assert_eq!(cells(lines(&out)[2]), ["", "2"], "{out:?}");
    // Rows with an empty first cell and an empty last cell.
    let out = run(text, |b| PageStep::TableRows {
        block: b,
        insert_at: Some(2),
        rows: vec![vec!["".into(), "y".into()], vec!["x".into(), "".into()]],
        delete: vec![],
    })
    .unwrap();
    let l = lines(&out);
    assert_eq!(cells(l[3]), ["", "y"], "{out:?}");
    assert_eq!(cells(l[4]), ["x", ""], "{out:?}");
    // A column added at either edge, with a header or without, and no cells given.
    for (at, header) in [(0usize, "H"), (0, ""), (2, "H"), (2, "")] {
        let out = run(text, |b| PageStep::TableColumns {
            block: b,
            insert_at: Some(at),
            header: header.into(),
            align: None,
            cells: vec![],
            delete: vec![],
        })
        .unwrap_or_else(|e| panic!("{at} {header:?}: {e}"));
        let l = lines(&out);
        let mut head = vec!["a".to_owned(), "b".to_owned()];
        head.insert(at, header.to_owned());
        assert_eq!(cells(l[0]), head, "{out:?}");
        assert_eq!(cells(l[1]).len(), 3, "{out:?}");
        let mut row = vec!["1".to_owned(), "2".to_owned()];
        row.insert(at, String::new());
        assert_eq!(cells(l[2]), row, "{out:?}");
    }
}
