//! The chat list's size and the archive: the oldest threads past the size
//! are archived and nothing is deleted for it; only a person's own call
//! deletes, and only archived chats they name. A reset or a new thread keeps
//! the saved one.

use std::fs;
use std::path::PathBuf;

use kasten_core::Instant;
use kasten_core::agent::Session;
use serde_json::json;

use super::store::{open, store_of};
use super::turns::{request, turn};
use super::{Fake, Scratch, Seen, Step, Vault, vault};
use crate::chat::WriteMode;
use crate::chat::limit::ChatLimits;
use crate::chat::model::{Message, Stop};
use crate::chat::store::{Record, Status, VERSION, valid_id, vault_hash};
use crate::chat::threads::Chats;

/// A saved thread last changed at `updated`.
pub(super) fn saved(id: &str, updated: u64) -> Record {
    Record {
        version: VERSION,
        id: id.to_owned(),
        title: format!("Chat {id}"),
        created: updated,
        updated,
        status: Status::Idle,
        provider: "fake".to_owned(),
        model: String::new(),
        settings: None,
        writes: WriteMode::Direct,
        session: Session::start("kasten-chat", Instant::now()),
        system: "system".to_owned(),
        day: "2026-09-24".to_owned(),
        messages: vec![Message::User(format!("Question of {id}"))],
        plan: vec![],
        seq: 1,
        change_set: None,
        ui: Some(json!({"title": format!("Chat {id}"), "seq": 1})),
        attachments: vec![],
        archived: false,
        bound: None,
        rev: updated,
    }
}

fn folder(data: &Scratch, v: &Vault) -> PathBuf {
    data.0
        .join("chats")
        .join(vault_hash(&v.kasten.root().display().to_string()))
}

/// 35 saved threads, c0 the oldest; the app opens them with the list at 30.
fn thirty_five() -> (super::Vault, Scratch, Chats) {
    let v = vault();
    let data = Scratch::new();
    let store = store_of(&data, &v);
    for n in 0..35u64 {
        store.save(&saved(&format!("c{n}"), 1_000 + n)).unwrap();
    }
    let chats = open(&data, &v);
    (v, data, chats)
}

fn archived(chats: &Chats) -> Vec<String> {
    let mut ids: Vec<String> = chats
        .list()
        .into_iter()
        .filter(|t| t.archived)
        .map(|t| t.id)
        .collect();
    ids.sort();
    ids
}

#[test]
fn the_oldest_beyond_the_list_size_are_archived_and_nothing_is_deleted() {
    let (v, data, chats) = thirty_five();
    assert_eq!(archived(&chats), ["c0", "c1", "c2", "c3", "c4"]);
    // Every thread is still there: listed, its files in place, and loadable.
    assert_eq!(chats.list().len(), 35);
    let files = fs::read_dir(folder(&data, &v)).unwrap().count();
    assert_eq!(files, 70, "a record and a head for each of the 35");
    let head = fs::read_to_string(folder(&data, &v).join("c0.head.json")).unwrap();
    assert!(head.contains("\"archived\":true"), "{head}");
    let back = chats.loaded("c0", &v.kasten).unwrap();
    assert!(back.archived);
    assert_eq!(back.title, "Chat c0");
    assert_eq!(chats.usage().threads, 35);
    // Opening again, as often as it likes, changes nothing more.
    let again = open(&data, &v);
    assert_eq!(archived(&again), ["c0", "c1", "c2", "c3", "c4"]);
    assert_eq!(again.list().len(), 35);
    // A new message brings the list to 31 unarchived, so the oldest of them goes.
    let model = Fake::new(vec![Step::Reply("Hi.", vec![], Stop::End)]);
    turn(&again, &v, &model, &Seen::new(), request("fresh", "Hello"));
    assert_eq!(archived(&again).len(), 6);
    assert!(archived(&again).contains(&"c5".to_owned()));
    assert_eq!(again.list().len(), 36, "still nothing deleted");
}

