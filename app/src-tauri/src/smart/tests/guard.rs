//! A smart page's frame can call no Tauri command, load only the `smart`
//! scheme, and name nothing in any capability.

use tauri::Url;

use crate::guard::{may_call, may_navigate, own_page};

use crate::smart::guard::{smart_page, smart_page_on};

/// Every command the window uses for smart pages.
const COMMANDS: &[&str] = &[
    "smart_call",
    "smart_page_info",
    "smart_report",
    "smart_errors",
    "smart_clear_errors",
    "smart_web_images",
    "smart_set_web_images",
    "smart_frame_open",
    "smart_frame_close",
    "smart_trust",
    "smart_allow_run",
    "smart_run_enabled",
    "smart_set_run_enabled",
    "smart_project_settings",
    "smart_set_project_setting",
    "smart_history",
    "smart_restore_version",
];

/// Every command the window uses to make and edit smart pages by hand
/// (`smart/author.rs`). A page's frame, the capture window and the presenter
/// are refused all of them, like every other command.
const AUTHOR_COMMANDS: &[&str] = &[
    "smart_starters",
    "smart_new_page",
    "smart_turn_into",
    "smart_save_template",
    "smart_files",
    "smart_file_read",
    "smart_file_write",
    "smart_file_delete",
    "smart_kit_files",
];

fn url(text: &str) -> Url {
    Url::parse(text).unwrap()
}

#[test]
fn the_frames_pages_load_in_the_main_window_only_and_are_never_kastens_own() {
    for (page, windows) in [
        ("smart://localhost/01ABC/index.html", false),
        ("smart://localhost/kit/1/kit.js", false),
        ("smart://localhost/", false),
        ("http://smart.localhost/01ABC/index.html", true),
        ("http://smart.localhost/kit/1/kit.js", true),
    ] {
        assert!(smart_page_on(&url(page), windows), "{page}");
        // Never one of Kasten's own pages: a webview that shows it is refused every command.
        assert!(!crate::guard::own_page(&url(page)), "{page}");
    }
    for (page, windows) in [
        // The other system's form, other ports, hosts, schemes and names.
        ("smart://localhost/x", true),
        ("http://smart.localhost/x", false),
        ("https://smart.localhost/x", true),
        ("http://smart.localhost:8080/x", true),
        ("smart://localhost:9000/x", false),
        ("smart://elsewhere/x", false),
        ("smart://kit/1/kit.js", false),
        ("http://user@smart.localhost/x", true),
        ("http://user:pw@smart.localhost/x", true),
        ("http://evil.example/smart.localhost", true),
        ("http://smart.localhost.evil.example/", true),
        ("http://notsmart.localhost/", true),
        ("tauri://smart.localhost/", false),
        ("diagrams://localhost/", false),
        ("file:///smart/", false),
    ] {
        assert!(!smart_page_on(&url(page), windows), "{page}");
    }
}

#[test]
fn a_frame_may_load_smart_pages_in_the_main_window_and_nothing_else_may_be_loaded() {
    let page = if cfg!(windows) {
        url("http://smart.localhost/01ABC/index.html")
    } else {
        url("smart://localhost/01ABC/index.html")
    };
    assert!(smart_page(&page));
    assert!(may_navigate("main", &page, None));
    for window in ["capture", "presenter", "unknown", "smart", "web-1"] {
        assert!(!may_navigate(window, &page, None), "{window}");
    }
    // A page's code that sends its frame (or the window) elsewhere finds the way shut.
    for away in [
        "https://example.com/",
        "http://example.com/",
        "http://127.0.0.1:1420/",
        "http://localhost:8080/admin",
        "file:///etc/passwd",
        "javascript:alert(1)",
        "data:text/html,<script>top.location=1</script>",
        "blob:null/1234",
        "ipc://localhost/read_note",
        "http://ipc.localhost/read_note",
        "asset://localhost/x",
        "http://asset.localhost/x",
        "http://smart.localhost:8080/x",
        "smart://localhost:80/x",
        "http://tauri.localhost.evil.example/",
    ] {
        assert!(
            !may_navigate("main", &url(away), None) || own_page(&url(away)),
            "{away}"
        );
    }
    // No embed allowance (a presenting deck's) reaches a smart page's frame either.
    let embeds = crate::guard::Embeds::default();
    embeds.set(&["https://example.com/talk".into()]);
    assert!(!may_navigate(
        "main",
        &url("https://evil.example/"),
        Some(&embeds)
    ));
}

#[test]
fn a_window_of_a_smart_pages_name_calls_nothing() {
    // The frame has no window of its own; were it to be given one under any
    // name but the main window's, every command is refused, the page's own
    // and the vault's alike.
    let others = [
        "read_note",
        "save_note_body",
        "empty_trash",
        "open_url",
        "chat_send",
        "set_agent_policy",
        "trust_session",
        "accept_proposal",
    ];
    for command in COMMANDS.iter().chain(AUTHOR_COMMANDS).chain(others.iter()) {
        for window in [
            "smart",
            "smart-frame",
            "frame",
            "smart:library/tracker.md",
            "01ABC",
            "kit",
        ] {
            assert!(!may_call(window, command), "{window} {command}");
        }
        assert!(!may_call("capture", command), "capture {command}");
        assert!(!may_call("presenter", command), "presenter {command}");
    }
    for command in COMMANDS.iter().chain(AUTHOR_COMMANDS) {
        assert!(may_call("main", command), "{command}");
    }
}

#[test]
fn every_command_for_smart_pages_is_registered_for_the_window() {
    let handlers = include_str!("../../handlers.rs");
    for command in COMMANDS {
        assert!(
            handlers.contains(&format!("smart::commands::{command}")),
            "{command} is not in the handlers"
        );
    }
}

#[test]
fn no_capability_names_the_scheme_or_a_remote_page() {
    let capabilities = [
        include_str!("../../../capabilities/default.json"),
        include_str!("../../../capabilities/capture.json"),
        include_str!("../../../capabilities/presenter.json"),
    ];
    for text in capabilities {
        let capability: serde_json::Value = serde_json::from_str(text).unwrap();
        assert!(capability.get("remote").is_none(), "{text}");
        // Capabilities name webviews by label; a frame is none, and the scheme is named nowhere.
        assert!(!text.contains("smart"), "{text}");
        assert!(!text.contains("smart.localhost"));
        assert!(capability.get("urls").is_none());
    }
    let default: serde_json::Value = serde_json::from_str(capabilities[0]).unwrap();
    assert_eq!(default["webviews"], serde_json::json!(["main"]));
    assert!(
        default.get("windows").is_none(),
        "a window label would cover every frame in it"
    );
}

#[test]
fn the_window_lets_a_frame_nest_only_the_scheme_and_no_script_reaches_the_ipc() {
    // The main page's own policy: frames only from the schemes the app serves, and the ipc
    // only for the page itself.
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../../../tauri.conf.json")).unwrap();
    let csp = &config["app"]["security"]["csp"];
    let frames = csp["frame-src"].as_str().unwrap();
    assert!(frames.contains("smart://localhost") && frames.contains("http://smart.localhost"));
    assert!(!frames.contains('*') && !frames.contains("ipc"));
    assert_eq!(csp["form-action"], "'none'");
    assert_eq!(csp["base-uri"], "'none'");
}
