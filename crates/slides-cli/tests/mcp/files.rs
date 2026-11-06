//! What happens beyond the deck: what is kept, pictures, exports and imports, drawing, refusals.

use std::fs;

use crate::client::{Client, OUTLINE, PNG, folder, names_in};
use serde_json::json;
use slides_core::agent::base64_encode;
use slides_core::canonical;

#[test]
fn nothing_is_deleted_a_deck_and_removed_slides_are_kept() {
    let dir = folder("kept");
    let mut client = Client::start(&dir);
    let made = client.ok("create_deck", json!({ "outline": OUTLINE }));
    let name = made["deck"].as_str().unwrap().to_owned();
    let second_slide = made["slides"][1]["id"].as_str().unwrap().to_owned();
    let before = fs::read_to_string(dir.join(&name)).unwrap();

    client.ok(
        "delete_slides",
        json!({ "deck": name, "ids": [second_slide] }),
    );
    let kept = names_in(&dir.join(".trash"));
    assert_eq!(kept.len(), 1, "{kept:?}");
    assert!(kept[0].contains("delete_slides"), "{kept:?}");
    let copy = fs::read_to_string(dir.join(".trash").join(&kept[0])).unwrap();
    assert_eq!(copy, before, "the copy is the deck as it was");
    let after = fs::read_to_string(dir.join(&name)).unwrap();
    assert_eq!(canonical::parse(&after).unwrap().slides.len(), 2);

    let trashed = client.ok("trash_deck", json!({ "deck": name }));
    let place = trashed["trashedTo"].as_str().unwrap();
    assert!(place.starts_with(".trash/"));
    assert!(!dir.join(&name).exists());
    assert_eq!(fs::read_to_string(dir.join(place)).unwrap(), after);
}

#[test]
fn pictures_come_by_bytes_or_by_a_path_inside_the_folder_and_only_there() {
    let dir = folder("pictures");
    // A second, different picture: the first one with a byte more after its end.
    let other: Vec<u8> = [PNG, &[0]].concat();
    fs::write(dir.join("secret.png"), &other).unwrap();
    let outside = folder("pictures-outside");
    fs::write(outside.join("elsewhere.png"), PNG).unwrap();
    let mut client = Client::start(&dir);

    let by_bytes = client.ok(
        "add_asset",
        json!({ "name": "figure.png", "base64": base64_encode(PNG) }),
    );
    assert_eq!(
        (by_bytes["path"].as_str(), by_bytes["width"].as_u64()),
        (Some("assets/figure.png"), Some(3))
    );
    let by_path = client.ok("add_asset", json!({ "path": "secret.png" }));
    assert_eq!(by_path["path"], "assets/secret.png");
    let again = client.ok(
        "add_asset",
        json!({ "name": "renamed.png", "base64": base64_encode(PNG) }),
    );
    assert_eq!(
        again["path"], "assets/figure.png",
        "the same bytes are the same picture, whatever the name they come with"
    );

    for bad in [
        "../elsewhere.png",
        "/etc/hostname",
        &outside.join("elsewhere.png").to_string_lossy(),
    ] {
        let why = client.refused("add_asset", json!({ "path": bad }));
        assert!(
            why.contains("inside the folder") || why.contains("no file"),
            "{bad}: {why}"
        );
    }
    assert!(
        client
            .refused(
                "add_asset",
                json!({ "name": "x.png", "base64": "not base64!" })
            )
            .contains("base64")
    );

    let found = client.ok("search_assets", json!({}));
    assert_eq!(found["assets"].as_array().unwrap().len(), 2, "{found}");
}

#[test]
fn a_deck_is_exported_to_a_new_file_and_read_back_from_it() {
    let dir = folder("export");
    let mut client = Client::start(&dir);
    let name = client.ok("create_deck", json!({ "outline": OUTLINE }))["deck"]
        .as_str()
        .unwrap()
        .to_owned();

    let first = client.ok("export", json!({ "deck": name, "format": "pptx" }));
    assert_eq!(first["path"], "tool-use.pptx");
    let bytes = fs::read(dir.join("tool-use.pptx")).unwrap();
    assert_eq!(&bytes[..2], b"PK");
    let same = client.ok("export", json!({ "deck": name, "format": "pptx" }));
    assert_eq!(
        same["path"], "tool-use.pptx",
        "an unchanged deck exports to the same file"
    );

    client.ok(
        "set_notes",
        json!({ "deck": name, "slide": 2, "notes": "Changed" }),
    );
    let later = client.ok("export", json!({ "deck": name, "format": "pptx" }));
    assert_eq!(
        later["path"], "tool-use 2.pptx",
        "a file that is there is not written over"
    );
    assert_eq!(fs::read(dir.join("tool-use.pptx")).unwrap(), bytes);

    let markdown = client.ok("export", json!({ "deck": name, "format": "markdown" }));
    assert!(
        markdown["outline"]
            .as_str()
            .unwrap()
            .contains("## Why tools?")
    );
    assert!(
        client
            .refused("export", json!({ "deck": name, "format": "pdf" }))
            .contains("not available")
    );

    let imported = client.ok(
        "import_pptx",
        json!({ "path": "tool-use 2.pptx", "title": "Back again" }),
    );
    assert_eq!(imported["deck"], "back-again.deck");
    let back = canonical::parse(&fs::read_to_string(dir.join("back-again.deck")).unwrap()).unwrap();
    assert_eq!(back.slides.len(), 3);
    assert_eq!(back.slides[1].notes, "Changed");
    assert!(
        client
            .refused("import_pptx", json!({ "path": "../x.pptx" }))
            .contains("inside the folder")
    );
}

