//! The parsers on recorded lines.

use serde_json::{Value, json};

use super::{CLAUDE_ANSWER, CLAUDE_ASK, CLAUDE_SIGNIN, OPENCODE_REFUSED, OPENCODE_RUN, lines};
use crate::chat::cli::claude::{ClaudeParser, allow_line, deny_line, initialize_line, user_line};
use crate::chat::cli::items::{Item, Problem, classify};
use crate::chat::cli::opencode::OpenCodeParser;

fn claude(text: &str) -> Vec<Item> {
    let mut parser = ClaudeParser::default();
    lines(text).iter().flat_map(|l| parser.feed(l)).collect()
}

fn opencode(text: &str) -> Vec<Item> {
    let mut parser = OpenCodeParser::default();
    lines(text).iter().flat_map(|l| parser.feed(l)).collect()
}

#[test]
fn a_claude_answer_is_text_a_tool_call_its_result_and_the_end() {
    let items = claude(CLAUDE_ANSWER);
    let texts: Vec<&str> = items
        .iter()
        .filter_map(|i| {
            if let Item::Text(t) = i {
                Some(t.as_str())
            } else {
                None
            }
        })
        .collect();
    // Text came in pieces; the whole messages repeat it and are not told again.
    assert_eq!(
        texts,
        ["I will read ", "the note.", "It lists three hotels."]
    );
    assert_eq!(
        items[0],
        Item::Session("3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f".to_owned())
    );
    let tool = items
        .iter()
        .find(|i| matches!(i, Item::Tool { .. }))
        .unwrap();
    assert_eq!(
        tool,
        &Item::Tool {
            id: "toolu_01".to_owned(),
            name: "mcp__kasten__read_note".to_owned(),
            input: json!({ "path": "inbox/hotel-ideas.md" }),
        }
    );
    let done = items
        .iter()
        .find_map(|i| {
            if let Item::ToolDone { id, ok, text } = i {
                Some((id, ok, text))
            } else {
                None
            }
        })
        .unwrap();
    assert_eq!(done.0, "toolu_01");
    assert!(*done.1);
    let body: Value = serde_json::from_str(done.2).unwrap();
    assert_eq!(body["title"], "Hotel ideas");
    match items.last().unwrap() {
        Item::Finished(f) => assert!(f.ok && f.text == "It lists three hotels."),
        other => panic!("{other:?}"),
    }
    assert!(
        !items.iter().any(|i| matches!(i, Item::Notice { .. })),
        "the tools connected"
    );
}

#[test]
fn whole_messages_are_told_when_no_pieces_came() {
    let line = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Whole."}]}}"#;
    let mut parser = ClaudeParser::default();
    assert_eq!(parser.feed(line), vec![Item::Text("Whole.".to_owned())]);
}

#[test]
fn a_question_from_claude_code_is_an_ask_and_the_answers_have_the_wire_shape() {
    let items = claude(CLAUDE_ASK);
    let ask = items
        .iter()
        .find_map(|i| if let Item::Ask(a) = i { Some(a) } else { None })
        .unwrap();
    assert_eq!(ask.request_id, "req_7_1a2b3c4d");
    assert_eq!(ask.tool, "Bash");
    assert_eq!(ask.input["command"], "npm test");
    // The denied call comes back as a failed tool result.
    assert!(
        items
            .iter()
            .any(|i| matches!(i, Item::ToolDone { ok: false, .. }))
    );

    let yes: Value =
        serde_json::from_str(&allow_line("req_7", &json!({ "command": "ls" }))).unwrap();
    assert_eq!(yes["type"], "control_response");
    assert_eq!(yes["response"]["subtype"], "success");
    assert_eq!(yes["response"]["request_id"], "req_7");
    assert_eq!(yes["response"]["response"]["behavior"], "allow");
    assert_eq!(yes["response"]["response"]["updatedInput"]["command"], "ls");
    let no: Value = serde_json::from_str(&deny_line("req_8", "No thanks")).unwrap();
    assert_eq!(no["response"]["response"]["behavior"], "deny");
    assert_eq!(no["response"]["response"]["message"], "No thanks");
}

