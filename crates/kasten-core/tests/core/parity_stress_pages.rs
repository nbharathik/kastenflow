//! The parity ops that write into a page, a saved search or the journal,
//! under attack: hostile header values, to-dos with CRLF and code, names
//! that look like YAML, and days at the edges of the calendar. Every other
//! byte of what they touch must stay.

use std::fs;

use crate::change_sets::open;
use crate::common::NOW;
use crate::parity::refused;
use crate::structure::{done, page};
use kasten_core::Outcome;
use kasten_core::agent::AgentOp;
use kasten_core::frontmatter::split;

const STYLED: &str = "---\nid: 01STYLEDNOTE00000000000000\ntitle: Styled\ntype: page\n# kept as written\nx-other: {a: 1, b: [2, 3]}\nupdated: 2026-01-01T00:00:00Z\n---\nBody stays.\r\n\nMore.\n";

fn write_note(t: &crate::common::TempVault, rel: &str, text: &str) {
    fs::write(t.vault.root().join(rel), text).unwrap();
}

fn meta(path: &str, key: &str, value: &str) -> AgentOp {
    AgentOp::SetNoteMeta {
        path: path.into(),
        key: key.into(),
        value: Some(value.into()),
    }
}

#[test]
fn a_header_setting_changes_its_own_line_and_the_updated_time_and_nothing_else() {
    let (t, k, s) = open();
    let path = "library/styled.md";
    write_note(&t, path, STYLED);
    let nasty = [
        "a: b",
        "x # y",
        "---",
        "- item",
        "{a: 1}",
        "[1, 2]",
        "&anchor",
        "*alias",
        "!!str tagged",
        "'quoted'",
        "\"double\"",
        "yes",
        "null",
        "0x1F",
        "title: hacked",
        "a\u{2028}title: hacked",
        "a\u{2029}title: hacked",
        "\\",
        "%",
        "é 📘",
    ];
    for value in nasty {
        let outcome = k.agent_run(&s, &meta(path, "icon", value), NOW);
        match outcome {
            Ok(_) => {
                let note = k.read(path).unwrap();
                assert_eq!(note.meta.title, "Styled", "{value:?}");
                assert_eq!(note.meta.id.as_deref(), Some("01STYLEDNOTE00000000000000"));
                assert_eq!(note.meta.kind, "page", "{value:?}");
                assert!(!note.meta.locked, "{value:?}");
                assert_eq!(note.meta.icon.as_deref(), Some(value), "{value:?}");
                let body = split(&note.text).body;
                assert_eq!(body, "Body stays.\r\n\nMore.\n", "{value:?}");
                let prefix = split(&note.text).prefix;
                assert!(prefix.contains("# kept as written\n"), "{prefix}");
                assert!(prefix.contains("x-other: {a: 1, b: [2, 3]}\n"), "{prefix}");
            }
            Err(err) => {
                // A refusal writes nothing.
                let text = fs::read_to_string(t.vault.root().join(path)).unwrap();
                assert!(!text.contains("hacked"), "{value:?}: {err}");
            }
        }
    }
}

#[test]
fn only_the_listed_settings_can_be_set_and_never_with_a_line_break() {
    let (t, k, s) = open();
    let path = "library/styled.md";
    write_note(&t, path, STYLED);
    let before = fs::read_to_string(t.vault.root().join(path)).unwrap();
    for key in [
        "locked", "LOCKED", "id", "parent", "title", "type", "opens", "x-other", "", "icon\nid",
    ] {
        let _ = refused(&k, &s, &meta(path, key, "true"));
    }
    for value in ["a\nid: 01OTHER", "a\r\nlocked: true", "tab\there", "\u{0}"] {
        let _ = refused(&k, &s, &meta(path, "icon", value));
    }
    // A long value is refused, well under the size limit of a write.
    let long = "x".repeat(10_000);
    assert!(refused(&k, &s, &meta(path, "icon", &long)).contains("is short"));
    let huge = "x".repeat(300_000);
    let _ = refused(&k, &s, &meta(path, "icon", &huge));
    assert_eq!(
        fs::read_to_string(t.vault.root().join(path)).unwrap(),
        before,
        "refusals write nothing"
    );
}

#[test]
fn a_setting_taken_off_leaves_the_rest_as_it_was() {
    let (t, k, s) = open();
    let path = "library/styled.md";
    write_note(&t, path, STYLED);
    done(k.agent_run(&s, &meta(path, "font", "mono"), NOW).unwrap());
    let off = AgentOp::SetNoteMeta {
        path: path.into(),
        key: "font".into(),
        value: None,
    };
    done(k.agent_run(&s, &off, NOW).unwrap());
    let after = fs::read_to_string(t.vault.root().join(path)).unwrap();
    // Only `updated` differs from what the person wrote.
    assert_eq!(
        after.replace(
            after.lines().find(|l| l.starts_with("updated:")).unwrap(),
            "updated: 2026-01-01T00:00:00Z"
        ),
        STYLED
    );
}

