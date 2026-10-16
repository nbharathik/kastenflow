//! The Responses API's request: the thread as `input` whatever provider said
//! each part of it, the body, the tools in either form, and what a refusal
//! names as unsupported.

use kasten_mcp::tools::specs;
use serde_json::json;

use super::responses::{ANSWER, decode};
use crate::chat::capabilities::{Applied, Effort};
use crate::chat::model::{Call, Message, Reply, Stop, ToolCall, ToolOutput};
use crate::chat::responses::{self, Shape};

fn call(id: &str, name: &str, arguments: &str) -> ToolCall {
    ToolCall {
        id: id.to_owned(),
        name: name.to_owned(),
        arguments: arguments.to_owned(),
    }
}

/// A thread: the person, an answer of this API (items), the results, an
/// answer of another provider (text and calls) and the person again.
fn thread() -> Vec<Message> {
    let (_, decoder) = decode(ANSWER, 50);
    let here = decoder.reply(false);
    let elsewhere = Reply {
        text: "Looking.".to_owned(),
        calls: vec![
            call("toolu_01", "search", "{\"query\": \"venue\""),
            call("toolu_02", "list_tags", "{}"),
        ],
        stop: Stop::Tools,
        blocks: Some(vec![json!({"type": "text", "text": "Looking."})]),
        items: None,
    };
    let result = |id: &str, content: &str, is_error| ToolOutput {
        id: id.to_owned(),
        content: content.to_owned(),
        is_error,
    };
    vec![
        Message::User("Capture this".to_owned()),
        Message::Assistant(here),
        Message::Results(vec![
            result("call_capture", "{\"ok\":true}", false),
            result("call_tags", "{}", false),
        ]),
        Message::Assistant(elsewhere),
        Message::Results(vec![
            result("toolu_01", "{\"INVALID_JSON\":\"x\"}", true),
            result("toolu_02", "{}", false),
        ]),
        Message::User("Go on".to_owned()),
    ]
}

#[test]
fn the_thread_goes_back_as_items_whatever_provider_said_each_part() {
    let input = responses::input(&thread());
    // The person, 4 items of this API's answer, 2 results, the other
    // provider's text and 2 calls, 2 results, the person.
    assert_eq!(input.len(), 1 + 4 + 2 + 3 + 2 + 1, "{input:#?}");
    assert_eq!(input[0], json!({"role": "user", "content": "Capture this"}));
    // This API's own items, as kept.
    assert_eq!(input[1]["type"], "reasoning");
    assert_eq!(input[1]["encrypted_content"], "gAAAAABqenc==");
    assert!(
        input[1].get("id").is_none(),
        "nothing is stored, so no item id goes back"
    );
    assert_eq!(input[4]["type"], "function_call");
    assert_eq!(
        input[5],
        json!({"type": "function_call_output", "call_id": "call_capture", "output": "{\"ok\":true}"})
    );
    // Another provider's answer as text and calls; arguments that were not
    // JSON go back as {}, the error says why.
    assert_eq!(
        input[7],
        json!({"role": "assistant", "content": "Looking."})
    );
    assert_eq!(
        input[8],
        json!({"type": "function_call", "call_id": "toolu_01", "name": "search", "arguments": "{}"})
    );
    assert_eq!(
        input[10],
        json!({"type": "function_call_output", "call_id": "toolu_01", "output": "Error: {\"INVALID_JSON\":\"x\"}"})
    );
    assert_eq!(
        input.last().unwrap(),
        &json!({"role": "user", "content": "Go on"})
    );
}

#[test]
fn a_thread_never_hands_this_apis_items_to_another_provider() {
    // The items live in `items`, so Claude and the others read the text and
    // calls only.
    let thread = thread();
    let claude = crate::chat::anthropic::messages(&thread);
    assert_eq!(
        claude[1]["content"][0],
        json!({"type": "text", "text": "I'll capture that for you — Grüße."})
    );
    assert!(claude[1]["content"].to_string().contains("tool_use"));
    assert!(
        !claude[1]["content"]
            .to_string()
            .contains("encrypted_content")
    );
    let local = crate::chat::openai::messages("", &thread);
    assert!(!json!(local).to_string().contains("encrypted_content"));
}

