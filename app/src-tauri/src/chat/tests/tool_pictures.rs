//! A picture a tool drew (a slide) goes to the model with the latest results, in the form each
//! provider takes pictures in, and with no earlier results: the model has looked at those already.

use serde_json::{Value, json};

use crate::chat::model::{Image, Message, Reply, Stop, ToolCall, ToolOutput};
use crate::chat::{anthropic, openai, responses};

fn answer(id: &str) -> Message {
    Message::Assistant(Reply {
        text: String::new(),
        calls: vec![ToolCall {
            id: id.to_owned(),
            name: "render_slide".to_owned(),
            arguments: "{}".to_owned(),
        }],
        stop: Stop::Tools,
        blocks: None,
        items: None,
    })
}

fn result(id: &str, pictures: bool) -> Message {
    let images = if pictures {
        vec![Image {
            id: String::new(),
            name: "picture 1".to_owned(),
            mime: "image/png".to_owned(),
            data: "AAAA".to_owned(),
        }]
    } else {
        Vec::new()
    };
    Message::Results(vec![ToolOutput {
        id: id.to_owned(),
        content: "{\"width\":1920}".to_owned(),
        is_error: false,
        images,
    }])
}

fn thread(first_drew: bool) -> Vec<Message> {
    vec![
        Message::User("Look at slide 2".to_owned()),
        answer("toolu_01"),
        result("toolu_01", first_drew),
        answer("toolu_02"),
        result("toolu_02", true),
    ]
}

fn has(value: &Value, needle: &str) -> bool {
    value.to_string().contains(needle)
}

#[test]
fn claude_gets_the_picture_inside_the_tool_result_and_only_for_the_latest_results() {
    let messages = anthropic::messages(&thread(true));
    let first = &messages[2]["content"][0]["content"];
    assert_eq!(
        first, "{\"width\":1920}",
        "an earlier picture is not sent again"
    );
    let latest = &messages[4]["content"][0]["content"];
    assert_eq!(latest[0]["type"], "image");
    assert_eq!(latest[0]["source"]["media_type"], "image/png");
    assert_eq!(latest[0]["source"]["data"], "AAAA");
    assert_eq!(
        latest[1],
        json!({"type": "text", "text": "{\"width\":1920}"})
    );
}

#[test]
fn a_provider_that_takes_only_text_in_a_result_gets_the_picture_as_the_next_user_message() {
    let chat = openai::messages("", &thread(true));
    // user, assistant, tool, assistant, tool, then the pictures.
    assert_eq!(chat.len(), 6);
    assert_eq!(chat[4]["role"], "tool");
    assert_eq!(chat[5]["role"], "user");
    assert!(has(&chat[5]["content"], "data:image/png;base64,AAAA"));
    assert!(
        !has(&chat[2], "AAAA"),
        "an earlier result carries no picture"
    );

    let input = responses::input(&thread(true));
    let last = input.last().unwrap();
    assert_eq!(last["role"], "user");
    assert!(has(&last["content"], "input_image"));
    assert_eq!(input.iter().filter(|i| has(i, "input_image")).count(), 1);
}

#[test]
fn a_thread_without_pictures_is_sent_exactly_as_before() {
    let plain = vec![
        Message::User("Hi".to_owned()),
        answer("toolu_01"),
        result("toolu_01", false),
    ];
    assert_eq!(openai::messages("", &plain).len(), 3);
    assert_eq!(
        anthropic::messages(&plain)[2]["content"][0]["content"],
        "{\"width\":1920}"
    );
    assert!(
        !responses::input(&plain)
            .iter()
            .any(|i| has(i, "input_image"))
    );
}
