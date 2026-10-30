//! How many chats work at once (`chat.max_concurrent`): the ones past the
//! limit wait in line, say so, and begin when a place is free. The list size
//! and the limit are checked and kept.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use super::turns::request;
use super::{Fake, Scratch, Seen, Step, block_on, vault};
use crate::chat::limit::{ChatLimits, Gate};
use crate::chat::model::Stop;
use crate::chat::store::Status;
use crate::chat::threads::{self, Chats};
use crate::chat::{EventKind, Events};

async fn until(mut done: impl FnMut() -> bool) {
    while !done() {
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

#[test]
fn three_work_and_the_fourth_waits_until_one_finishes() {
    block_on(async {
        let gate = Arc::new(Gate::default());
        assert_eq!(gate.max(), 3);
        let stop = AtomicBool::new(false);
        let mut places = Vec::new();
        for chat in ["a", "b", "c"] {
            places.push(
                gate.enter(chat, &stop, |_| panic!("no wait"))
                    .await
                    .unwrap(),
            );
        }
        assert_eq!(gate.working(), 3);
        let told = Arc::new(std::sync::Mutex::new(Vec::new()));
        let fourth = {
            let (gate, told) = (Arc::clone(&gate), Arc::clone(&told));
            tokio::spawn(async move {
                let stop = AtomicBool::new(false);
                let told = Arc::clone(&told);
                gate.enter("d", &stop, move |place| told.lock().unwrap().push(place))
                    .await
                    .is_some()
            })
        };
        until(|| gate.waiting() == ["d"]).await;
        assert_eq!(*told.lock().unwrap(), [1], "told once, first in line");
        assert_eq!(gate.working(), 3, "a fourth is not let in");
        // One finishes, and the fourth begins.
        drop(places.remove(1));
        assert!(fourth.await.unwrap(), "it began");
        // The fourth gave its place back when its task ended: two are still working.
        assert_eq!(gate.working(), 2);
        assert!(gate.waiting().is_empty());
    });
}

#[test]
fn chats_begin_in_the_order_they_came_and_a_stopped_one_leaves_the_line() {
    block_on(async {
        let gate = Arc::new(Gate::default());
        gate.set_max(1);
        let stop = AtomicBool::new(false);
        let first = gate.enter("a", &stop, |_| {}).await.unwrap();
        let order = Arc::new(std::sync::Mutex::new(Vec::new()));
        let stopped = Arc::new(AtomicBool::new(false));
        let mut waiting = Vec::new();
        for name in ["b", "c", "d"] {
            let (line, order) = (Arc::clone(&gate), Arc::clone(&order));
            let flag = if name == "c" {
                Arc::clone(&stopped)
            } else {
                Arc::new(AtomicBool::new(false))
            };
            waiting.push(tokio::spawn(async move {
                let place = line.enter(name, &flag, |_| {}).await;
                if place.is_some() {
                    order.lock().unwrap().push(name);
                }
                // Holds its place a moment, then gives it back.
                tokio::time::sleep(Duration::from_millis(20)).await;
                drop(place);
            }));
            until(|| gate.waiting().iter().any(|c| c == name)).await;
        }
        assert_eq!(gate.waiting(), ["b", "c", "d"]);
        stopped.store(true, Ordering::SeqCst);
        until(|| gate.waiting() == ["b", "d"]).await;
        drop(first);
        for handle in waiting {
            handle.await.unwrap();
        }
        assert_eq!(*order.lock().unwrap(), ["b", "d"]);
        assert_eq!(gate.working(), 0);
    });
}

#[test]
fn a_waiting_turn_that_is_dropped_leaves_the_line_for_the_ones_behind_it() {
    block_on(async {
        let gate = Arc::new(Gate::default());
        gate.set_max(1);
        let stop = AtomicBool::new(false);
        let first = gate.enter("a", &stop, |_| {}).await.unwrap();
        // "b" waits and its future is dropped (not stopped): the timeout drops it.
        let waiting = gate.enter("b", &stop, |_| {});
        assert!(
            tokio::time::timeout(Duration::from_millis(250), waiting)
                .await
                .is_err()
        );
        assert!(gate.waiting().is_empty(), "{:?}", gate.waiting());
        drop(first);
        let next = tokio::time::timeout(Duration::from_secs(5), gate.enter("c", &stop, |_| {}))
            .await
            .expect("c is not stuck behind b");
        assert!(next.is_some());
    });
}

#[test]
fn a_turn_past_the_limit_says_it_waits_and_begins_when_a_place_is_free() {
    let v = vault();
    let chats = Chats::default();
    chats.set_limits(ChatLimits {
        list_size: 30,
        max_concurrent: 1,
    });
    let busy = Fake::new(vec![Step::Hang("Working on the first")]);
    let quick = Fake::new(vec![Step::Reply("Done at last.", vec![], Stop::End)]);
    let (seen_a, seen_b) = (Seen::new(), Seen::new());
    let (events_a, events_b): (Arc<dyn Events>, Arc<dyn Events>) = (seen_a.clone(), seen_b.clone());
    let (_, work_a) = threads::send(
        &chats,
        Arc::clone(&v.kasten),
        events_a,
        Arc::clone(&busy),
        request("a", "First"),
    )
    .unwrap();
    let (turn_b, work_b) = threads::send(
        &chats,
        Arc::clone(&v.kasten),
        events_b,
        Arc::clone(&quick),
        request("b", "Second"),
    )
    .unwrap();
    assert!(!turn_b.queued, "a new turn, not a queued message");
    block_on(async {
        let first = tokio::spawn(work_a);
        until(|| !seen_a.text().is_empty()).await;
        let second = tokio::spawn(work_b);
        until(|| !seen_b.of(EventKind::Waiting).is_empty()).await;
        let waiting = &seen_b.of(EventKind::Waiting)[0];
        assert_eq!(
            waiting.text.as_deref(),
            Some("Waiting for another chat to finish")
        );
        assert_eq!(waiting.n, Some(1));
        assert_eq!(chats.state("b", 0).status, Status::Waiting);
        assert!(quick.sent().is_empty(), "it has not asked the model");
        // A message sent to the waiting chat is queued for its first step.
        // The first chat finishes, and the second begins.
        chats.stop("a");
        first.await.unwrap();
        second.await.unwrap();
    });
    let kinds: Vec<EventKind> = seen_b.all().iter().map(|e| e.kind).collect();
    let at = |kind: EventKind| kinds.iter().position(|k| *k == kind).unwrap();
    assert!(at(EventKind::Waiting) < at(EventKind::Started));
    assert!(at(EventKind::Started) < at(EventKind::Text));
    assert_eq!(seen_b.last().kind, EventKind::Done);
    assert_eq!(seen_b.last().stopped, Some(false));
    assert_eq!(seen_b.text(), "Done at last.");
    assert_eq!(chats.state("b", 0).status, Status::Idle);
    assert!(
        seen_a.of(EventKind::Waiting).is_empty(),
        "the first never waited"
    );
}

#[test]
fn stopping_a_chat_that_waits_ends_it_without_asking_the_model() {
    let v = vault();
    let chats = Chats::default();
    chats.set_limits(ChatLimits {
        list_size: 30,
        max_concurrent: 1,
    });
    let busy = Fake::new(vec![Step::Hang("Working")]);
    let never = Fake::new(vec![]);
    let (seen_a, seen_b) = (Seen::new(), Seen::new());
    let (events_a, events_b): (Arc<dyn Events>, Arc<dyn Events>) = (seen_a.clone(), seen_b.clone());
    let (_, work_a) = threads::send(
        &chats,
        Arc::clone(&v.kasten),
        events_a,
        Arc::clone(&busy),
        request("a", "First"),
    )
    .unwrap();
    let (_, work_b) = threads::send(
        &chats,
        Arc::clone(&v.kasten),
        events_b,
        Arc::clone(&never),
        request("b", "Second"),
    )
    .unwrap();
    block_on(async {
        let first = tokio::spawn(work_a);
        until(|| !seen_a.text().is_empty()).await;
        let second = tokio::spawn(work_b);
        until(|| !seen_b.of(EventKind::Waiting).is_empty()).await;
        chats.stop("b");
        second.await.unwrap();
        chats.stop("a");
        first.await.unwrap();
    });
    assert_eq!(seen_b.last().kind, EventKind::Done);
    assert_eq!(seen_b.last().stopped, Some(true));
    assert!(never.sent().is_empty());
    assert!(seen_b.of(EventKind::Started).is_empty());
    assert_eq!(chats.state("b", 0).status, Status::Idle);
    assert!(!chats.running("b"), "the chat is free for another message");
}

#[test]
fn the_limits_are_checked_kept_and_read_back_and_a_damaged_file_gives_the_defaults() {
    let dir = Scratch::new();
    assert_eq!(ChatLimits::load(&dir.0), ChatLimits::default());
    assert_eq!(
        (
            ChatLimits::default().list_size,
            ChatLimits::default().max_concurrent
        ),
        (30, 3)
    );
    for (list_size, max_concurrent) in [(9, 3), (201, 3), (30, 0), (30, 9)] {
        let bad = ChatLimits {
            list_size,
            max_concurrent,
        };
        assert!(bad.checked().is_err(), "{list_size} {max_concurrent}");
        assert!(bad.save(&dir.0).is_err());
    }
    for (list_size, max_concurrent) in [(10, 1), (200, 8)] {
        let ok = ChatLimits {
            list_size,
            max_concurrent,
        };
        assert_eq!(ok.save(&dir.0).unwrap(), ok);
        assert_eq!(ChatLimits::load(&dir.0), ok);
    }
    let wire = serde_json::to_value(ChatLimits::default()).unwrap();
    assert_eq!(wire["listSize"], 30);
    assert_eq!(wire["maxConcurrent"], 3);
    std::fs::write(dir.0.join(crate::chat::limit::FILE), b"{ torn").unwrap();
    assert_eq!(ChatLimits::load(&dir.0), ChatLimits::default());
    // A file edited by hand out of range is brought into it.
    std::fs::write(
        dir.0.join(crate::chat::limit::FILE),
        br#"{"listSize": 5000, "maxConcurrent": 0}"#,
    )
    .unwrap();
    assert_eq!(
        ChatLimits::load(&dir.0),
        ChatLimits {
            list_size: 200,
            max_concurrent: 1
        }
    );
}
