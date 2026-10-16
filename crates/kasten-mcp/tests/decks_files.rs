//! The deck tools that bring files in and out of the vault: pictures kept in
//! `assets/` and placed on slides, and PowerPoint files written out and read
//! back in as a new deck.

mod common;

use std::fs;
use std::path::Path;

use common::{TempDir, deck_of_eight, slide_ids, vault};
use kasten_core::agent::Session;
use kasten_core::{Instant, Kasten};
use kasten_mcp::tools::call;
use serde_json::json;

fn open() -> (TempDir, Kasten, Session) {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    let s = Session::start("kasten-chat", Instant::now());
    (v, k, s)
}

#[test]
fn a_picture_is_kept_with_the_session_as_its_source_and_placed_on_a_slide() {
    let (_v, k, s) = open();
    let (path, ids) = deck_of_eight(&k, &s);
    let png =
        fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/assets/wide.png"))
            .unwrap();
    let bytes = slides_core::agent::base64_encode(&png);
    let added = call(
        &k,
        &s,
        "add_asset",
        json!({"name": "wide.png", "base64": bytes}),
    )
    .unwrap();
    assert_eq!(added["status"], json!("done"), "{added}");
    let stored = added["result"]["path"].as_str().unwrap().to_owned();
    assert_eq!(stored, "assets/wide.png");
    let info = k.asset(&stored).unwrap();
    assert_eq!(info.source.as_deref(), Some("agent"));
    assert_eq!(info.created_by, Some(format!("agent:{}", s.id)));
    let found = call(&k, &s, "search_assets", json!({"query": "wide"})).unwrap();
    assert_eq!(found["assets"][0]["path"], json!(stored));
    let placed = call(
        &k,
        &s,
        "place_image",
        json!({"deck": path, "slide": ids[1], "src": stored, "auto": true, "alt": "A wide picture"}),
    )
    .unwrap();
    assert_eq!(placed["status"], json!("done"), "{placed}");
    let slide = call(&k, &s, "get_slide", json!({"deck": path, "slide": ids[1]})).unwrap();
    assert!(
        slide["slide"].to_string().contains("assets/wide.png"),
        "{slide}"
    );
    // The same picture again is the same asset.
    let again = call(
        &k,
        &s,
        "add_asset",
        json!({"name": "other-name.png", "base64": bytes}),
    )
    .unwrap();
    assert_eq!(again["result"]["path"], json!(stored));
}

#[test]
fn an_svg_picture_is_cleaned_before_it_is_kept_and_a_file_that_is_not_one_is_refused() {
    let (v, k, s) = open();
    let dirty = r#"<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><rect width="10" height="10" onclick="steal()"/></svg>"#;
    let added = call(
        &k,
        &s,
        "add_asset",
        json!({"name": "mark.svg", "base64": slides_core::agent::base64_encode(dirty.as_bytes())}),
    )
    .unwrap();
    assert_eq!(added["status"], json!("done"), "{added}");
    let stored = fs::read_to_string(v.0.join(added["result"]["path"].as_str().unwrap())).unwrap();
    assert!(
        !stored.contains("script") && !stored.contains("onclick") && !stored.contains("steal"),
        "{stored}"
    );
    assert!(
        stored.contains("<rect"),
        "the drawing itself is kept: {stored}"
    );

    // A page with a drawing inside looks like an SVG to the tool's first check, but its root
    // is not `svg`: the cleaning refuses it.
    let fake = slides_core::agent::base64_encode(
        b"<html><body><svg width=\"1\" height=\"1\"></svg></body></html>",
    );
    let err = call(
        &k,
        &s,
        "add_asset",
        json!({"name": "fake.svg", "base64": fake}),
    )
    .unwrap_err();
    assert!(err.contains("not an SVG"), "{err}");
    assert!(!v.0.join("assets/fake.svg").exists());
    // Words with no drawing in them never get that far.
    let words = slides_core::agent::base64_encode(b"just some words");
    let err = call(
        &k,
        &s,
        "add_asset",
        json!({"name": "words.svg", "base64": words}),
    )
    .unwrap_err();
    assert!(err.contains("not a picture"), "{err}");

    // Other pictures are kept as they are.
    let png =
        fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/assets/wide.png"))
            .unwrap();
    let kept = call(
        &k,
        &s,
        "add_asset",
        json!({"name": "wide.png", "base64": slides_core::agent::base64_encode(&png)}),
    )
    .unwrap();
    assert_eq!(kept["status"], json!("done"), "{kept}");
}

#[test]
fn a_deck_is_exported_as_powerpoint_into_assets_and_read_back_in_as_a_new_deck() {
    let (v, k, s) = open();
    let (path, _) = deck_of_eight(&k, &s);
    let out = call(&k, &s, "export", json!({"deck": path, "format": "pptx"})).unwrap();
    assert_eq!(out["status"], json!("done"), "{out}");
    assert_eq!(out["result"]["path"], json!("assets/tool-use.pptx"));
    assert_eq!(out["result"]["slides"], json!(7));
    let bytes = fs::read(v.0.join("assets/tool-use.pptx")).unwrap();
    assert_eq!(&bytes[..2], b"PK", "a PowerPoint file is a zip");
    let last = &k.log(None, 1).unwrap()[0];
    assert_eq!(last.author, "agent:kasten-chat");
    assert_eq!(last.session.as_deref(), Some(s.id.as_str()));
    // The same deck again is the same file: nothing is written over or twice.
    let again = call(&k, &s, "export", json!({"deck": path})).unwrap();
    assert_eq!(again["result"]["path"], json!("assets/tool-use.pptx"));

    // A Markdown outline is not a file in a vault, where it would show up as a note.
    let err = call(
        &k,
        &s,
        "export",
        json!({"deck": path, "format": "markdown"}),
    )
    .unwrap_err();
    assert!(err.contains("get_outline"), "{err}");
    assert!(!v.0.join("assets/tool-use.md").exists());

    // The file comes back in as a new deck, in a project, with the picture files it holds kept in assets/.
    let imported = call(
        &k,
        &s,
        "import_pptx",
        json!({"path": "assets/tool-use.pptx", "title": "Tool use again", "project": "photo-organiser"}),
    )
    .unwrap();
    assert_eq!(imported["status"], json!("done"), "{imported}");
    let deck = imported["result"]["deck"].as_str().unwrap().to_owned();
    assert_eq!(deck, "projects/photo-organiser/decks/tool-use-again.deck");
    assert_eq!(slide_ids(&k, &s, &deck).len(), 7);
    let last = &k.log(Some(&deck), 1).unwrap()[0];
    assert_eq!(last.op.as_deref(), Some("import_pptx"));
    assert_eq!(last.summary, "deck: import Tool use again");
    // Only a picture or a PowerPoint file of the vault can be named.
    let refused = call(
        &k,
        &s,
        "import_pptx",
        json!({"path": "library/welcome-to-kasten.md"}),
    )
    .unwrap_err();
    assert!(refused.contains("PowerPoint"), "{refused}");
    let missing = call(&k, &s, "import_pptx", json!({"path": "assets/none.pptx"})).unwrap_err();
    assert!(missing.contains("no file"), "{missing}");
    let outside = call(&k, &s, "import_pptx", json!({"path": "../secret.pptx"})).unwrap_err();
    assert!(outside.contains("not a path inside the vault"), "{outside}");
}
