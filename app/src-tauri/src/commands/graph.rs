//! The link graph, for the Graph view, the project overview and the local
//! graph beside a page. It only reads: see kasten-core's `graph`.

use kasten_core::graph::{Graph, Scope};
use tauri::State;

use super::notes::OpenVault;

/// The vault's notes, boards and decks and the links between them, cut down
/// to `scope`.
#[tauri::command(async)]
pub fn vault_graph(state: State<'_, OpenVault>, scope: Scope) -> Result<Graph, String> {
    state.run(|k| k.graph(&scope))
}
