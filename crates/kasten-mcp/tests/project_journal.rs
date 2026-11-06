//! `journal_day`, `journal_append` and `get_journal` with a `project`: the
//! project's own journal, under the same modes and refusals as the vault's.

mod common;

use std::fs;

use common::{TempDir, vault};
use kasten_core::agent::Session;
use kasten_core::config_keys::{AgentMode, AgentsConfig, ProjectAgents};
use kasten_core::{Instant, Kasten};
use kasten_mcp::tools::{call, specs};
use serde_json::json;

const PROJECT: &str = "photo-organiser";
const DAY_FILE: &str = "projects/photo-organiser/journal/2026/2026-11-03.md";

fn open() -> (TempDir, Kasten, Session) {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    (v, k, Session::start("claude-code", Instant::now()))
}

#[test]
fn the_three_journal_tools_take_a_project_and_no_tool_was_added() {
    let all = specs();
    for name in ["journal_day", "journal_append", "get_journal"] {
        let tool = all.iter().find(|t| t.name == name).unwrap();
        let schema = tool.input_schema.to_string();
        assert!(schema.contains("\"project\""), "{name}: {schema}");
        // Optional: an old call without it is the vault's journal.
        let required = tool.input_schema["required"].to_string();
        assert!(!required.contains("project"), "{name}: {required}");
        assert!(tool.description.len() < 260, "{name}: {}", tool.description);
    }
}

#[test]
fn journal_append_with_a_project_writes_that_projects_day() {
    let (v, k, s) = open();
    let told = call(
        &k,
        &s,
        "journal_append",
        json!({"date": "2026-11-03", "markdown": "- 10:00 Tried the matcher", "project": PROJECT}),
    )
    .unwrap();
    assert_eq!(told["status"], "done", "{told}");
    assert_eq!(told["result"]["path"], DAY_FILE);
    let text = fs::read_to_string(v.0.join(DAY_FILE)).unwrap();
    assert!(text.contains("type: journal") && text.contains("Tried the matcher"));
    // The vault's own journal for the day is not made.
    assert!(!v.0.join("journal/2026/2026-11-03.md").exists());
    // Without a project it is the vault's, as before.
    let vault_day = call(
        &k,
        &s,
        "journal_append",
        json!({"date": "2026-11-03", "markdown": "Vault entry."}),
    )
    .unwrap();
    assert_eq!(vault_day["result"]["path"], "journal/2026/2026-11-03.md");
    // A blank project is no project.
    let blank = call(
        &k,
        &s,
        "journal_append",
        json!({"date": "2026-11-03", "markdown": "Still the vault.", "project": "  "}),
    )
    .unwrap();
    assert_eq!(blank["result"]["path"], "journal/2026/2026-11-03.md");
}

#[test]
fn journal_day_with_a_project_opens_it_and_get_journal_reads_it() {
    let (_v, k, s) = open();
    let read = |project: serde_json::Value| {
        call(
            &k,
            &s,
            "get_journal",
            json!({"date": "2026-11-03", "project": project}),
        )
        .unwrap()
    };
    assert_eq!(read(json!(PROJECT))["exists"], json!(false));
    let day = call(
        &k,
        &s,
        "journal_day",
        json!({"date": "2026-11-03", "project": PROJECT}),
    )
    .unwrap();
    assert_eq!(day["result"]["path"], DAY_FILE);
    let got = read(json!(PROJECT));
    assert_eq!(got["path"], DAY_FILE, "{got}");
    // The title the project is known by finds the same day.
    assert_eq!(read(json!("Photo organiser"))["path"], DAY_FILE);
    // The vault's day of the same date is still not there.
    let vault_day = call(&k, &s, "get_journal", json!({"date": "2026-11-03"})).unwrap();
    assert_eq!(vault_day["exists"], json!(false));
}

#[test]
fn a_wrong_project_or_day_is_refused_and_writes_nothing() {
    let (v, k, s) = open();
    for (tool, project, want) in [
        ("journal_day", "no-such-project", "No project called"),
        ("journal_append", "no-such-project", "No project called"),
        ("journal_day", "../x", "Not a project folder"),
        ("journal_append", "a/b", "Not a project folder"),
        ("journal_append", "..", "Not a project folder"),
    ] {
        let err = call(
            &k,
            &s,
            tool,
            json!({"date": "2026-11-03", "markdown": "x", "project": project}),
        )
        .unwrap_err();
        assert!(err.contains(want), "{tool} {project}: {err}");
    }
    let err = call(
        &k,
        &s,
        "journal_append",
        json!({"date": "soon", "markdown": "x", "project": PROJECT}),
    )
    .unwrap_err();
    assert!(err.contains("Not a day"), "{err}");
    assert!(!v.0.join("projects/no-such-project").exists());
    assert!(!v.0.join("projects/photo-organiser/journal").exists());
    let err = call(&k, &s, "get_journal", json!({"project": "nope"})).unwrap_err();
    assert!(err.contains("No project called"), "{err}");
}

#[test]
fn a_projects_review_mode_holds_its_journal_and_not_the_vaults() {
    let (v, k, s) = open();
    let mut config = k.config();
    config.agents = Some(AgentsConfig {
        mode: Some(AgentMode::Balanced),
        projects: [(
            PROJECT.to_owned(),
            ProjectAgents {
                mode: Some(AgentMode::Review),
                ..ProjectAgents::default()
            },
        )]
        .into_iter()
        .collect(),
        ..AgentsConfig::default()
    });
    k.set_config(config).unwrap();

    let held = call(
        &k,
        &s,
        "journal_append",
        json!({"date": "2026-11-03", "markdown": "Wait for me.", "project": PROJECT}),
    )
    .unwrap();
    assert_eq!(held["status"], "pending_review", "{held}");
    assert!(!v.0.join(DAY_FILE).exists());
    let free = call(
        &k,
        &s,
        "journal_append",
        json!({"date": "2026-11-03", "markdown": "Go on."}),
    )
    .unwrap();
    assert_eq!(free["status"], "done", "{free}");
}

#[test]
fn a_batch_can_add_to_a_project_journal() {
    let (v, k, s) = open();
    let told = call(
        &k,
        &s,
        "batch",
        json!({"ops": [
            {"tool": "journal_append", "args": {"date": "2026-11-03", "markdown": "From a batch.", "project": PROJECT}},
            {"tool": "journal_append", "args": {"date": "2026-11-03", "markdown": "Vault, in the batch."}},
        ]}),
    )
    .unwrap();
    assert_eq!(told["status"], "done", "{told}");
    assert!(
        fs::read_to_string(v.0.join(DAY_FILE))
            .unwrap()
            .contains("From a batch.")
    );
    assert!(v.0.join("journal/2026/2026-11-03.md").exists());
    let undone = k.undo_session(&s.id, Instant::now()).unwrap();
    assert!(undone.conflict.is_none());
    assert!(
        !v.0.join(DAY_FILE).exists(),
        "one undo takes the batch back"
    );
}
