//! The Responses API's stream of events, decoded from chunks that split
//! anywhere: text, reasoning, calls and each way an answer ends.

use serde_json::json;

use crate::chat::model::{Reply, Stop};
use crate::chat::responses::Stream;
use crate::chat::sse::SseParser;

/// An answer that reasons, says a sentence, captures a card and lists the
/// tags: a reasoning item with its encrypted content, the text in pieces,
/// and two function calls, one with arguments in pieces.
pub const ANSWER: &str = r#"event: response.created
data: {"type":"response.created","sequence_number":0,"response":{"id":"resp_1","object":"response","status":"in_progress","output":[]}}

event: response.in_progress
data: {"type":"response.in_progress","sequence_number":1,"response":{"id":"resp_1","status":"in_progress"}}

event: response.output_item.added
data: {"type":"response.output_item.added","sequence_number":2,"output_index":0,"item":{"id":"rs_1","type":"reasoning","summary":[]}}

event: response.output_item.done
data: {"type":"response.output_item.done","sequence_number":3,"output_index":0,"item":{"id":"rs_1","type":"reasoning","summary":[],"encrypted_content":"gAAAAABqenc=="}}

event: response.output_item.added
data: {"type":"response.output_item.added","sequence_number":4,"output_index":1,"item":{"id":"msg_1","type":"message","status":"in_progress","content":[],"role":"assistant"}}

event: response.content_part.added
data: {"type":"response.content_part.added","sequence_number":5,"item_id":"msg_1","output_index":1,"content_index":0,"part":{"type":"output_text","annotations":[],"text":""}}

event: response.output_text.delta
data: {"type":"response.output_text.delta","sequence_number":6,"item_id":"msg_1","output_index":1,"content_index":0,"delta":"I'll capture that "}

event: response.output_text.delta
data: {"type":"response.output_text.delta","sequence_number":7,"item_id":"msg_1","output_index":1,"content_index":0,"delta":"for you — Grüße."}

event: response.output_text.done
data: {"type":"response.output_text.done","sequence_number":8,"item_id":"msg_1","output_index":1,"content_index":0,"text":"I'll capture that for you — Grüße."}

event: response.output_item.done
data: {"type":"response.output_item.done","sequence_number":9,"output_index":1,"item":{"id":"msg_1","type":"message","status":"completed","content":[{"type":"output_text","annotations":[],"text":"I'll capture that for you — Grüße."}],"role":"assistant"}}

event: response.output_item.added
data: {"type":"response.output_item.added","sequence_number":10,"output_index":2,"item":{"id":"fc_1","type":"function_call","status":"in_progress","arguments":"","call_id":"call_capture","name":"capture"}}

event: response.function_call_arguments.delta
data: {"type":"response.function_call_arguments.delta","sequence_number":11,"item_id":"fc_1","output_index":2,"delta":"{\"markdown\": \"Ask the team"}

event: response.function_call_arguments.delta
data: {"type":"response.function_call_arguments.delta","sequence_number":12,"item_id":"fc_1","output_index":2,"delta":" about the venue\", \"tags\": [\"pa"}

event: response.function_call_arguments.delta
data: {"type":"response.function_call_arguments.delta","sequence_number":13,"item_id":"fc_1","output_index":2,"delta":"per\"]}"}

event: response.function_call_arguments.done
data: {"type":"response.function_call_arguments.done","sequence_number":14,"item_id":"fc_1","output_index":2,"arguments":"{\"markdown\": \"Ask the team about the venue\", \"tags\": [\"paper\"]}"}

event: response.output_item.done
data: {"type":"response.output_item.done","sequence_number":15,"output_index":2,"item":{"id":"fc_1","type":"function_call","status":"completed","arguments":"{\"markdown\": \"Ask the team about the venue\", \"tags\": [\"paper\"]}","call_id":"call_capture","name":"capture"}}

event: response.output_item.added
data: {"type":"response.output_item.added","sequence_number":16,"output_index":3,"item":{"id":"fc_2","type":"function_call","status":"in_progress","arguments":"","call_id":"call_tags","name":"list_tags"}}

event: response.output_item.done
data: {"type":"response.output_item.done","sequence_number":17,"output_index":3,"item":{"id":"fc_2","type":"function_call","status":"completed","arguments":"{}","call_id":"call_tags","name":"list_tags"}}

