//! Comments through the agent tools: an assistant's are marked and dated, it can read
//! every comment of the deck, and it cannot write as a person.

use serde_json::json;

use super::{Kit, OUTLINE};

#[test]
fn an_assistant_comments_reads_and_settles_and_what_it_writes_is_marked() {
    let mut kit = Kit::new();
    let name = kit.make(OUTLINE);
    let made = kit.ok(
        "add_deck_comment",
        json!({ "deck": name, "slide": 2, "text": "Cite the source", "agent": false, "author": "Claude" }),
    );
    let id = made["result"]["comment"].as_str().unwrap().to_owned();

    let comment = &kit.deck(&name).slides[1].comments[0];
    assert!(comment.agent, "an assistant cannot write as a person");
    assert_eq!(comment.author, "Claude");
    assert!(
        comment.created.ends_with('Z') && comment.created.len() == 20,
        "{}",
        comment.created
    );

    let listed = kit.ok("list_deck_comments", json!({ "deck": name }));
    assert_eq!(
        (listed["open"].as_u64(), listed["resolved"].as_u64()),
        (Some(1), Some(0))
    );
    assert_eq!(listed["comments"][0]["slideNumber"], 2);
    assert_eq!(listed["comments"][0]["agent"], true);

    kit.ok(
        "reply_deck_comment",
        json!({ "deck": name, "comment": id, "text": "Done" }),
    );
    kit.ok(
        "resolve_deck_comment",
        json!({ "deck": name, "comment": id }),
    );
    let open = kit.ok(
        "list_deck_comments",
        json!({ "deck": name, "status": "open" }),
    );
    assert_eq!(open["comments"], json!([]));
    assert_eq!(open["resolved"], 1);
    let settled = kit.ok(
        "list_deck_comments",
        json!({ "deck": name, "status": "resolved", "slide": 2 }),
    );
    assert_eq!(settled["comments"][0]["replies"][0]["text"], "Done");
    assert_eq!(settled["comments"][0]["replies"][0]["agent"], true);
}

#[test]
fn comments_can_be_part_of_a_batch_and_are_marked_there_too() {
    let mut kit = Kit::new();
    let name = kit.make(OUTLINE);
    kit.ok(
        "update_elements",
        json!({ "deck": name, "operations": [
            { "op": "add_deck_comment", "input": { "slide": 1, "text": "First", "agent": false } },
            { "op": "set_slide_access", "input": { "slide": 1, "title": "Cover" } },
        ] }),
    );
    let deck = kit.deck(&name);
    assert!(deck.slides[0].comments[0].agent);
    assert_eq!(
        deck.slides[0]
            .access
            .as_ref()
            .and_then(|a| a.title.as_deref()),
        Some("Cover")
    );
}

#[test]
fn the_questions_a_tool_cannot_answer_say_what_to_ask() {
    let mut kit = Kit::new();
    let name = kit.make(OUTLINE);
    let bad = kit.err(
        "list_deck_comments",
        json!({ "deck": name, "status": "done" }),
    );
    assert!(bad.contains("open") && bad.contains("resolved"), "{bad}");
    let none = kit.err(
        "resolve_deck_comment",
        json!({ "deck": name, "comment": "c-nope" }),
    );
    assert!(
        none.contains("c-nope") && none.contains("list_deck_comments"),
        "{none}"
    );
    let empty = kit.err(
        "add_deck_comment",
        json!({ "deck": name, "slide": 1, "text": " " }),
    );
    assert!(empty.contains("words"), "{empty}");
}
