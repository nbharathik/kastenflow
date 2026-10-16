//! What the errors inside a stream mean: a rate limit passes, a used-up plan
//! does not, a busy provider passes, a refused key does not; whether a tool
//! call came whole; a call with no id; and a provider that paused the turn.

use std::sync::atomic::AtomicBool;

use serde_json::json;

use super::block_on;
use super::chatgpt::{account, signed_in, token};
use super::flaky::{Act, say, serve_acts};
use super::http::{client, provider};
use super::streams::CLAUDE;
use crate::chat::errors::FailKind;
use crate::chat::http::HttpModel;
use crate::chat::model::{Call, Message, Model, Stop};
use crate::chat::sse::{SseEvent, SseParser};
use crate::chat::{anthropic, openai, responses};

fn events(text: &str) -> Vec<SseEvent> {
    let mut sse = SseParser::default();
    let mut all = sse.push(text.as_bytes());
    all.extend(sse.finish());
    all
}

fn data(kind: &str, rest: &str) -> String {
    format!("event: {kind}\ndata: {{\"type\":\"{kind}\"{rest}}}\n\n")
}

#[test]
fn the_responses_stream_says_what_its_errors_mean() {
    let cases = [
        ("rate_limit_exceeded", FailKind::RateLimited, true),
        ("usage_limit_reached", FailKind::RateLimited, false),
        ("insufficient_quota", FailKind::RateLimited, false),
        (
            "subscription_sharing_usage_limit_exceeded",
            FailKind::RateLimited,
            false,
        ),
        ("server_error", FailKind::Connection, true),
        ("overloaded", FailKind::Connection, true),
        (
            "subscription_sharing_user_not_eligible",
            FailKind::Permission,
            false,
        ),
        ("something_new", FailKind::Other, false),
    ];
    for (code, kind, passes) in cases {
        for failed in [
            data(
                "response.failed",
                &format!(",\"response\":{{\"error\":{{\"code\":\"{code}\",\"message\":\"x\"}}}}"),
            ),
            data("error", &format!(",\"code\":\"{code}\",\"message\":\"x\"")),
        ] {
            let mut stream = responses::Stream::default();
            let words = stream.event(&events(&failed)[0]).unwrap_err();
            let found = stream.error().unwrap();
            assert_eq!((found.kind, found.passes), (kind, passes), "{code}");
            assert_eq!(found.code, code);
            assert!(!words.is_empty());
        }
    }
    // A plan that is used up says where to look, whichever code says so.
    for code in ["usage_limit_reached", "insufficient_quota"] {
        let failed = data(
            "response.failed",
            &format!(",\"response\":{{\"error\":{{\"code\":\"{code}\"}}}}"),
        );
        let words = responses::Stream::default()
            .event(&events(&failed)[0])
            .unwrap_err();
        assert!(
            words.contains("usage limit is reached") && words.contains("ChatGPT, Settings, Usage"),
            "{words}"
        );
    }
}

#[test]
fn an_error_that_says_the_chat_is_too_long_is_that_kind_by_its_words() {
    let failed = data(
        "error",
        ",\"code\":\"invalid_request\",\"message\":\"Input exceeds the context window of this model\"",
    );
    let mut stream = responses::Stream::default();
    stream.event(&events(&failed)[0]).unwrap_err();
    assert_eq!(stream.error().unwrap().kind, FailKind::TooLong);
}

#[test]
fn claude_and_the_chat_completions_say_what_their_errors_mean_too() {
    let cases = [
        ("overloaded_error", "Overloaded", FailKind::Connection, true),
        ("rate_limit_error", "Slow down", FailKind::RateLimited, true),
        (
            "authentication_error",
            "Bad key",
            FailKind::Permission,
            false,
        ),
        (
            "invalid_request_error",
            "prompt is too long: 250000 tokens",
            FailKind::TooLong,
            false,
        ),
        ("api_error", "Internal", FailKind::Connection, true),
    ];
    for (kind_type, message, kind, passes) in cases {
        let failed = format!(
            "event: error\ndata: {}\n\n",
            json!({"type": "error", "error": {"type": kind_type, "message": message}})
        );
        let mut stream = anthropic::Stream::default();
        stream.event(&events(&failed)[0]).unwrap_err();
        let found = stream.error().unwrap();
        assert_eq!((found.kind, found.passes), (kind, passes), "{kind_type}");
    }
    // Chat completions: the code may be a number, and the type says it.
    let failed = format!(
        "data: {}\n\n",
        json!({"error": {"message": "busy", "type": "server_error", "code": 503}})
    );
    let mut stream = openai::Stream::default();
    stream.event(&events(&failed)[0]).unwrap_err();
    let found = stream.error().unwrap();
    assert_eq!((found.kind, found.passes), (FailKind::Connection, true));
}

fn ask_once(
    model: &HttpModel,
) -> Result<crate::chat::model::Reply, Box<crate::chat::model::Failure>> {
    let thread = [Message::User("Hello".to_owned())];
    let call = Call {
        system: "",
        messages: &thread,
        tools: &[],
    };
    block_on(model.reply(&call, &|_| {}, &AtomicBool::new(false))).map_err(Box::new)
}