event: response.completed
data: {"type":"response.completed","sequence_number":18,"response":{"id":"resp_1","object":"response","status":"completed","output":[],"usage":{"input_tokens":100,"output_tokens":40,"total_tokens":140}}}

"#;

/// Feeds `stream` in chunks of `size` bytes; returns the text shown and the
/// decoder.
pub(super) fn decode(stream: &str, size: usize) -> (String, Stream) {
    let mut sse = SseParser::default();
    let mut decoder = Stream::default();
    let mut text = String::new();
    let mut events: Vec<_> = stream
        .as_bytes()
        .chunks(size)
        .flat_map(|c| sse.push(c))
        .collect();
    events.extend(sse.finish());
    for event in &events {
        text.extend(decoder.event(event).unwrap());
    }
    (text, decoder)
}

fn assert_answer(text: &str, decoder: Stream, size: usize) {
    assert!(decoder.ended() && decoder.complete(), "size {size}");
    let reply = decoder.reply(false);
    assert_eq!(text, "I'll capture that for you — Grüße.", "size {size}");
    assert_eq!(reply.text, text);
    assert_eq!(reply.stop, Stop::Tools);
    assert_eq!(
        reply.blocks, None,
        "its items are not another provider's blocks"
    );
    assert_eq!(reply.calls.len(), 2);
    assert_eq!(reply.calls[0].id, "call_capture");
    assert_eq!(reply.calls[0].name, "capture");
    assert_eq!(
        reply.calls[0].input().unwrap(),
        json!({"markdown": "Ask the team about the venue", "tags": ["paper"]})
    );
    assert_eq!(
        (reply.calls[1].id.as_str(), reply.calls[1].name.as_str()),
        ("call_tags", "list_tags")
    );
    // The items go back as they came, without the ids of an API that stored
    // nothing: encrypted reasoning, the text, then each call.
    assert_eq!(
        reply.items.unwrap(),
        vec![
            json!({"type": "reasoning", "summary": [], "encrypted_content": "gAAAAABqenc=="}),
            json!({"role": "assistant", "content": "I'll capture that for you — Grüße."}),
            json!({"type": "function_call", "call_id": "call_capture", "name": "capture",
                "arguments": "{\"markdown\": \"Ask the team about the venue\", \"tags\": [\"paper\"]}"}),
            json!({"type": "function_call", "call_id": "call_tags", "name": "list_tags", "arguments": "{}"}),
        ]
    );
}

#[test]
fn an_answer_streams_text_reasoning_and_calls_in_chunks_of_every_size() {
    for size in [1, 2, 7, 64, 1000, ANSWER.len()] {
        let (text, decoder) = decode(ANSWER, size);
        assert_answer(&text, decoder, size);
    }
}

#[test]
fn an_answer_split_in_two_anywhere_is_the_same_answer() {
    // Chunks of one byte (above) cut it everywhere at once; this cuts it
    // once, at an odd step so no kind of byte is always whole.
    let bytes = ANSWER.as_bytes();
    for at in (0..=bytes.len()).step_by(7) {
        let mut sse = SseParser::default();
        let mut decoder = Stream::default();
        let mut events = sse.push(&bytes[..at]);
        events.extend(sse.push(&bytes[at..]));
        events.extend(sse.finish());
        let mut text = String::new();
        for event in &events {
            text.extend(decoder.event(event).unwrap());
        }
        assert_answer(&text, decoder, at);
    }
}

fn end_of(events: &str) -> Reply {
    let mut sse = SseParser::default();
    let mut decoder = Stream::default();
    for event in sse.push(events.as_bytes()).into_iter().chain(sse.finish()) {
        decoder.event(&event).unwrap();
    }
    assert!(decoder.complete(), "{events}");
    decoder.reply(false)
}

fn data(kind: &str, rest: &str) -> String {
    format!("event: {kind}\ndata: {{\"type\":\"{kind}\"{rest}}}\n\n")
}

