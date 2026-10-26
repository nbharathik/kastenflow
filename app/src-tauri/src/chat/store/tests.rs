//! The store of saved threads: what it writes and reads back, damage, and the caps.

use std::fs;

use kasten_core::Instant;
use kasten_core::agent::Session;
use serde_json::json;

use super::*;
use crate::chat::WriteMode;
use crate::chat::model::Message;
use crate::chat::tests::Scratch;

fn store() -> (Scratch, Store) {
    let dir = Scratch::new();
    let store = Store::open(&dir.0, "/vaults/one");
    (dir, store)
}

fn record(id: &str, updated: u64, status: Status) -> Record {
    Record {
        version: VERSION,
        id: id.to_owned(),
        title: format!("Chat {id}"),
        created: updated,
        updated,
        status,
        provider: "fake".to_owned(),
        model: "model-1".to_owned(),
        settings: None,
        writes: WriteMode::Direct,
        session: Session::start("kasten-chat", Instant::now()),
        system: "The system prompt".to_owned(),
        day: "2026-09-24".to_owned(),
        messages: vec![Message::User("Hello".to_owned())],
        plan: vec![],
        seq: 3,
        change_set: None,
        ui: Some(json!({"title": "Chat", "seq": 3})),
        attachments: vec![],
        archived: false,
        bound: None,
        rev: updated,
    }
}

fn names(store: &Store) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(&store.dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

#[test]
fn a_thread_is_kept_whole_and_read_back_and_listed_newest_first() {
    let (_dir, store) = store();
    store.save(&record("older", 10, Status::Idle)).unwrap();
    let mut newer = record("newer", 20, Status::Paused);
    newer.messages.push(Message::User("More".to_owned()));
    store.save(&newer).unwrap();

    let back = store.load("newer").unwrap();
    assert_eq!(back.messages, newer.messages);
    assert_eq!(
        (back.status, back.seq, back.system.as_str()),
        (Status::Paused, 3, "The system prompt")
    );
    assert_eq!(back.ui, newer.ui);
    let list = store.list();
    let ids: Vec<_> = list.iter().map(|t| t.id.as_str()).collect();
    assert_eq!(ids, ["newer", "older"]);
    assert_eq!(
        (
            list[0].title.as_str(),
            list[0].status,
            list[0].provider.as_str(),
            list[0].model.as_str()
        ),
        ("Chat newer", Status::Paused, "fake", "model-1")
    );
    // One file and its head each, and no half-written leftovers.
    assert_eq!(
        names(&store),
        [
            "newer.head.json",
            "newer.json",
            "older.head.json",
            "older.json"
        ]
    );
    assert!(store.load("nobody").is_none());
}

#[test]
fn the_ids_of_files_are_checked_and_nothing_goes_outside_the_folder() {
    let (_dir, store) = store();
    for bad in ["../x", "a/b", "", ".hidden", "con", "a.head"] {
        assert!(store.save(&record(bad, 1, Status::Idle)).is_err(), "{bad}");
        assert!(store.load(bad).is_none(), "{bad}");
        assert!(!store.delete(bad), "{bad}");
    }
    assert!(store.list().is_empty());
}

#[test]
fn a_thread_that_does_not_read_is_set_aside_and_never_fatal() {
    let (_dir, store) = store();
    store.save(&record("good", 10, Status::Idle)).unwrap();
    store.save(&record("broken", 20, Status::Idle)).unwrap();
    fs::write(store.record_path("broken"), b"{ not json").unwrap();
    fs::write(store.head_path("broken"), b"also not").unwrap();

    let ids: Vec<_> = store.list().into_iter().map(|t| t.id).collect();
    assert_eq!(ids, ["good"], "the broken one is left out");
    assert!(store.load("broken").is_none());
    let files = names(&store);
    assert!(files.contains(&"broken.json.bad".to_owned()), "{files:?}");
    assert!(!files.contains(&"broken.json".to_owned()));
    // And the folder still takes new threads.
    store.save(&record("broken", 30, Status::Idle)).unwrap();
    assert!(store.load("broken").is_some());
}

#[test]
fn a_missing_or_damaged_head_is_made_again_from_the_thread() {
    let (_dir, store) = store();
    store.save(&record("a", 10, Status::Paused)).unwrap();
    fs::write(store.head_path("a"), b"???").unwrap();
    assert_eq!(store.list()[0].status, Status::Paused);
    let head: Head = serde_json::from_slice(&fs::read(store.head_path("a")).unwrap()).unwrap();
    assert_eq!(head.summary.id, "a");
    assert!(head.bytes > 0);
}

#[test]
fn a_file_of_a_newer_version_is_left_alone() {
    let (_dir, store) = store();
    let mut future = record("later", 10, Status::Idle);
    future.version = VERSION + 1;
    store.save(&future).unwrap();
    assert!(store.load("later").is_none());
    assert!(
        names(&store).iter().all(|n| !n.ends_with(".bad")),
        "it is not damaged, so it is not set aside"
    );
}

#[test]
fn an_older_snapshot_never_replaces_a_newer_one() {
    let (_dir, store) = store();
    let mut newer = record("t", 10, Status::Idle);
    newer.rev = 5;
    newer.title = "Newer".to_owned();
    let mut older = record("t", 10, Status::Idle);
    older.rev = 4;
    older.title = "Older".to_owned();
    store.save(&newer).unwrap();
    store.save(&older).unwrap();
    assert_eq!(store.load("t").unwrap().title, "Newer");
    older.rev = 6;
    store.save(&older).unwrap();
    assert_eq!(store.load("t").unwrap().title, "Older");
}

#[test]
fn no_number_of_threads_ever_makes_one_go_and_the_room_they_take_is_only_reported() {
    let (dir, store) = store();
    assert_eq!(
        store.usage(),
        Usage {
            threads: 0,
            bytes: 0
        }
    );
    for i in 0..120 {
        let status = if i % 3 == 0 {
            Status::Idle
        } else {
            Status::Paused
        };
        store
            .save(&record(&format!("c{i}"), 10 + i, status))
            .unwrap();
    }
    // Far past what a person keeps: every one is still there, oldest included.
    let ids: Vec<_> = store.list().into_iter().map(|t| t.id).collect();
    assert_eq!(ids.len(), 120);
    assert!(ids.contains(&"c0".to_owned()) && ids.contains(&"c119".to_owned()));
    let on_disk: u64 = fs::read_dir(&store.dir)
        .unwrap()
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().ends_with(".json"))
        .filter(|e| !e.file_name().to_string_lossy().ends_with(".head.json"))
        .map(|e| e.metadata().unwrap().len())
        .sum();
    let used = store.usage();
    assert_eq!((used.threads, used.bytes), (120, on_disk));
    // A fresh start, the same: opening and interrupting delete nothing either.
    let again = Store::open(&dir.0, "/vaults/one");
    again.interrupt_the_working();
    assert_eq!(again.usage(), used);
    // Only the person's own delete takes one away, and the report follows.
    assert!(again.delete("c0"));
    assert_eq!(again.usage().threads, 119);
    assert!(again.usage().bytes < used.bytes);
}

