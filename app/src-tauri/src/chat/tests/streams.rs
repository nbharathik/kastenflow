//! Both providers' streams, from recorded-style fixtures fed in chunks of
//! every size: text as it comes, tool calls whose arguments arrive in
//! pieces, and why each answer stopped.

use serde_json::json;

use crate::chat::model::{Reply, Stop};
use crate::chat::sse::SseParser;
use crate::chat::{anthropic, openai};

/// A Claude answer that thinks (display omitted, so the thinking is empty
/// and only its signature comes), says a sentence and captures a card.
pub const CLAUDE: &str = r#"event: message_start
data: {"type":"message_start","message":{"id":"msg_01XFDUDYJgAACzvnptvVoYEL","type":"message","role":"assistant","content":[],"model":"model-large","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":2679,"output_tokens":3}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"EqQBCgIYAhIM1gbcDa9GJwZA2b3hGgxBdjrkzLoky3dl1pki"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}

event: ping
data: {"type": "ping"}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"I'll capture that "}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"for you — Grüße."}}

event: content_block_stop
data: {"type":"content_block_stop","index":1}

event: content_block_start
data: {"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"toolu_01T1x1fJ34qAmk2tNTrN7Up6","name":"capture","input":{}}}

event: content_block_delta
data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{\"markdown\": \"Ask the team"}}

event: content_block_delta
data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":" about the venue\", \"tags\": [\"pa"}}

event: content_block_delta
data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"per\"]}"}}

event: content_block_stop
data: {"type":"content_block_stop","index":2}

event: content_block_start
data: {"type":"content_block_start","index":3,"content_block":{"type":"tool_use","id":"toolu_01A09q90qw90lq917835lq9","name":"list_tags","input":{}}}

event: content_block_stop
data: {"type":"content_block_stop","index":3}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":89}}

event: message_stop
data: {"type":"message_stop"}

"#;

/// A vLLM answer: text, then two tool calls, the first's arguments in
/// pieces, then a usage chunk and `[DONE]`.
pub const VLLM: &str = r#"data: {"id":"chatcmpl-7c1","object":"chat.completion.chunk","created":1790236800,"model":"local-model","choices":[{"index":0,"delta":{"role":"assistant","content":""},"logprobs":null,"finish_reason":null}]}

data: {"id":"chatcmpl-7c1","object":"chat.completion.chunk","created":1790236800,"model":"local-model","choices":[{"index":0,"delta":{"content":"Let me"},"logprobs":null,"finish_reason":null}]}

data: {"id":"chatcmpl-7c1","object":"chat.completion.chunk","created":1790236800,"model":"local-model","choices":[{"index":0,"delta":{"content":" look."},"logprobs":null,"finish_reason":null}]}

data: {"id":"chatcmpl-7c1","object":"chat.completion.chunk","created":1790236800,"model":"local-model","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"chatcmpl-tool-4f2a","type":"function","function":{"name":"search","arguments":""}}]},"logprobs":null,"finish_reason":null}]}

data: {"id":"chatcmpl-7c1","object":"chat.completion.chunk","created":1790236800,"model":"local-model","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"query\": "}}]},"logprobs":null,"finish_reason":null}]}

data: {"id":"chatcmpl-7c1","object":"chat.completion.chunk","created":1790236800,"model":"local-model","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"venue\", \"limit\": 5}"}}]},"logprobs":null,"finish_reason":null}]}

