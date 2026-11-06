//! A whole turn on a scripted program: the events it makes, questions that wait
//! for the person, Stop, a program that goes quiet, crashes or is not signed in.

use std::collections::VecDeque;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde_json::{Value, json};

use super::{
    CLAUDE_ANSWER, CLAUDE_ASK, CLAUDE_SIGNIN, OPENCODE_REFUSED, OPENCODE_RUN, Seen, lines,
};
use crate::chat::cli::Agent;
use crate::chat::cli::approvals::Approvals;
use crate::chat::cli::drive::{Describe, Drive, Limits, Outcome, drive};
use crate::chat::cli::process::{Recv, Transport};
use crate::chat::errors::FailKind;
use crate::chat::event::{ApprovalState, ChatEvent, EventKind};
use crate::chat::summary::Described;
use crate::chat::turn::Ending;

pub(super) enum Step {
    Say(Recv),
    Do(Box<dyn FnOnce() + Send>),
}

/// A program that does what its script says.
pub(super) struct Script {
    pub(super) steps: VecDeque<Step>,
    pub(super) sent: Vec<String>,
    input_closed: bool,
    killed: bool,
}

impl Script {
    pub(super) fn of(lines: &[String], end: Recv) -> Script {
        let mut steps: VecDeque<Step> = lines
            .iter()
            .map(|l| Step::Say(Recv::Out(l.clone())))
            .collect();
        steps.push_back(Step::Say(end));
        Script {
            steps,
            sent: Vec::new(),
            input_closed: false,
            killed: false,
        }
    }
}

impl Transport for Script {
    fn send_line(&mut self, line: &str) -> Result<(), String> {
        self.sent.push(line.to_owned());
        Ok(())
    }
    fn close_input(&mut self) {
        self.input_closed = true;
    }
    fn recv(&mut self, wait: Duration) -> Recv {
        if self.killed {
            return Recv::Ended(None);
        }
        while let Some(step) = self.steps.pop_front() {
            match step {
                Step::Do(act) => act(),
                Step::Say(recv) => return recv,
            }
        }
        std::thread::sleep(wait.min(Duration::from_millis(5)));
        Recv::Quiet
    }
    fn kill(&mut self) {
        self.killed = true;
    }
}

pub(super) fn quick() -> Limits {
    Limits {
        quiet: Duration::from_secs(60),
        total: Duration::from_secs(60),
        ask: Duration::from_secs(60),
        grace: Duration::from_secs(60),
        poll: Duration::from_millis(1),
    }
}

fn stub(name: &str, input: &Value, result: &Result<Value, String>) -> Option<Described> {
    Some(Described {
        ok: result.is_ok(),
        summary: format!("Did {name}"),
        paths: input["path"]
            .as_str()
            .map(|p| vec![p.to_owned()])
            .unwrap_or_default(),
        staged: false,
    })
}

pub(super) struct Run {
    pub(super) seen: Arc<Seen>,
    pub(super) approvals: Approvals,
    cancel: Arc<AtomicBool>,
}

impl Run {
    pub(super) fn new() -> Run {
        Run {
            seen: Arc::new(Seen::default()),
            approvals: Approvals::default(),
            cancel: Arc::new(AtomicBool::new(false)),
        }
    }

    pub(super) fn go(&self, agent: Agent, script: &mut Script, limits: Limits) -> Outcome {
        let describe: Describe<'_> = &stub;
        drive(
            script,
            &["the message".to_owned()],
            &Drive {
                agent,
                events: self.seen.as_ref(),
                chat: "chat-1",
                turn: "turn-1",
                cancel: &self.cancel,
                approvals: &self.approvals,
                limits,
                describe,
            },
        )
    }
}

fn kinds(events: &[ChatEvent]) -> Vec<EventKind> {
    events.iter().map(|e| e.kind).collect()
}

