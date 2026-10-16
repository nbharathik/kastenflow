//! Saved chats go only when the person deletes one, and then with the
//! attachments nothing else uses; one that works or has changes waiting cannot
//! be deleted; the room they take is reported and acted on never; and
//! staged changes nobody refers to are left where they are, however old.

use std::fs;
use std::sync::Arc;

use kasten_core::Instant;
use serde_json::json;

use super::store::{open, store_of};
use super::turns::{request, turn};
use super::{Fake, Seen, Step, Vault, block_on, vault};
use crate::chat::model::Stop;
use crate::chat::threads::{self, ChatUsage};
use crate::chat::{AttachKind, AttachmentRef, ChatRequest, Events, WriteMode};

#[test]
fn deleting_a_chat_removes_it_and_the_attachments_nothing_else_uses() {
    let v = vault();
    let data = super::Scratch::new();
    let chats = open(&data, &v);
    let files = chats.files().unwrap();
    let shared = files
        .put("shared.md", AttachKind::Text, b"used by both")
        .unwrap();
    let alone = files
        .put("alone.md", AttachKind::Text, b"used by one")
        .unwrap();
    let with = |chat: &str, items: &[&crate::chat::attach::AttachmentInfo]| ChatRequest {
        attachments: items
            .iter()
            .map(|i| AttachmentRef {
                id: i.id.clone(),
                name: i.name.clone(),
                kind: i.kind,
            })
            .collect(),
        ..request(chat, "Read these")
    };
    turn(
        &chats,
        &v,
        &Fake::new(vec![]),
        &Seen::new(),
        with("c1", &[&shared, &alone]),
    );
    turn(
        &chats,
        &v,
        &Fake::new(vec![]),
        &Seen::new(),
        with("c2", &[&shared]),
    );

    chats.delete_thread("c1", &v.kasten).unwrap();
    assert!(chats.list().iter().all(|t| t.id != "c1"));
    assert!(files.bytes(&alone.id).is_err(), "nothing else used it");
    assert!(files.bytes(&shared.id).is_ok(), "the other chat still does");
    assert!(chats.loaded("c1", &v.kasten).is_err());
    // And the other one goes, and then so does what it kept.
    chats.delete_thread("c2", &v.kasten).unwrap();
    assert!(files.bytes(&shared.id).is_err());
    assert!(chats.list().is_empty());
}

#[test]
fn a_chat_that_is_working_cannot_be_deleted() {
    let v = vault();
    let data = super::Scratch::new();
    let chats = open(&data, &v);
    let model = Fake::new(vec![]);
    let events: Arc<dyn Events> = Seen::new();
    let (_, work) = threads::send(
        &chats,
        Arc::clone(&v.kasten),
        events,
        model,
        request("c1", "Hi"),
    )
    .unwrap();
    let err = chats.delete_thread("c1", &v.kasten).unwrap_err();
    assert!(err.contains("still answering"), "{err}");
    block_on(work);
    assert!(chats.delete_thread("c1", &v.kasten).is_ok());
}

/// Rewrites when a change set was made, as if it was staged long ago.
fn make_old(v: &Vault, id: &str, days: u64) {
    let file = v
        .dir
        .join(".kasten/cache/changes")
        .join(id)
        .join("set.json");
    let mut set: serde_json::Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
    let ago = days * 24 * 3600 * 1000;
    set["created"] = json!(Instant::now().millis - ago);
    fs::write(&file, serde_json::to_vec(&set).unwrap()).unwrap();
}

#[test]
fn staged_changes_nobody_refers_to_are_left_alone_however_old() {
    let v = vault();
    let data = super::Scratch::new();
    let chats = open(&data, &v);
    let stage = |chat: &str| {
        let model = Fake::new(vec![
            Step::Reply(
                "",
                vec![("capture", json!({"markdown": format!("From {chat}")}))],
                Stop::Tools,
            ),
            Step::Reply("Staged.", vec![], Stop::End),
        ]);
        let asked = ChatRequest {
            writes: WriteMode::Preview,
            ..request(chat, "Capture")
        };
        turn(&chats, &v, &model, &Seen::new(), asked);
        chats.changes(chat).unwrap().lock().unwrap().id.clone()
    };
    let (orphan, kept, young) = (stage("a"), stage("b"), stage("c"));
    for id in [&orphan, &kept] {
        make_old(&v, id, 400);
    }
    // "a" lost its saved chat (a file went missing); "b" still has one; "c" is recent.
    store_of(&data, &v).delete("a");
    // The app starts again, as often as it likes: nothing is cleaned away.
    for _ in 0..2 {
        let _again = open(&data, &v);
        let sets = v.dir.join(".kasten/cache/changes");
        for id in [&orphan, &kept, &young] {
            assert!(
                sets.join(id).exists(),
                "{id} is the person's to apply or discard"
            );
        }
    }
}

#[test]
fn the_room_the_chats_take_is_reported_and_follows_what_the_person_deletes() {
    let v = vault();
    let data = super::Scratch::new();
    let chats = open(&data, &v);
    assert_eq!(
        chats.usage(),
        ChatUsage {
            threads: 0,
            thread_bytes: 0,
            attachment_bytes: 0,
            total_bytes: 0
        }
    );
    let files = chats.files().unwrap();
    let note = files
        .put("brief.md", AttachKind::Text, b"A brief of 18 bytes")
        .unwrap();
    for id in ["c1", "c2", "c3"] {
        let asked = ChatRequest {
            attachments: vec![AttachmentRef {
                id: note.id.clone(),
                name: note.name.clone(),
                kind: note.kind,
            }],
            ..request(id, "Read the brief")
        };
        turn(&chats, &v, &Fake::new(vec![]), &Seen::new(), asked);
    }
    let used = chats.usage();
    assert_eq!(used.threads, 3);
    assert!(used.thread_bytes > 0);
    assert_eq!(
        used.attachment_bytes, note.bytes,
        "kept once, used by three"
    );
    assert_eq!(used.total_bytes, used.thread_bytes + used.attachment_bytes);
    // Reporting changes nothing; the person's delete does, thread by thread.
    assert_eq!(chats.usage(), used);
    chats.delete_thread("c1", &v.kasten).unwrap();
    let less = chats.usage();
    assert_eq!(less.threads, 2);
    assert!(less.thread_bytes < used.thread_bytes);
    assert_eq!(less.attachment_bytes, note.bytes, "still used by two");
    // And the wire form is what the window reads.
    let wire = serde_json::to_value(less).unwrap();
    assert_eq!(wire["threads"], 2);
    assert!(
        wire["threadBytes"].is_u64()
            && wire["attachmentBytes"].is_u64()
            && wire["totalBytes"].is_u64()
    );
}
