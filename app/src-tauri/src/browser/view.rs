//! Making one browser webview and listening to it. The page inside is the
//! open web: its navigations are held to `policy::may_visit`, new windows
//! become new Kasten tabs (the tab, not the webview, opens them), downloads
//! are refused with an offer to open the link in the system's browser, and
//! what it does (an address, a title, loading) is told to the main window
//! only. Nothing here keeps a lock while it waits for a webview.

use std::path::PathBuf;
use std::time::Instant;

use serde::Serialize;
use tauri::webview::{DownloadEvent, NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Rect, Url, Webview, WebviewUrl,
    Wry,
};

use super::capture::Titled;
use super::{Browser, policy, script};
use crate::closing::MAIN;

/// The event the main window hears from every browser tab.
pub const EVENT: &str = "browser-event";
/// The longest title kept.
const MAX_TITLE: usize = 300;

/// What a browser tab did. `kind` is one of `url`, `title`, `loading`,
/// `new-tab`, `download`, `closed`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: String,
    pub kind: &'static str,
    pub url: Option<String>,
    pub title: Option<String>,
    pub loading: Option<bool>,
}

impl Event {
    pub fn new(id: &str, kind: &'static str) -> Event {
        Event {
            id: id.to_owned(),
            kind,
            url: None,
            title: None,
            loading: None,
        }
    }
}

/// Tells the main window, and no other webview.
pub fn tell(app: &AppHandle, event: Event) {
    let _ = app.emit_to(MAIN, EVENT, event);
}

/// Where a tab's pixels go, in physical pixels of the window.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
pub struct Bounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Bounds {
    /// Kept inside what a screen can show, and never empty.
    pub fn clamped(self) -> Bounds {
        Bounds {
            x: self.x.clamp(-32_768, 32_768),
            y: self.y.clamp(-32_768, 32_768),
            width: self.width.clamp(1, 16_384),
            height: self.height.clamp(1, 16_384),
        }
    }

    pub fn rect(self) -> Rect {
        let b = self.clamped();
        Rect {
            position: PhysicalPosition::new(b.x, b.y).into(),
            size: PhysicalSize::new(b.width, b.height).into(),
        }
    }
}

/// The browsing profile: its own folder, so clearing it never touches the app's.
pub fn profile_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|dir| dir.join("browser"))
        .map_err(|e| format!("There is no place to keep the browser's data: {e}"))
}

fn short(title: &str) -> String {
    title.chars().take(MAX_TITLE).collect()
}

/// The builder for the webview of tab `id`, at `url`.
pub fn builder(app: &AppHandle, id: &str, url: Url, profile: PathBuf) -> WebviewBuilder<Wry> {
    let label = format!("{}{id}", policy::PREFIX);
    let (loaded, titled, window, download) = (app.clone(), app.clone(), app.clone(), app.clone());
    let (opened_id, download_id) = (id.to_owned(), id.to_owned());
    let page_id = id.to_owned();
    WebviewBuilder::new(label, WebviewUrl::External(url))
        .data_directory(profile)
        .devtools(cfg!(debug_assertions))
        // The guard plugin holds every webview to its rules too; this is the
        // rule of the tab itself, and applies to frames as well.
        .on_navigation(policy::may_visit)
        .on_page_load(move |_webview, payload| {
            let url = payload.url().to_string();
            let mut event = Event::new(&page_id, "loading");
            event.loading = Some(matches!(payload.event(), PageLoadEvent::Started));
            event.url = Some(url.clone());
            if let Ok(parsed) = Url::parse(&url)
                && policy::may_visit(&parsed)
            {
                loaded.state::<Browser>().went(&page_id, &url);
            }
            tell(&loaded, event);
        })
        .on_document_title_changed(move |webview, title| on_title(&titled, &webview, &title))
        .on_new_window(move |url, _features| {
            if policy::may_visit(&url) {
                let mut event = Event::new(&opened_id, "new-tab");
                event.url = Some(url.to_string());
                tell(&window, event);
            }
            NewWindowResponse::Deny
        })
        .on_download(move |_webview, event| {
            if let DownloadEvent::Requested { url, .. } = event {
                let mut event = Event::new(&download_id, "download");
                event.url = Some(url.to_string());
                tell(&download, event);
                return false;
            }
            true
        })
}

/// A title arrived: a chunk of a capture's answer, or the page's own title.
fn on_title(app: &AppHandle, webview: &Webview<Wry>, title: &str) {
    let browser = app.state::<Browser>();
    let Some(id) = policy::id_of(webview.label()).map(str::to_owned) else {
        return;
    };
    let label = webview.label().to_owned();
    match browser.titled(&label, title, Instant::now()) {
        Titled::Plain => {
            let mut event = Event::new(&id, "title");
            event.title = Some(short(title));
            // A page that moves without loading (a single-page app) shows here.
            if let Ok(url) = webview.url()
                && policy::may_visit(&url)
            {
                browser.went(&id, url.as_str());
                event.url = Some(url.to_string());
            }
            tell(app, event);
        }
        Titled::Foreign => {}
        Titled::More => {
            if let Some(nonce) = nonce_in(title).and_then(|n| script::next(&n)) {
                let _ = webview.eval(nonce);
            }
        }
        Titled::Done(answer, kind) => {
            if let Some(next) = nonce_in(title).and_then(|n| script::next(&n)) {
                let _ = webview.eval(next);
            }
            browser.deliver(&label, Ok((answer, kind)));
        }
        Titled::Refused(refused) => {
            if let Some(end) = nonce_in(title).and_then(|n| script::end(&n)) {
                let _ = webview.eval(end);
            }
            browser.deliver(&label, Err(refused));
        }
    }
}

/// The nonce a title that carries a chunk names.
fn nonce_in(title: &str) -> Option<String> {
    title
        .strip_prefix(super::capture::TITLE_MARK)?
        .split(':')
        .next()
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounds_are_kept_on_screen_and_never_empty() {
        let b = Bounds {
            x: -100_000,
            y: 100_000,
            width: 0,
            height: 99_999,
        }
        .clamped();
        assert_eq!(
            b,
            Bounds {
                x: -32_768,
                y: 32_768,
                width: 1,
                height: 16_384
            }
        );
        let fine = Bounds {
            x: 10,
            y: 20,
            width: 800,
            height: 600,
        };
        assert_eq!(fine.clamped(), fine);
    }

    #[test]
    fn a_titles_nonce_is_read_back() {
        assert_eq!(
            nonce_in("kasten-capture:abc_-1:0:3:xyz").as_deref(),
            Some("abc_-1")
        );
        assert_eq!(nonce_in("A normal title"), None);
    }
}
