//! "Continue with ChatGPT": the commands Settings uses, modelled on Sign in
//! with GitHub's. Starting opens the sign-in page in the system browser
//! (never in the app), and the end of the sign-in comes as an event to the
//! main window alone. Nothing here touches the vault.

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use super::callback::LIMIT;
use super::flow;
use super::models::{self, Listing};
use super::session::Status;
use crate::chat::commands::ChatState;
use crate::closing::MAIN;

const EVENT: &str = "kasten://chatgpt-sign-in";

/// What starting a sign-in answers at once; the end follows as an event.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignInStart {
    /// The sign-in page, for when the browser did not come forward.
    pub url: String,
}

/// What signing out did.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignedOut {
    /// Whether OpenAI ended the sign-in too. When it did not, Kasten stays
    /// listed in ChatGPT's settings until the person removes it there.
    pub revoked: bool,
}

/// Starts the sign-in: opens ChatGPT's page in the system browser and
/// waits, in the background, for the browser to come back. `fixed_port`
/// listens on the one port OpenAI's examples use, for when a random one
/// is not accepted.
#[tauri::command]
pub async fn chatgpt_sign_in_start(
    app: AppHandle,
    chat: State<'_, ChatState>,
    fixed_port: Option<bool>,
) -> Result<SignInStart, String> {
    let account = chat.chatgpt();
    let http = chat.http()?;
    let stop = account.begin();
    let port = if fixed_port.unwrap_or(false) {
        flow::FIXED_PORT
    } else {
        0
    };
    let prepared = match flow::prepare(&account, &http, port).await {
        Ok(prepared) => prepared,
        Err(err) => {
            account.end(&stop);
            return Err(err);
        }
    };
    let url = prepared.url.clone();
    if let Err(err) = crate::web::open_url(url.clone()) {
        account.end(&stop);
        return Err(err);
    }
    tauri::async_runtime::spawn(async move {
        let end = flow::finish(&account, &http, prepared, &stop, LIMIT).await;
        account.end(&stop);
        if let Some(end) = end {
            let _ = app.emit_to(MAIN, EVENT, end);
        }
    });
    Ok(SignInStart { url })
}

/// Stops the sign-in under way.
#[tauri::command]
pub fn chatgpt_sign_in_cancel(chat: State<'_, ChatState>) {
    chat.chatgpt().cancel();
}

/// Whether Kasten is signed in with ChatGPT, and as whom.
#[tauri::command]
pub async fn chatgpt_account(chat: State<'_, ChatState>) -> Result<Status, String> {
    Ok(chat.chatgpt().status().await)
}

/// The models the signed-in account can use: the account's own list, or why
/// it could not be read together with the last list that was (and when),
/// or only the built-in names, marked as not confirmed for the plan.
#[tauri::command]
pub async fn chatgpt_models(chat: State<'_, ChatState>) -> Result<Listing, String> {
    let account = chat.chatgpt();
    Ok(models::listing(&account, &chat.http()?, &models::url(), None).await)
}

/// Signs out here, and asks OpenAI to end the sign-in too.
#[tauri::command]
pub async fn chatgpt_sign_out(chat: State<'_, ChatState>) -> Result<SignedOut, String> {
    let account = chat.chatgpt();
    let revoked = account.sign_out(&chat.http()?).await;
    Ok(SignedOut { revoked })
}
