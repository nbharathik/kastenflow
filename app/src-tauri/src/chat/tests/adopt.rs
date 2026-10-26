//! Bringing a saved chat back: a chat that cannot be brought back is an
//! `AdoptFailed` the window can act on (never an empty new chat), and a
//! window behind the saved events is told which ones it missed.

use std::fs;

use serde_json::json;

use super::history::saved;
use super::store::{open, store_of};
use super::{Scratch, vault};
use crate::chat::store::{Status, VERSION, vault_hash};
use crate::chat::threads::{AdoptReason, Gap};

#[test]
fn a_chat_that_cannot_come_back_says_why_in_a_form_the_window_can_act_on() {
    let v = vault();
    let data = Scratch::new();
    let store = store_of(&data, &v);
    store.save(&saved("ok", 10)).unwrap();
    store.save(&saved("torn", 20)).unwrap();
    let mut future = saved("future", 30);
    future.version = VERSION + 1;
    store.save(&future).unwrap();
    let folder = data
        .0
        .join("chats")
        .join(vault_hash(&v.kasten.root().display().to_string()));
    fs::write(folder.join("torn.json"), b"{ not json").unwrap();

    let chats = open(&data, &v);
    assert!(chats.loaded("ok", &v.kasten).is_ok());
    let missing = chats.loaded("nobody", &v.kasten).unwrap_err();
    assert_eq!(missing.reason, AdoptReason::Missing);
    let torn = chats.loaded("torn", &v.kasten).unwrap_err();
    assert_eq!(torn.reason, AdoptReason::Damaged);
    assert!(
        folder.join("torn.json.bad").exists(),
        "set aside, not deleted"
    );
    let newer = chats.loaded("future", &v.kasten).unwrap_err();
    assert_eq!(newer.reason, AdoptReason::Newer);
    assert!(folder.join("future.json").exists(), "left alone");
    // Nothing was made up in its place.
    assert!(chats.messages("nobody").is_none() && chats.messages("torn").is_none());
    let ids: Vec<String> = chats.list().into_iter().map(|t| t.id).collect();
    assert!(!ids.contains(&"nobody".to_owned()));
    assert!(ids.contains(&"ok".to_owned()) && ids.contains(&"future".to_owned()));
    // The wire form the window reads, and a sentence for the person.
    let wire = serde_json::to_value(&missing).unwrap();
    assert_eq!(wire["kind"], "adoptFailed");
    assert_eq!(wire["reason"], "missing");
    assert!(wire["message"].as_str().unwrap().contains("not saved"));
    assert_eq!(serde_json::to_value(&torn).unwrap()["reason"], "damaged");
    assert_eq!(serde_json::to_value(&newer).unwrap()["reason"], "newer");
    assert_eq!(torn.to_string(), "This chat's file could not be read");
}

#[test]
fn a_chat_with_no_store_is_missing_not_new() {
    let chats = crate::chat::threads::Chats::default();
    let v = vault();
    let err = chats.loaded("c1", &v.kasten).unwrap_err();
    assert_eq!(err.reason, AdoptReason::Missing);
    assert!(!chats.ensure_loaded("c1", &v.kasten));
}

#[test]
fn a_window_behind_the_saved_events_is_told_which_ones_it_missed() {
    let v = vault();
    let data = Scratch::new();
    let store = store_of(&data, &v);
    // The thread's events went up to 40; its saved screen was kept at 10.
    let mut behind = saved("behind", 10);
    behind.seq = 40;
    behind.ui = Some(json!({"title": "Behind", "seq": 10}));
    store.save(&behind).unwrap();
    let mut level = saved("level", 11);
    level.seq = 40;
    level.ui = Some(json!({"title": "Level", "seq": 40}));
    store.save(&level).unwrap();
    let mut bare = saved("bare", 12);
    bare.seq = 7;
    bare.ui = None;
    store.save(&bare).unwrap();

    let chats = open(&data, &v);
    let loaded = chats.loaded("behind", &v.kasten).unwrap();
    assert_eq!(loaded.seq, 10);
    assert_eq!(loaded.gap, Some(Gap { from: 11, to: 40 }));
    let wire = serde_json::to_value(&loaded).unwrap();
    assert_eq!(wire["gap"], json!({"from": 11, "to": 40}));
    assert_eq!(chats.loaded("level", &v.kasten).unwrap().gap, None);
    // No screen kept: it is up to date with the last event, so nothing is missing.
    assert_eq!(chats.loaded("bare", &v.kasten).unwrap().gap, None);
    // `chat_state` still says so for a window that asks from where it is.
    let state = chats.state("behind", 10);
    assert!(state.gap && state.events.is_empty());
}

#[test]
fn a_chat_found_waiting_for_a_place_comes_back_interrupted() {
    let v = vault();
    let data = Scratch::new();
    let mut waiting = saved("w", 10);
    waiting.status = Status::Waiting;
    store_of(&data, &v).save(&waiting).unwrap();
    let chats = open(&data, &v);
    assert_eq!(chats.list()[0].status, Status::Interrupted);
    assert_eq!(chats.state("w", 0).status, Status::Interrupted);
    assert_eq!(
        chats.loaded("w", &v.kasten).unwrap().status,
        Status::Interrupted
    );
}
