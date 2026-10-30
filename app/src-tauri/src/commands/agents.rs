//! Agent review and sessions: proposals waiting for the owner, accepting or
//! rejecting them, agent sessions and undoing one.

use kasten_core::agent::Proposal;
use kasten_core::{ChangedFile, Digest, Instant, SessionInfo, Undone};
use serde_json::Value;
use tauri::State;

use super::notes::OpenVault;

/// Who accepts or rejects: the login name, as the CLI uses.
pub(crate) fn owner() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "you".to_owned())
}

#[tauri::command(async)]
pub fn list_proposals(state: State<'_, OpenVault>) -> Result<Vec<Proposal>, String> {
    state.run(|k| k.proposals())
}

#[tauri::command(async)]
pub fn accept_proposal(state: State<'_, OpenVault>, id: String) -> Result<Value, String> {
    state.run(|k| {
        k.commit_edits()?;
        k.accept_proposal(&id, &owner(), Instant::now())
    })
}

#[tauri::command(async)]
pub fn reject_proposal(state: State<'_, OpenVault>, id: String) -> Result<(), String> {
    state.run(|k| k.reject_proposal(&id, &owner(), Instant::now()))
}

#[tauri::command(async)]
pub fn list_sessions(
    state: State<'_, OpenVault>,
    limit: Option<usize>,
) -> Result<Vec<SessionInfo>, String> {
    state.run(|k| k.sessions(limit.unwrap_or(50)))
}

/// What agents did since `since` (milliseconds since the Unix epoch), session
/// by session, for Home's "Agents today". A person's edits are not in it.
#[tauri::command(async)]
pub fn activity_digest(state: State<'_, OpenVault>, since: u64) -> Result<Digest, String> {
    state.run(|k| k.activity_digest(since))
}

#[tauri::command(async)]
pub fn undo_session(state: State<'_, OpenVault>, session: String) -> Result<Undone, String> {
    state.run(|k| {
        k.commit_edits()?;
        k.undo_session(&session, Instant::now())
    })
}

/// Lifts a session's soft limits for `minutes`.
#[tauri::command(async)]
pub fn trust_session(
    state: State<'_, OpenVault>,
    session: String,
    minutes: Option<u64>,
) -> Result<(), String> {
    let until = Instant::now().millis + minutes.unwrap_or(60).min(24 * 60) * 60_000;
    state.run(|k| k.trust_session(&session, until))
}

/// The files one commit changed, before and after.
#[tauri::command(async)]
pub fn commit_changes(
    state: State<'_, OpenVault>,
    rev: String,
) -> Result<Vec<ChangedFile>, String> {
    state.run(|k| k.commit_changes(&rev))
}

/// The token clients send to this vault's MCP server over HTTP, made on
/// first use: for "Copy token" in Settings. Only the main window may ask.
#[tauri::command(async)]
pub fn mcp_token(state: State<'_, OpenVault>) -> Result<String, String> {
    let kasten = state.require()?;
    kasten_mcp::http_token(kasten.root()).map_err(|e| format!("Could not make the token: {e}"))
}
