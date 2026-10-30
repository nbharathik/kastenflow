//! Smart pages are an optional plugin, off until a person turns them on: while
//! they are off the smart tools are not listed and answer with a sentence that
//! sends the agent to `request_smart_pages`, which only ever asks. A project
//! can turn them on or off for its own pages.

mod common;

use std::time::Duration;

use common::{Client, vault};
use kasten_core::agent::Session;
use kasten_core::config_keys::{AgentMode, AgentsConfig};
use kasten_core::history::Actor;
use kasten_core::{Instant, Kasten, ProjectSmart};
use kasten_mcp::tools::{call, specs};
use serde_json::{Value, json};

const SMART_TOOLS: [&str; 7] = [
    "smart_create",
    "smart_read",
    "smart_edit",
    "smart_write_file",
    "smart_delete_file",
    "smart_check",
    "smart_render",
];

fn offers(tools: &[String], name: &str) -> bool {
    tools.iter().any(|t| t == name)
}

fn session() -> Session {
    Session::start("claude-code", Instant::now())
}

fn create_args(project: Option<&str>) -> Value {
    json!({
        "title": "Deadlines",
        "project": project,
        "files": [{"path": "index.html", "content": "<h1>Deadlines</h1>"}],
    })
}

#[test]
fn while_off_only_the_request_tool_is_listed_and_it_is_the_whole_smart_surface() {
    let v = vault();
    let mut agent = Client::start(&v.0, "test-agent");
    let tools = agent.tools();
    for tool in SMART_TOOLS {
        assert!(
            !offers(&tools, tool),
            "{tool} is listed while smart pages are off"
        );
    }
    assert!(offers(&tools, "request_smart_pages"));
    assert!(offers(&tools, "read_note") && offers(&tools, "lint_deck"));
    assert!(
        !agent.instructions.to_lowercase().contains("smart page"),
        "the instructions leave smart pages out"
    );

    // The one tool says plainly what it does and does not do.
    let all = specs();
    let spec = all
        .iter()
        .find(|s| s.name == "request_smart_pages")
        .unwrap();
    assert!(!spec.read_only);
    assert!(
        spec.description.contains("turns nothing on"),
        "{}",
        spec.description
    );
    for jargon in ["commit", "sidecar", "ADR", "dev/"] {
        assert!(!spec.description.contains(jargon), "{jargon}");
    }
    assert_eq!(spec.input_schema["required"], json!(["reason"]));
}

#[test]
fn the_list_follows_the_plugin_in_both_directions() {
    let v = vault();
    let mut agent = Client::start(&v.0, "test-agent");
    let app = Kasten::open(&v.0).unwrap();
    app.set_plugin_enabled(&Actor::Human, "smart", true, Instant::now())
        .unwrap();
    std::thread::sleep(Duration::from_millis(400));
    let tools = agent.tools();
    for tool in SMART_TOOLS {
        assert!(offers(&tools, tool), "{tool}");
    }
    assert!(
        !offers(&tools, "request_smart_pages"),
        "nothing left to ask for"
    );

    std::thread::sleep(Duration::from_millis(300));
    app.set_plugin_enabled(&Actor::Human, "smart", false, Instant::now())
        .unwrap();
    std::thread::sleep(Duration::from_millis(400));
    let tools = agent.tools();
    assert!(!offers(&tools, "smart_create") && offers(&tools, "request_smart_pages"));
}

#[test]
fn a_direct_call_of_a_smart_tool_while_off_is_told_to_ask() {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    let s = session();
    for (tool, args) in [
        ("smart_create", create_args(None)),
        ("smart_read", json!({"page": "anything"})),
        ("smart_check", json!({"page": "anything"})),
    ] {
        let err = call(&k, &s, tool, args).unwrap_err();
        assert!(err.contains("request_smart_pages"), "{tool}: {err}");
        assert!(err.contains("off"), "{tool}: {err}");
    }
}

#[test]
fn a_request_waits_for_the_person_in_every_mode_and_accepting_it_turns_the_tools_on() {
    for mode in [
        AgentMode::Review,
        AgentMode::Balanced,
        AgentMode::Autonomous,
    ] {
        let v = vault();
        let k = Kasten::open(&v.0).unwrap();
        let mut config = k.config();
        config.agents = Some(AgentsConfig {
            mode: Some(mode),
            ..AgentsConfig::default()
        });
        k.set_config(config).unwrap();
        let s = session();
        let asked = call(
            &k,
            &s,
            "request_smart_pages",
            json!({"reason": "A tracker would show the deadlines"}),
        )
        .unwrap();
        assert_eq!(
            asked["status"],
            json!("pending_review"),
            "{mode:?}: {asked}"
        );
        assert!(!k.config().plugin_enabled("smart"), "{mode:?}");
        assert!(
            call(&k, &s, "smart_create", create_args(None)).is_err(),
            "{mode:?}"
        );
        let waiting = k.proposals().unwrap();
        assert_eq!(waiting.len(), 1);
        assert!(
            waiting[0]
                .diff
                .starts_with("An agent asks to turn on smart pages: A tracker would show"),
            "{}",
            waiting[0].diff
        );

        k.accept_proposal(&waiting[0].id, "me", Instant::now())
            .unwrap();
        let made = call(&k, &s, "smart_create", create_args(None)).unwrap();
        assert!(
            made["status"] == json!("done") || made["status"] == json!("pending_review"),
            "{mode:?}: {made}"
        );
    }
}

#[test]
fn a_rejected_request_changes_nothing_and_the_tools_stay_away() {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    let s = session();
    call(&k, &s, "request_smart_pages", json!({"reason": "Please"})).unwrap();
    let id = k.proposals().unwrap()[0].id.clone();
    k.reject_proposal(&id, "me", Instant::now()).unwrap();
    assert!(!k.config().plugin_enabled("smart"));
    assert!(!k.smart_enabled_anywhere());
    assert!(call(&k, &s, "smart_create", create_args(None)).is_err());
}

#[test]
fn a_project_that_says_on_gets_the_tools_and_a_project_that_says_off_does_not() {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    let s = session();
    let on = "projects/photo-organiser/_project.md";
    k.set_project_smart_pages(&Actor::Human, on, ProjectSmart::On, Instant::now())
        .unwrap();

    // The tools are offered because one project has smart pages on...
    let mut agent = Client::start(&v.0, "test-agent");
    let tools = agent.tools();
    assert!(offers(&tools, "smart_create") && !offers(&tools, "request_smart_pages"));

    // ...and each call asks about its own project.
    let there = call(&k, &s, "smart_create", create_args(Some("photo-organiser"))).unwrap();
    assert_eq!(there["status"], json!("done"), "{there}");
    let elsewhere = call(
        &k,
        &s,
        "smart_create",
        create_args(Some("note-taking-study")),
    )
    .unwrap_err();
    assert!(
        elsewhere.contains("request_smart_pages") && elsewhere.contains("note-taking-study"),
        "{elsewhere}"
    );
    let library = call(&k, &s, "smart_create", create_args(None)).unwrap_err();
    assert!(library.contains("request_smart_pages"), "{library}");

    // A page in the project keeps working for reads; turning the project off stops it.
    let page = there["result"]["page"].as_str().unwrap().to_owned();
    assert!(call(&k, &s, "smart_read", json!({"page": page})).is_ok());
    k.set_project_smart_pages(&Actor::Human, on, ProjectSmart::Off, Instant::now())
        .unwrap();
    let err = call(&k, &s, "smart_read", json!({"page": page})).unwrap_err();
    assert!(err.contains("request_smart_pages"), "{err}");
    assert!(!k.smart_enabled_anywhere());
}
