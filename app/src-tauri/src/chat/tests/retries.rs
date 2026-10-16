//! A request that fails for a reason that passes is sent again, up to four
//! times, with a wait that grows and that Stop ends at once; one that will
//! not change is never repeated. A stream that breaks before a tool call
//! finished is tried again from the start; after one did, it is not.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::block_on;
use super::flaky::{Act, say, say_after, serve_acts};
use super::http::{client, provider};
use super::settings::ask;
use super::streams::VLLM;
use crate::chat::errors::FailKind;
use crate::chat::http::HttpModel;
use crate::chat::model::{Call, Message, Model, Stop};

pub(super) fn local(base: &str) -> HttpModel {
    HttpModel::new(
        client(),
        &provider("openai", &format!("{base}/v1")),
        None,
        "m",
    )
    .unwrap()
}

const BUSY: &str = r#"{"error":{"message":"The server is busy","type":"server_error"}}"#;

/// `VLLM` up to the start of the event that holds `marker`.
fn until(marker: &str) -> String {
    let at = VLLM.find(marker).unwrap();
    VLLM[..VLLM[..at].rfind("data:").unwrap()].to_owned()
}

#[test]
fn a_busy_server_is_asked_again_and_the_second_try_answers() {
    let (base, server) = serve_acts(vec![say(503, BUSY), say(200, VLLM)]);
    let reply = ask(&local(&base)).unwrap();
    assert_eq!(reply.text, "Let me look.");
    let taken = server.join().unwrap();
    assert_eq!(taken.len(), 2);
    assert_eq!(
        taken[0].body, taken[1].body,
        "the whole thread is sent again, as it was"
    );
}

#[test]
fn every_status_that_passes_is_tried_again() {
    for status in [408, 409, 425, 429, 500, 502, 503, 504, 529] {
        let (base, server) = serve_acts(vec![say(status, "{}"), say(200, VLLM)]);
        assert!(ask(&local(&base)).is_ok(), "{status}");
        assert_eq!(server.join().unwrap().len(), 2, "{status}");
    }
}

#[test]
fn what_will_not_change_is_never_asked_twice() {
    for (status, body) in [
        (
            400,
            r#"{"error":{"message":"messages: roles must alternate"}}"#,
        ),
        (401, r#"{"error":{"message":"invalid api key"}}"#),
        (403, r#"{"error":{"message":"forbidden"}}"#),
        (404, r#"{"error":{"message":"no such model"}}"#),
        (413, "{}"),
        (422, "{}"),
    ] {
        let (base, server) = serve_acts(vec![say(status, body)]);
        assert!(ask(&local(&base)).is_err(), "{status}");
        assert_eq!(server.join().unwrap().len(), 1, "{status}");
    }
}

#[test]
fn a_used_up_quota_is_not_a_busy_server() {
    for code in ["insufficient_quota", "usage_limit_reached"] {
        let body = format!(
            r#"{{"error":{{"code":"{code}","message":"You exceeded your current quota"}}}}"#
        );
        let (base, server) = serve_acts(vec![say(429, body)]);
        let failure = *ask(&local(&base)).unwrap_err();
        assert_eq!(failure.kind, FailKind::RateLimited, "{code}");
        assert_eq!(server.join().unwrap().len(), 1, "{code}: no retry");
    }
}

#[test]
fn the_wait_is_at_least_what_retry_after_says() {
    let slow = r#"{"error":{"code":"rate_limit_exceeded","message":"Slow down"}}"#;
    let (base, server) = serve_acts(vec![say_after(429, 1, slow), say(200, VLLM)]);
    assert!(ask(&local(&base)).is_ok());
    let taken = server.join().unwrap();
    let waited = taken[1].at.duration_since(taken[0].at);
    assert!(
        waited >= Duration::from_millis(900),
        "asked again after {waited:?}"
    );
}

#[test]
fn a_wait_that_is_far_too_long_is_not_waited_for() {
    let (base, server) = serve_acts(vec![say_after(429, 120, "{}")]);
    let started = Instant::now();
    let failure = *ask(&local(&base)).unwrap_err();
    assert_eq!(failure.kind, FailKind::RateLimited);
    assert!(started.elapsed() < Duration::from_secs(5));
    assert_eq!(server.join().unwrap().len(), 1);
}

#[test]
fn four_tries_and_then_the_last_failure_is_the_answer() {
    let (base, server) = serve_acts(vec![
        say(503, BUSY),
        say(503, BUSY),
        say(503, BUSY),
        say(503, BUSY),
    ]);
    let failure = *ask(&local(&base)).unwrap_err();
    // A fifth try would have found nobody listening and said so instead.
    assert_eq!(failure.kind, FailKind::Connection);
    assert!(
        failure.message.contains("503") && failure.message.ends_with("Tried 4 times."),
        "{}",
        failure.message
    );
    assert_eq!(server.join().unwrap().len(), 4);
}

#[test]
fn a_connection_that_is_dropped_is_tried_again() {
    let (base, server) = serve_acts(vec![Act::Hangup, say(200, VLLM)]);
    let reply = ask(&local(&base)).unwrap();
    assert_eq!(reply.stop, Stop::Tools);
    assert_eq!(server.join().unwrap().len(), 2);
}

#[test]
fn a_stream_cut_before_a_tool_call_finished_starts_over_and_keeps_only_the_new_text() {
    // The second call has not started: the first is half written.
    let start = until("\"tool_calls\":[{\"index\":1");
    for cut in [Act::Cut(start.clone()), Act::Trail(start.clone())] {
        let (base, server) = serve_acts(vec![cut, say(200, VLLM)]);
        let seen = Mutex::new(String::new());
        let thread = [Message::User("Hi".to_owned())];
        let call = Call {
            system: "",
            messages: &thread,
            tools: &[],
        };
        let model = local(&base);
        let reply = block_on(model.reply(
            &call,
            &|t| seen.lock().unwrap().push_str(t),
            &AtomicBool::new(false),
        ))
        .unwrap();
        // The thread keeps one copy of the text; the window is told to drop the first.
        assert_eq!(reply.text, "Let me look.");
        assert_eq!(reply.calls.len(), 2);
        assert_eq!(server.join().unwrap().len(), 2);
    }
}

#[test]
fn a_stream_cut_after_a_tool_call_finished_is_not_tried_again() {
    // The second call has started, so the first is whole.
    let start = until("\"finish_reason\":\"tool_calls\"");
    let (base, server) = serve_acts(vec![Act::Trail(start)]);
    let failure = *ask(&local(&base)).unwrap_err();
    // A second try would have found nobody listening and said so instead.
    assert_eq!(failure.kind, FailKind::Connection);
    assert!(
        failure
            .message
            .contains("closed before the answer was complete")
            && !failure.message.contains("Tried"),
        "{}",
        failure.message
    );
    assert_eq!(failure.partial.unwrap().text, "Let me look.");
    assert_eq!(server.join().unwrap().len(), 1);
}

#[test]
fn stop_ends_the_wait_between_tries_at_once() {
    let (base, server) = serve_acts(vec![say_after(503, 5, BUSY), say(200, VLLM)]);
    let model = local(&base);
    let cancel = Arc::new(AtomicBool::new(false));
    let stop = Arc::clone(&cancel);
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(400));
        stop.store(true, Ordering::SeqCst);
    });
    let thread = [Message::User("Hi".to_owned())];
    let call = Call {
        system: "",
        messages: &thread,
        tools: &[],
    };
    let started = Instant::now();
    let reply = block_on(model.reply(&call, &|_| {}, &cancel)).unwrap();
    assert_eq!(reply.stop, Stop::Cancelled);
    assert!(
        started.elapsed() < Duration::from_secs(3),
        "stopped after {:?}",
        started.elapsed()
    );
    drop(server);
}

