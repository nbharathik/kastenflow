//! Running a generator through the mailbox: the code and what it may read
//! travel beside the request, the limits are checked before anything is
//! written, and with the app closed or silent nothing is left behind.

use crate::bridge::{files_in, mailbox};
use crate::common::dev_vault;

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use kasten_core::bridge::{
    Answer, Call, DEFAULT_RUN_MS, GeneratorInputText, GeneratorOutput, GeneratorPayload, Handler,
    MAX_CODE_BYTES, MAX_INPUT_BYTES, MAX_RUN_MS, Request, serve,
};
use serde_json::json;

fn run(deck: Option<&str>) -> Call {
    Call::RunGenerator {
        deck: deck.map(str::to_owned),
        output: GeneratorOutput::Svg,
        timeout_ms: DEFAULT_RUN_MS,
    }
}

fn payload(code: &str) -> GeneratorPayload {
    GeneratorPayload {
        language: "js".to_owned(),
        code: code.to_owned(),
        inputs: vec![GeneratorInputText {
            name: "sales".to_owned(),
            text: "month,total\nJan,3\nFeb,5\n".to_owned(),
        }],
        theme: BTreeMap::from([("accent1".to_owned(), "#2563eb".to_owned())]),
    }
}

#[test]
fn the_code_travels_beside_the_request_and_is_read_once() {
    let t = dev_vault();
    let reading = mailbox(&t);
    let handler: Handler = Arc::new(move |request: Request, call: kasten_core::bridge::Call| {
        let bytes = reading.take_payload(&request.id).unwrap_or_default();
        let again = reading.take_payload(&request.id);
        let got: GeneratorPayload = serde_json::from_slice(&bytes).unwrap();
        Ok(json!({
            "kind": call.kind(),
            "deck": call.doc(),
            "code": got.code,
            "input": got.inputs[0].name,
            "again": again.is_some(),
        }))
    });
    let _server = serve(mailbox(&t), "1.2.4", handler).unwrap();
    let bytes = serde_json::to_vec(&payload("return kit.svg(100, 50)")).unwrap();
    let answer = mailbox(&t)
        .ask_with(
            &run(Some("library/talk.deck")),
            None,
            Duration::from_secs(5),
            Some(&bytes),
        )
        .unwrap();
    let Answer::Reply(reply) = answer else {
        panic!("expected a reply, got {answer:?}");
    };
    assert!(reply.ok, "{reply:?}");
    assert_eq!(reply.result["kind"], "run_generator");
    assert_eq!(reply.result["deck"], "library/talk.deck");
    assert_eq!(reply.result["code"], "return kit.svg(100, 50)");
    assert_eq!(reply.result["input"], "sales");
    assert_eq!(reply.result["again"], false);
    assert!(files_in(&t, "payloads").is_empty());
    assert!(files_in(&t, "requests").is_empty());
}

#[test]
fn with_the_app_closed_nothing_runs_and_nothing_is_left() {
    let t = dev_vault();
    let bytes = serde_json::to_vec(&payload("return '<svg/>'")).unwrap();
    let answer = mailbox(&t)
        .ask_with(&run(None), None, Duration::from_secs(1), Some(&bytes))
        .unwrap();
    assert_eq!(answer, Answer::AppClosed);
    assert!(files_in(&t, "payloads").is_empty());
    assert!(files_in(&t, "requests").is_empty());
}

#[test]
fn a_window_that_stays_silent_times_out_and_the_code_is_taken_back() {
    let t = dev_vault();
    let handler: Handler = Arc::new(|_: Request, _: Call| {
        std::thread::sleep(Duration::from_millis(1_500));
        Ok(json!({}))
    });
    let _server = serve(mailbox(&t), "1.2.4", handler).unwrap();
    let answer = mailbox(&t)
        .ask_with(
            &run(None),
            None,
            Duration::from_millis(300),
            Some(b"{\"language\":\"js\",\"code\":\"x\"}"),
        )
        .unwrap();
    assert_eq!(answer, Answer::TimedOut);
    assert!(files_in(&t, "payloads").is_empty(), "the code is withdrawn");
}

