//! The windows show Kasten and nothing else, and each calls only what it
//! needs. Web links open in the system's browser through `open_url`; a
//! navigation that would take a window itself elsewhere, such as a link
//! the app did not catch, is refused, so no page can ever stand in for
//! Kasten's own. The quick capture window can call only the commands
//! capturing needs, the presenter's window only the two that pass a
//! message on and close it, and a window of any other name, none.
//!
//! One exception to "own pages only": a frame is a navigation too, and the
//! window cannot tell one from the window's own. While a deck is being
//! presented, the pages it embeds may load in their frames: the origins the
//! presenting window named (`allow_embeds`), and no others.
//!
//! The browser tab's webviews (`web-*`) are the opposite case: the open web.
//! They call no command at all, and go only where the browser's policy
//! allows, never to one of Kasten's own pages.

use std::collections::HashSet;
use std::sync::Mutex;

use tauri::ipc::Invoke;
use tauri::plugin::TauriPlugin;
use tauri::{Manager, Runtime, State, Url};

use crate::capture::CAPTURE;
use crate::closing::MAIN;
use crate::presenter::PRESENTER;

/// The port `tauri dev` serves the window from (tauri.conf.json's devUrl).
const DEV_PORT: u16 = 1420;

/// What the quick capture window needs: the places to offer, today's
/// journal, saving, room for its place picker, and, for a web address
/// pasted into it, the page's article (`clip_url`) or its title (`web_title`).
const CAPTURE_COMMANDS: &[&str] = &[
    "list_notes",
    "journal_day",
    "append_note",
    "capture_note",
    "capture_hide",
    "capture_done",
    "capture_resize",
    "clip_url",
    "web_title",
];

/// What the presenter's window needs: to pass a message to the window that presents, and to close itself.
const PRESENTER_COMMANDS: &[&str] = &["presenter_post", "presenter_close"];

/// The most embedded origins one presentation may name.
const MAX_EMBEDS: usize = 64;

/// The origins of the pages the deck now being presented embeds, as `scheme://host:port`.
#[derive(Default)]
pub struct Embeds(Mutex<HashSet<String>>);

/// The origin of a web address, `scheme://host:port` with the port always written; None for anything but `http` and `https`
/// without a name and password.
pub fn origin_of(url: &Url) -> Option<String> {
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    Some(format!(
        "{}://{}:{}",
        url.scheme(),
        url.host_str()?,
        url.port_or_known_default()?
    ))
}

impl Embeds {
    /// Takes the addresses of the embedded pages of a presentation in place of the last ones; the ones that are not web addresses are
    /// left out. Returns how many origins are now allowed.
    pub fn set(&self, addresses: &[String]) -> usize {
        let origins: HashSet<String> = addresses
            .iter()
            .filter_map(|text| Url::parse(text).ok())
            .filter_map(|url| origin_of(&url))
            .take(MAX_EMBEDS)
            .collect();
        let mut held = self.0.lock().unwrap_or_else(|e| e.into_inner());
        *held = origins;
        held.len()
    }

    /// Whether the page at `url` is on an origin that is allowed.
    pub fn allows(&self, url: &Url) -> bool {
        origin_of(url).is_some_and(|origin| {
            self.0
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .contains(&origin)
        })
    }
}

/// The presenting window names the pages its deck embeds, or none when the presentation is over.
#[tauri::command]
pub fn allow_embeds(embeds: State<'_, Embeds>, urls: Vec<String>) -> usize {
    embeds.set(&urls)
}

/// Whether `url` is one of Kasten's own pages: the app's own origin as
/// this system serves it (`tauri://localhost`, or `http://tauri.localhost`
/// on Windows), with no port.
pub fn own_page(url: &Url) -> bool {
    own_page_on(url, cfg!(windows))
}

fn own_page_on(url: &Url, windows: bool) -> bool {
    let plain = url.port().is_none() && url.username().is_empty() && url.password().is_none();
    match url.scheme() {
        "tauri" => !windows && plain && url.host_str() == Some("localhost"),
        "http" => match url.host_str() {
            Some("tauri.localhost") => windows && plain,
            // `tauri dev` serves the window from Vite, on its port alone.
            Some("localhost" | "127.0.0.1") => {
                cfg!(debug_assertions) && url.port() == Some(DEV_PORT)
            }
            _ => false,
        },
        "about" => url.as_str() == "about:blank",
        _ => false,
    }
}

/// Whether `url` is a page of the optional diagram editor, which Kasten
/// serves from its own `diagrams` scheme (`diagrams://localhost/…`, or
/// `http://diagrams.localhost/…` where a web view knows only http and https).
/// It is not one of Kasten's own pages: a webview showing it can call no
/// command, and no capability names it.
fn diagrams_page_on(url: &Url, windows: bool) -> bool {
    let plain = url.port().is_none() && url.username().is_empty() && url.password().is_none();
    match url.scheme() {
        "diagrams" => !windows && plain && url.host_str() == Some("localhost"),
        "http" => windows && plain && url.host_str() == Some("diagrams.localhost"),
        _ => false,
    }
}

