//! The vault's change counters: one more for `all` and for each kind of file
//! a change touches, nothing for a refused op or a read, and a listener told
//! after the write lock is free.

use crate::common;
use crate::deck_support::deck;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::time::Duration;

use common::{NOW, dev_vault};
use kasten_core::graph::Scope;
use kasten_core::history::Actor;
use kasten_core::{Kasten, Revision, RevisionArea, WriteLock, area_of};
use serde_json::json;

const SCORE: &str = "projects/photo-organiser/cards/duplicate-score-for-photos.md";

fn open() -> (common::TempVault, Kasten) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k)
}

/// What changed between two readings, as `[all, notes, boards, decks, tags, references, collections, annotations]`.
fn moved(before: &Revision, after: &Revision) -> [u64; 8] {
    [
        after.all - before.all,
        after.notes - before.notes,
        after.boards - before.boards,
        after.decks - before.decks,
        after.tags - before.tags,
        after.references - before.references,
        after.collections - before.collections,
        after.annotations - before.annotations,
    ]
}

#[test]
fn each_kind_of_file_has_its_counter() {
    use RevisionArea::*;
    let cases = [
        ("library/a.md", Some(Notes)),
        ("projects/p/pages/b.MD", Some(Notes)),
        (".trash/20261011T000000Z/library/a.md", Some(Notes)),
        ("projects/p/boards/c.canvas", Some(Boards)),
        ("library/d.deck", Some(Decks)),
        ("library/e.drawio", Some(Decks)),
        ("library/e.drawio.svg", Some(Decks)),
        ("sources/references.bib", Some(References)),
        ("tags/task.yaml", Some(Tags)),
        ("views/open-tasks.yaml", Some(Collections)),
        ("library/a.comments.json", Some(Annotations)),
        ("sources/paper.highlights.json", Some(Annotations)),
        ("assets/picture.png", None),
        (".kasten/config.yaml", None),
        ("templates/slides/x.json", None),
        ("other/tags/task.yaml", None),
    ];
    for (path, area) in cases {
        assert_eq!(area_of(path), area, "{path}");
    }
}

#[test]
fn a_vault_opens_with_counters_at_zero_and_a_time() {
    let (_t, k) = open();
    let r = k.revision();
    assert!(r.epoch > 1_700_000_000_000, "{r:?}");
    assert_eq!(
        moved(
            &Revision {
                epoch: r.epoch,
                ..Revision::default()
            },
            &r
        ),
        [0; 8]
    );
}

#[test]
fn an_op_adds_one_to_all_and_one_to_the_kinds_it_touched() {
    let (_t, k) = open();
    let read = k.read(SCORE).unwrap();

    let a = k.revision();
    let body = format!(
        "{}\nMore.\n",
        kasten_core::frontmatter::split(&read.text).body
    );
    k.save_body(&Actor::Human, SCORE, &body, &read.hash, NOW)
        .unwrap();
    let b = k.revision();
    assert_eq!(moved(&a, &b), [1, 1, 0, 0, 0, 0, 0, 0], "a note");

    k.create_board(&Actor::Human, "Map", None, NOW).unwrap();
    let c = k.revision();
    assert_eq!(moved(&b, &c), [1, 0, 1, 0, 0, 0, 0, 0], "a board");

    k.create_deck(
        &Actor::Human,
        "Talk",
        None,
        &deck("Talk", &[("a", "Hi")]),
        NOW,
    )
    .unwrap();
    let d = k.revision();
    assert_eq!(moved(&c, &d), [1, 0, 0, 1, 0, 0, 0, 0], "a deck");

    let schema =
        json!({"properties": [{"key": "status", "type": "select", "options": ["A", "B"]}]});
    k.write_tag_schema(&Actor::Human, "stage", &schema, NOW)
        .unwrap();
    let e = k.revision();
    assert_eq!(moved(&d, &e), [1, 0, 0, 0, 1, 0, 0, 0], "a tag schema");
    assert_eq!(e.epoch, a.epoch);
}

