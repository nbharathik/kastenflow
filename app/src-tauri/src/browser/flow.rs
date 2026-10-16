//! Capture, from the tab's bar: ask the page for its selection (or read the
//! page), show the person what would be kept, and write it only when they
//! confirm. What is held between those steps is held here, in Rust: the
//! window can only say where it goes, never what it holds.

use std::time::{Duration, Instant};

use kasten_core::clip::{Existing, Target, WebCapture};
use kasten_core::{NoteFile, NoteMeta};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, Url, Webview, Wry};
use tokio::sync::oneshot;
use tokio::time::timeout;

use super::capture::{Answer, Kind, Refused, SENTINEL_HOST, new_nonce};
use super::{Browser, held, live, policy, script};
use crate::chat::commands::ChatState;
use crate::commands::notes::{HUMAN, OpenVault};

/// How long the script's own result is waited for before the title is tried.
const FIRST_WAIT: Duration = Duration::from_millis(2500);
/// How long the title way is waited for before the navigation way is tried.
const TITLE_WAIT: Duration = Duration::from_secs(5);
/// How long the navigation way is waited for: all within a request's lifetime.
const LAST_WAIT: Duration = Duration::from_secs(12);

type Reply = oneshot::Receiver<Result<(Answer, Kind), Refused>>;

/// Waits for an answer: none yet is `None`.
async fn wait(reply: &mut Reply, how_long: Duration) -> Option<Result<Answer, String>> {
    match timeout(how_long, reply).await {
        Ok(Ok(result)) => Some(
            result
                .map(|(answer, _)| answer)
                .map_err(|why| why.to_string()),
        ),
        Ok(Err(_)) => Some(Err("Another capture took this one's place".to_owned())),
        Err(_) => None,
    }
}

/// Asks the page in `view` for its selection or itself, by the first way that answers.
async fn ask(browser: &Browser, view: &Webview<Wry>, kind: Kind) -> Result<Answer, String> {
    let label = view.label().to_owned();
    let nonce = new_nonce()?;
    let (sender, mut reply) = oneshot::channel();
    held(&browser.sessions).begin(&label, kind, nonce.clone(), Instant::now());
    held(&browser.waiters).insert(label.clone(), sender);
    let result = ask_each_way(view, &label, &nonce, kind, &mut reply).await;
    held(&browser.sessions).cancel(&label);
    held(&browser.waiters).remove(&label);
    result
}

async fn ask_each_way(
    view: &Webview<Wry>,
    label: &str,
    nonce: &str,
    kind: Kind,
    reply: &mut Reply,
) -> Result<Answer, String> {
    let broken = || "That page cannot be read".to_owned();
    // The script's own result.
    let handle = view.app_handle().clone();
    let named = label.to_owned();
    let sent = view.eval_with_callback(
        script::result(nonce, kind).ok_or_else(broken)?,
        move |json| {
            handle
                .state::<Browser>()
                .answer(&named, json.as_bytes(), Instant::now());
        },
    );
    if sent.is_ok()
        && let Some(done) = wait(reply, FIRST_WAIT).await
    {
        return done;
    }
    // The page's title, a piece at a time.
    if view
        .eval(script::titled(nonce, kind).ok_or_else(broken)?)
        .is_ok()
        && let Some(done) = wait(reply, TITLE_WAIT).await
    {
        return done;
    }
    // A navigation to an address that never resolves, which is cancelled.
    if view
        .eval(script::sentinel(nonce, kind, SENTINEL_HOST).ok_or_else(broken)?)
        .is_ok()
        && let Some(done) = wait(reply, LAST_WAIT).await
    {
        return done;
    }
    Err("The page did not answer. Try again, or select less".to_owned())
}

fn nonblank(text: String) -> Option<String> {
    (!text.trim().is_empty()).then_some(text)
}

/// The page fetched from its address, as the web clipper reads it.
async fn fetched(chat: &ChatState, url: &Url) -> Result<WebCapture, String> {
    let address = crate::clip::address(url.as_str())?;
    let (landed, bytes) = crate::clip::page_bytes(chat, &address).await?;
    let html = String::from_utf8_lossy(&bytes).into_owned();
    Ok(WebCapture {
        title: kasten_core::clip::title_of(&landed, &html),
        url: landed,
        html: Some(html),
        text: None,
        via: "browser".to_owned(),
        tags: Vec::new(),
        snapshot_of: None,
    })
}