data: {"id":"chatcmpl-7c1","object":"chat.completion.chunk","created":1790236800,"model":"local-model","choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"id":"chatcmpl-tool-9b1c","type":"function","function":{"name":"list_tags","arguments":"{}"}}]},"logprobs":null,"finish_reason":null}]}

data: {"id":"chatcmpl-7c1","object":"chat.completion.chunk","created":1790236800,"model":"local-model","choices":[{"index":0,"delta":{},"logprobs":null,"finish_reason":"tool_calls"}]}

data: {"id":"chatcmpl-7c1","object":"chat.completion.chunk","created":1790236800,"model":"local-model","choices":[],"usage":{"prompt_tokens":1210,"total_tokens":1251,"completion_tokens":41}}

data: [DONE]

"#;

/// Feeds `stream` in chunks of `size` bytes; returns the text pieces and the reply.
fn decode_anthropic(stream: &str, size: usize) -> (String, Reply) {
    let mut sse = SseParser::default();
    let mut decoder = anthropic::Stream::default();
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
    assert!(decoder.ended() && decoder.complete());
    (text, decoder.reply(false))
}

fn decode_openai(stream: &str, size: usize) -> (String, openai::Stream) {
    let mut sse = SseParser::default();
    let mut decoder = openai::Stream::default();
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

#[test]
fn claude_streams_text_thinking_and_tool_calls() {
    for size in [1, 2, 7, 64, 1000, CLAUDE.len()] {
        let (text, reply) = decode_anthropic(CLAUDE, size);
        assert_eq!(text, "I'll capture that for you — Grüße.", "size {size}");
        assert_eq!(reply.text, text);
        assert_eq!(reply.stop, Stop::Tools);
        assert_eq!(reply.calls.len(), 2);
        let capture = &reply.calls[0];
        assert_eq!(capture.id, "toolu_01T1x1fJ34qAmk2tNTrN7Up6");
        assert_eq!(capture.name, "capture");
        assert_eq!(
            capture.input().unwrap(),
            json!({"markdown": "Ask the team about the venue", "tags": ["paper"]})
        );
        assert_eq!(reply.calls[1].input().unwrap(), json!({}));
        // The blocks go back as they came, the signed thinking first.
        let blocks = reply.blocks.unwrap();
        assert_eq!(
            blocks[0],
            json!({"type": "thinking", "thinking": "", "signature": "EqQBCgIYAhIM1gbcDa9GJwZA2b3hGgxBdjrkzLoky3dl1pki"})
        );
        assert_eq!(blocks[1], json!({"type": "text", "text": text}));
        assert_eq!(blocks[2]["input"]["tags"], json!(["paper"]));
        assert_eq!(blocks.len(), 4);
    }
}

#[test]
fn claude_cut_short_keeps_only_what_is_whole() {
    let half = &CLAUDE[..CLAUDE.find("per\\\"]}").unwrap()];
    let mut sse = SseParser::default();
    let mut decoder = anthropic::Stream::default();
    for event in sse.push(half.as_bytes()) {
        decoder.event(&event).unwrap();
    }
    assert!(!decoder.complete());
    let reply = decoder.reply(true);
    assert_eq!(reply.stop, Stop::Cancelled);
    assert!(reply.calls.is_empty(), "half a call never runs");
    let blocks = reply.blocks.unwrap();
    assert_eq!(blocks.len(), 2, "{blocks:?}");
    assert_eq!(blocks[0]["type"], "thinking");
}

#[test]
fn claude_errors_and_stop_reasons() {
    let overloaded = "event: error\ndata: {\"type\": \"error\", \"error\": {\"type\": \"overloaded_error\", \"message\": \"Overloaded\"}}\n\n";
    let mut sse = SseParser::default();
    let event = sse.push(overloaded.as_bytes()).remove(0);
    let err = anthropic::Stream::default().event(&event).unwrap_err();
    assert_eq!(err, "Overloaded (overloaded_error)");

    for (reason, stop) in [
        ("end_turn", Stop::End),
        ("max_tokens", Stop::Length),
        ("refusal", Stop::Refusal),
        ("model_context_window_exceeded", Stop::Full),
        ("pause_turn", Stop::Pause),
    ] {
        let stream = format!(
            "event: message_delta\ndata: {{\"type\":\"message_delta\",\"delta\":{{\"stop_reason\":\"{reason}\"}}}}\n\n"
        );
        let mut sse = SseParser::default();
        let mut decoder = anthropic::Stream::default();
        for event in sse.push(stream.as_bytes()) {
            decoder.event(&event).unwrap();
        }
        assert!(decoder.complete() && !decoder.ended());
        assert_eq!(decoder.reply(false).stop, stop, "{reason}");
    }
}

#[test]
fn vllm_streams_text_and_tool_calls_in_pieces() {
    for size in [1, 3, 50, VLLM.len()] {
        let (text, decoder) = decode_openai(VLLM, size);
        assert!(decoder.ended());
        let reply = decoder.reply(false);
        assert_eq!(text, "Let me look.", "size {size}");
        assert_eq!(reply.stop, Stop::Tools);
        assert_eq!(reply.calls.len(), 2);
        assert_eq!(reply.calls[0].id, "chatcmpl-tool-4f2a");
        assert_eq!(reply.calls[0].name, "search");
        assert_eq!(
            reply.calls[0].input().unwrap(),
            json!({"query": "venue", "limit": 5})
        );
        assert_eq!(reply.calls[1].name, "list_tags");
        assert_eq!(reply.blocks, None);
    }
}

#[test]
fn openai_servers_that_leave_things_out() {
    // No index, arguments continued by id or by order, no [DONE].
    let stream = concat!(
        "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"id\":\"call_a\",\"function\":{\"name\":\"read_note\",\"arguments\":\"{\\\"note\\\":\"}}]}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"function\":{\"arguments\":\" \\\"Seaside trip\\\"}\"}}]}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"id\":\"call_b\",\"function\":{\"name\":\"list_tags\",\"arguments\":{}}}]}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"refusal\":\"Also: \"},\"finish_reason\":\"tool_calls\"}]}\n\n",
    );
    let (text, decoder) = decode_openai(stream, 5);
    assert!(decoder.complete() && !decoder.ended());
    let reply = decoder.reply(false);
    assert_eq!(text, "Also: ");
    assert_eq!(
        reply.calls[0].input().unwrap(),
        json!({"note": "Seaside trip"})
    );
    assert_eq!(reply.calls[1].input().unwrap(), json!({}));
    // A call without an id gets one.
    let bare = "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"name\":\"list_tags\",\"arguments\":\"{}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\n";
    let reply = decode_openai(bare, 9).1.reply(false);
    assert!(reply.calls[0].id.starts_with("call_"));
    // Errors in the stream, and the other stop reasons.
    let mut sse = SseParser::default();
    let event = sse
        .push(b"data: {\"error\": {\"message\": \"The model is loading\", \"code\": 503}}\n\n")
        .remove(0);
    let err = openai::Stream::default().event(&event).unwrap_err();
    assert_eq!(err, "The model is loading");
    for (reason, stop) in [
        ("stop", Stop::End),
        ("length", Stop::Length),
        ("content_filter", Stop::Refusal),
    ] {
        let stream = format!(
            "data: {{\"choices\":[{{\"delta\":{{}},\"finish_reason\":\"{reason}\"}}]}}\n\n"
        );
        assert_eq!(decode_openai(&stream, 4).1.reply(false).stop, stop);
    }
}