#[test]
fn an_answer_streams_as_text_and_folded_tool_steps() {
    let run = Run::new();
    let mut script = Script::of(&lines(CLAUDE_ANSWER), Recv::Ended(Some(0)));
    let outcome = run.go(Agent::ClaudeCode, &mut script, quick());
    assert_eq!(outcome.ending, Ending::Done { stopped: false });
    assert_eq!(outcome.text, "I will read the note.It lists three hotels.");
    assert_eq!(
        outcome.session.as_deref(),
        Some("3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f")
    );
    let events = run.seen.all();
    assert_eq!(
        kinds(&events),
        [
            EventKind::Text,
            EventKind::Text,
            EventKind::Tool,
            EventKind::ToolResult,
            EventKind::Text
        ]
    );
    // KastenFlow's tool is told by the chat's own words, without the MCP prefix.
    let tool = events[2].tool.as_ref().unwrap();
    assert_eq!(tool.name, "read_note");
    assert_eq!(tool.id, "toolu_01");
    let result = events[3].result.as_ref().unwrap();
    assert_eq!(
        (result.id.as_str(), result.ok, result.summary.as_str()),
        ("toolu_01", true, "Did read_note")
    );
    assert_eq!(result.paths, ["inbox/hotel-ideas.md"]);
    // The message went in first, then Claude Code was told nothing more is coming.
    assert_eq!(script.sent, ["the message"]);
    assert!(script.input_closed);
    assert!(
        events
            .iter()
            .all(|e| e.chat == "chat-1" && e.turn == "turn-1")
    );
}

#[test]
fn opencode_gets_its_message_and_then_the_end_of_its_input() {
    let run = Run::new();
    let mut script = Script::of(&lines(OPENCODE_RUN), Recv::Ended(Some(0)));
    let outcome = run.go(Agent::OpenCode, &mut script, quick());
    assert_eq!(outcome.ending, Ending::Done { stopped: false });
    assert_eq!(outcome.text, "It lists three hotels.");
    assert_eq!(outcome.session.as_deref(), Some("ses_abc123def456"));
    assert!(
        script.input_closed,
        "opencode run reads its message to the end of its input"
    );
    let events = run.seen.all();
    assert_eq!(events[0].tool.as_ref().unwrap().name, "read_note");
}

#[test]
fn a_question_waits_for_the_person_and_the_answer_goes_back_to_the_cli() {
    let run = Run::new();
    let mut script = Script::of(&lines(CLAUDE_ASK), Recv::Ended(Some(0)));
    // The person answers once the card is up: after the question line, before the next one.
    let approvals = run.approvals.clone();
    let at = script
        .steps
        .iter()
        .position(|s| matches!(s, Step::Say(Recv::Out(l)) if l.contains("control_request")))
        .unwrap();
    script.steps.insert(
        at + 1,
        Step::Do(Box::new(move || {
            assert!(
                approvals.answer("chat-1", "req_7_1a2b3c4d", true, None),
                "the question is open"
            );
        })),
    );
    let outcome = run.go(Agent::ClaudeCode, &mut script, quick());
    assert_eq!(outcome.ending, Ending::Done { stopped: false });
    let cards: Vec<_> = run
        .seen
        .all()
        .into_iter()
        .filter_map(|e| e.approval)
        .collect();
    assert_eq!(
        cards.iter().map(|c| c.state).collect::<Vec<_>>(),
        [ApprovalState::Asking, ApprovalState::Allowed]
    );
    assert_eq!(cards[0].id, "req_7_1a2b3c4d");
    assert_eq!(cards[0].question, "Allow Claude Code to run a command?");
    assert_eq!(cards[0].detail, "npm test");
    assert_eq!(cards[0].agent, "Claude Code");
    let reply: Value = serde_json::from_str(&script.sent[1]).unwrap();
    assert_eq!(reply["response"]["request_id"], "req_7_1a2b3c4d");
    assert_eq!(reply["response"]["response"]["behavior"], "allow");
    assert_eq!(
        reply["response"]["response"]["updatedInput"]["command"],
        "npm test"
    );
    assert_eq!(run.approvals.waiting("chat-1"), 0);
}