/// What the person is shown before anything is kept.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Previewed {
    /// Hand this back to confirm or discard.
    pub token: String,
    pub kind: &'static str,
    pub url: String,
    pub title: String,
    pub site: String,
    pub excerpt: String,
    pub bytes: usize,
    /// The notes already kept from this page, the first saved first; empty
    /// for a page not saved before.
    pub existing: Vec<Existing>,
}

/// What a person is told when a card would be a second copy of a page.
fn already_saved(found: &[NoteMeta]) -> String {
    let first = found.first().map(Existing::from);
    let when = first
        .as_ref()
        .and_then(|e| e.captured.as_deref())
        .map(|day| format!(" on {day}"))
        .unwrap_or_default();
    let title = first
        .map(|e| format!(" as “{}”", e.title))
        .unwrap_or_default();
    format!("Already saved{when}{title}. Choose “Save another snapshot” to keep this one too")
}

/// Reads the selection (`selection`) or the page (`page`) of tab `id`, and
/// holds it for the person to confirm. The page is fetched from its address
/// as the web clipper does; a page that cannot be fetched (behind a sign-in)
/// is read as the tab shows it.
#[tauri::command]
pub async fn browser_capture(
    app: AppHandle,
    browser: State<'_, Browser>,
    chat: State<'_, ChatState>,
    vault: State<'_, OpenVault>,
    id: String,
    kind: String,
) -> Result<Previewed, String> {
    let view = live(&app, &browser, &id)?;
    // The address Kasten saw the tab go to, never the one the page reports.
    let url = view.url().map_err(|e| e.to_string())?;
    if !policy::may_visit(&url) || url.as_str() == "about:blank" {
        return Err("Open a web page first".to_owned());
    }
    let (capture, what) = match kind.as_str() {
        "selection" => {
            let answer = ask(&browser, &view, Kind::Selection).await?;
            let (html, text) = (nonblank(answer.html), nonblank(answer.text));
            if html.is_none() && text.is_none() {
                return Err("Select some text on the page first".to_owned());
            }
            let capture = WebCapture {
                url: url.to_string(),
                title: answer.title,
                html,
                text,
                via: "browser".to_owned(),
                tags: Vec::new(),
                snapshot_of: None,
            };
            (capture, "selection")
        }
        "page" => {
            let capture = match fetched(&chat, &url).await {
                Ok(capture) => capture,
                Err(why) => {
                    let answer = ask(&browser, &view, Kind::Page)
                        .await
                        .map_err(|e| format!("{why}. Reading the page as shown failed too: {e}"))?;
                    WebCapture {
                        url: url.to_string(),
                        title: answer.title,
                        html: nonblank(answer.html),
                        text: None,
                        via: "browser".to_owned(),
                        tags: Vec::new(),
                        snapshot_of: None,
                    }
                }
            };
            (capture, "page")
        }
        _ => return Err("Capture the page or the selection".to_owned()),
    };
    let preview = capture.preview().map_err(|e| e.to_string())?;
    // Is this page already saved? Looked up in the index; with no vault open
    // there is nothing saved to find.
    let address = capture.url.clone();
    let existing: Vec<Existing> = match vault.require() {
        Ok(kasten) => tauri::async_runtime::spawn_blocking(move || {
            crate::crash::caught(|| {
                kasten
                    .captured(&address)
                    .map(|found| found.iter().map(Existing::from).collect())
                    .map_err(|e| e.to_string())
            })
        })
        .await
        .map_err(crate::crash::joined)??,
        Err(_) => Vec::new(),
    };
    let token = new_nonce()?;
    let shown = Previewed {
        token: token.clone(),
        kind: what,
        url: capture.url.clone(),
        title: preview.title,
        site: preview.site,
        excerpt: preview.excerpt,
        bytes: preview.bytes,
        existing,
    };
    held(&browser.previews).put(token, capture, Instant::now());
    Ok(shown)
}