#[test]
fn a_thread_found_working_at_start_is_interrupted() {
    let (dir, store) = store();
    store.save(&record("busy", 10, Status::Running)).unwrap();
    store.save(&record("calm", 20, Status::Idle)).unwrap();
    // The app starts again.
    let store = Store::open(&dir.0, "/vaults/one");
    store.interrupt_the_working();
    assert_eq!(store.load("busy").unwrap().status, Status::Interrupted);
    assert_eq!(store.load("calm").unwrap().status, Status::Idle);
    let by_id: Vec<_> = store.list().into_iter().map(|t| (t.id, t.status)).collect();
    assert_eq!(
        by_id,
        [
            ("calm".to_owned(), Status::Idle),
            ("busy".to_owned(), Status::Interrupted)
        ]
    );
}

#[test]
fn deleting_removes_the_thread_and_its_head_and_what_it_referred_to_is_known() {
    let (_dir, store) = store();
    let mut with = record("with", 10, Status::Idle);
    with.attachments = vec!["a".repeat(64)];
    with.change_set = Some("S".repeat(26));
    store.save(&with).unwrap();
    store.save(&record("without", 20, Status::Idle)).unwrap();
    let attachments: HashSet<String> = ["a".repeat(64)].into();
    assert_eq!(store.referenced_attachments(), attachments);
    assert!(store.delete("with"));
    assert!(!store.delete("with"));
    assert!(store.referenced_attachments().is_empty());
    assert_eq!(names(&store), ["without.head.json", "without.json"]);
}

#[test]
fn a_saved_thread_holds_no_key_or_token() {
    let (_dir, store) = store();
    store.save(&record("t", 1, Status::Idle)).unwrap();
    let text = fs::read_to_string(store.record_path("t")).unwrap();
    for secret in [
        "Bearer",
        "api_key",
        "apiKey",
        "refresh_token",
        "sk-",
        "x-api-key",
    ] {
        assert!(!text.contains(secret), "{secret}");
    }
}
