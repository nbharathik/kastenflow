//! The `save_project_setup` tool: a project saved as a setup new projects can
//! start from. It writes into the user's templates folder, so it always waits
//! for review unless the user lets agents work on their own.

mod common;

use common::{TempDir, vault};
use kasten_core::agent::Session;
use kasten_core::config_keys::{AgentMode, AgentsConfig};
use kasten_core::history::Actor;
use kasten_core::{Instant, Kasten};
use kasten_mcp::tools::{call, specs};
use serde_json::{Value, json};

const DRAFT: &str = "projects/note-taking-study/pages/report-draft.md";

fn open() -> (TempDir, Kasten, Session) {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    (v, k, Session::start("claude-code", Instant::now()))
}

fn set_mode(k: &Kasten, mode: AgentMode) {
    let mut config = k.config();
    config.agents = Some(AgentsConfig {
        mode: Some(mode),
        ..AgentsConfig::default()
    });
    k.set_config(config).unwrap();
}

#[test]
fn the_tool_is_listed_in_plain_words_and_is_not_a_read() {
    let all = specs();
    let tool = all.iter().find(|t| t.name == "save_project_setup").unwrap();
    assert!(!tool.read_only);
    assert_eq!(tool.input_schema["type"], "object");
    assert_eq!(tool.input_schema["required"], json!(["project", "name"]));
    for words in ["review", "locked"] {
        assert!(tool.description.contains(words), "{}", tool.description);
    }
    for bad in ["commit", "sidecar", "frontmatter", "AgentOp", "yaml"] {
        assert!(!tool.description.contains(bad), "{bad}");
    }
}

#[test]
fn a_save_waits_for_review_in_balanced_mode_and_is_made_in_autonomous_mode() {
    let (v, k, s) = open();
    let held = call(
        &k,
        &s,
        "save_project_setup",
        json!({ "project": "Note-taking study", "name": "Study kit", "pages": ["Report draft: How people find old notes"] }),
    )
    .unwrap();
    assert_eq!(held["status"], "pending_review", "{held}");
    assert!(!v.0.join("templates/setups").exists());
    // The person accepts it.
    let id = held["proposal"].as_str().unwrap().to_owned();
    k.accept_proposal(&id, "me", Instant::now()).unwrap();
    assert!(v.0.join("templates/setups/study-kit.yaml").is_file());
    assert!(
        v.0.join("templates/setups/study-kit/pages/report-draft.md")
            .is_file()
    );

    set_mode(&k, AgentMode::Autonomous);
    let made = call(
        &k,
        &s,
        "save_project_setup",
        json!({ "project": "note-taking-study", "name": "Second kit" }),
    )
    .unwrap();
    assert_eq!(made["status"], "done", "{made}");
    assert_eq!(made["result"]["setup"], "saved:second-kit");
    assert_eq!(made["result"]["pages"], 2);
    // The saved setup is on offer to start a project from, to the person and to agents.
    let ids: Vec<String> = k.list_setups().unwrap().into_iter().map(|s| s.id).collect();
    assert!(
        ids.contains(&"saved:study-kit".to_owned()) && ids.contains(&"saved:second-kit".to_owned())
    );
    let project = call(
        &k,
        &s,
        "create_project",
        json!({ "title": "From my kit", "setup": "saved:study-kit" }),
    )
    .unwrap();
    assert_eq!(project["status"], "done", "{project}");
    assert!(
        v.0.join("projects/from-my-kit/pages/report-draft.md")
            .is_file()
    );
}

#[test]
fn a_locked_page_or_a_path_for_a_name_is_refused_and_nothing_waits() {
    let (v, k, s) = open();
    k.set_meta(&Actor::Human, DRAFT, "locked", Some("true"), Instant::now())
        .unwrap();
    let locked = call(
        &k,
        &s,
        "save_project_setup",
        json!({ "project": "note-taking-study", "name": "Kit", "pages": [DRAFT] }),
    )
    .unwrap_err();
    assert!(locked.contains("locked"), "{locked}");
    for slug in ["../x", "a/b", "x.yaml"] {
        let err = call(
            &k,
            &s,
            "save_project_setup",
            json!({ "project": "note-taking-study", "name": "Kit", "slug": slug }),
        )
        .unwrap_err();
        assert!(err.contains("file name"), "{slug}: {err}");
    }
    let outside = call(
        &k,
        &s,
        "save_project_setup",
        json!({ "project": "note-taking-study", "name": "Kit", "pages": ["Photo organiser roadmap"] }),
    )
    .unwrap_err();
    assert!(outside.contains("not a page of this project"), "{outside}");
    let nobody = call(
        &k,
        &s,
        "save_project_setup",
        json!({ "project": "No such project", "name": "Kit" }),
    )
    .unwrap_err();
    assert!(!nobody.is_empty());
    assert!(k.proposals().unwrap().is_empty());
    assert!(!v.0.join("templates/setups").exists());
}

#[test]
fn the_pages_inside_a_saved_setup_are_not_listed_as_templates() {
    let (_v, k, s) = open();
    k.save_project_setup(
        &Actor::Human,
        "note-taking-study",
        "",
        "Study kit",
        &[DRAFT.to_owned()],
        Instant::now(),
    )
    .unwrap();
    let listed = call(&k, &s, "list_templates", Value::Null).unwrap();
    let names: Vec<&str> = listed["templates"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|t| t["name"].as_str())
        .collect();
    assert!(!names.is_empty());
    assert!(names.iter().all(|n| !n.contains("setups")), "{names:?}");
}

#[test]
fn the_setups_on_offer_are_listed_with_the_ones_the_user_saved() {
    let (_v, k, s) = open();
    let all = specs();
    let tool = all.iter().find(|t| t.name == "list_setups").unwrap();
    assert!(tool.read_only);
    k.save_project_setup(
        &Actor::Human,
        "note-taking-study",
        "",
        "Study kit",
        &[DRAFT.to_owned()],
        Instant::now(),
    )
    .unwrap();
    let listed = call(&k, &s, "list_setups", Value::Null).unwrap();
    let rows = listed["setups"].as_array().unwrap();
    let ids: Vec<&str> = rows.iter().filter_map(|r| r["id"].as_str()).collect();
    assert_eq!(
        ids,
        ["research", "writing", "presentation", "saved:study-kit"]
    );
    assert_eq!(rows[3]["saved"], true);
    assert_eq!(rows[3]["name"], "Study kit");
    assert_eq!(rows[3]["tags"], json!(["paper"]));
}

#[test]
fn the_chat_reads_the_call_in_words() {
    let input = json!({ "project": "Note-taking study", "name": "Study kit" });
    assert_eq!(
        kasten_mcp::parity_words::action("save_project_setup", &input).as_deref(),
        Some("save the project “Note-taking study” as the setup “Study kit”")
    );
    let told = kasten_mcp::parity_words::told(
        "save_project_setup",
        &input,
        &json!({ "result": { "name": "Study kit", "path": "templates/setups/study-kit.yaml" } }),
    )
    .unwrap();
    assert_eq!(told.summary, "Saved the setup “Study kit”");
    assert_eq!(told.paths, ["templates/setups/study-kit.yaml"]);
}
