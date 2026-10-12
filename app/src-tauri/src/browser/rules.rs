//! The rules that keep a page in the browser tab away from Kasten, as
//! tables: what its webview may call, where it may go, what capabilities
//! name, and what the app tells whom. Tests only.

use tauri::Url;

use crate::guard::{Embeds, may_call, may_navigate};

const COMMANDS: &[&str] = &[
    "browser_open",
    "browser_bounds",
    "browser_hide",
    "browser_show",
    "browser_close",
    "browser_nav",
    "browser_capture",
    "browser_capture_confirm",
    "browser_capture_discard",
    "browser_enabled",
    "set_browser_enabled",
    "browser_clear_data",
];

fn url(text: &str) -> Url {
    Url::parse(text).unwrap()
}

#[test]
fn a_browser_webview_calls_nothing_and_no_other_window_calls_the_browser() {
    for window in ["web-t1abc", "web-1", "web-x_y-Z"] {
        for command in COMMANDS.iter().chain(&[
            "list_notes",
            "read_note",
            "save_note_body",
            "empty_trash",
            "open_url",
            "clip_url",
            "web_title",
            "chat_send",
            "allow_embeds",
        ]) {
            assert!(!may_call(window, command), "{window} {command}");
        }
    }
    for command in COMMANDS {
        assert!(may_call("main", command), "{command}");
        assert!(!may_call("capture", command), "{command}");
        assert!(!may_call("presenter", command), "{command}");
    }
}

#[test]
fn a_browser_webview_goes_where_the_policy_says_and_the_main_window_still_goes_nowhere() {
    let embeds = Embeds::default();
    for window in ["web-t1abc", "web-9"] {
        for ok in [
            "https://example.com/a",
            "http://localhost:3000/",
            "about:blank",
        ] {
            assert!(
                may_navigate(window, &url(ok), Some(&embeds)),
                "{window} {ok}"
            );
        }
        for bad in [
            // Kasten's own pages, as each system serves them.
            "http://tauri.localhost/index.html",
            "tauri://localhost/",
            "http://localhost:1420/",
            "http://ipc.localhost/",
            "http://asset.localhost/x",
            "http://diagrams.localhost/index.html",
            "diagrams://localhost/index.html",
            "file:///C:/Windows/win.ini",
            "data:text/html,hi",
            "javascript:alert(1)",
            "https://user:pw@example.com/",
        ] {
            if bad.contains(":1420") && !cfg!(debug_assertions) {
                continue;
            }
            assert!(
                !may_navigate(window, &url(bad), Some(&embeds)),
                "{window} {bad}"
            );
        }
    }
    // Not a browser label: the old rules, which never allowed the open web.
    assert!(!may_navigate("main", &url("https://example.com/"), None));
    assert!(!may_navigate("web", &url("https://example.com/"), None));
    assert!(!may_navigate(
        "webview-1",
        &url("https://example.com/"),
        None
    ));
    assert!(may_navigate("main", &url("about:blank"), None));
}

#[test]
fn the_main_capability_names_its_webview_and_no_capability_reaches_a_browser_webview() {
    let default: serde_json::Value =
        serde_json::from_str(include_str!("../../capabilities/default.json")).unwrap();
    // `windows: ["main"]` would reach every webview added to the window.
    assert!(
        default.get("windows").is_none(),
        "a capability that names the window reaches the browser's webviews"
    );
    assert_eq!(default["webviews"], serde_json::json!(["main"]));
    for text in [
        include_str!("../../capabilities/default.json"),
        include_str!("../../capabilities/capture.json"),
        include_str!("../../capabilities/presenter.json"),
    ] {
        let capability: serde_json::Value = serde_json::from_str(text).unwrap();
        assert!(capability.get("remote").is_none());
        assert!(
            !text.contains("web-"),
            "no capability names a browser webview"
        );
        for key in ["windows", "webviews"] {
            for label in capability
                .get(key)
                .and_then(|l| l.as_array())
                .into_iter()
                .flatten()
            {
                let label = label.as_str().unwrap();
                assert!(!label.contains('*') && !label.starts_with("web"), "{label}");
            }
        }
    }
    let tauri: serde_json::Value =
        serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
    assert!(
        tauri["app"]["security"].get("capabilities").is_none(),
        "capabilities are every file in the folder: a new one is checked above"
    );
}

#[test]
fn what_the_app_tells_is_told_to_the_main_window_alone() {
    // Events for the app's own view of the vault, the chat and the search by
    // meaning go to `main` only; a plain broadcast would also reach any
    // other webview in the process.
    for (name, text) in [
        ("runtime", include_str!("../runtime.rs")),
        ("backup", include_str!("../backup/mod.rs")),
        ("chat", include_str!("../chat/commands.rs")),
        ("meaning", include_str!("../meaning/mod.rs")),
        ("tray", include_str!("../tray.rs")),
        ("write", include_str!("../chat/write.rs")),
    ] {
        assert!(!text.contains(".emit("), "{name} broadcasts an event");
    }
    let write = include_str!("../chat/write.rs");
    assert!(
        write.contains("emit_to(") && !write.contains("Channel"),
        "an answer's text is not on an IPC channel"
    );
}