#[test]
fn a_provider_that_is_overloaded_mid_stream_is_asked_again() {
    let overloaded = "event: error\ndata: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}\n\n";
    let (base, server) = serve_acts(vec![Act::Trail(overloaded.to_owned()), say(200, CLAUDE)]);
    let model = HttpModel::new(
        client(),
        &provider("anthropic", &base),
        Some("sk-x".into()),
        "model-large",
    )
    .unwrap();
    let reply = ask_once(&model).unwrap();
    assert_eq!(reply.stop, Stop::Tools);
    assert_eq!(server.join().unwrap().len(), 2);
}

#[test]
fn a_plan_that_runs_out_mid_stream_is_a_rate_limit_that_is_not_asked_again() {
    let used_up = data(
        "response.failed",
        ",\"response\":{\"error\":{\"code\":\"usage_limit_reached\",\"message\":\"x\"}}",
    );
    let (base, server) = serve_acts(vec![
        say(200, token("at-1", "rt-2", 3600)),
        Act::Trail(used_up),
    ]);
    let keys = signed_in("rt-1");
    let account = account(&keys, &base);
    let model = HttpModel::new(client(), &provider("chatgpt", ""), None, "gpt-6.1-sol")
        .unwrap()
        .with_account(account)
        .at(&format!("{base}/v1/responses"));
    let failure = *ask_once(&model).unwrap_err();
    assert_eq!(failure.kind, FailKind::RateLimited);
    assert!(
        failure.message.contains("ChatGPT, Settings, Usage"),
        "{}",
        failure.message
    );
    assert_eq!(server.join().unwrap().len(), 2, "no second request");
    let line = model.last_outcome().unwrap();
    assert!(!line.ok && line.attempts == 1 && line.reason == "usage_limit_reached");
}

#[test]
fn a_call_with_no_id_is_given_one_that_goes_back_with_its_answer() {
    let stream = [
        data(
            "response.output_item.done",
            ",\"output_index\":0,\"item\":{\"type\":\"function_call\",\"name\":\"list_tags\",\"arguments\":\"{}\"}",
        ),
        data("response.completed", ",\"response\":{\"output\":[]}"),
    ]
    .concat();
    let mut decoder = responses::Stream::default();
    for event in events(&stream) {
        decoder.event(&event).unwrap();
    }
    let reply = decoder.reply(false);
    let id = reply.calls[0].id.clone();
    assert!(id.starts_with("call_") && id.len() > 6, "{id}");
    assert_eq!(reply.items.unwrap()[0]["call_id"], id.as_str());
}

#[test]
fn a_turn_the_provider_paused_is_a_pause_not_an_end() {
    let stream = format!(
        "{}{}{}",
        data(
            "content_block_start",
            ",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}"
        ),
        data(
            "message_delta",
            ",\"delta\":{\"stop_reason\":\"pause_turn\"}"
        ),
        data("message_stop", ""),
    );
    let mut decoder = anthropic::Stream::default();
    for event in events(&stream) {
        decoder.event(&event).unwrap();
    }
    assert!(decoder.complete());
    assert_eq!(decoder.reply(false).stop, Stop::Pause);
}

#[test]
fn a_tool_call_is_whole_when_its_stream_says_so() {
    // Responses: when the call's item is done.
    let mut stream = responses::Stream::default();
    let added = data(
        "response.output_item.added",
        ",\"output_index\":0,\"item\":{\"type\":\"function_call\",\"call_id\":\"c\",\"name\":\"n\",\"arguments\":\"\"}",
    );
    stream.event(&events(&added)[0]).unwrap();
    assert!(!stream.call_done());
    let done = data(
        "response.output_item.done",
        ",\"output_index\":0,\"item\":{\"type\":\"function_call\",\"call_id\":\"c\",\"name\":\"n\",\"arguments\":\"{}\"}",
    );
    stream.event(&events(&done)[0]).unwrap();
    assert!(stream.call_done());

    // Claude: when the tool block is closed, not before.
    let mut stream = anthropic::Stream::default();
    let start = data(
        "content_block_start",
        ",\"index\":1,\"content_block\":{\"type\":\"tool_use\",\"id\":\"t\",\"name\":\"n\",\"input\":{}}",
    );
    stream.event(&events(&start)[0]).unwrap();
    assert!(!stream.call_done());
    stream
        .event(&events(&data("content_block_stop", ",\"index\":1"))[0])
        .unwrap();
    assert!(stream.call_done());
    // A text block closing is no call.
    let mut text = anthropic::Stream::default();
    let block = data(
        "content_block_start",
        ",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}",
    );
    text.event(&events(&block)[0]).unwrap();
    text.event(&events(&data("content_block_stop", ",\"index\":0"))[0])
        .unwrap();
    assert!(!text.call_done());

    // Chat completions say nothing when a call ends: it is whole once the next begins.
    let mut stream = openai::Stream::default();
    let first = "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"a\",\"function\":{\"name\":\"n\",\"arguments\":\"{\"}}]}}]}\n\n";
    let second = "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":1,\"id\":\"b\",\"function\":{\"name\":\"m\",\"arguments\":\"\"}}]}}]}\n\n";
    stream.event(&events(first)[0]).unwrap();
    assert!(!stream.call_done());
    stream.event(&events(second)[0]).unwrap();
    assert!(stream.call_done());
}
