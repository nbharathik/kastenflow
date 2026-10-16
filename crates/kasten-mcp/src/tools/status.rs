//! `server_status`: how this server is doing, for an agent that finds
//! something not working and for a person running `kasten-mcp --check`. It
//! reads and changes nothing, and starts no browser.

use kasten_core::agent::Session;
use kasten_core::{Kasten, Result};
use serde_json::{Value, json};

use crate::decks::render;
use crate::setup::canonical;

/// The status, and the problems in it (the sentences `--check` exits 1 for).
pub(crate) fn health(kasten: &Kasten, session: Option<&Session>) -> (Value, Vec<String>) {
    let mut problems = Vec::new();
    let history = kasten.has_history();
    if !history {
        problems.push(
            "The vault keeps no history, so changes made by agents could not be undone. Turn on history in KastenFlow's settings, or run `kastenflow start-history`.".to_owned(),
        );
    }
    let drawing = render::report();
    problems.extend(drawing.problems);
    let value = json!({
        "version": kasten_core::VERSION,
        "vault": canonical(kasten.root()),
        "history": history,
        "session": session.map(|s| json!({ "id": s.id, "client": s.client })),
        "render": drawing.value,
        "problems": problems,
    });
    (value, problems)
}

/// The tool: what `health` says.
pub(crate) fn server_status(kasten: &Kasten, session: Option<&Session>) -> Result<Value> {
    Ok(health(kasten, session).0)
}
