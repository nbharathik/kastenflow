//! The kit the scheme serves is the kit's source folder, less what is not the
//! kit: pages to copy, docs, examples, tests and the map's source data.

use std::fs;
use std::path::{Path, PathBuf};

use crate::smart::kit::{FILES, VERSION, file};

fn source() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/smart-kit")
}

fn walk(dir: &Path, rel: &str, out: &mut Vec<String>) {
    for entry in fs::read_dir(dir).unwrap() {
        let entry = entry.unwrap();
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = if rel.is_empty() {
            name.clone()
        } else {
            format!("{rel}/{name}")
        };
        if entry.file_type().unwrap().is_dir() {
            walk(&entry.path(), &path, out);
        } else {
            out.push(path);
        }
    }
}

/// What the kit is by the rule written down in the kit's notes: styles and
/// scripts at its top, in `lib/` and `components/`, and the map's built data
/// script; not the starters, docs, examples, tests or helpers for them.
fn is_kit_file(path: &str) -> bool {
    let top = path.split('/').next().unwrap_or("");
    if ["starters", "docs", "examples", "test-support"].contains(&top) {
        return false;
    }
    if path.contains(".test.")
        || path.ends_with(".mjs")
        || path.ends_with(".json")
        || path.ends_with(".md")
    {
        return false;
    }
    path.ends_with(".js") || path.ends_with(".css")
}

#[test]
fn the_list_is_the_kit_folders_scripts_and_styles() {
    let mut on_disk = Vec::new();
    walk(&source(), "", &mut on_disk);
    let mut expected: Vec<String> = on_disk.into_iter().filter(|p| is_kit_file(p)).collect();
    expected.sort();
    let mut listed: Vec<String> = FILES.iter().map(|(p, _)| (*p).to_owned()).collect();
    listed.sort();
    assert_eq!(
        listed, expected,
        "a kit file was added or removed: update smart/kit.rs"
    );
}

#[test]
fn nothing_but_the_kit_is_served() {
    for (path, text) in FILES {
        assert_eq!(file(VERSION, path), Some(*text), "{path}");
        assert!(!text.is_empty(), "{path}");
        for forbidden in ["starters/", "test-support", ".test."] {
            assert!(!path.contains(forbidden), "{path}");
        }
    }
    assert_eq!(file("2", "kit.js"), None);
    assert_eq!(file("", "kit.js"), None);
    assert_eq!(file(VERSION, "../kit.js"), None);
    assert_eq!(file(VERSION, "kit.js/"), None);
    assert_eq!(file(VERSION, "/kit.js"), None);
    assert_eq!(file(VERSION, "starters/dashboard/app.js"), None);
}
