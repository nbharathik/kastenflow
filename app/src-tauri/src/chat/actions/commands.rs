//! The commands behind AI actions: the list on offer, and running one on a
//! page or a PDF. A run streams its text as `ai-write-text` events to the
//! main window, as the editor's own AI does, and the person decides what
//! becomes of the answer.

use kasten_core::Instant;
use kasten_core::agent::Session;
use serde::Deserialize;
use tauri::{AppHandle, State};

use super::catalog::{self, Catalog};
use super::context::{self, Input};
use crate::chat::CLIENT;
use crate::chat::commands::ChatState;
use crate::chat::state::blocking;
use crate::chat::write::{self, Written};
use crate::commands::notes::OpenVault;

/// One run of an action.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionRequest {
    /// Made by the window, to stop the answer by.
    pub id: String,
    /// The action's slug.
    pub action: String,
    /// A provider's name in the vault's config.
    pub provider: String,
    /// The model to ask; empty means the provider's own.
    #[serde(default)]
    pub model: String,
    /// Words the person added to the action.
    #[serde(default)]
    pub instruction: String,
    #[serde(flatten)]
    pub input: Input,
}

/// The actions on offer: the built-in ones and the vault's, and the vault
/// files that could not be used, with why.
#[tauri::command]
pub async fn ai_actions(vault: State<'_, OpenVault>) -> Result<Catalog, String> {
    let kasten = vault.require()?;
    blocking(move || catalog::load(&kasten)).await
}

/// Runs an action and streams its answer; the answer is only a preview
/// until the person takes it.
#[tauri::command]
pub async fn ai_action_run(
    app: AppHandle,
    vault: State<'_, OpenVault>,
    state: State<'_, ChatState>,
    request: ActionRequest,
) -> Result<Written, String> {
    let kasten = vault.require()?;
    let (action, message) = {
        let kasten = std::sync::Arc::clone(&kasten);
        let (slug, input, extra) = (
            request.action.clone(),
            request.input.clone(),
            request.instruction.clone(),
        );
        blocking(move || {
            let catalog = catalog::load(&kasten)?;
            let action = catalog
                .find(&slug)
                .cloned()
                .ok_or_else(|| format!("There is no AI action called “{slug}”"))?;
            let session = Session::start(CLIENT, Instant::now());
            let message = context::prompt(&kasten, &session, &action, &input, &extra)?;
            Ok((action, message))
        })
        .await?
    };
    let model = state
        .model(&kasten, &request.provider, &request.model)
        .await?;
    let running = state.writes.start(&request.id)?;
    let send = write::to_window(&app, &request.id);
    write::write_with(
        &model,
        context::system(&action),
        message,
        &send,
        running.flag(),
    )
    .await
}
