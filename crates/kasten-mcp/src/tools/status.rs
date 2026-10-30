//! `server_status`: how this server is doing, for an agent that finds
//! something not working and for a person running `kasten-mcp --check`. It
//! reads and changes nothing, and starts no browser.

use kasten_core::agent::Session;
use kasten_core::{Config, Instant, Kasten, Result};
use serde_json::{Map, Value, json};

use crate::decks::render;
use crate::setup::canonical;

/// The plugins every vault knows, then any other the config names.
const PLUGINS: [&str; 3] = ["diagrams", "latex", "smart"];

/// Each plugin by id, on or off, as the config says now.
pub(crate) fn plugins(config: &Config) -> Value {
    let mut out = Map::new();
    let named = config
        .plugins
        .iter()
        .flat_map(|p| p.extra.keys().map(String::as_str));
    for id in PLUGINS.into_iter().chain(named) {
        out.insert(id.to_owned(), json!(config.plugin_enabled(id)));
    }
    Value::Object(out)
}

/// How much an agent may change without asking, for the vault, as the core
/// holds it now: the mode the config names, until it ends, and balanced from
/// then on (or where there is no history to undo from).
pub(crate) fn mode(kasten: &Kasten) -> Value {
    json!(kasten.agent_mode(None, Instant::now()))
}

/// The status, and the problems in it (the sentences `--check` exits 1 for).
pub(crate) fn health(kasten: &Kasten, session: Option<&Session>) -> (Value, Vec<String>) {
    let mut problems = Vec::new();
    let history = kasten.has_history();
    if !history {
        problems.push(
            "The vault keeps no history, so changes made by agents could not be undone. Turn on history in KastenFlow's settings, or run `kastenflow start-history`.".to_owned(),
        );
    }
    // The config as the file says now, not as it was when the server started.
    let config = kasten.config();
    if let Some(why) = kasten.config_problem() {
        problems.push(why);
    }
    let drawing = render::report();
    problems.extend(drawing.problems);
    let value = json!({
        "version": kasten_core::VERSION,
        "vault": canonical(kasten.root()),
        "history": history,
        "session": session.map(|s| json!({ "id": s.id, "client": s.client })),
        "limits": config.guardrails,
        "mode": mode(kasten),
        "plugins": plugins(&config),
        "render": drawing.value,
        "problems": problems,
    });
    (value, problems)
}

/// The tool: what `health` says.
pub(crate) fn server_status(kasten: &Kasten, session: Option<&Session>) -> Result<Value> {
    Ok(health(kasten, session).0)
}
