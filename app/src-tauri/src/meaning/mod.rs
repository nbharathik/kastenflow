//! Search by meaning. The embedding model
//! is asked here, since keys and the network are the app's; kasten-core
//! keeps the vectors and finds the nearest notes. Any OpenAI-compatible
//! endpoint serves: OpenAI's, or a local server such as vLLM or Ollama.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use kasten_core::Kasten;
use kasten_core::vectors::{EmbedStatus, Embedded, Nearest};
use reqwest::header::CONTENT_TYPE;
use serde::Serialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::chat::commands::ChatState;
use crate::chat::http::http_error;
use crate::chat::providers;
use crate::closing::MAIN;
use crate::commands::notes::OpenVault;

/// Notes sent to the model at once.
pub const BATCH: usize = 32;
const WAIT: Duration = Duration::from_secs(90);
/// Times a "slow down" is waited out before giving up.
const RETRIES: u32 = 4;

/// Where an OpenAI-compatible provider makes vectors, from its base URL.
pub fn embeddings_url(base: &str) -> Result<String, String> {
    let base = base.trim().trim_end_matches('/');
    let base = base.strip_suffix("/chat/completions").unwrap_or(base);
    if base.is_empty() {
        return Err(
            "Search by meaning needs the provider's base URL, such as https://api.openai.com/v1"
                .into(),
        );
    }
    Ok(format!("{base}/embeddings"))
}

/// The vectors in the model's answer, in the order the texts were sent.
pub fn vectors_of(answer: &Value, count: usize) -> Result<Vec<Vec<f32>>, String> {
    let data = answer["data"]
        .as_array()
        .ok_or("The model's answer held no vectors")?;
    let mut out: Vec<Option<Vec<f32>>> = vec![None; count];
    for (i, item) in data.iter().enumerate() {
        let at = item["index"].as_u64().map_or(i, |n| n as usize);
        let vector = item["embedding"]
            .as_array()
            .and_then(|v| {
                v.iter()
                    .map(|x| x.as_f64().map(|f| f as f32))
                    .collect::<Option<Vec<_>>>()
            })
            .ok_or("The model's answer held something other than numbers")?;
        if let Some(slot) = out.get_mut(at) {
            *slot = Some(vector);
        }
    }
    out.into_iter()
        .collect::<Option<Vec<_>>>()
        .ok_or_else(|| "The model's answer missed some of the notes".into())
}

/// An embedding model at a provider, ready to ask.
pub struct Embedder {
    pub http: reqwest::Client,
    pub url: String,
    pub key: Option<String>,
    pub model: String,
    pub provider: String,
    /// The first wait after a "slow down", doubled each time.
    pub pause: Duration,
}

impl Embedder {
    /// The provider and model chosen in Settings.
    pub async fn chosen(kasten: &Kasten, chat: &ChatState) -> Result<Embedder, String> {
        let chosen = kasten
            .config()
            .ai
            .embeddings
            .filter(|e| !e.provider.trim().is_empty() && !e.model.trim().is_empty())
            .ok_or("Choose a provider and model for search by meaning in Settings, AI")?;
        let provider = providers::find(kasten, &chosen.provider)?;
        chat.check_origin(&provider)?;
        if provider.kind != "openai" {
            return Err(format!(
                "“{}” does not make vectors: search by meaning needs an OpenAI-compatible provider, such as OpenAI or a local server",
                provider.name
            ));
        }
        Ok(Embedder {
            key: chat.key(&provider).await?,
            http: chat.http()?,
            url: embeddings_url(&provider.base_url)?,
            model: chosen.model.trim().to_owned(),
            provider: provider.name,
            pause: Duration::from_secs(5),
        })
    }

    /// One vector per text, in order.
    pub async fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        let body = json!({ "model": self.model, "input": texts }).to_string();
        let mut pause = self.pause;
        for attempt in 0..=RETRIES {
            let mut request = self
                .http
                .post(&self.url)
                .header(CONTENT_TYPE, "application/json")
                .body(body.clone())
                .timeout(WAIT);
            if let Some(key) = &self.key {
                request = request.bearer_auth(key);
            }
            let response = request
                .send()
                .await
                .map_err(|e| format!("Could not reach “{}”: {e}", self.provider))?;
            let status = response.status().as_u16();
            let text = response
                .text()
                .await
                .map_err(|e| format!("“{}” broke off its answer: {e}", self.provider))?;
            if status == 429 && attempt < RETRIES {
                tokio::time::sleep(pause).await;
                pause *= 2;
                continue;
            }
            if !(200..300).contains(&status) {
                return Err(http_error(&self.provider, status, &text));
            }
            let answer: Value = serde_json::from_str(&text).map_err(|e| {
                format!(
                    "“{}” answered something other than JSON: {e}",
                    self.provider
                )
            })?;
            return vectors_of(&answer, texts.len());
        }
        Err(format!(
            "“{}” kept asking to slow down; try again later",
            self.provider
        ))
    }
}

/// Makes vectors for every note that needs one, a batch at a time, telling
/// `progress` after each; stops between batches when `stop` is set.
pub async fn make_all(
    kasten: &Kasten,
    embedder: &Embedder,
    stop: &AtomicBool,
    progress: impl Fn(&EmbedStatus),
) -> Result<EmbedStatus, String> {
    make(kasten, embedder, stop, usize::MAX, progress).await
}

/// Makes vectors for at most `batches` batches of notes that need one:
/// catching up after a search.
pub async fn make_some(
    kasten: &Kasten,
    embedder: &Embedder,
    batches: usize,
) -> Result<EmbedStatus, String> {
    make(kasten, embedder, &AtomicBool::new(false), batches, |_| {}).await
}