/// Whether the window named `window` may call `command`.
pub fn may_call(window: &str, command: &str) -> bool {
    match window {
        MAIN => true,
        CAPTURE => CAPTURE_COMMANDS.contains(&command),
        PRESENTER => PRESENTER_COMMANDS.contains(&command),
        _ => false,
    }
}

pub(crate) fn may_navigate(window: &str, url: &Url, embeds: Option<&Embeds>) -> bool {
    // A browser tab's webview is the open web: it goes where the browser's
    // policy says (never to Kasten's own pages, which `own_page` would allow).
    if crate::browser::policy::id_of(window).is_some() {
        return crate::browser::policy::may_visit(url);
    }
    // A frame is a navigation, and the window cannot tell one from its own:
    // the diagram editor's pages may load, in the main window only. Nothing
    // that shows one is a page of Kasten's, so it can call no command.
    own_page(url)
        || (window == MAIN
            && (diagrams_page_on(url, cfg!(windows))
                || embeds.is_some_and(|embeds| embeds.allows(url))))
}

/// The app's commands, each answered only for a window that may call it.
pub fn commands<R: Runtime>(
    handler: impl Fn(Invoke<R>) -> bool + Send + Sync + 'static,
) -> impl Fn(Invoke<R>) -> bool + Send + Sync + 'static {
    move |invoke| {
        let window = invoke.message.webview_ref().label().to_owned();
        let command = invoke.message.command().to_owned();
        let local = invoke
            .message
            .webview_ref()
            .url()
            .is_ok_and(|url| own_page(&url) && url.scheme() != "about");
        if !local || !may_call(&window, &command) {
            invoke
                .resolver
                .reject(format!("This window can't use {command}"));
            return true;
        }
        handler(invoke)
    }
}

