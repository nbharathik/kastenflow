//! Real days and times in the index: to-dos and day mentions keep the
//! clock time that follows their day, days that are not on the calendar
//! are only text, and an index from before times existed is rebuilt.

use crate::common;

use std::fs;

use common::{NOW, dev_vault};
use kasten_core::frontmatter::split;
use kasten_core::history::Actor;
use kasten_core::index::Index;
use kasten_core::{Kasten, Saved};

fn index_of(t: &common::TempVault) -> Index {
    let mut index = Index::open(&t.vault.root().join(".kasten/cache/index.sqlite")).unwrap();
    index.rebuild(&t.vault).unwrap();
    index
}

const PLAN: &str = "---\ntitle: Plan\n---\nKickoff [[2026-10-07]] 09:00 with the team.\nLunch with Sam @2026-10-08 12:30\nReview [[2026-10-09]] later.\nLate [[2026-10-10]] 25:00 call.\n- [ ] Call Sam [[2026-10-07]] 14:15\n- [ ] Book room @2026-10-08 9:05\n- [ ] Pay rent [[2026-10-09]]\n- [ ] Not a day [[2026-02-30]] 10:00\n- [ ] Not a day either @2026-13-45\n- [x] Sign form 📅 2026-10-11 16:00\n";

#[test]
fn to_dos_keep_their_day_and_time() {
    let t = dev_vault();
    fs::write(t.vault.root().join("library/plan.md"), PLAN).unwrap();
    let index = index_of(&t);
    let tasks: Vec<(String, Option<String>, Option<String>)> = index
        .tasks()
        .unwrap()
        .into_iter()
        .filter(|row| row.path == "library/plan.md")
        .map(|row| (row.text, row.due, row.at))
        .collect();
    let some = |s: &str| Some(s.to_owned());
    assert_eq!(
        tasks,
        [
            (
                "Call Sam 2026-10-07 14:15".to_owned(),
                some("2026-10-07"),
                some("14:15")
            ),
            (
                "Book room @2026-10-08 9:05".to_owned(),
                some("2026-10-08"),
                some("09:05")
            ),
            ("Pay rent 2026-10-09".to_owned(), some("2026-10-09"), None),
            ("Not a day 2026-02-30 10:00".to_owned(), None, None),
            ("Not a day either @2026-13-45".to_owned(), None, None),
            (
                "Sign form 📅 2026-10-11 16:00".to_owned(),
                some("2026-10-11"),
                None
            ),
        ]
    );
}

#[test]
fn day_mentions_keep_their_time() {
    let t = dev_vault();
    fs::write(t.vault.root().join("library/plan.md"), PLAN).unwrap();
    let index = index_of(&t);
    let mentions: Vec<(String, Option<String>)> = index
        .day_mentions("2026-10-01", "2026-10-31")
        .unwrap()
        .into_iter()
        .filter(|m| m.path == "library/plan.md")
        .map(|m| (m.day, m.at))
        .collect();
    let some = |s: &str| Some(s.to_owned());
    // Lines that are to-dos are tasks, not mentions; `@date` is no link.
    assert_eq!(
        mentions,
        [
            ("2026-10-07".to_owned(), some("09:00")),
            ("2026-10-09".to_owned(), None),
            ("2026-10-10".to_owned(), None),
        ]
    );
}

#[test]
fn a_time_is_read_only_after_a_day_that_exists() {
    let t = dev_vault();
    fs::write(
        t.vault.root().join("library/plan.md"),
        "---\ntitle: Plan\n---\nSee [[2026-02-30]] 09:00 and [[2026-13-45]].\nReal [[2024-02-29]] 08:00.\n",
    )
    .unwrap();
    let index = index_of(&t);
    // The link text is still a link (it may name a page); the time is read
    // only after a day that exists, and the leap day is one.
    let all = index.day_mentions("2024-01-01", "2026-12-31").unwrap();
    let leap = all.iter().find(|m| m.day == "2024-02-29").unwrap();
    assert_eq!(leap.at.as_deref(), Some("08:00"));
    for m in all.iter().filter(|m| m.path == "library/plan.md") {
        if m.day != "2024-02-29" {
            assert_eq!(m.at, None, "{m:?}");
        }
    }
}