#[test]
fn a_smaller_list_size_archives_more_and_a_larger_one_does_not_bring_them_back() {
    let (_v, _data, chats) = thirty_five();
    chats.set_limits(ChatLimits {
        list_size: 10,
        max_concurrent: 3,
    });
    assert_eq!(archived(&chats).len(), 25);
    assert_eq!(chats.list().len(), 35);
    let newest: Vec<String> = chats
        .list()
        .into_iter()
        .filter(|t| !t.archived)
        .map(|t| t.id)
        .collect();
    assert_eq!(newest.len(), 10);
    assert!(newest.contains(&"c34".to_owned()) && newest.contains(&"c25".to_owned()));
    chats.set_limits(ChatLimits {
        list_size: 200,
        max_concurrent: 3,
    });
    assert_eq!(
        archived(&chats).len(),
        25,
        "a person brings a chat back, not a setting"
    );
}

#[test]
fn writing_in_an_archived_chat_or_reopening_it_brings_it_to_the_top() {
    let (v, _data, chats) = thirty_five();
    assert!(chats.unarchive("c2").unwrap());
    assert!(!archived(&chats).contains(&"c2".to_owned()));
    assert!(
        archived(&chats).contains(&"c5".to_owned()),
        "the next oldest makes room"
    );
    assert_eq!(chats.list()[0].id, "c2", "it is the newest now");
    assert!(!chats.unarchive("nobody").unwrap());
    // A message to an archived chat does the same.
    let model = Fake::new(vec![Step::Reply("Back.", vec![], Stop::End)]);
    turn(&chats, &v, &model, &Seen::new(), request("c0", "Again"));
    assert!(!archived(&chats).contains(&"c0".to_owned()));
    assert_eq!(model.sent()[0].len(), 2, "with its earlier question");
}

#[test]
fn deleting_archived_chats_is_the_persons_call_and_only_archived_ones_they_name() {
    let (v, data, chats) = thirty_five();
    let names: Vec<String> = ["c0", "c1", "c34", "nobody", "c0"]
        .iter()
        .map(|s| (*s).to_owned())
        .collect();
    let done = chats.delete_archived(&names, &v.kasten);
    assert_eq!(done.deleted, ["c0", "c1"]);
    assert_eq!(done.count, 2);
    let why: Vec<(&str, &str)> = done
        .skipped
        .iter()
        .map(|s| (s.id.as_str(), s.reason.as_str()))
        .collect();
    assert_eq!(
        why,
        [
            ("c34", "Only archived chats can be deleted this way"),
            ("nobody", "There is no saved chat with that name")
        ]
    );
    assert_eq!(chats.list().len(), 33);
    let there = |id: &str| folder(&data, &v).join(format!("{id}.json")).exists();
    assert!(!there("c0") && !there("c1"));
    assert!(
        there("c2") && there("c34"),
        "the others stay, archived or not"
    );
    assert_eq!(archived(&chats), ["c2", "c3", "c4"]);
    // Naming none deletes none.
    assert_eq!(chats.delete_archived(&[], &v.kasten).count, 0);
    assert_eq!(chats.list().len(), 33);
}

#[test]
fn an_archived_chat_with_changes_waiting_or_working_stays() {
    let v = vault();
    let data = Scratch::new();
    let chats = open(&data, &v);
    let model = Fake::new(vec![
        Step::Reply(
            "",
            vec![("capture", json!({"markdown": "Held back"}))],
            Stop::Tools,
        ),
        Step::Reply("Staged.", vec![], Stop::End),
    ]);
    let asked = crate::chat::ChatRequest {
        writes: WriteMode::Preview,
        ..request("held", "Capture")
    };
    turn(&chats, &v, &model, &Seen::new(), asked);
    // Ten newer chats push it past a list of ten.
    let store = store_of(&data, &v);
    for n in 0..10u64 {
        store
            .save(&saved(&format!("n{n}"), Instant::now().millis + 10_000 + n))
            .unwrap();
    }
    let chats = open(&data, &v);
    assert!(
        archived(&chats).is_empty(),
        "eleven fit in a list of thirty"
    );
    chats.set_limits(ChatLimits {
        list_size: 10,
        max_concurrent: 3,
    });
    assert!(archived(&chats).contains(&"held".to_owned()));
    let done = chats.delete_archived(&["held".to_owned()], &v.kasten);
    assert!(done.deleted.is_empty());
    assert!(
        done.skipped[0]
            .reason
            .contains("changes waiting for review"),
        "{done:?}"
    );
    assert!(chats.list().iter().any(|t| t.id == "held"));
}