#[test]
fn the_request_asks_for_what_this_route_takes_and_nothing_it_refuses() {
    let thread = [Message::User("Hi".to_owned())];
    let call = Call {
        system: "Be brief.",
        messages: &thread,
        tools: &[],
    };
    let body = responses::body("gpt-6.1-sol", &call, Shape::default(), &Applied::default());
    assert_eq!(
        body,
        json!({
            "model": "gpt-6.1-sol",
            "instructions": "Be brief.",
            "input": [{"role": "user", "content": "Hi"}],
            "store": false,
            "stream": true,
            "include": ["reasoning.encrypted_content"]
        })
    );
    for refused in [
        "background",
        "conversation",
        "max_output_tokens",
        "max_tool_calls",
        "metadata",
        "moderation",
        "multi_agent",
        "prompt",
        "prompt_cache_retention",
        "safety_identifier",
        "temperature",
        "top_logprobs",
        "top_p",
        "truncation",
        "user",
        "previous_response_id",
    ] {
        assert!(body.get(refused).is_none(), "{refused}");
    }
    // No system prompt, no `instructions`; no tools, no `tools`; and a
    // system message never rides in `input`.
    let bare = Call {
        system: "",
        messages: &thread,
        tools: &[],
    };
    let plain = Shape {
        reasoning: false,
        namespaced: false,
        ..Shape::default()
    };
    let body = responses::body("m", &bare, plain, &Applied::default());
    assert!(
        body.get("instructions").is_none()
            && body.get("tools").is_none()
            && body.get("include").is_none()
    );
    assert!(body["input"].to_string().find("\"system\"").is_none());
}

#[test]
fn tools_go_flat_or_in_a_namespace_when_the_server_wants_that() {
    let tools = specs();
    let thread = [Message::User("Hi".to_owned())];
    let call = Call {
        system: "",
        messages: &thread,
        tools: &tools,
    };
    let flat = responses::body("m", &call, Shape::default(), &Applied::default());
    let listed = flat["tools"].as_array().unwrap();
    assert_eq!(listed.len(), tools.len());
    let search = listed.iter().find(|t| t["name"] == "search").unwrap();
    assert_eq!(search["type"], "function");
    assert_eq!(search["parameters"]["type"], "object");
    assert!(search["parameters"].get("$schema").is_none());
    assert!(
        search.get("function").is_none(),
        "the flat form, not chat completions'"
    );

    let namespaced = Shape {
        namespaced: true,
        ..Shape::default()
    };
    let grouped = responses::body("m", &call, namespaced, &Applied::default());
    let namespace = &grouped["tools"][0];
    assert_eq!(
        (namespace["type"].as_str(), namespace["name"].as_str()),
        (Some("namespace"), Some("kasten"))
    );
    assert_eq!(namespace["tools"].as_array().unwrap().len(), tools.len());
    assert_eq!(grouped["tools"].as_array().unwrap().len(), 1);
}

#[test]
fn a_feature_the_server_names_is_dropped_for_the_next_try() {
    let unsupported = |param: &str| {
        format!(
            r#"{{"error":{{"code":"subscription_sharing_unsupported_capability","param":"{param}","message":"Unsupported input"}}}}"#
        )
    };
    let first = Shape::default();
    let without = first.adapted(&unsupported("include"), false).unwrap();
    assert_eq!(
        without,
        Shape {
            effort: true,
            reasoning: false,
            namespaced: false
        }
    );
    let grouped = without.adapted(&unsupported("tools[0]"), false).unwrap();
    assert_eq!(
        grouped,
        Shape {
            effort: true,
            reasoning: false,
            namespaced: true
        }
    );
    assert_eq!(
        grouped.adapted(&unsupported("tools[0]"), false),
        None,
        "nothing is left to drop"
    );
    // The first refusal that names tools asks for the namespace.
    assert!(
        first
            .adapted(&unsupported("tools"), false)
            .unwrap()
            .namespaced
    );
    // Refusals that name nothing to drop change nothing.
    for body in [
        r#"{"error":{"code":"invalid_api_key","message":"Bad key"}}"#,
        r#"{"error":{"message":"Unsupported value: 'x' for model"}}"#,
        "<html>",
        "",
    ] {
        assert_eq!(first.adapted(body, false), None, "{body}");
        assert_eq!(first.adapted(body, true), None, "{body}");
    }
}