/// Holds every window to Kasten's own pages.
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("kasten-guard")
        .on_navigation(|webview, url| {
            // A browser tab's capture answer is read and always cancelled.
            if crate::browser::answered(webview, url) {
                return false;
            }
            let embeds = webview.try_state::<Embeds>();
            may_navigate(webview.label(), url, embeds.as_deref())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_origins_never_extend_capture_or_presenter_navigation() {
        let embeds = Embeds::default();
        embeds.set(&["https://example.com/talk".into()]);
        let url = Url::parse("https://example.com/talk").unwrap();
        assert!(may_navigate(MAIN, &url, Some(&embeds)));
        for window in [CAPTURE, PRESENTER, "unknown"] {
            assert!(!may_navigate(window, &url, Some(&embeds)));
        }
    }

    #[test]
    fn no_capability_grants_remote_command_access() {
        for text in [
            include_str!("../capabilities/default.json"),
            include_str!("../capabilities/capture.json"),
            include_str!("../capabilities/presenter.json"),
        ] {
            let capability: serde_json::Value = serde_json::from_str(text).unwrap();
            assert!(capability.get("remote").is_none());
        }
    }

    #[test]
    fn stays_on_kastens_own_pages() {
        let url = |s: &str| Url::parse(s).unwrap();
        for (own, windows) in [
            ("tauri://localhost/", false),
            ("tauri://localhost/capture.html", false),
            ("http://tauri.localhost/index.html", true),
            ("about:blank", false),
            ("about:blank", true),
        ] {
            assert!(own_page_on(&url(own), windows), "{own}");
        }
        for (other, windows) in [
            ("https://example.com/", false),
            ("http://evil.example/tauri.localhost", true),
            ("file:///etc/passwd", false),
            ("javascript:alert(1)", false),
            ("data:text/html,hi", false),
            ("tauri://elsewhere/", false),
            ("http://localhost:8080/admin", false),
            ("http://127.0.0.1/", false),
            // Each system's own origin only, on no other port or scheme.
            ("tauri://localhost/", true),
            ("http://tauri.localhost/", false),
            ("https://tauri.localhost/", true),
            ("http://tauri.localhost:8080/", true),
            ("tauri://localhost:9000/", false),
            ("http://user@tauri.localhost/", true),
        ] {
            assert!(!own_page_on(&url(other), windows), "{other}");
        }
        // Tests build like `tauri dev`, which serves the window from Vite.
        assert!(own_page(&url("http://localhost:1420/")));
    }

    #[test]
    fn a_frame_may_load_the_page_a_deck_embeds_and_nothing_else() {
        let url = |s: &str| Url::parse(s).unwrap();
        let embeds = Embeds::default();
        assert_eq!(
            embeds.set(&[
                "http://127.0.0.1:8080/demo?x=1".into(),
                "https://example.com/talk".into(),
                "file:///etc/passwd".into(),
                "javascript:alert(1)".into(),
                "not a url".into(),
                "https://user:pass@evil.example/".into(),
            ]),
            2
        );
        // The same origin, on any path: a page that links to its own pages.
        for yes in [
            "http://127.0.0.1:8080/",
            "http://127.0.0.1:8080/deep/page.html#top",
            "https://example.com/",
            "https://example.com:443/other",
        ] {
            assert!(embeds.allows(&url(yes)), "{yes}");
        }
        for no in [
            "http://127.0.0.1:8081/",
            "http://127.0.0.1/",
            "https://example.com:8443/",
            "http://example.com/",
            "https://evil.example/",
            "file:///etc/passwd",
            "tauri://localhost/",
            "about:blank",
        ] {
            assert!(!embeds.allows(&url(no)), "{no}");
        }
        // Nothing once the presentation is over.
        embeds.set(&[]);
        assert!(!embeds.allows(&url("http://127.0.0.1:8080/")));
    }

    #[test]
    fn the_diagram_editors_frame_loads_in_the_main_window_and_gets_no_commands() {
        let url = |s: &str| Url::parse(s).unwrap();
        for (page, windows) in [
            ("diagrams://localhost/index.html?embed=1", false),
            ("diagrams://localhost/", false),
            (
                "http://diagrams.localhost/index.html?embed=1&proto=json",
                true,
            ),
        ] {
            assert!(diagrams_page_on(&url(page), windows), "{page}");
            // Never one of Kasten's own pages: a webview that shows it is refused every command.
            assert!(!own_page_on(&url(page), windows), "{page}");
        }
        for (page, windows) in [
            // The other system's form, other ports, hosts, schemes and names.
            ("diagrams://localhost/", true),
            ("http://diagrams.localhost/", false),
            ("https://diagrams.localhost/", true),
            ("http://diagrams.localhost:8080/", true),
            ("diagrams://localhost:9000/", false),
            ("diagrams://elsewhere/", false),
            ("http://user@diagrams.localhost/", true),
            ("http://evil.example/diagrams.localhost", true),
            ("http://diagrams.localhost.evil.example/", true),
            ("tauri://diagrams.localhost/", false),
        ] {
            assert!(!diagrams_page_on(&url(page), windows), "{page}");
        }
        // The main window's frame may load it; no other window may.
        let page = if cfg!(windows) {
            url("http://diagrams.localhost/index.html")
        } else {
            url("diagrams://localhost/index.html")
        };
        assert!(may_navigate(MAIN, &page, None));
        for window in [CAPTURE, PRESENTER, "unknown", "diagrams"] {
            assert!(!may_navigate(window, &page, None), "{window}");
        }
    }

    #[test]
    fn a_window_of_the_diagram_editors_name_calls_nothing() {
        // The frame has no window of its own; were it to be given one under
        // this name or any other that is not the main window's, every
        // command is refused, the editor's own and the vault's alike.
        for command in [
            "list_notes",
            "read_note",
            "save_note_body",
            "save_diagram",
            "read_diagram",
            "diagram_editor_install",
            "diagram_editor_remove",
            "empty_trash",
            "open_url",
        ] {
            for window in ["diagrams", "diagram-editor", "frame", "drawio"] {
                assert!(!may_call(window, command), "{window} {command}");
            }
            assert!(!may_call("capture", command) || CAPTURE_COMMANDS.contains(&command));
            assert!(!may_call("presenter", command));
        }
        assert!(may_call("main", "save_diagram"));
        assert!(may_call("main", "diagram_editor_install"));
    }

    #[test]
    fn the_presenters_window_only_passes_messages_and_closes() {
        for command in PRESENTER_COMMANDS {
            assert!(may_call("presenter", command), "{command}");
        }
        for command in [
            "empty_trash",
            "read_note",
            "allow_embeds",
            "open_presenter",
            "capture_done",
        ] {
            assert!(!may_call("presenter", command), "{command}");
        }
        assert!(may_call("main", "open_presenter"));
        assert!(may_call("main", "allow_embeds"));
        assert!(!may_call("capture", "open_presenter"));
    }

    #[test]
    fn the_capture_window_calls_only_what_capturing_needs() {
        assert!(may_call("main", "empty_trash"));
        assert!(may_call("main", "list_notes"));
        for command in CAPTURE_COMMANDS {
            assert!(may_call("capture", command), "{command}");
        }
        for command in [
            "empty_trash",
            "read_note",
            "push_now",
            "chat_send",
            "open_vault",
        ] {
            assert!(!may_call("capture", command), "{command}");
        }
        assert!(!may_call("somewhere-else", "list_notes"));
    }
}