#[test]
fn a_reset_keeps_the_saved_chat_and_what_it_staged() {
    let v = vault();
    let data = Scratch::new();
    let chats = open(&data, &v);
    let model = Fake::new(vec![
        Step::Reply(
            "",
            vec![("capture", json!({"markdown": "Kept for review"}))],
            Stop::Tools,
        ),
        Step::Reply("Staged.", vec![], Stop::End),
    ]);
    let asked = crate::chat::ChatRequest {
        writes: WriteMode::Preview,
        ..request("c1", "Capture")
    };
    turn(&chats, &v, &model, &Seen::new(), asked);
    let set = chats.changes("c1").unwrap().lock().unwrap().id.clone();
    chats.reset("c1");
    assert!(chats.messages("c1").is_none(), "out of memory");
    assert!(store_of(&data, &v).load("c1").is_some(), "saved still");
    assert_eq!(chats.list().len(), 1);
    assert!(
        v.dir.join(".kasten/cache/changes").join(&set).exists(),
        "what it staged waits for the person"
    );
    // The saved chat comes back whole, with its staged changes.
    let loaded = chats.loaded("c1", &v.kasten).unwrap();
    assert_eq!(loaded.title, "Capture");
    assert!(!chats.changes("c1").unwrap().lock().unwrap().is_empty());
}

#[test]
fn a_new_thread_keeps_the_old_one_and_a_turn_working_in_it() {
    let v = vault();
    let data = Scratch::new();
    let chats = open(&data, &v);
    turn(
        &chats,
        &v,
        &Fake::new(vec![]),
        &Seen::new(),
        request("c1", "Hello"),
    );
    let fresh = chats.new_thread(Some("c1")).unwrap();
    assert!(fresh.id.starts_with("chat-") && valid_id(&fresh.id));
    assert_ne!(fresh.id, "c1");
    assert!(fresh.bound.is_none());
    assert!(
        chats.list().iter().any(|t| t.id == "c1"),
        "the old one is kept"
    );
    let model = Fake::new(vec![]);
    turn(
        &chats,
        &v,
        &model,
        &Seen::new(),
        request(&fresh.id, "Another"),
    );
    assert_eq!(model.sent()[0].len(), 1, "a fresh conversation");
    let ids: Vec<String> = chats.list().into_iter().map(|t| t.id).collect();
    assert!(ids.contains(&"c1".to_owned()) && ids.contains(&fresh.id));
    assert_ne!(
        chats.session_of("c1").unwrap().id,
        chats.session_of(&fresh.id).unwrap().id
    );
}

#[test]
fn archiving_by_hand_keeps_the_chat_cuts_its_tie_and_can_be_undone() {
    let (v, data, chats) = thirty_five();
    let target = crate::chat::binding::Binding {
        kind: "page".to_owned(),
        path: "library/a.md".to_owned(),
        id: None,
    };
    chats.bind("c34", target.clone()).unwrap();
    assert!(chats.archive("c34").unwrap());
    assert!(archived(&chats).contains(&"c34".to_owned()));
    assert!(
        chats.thread_for(&target).unwrap().is_none(),
        "the tie is cut"
    );
    assert!(
        folder(&data, &v).join("c34.json").exists(),
        "archiving deletes nothing"
    );
    assert!(chats.archive("c34").unwrap(), "twice is harmless");
    assert!(!chats.archive("nobody").unwrap());
    assert!(chats.unarchive("c34").unwrap());
    assert!(!archived(&chats).contains(&"c34".to_owned()));
}

#[test]
fn an_idle_chat_that_just_answered_can_be_archived() {
    let v = vault();
    let data = Scratch::new();
    let chats = open(&data, &v);
    turn(
        &chats,
        &v,
        &Fake::new(vec![]),
        &Seen::new(),
        request("c1", "Hello"),
    );
    // Idle: fine. (A running one is refused, as `delete_thread` does.)
    assert!(chats.archive("c1").unwrap());
}