#[test]
fn what_is_sent_to_claude_code_is_one_line_of_json_each() {
    for line in [user_line("Hello\nthere"), initialize_line()] {
        assert!(!line.contains('\n'), "{line}");
        let value: Value = serde_json::from_str(&line).unwrap();
        assert!(value["type"] == "user" || value["type"] == "control_request");
    }
    let user: Value = serde_json::from_str(&user_line("Hello\nthere")).unwrap();
    assert_eq!(user["message"]["content"][0]["text"], "Hello\nthere");
}

#[test]
fn a_cli_that_is_not_signed_in_ends_with_its_own_words_and_a_kind() {
    let items = claude(CLAUDE_SIGNIN);
    // The failed message's text is not shown as the answer; the end says it once.
    assert!(!items.iter().any(|i| matches!(i, Item::Text(_))));
    // The tools did not connect: said.
    assert!(
        items
            .iter()
            .any(|i| matches!(i, Item::Notice { code: Some(c), .. } if c == "mcp"))
    );
    match items.last().unwrap() {
        Item::Finished(f) => {
            assert!(!f.ok);
            assert_eq!(f.text, "Invalid API key · Please run /login");
            assert_eq!(f.problem, Problem::SignIn);
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn retries_and_withdrawn_questions_and_noise() {
    let mut parser = ClaudeParser::default();
    let retry = parser.feed(r#"{"type":"system","subtype":"api_retry","attempt":2,"max_retries":5,"error":"rate_limit"}"#);
    assert!(
        matches!(&retry[..], [Item::Notice { text, code: Some(c) }] if c == "retry" && text.contains("2 of 5"))
    );
    assert_eq!(
        parser.feed(r#"{"type":"control_cancel_request","request_id":"req_1"}"#),
        vec![Item::AskWithdrawn("req_1".to_owned())]
    );
    for noise in [
        "",
        "not json",
        r#"{"type":"rate_limit_event"}"#,
        r#"{"type":"assistant""#,
        r#"{"type":"control_response","response":{}}"#,
    ] {
        assert!(parser.feed(noise).is_empty(), "{noise}");
    }
}

#[test]
fn an_opencode_run_is_a_session_a_tool_text_and_nothing_else() {
    let items = opencode(OPENCODE_RUN);
    assert_eq!(items[0], Item::Session("ses_abc123def456".to_owned()));
    assert_eq!(
        items
            .iter()
            .filter(|i| matches!(i, Item::Session(_)))
            .count(),
        1
    );
    assert!(
        matches!(&items[1], Item::Tool { id, name, .. } if id == "call_1" && name == "kasten_read_note")
    );
    assert!(matches!(&items[2], Item::ToolDone { id, ok: true, .. } if id == "call_1"));
    assert_eq!(items[3], Item::Text("It lists three hotels.".to_owned()));
    assert_eq!(items.len(), 4);
}

#[test]
fn opencode_refusals_are_failed_tools_and_errors_carry_their_kind() {
    let items = opencode(OPENCODE_REFUSED);
    assert!(items.iter().any(|i| matches!(i, Item::ToolDone { ok: false, text, .. } if text.contains("rejected permission"))));
    match items.last().unwrap() {
        Item::Finished(f) => {
            assert!(!f.ok);
            assert_eq!(f.text, "Rate limit reached. Try again later.");
            assert_eq!(f.problem, Problem::Limit);
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn a_text_in_two_pieces_is_two_paragraphs() {
    let mut parser = OpenCodeParser::default();
    let a = parser.feed(r#"{"type":"text","sessionID":"s","part":{"text":"One"}}"#);
    let b = parser.feed(r#"{"type":"text","sessionID":"s","part":{"text":"Two"}}"#);
    assert_eq!(a[1], Item::Text("One".to_owned()));
    assert_eq!(b[0], Item::Text("\n\nTwo".to_owned()));
}

#[test]
fn failures_are_told_from_the_clis_own_words() {
    assert_eq!(
        classify(None, "Invalid API key · Please run /login"),
        Problem::SignIn
    );
    assert_eq!(
        classify(Some("authentication_failed"), "x"),
        Problem::SignIn
    );
    assert_eq!(
        classify(None, "5-hour limit reached ∙ resets 3pm"),
        Problem::Limit
    );
    assert_eq!(classify(Some("rate_limit"), ""), Problem::Limit);
    assert_eq!(classify(None, "The disk is full"), Problem::Other);
}