#[test]
fn no_is_passed_on_with_words_for_the_model() {
    let run = Run::new();
    let mut script = Script::of(&lines(CLAUDE_ASK), Recv::Ended(Some(0)));
    let approvals = run.approvals.clone();
    let at = script
        .steps
        .iter()
        .position(|s| matches!(s, Step::Say(Recv::Out(l)) if l.contains("control_request")))
        .unwrap();
    script.steps.insert(
        at + 1,
        Step::Do(Box::new(move || {
            approvals.answer(
                "chat-1",
                "req_7_1a2b3c4d",
                false,
                Some("Not now".to_owned()),
            );
        })),
    );
    run.go(Agent::ClaudeCode, &mut script, quick());
    let reply: Value = serde_json::from_str(&script.sent[1]).unwrap();
    assert_eq!(reply["response"]["response"]["behavior"], "deny");
    assert_eq!(reply["response"]["response"]["message"], "Not now");
    let states: Vec<_> = run
        .seen
        .all()
        .into_iter()
        .filter_map(|e| e.approval)
        .map(|c| c.state)
        .collect();
    assert_eq!(states, [ApprovalState::Asking, ApprovalState::Denied]);
}

#[test]
fn an_answer_for_a_question_that_is_not_open_changes_nothing() {
    let approvals = Approvals::default();
    assert!(!approvals.answer("chat-1", "req_nobody", true, None));
    approvals.open("chat-1", "req_1");
    assert!(
        !approvals.answer("chat-2", "req_1", true, None),
        "another chat's card"
    );
    assert!(approvals.answer("chat-1", "req_1", false, None));
    assert!(
        !approvals.answer("chat-1", "req_1", true, None),
        "answered once"
    );
    assert_eq!(
        approvals.take("chat-1", "req_1").map(|a| a.allow),
        Some(false)
    );
    assert!(approvals.take("chat-1", "req_1").is_none());
}

#[test]
fn a_question_nobody_answers_in_time_is_refused() {
    let run = Run::new();
    // After the question the program says nothing: only the person could move it on.
    let mut script = Script::of(&lines(CLAUDE_ASK)[..3], Recv::Quiet);
    script.steps.pop_back();
    let limits = Limits {
        ask: Duration::from_millis(30),
        ..quick()
    };
    let go = std::thread::scope(|scope| {
        let handle = scope.spawn(|| run.go(Agent::ClaudeCode, &mut script, limits));
        let began = std::time::Instant::now();
        while run
            .seen
            .all()
            .iter()
            .filter(|e| e.approval.is_some())
            .count()
            < 2
            && began.elapsed() < Duration::from_secs(5)
        {
            std::thread::sleep(Duration::from_millis(5));
        }
        run.cancel.store(true, Ordering::SeqCst);
        handle.join().unwrap()
    });
    let sent: Vec<Value> = script
        .sent
        .iter()
        .skip(1)
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(sent[0]["response"]["response"]["behavior"], "deny");
    assert!(
        sent[0]["response"]["response"]["message"]
            .as_str()
            .unwrap()
            .contains("in time")
    );
    assert_eq!(go.ending, Ending::Done { stopped: true });
}

#[test]
fn stop_ends_the_program_and_the_turn_says_stopped() {
    let run = Run::new();
    run.cancel.store(true, Ordering::SeqCst);
    let mut script = Script::of(&lines(CLAUDE_ANSWER), Recv::Ended(Some(0)));
    let outcome = run.go(Agent::ClaudeCode, &mut script, quick());
    assert!(script.killed, "the whole process tree is ended");
    assert_eq!(outcome.ending, Ending::Done { stopped: true });
}

