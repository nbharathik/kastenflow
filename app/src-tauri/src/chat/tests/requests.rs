//! What goes to each provider: the thread in its format, the tools, the
//! limits and the address.

use kasten_mcp::tools::specs;
use serde_json::{Value, json};

use crate::chat::model::{Call, Message, Reply, Stop, ToolCall, ToolOutput};
use crate::chat::{anthropic, openai};

fn call(id: &str, name: &str, arguments: &str) -> ToolCall {
    ToolCall {
        id: id.to_owned(),
        name: name.to_owned(),
        arguments: arguments.to_owned(),
    }
}

/// A thread with one of Claude's answers (thinking included), one from a
/// local model, their results and the person's next message.
fn thread() -> Vec<Message> {
    let claude = Reply {
        text: "Looking.".to_owned(),
        calls: vec![call("toolu_01", "list_tags", "{}")],
        stop: Stop::Tools,
        blocks: Some(vec![
            json!({"type": "thinking", "thinking": "", "signature": "sig=="}),
            json!({"type": "text", "text": "Looking."}),
            json!({"type": "tool_use", "id": "toolu_01", "name": "list_tags", "input": {}}),
        ]),
        items: None,
    };
    let local = Reply {
        text: String::new(),
        calls: vec![call(
            "chatcmpl-tool.4f2a",
            "search",
            "{\"query\": \"venue\"",
        )],
        stop: Stop::Tools,
        blocks: None,
        items: None,
    };
    let result = |id: &str, content: &str, is_error| ToolOutput {
        id: id.to_owned(),
        content: content.to_owned(),
        is_error,
    };
    vec![
        Message::User("Which tags do I use?".to_owned()),
        Message::Assistant(claude),
        Message::Results(vec![result("toolu_01", "{\"tags\":{}}", false)]),
        Message::Assistant(local),
        Message::Results(vec![result(
            "chatcmpl-tool.4f2a",
            "{\"INVALID_JSON\":\"â€¦\"}",
            true,
        )]),
        Message::User("Go on".to_owned()),
    ]
}

#[test]
fn claude_gets_its_own_blocks_back_and_results_before_words() {
    let messages = anthropic::messages(&thread());
    assert_eq!(messages.len(), 5);
    // Claude's answer goes back byte for byte, thinking and all.
    assert_eq!(
        messages[1]["content"][0],
        json!({"type": "thinking", "thinking": "", "signature": "sig=="})
    );
    assert_eq!(messages[1]["content"].as_array().unwrap().len(), 3);
    assert_eq!(
        messages[2]["content"],
        json!([{"type": "tool_result", "tool_use_id": "toolu_01", "content": "{\"tags\":{}}"}])
    );
    // Another model's answer as blocks; ids made acceptable, the same both times.
    assert_eq!(
        messages[3]["content"],
        json!([{"type": "tool_use", "id": "chatcmpl-tool_4f2a", "name": "search", "input": {}}])
    );
    // The results and the next words share one user turn, results first.
    assert_eq!(messages[4]["role"], "user");
    assert_eq!(
        messages[4]["content"],
        json!([
            {"type": "tool_result", "tool_use_id": "chatcmpl-tool_4f2a", "content": "{\"INVALID_JSON\":\"â€¦\"}", "is_error": true},
            {"type": "text", "text": "Go on"}
        ])
    );
}