fn tasks_note() -> String {
    "---\nid: 01TASKNOTE0000000000000000\ntitle: Chores\ntype: page\n---\n- [ ] wash up\r\n- [x] shop\r\n  - [ ] nested\r\n\r\n```\r\n- [ ] in code\r\n```\r\n\r\n> - [ ] quoted\r\n1. [ ] numbered [x] later\r\n".to_owned()
}

#[test]
fn a_to_do_is_ticked_by_line_changing_only_its_check_box_even_with_crlf() {
    let (t, k, s) = open();
    let path = "library/chores.md";
    write_note(&t, path, &tasks_note());
    let note = k.read(path).unwrap();
    let body = split(&note.text).body.to_owned();
    let tasks = kasten_core::extract::extract(&body).tasks;
    let tick = |line: usize, done_: bool, base: &str| AgentOp::SetTask {
        path: path.into(),
        line: line as u32,
        done: done_,
        base: base.into(),
    };
    let mut hash = note.hash.clone();
    let mut expected = body.clone();
    for task in &tasks {
        let outcome = k.agent_run(&s, &tick(task.line, !task.done, &hash), NOW);
        let Ok(Outcome::Done { result }) = outcome else {
            // The line in code is no to-do; the rest are.
            panic!("line {} ({}) refused: {outcome:?}", task.line, task.text);
        };
        hash = result["hash"].as_str().unwrap().to_owned();
        let at: usize = expected
            .split_inclusive('\n')
            .take(task.line)
            .map(str::len)
            .sum();
        let box_at = at + expected[at..].find('[').unwrap();
        let flipped = if task.done { "[ ]" } else { "[x]" };
        expected.replace_range(box_at..box_at + 3, flipped);
        // Only that check box differs: the CRLF endings and every other byte stay.
        let now_text = k.read(path).unwrap().text;
        assert_eq!(split(&now_text).body, expected, "after {}", task.text);
    }
    // The line in the code fence is not a to-do and nothing ticks it.
    let code_line = body
        .split_inclusive('\n')
        .position(|l| l.contains("in code"))
        .unwrap();
    let why = refused(&k, &s, &tick(code_line, true, &hash));
    assert!(why.contains("not a to-do"), "{why}");
    let beyond = refused(&k, &s, &tick(9_999, true, &hash));
    assert!(beyond.contains("not a to-do"), "{beyond}");
    assert_eq!(split(&k.read(path).unwrap().text).body, expected);
}

#[test]
fn a_saved_search_name_cannot_carry_other_keys_into_its_file() {
    let (t, k, s) = open();
    for name in [
        "a: b\nlocked: true",
        "x: y",
        "---",
        "# comment",
        "ends: ",
        "tab\there",
        "\u{2028}split",
    ] {
        let op = AgentOp::CreateCollection {
            name: name.into(),
            edits: serde_json::json!({ "query": "#x" })
                .as_object()
                .unwrap()
                .clone(),
        };
        let before = k.collections().unwrap().len();
        match k.agent_run(&s, &op, NOW) {
            Ok(_) => {
                let all = k.collections().unwrap();
                assert_eq!(all.len(), before + 1, "{name:?}");
                assert!(all.iter().all(|c| c.problem.is_none()), "{name:?}");
                assert!(all.iter().any(|c| c.name == name.trim()), "{name:?}");
            }
            Err(_) => assert_eq!(k.collections().unwrap().len(), before, "{name:?}"),
        }
    }
    // Whatever was made sits in views/ and nowhere else.
    for entry in fs::read_dir(t.vault.root()).unwrap() {
        let name = entry.unwrap().file_name().to_string_lossy().into_owned();
        assert!(!name.contains("locked"), "{name}");
    }
}

#[test]
fn the_extreme_days_of_the_journal_and_a_second_copy_do_not_break_anything() {
    let (t, k, s) = open();
    for day in ["0001-01-01", "9999-12-31", "2024-02-29"] {
        let op = AgentOp::JournalDay { date: day.into() };
        done(k.agent_run(&s, &op, NOW).unwrap());
        let path = format!("journal/{}/{day}.md", &day[..4]);
        assert!(t.vault.root().join(path).exists(), "{day}");
    }
    for day in [
        "2023-02-29",
        "2026-13-01",
        "2026-1-1",
        "２０２６-01-01",
        "2026-01-01\n",
    ] {
        let op = AgentOp::JournalDay { date: day.into() };
        assert!(refused(&k, &s, &op).contains("Not a day"), "{day:?}");
    }
    let original = page(&k, "Alpha", None, None);
    let copy = AgentOp::DuplicateNote {
        path: original.meta.path.clone(),
    };
    let first = done(k.agent_run(&s, &copy, NOW).unwrap())["path"]
        .as_str()
        .unwrap()
        .to_owned();
    let second = done(k.agent_run(&s, &copy, NOW).unwrap())["path"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(first != second && first != original.meta.path && second != original.meta.path);
    assert!(k.read(&first).is_ok() && k.read(&second).is_ok());
}