#[test]
fn the_day_times_fixture_is_read_and_saved_as_written() {
    let t = dev_vault();
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/roundtrip/34-day-times.md");
    let text = fs::read_to_string(fixture).unwrap();
    fs::write(t.vault.root().join("library/day-times.md"), &text).unwrap();
    let k = Kasten::open(t.vault.root()).unwrap();
    let note = k.read("library/day-times.md").unwrap();
    assert_eq!(note.text, text);
    // Saving what it holds changes no byte.
    let body = split(&note.text).body.to_owned();
    let saved = k
        .save_body(
            &Actor::Human,
            "library/day-times.md",
            &body,
            &note.hash,
            NOW,
        )
        .unwrap();
    assert!(matches!(saved, Saved::Unchanged { .. }), "{saved:?}");
    assert_eq!(
        fs::read_to_string(t.vault.root().join("library/day-times.md")).unwrap(),
        text
    );

    let some = |s: &str| Some(s.to_owned());
    let tasks: Vec<(Option<String>, Option<String>)> = k
        .tasks()
        .unwrap()
        .into_iter()
        .filter(|row| row.path == "library/day-times.md")
        .map(|row| (row.due, row.at))
        .collect();
    assert_eq!(
        tasks,
        [
            (some("2026-10-07"), some("14:15")),
            (some("2026-10-08"), some("09:05")),
            (some("2026-10-01"), None),
            (some("2026-10-11"), None),
            (some("2024-02-29"), some("08:00")),
            // Past 23:59, in the afternoon style, glued on, or not a day.
            (some("2026-10-07"), None),
            (some("2026-10-07"), None),
            (None, None),
            (None, None),
            (some("2026-10-07"), None),
        ]
    );
    let mentions: Vec<(String, Option<String>)> = k
        .day_mentions("2026-10-01", "2026-10-31")
        .unwrap()
        .into_iter()
        .filter(|m| m.path == "library/day-times.md")
        .map(|m| (m.day, m.at))
        .collect();
    assert_eq!(
        mentions,
        [
            ("2026-10-07".to_owned(), some("09:00")),
            ("2026-10-08".to_owned(), some("09:05")),
        ]
    );
}

/// Turns an index file into one an older Kasten wrote: no `at` columns, and
/// the schema number it had.
fn make_old(t: &common::TempVault) {
    let conn =
        rusqlite::Connection::open(t.vault.root().join(".kasten/cache/index.sqlite")).unwrap();
    conn.execute_batch(
        "ALTER TABLE tasks DROP COLUMN at;
         ALTER TABLE links DROP COLUMN at;
         DROP INDEX notes_parent;
         UPDATE meta SET value = '4' WHERE key = 'schema';",
    )
    .unwrap();
}

#[test]
fn an_index_from_before_times_is_rebuilt_when_the_vault_opens() {
    let t = dev_vault();
    fs::write(t.vault.root().join("library/plan.md"), PLAN).unwrap();
    {
        let k = Kasten::open(t.vault.root()).unwrap();
        assert!(k.tasks().unwrap().iter().any(|row| row.at.is_some()));
    }
    make_old(&t);
    let k = Kasten::open(t.vault.root()).unwrap();
    let at: Vec<Option<String>> = k
        .tasks()
        .unwrap()
        .into_iter()
        .filter(|row| row.path == "library/plan.md" && row.due.as_deref() == Some("2026-10-07"))
        .map(|row| row.at)
        .collect();
    assert_eq!(at, [Some("14:15".to_owned())]);
    assert!(
        k.day_mentions("2026-10-01", "2026-10-31")
            .unwrap()
            .iter()
            .any(|m| m.at.as_deref() == Some("09:00"))
    );
    // Everything else is as it was: every note is back.
    assert_eq!(k.list().unwrap().len(), t.vault.notes().unwrap().len());
    // And it is the new index now: opening again does not rebuild it.
    drop(k);
    let conn =
        rusqlite::Connection::open(t.vault.root().join(".kasten/cache/index.sqlite")).unwrap();
    let version: String = conn
        .query_row("SELECT value FROM meta WHERE key = 'schema'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(version, "5");
}