#[test]
fn claude_requests_carry_the_prompt_tools_and_limits() {
    let tools = specs();
    let thread = thread();
    let call = Call {
        system: "You are Kasten's assistant.",
        messages: &thread,
        tools: &tools,
    };
    let body = anthropic::body("model-large", 16_000, &call);
    assert_eq!(body["model"], "model-large");
    assert_eq!(body["max_tokens"], 16_000);
    assert_eq!(body["stream"], true);
    // The prompt and the tools are the same every turn: both are cached,
    // with a breakpoint on the system block and one on the last tool.
    assert_eq!(
        body["system"],
        json!([{"type": "text", "text": "You are Kasten's assistant.", "cache_control": {"type": "ephemeral"}}])
    );
    let tools: &Vec<Value> = body["tools"].as_array().unwrap();
    let catalogue = specs();
    assert_eq!(tools.len(), catalogue.len());
    for (actual, expected) in tools.iter().zip(&catalogue) {
        assert_eq!(actual["name"], expected.name.as_str());
    }
    let (last, preceding) = tools.split_last().expect("tools are advertised");
    assert_eq!(last["cache_control"], json!({"type": "ephemeral"}));
    assert!(preceding.iter().all(|t| t.get("cache_control").is_none()));
    let search = tools.iter().find(|t| t["name"] == "search").unwrap();
    assert_eq!(search["input_schema"]["type"], "object");
    assert!(search["input_schema"].get("$schema").is_none());
    assert!(
        search["description"]
            .as_str()
            .unwrap()
            .starts_with("Ranked full-text search")
    );

    assert_eq!(anthropic::url(""), "https://api.anthropic.com/v1/messages");
    assert_eq!(
        anthropic::url("https://api.anthropic.com/v1/"),
        "https://api.anthropic.com/v1/messages"
    );
    assert_eq!(
        anthropic::url(" https://gateway.example/claude "),
        "https://gateway.example/claude/v1/messages"
    );
}

#[test]
fn openai_servers_get_the_thread_as_chat_messages() {
    let messages = openai::messages("Be brief.", &thread());
    assert_eq!(
        messages[0],
        json!({"role": "system", "content": "Be brief."})
    );
    assert_eq!(
        messages[1],
        json!({"role": "user", "content": "Which tags do I use?"})
    );
    assert_eq!(
        messages[2],
        json!({"role": "assistant", "content": "Looking.", "tool_calls": [
            {"id": "toolu_01", "type": "function", "function": {"name": "list_tags", "arguments": "{}"}}
        ]})
    );
    assert_eq!(
        messages[3],
        json!({"role": "tool", "tool_call_id": "toolu_01", "content": "{\"tags\":{}}"})
    );
    // Arguments that were not JSON go back as {}; the error says why.
    assert_eq!(messages[4]["content"], Value::Null);
    assert_eq!(messages[4]["tool_calls"][0]["function"]["arguments"], "{}");
    assert_eq!(
        messages[5],
        json!({"role": "tool", "tool_call_id": "chatcmpl-tool.4f2a", "content": "Error: {\"INVALID_JSON\":\"â€¦\"}"})
    );
    assert_eq!(messages[6], json!({"role": "user", "content": "Go on"}));
}

#[test]
fn openai_requests_name_the_right_token_limit() {
    let tools = specs();
    let thread = thread();
    let call = Call {
        system: "",
        messages: &thread,
        tools: &tools,
    };
    let local = openai::body(
        "http://llm-server:8000/v1/chat/completions",
        "local-model",
        4096,
        &call,
    );
    assert_eq!(local["max_tokens"], 4096);
    assert_eq!(local["stream"], true);
    assert_eq!(
        local["messages"][0]["role"], "user",
        "no empty system message"
    );
    let tool = &local["tools"][0];
    assert_eq!(tool["type"], "function");
    assert!(tool["function"]["parameters"].get("$schema").is_none());
    let official = openai::body(
        "https://api.openai.com/v1/chat/completions",
        "other-model",
        4096,
        &call,
    );
    assert_eq!(official["max_completion_tokens"], 4096);
    assert!(official.get("max_tokens").is_none());

    assert_eq!(
        openai::url("http://llm-server:8000/v1/").unwrap(),
        "http://llm-server:8000/v1/chat/completions"
    );
    assert_eq!(
        openai::url("https://api.openai.com/v1/chat/completions").unwrap(),
        "https://api.openai.com/v1/chat/completions"
    );
    assert!(openai::url(" ").is_err());
}