#[test]
fn each_try_that_is_repeated_is_announced_with_its_number_and_a_code() {
    let (base, server) = serve_acts(vec![
        Act::Hangup,
        say(503, BUSY),
        say_after(429, 0, "{}"),
        say(200, VLLM),
    ]);
    let model = local(&base);
    ask(&model).unwrap();
    server.join().unwrap();
    let notices = model.take_notices();
    let texts: Vec<&str> = notices.iter().map(|n| n.text.as_str()).collect();
    assert_eq!(
        texts,
        [
            "Connection dropped, trying again (2 of 4)",
            "The server is busy, trying again (3 of 4)",
            "Rate limited, trying again (4 of 4)"
        ]
    );
    assert!(notices.iter().all(|n| n.code.as_deref() == Some("retry")));
    assert!(model.take_notices().is_empty(), "given once");
    assert_eq!(
        model.take_notice(),
        None,
        "and apart from the other notices"
    );
}

#[test]
fn the_announcement_is_there_while_the_wait_is_still_going_on() {
    let (base, server) = serve_acts(vec![say_after(503, 1, BUSY), say(200, VLLM)]);
    let model = local(&base);
    let watcher = model.clone();
    let done = Arc::new(AtomicBool::new(false));
    let finished = Arc::clone(&done);
    let watching = std::thread::spawn(move || {
        while !finished.load(Ordering::SeqCst) {
            let seen = watcher.take_notices();
            if !seen.is_empty() {
                return (seen, finished.load(Ordering::SeqCst));
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        (Vec::new(), true)
    });
    ask(&model).unwrap();
    done.store(true, Ordering::SeqCst);
    let (seen, was_over) = watching.join().unwrap();
    assert!(!was_over, "said before the answer came");
    assert_eq!(seen[0].text, "The server is busy, trying again (2 of 4)");
    server.join().unwrap();
}

#[test]
fn a_server_that_is_slow_to_answer_is_waited_for_not_asked_again() {
    let late = Act::Late(Duration::from_millis(600), Box::new(say(200, VLLM)));
    let (base, server) = serve_acts(vec![late]);
    assert!(ask(&local(&base)).is_ok());
    assert_eq!(server.join().unwrap().len(), 1);
}
