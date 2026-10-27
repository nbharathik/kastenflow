//! Where a page's writes can and cannot land: not in the code folder of any
//! smart page (its own or another's), not in a hidden folder of the vault, and
//! no new note gets a hidden, odd or colliding path. A page that could change
//! its own code through a note write could change what it is allowed to do.

use std::fs;

use kasten_core::config_keys::AgentMode;
use kasten_core::smart::BridgeErrorCode;
use serde_json::{Value, json};

use super::bridge::{run, wire};
use super::{add_page, files, set_mode, smart};
use crate::smart::runtime::Runtime;

const ROADMAP: &str = "01M36N8AA0SQP0DY9C54T2DXA1";

fn note_with_id(id: &str) -> String {
    format!(
        "---\nid: {id}\ntitle: Inside\ntype: card\n---\nA note somebody put in a code folder.\n"
    )
}

#[test]
fn a_page_cannot_write_to_a_note_inside_a_smart_pages_code_folder() {
    let s = smart();
    let rt = Runtime::default();
    // A page of the vault with a code folder of its own, and a note a person left inside each folder.
    let (other_path, _) = add_page(s.k(), "Other", &files());
    let mut inside = Vec::new();
    for page in [&s.path, &other_path] {
        let dir = page.replace(".md", ".smart");
        let rel = format!("{dir}/notes.md");
        fs::write(
            s.vault.dir.join(&rel),
            note_with_id("01INSIDE0000000000000000A"),
        )
        .unwrap();
        inside.push(rel);
    }
    // The upper-case spelling of the folder is the same folder on some systems.
    let shouting = format!("{}/NOTES.md", other_path.replace(".md", ".SMART"));
    for target in inside.iter().map(String::as_str).chain([shouting.as_str()]) {
        let before = fs::read_to_string(s.vault.dir.join(target)).ok();
        // Where the file system tells the two spellings apart, the shouting one names nothing: not found is as safe as refused.
        let named = before.is_some();
        for call in [
            wire(
                "append",
                json!({ "id": target, "md": "<script>evil()</script>" }),
            ),
            wire(
                "update",
                json!({ "id": target, "props": { "status": "x" } }),
            ),
            wire("addTags", json!({ "id": target, "tags": ["x"] })),
            wire("toggleTodo", json!({ "id": target, "index": 0 })),
        ] {
            let kind = call.kind();
            let error = run(&s, &rt, &call).unwrap_err();
            let safe = error.code == BridgeErrorCode::Refused
                || (!named && error.code == BridgeErrorCode::NotFound);
            assert!(safe, "{kind} {target}: {:?}", error.code);
        }
        assert_eq!(
            fs::read_to_string(s.vault.dir.join(target)).ok(),
            before,
            "{target}"
        );
    }
    // Not by the page's own id or title either, once the vault knows the note.
    s.k().reindex().unwrap();
    for target in ["01INSIDE0000000000000000A", "Inside"] {
        let result = run(&s, &rt, &wire("append", json!({ "id": target, "md": "x" })));
        if let Ok(value) = &result {
            // Several notes may be called that, and then nothing is done at all; never a write.
            panic!("a write inside a code folder went through: {value}");
        }
    }
    for rel in &inside {
        let text = fs::read_to_string(s.vault.dir.join(rel)).unwrap();
        assert!(!text.contains("evil"), "{rel}");
    }
    // The same call on a note outside any folder goes through.
    let out = run(
        &s,
        &rt,
        &wire("append", json!({ "id": ROADMAP, "md": "\nfine\n" })),
    )
    .unwrap();
    assert_eq!(out["status"], "done", "{out}");
}

#[test]
fn a_page_cannot_name_a_file_of_any_code_folder_or_a_hidden_folder_as_a_note() {
    let s = smart();
    let rt = Runtime::default();
    let own = s.path.replace(".md", ".smart");
    let (other_path, _) = add_page(s.k(), "Other", &files());
    let other = other_path.replace(".md", ".smart");
    let before_own = fs::read_to_string(s.vault.dir.join(&own).join("app.js")).unwrap();
    let before_other = fs::read_to_string(s.vault.dir.join(&other).join("index.html")).unwrap();
    let config = s.vault.dir.join(".kasten/config.yaml");
    let before_config = fs::read_to_string(&config).ok();
    for id in [
        format!("{own}/app.js"),
        format!("{own}/index.html"),
        format!("{own}/smart.yaml"),
        format!("{other}/index.html"),
        format!("{other}/index"),
        format!("{own}/app"),
        own.clone(),
        other.clone(),
        format!("{own}/../{other}/index.html"),
        ".kasten/config.yaml".to_owned(),
        ".kasten/config".to_owned(),
        ".git/config".to_owned(),
        ".git/HEAD".to_owned(),
        ".trash/x.md".to_owned(),
        ".smart/index.html".to_owned(),
        "library/.hidden.md".to_owned(),
        "library/.smart/x.md".to_owned(),
        "../outside.md".to_owned(),
        "/etc/passwd".to_owned(),
        "C:\\Windows\\win.ini".to_owned(),
    ] {
        for call in [
            wire("append", json!({ "id": id, "md": "evil" })),
            wire("update", json!({ "id": id, "props": { "a": "evil" } })),
            wire("addTags", json!({ "id": id, "tags": ["evil"] })),
            wire("toggleTodo", json!({ "id": id, "index": 0 })),
        ] {
            let kind = call.kind();
            assert!(run(&s, &rt, &call).is_err(), "{kind} {id}");
        }
    }
    // Not a single file moved, and nothing was proposed or committed on the way.
    assert_eq!(
        fs::read_to_string(s.vault.dir.join(&own).join("app.js")).unwrap(),
        before_own
    );
    assert_eq!(
        fs::read_to_string(s.vault.dir.join(&other).join("index.html")).unwrap(),
        before_other
    );
    assert_eq!(fs::read_to_string(&config).ok(), before_config);
    assert!(s.k().proposals().unwrap().is_empty());
}