#[test]
fn an_op_that_touches_notes_and_boards_counts_once_for_all() {
    let (_t, k) = open();
    let before = k.revision();
    // The card is on a board: moving the note moves the file and rewrites the board's card.
    k.move_note(&Actor::Human, SCORE, None).unwrap();
    let after = k.revision();
    let [all, notes, boards, ..] = moved(&before, &after);
    assert_eq!((all, notes, boards), (1, 1, 1));
}

#[test]
fn a_refused_op_or_a_read_leaves_the_counters_alone() {
    let (_t, k) = open();
    let before = k.revision();
    assert!(k.create_board(&Actor::Human, "  ", None, NOW).is_err());
    assert!(k.rename(&Actor::Human, SCORE, "Bad [title]", NOW).is_err());
    assert!(k.read("library/no-such-note.md").is_err());
    k.list().unwrap();
    k.boards().unwrap();
    k.graph(&Scope::Vault).unwrap();
    k.note_stats().unwrap();
    assert_eq!(k.revision(), before);
}

#[test]
fn changes_made_outside_count_when_the_watcher_reports_them() {
    let (t, k) = open();
    let before = k.revision();
    std::fs::write(
        t.vault.root().join("library/outside.md"),
        "---\ntitle: Outside\n---\nHi\n",
    )
    .unwrap();
    k.outside_changes(
        &["library/outside.md".into(), "library/outside.canvas".into()],
        5,
    );
    let after = k.revision();
    assert_eq!(moved(&before, &after), [1, 1, 1, 0, 0, 0, 0, 0]);
    k.outside_changes(&[], 6);
    assert_eq!(k.revision(), after);
}

#[test]
fn the_listener_hears_each_change_after_the_write_lock_is_free() {
    let (t, k) = open();
    let root = t.vault.root().to_path_buf();
    let heard: Arc<Mutex<Vec<(Revision, bool)>>> = Arc::default();
    let record = heard.clone();
    assert!(k.on_revision(move |revision| {
        // Another thread takes the write lock now: it can only if the op that
        // told us has let go of it.
        let (tx, rx) = mpsc::channel();
        let root = root.clone();
        std::thread::spawn(move || {
            WriteLock::new(&root).hold(|| Ok(())).unwrap();
            let _ = tx.send(());
        });
        let free = rx.recv_timeout(Duration::from_secs(10)).is_ok();
        record.lock().unwrap().push((revision, free));
    }));
    assert!(!k.on_revision(|_| {}), "only the first listener is kept");

    k.create_board(&Actor::Human, "One", None, NOW).unwrap();
    k.create_board(&Actor::Human, "Two", None, NOW).unwrap();
    assert!(k.create_board(&Actor::Human, "", None, NOW).is_err());
    k.outside_changes(&["library/x.md".into()], 1);

    let heard = heard.lock().unwrap();
    assert_eq!(heard.len(), 3, "a refused op tells no one");
    assert!(
        heard.iter().all(|(_, free)| *free),
        "the lock was still held"
    );
    let alls: Vec<u64> = heard.iter().map(|(r, _)| r.all).collect();
    assert_eq!(alls, [1, 2, 3]);
    assert_eq!(heard[1].0.boards, 2);
    assert_eq!(heard[2].0, k.revision());
}

#[test]
fn writes_from_several_threads_are_all_counted() {
    let (_t, k) = open();
    let k = Arc::new(k);
    let calls = Arc::new(AtomicUsize::new(0));
    let counted = calls.clone();
    k.on_revision(move |_| {
        counted.fetch_add(1, Ordering::SeqCst);
    });
    let handles: Vec<_> = (0..4)
        .map(|t| {
            let k = k.clone();
            std::thread::spawn(move || {
                for n in 0..5 {
                    k.create_board(&Actor::Human, &format!("Board {t}-{n}"), None, NOW)
                        .unwrap();
                }
            })
        })
        .collect();
    for h in handles {
        h.join().unwrap();
    }
    let r = k.revision();
    assert_eq!((r.all, r.boards), (20, 20));
    assert_eq!(calls.load(Ordering::SeqCst), 20);
}
