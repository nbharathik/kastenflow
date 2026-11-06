//! Slide requests through the mailbox: the deck to draw travels beside the
//! request as a payload (a request file is too small for one), the app reads
//! it once, and nothing is left behind whether the app answers, stays silent
//! or is not there.

use crate::bridge::{files_in, mailbox, plant};
use crate::common::dev_vault;

use std::sync::Arc;
use std::time::Duration;

use kasten_core::bridge::{Answer, Call, Decks, Handler, MAX_PAYLOAD_BYTES, Request, serve};
use serde_json::json;

fn slide(percent: u32) -> Call {
    Call::SlidePng {
        slide: 2,
        step: Some(1),
        scale_percent: percent,
    }
}

#[test]
fn the_deck_travels_beside_the_request_and_is_read_once() {
    let t = dev_vault();
    let reading = mailbox(&t);
    let handler: Handler = Arc::new(move |request: Request, call: Call| {
        let bytes = reading.take_payload(&request.id);
        let again = reading.take_payload(&request.id);
        let decks: Decks = serde_json::from_slice(&bytes.unwrap_or_default()).unwrap();
        Ok(
            json!({ "kind": call.kind(), "after": decks.after, "before": decks.before, "again": again.is_some() }),
        )
    });
    let _server = serve(mailbox(&t), "1.2.4", handler).unwrap();
    let decks = Decks {
        after: "{\"deck\":\"after\"}".into(),
        before: Some("{\"deck\":\"before\"}".into()),
    };
    let payload = serde_json::to_vec(&decks).unwrap();
    let answer = mailbox(&t)
        .ask_with(&slide(100), None, Duration::from_secs(5), Some(&payload))
        .unwrap();
    let Answer::Reply(reply) = answer else {
        panic!("expected a reply, got {answer:?}");
    };
    assert!(reply.ok, "{reply:?}");
    assert_eq!(reply.result["kind"], "slide_png");
    assert_eq!(reply.result["after"], "{\"deck\":\"after\"}");
    assert_eq!(reply.result["before"], "{\"deck\":\"before\"}");
    assert_eq!(reply.result["again"], false, "a payload is read once");
    assert!(files_in(&t, "payloads").is_empty());
    assert!(files_in(&t, "requests").is_empty());
}

#[test]
fn a_window_that_stays_silent_times_out_and_the_deck_is_taken_back() {
    let t = dev_vault();
    let handler: Handler = Arc::new(|_: Request, _: Call| {
        std::thread::sleep(Duration::from_millis(1_500));
        Ok(json!({}))
    });
    let _server = serve(mailbox(&t), "1.2.4", handler).unwrap();
    let answer = mailbox(&t)
        .ask_with(
            &Call::SlideGrid {},
            None,
            Duration::from_millis(300),
            Some(b"{}"),
        )
        .unwrap();
    assert_eq!(answer, Answer::TimedOut);
    assert!(
        files_in(&t, "payloads").is_empty(),
        "the payload is withdrawn"
    );
}

#[test]
fn with_the_app_closed_nothing_is_asked_and_nothing_is_left() {
    let t = dev_vault();
    let answer = mailbox(&t)
        .ask_with(
            &Call::SlideMeasure {},
            None,
            Duration::from_secs(1),
            Some(b"{}"),
        )
        .unwrap();
    assert_eq!(answer, Answer::AppClosed);
    assert!(files_in(&t, "payloads").is_empty());
    assert!(files_in(&t, "requests").is_empty());
}

#[test]
fn a_payload_over_the_limit_is_refused_before_anything_is_written() {
    let t = dev_vault();
    let big = vec![b'x'; MAX_PAYLOAD_BYTES as usize + 1];
    let id = mailbox(&t).new_id().unwrap();
    assert!(mailbox(&t).put_payload(&id, &big).is_err());
    assert!(mailbox(&t).take_payload(&id).is_none());
    assert!(mailbox(&t).put_payload("../escape", b"x").is_err());
    assert!(mailbox(&t).take_payload("../escape").is_none());
}

#[test]
fn a_payload_is_read_by_its_id_from_its_own_folder_and_removed() {
    let t = dev_vault();
    let m = mailbox(&t);
    m.ensure_dirs().unwrap();
    let id = m.new_id().unwrap();
    plant(
        &t.vault
            .root()
            .join(".kasten/cache/bridge/payloads")
            .join(format!("{id}.bin")),
        b"planted",
    );
    assert_eq!(m.take_payload(&id).as_deref(), Some(&b"planted"[..]));
    assert!(files_in(&t, "payloads").is_empty());
}

#[test]
fn the_slide_requests_have_their_params_their_kinds_and_their_limits() {
    for call in [
        slide(100),
        Call::SlidePng {
            slide: 0,
            step: None,
            scale_percent: 400,
        },
        Call::SlideGrid {},
        Call::SlideMeasure {},
        Call::SlideDiff {
            before_slide: 1,
            after_slide: 2,
            step: None,
            scale_percent: 100,
            before_marks: vec![[10, 20, 30, 40]],
            after_marks: vec![],
        },
    ] {
        let params = call.params();
        assert!(params.is_object(), "{params}");
        assert!(Call::KINDS.contains(&call.kind()), "{}", call.kind());
        assert_eq!(Call::parse(call.kind(), &params).unwrap(), call);
        assert!(call.check().is_ok(), "{call:?}");
        assert_eq!(call.doc(), "", "a slide request names no place");
    }
    assert_eq!(Call::KINDS.len(), 9);
    assert!(slide(24).check().is_err());
    assert!(slide(401).check().is_err());
    let many = Call::SlideDiff {
        before_slide: 0,
        after_slide: 0,
        step: None,
        scale_percent: 100,
        before_marks: vec![[0, 0, 1, 1]; 201],
        after_marks: vec![],
    };
    assert!(many.check().is_err());
    // Left out, the scale is one to one.
    let parsed = Call::parse("slide_png", &json!({ "slide": 3 })).unwrap();
    assert_eq!(
        parsed,
        Call::SlidePng {
            slide: 3,
            step: None,
            scale_percent: 100
        }
    );
}