fn paths(s: &super::Smart) -> Vec<String> {
    s.k().list().unwrap().into_iter().map(|n| n.path).collect()
}

#[test]
fn a_new_note_gets_a_plain_path_of_its_own_whatever_the_page_asks_for() {
    let s = smart();
    let rt = Runtime::default();
    let before = paths(&s);
    let titles = [
        "../../evil",
        "..",
        ".hidden",
        ".kasten/config",
        ".git/HEAD",
        "CON",
        "nul.md",
        "x.smart/y",
        "a/b/c",
        "a\\b",
        "C:\\Windows\\x",
        "trailing dots...",
        "   ",
        "Dup",
        "Dup",
        "Dup",
        "Photo organiser roadmap",
    ];
    let mut made = Vec::new();
    for title in titles {
        let result = run(&s, &rt, &wire("createNote", json!({ "title": title })));
        if let Ok(value) = result {
            assert_eq!(value["status"], "done", "{title}: {value}");
            made.push(value["result"]["path"].as_str().unwrap().to_owned());
        }
    }
    for path in &made {
        assert!(
            path.starts_with("library/")
                || path.starts_with("inbox/")
                || path.starts_with("projects/"),
            "{path}"
        );
        assert!(path.ends_with(".md"), "{path}");
        assert!(
            !path
                .split('/')
                .any(|part| part.starts_with('.') || part.contains(':')),
            "{path}"
        );
        assert!(!kasten_core::companions::in_folder(path), "{path}");
        assert!(!path.contains(".."), "{path}");
        assert!(s.vault.dir.join(path).is_file(), "{path}");
    }
    // The three "Dup" notes are three notes, none written over another, and the existing note is as it was.
    let dups: Vec<&String> = made.iter().filter(|p| p.contains("dup")).collect();
    assert_eq!(dups.len(), 3, "{made:?}");
    let distinct: std::collections::HashSet<&&String> = dups.iter().collect();
    assert_eq!(distinct.len(), 3);
    let after = paths(&s);
    for old in &before {
        assert!(after.contains(old), "{old} is gone");
    }
    assert_eq!(after.len(), before.len() + made.len());
    assert!(
        s.k()
            .read("projects/photo-organiser/pages/photo-organiser-roadmap.md")
            .unwrap()
            .text
            .contains("Drafting")
    );
    // Nothing was made outside the vault's notes: no file at the vault's top, none hidden.
    for entry in fs::read_dir(&s.vault.dir).unwrap() {
        let name = entry.unwrap().file_name().to_string_lossy().into_owned();
        assert!(
            !name.ends_with(".md") && !name.contains("evil"),
            "{name} at the vault's top"
        );
    }
}

#[test]
fn a_project_is_a_folder_name_and_nothing_that_climbs_or_hides_is_one() {
    let s = smart();
    let rt = Runtime::default();
    for project in [
        "..",
        "../..",
        ".kasten",
        ".git",
        "/etc",
        "C:\\x",
        "nope-not-a-project",
        "",
        "library",
        "projects",
        "untitled",
        "inbox",
    ] {
        let result = run(
            &s,
            &rt,
            &wire(
                "createNote",
                json!({ "title": "Elsewhere", "project": project }),
            ),
        );
        assert!(result.is_err(), "{project:?}: {result:?}");
    }
    // No folder was made for any of them.
    assert!(paths(&s).iter().all(|p| !p.contains("elsewhere")));
    let projects: Vec<String> = fs::read_dir(s.vault.dir.join("projects"))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    for ghost in [
        "untitled",
        "kasten",
        "git",
        "etc",
        "nope-not-a-project",
        "library",
    ] {
        assert!(!projects.contains(&ghost.to_owned()), "{ghost}");
    }
    // A spelling that is a project's own name files the note in that project's folder, and nowhere else.
    for project in [
        "photo-organiser/../..",
        "Photo Organiser",
        "PHOTO-ORGANISER",
    ] {
        let out = run(
            &s,
            &rt,
            &wire(
                "createNote",
                json!({ "title": "Spelled", "project": project }),
            ),
        )
        .unwrap();
        let path = out["result"]["path"].as_str().unwrap().to_owned();
        assert!(
            path.starts_with("projects/photo-organiser/"),
            "{project}: {path}"
        );
    }
}

#[test]
fn the_strictest_mode_of_the_project_holds_however_its_name_is_spelled() {
    let s = smart();
    let rt = Runtime::default();
    set_mode(
        s.k(),
        AgentMode::Balanced,
        &[("photo-organiser", AgentMode::Review)],
    );
    for project in [
        "photo-organiser",
        "Photo Organiser",
        "PHOTO-ORGANISER",
        " photo-organiser ",
    ] {
        let result = run(
            &s,
            &rt,
            &wire(
                "createNote",
                json!({ "title": "Spelled", "project": project }),
            ),
        );
        match result {
            Ok(value) => assert_eq!(value["status"], "pending_review", "{project:?}: {value}"),
            // Refused outright is as safe as held.
            Err(error) => assert_eq!(error.code, BridgeErrorCode::Refused, "{project:?}"),
        }
    }
    // Nothing was made in the project.
    assert!(paths(&s).iter().all(|p| !p.contains("spelled")));
    // A note in the project is held whatever the page that writes lives in.
    let value: Value = run(
        &s,
        &rt,
        &wire(
            "update",
            json!({ "id": ROADMAP, "props": { "status": "Submitted" } }),
        ),
    )
    .unwrap();
    assert_eq!(value["status"], "pending_review", "{value}");
}