#[test]
fn the_request_has_its_params_its_kind_and_its_limits() {
    let call = run(Some("library/talk.deck"));
    let params = call.params();
    assert!(params.is_object(), "{params}");
    assert!(Call::KINDS.contains(&call.kind()));
    assert_eq!(Call::parse(call.kind(), &params).unwrap(), call);
    assert!(call.check().is_ok());
    assert_eq!(call.doc(), "library/talk.deck");
    assert_eq!(run(None).doc(), "");
    // Left out, the output is SVG and the time is the default.
    let bare = Call::parse("run_generator", &json!({})).unwrap();
    assert_eq!(bare, run(None));
    let png = Call::parse(
        "run_generator",
        &json!({ "output": "png", "timeout_ms": 5000 }),
    )
    .unwrap();
    assert_eq!(
        png,
        Call::RunGenerator {
            deck: None,
            output: GeneratorOutput::Png,
            timeout_ms: 5_000
        }
    );
    // The deck is a place in the vault, and the time is bounded.
    for bad in [
        "../outside.deck",
        "/etc/passwd",
        "C:\\deck.deck",
        ".kasten/x",
    ] {
        assert!(run(Some(bad)).check().is_err(), "{bad}");
    }
    for ms in [0, 999, MAX_RUN_MS + 1] {
        let call = Call::RunGenerator {
            deck: None,
            output: GeneratorOutput::Svg,
            timeout_ms: ms,
        };
        assert!(call.check().is_err(), "{ms}");
    }
    assert!(Call::parse("run_generator", &json!({ "output": "gif" })).is_err());
}

#[test]
fn the_payload_is_held_to_its_limits_before_anything_is_sent() {
    assert!(payload("return '<svg/>'").check().is_ok());
    let mut other_language = payload("print(1)");
    other_language.language = "python".to_owned();
    assert!(
        other_language
            .check()
            .unwrap_err()
            .to_string()
            .contains("JavaScript")
    );
    assert!(payload("   ").check().is_err());
    assert!(payload(&"x".repeat(MAX_CODE_BYTES + 1)).check().is_err());

    let mut many = payload("return 1");
    many.inputs = (0..17)
        .map(|i| GeneratorInputText {
            name: format!("in{i}"),
            text: String::new(),
        })
        .collect();
    assert!(many.check().is_err());

    for name in ["", "1st", "has space", "a-b", "über", &"n".repeat(41)] {
        let mut bad = payload("return 1");
        bad.inputs[0].name = name.to_owned();
        assert!(bad.check().is_err(), "{name:?}");
    }
    let mut twice = payload("return 1");
    twice.inputs.push(twice.inputs[0].clone());
    assert!(twice.check().unwrap_err().to_string().contains("sales"));

    let mut big = payload("return 1");
    big.inputs[0].text = "x".repeat(MAX_INPUT_BYTES + 1);
    assert!(big.check().is_err());
    let mut together = payload("return 1");
    together.inputs = (0..5)
        .map(|i| GeneratorInputText {
            name: format!("in{i}"),
            text: "x".repeat(MAX_INPUT_BYTES),
        })
        .collect();
    assert!(together.check().is_err());

    for (token, colour) in [
        ("accent1", "blue"),
        ("accent1", "#12"),
        ("bad token", "#fff"),
        ("", "#fff"),
        ("a", "url(x)"),
    ] {
        let mut themed = payload("return 1");
        themed.theme = BTreeMap::from([(token.to_owned(), colour.to_owned())]);
        assert!(themed.check().is_err(), "{token} {colour}");
    }
    let mut crowded = payload("return 1");
    crowded.theme = (0..17)
        .map(|i| (format!("c{i}"), "#fff".to_owned()))
        .collect();
    assert!(crowded.check().is_err());
}
