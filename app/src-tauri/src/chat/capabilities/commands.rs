//! `model_capabilities`: what a provider's model takes, for the Advanced
//! popover. Nothing here reaches a provider; it reads the table and what this
//! run has learned about a reasoning effort on the ChatGPT plan.

use tauri::State;

use super::table::{lookup, route_of};
use super::{ModelCapabilities, Route};
use crate::chat::commands::ChatState;
use crate::chat::http::Kind;
use crate::chat::{openai, providers};
use crate::commands::notes::OpenVault;

/// What `model` (else the provider's own) of the provider called `provider`
/// takes.
#[tauri::command]
pub async fn model_capabilities(
    vault: State<'_, OpenVault>,
    state: State<'_, ChatState>,
    provider: String,
    model: String,
) -> Result<ModelCapabilities, String> {
    let kasten = vault.require()?;
    let provider = providers::find(&kasten, &provider)?;
    let kind = Kind::of(&provider.kind)?;
    let url = match kind {
        Kind::OpenAi => openai::url(&provider.base_url)?,
        _ => String::new(),
    };
    let model = match model.trim() {
        "" => provider.model.trim().to_owned(),
        chosen => chosen.to_owned(),
    };
    let mut caps = lookup(route_of(kind, &url), &model);
    if caps.route == Route::ChatGptResponses {
        let account = state.chatgpt();
        caps.effort_refused = account.effort_refused(&model);
        // Found to work on this computer: no longer a thing to try.
        caps.verified = caps.verified || account.effort_works(&model);
    }
    Ok(caps)
}
