use super::*;
use crate::chat::model::{Image, Reply, Stop, ToolCall};

fn answer(calls: usize) -> Message {
    Message::Assistant(Reply {
        text: String::new(),
        calls: (0..calls)
            .map(|i| ToolCall {
                id: format!("c{i}"),
                name: "read_note".into(),
                arguments: "{}".into(),
            })
            .collect(),
        stop: Stop::Tools,
        blocks: None,
        items: None,
    })
}

fn result(len: usize) -> Message {
    Message::Results(vec![ToolOutput {
        id: "c0".into(),
        content: "r".repeat(len),
        is_error: false,
    }])
}

fn rounds(n: usize) -> Vec<Message> {
    let mut out = vec![Message::User("First question".into())];
    for _ in 0..n {
        out.push(answer(1));
        out.push(result(1_000));
    }
    out
}

#[test]
fn the_estimate_is_about_four_characters_a_token() {
    let thread = vec![Message::User("x".repeat(400))];
    assert_eq!(estimate(&"s".repeat(40), &thread), 110);
    // 14 characters of question, two calls of 31 and two results of 1,020.
    assert_eq!(estimate("", &rounds(2)), (14 + 2 * 31 + 2 * 1_020) / 4);
}

#[test]
fn only_results_older_than_the_last_six_rounds_are_left_out() {
    let mut thread = rounds(10);
    let changed = elide_stale(&mut thread);
    assert_eq!(changed, 4);
    let left: Vec<_> = thread
        .iter()
        .filter_map(|m| match m {
            Message::Results(r) => Some(r[0].content == ELIDED),
            _ => None,
        })
        .collect();
    assert_eq!(
        left,
        [
            true, true, true, true, false, false, false, false, false, false
        ]
    );
    // The calls stay, and a second pass finds nothing more.
    assert_eq!(
        thread
            .iter()
            .filter(|m| matches!(m, Message::Assistant(_)))
            .count(),
        10
    );
    assert_eq!(elide_stale(&mut thread), 0);
    let mut few = rounds(6);
    assert_eq!(elide_stale(&mut few), 0, "six rounds are all kept");
}

#[test]
fn only_the_two_newest_pictures_stay_and_the_rest_say_they_were_left_out() {
    let picture = |i: usize| Message::UserImages {
        text: format!("Look at {i}"),
        images: vec![Image {
            id: format!("p{i}"),
            name: format!("shot{i}.png"),
            mime: "image/png".into(),
            data: "AAAA".into(),
        }],
    };
    let mut thread: Vec<Message> = (0..4).map(picture).collect();
    assert_eq!(elide_stale(&mut thread), 2);
    assert_eq!(thread[2], picture(2));
    assert_eq!(thread[3], picture(3));
    let Message::User(text) = &thread[0] else {
        panic!("{:?}", thread[0]);
    };
    assert!(
        text.starts_with("Look at 0\n[picture “shot0.png” left out to save room"),
        "{text}"
    );
    assert_eq!(elide_stale(&mut thread), 0, "a second pass changes nothing");
}

#[test]
fn a_short_result_is_not_worth_a_marker() {
    let mut thread = vec![Message::User("Q".into())];
    for _ in 0..8 {
        thread.push(answer(1));
        thread.push(result(40));
    }
    assert_eq!(elide_stale(&mut thread), 0);
}

#[test]
fn the_summary_takes_the_older_rounds_place_and_keeps_the_latest_request() {
    let mut thread = rounds(3);
    thread.push(Message::User("Now do the second thing".into()));
    for _ in 0..8 {
        thread.push(answer(1));
        thread.push(result(10));
    }
    let cut = tail_start(&thread).unwrap();
    let summary = summary_message("Did the first thing.", &[], "", &[]);
    replace_older(&mut thread, cut, summary);
    assert_eq!(thread[0], Message::User("First question".into()));
    assert!(is_summary(&thread[1]));
    assert_eq!(thread[2], Message::User("Now do the second thing".into()));
    assert!(matches!(thread[3], Message::Assistant(_)));
    assert_eq!(thread.len(), 3 + 2 * KEEP_ROUNDS);
}

#[test]
fn the_harness_own_words_are_never_taken_for_the_persons_request() {
    use crate::chat::budget::NUDGE;
    let mut thread = rounds(3);
    thread.push(Message::User("The real question".into()));
    for _ in 0..8 {
        thread.push(answer(1));
        thread.push(result(10));
    }
    thread.push(Message::User(NUDGE.to_owned()));
    thread.push(Message::User(turn::CONTINUE.to_owned()));
    assert!(asked_by_person(&thread[7]));
    assert!(!asked_by_person(&thread[thread.len() - 1]));
    assert!(!asked_by_person(&summary_message("S", &[], "", &[])));
    let cut = tail_start(&thread).unwrap();
    replace_older(&mut thread, cut, summary_message("S", &[], "", &[]));
    assert_eq!(thread[2], Message::User("The real question".into()));
}

#[test]
fn blocks_of_context_and_attachments_are_named_not_repeated() {
    let text = "<context>\nx\n<attachment name=\"notes.txt\">\nlong\n</attachment>\n</context>\n\nPlease summarise";
    let out = without_blocks(text);
    assert!(out.contains("it included attachments “notes.txt”"), "{out}");
    assert!(out.ends_with("Please summarise") && !out.contains("long"));
    assert_eq!(without_blocks("plain"), "plain");
    let thread = [
        Message::User(text.into()),
        Message::User("Another <attachment name=\"b.md\">x</attachment> and a repeat <attachment name=\"notes.txt\">y</attachment>".into()),
    ];
    assert_eq!(attachments_in(&thread), ["“notes.txt”", "“b.md”"]);
}

#[test]
fn a_long_record_keeps_its_newest_end_and_says_so() {
    let mut thread = vec![Message::User("First".into())];
    for i in 0..40 {
        thread.push(Message::User(format!("{i}: {}", "w".repeat(900))));
    }
    let record = transcript(&thread, 41, 1_000);
    assert!(record.starts_with("(Earlier steps than these were left out"));
    assert!(record.contains("39: "), "the newest are kept");
    assert!(!record.contains("[Person] 0: "));
}
