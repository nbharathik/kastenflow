use std::fs;

use super::*;

fn outcome(at: u64) -> RequestOutcome {
    RequestOutcome {
        at,
        provider: "chatgpt".to_owned(),
        model: "gpt-6.1-sol".to_owned(),
        route: "api.openai.com/v1/responses".to_owned(),
        ok: true,
        stage: Stage::Stream,
        status: Some(200),
        kind: None,
        reason: String::new(),
        attempts: 1,
        first_byte_ms: Some(420),
        total_ms: 1800,
        renewed: false,
        rebuilt: false,
    }
}

fn folder(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("kasten-report-{name}-{}", std::process::id()))
}

#[test]
fn the_report_shows_the_last_fifty_newest_first_and_keeps_two_hundred() {
    let report = Diagnostics::default();
    for at in 0..260 {
        report.record(outcome(at));
    }
    let shown = report.recent();
    assert_eq!(shown.len(), SHOWN);
    assert_eq!((shown[0].at, shown[49].at), (259, 210));
    assert_eq!(report.inner().list.len(), KEPT);
}

#[test]
fn the_report_is_kept_in_a_file_and_comes_back_after_a_restart() {
    let dir = folder("restart");
    let first = Diagnostics::default();
    first.keep_in(dir.clone());
    first.record(outcome(1));
    first.record(outcome(2));

    let second = Diagnostics::default();
    second.keep_in(dir.clone());
    second.record(outcome(3));
    assert_eq!(
        second.recent().iter().map(|o| o.at).collect::<Vec<_>>(),
        [3, 2, 1]
    );

    second.clear();
    let third = Diagnostics::default();
    third.keep_in(dir.clone());
    assert!(third.recent().is_empty());
    // Only this test's own folder under the system temp folder.
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_damaged_or_foreign_file_is_ignored_not_fatal() {
    let dir = folder("damaged");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join(FILE), "{ not json").unwrap();
    let report = Diagnostics::default();
    report.keep_in(dir.clone());
    assert!(report.recent().is_empty());
    report.record(outcome(7));
    assert_eq!(report.recent().len(), 1, "and it is written over");
    fs::write(dir.join(FILE), r#"{"version":9,"outcomes":[]}"#).unwrap();
    let report = Diagnostics::default();
    report.keep_in(dir.clone());
    assert!(report.recent().is_empty());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn a_route_has_no_name_no_password_and_no_query() {
    assert_eq!(
        route_of("https://user:pass@gateway.example:8443/v1/chat/completions?key=secret"),
        "gateway.example:8443/v1/chat/completions"
    );
    assert_eq!(
        route_of("https://api.openai.com/v1/responses"),
        "api.openai.com/v1/responses"
    );
    assert_eq!(route_of("not a url"), "unknown");
}

#[test]
fn a_providers_code_is_cleaned_before_it_is_shown() {
    assert_eq!(tidy(" Rate_Limit_Exceeded "), "rate_limit_exceeded");
    assert_eq!(tidy("a@b.example sk-abc DEF"), "ab.examplesk-abcdef");
    assert_eq!(tidy(&"x".repeat(200)).len(), 48);
}

#[test]
fn a_line_is_numbers_and_words_in_the_windows_spelling() {
    let json = serde_json::to_value(outcome(5)).unwrap();
    let mut keys: Vec<&str> = json
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        [
            "at",
            "attempts",
            "firstByteMs",
            "kind",
            "model",
            "ok",
            "provider",
            "reason",
            "rebuilt",
            "renewed",
            "route",
            "stage",
            "status",
            "totalMs"
        ]
    );
    assert_eq!(json["stage"], "stream");
}
