//! AI while writing: "Ask AI", "Continue writing", "Summarize page" and
//! "Explain" in the page editor. One request, without tools, holding the
//! selection (or the page) and a little of the page around it. The answer
//! streams back to the editor, which shows it as a preview and changes the
//! page only when the person accepts it, as their own edit; an explanation
//! is only read. The provider's address must be confirmed on this
//! computer, as for a chat.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use super::commands::ChatState;
use super::model::{Call, Message, Model, Stop};
use super::write_prompt::system;
// What the tests of the prompt reach by this module's path.
#[cfg(test)]
pub use super::write_prompt::{AROUND, MOST, Scope, WriteAction};
pub use super::write_prompt::{WriteRequest, prompt};
use crate::closing::MAIN;
use crate::commands::notes::OpenVault;

/// The event an answer's text comes on, to the main window only. (An IPC
/// channel would do too, but the browser tab's webviews are on the same
/// window, and what is sent should be addressed to the one that asked.)
pub const TEXT_EVENT: &str = "ai-write-text";

/// A piece of the answer being written for request `id`.
#[derive(Clone, Serialize)]
struct Piece<'a> {
    id: &'a str,
    text: &'a str,
}

/// The whole answer, once it ends.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Written {
    pub text: String,
    /// The person stopped it before its end.
    pub stopped: bool,
    /// Why the answer may be incomplete, when it may be.
    pub note: Option<String>,
}

/// Asks `model` for `request`, passing the answer's text to `text` as it
/// comes; `cancel` stops it, keeping what came.
pub async fn write(
    model: &impl Model,
    request: &WriteRequest,
    text: &(dyn Fn(&str) + Sync),
    cancel: &AtomicBool,
) -> Result<Written, String> {
    write_with(
        model,
        system(request.action),
        prompt(request)?,
        text,
        cancel,
    )
    .await
}

/// Asks `model` for `message` under `system`, as `write` does for the
/// editor's own actions: one request without tools, its text passed on as
/// it comes. AI actions (actions/) ask this way too.
pub async fn write_with(
    model: &impl Model,
    system: &str,
    message: String,
    text: &(dyn Fn(&str) + Sync),
    cancel: &AtomicBool,
) -> Result<Written, String> {
    let messages = [Message::User(message)];
    let call = Call {
        system,
        messages: &messages,
        tools: &[],
    };
    let reply = model
        .reply(&call, text, cancel)
        .await
        .map_err(|f| f.message)?;
    match reply.stop {
        Stop::Refusal => Err("The model declined to answer".into()),
        Stop::Full => {
            Err("This is more than the model can read at once. Select less, then try again".into())
        }
        stop => Ok(Written {
            text: reply.text,
            stopped: stop == Stop::Cancelled,
            note: (stop == Stop::Length)
                .then(|| "The answer reached its length limit, so it may end early".to_owned()),
        }),
    }
}

/// The answers being written, by the editor's id, and how to stop each.
#[derive(Default)]
pub struct Writes(Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>);

/// One answer under way; its id is free again once dropped.
pub struct Running {
    id: String,
    flag: Arc<AtomicBool>,
    all: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

impl Running {
    pub fn flag(&self) -> &AtomicBool {
        &self.flag
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        self.all
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(&self.id);
    }
}

impl Writes {
    pub fn start(&self, id: &str) -> Result<Running, String> {
        let mut all = self.0.lock().unwrap_or_else(|p| p.into_inner());
        if all.contains_key(id) {
            return Err("This is still being written".into());
        }
        let flag = Arc::new(AtomicBool::new(false));
        all.insert(id.to_owned(), Arc::clone(&flag));
        Ok(Running {
            id: id.to_owned(),
            flag,
            all: Arc::clone(&self.0),
        })
    }

    pub fn stop(&self, id: &str) {
        if let Some(flag) = self.0.lock().unwrap_or_else(|p| p.into_inner()).get(id) {
            flag.store(true, Ordering::SeqCst);
        }
    }
}

/// Writes an answer for the editor, streaming its text as `ai-write-text`
/// events to the main window.
#[tauri::command]
pub async fn ai_write(
    app: AppHandle,
    vault: State<'_, OpenVault>,
    state: State<'_, ChatState>,
    request: WriteRequest,
) -> Result<Written, String> {
    let kasten = vault.require()?;
    let model = state
        .model(&kasten, &request.provider, &request.model)
        .await?;
    let running = state.writes.start(&request.id)?;
    let send = to_window(&app, &request.id);
    write(&model, &request, &send, running.flag()).await
}

/// How a piece of the answer for request `id` reaches the editor: as an
/// event to the main window alone. Every command that writes for the editor
/// sends its text this way.
pub fn to_window<'a>(app: &'a AppHandle, id: &'a str) -> impl Fn(&str) + Sync + 'a {
    move |piece: &str| {
        let _ = app.emit_to(MAIN, TEXT_EVENT, Piece { id, text: piece });
    }
}

/// Stops the answer being written for `id`; `ai_write` returns what came.
#[tauri::command(async)]
pub fn ai_write_stop(state: State<'_, ChatState>, id: String) {
    state.writes.stop(&id);
}