async fn make(
    kasten: &Kasten,
    embedder: &Embedder,
    stop: &AtomicBool,
    batches: usize,
    progress: impl Fn(&EmbedStatus),
) -> Result<EmbedStatus, String> {
    let fail = |e: kasten_core::Error| e.to_string();
    for _ in 0..batches {
        if stop.load(Ordering::SeqCst) {
            break;
        }
        let todo = kasten.to_embed(&embedder.model, BATCH).map_err(fail)?;
        if todo.is_empty() {
            break;
        }
        let texts: Vec<String> = todo.iter().map(|t| t.text.clone()).collect();
        let vectors = embedder.embed(&texts).await?;
        let made: Vec<Embedded> = todo
            .into_iter()
            .zip(vectors)
            .map(|(t, vector)| Embedded {
                path: t.path,
                stamp: t.stamp,
                hash: t.hash,
                vector,
            })
            .collect();
        kasten.keep_vectors(&embedder.model, &made).map_err(fail)?;
        progress(&kasten.embed_status(&embedder.model).map_err(fail)?);
    }
    kasten.embed_status(&embedder.model).map_err(fail)
}

/// The notes nearest a question.
pub async fn search(
    kasten: &Kasten,
    embedder: &Embedder,
    query: &str,
    limit: usize,
) -> Result<Vec<Nearest>, String> {
    let vector = embedder.embed(&[query.trim().to_owned()]).await?.remove(0);
    kasten
        .nearest(&embedder.model, &vector, limit)
        .map_err(|e| e.to_string())
}

/// Whether vectors are being made, and a request to stop.
#[derive(Default)]
pub struct MeaningState {
    running: AtomicBool,
    stop: AtomicBool,
}

/// Marks vectors as no longer being made when the work ends, however it
/// ends, a failure or a panic included, so the next run is not refused.
struct Running(AppHandle);

impl Drop for Running {
    fn drop(&mut self) {
        self.0
            .state::<MeaningState>()
            .running
            .store(false, Ordering::SeqCst);
    }
}

/// How far search by meaning covers the vault.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeaningStatus {
    pub provider: Option<String>,
    pub model: Option<String>,
    pub done: usize,
    pub total: usize,
    pub running: bool,
}

pub(crate) fn status_of(kasten: &Kasten, state: &MeaningState) -> Result<MeaningStatus, String> {
    let chosen = kasten.config().ai.embeddings;
    let model = chosen.as_ref().map(|e| e.model.clone()).unwrap_or_default();
    let status = kasten.embed_status(&model).map_err(|e| e.to_string())?;
    Ok(MeaningStatus {
        provider: chosen.as_ref().map(|e| e.provider.clone()),
        model: chosen.map(|e| e.model),
        done: if model.is_empty() { 0 } else { status.done },
        total: status.total,
        running: state.running.load(Ordering::SeqCst),
    })
}

#[tauri::command(async)]
pub fn meaning_status(
    vault: State<'_, OpenVault>,
    meaning: State<'_, MeaningState>,
) -> Result<MeaningStatus, String> {
    let kasten = vault.require()?;
    crate::crash::caught(|| status_of(&kasten, &meaning))
}

/// Makes the vectors notes need, telling the window as it goes
/// (`meaning-progress`); one run at a time.
#[tauri::command]
pub async fn make_vectors(
    app: AppHandle,
    vault: State<'_, OpenVault>,
    chat: State<'_, ChatState>,
    meaning: State<'_, MeaningState>,
) -> Result<MeaningStatus, String> {
    let kasten = vault.require()?;
    if meaning.running.swap(true, Ordering::SeqCst) {
        return Err("Vectors are being made already".into());
    }
    let running = Running(app.clone());
    meaning.stop.store(false, Ordering::SeqCst);
    let run = async {
        let embedder = Embedder::chosen(&kasten, &chat).await?;
        make_all(&kasten, &embedder, &meaning.stop, |s| {
            let _ = app.emit_to(MAIN, "meaning-progress", s);
        })
        .await
    }
    .await;
    drop(running);
    run?;
    crate::crash::caught(|| status_of(&kasten, &meaning))
}

#[tauri::command(async)]
pub fn stop_vectors(meaning: State<'_, MeaningState>) {
    meaning.stop.store(true, Ordering::SeqCst);
}

/// Batches of new or changed notes a search catches up on afterwards.
const CATCH_UP: usize = 4;

/// The notes nearest a question. Afterwards, unless vectors are being made
/// already, a few batches of notes written since get theirs, so the next
/// search finds them.
#[tauri::command]
pub async fn search_meaning(
    app: AppHandle,
    vault: State<'_, OpenVault>,
    chat: State<'_, ChatState>,
    meaning: State<'_, MeaningState>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<Nearest>, String> {
    let kasten = vault.require()?;
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    let embedder = Embedder::chosen(&kasten, &chat).await?;
    let found = search(&kasten, &embedder, &query, limit.unwrap_or(20)).await?;
    if !meaning.running.swap(true, Ordering::SeqCst) {
        let running = Running(app.clone());
        tauri::async_runtime::spawn(async move {
            let caught_up = make_some(&kasten, &embedder, CATCH_UP).await;
            drop(running);
            if let Ok(status) = caught_up {
                let _ = app.emit_to(MAIN, "meaning-progress", &status);
            }
        });
    }
    Ok(found)
}

#[cfg(test)]
mod tests;
