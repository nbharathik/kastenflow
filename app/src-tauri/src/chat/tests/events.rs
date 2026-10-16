//! What the window hears: notices told while a request is still open, the
//! system notice a turn's ending earns, and the numbers on the events.

use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::time::Duration;

use serde_json::json;

use super::turns::{request, turn};
use super::{Fake, Seen, Step, block_on, vault};
use crate::chat::event::EventKind;
use crate::chat::model::Stop;
use crate::chat::threads::{self, Chats};
use crate::chat::{ChatEvent, Events};

/// A model that has a notice for the window while its request is still open.
struct Noisy {
    notices: std::sync::Mutex<Vec<crate::chat::model::Notice>>,
}

impl crate::chat::model::Model for Noisy {
    fn take_notices(&self) -> Vec<crate::chat::model::Notice> {
        std::mem::take(&mut *self.notices.lock().unwrap())
    }

    async fn reply(
        &self,
        _call: &crate::chat::model::Call<'_>,
        text: &(dyn Fn(&str) + Sync),
        _cancel: &AtomicBool,
    ) -> Result<crate::chat::model::Reply, crate::chat::model::Failure> {
        // The connection dropped; it is being tried again for a while.
        self.notices
            .lock()
            .unwrap()
            .push(crate::chat::model::Notice {
                code: Some("retry".to_owned()),
                text: "Connection dropped, trying again (2 of 4)".to_owned(),
            });
        tokio::time::sleep(Duration::from_millis(700)).await;
        text("There.");
        Ok(crate::chat::model::Reply {
            text: "There.".to_owned(),
            calls: vec![],
            stop: Stop::End,
            blocks: None,
            items: None,
        })
    }
}

#[test]
fn a_notice_with_a_code_reaches_the_window_while_the_request_is_still_open() {
    let v = vault();
    let chats = Chats::default();
    let seen = Seen::new();
    let events: Arc<dyn Events> = seen.clone();
    let model = Noisy {
        notices: Default::default(),
    };
    let (_, work) = threads::send(
        &chats,
        Arc::clone(&v.kasten),
        events,
        model,
        request("c1", "Hi"),
    )
    .unwrap();
    block_on(work);
    let kinds: Vec<_> = seen.all().iter().map(|e| e.kind).collect();
    let notice = kinds.iter().position(|k| *k == EventKind::Notice).unwrap();
    let text = kinds.iter().position(|k| *k == EventKind::Text).unwrap();
    assert!(notice < text, "told as it happened, not after: {kinds:?}");
    let event = &seen.of(EventKind::Notice)[0];
    assert_eq!(event.code.as_deref(), Some("retry"));
    assert_eq!(
        event.text.as_deref(),
        Some("Connection dropped, trying again (2 of 4)")
    );
    let wire = serde_json::to_value(event).unwrap();
    assert_eq!(wire["code"], "retry");
}

#[test]
fn a_turn_that_ends_earns_a_system_notice_in_fixed_words_and_nothing_else_does() {
    use crate::chat::commands::notice_for;
    use crate::notify::Notice;
    let event = |kind, stopped| {
        let mut e = ChatEvent::new("c1", "t1", kind);
        e.stopped = stopped;
        // Whatever the event carries is never in the notice.
        e.text = Some("The title of a private note".to_owned());
        e.error = Some("The text of a private answer".to_owned());
        e
    };
    assert_eq!(
        notice_for(&event(EventKind::Done, Some(false))),
        Some(Notice::ChatAnswered)
    );
    assert_eq!(
        notice_for(&event(EventKind::Done, Some(true))),
        None,
        "the person stopped it themselves"
    );
    assert_eq!(
        notice_for(&event(EventKind::Paused, None)),
        Some(Notice::ChatNeedsYou)
    );
    assert_eq!(
        notice_for(&event(EventKind::Error, None)),
        Some(Notice::ChatFailed)
    );
    for kind in [
        EventKind::Text,
        EventKind::Tool,
        EventKind::ToolResult,
        EventKind::Notice,
        EventKind::Changes,
        EventKind::Plan,
        EventKind::Queued,
        EventKind::Round,
    ] {
        assert_eq!(notice_for(&event(kind, None)), None, "{kind:?}");
    }
    for notice in [
        Notice::ChatAnswered,
        Notice::ChatNeedsYou,
        Notice::ChatFailed,
    ] {
        let (title, body) = notice.words();
        assert!(!title.contains("private") && !body.contains("private"));
    }
}

#[test]
fn every_event_has_a_number_that_grows_by_one() {
    let v = vault();
    let chats = Chats::default();
    let model = Fake::new(vec![
        Step::Reply("", vec![("list_tags", json!({}))], Stop::Tools),
        Step::Reply("Done.", vec![], Stop::End),
    ]);
    let seen = Seen::new();
    turn(&chats, &v, &model, &seen, request("c1", "One"));
    turn(&chats, &v, &model, &seen, request("c1", "Two"));
    let numbers: Vec<u64> = seen.all().iter().map(|e| e.seq).collect();
    let expected: Vec<u64> = (1..=numbers.len() as u64).collect();
    assert_eq!(numbers, expected, "from 1, across turns of one chat");
    // A reloaded window asks for what it missed.
    let after = chats.state("c1", 3);
    assert_eq!(after.seq, *numbers.last().unwrap());
    assert_eq!(after.events.len(), numbers.len() - 3);
    assert!(!after.gap);
    assert_eq!(serde_json::to_value(&seen.all()[0]).unwrap()["seq"], 1);
}