/// Where a confirmed capture goes.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Where {
    Inbox,
    Project {
        project: String,
    },
    Page {
        path: String,
        heading: Option<String>,
    },
}

impl From<&Where> for Target {
    fn from(place: &Where) -> Target {
        match place {
            Where::Inbox => Target::Inbox,
            Where::Project { project } => Target::Project(project.clone()),
            Where::Page { path, heading } => Target::Page {
                path: path.clone(),
                heading: heading.clone(),
            },
        }
    }
}

/// What was kept, for the notice.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub path: String,
    pub title: String,
    /// Where it went, in words.
    pub place: String,
}

/// Keeps the capture held under `token`, once, as a card or a quote. A title
/// given replaces the page's. A refusal leaves the capture held, so the person
/// can pick another place. A card for a page that is already saved is refused
/// unless `again` is true, which keeps it as a snapshot pointing back at the
/// first card (a quote added to a page is never held back).
#[tauri::command]
pub async fn browser_capture_confirm(
    browser: State<'_, Browser>,
    vault: State<'_, OpenVault>,
    token: String,
    place: Where,
    title: Option<String>,
    again: Option<bool>,
) -> Result<Saved, String> {
    browser.require_on()?;
    let mut capture = held(&browser.previews)
        .take(&token, Instant::now())
        .ok_or_else(|| "That capture has expired. Capture again".to_owned())?;
    if let Some(title) = title.filter(|t| !t.trim().is_empty()) {
        capture.title = title;
    }
    let kasten = vault.require()?;
    let target = Target::from(&place);
    let mut keep = capture.clone();
    let again = again.unwrap_or(false);
    let written: Result<NoteFile, String> = tauri::async_runtime::spawn_blocking(move || {
        crate::crash::caught(|| {
            if !matches!(target, Target::Page { .. }) {
                let found = kasten.captured(&keep.url).map_err(|e| e.to_string())?;
                if let Some(first) = found.first() {
                    if !again {
                        return Err(already_saved(&found));
                    }
                    keep.snapshot_of = Some(first.path.clone());
                }
            }
            kasten
                .capture_web(&HUMAN, &keep, &target, kasten_core::Instant::now())
                .map_err(|e| e.to_string())
        })
    })
    .await
    .map_err(crate::crash::joined)?;
    match written {
        Ok(note) => Ok(Saved {
            place: match &place {
                Where::Inbox => "Inbox".to_owned(),
                Where::Project { project } => project.clone(),
                Where::Page { .. } => note.meta.title.clone(),
            },
            path: note.meta.path,
            title: note.meta.title,
        }),
        Err(why) => {
            held(&browser.previews).put(token, capture, Instant::now());
            Err(why)
        }
    }
}

/// Lets go of a held capture (the person closed the preview).
#[tauri::command]
pub fn browser_capture_discard(browser: State<'_, Browser>, token: String) {
    held(&browser.previews).discard(&token);
}

/// What a page says about itself in its tags, for "Save as paper".
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageMeta {
    /// The address Kasten saw the tab go to, never the one the page reports.
    pub url: String,
    pub title: String,
    /// `{ "meta": [[name, content]], "ld": [text] }` as JSON text. The page wrote
    /// it, so the window reads it as data and checks every part.
    pub meta: String,
}

/// Reads the `<meta>` tags and JSON-LD of the page tab `id` shows. Nothing is
/// fetched and nothing is kept: the window shows what was read for the person
/// to check before a reference is made of it.
#[tauri::command]
pub async fn browser_page_meta(
    app: AppHandle,
    browser: State<'_, Browser>,
    id: String,
) -> Result<PageMeta, String> {
    let view = live(&app, &browser, &id)?;
    let url = view.url().map_err(|e| e.to_string())?;
    if !policy::may_visit(&url) || url.as_str() == "about:blank" {
        return Err("Open a web page first".to_owned());
    }
    let answer = ask(&browser, &view, Kind::Meta).await?;
    Ok(PageMeta {
        url: url.to_string(),
        title: answer.title,
        meta: answer.html,
    })
}