#[test]
fn a_program_that_goes_quiet_is_ended_with_a_message() {
    let run = Run::new();
    let mut script = Script::of(&[], Recv::Quiet);
    script.steps.clear();
    let limits = Limits {
        quiet: Duration::from_millis(20),
        ..quick()
    };
    let outcome = run.go(Agent::OpenCode, &mut script, limits);
    assert!(script.killed);
    match outcome.ending {
        Ending::Error { message, kind } => {
            assert!(message.contains("OpenCode did not answer"), "{message}");
            assert_eq!(kind, FailKind::Connection);
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn a_program_that_never_ends_after_its_last_word_is_ended_without_a_fault() {
    let run = Run::new();
    let mut script = Script::of(&lines(CLAUDE_ANSWER), Recv::Quiet);
    script.steps.pop_back();
    let limits = Limits {
        grace: Duration::from_millis(10),
        ..quick()
    };
    let outcome = run.go(Agent::ClaudeCode, &mut script, limits);
    assert!(script.killed);
    assert_eq!(outcome.ending, Ending::Done { stopped: false });
}

#[test]
fn a_cli_that_is_not_signed_in_says_so_in_its_words_and_what_to_do() {
    let run = Run::new();
    let mut script = Script::of(&lines(CLAUDE_SIGNIN), Recv::Ended(Some(1)));
    let outcome = run.go(Agent::ClaudeCode, &mut script, quick());
    match outcome.ending {
        Ending::Error { message, kind } => {
            assert!(
                message.starts_with("Invalid API key · Please run /login"),
                "{message}"
            );
            assert!(
                message.contains("run claude and follow the browser prompts"),
                "{message}"
            );
            assert_eq!(kind, FailKind::Permission);
        }
        other => panic!("{other:?}"),
    }
    let notes: Vec<_> = run
        .seen
        .all()
        .into_iter()
        .filter(|e| e.kind == EventKind::Notice)
        .collect();
    assert!(
        notes.iter().any(|n| n.code.as_deref() == Some("mcp")),
        "the unconnected tools are said"
    );
}

#[test]
fn a_rate_limited_opencode_run_keeps_what_it_did_and_ends_with_the_limit() {
    let run = Run::new();
    let mut script = Script::of(&lines(OPENCODE_REFUSED), Recv::Ended(Some(1)));
    let outcome = run.go(Agent::OpenCode, &mut script, quick());
    assert_eq!(outcome.text, "I was not allowed to run that.");
    match outcome.ending {
        Ending::Error { message, kind } => {
            assert_eq!(message, "Rate limit reached. Try again later.");
            assert_eq!(kind, FailKind::RateLimited);
        }
        other => panic!("{other:?}"),
    }
    // The refused call is a failed step with the CLI's own reason.
    let events = run.seen.all();
    let result = events.iter().find_map(|e| e.result.as_ref()).unwrap();
    assert!(!result.ok);
    assert!(
        result.summary.starts_with("Ran rm notes.md"),
        "{}",
        result.summary
    );
    assert!(
        result.summary.contains("rejected permission"),
        "{}",
        result.summary
    );
}

#[test]
fn a_crash_tells_the_exit_code_and_what_it_printed() {
    let run = Run::new();
    let mut script = Script::of(&[], Recv::Ended(Some(3)));
    script.steps.push_front(Step::Say(Recv::Err(
        "thread 'main' panicked at src/main.rs".to_owned(),
    )));
    let outcome = run.go(Agent::ClaudeCode, &mut script, quick());
    match outcome.ending {
        Ending::Error { message, kind } => {
            assert!(message.contains("exit code 3"), "{message}");
            assert!(message.contains("panicked at src/main.rs"), "{message}");
            assert_eq!(kind, FailKind::Other);
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn a_crash_that_says_to_sign_in_is_a_sign_in_problem() {
    let run = Run::new();
    let mut script = Script::of(&[], Recv::Ended(Some(1)));
    script.steps.push_front(Step::Say(Recv::Err(
        "Error: not authenticated, run opencode auth login".to_owned(),
    )));
    let outcome = run.go(Agent::OpenCode, &mut script, quick());
    match outcome.ending {
        Ending::Error { message, kind } => {
            assert_eq!(kind, FailKind::Permission);
            assert!(message.contains("opencode auth login"), "{message}");
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn the_events_of_a_turn_have_the_shape_the_window_reads() {
    let run = Run::new();
    let mut script = Script::of(&lines(CLAUDE_ASK), Recv::Ended(Some(0)));
    run.go(Agent::ClaudeCode, &mut script, quick());
    let card = run
        .seen
        .all()
        .into_iter()
        .find(|e| e.kind == EventKind::Approval)
        .unwrap();
    let wire = serde_json::to_value(&card).unwrap();
    assert_eq!(wire["kind"], "approval");
    assert_eq!(wire["approval"]["state"], "asking");
    assert_eq!(wire["approval"]["tool"], "Bash");
    assert_eq!(wire["approval"]["id"], "req_7_1a2b3c4d");
    assert_eq!(wire["chat"], json!("chat-1"));
}
