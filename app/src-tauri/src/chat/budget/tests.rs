use super::*;

fn call(args: &str) -> ToolCall {
    ToolCall {
        id: "c".into(),
        name: "search".into(),
        arguments: args.into(),
    }
}

fn out(content: &str, is_error: bool) -> ToolOutput {
    ToolOutput {
        id: "c".into(),
        content: content.into(),
        is_error,
    }
}

#[test]
fn the_defaults_are_roomy_and_the_bounds_are_enforced() {
    let b = ChatBudgets::default();
    assert_eq!((b.rounds, b.calls, b.minutes), (80, 250, 30));
    assert!(b.checked().is_ok());
    for bad in [
        ChatBudgets { rounds: 0, ..b },
        ChatBudgets { rounds: 1001, ..b },
        ChatBudgets { calls: 5001, ..b },
        ChatBudgets { minutes: 241, ..b },
    ] {
        assert!(bad.checked().is_err(), "{bad:?}");
    }
    let clamped = ChatBudgets {
        rounds: 0,
        calls: 99_999,
        minutes: 241,
    }
    .clamped();
    assert_eq!(
        (clamped.rounds, clamped.calls, clamped.minutes),
        (1, 5000, 240)
    );
}

#[test]
fn the_limits_are_kept_in_a_file_and_a_damaged_one_gives_the_defaults() {
    let dir = crate::chat::tests::Scratch::new();
    assert_eq!(ChatBudgets::load(&dir.0), ChatBudgets::default());
    let mine = ChatBudgets {
        rounds: 12,
        calls: 40,
        minutes: 5,
    };
    assert_eq!(mine.save(&dir.0).unwrap(), mine);
    assert_eq!(ChatBudgets::load(&dir.0), mine);
    // Out of range is refused and the file stays as it was.
    let err = ChatBudgets { rounds: 0, ..mine }.save(&dir.0).unwrap_err();
    assert_eq!(err, "Steps must be between 1 and 1000");
    assert_eq!(ChatBudgets::load(&dir.0), mine);
    // A file edited by hand into nonsense: the defaults; into excess: held to the bounds.
    std::fs::write(dir.0.join(FILE), "{ not json").unwrap();
    assert_eq!(ChatBudgets::load(&dir.0), ChatBudgets::default());
    std::fs::write(dir.0.join(FILE), r#"{"rounds": 99999, "minutes": 0}"#).unwrap();
    let held = ChatBudgets::load(&dir.0);
    assert_eq!((held.rounds, held.calls, held.minutes), (1000, 250, 1));
}

#[test]
fn the_meter_pauses_for_the_budget_that_ran_out() {
    let budgets = ChatBudgets {
        rounds: 2,
        calls: 1,
        minutes: 1,
    };
    let mut meter = Meter::new(budgets, Duration::ZERO);
    assert!(meter.round().is_ok() && meter.call().is_ok());
    meter.took_round();
    meter.took_round();
    let rounds = meter.round().unwrap_err();
    assert_eq!(rounds.reason, PauseReason::Rounds);
    assert_eq!(
        rounds.detail,
        "Paused after 2 steps — Continue to let it go on"
    );
    meter.took_call();
    assert_eq!(meter.call().unwrap_err().reason, PauseReason::Calls);
    assert_eq!(meter.calls_left(), 0);
    let late = Meter::new(budgets, Duration::from_secs(61));
    assert_eq!(late.round().unwrap_err().reason, PauseReason::Minutes);
    assert_eq!(late.call().unwrap_err().reason, PauseReason::Minutes);
}

#[test]
fn three_identical_calls_in_a_row_nudge_then_pause() {
    let mut guard = LoopGuard::default();
    for _ in 0..2 {
        guard.saw(&call("{}"), &out("same", false));
    }
    assert_eq!(guard.verdict(), Verdict::Fine);
    guard.saw(&call("{}"), &out("same", false));
    assert_eq!(guard.verdict(), Verdict::Nudge);
    for _ in 0..3 {
        guard.saw(&call("{}"), &out("same", false));
    }
    assert_eq!(guard.verdict(), Verdict::Pause);
}

#[test]
fn the_same_call_with_other_results_or_other_arguments_is_not_a_loop() {
    let mut guard = LoopGuard::default();
    guard.saw(&call("{}"), &out("a", false));
    guard.saw(&call("{}"), &out("b", false));
    guard.saw(&call("{}"), &out("a", false));
    guard.saw(&call("{\"q\":1}"), &out("a", false));
    guard.saw(&call("{}"), &out("a", false));
    assert_eq!(guard.verdict(), Verdict::Fine);
}

#[test]
fn five_failing_calls_in_a_row_are_a_loop_but_a_success_breaks_the_run() {
    let mut guard = LoopGuard::default();
    for i in 0..4 {
        guard.saw(&call(&format!("{{\"n\":{i}}}")), &out("no", true));
    }
    assert_eq!(guard.verdict(), Verdict::Fine);
    guard.saw(&call("{\"n\":9}"), &out("yes", false));
    guard.saw(&call("{\"n\":10}"), &out("no", true));
    assert_eq!(guard.verdict(), Verdict::Fine);
    for i in 0..5 {
        guard.saw(&call(&format!("{{\"m\":{i}}}")), &out("no", true));
    }
    assert_eq!(guard.verdict(), Verdict::Nudge);
}