#[test]
fn a_reasoning_effort_the_server_names_is_the_first_to_go() {
    let unsupported = |param: &str, message: &str| {
        format!(
            r#"{{"error":{{"code":"subscription_sharing_unsupported_capability","param":"{param}","message":"{message}"}}}}"#
        )
    };
    let first = Shape::default();
    for body in [
        unsupported("reasoning.effort", "Unsupported parameter"),
        unsupported("reasoning", "Unsupported parameter"),
        unsupported("", "Unsupported value: effort"),
    ] {
        let next = first.adapted(&body, true).unwrap();
        assert_eq!(
            next,
            Shape {
                effort: false,
                ..first
            },
            "{body}"
        );
    }
    // A request that sent no effort cannot have been refused for one: the
    // same words mean `include`, as they did before.
    let dropped = first
        .adapted(&unsupported("reasoning.effort", "Unsupported"), false)
        .unwrap();
    assert_eq!(
        dropped,
        Shape {
            reasoning: false,
            ..first
        }
    );
    // The `include` parameter's own name has "reasoning" in it: not an effort.
    let include = unsupported("include", "Unsupported value: reasoning.encrypted_content");
    assert_eq!(
        first.adapted(&include, true).unwrap(),
        Shape {
            reasoning: false,
            ..first
        },
        "an effort that was sent is not blamed for `include`"
    );
    // With the effort gone, the next refusal about reasoning is the rest's.
    let no_effort = Shape {
        effort: false,
        ..first
    };
    assert!(
        !no_effort
            .adapted(&unsupported("reasoning", "Unsupported"), true)
            .unwrap()
            .reasoning
    );
}

#[test]
fn only_the_reasoning_effort_is_read_from_the_settings_and_only_while_allowed() {
    let thread = [Message::User("Hi".to_owned())];
    let call = Call {
        system: "",
        messages: &thread,
        tools: &[],
    };
    // Settings that could never reach this route: the body leaves them out.
    let everything = Applied {
        effort: Some(Effort::High),
        thinking_budget: Some(2000),
        temperature: Some(0.2),
        max_output: Some(1000),
    };
    let body = responses::body("m", &call, Shape::default(), &everything);
    assert_eq!(body["reasoning"], json!({"effort": "high"}));
    for refused in [
        "temperature",
        "max_output_tokens",
        "max_tokens",
        "max_completion_tokens",
        "thinking",
        "reasoning_effort",
        "top_p",
    ] {
        assert!(body.get(refused).is_none(), "{refused}");
    }
    // Without the effort the shape allows, it is not sent.
    let no_effort = Shape {
        effort: false,
        ..Shape::default()
    };
    assert!(
        responses::body("m", &call, no_effort, &everything)
            .get("reasoning")
            .is_none()
    );
    // And not asked for, not sent.
    assert!(
        responses::body("m", &call, Shape::default(), &Applied::default())
            .get("reasoning")
            .is_none()
    );
}

#[test]
fn function_calls_that_will_not_run_leave_no_trace() {
    let mut items = vec![
        json!({"type": "reasoning", "summary": [], "encrypted_content": "a"}),
        json!({"role": "assistant", "content": "Text"}),
        json!({"type": "reasoning", "summary": [], "encrypted_content": "b"}),
        json!({"type": "function_call", "call_id": "c", "name": "n", "arguments": "{}"}),
    ];
    responses::without_calls(&mut items);
    // The reasoning that led only to the call goes with it; the text stays
    // with the reasoning before it.
    assert_eq!(items.len(), 2);
    assert_eq!(items[1]["content"], "Text");
    let only_call =
        json!({"type": "function_call", "call_id": "c", "name": "n", "arguments": "{}"});
    let mut only_call = vec![only_call];
    responses::without_calls(&mut only_call);
    assert!(only_call.is_empty());
}
