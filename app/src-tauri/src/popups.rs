//! A page in a frame of a slide may ask for a window of its own: the "Watch on YouTube" link of a player, a link that opens in a new tab.
//! The frames of a slide are allowed to ask (`allow-popups`), and the app opens no window for them. A web address goes to the system's
//! browser, as every other link out of the app does, and anything else is refused. So a page in a frame can never make a window that has
//! the app's name on it and a page of its own in it.
//!
//! The main window is built here from its entry in `tauri.conf.json` (which says `create: false`), because only a window made in code can
//! be given a handler for new windows.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::webview::NewWindowResponse;
use tauri::{App, Url, WebviewWindowBuilder};

use crate::closing::MAIN;

/// How soon after one popup another may open: a page that asks again and again opens one tab, not a hundred.
const GAP: Duration = Duration::from_millis(1500);

/// What to do with a window a page asked for.
#[derive(Debug, PartialEq, Eq)]
pub enum Popup {
    /// Open this address in the system's browser.
    Browser(String),
    /// Open nothing.
    Refuse,
}

/// What a request for a window of `address` comes to: a web address with a host and no name and password is the browser's. The names
/// the app serves its own pages and files under on Windows (`tauri.localhost`, `asset.localhost` and the like) are not on the web.
pub fn route(address: &Url) -> Popup {
    let web = matches!(address.scheme(), "http" | "https")
        && address
            .host_str()
            .is_some_and(|host| !host.ends_with(".localhost"))
        && address.username().is_empty()
        && address.password().is_none();
    if web {
        Popup::Browser(address.to_string())
    } else {
        Popup::Refuse
    }
}

/// Lets a popup through at most once in `GAP`.
#[derive(Default)]
struct Throttle(Mutex<Option<Instant>>);

impl Throttle {
    fn allow(&self, now: Instant) -> bool {
        let mut last = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if last.is_some_and(|before| now.saturating_duration_since(before) < GAP) {
            return false;
        }
        *last = Some(now);
        true
    }
}

/// Opens `address` in the system's browser unless a popup was opened a moment ago.
fn open(throttle: &Throttle, address: &Url) {
    if let Popup::Browser(web) = route(address)
        && throttle.allow(Instant::now())
    {
        // A page that cannot be handed on is not a reason to stop: the window it asked for was refused all the same.
        let _ = crate::web::open_url(web);
    }
}

/// Makes the main window from its entry in the configuration, with the handler for the windows a page asks for.
pub fn build_main(app: &App) -> tauri::Result<()> {
    let Some(config) = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == MAIN)
        .cloned()
    else {
        return Ok(());
    };
    let throttle = std::sync::Arc::new(Throttle::default());
    WebviewWindowBuilder::from_config(app.handle(), &config)?
        .on_new_window(move |address, _features| {
            open(&throttle, &address);
            NewWindowResponse::Deny
        })
        .build()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(text: &str) -> Url {
        Url::parse(text).unwrap()
    }

    #[test]
    fn a_web_address_goes_to_the_browser_and_nothing_else_is_opened() {
        assert_eq!(
            route(&url("https://www.youtube.com/watch?v=dQw4w9WgXcQ")),
            Popup::Browser("https://www.youtube.com/watch?v=dQw4w9WgXcQ".into())
        );
        assert_eq!(
            route(&url("http://example.com/a b")),
            Popup::Browser("http://example.com/a%20b".into())
        );
        for refused in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,hi",
            "about:blank",
            "blob:https://example.com/x",
            "tauri://localhost/",
            "http://tauri.localhost/index.html",
            "http://asset.localhost/x.png",
            "http://smart.localhost/index.html",
            "diagrams://localhost/",
            "mailto:a@b.example",
            "https://user:pw@example.com/",
            "ftp://example.com/",
        ] {
            assert_eq!(route(&url(refused)), Popup::Refuse, "{refused}");
        }
        // A page on this computer that is not the app's own is a web page like any other.
        assert!(matches!(
            route(&url("http://localhost:3000/demo")),
            Popup::Browser(_)
        ));
    }

    #[test]
    fn a_page_that_asks_again_and_again_opens_one_tab_in_a_while() {
        let throttle = Throttle::default();
        let start = Instant::now();
        assert!(throttle.allow(start));
        assert!(!throttle.allow(start));
        assert!(!throttle.allow(start + Duration::from_millis(1499)));
        assert!(throttle.allow(start + GAP));
        assert!(!throttle.allow(start + GAP + Duration::from_millis(10)));
    }
}