#[test]
fn a_refused_call_is_an_error_the_agent_can_read_and_the_server_carries_on() {
    let dir = folder("errors");
    let mut client = Client::start(&dir);
    let name = client.ok("create_deck", json!({ "outline": OUTLINE }))["deck"]
        .as_str()
        .unwrap()
        .to_owned();

    assert!(
        client
            .refused("no_such_tool", json!({}))
            .contains("The tools are: slides_help, list_decks")
    );
    assert!(
        client
            .refused("get_deck", json!({ "deck": "missing" }))
            .contains("list_decks")
    );
    assert!(
        client
            .refused("get_deck", json!({ "deck": "../outside.deck" }))
            .contains("not a")
    );
    assert!(
        client
            .refused("add_slide", json!({ "deck": name, "layout": 5 }))
            .contains("add_slide")
    );
    let layout = client.refused("add_slide", json!({ "deck": name, "layout": "nope" }));
    assert!(layout.contains("title-body"), "{layout}");
    let nowhere = client.refused("render_slide", json!({ "deck": name, "slide": 99 }));
    assert!(nowhere.contains("99"), "{nowhere}");

    // None of it changed anything, and a call after all of it works.
    assert_eq!(names_in(&dir), std::slice::from_ref(&name));
    assert_eq!(
        client.ok("get_slide", json!({ "deck": name, "slide": 1 }))["slide"]["layout"],
        "title"
    );
}

/// Whether there is a browser, and the page to draw with, to draw slides with.
fn can_draw() -> bool {
    slides_render::find_browser().is_ok() && slides_render::bundle::Page::locate().is_some()
}

#[test]
fn a_slide_is_drawn_for_the_agent_to_look_at_where_there_is_a_browser_and_refused_in_words_where_there_is_none()
 {
    let dir = folder("draw");
    let mut client = Client::start(&dir);
    let name = client.ok("create_deck", json!({ "outline": OUTLINE }))["deck"]
        .as_str()
        .unwrap()
        .to_owned();
    let slide = client.call("render_slide", json!({ "deck": name, "slide": 2 }));
    if !can_draw() {
        assert!(
            slide.is_error && slide.text.contains("lint_deck"),
            "{}",
            slide.text
        );
        return;
    }
    assert!(!slide.is_error, "{}", slide.text);
    assert_eq!(slide.images, ["image/png"]);
    let info = slide.json();
    assert_eq!(
        (info["width"].as_u64(), info["height"].as_u64()),
        (Some(960), Some(540))
    );
    let grid = client.call("render_grid", json!({ "deck": name }));
    assert_eq!(grid.images, ["image/png"], "{}", grid.text);
    let past = client.refused(
        "render_slide",
        json!({ "deck": name, "slide": 2, "step": 9 }),
    );
    assert!(past.contains("step"), "{past}");
    // With a browser the text is measured in it, not estimated.
    let lint = client.call("lint_deck", json!({ "deck": name }));
    assert!(lint.text.contains("measured in a browser"), "{}", lint.text);
}

#[cfg(unix)]
#[test]
fn a_server_told_to_stop_stops_and_so_does_not_leave_its_browser_behind() {
    let dir = folder("stop");
    let mut client = Client::start(&dir);
    client.ok("list_decks", json!({}));
    let pid = client.pid().to_string();
    let told = std::process::Command::new("kill")
        .args(["-TERM", &pid])
        .status()
        .unwrap();
    assert!(told.success());
    let left = client.wait_for_exit(std::time::Duration::from_secs(15));
    assert!(left.is_some_and(|status| status.success()), "{left:?}");
}

/// Whether the program has a handler for SIGTERM. Linux says which signals a process catches.
#[cfg(target_os = "linux")]
fn listens_for_term(pid: u32) -> bool {
    std::fs::read_to_string(format!("/proc/{pid}/status"))
        .unwrap_or_default()
        .lines()
        .find_map(|line| line.strip_prefix("SigCgt:"))
        .and_then(|mask| u64::from_str_radix(mask.trim(), 16).ok())
        // SIGTERM is signal 15, which is bit 14.
        .is_some_and(|mask| mask & (1 << 14) != 0)
}

#[cfg(target_os = "linux")]
#[test]
fn a_server_listens_for_the_signal_to_stop_from_the_moment_it_starts_before_any_client_has_spoken()
{
    use std::process::Stdio;
    use std::time::{Duration, Instant};

    let dir = folder("stop-first");
    let mut child = std::process::Command::new(env!("CARGO_BIN_EXE_slides"))
        .args(["mcp", "--folder", dir.to_str().unwrap()])
        // Held open, and never written to: no client has said a word.
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("slides mcp starts");
    let until = Instant::now() + Duration::from_secs(15);
    while !listens_for_term(child.id()) {
        assert!(
            Instant::now() < until,
            "the server did not begin to listen for SIGTERM"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    // Asked to stop now, before it has been spoken to, it goes quietly and is not killed by the signal.
    let told = std::process::Command::new("kill")
        .args(["-TERM", &child.id().to_string()])
        .status()
        .unwrap();
    assert!(told.success());
    let left = loop {
        if let Some(status) = child.try_wait().unwrap() {
            break Some(status);
        }
        if Instant::now() >= until + Duration::from_secs(15) {
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    assert!(left.is_some_and(|status| status.success()), "{left:?}");
}
