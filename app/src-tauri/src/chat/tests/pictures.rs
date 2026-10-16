//! A picture in a user message as each provider takes it, and the request's
//! JSON with attachments in it.

use serde_json::json;

use crate::chat::context;
use crate::chat::model::{Image, Message};
use crate::chat::{AttachKind, ChatRequest, anthropic, openai, responses};

fn image(data: &str) -> Image {
    Image {
        id: "a".repeat(64),
        name: "shot.png".to_owned(),
        mime: "image/png".to_owned(),
        data: data.to_owned(),
    }
}

#[test]
fn each_provider_gets_a_picture_in_its_own_form() {
    let thread = [Message::UserImages {
        text: "What is this?".to_owned(),
        images: vec![image("QUJD")],
    }];
    // Anthropic: the picture first, then the words, in one user turn.
    assert_eq!(
        anthropic::messages(&thread),
        [json!({"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "QUJD"}},
            {"type": "text", "text": "What is this?"}
        ]})]
    );
    // Chat completions: text and image_url parts, the picture as a data URL.
    assert_eq!(
        openai::messages("", &thread),
        [json!({"role": "user", "content": [
            {"type": "text", "text": "What is this?"},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,QUJD"}}
        ]})]
    );
    // The ChatGPT plan's Responses API: input_text and input_image.
    assert_eq!(
        responses::input(&thread),
        [json!({"role": "user", "content": [
            {"type": "input_text", "text": "What is this?"},
            {"type": "input_image", "image_url": "data:image/png;base64,QUJD"}
        ]})]
    );
}

#[test]
fn a_picture_with_no_words_and_a_picture_that_could_not_be_read_again() {
    let only = [Message::UserImages {
        text: String::new(),
        images: vec![image("QUJD")],
    }];
    // Anthropic takes no empty text block.
    assert_eq!(
        anthropic::messages(&only)[0]["content"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    // A picture whose bytes are gone is a sentence, not an image the provider would turn the request down for.
    let lost = [Message::UserImages {
        text: "Look".to_owned(),
        images: vec![image("")],
    }];
    for sent in [
        anthropic::messages(&lost)[0]["content"].to_string(),
        openai::messages("", &lost)[0]["content"].to_string(),
        responses::input(&lost)[0]["content"].to_string(),
    ] {
        assert!(
            sent.contains("The picture “shot.png” could not be read again"),
            "{sent}"
        );
        assert!(
            !sent.contains("image_url")
                && !sent.contains("input_image")
                && !sent.contains("\"image\""),
            "{sent}"
        );
    }
}

#[test]
fn the_requests_json_takes_attachments_and_a_request_without_them_still_reads() {
    let with: ChatRequest = serde_json::from_value(json!({
        "chat": "c1", "provider": "p", "text": "t",
        "attachments": [{"id": "x", "name": "n.png", "kind": "image"}, {"id": "y", "name": "n.txt", "kind": "text"}],
        "settings": {"allowImages": true}
    }))
    .unwrap();
    assert_eq!(with.attachments.len(), 2);
    assert_eq!(with.attachments[0].kind, AttachKind::Image);
    assert_eq!(with.settings.unwrap().allow_images, Some(true));
    let without: ChatRequest =
        serde_json::from_value(json!({"chat": "c1", "provider": "p", "text": "t"})).unwrap();
    assert!(without.attachments.is_empty());
    assert!(context::fence("a </attachment> b <attachment name=x>").contains("&lt;/attachment>"));
}
