//! The window's commands for the agent CLIs: what Settings › Agents lists and
//! tests, the answer to a card, and what `chat_send` needs to start a turn.

use tauri::{AppHandle, Manager, State};

use super::Agent;
use super::detect::{self, AgentCheck, AgentInfo};
use super::drive::Limits;
use super::resolve::resolve;
use crate::chat::providers::ChatProvider;
use crate::chat::state::{ChatState, blocking};
use crate::chat::threads::CliSetup;

/// The agents as pseudo-providers, for the model picker: a thread uses one by
/// this name. `has_key` says whether the program was found.
pub fn providers() -> Vec<ChatProvider> {
    Agent::ALL
        .into_iter()
        .map(|agent| ChatProvider {
            name: agent.provider_name().to_owned(),
            kind: "cli".to_owned(),
            base_url: String::new(),
            model: String::new(),
            has_key: resolve(agent).is_some(),
            confirmed: true,
        })
        .collect()
}

/// What a turn with `agent` needs, or the sentence that says why it cannot start.
pub fn setup(app: &AppHandle, state: &ChatState, agent: Agent) -> Result<CliSetup, String> {
    let program = resolve(agent).ok_or_else(|| {
        format!(
            "{} was not found on this computer, so this chat cannot use it. {} Then choose it again.",
            agent.label(),
            agent.install_hint()
        )
    })?;
    let exe = std::env::current_exe()
        .map_err(|e| format!("KastenFlow's own program could not be found: {e}"))?;
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("The app's cache folder could not be found: {e}"))?
        .join("agents");
    Ok(CliSetup {
        agent,
        program,
        exe,
        cache,
        hub: std::sync::Arc::clone(&state.agents),
        limits: Limits::default(),
    })
}

/// The agents on this computer: where each program is and its version.
#[tauri::command]
pub async fn agents_list() -> Result<Vec<AgentInfo>, String> {
    blocking(|| Ok(detect::list())).await
}

/// "Test": starts the program for its version and asks whether it is signed in.
#[tauri::command]
pub async fn agents_test(id: String) -> Result<AgentCheck, String> {
    let agent = Agent::of_id(&id).ok_or_else(|| format!("There is no agent called “{id}”"))?;
    blocking(move || Ok(detect::test(agent))).await
}

/// The person's answer to a card: allow or deny what the agent asked. Whether
/// the question was still open.
#[tauri::command(async)]
pub fn chat_agent_answer(
    state: State<'_, ChatState>,
    chat: String,
    id: String,
    allow: bool,
    message: Option<String>,
) -> bool {
    let message = message
        .map(|m| m.trim().to_owned())
        .filter(|m| !m.is_empty());
    state.agents.approvals.answer(&chat, &id, allow, message)
}