#[test]
fn each_way_an_answer_ends_has_its_stop() {
    let plain = end_of(&data(
        "response.completed",
        ",\"response\":{\"status\":\"completed\",\"output\":[]}",
    ));
    assert_eq!((plain.stop, plain.text.as_str()), (Stop::End, ""));
    let length = end_of(&data(
        "response.incomplete",
        ",\"response\":{\"incomplete_details\":{\"reason\":\"max_output_tokens\"}}",
    ));
    assert_eq!(length.stop, Stop::Length);
    let filtered = end_of(&data(
        "response.incomplete",
        ",\"response\":{\"incomplete_details\":{\"reason\":\"content_filter\"}}",
    ));
    assert_eq!(filtered.stop, Stop::Refusal);
    let full = end_of(&data(
        "response.failed",
        ",\"response\":{\"error\":{\"code\":\"context_length_exceeded\",\"message\":\"Too long\"}}",
    ));
    assert_eq!(full.stop, Stop::Full);
    // A refusal's words are shown like any text; the answer is a refusal.
    let refusal = end_of(&format!(
        "{}{}{}",
        data(
            "response.refusal.delta",
            ",\"output_index\":0,\"delta\":\"I can't help with that.\""
        ),
        data(
            "response.output_item.done",
            ",\"output_index\":0,\"item\":{\"type\":\"message\",\"content\":[{\"type\":\"refusal\",\"refusal\":\"I can't help with that.\"}]}"
        ),
        data("response.completed", ",\"response\":{\"output\":[]}"),
    ));
    assert_eq!(
        (refusal.stop, refusal.text.as_str()),
        (Stop::Refusal, "I can't help with that.")
    );
}

#[test]
fn a_failure_is_an_error_in_words() {
    let mut sse = SseParser::default();
    let limit = data(
        "response.failed",
        ",\"response\":{\"error\":{\"code\":\"subscription_sharing_usage_limit_exceeded\",\"message\":\"x\"}}",
    );
    let event = sse.push(limit.as_bytes()).remove(0);
    let err = Stream::default().event(&event).unwrap_err();
    assert!(
        err.contains("usage limit is reached") && err.contains("ChatGPT, Settings, Usage"),
        "{err}"
    );

    let other = data(
        "error",
        ",\"code\":\"server_error\",\"message\":\"The server had an error.\",\"param\":null",
    );
    let event = sse.push(other.as_bytes()).remove(0);
    let err = Stream::default().event(&event).unwrap_err();
    assert_eq!(err, "The server had an error (server_error)");
}

#[test]
fn what_the_events_missed_the_completed_answer_supplies() {
    // No item events at all: the answer's own output has everything.
    let output = json!([
        {"type": "reasoning", "summary": [], "encrypted_content": "enc"},
        {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "Done."}]},
        {"type": "function_call", "call_id": "call_1", "name": "list_tags", "arguments": "{}"}
    ]);
    let stream = data(
        "response.completed",
        &format!(",\"response\":{{\"output\":{output}}}"),
    );
    let mut sse = SseParser::default();
    let mut decoder = Stream::default();
    let mut shown = String::new();
    for event in sse.push(stream.as_bytes()) {
        shown.extend(decoder.event(&event).unwrap());
    }
    assert_eq!(shown, "Done.", "text no delta showed is shown at the end");
    let reply = decoder.reply(false);
    assert_eq!((reply.text.as_str(), reply.stop), ("Done.", Stop::Tools));
    assert_eq!(reply.calls[0].name, "list_tags");
    assert_eq!(reply.items.unwrap().len(), 3);

    // A reasoning item without its encrypted content cannot go back.
    let bare = json!([{"type": "reasoning", "summary": []}]);
    let reply = end_of(&data(
        "response.completed",
        &format!(",\"response\":{{\"output\":{bare}}}"),
    ));
    assert_eq!(reply.items, Some(vec![]));
}

#[test]
fn stopped_halfway_it_keeps_its_text_and_none_of_its_calls() {
    let cut = &ANSWER[..ANSWER
        .find("event: response.function_call_arguments.done")
        .unwrap()];
    let mut sse = SseParser::default();
    let mut decoder = Stream::default();
    for event in sse.push(cut.as_bytes()) {
        decoder.event(&event).unwrap();
    }
    assert!(!decoder.complete());
    let reply = decoder.reply(true);
    assert_eq!(reply.stop, Stop::Cancelled);
    assert_eq!(reply.text, "I'll capture that for you — Grüße.");
    assert!(reply.calls.is_empty(), "half a call never runs");
    assert_eq!(reply.items, None, "nothing half written goes back");
}
