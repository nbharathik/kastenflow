//! A plugin's tools reach an agent only while the plugin is on for the vault:
//! listed, answered, and announced (`tools/list_changed`) when a person
//! turns the plugin off or on in the app while the server runs.

mod common;

use std::time::Duration;

use common::{Client, vault};
use kasten_core::history::Actor;
use kasten_core::{Instant, Kasten};
use serde_json::json;

const LIST_CHANGED: &str = "notifications/tools/list_changed";

fn offers(tools: &[String], name: &str) -> bool {
    tools.iter().any(|t| t == name)
}

#[test]
fn the_diagram_tools_follow_the_diagrams_plugin_and_the_client_is_told() {
    let v = vault();
    let mut agent = Client::start(&v.0, "test-agent");
    let tools = agent.tools();
    assert!(offers(&tools, "diagram_edit") && offers(&tools, "create_diagram"));
    assert!(offers(&tools, "read_note"));
    assert!(!agent.notices.iter().any(|n| n == LIST_CHANGED));

    // A person turns the plugin off in the app (another program, same vault).
    let app = Kasten::open(&v.0).unwrap();
    assert!(
        app.set_plugin_enabled(&Actor::Human, "diagrams", false, Instant::now())
            .unwrap()
    );
    std::thread::sleep(Duration::from_millis(400));
    let tools = agent.tools();
    assert!(!offers(&tools, "diagram_edit") && !offers(&tools, "create_diagram"));
    assert!(!offers(&tools, "get_diagram") && !offers(&tools, "diagram_describe"));
    assert!(offers(&tools, "read_note") && offers(&tools, "lint_deck"));
    assert!(
        agent.call("diagram_edit", json!({})).is_err(),
        "an off plugin's tool does not answer"
    );

    // The client hears that the list changed.
    std::thread::sleep(Duration::from_millis(2600));
    agent.tools();
    assert_eq!(
        agent.notices.iter().filter(|n| *n == LIST_CHANGED).count(),
        1,
        "{:?}",
        agent.notices
    );

    // And again when it comes back.
    std::thread::sleep(Duration::from_millis(300));
    app.set_plugin_enabled(&Actor::Human, "diagrams", true, Instant::now())
        .unwrap();
    std::thread::sleep(Duration::from_millis(2900));
    let tools = agent.tools();
    assert!(offers(&tools, "diagram_edit"));
    assert_eq!(
        agent.notices.iter().filter(|n| *n == LIST_CHANGED).count(),
        2,
        "{:?}",
        agent.notices
    );
}
