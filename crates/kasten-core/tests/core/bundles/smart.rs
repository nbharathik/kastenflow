//! A smart page's code folder in a project bundle: it comes with its project
//! exactly as it was, and a bundle that lists files a folder may not hold
//! (a program, a file over the size, too many files) is refused before
//! anything is written.

use std::fs;

use kasten_core::bundle::MANIFEST_FILE;
use kasten_core::history::Actor;
use kasten_core::import::ImportOptions;
use serde_json::{Value, json};

use super::project::{Dest, FOLDER, fill, id, tree};
use crate::bibliography::support::{Fresh, NOW, fresh};

const PAGE: &str = "projects/trip/pages/tracker.md";
const DIR: &str = "projects/trip/pages/tracker.smart";

fn files() -> Vec<(&'static str, Vec<u8>)> {
    vec![
        (
            "smart.yaml",
            b"# mine\ntitle: Tracker\nfuture: kept\n".to_vec(),
        ),
        ("index.html", b"<h1>Pelican deadlines</h1>".to_vec()),
        ("app.js", b"let id = 1;\r\nlet two = 2".to_vec()),
        // Looks like a note id the vault already has: it must come in as it is.
        (
            "data/venues.json",
            format!("{{\"plan\": \"{}\"}}", id(2)).into_bytes(),
        ),
        (
            "assets/pin.svg",
            b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>".to_vec(),
        ),
        (
            "assets/p.png",
            vec![0x89, b'P', b'N', b'G', 0, 255, 254, 1, 0, 0x80],
        ),
    ]
}

/// A vault with the sample project and a smart page in it, committed.
fn trip_with_a_smart_page() -> Fresh {
    let f = fresh();
    fill(&f);
    f.put(
        PAGE,
        &format!(
            "---\nid: {}\ntitle: Tracker\ntype: page\nlayout: smart\n---\nA smart page.\n",
            id(20)
        ),
    );
    for (rel, bytes) in files() {
        f.put_bytes(&format!("{DIR}/{rel}"), &bytes);
    }
    f.reindex();
    f.k.commit_external().unwrap();
    f
}

fn export(f: &Fresh) -> Dest {
    let dest = Dest::new();
    f.k.export_project(FOLDER, &dest.dir, NOW).unwrap();
    dest
}

#[test]
fn a_smart_pages_folder_comes_in_with_its_project_exactly_as_it_was() {
    let f = trip_with_a_smart_page();
    let dest = export(&f);
    for (rel, bytes) in files() {
        assert_eq!(
            fs::read(dest.path(&format!("{DIR}/{rel}"))).unwrap(),
            bytes,
            "{rel} in the bundle"
        );
    }
    // Into a vault that already has the project and the same ids: the project
    // is added under another folder, the ids change, the folder does not.
    let done =
        f.k.import(&Actor::Human, &dest.dir, &ImportOptions::default(), NOW)
            .unwrap();
    assert_eq!(done.summary.project_path, "projects/trip-2/_project.md");
    for (rel, bytes) in files() {
        assert_eq!(
            fs::read(
                f.dir
                    .join(format!("projects/trip-2/pages/tracker.smart/{rel}"))
            )
            .unwrap(),
            bytes,
            "{rel} imported"
        );
    }
    let listing = f.k.smart_read("projects/trip-2/pages/tracker.md").unwrap();
    assert!(listing.problems.is_empty(), "{:?}", listing.problems);
    assert_eq!(listing.files.len(), files().len());
}

#[test]
fn files_placed_by_hand_that_a_folder_may_not_hold_stay_out_of_the_bundle_and_are_said() {
    let f = trip_with_a_smart_page();
    f.put_bytes(&format!("{DIR}/tool.exe"), b"MZ");
    f.put_bytes(&format!("{DIR}/run.bat"), b"echo hi");
    let dest = Dest::new();
    let done = f.k.export_project(FOLDER, &dest.dir, NOW).unwrap();
    for left in ["tool.exe", "run.bat"] {
        assert!(!dest.path(&format!("{DIR}/{left}")).exists(), "{left}");
    }
    assert!(
        done.outside
            .iter()
            .any(|line| line == "2 files a smart page may not have were left out"),
        "{:?}",
        done.outside
    );
    // The rest is all there, and the bundle comes in without a refusal.
    for (rel, bytes) in files() {
        assert_eq!(
            fs::read(dest.path(&format!("{DIR}/{rel}"))).unwrap(),
            bytes,
            "{rel}"
        );
    }
    f.k.import(&Actor::Human, &dest.dir, &ImportOptions::default(), NOW)
        .unwrap();
}

fn refused(into: &Fresh, dest: &Dest, original: &str, add: Vec<Value>, fragment: &str) {
    let mut manifest: Value = serde_json::from_str(original).unwrap();
    manifest["files"].as_array_mut().unwrap().extend(add);
    fs::write(
        dest.path(MANIFEST_FILE),
        serde_json::to_string_pretty(&manifest).unwrap(),
    )
    .unwrap();
    let before = tree(&into.dir);
    let head = into.head();
    let options = ImportOptions::default();
    for result in [
        into.k.plan_import(&dest.dir, &options, NOW).map(|_| ()),
        into.k
            .import(&Actor::Human, &dest.dir, &options, NOW)
            .map(|_| ()),
    ] {
        let err = result.unwrap_err().to_string();
        assert!(err.contains(fragment), "{fragment}: {err}");
        // Whoever refuses it, the bundle's own path check or the folder's.
        if !fragment.is_empty() {
            assert!(err.contains("Nothing was imported"), "{err}");
        }
    }
    assert_eq!(tree(&into.dir), before);
    assert_eq!(into.head(), head);
}

fn entry(path: &str, bytes: u64) -> Value {
    json!({"path": path, "bytes": bytes, "sha256": "0".repeat(64)})
}

#[test]
fn a_bundle_that_lists_what_a_folder_may_not_hold_is_refused_before_anything_is_written() {
    let f = trip_with_a_smart_page();
    let dest = export(&f);
    let original = dest.text(MANIFEST_FILE);
    let into = fresh();
    let at = |rel: &str| format!("{DIR}/{rel}");
    let refused = |add: Vec<Value>, fragment: &str| refused(&into, &dest, &original, add, fragment);
    // Programs and kinds of file the folder does not take.
    for rel in [
        "tool.exe",
        "x.wasm",
        "page.md",
        "run.bat",
        "noext",
        "a.js.exe",
        "sub/x.dll",
    ] {
        refused(
            vec![entry(&at(rel), 10)],
            "not a file a smart page may have",
        );
    }
    // Deep and device-named files.
    for rel in ["a/b/c/d/e/f/g.js", "CON.js", "PROGRA~1.js"] {
        refused(vec![entry(&at(rel), 10)], "");
    }
    // Over the size of one file.
    refused(
        vec![entry(&at("big.js"), 2 * 1024 * 1024 + 1)],
        "at most 2.0 MB",
    );
    // Over the folder's size: the sample's files plus six of 2 MB.
    let many: Vec<Value> = (0..6)
        .map(|n| entry(&at(&format!("big{n}.json")), 2 * 1024 * 1024))
        .collect();
    refused(many, "at most 10.0 MB");
    // Over the folder's number of files.
    let crowd: Vec<Value> = (0..500)
        .map(|n| entry(&at(&format!("data/f{n}.json")), 1))
        .collect();
    refused(crowd, "at most 500 files");
    // The same folder spelled in another case is one folder.
    let upper = DIR.replace("tracker.smart", "TRACKER.SMART");
    let mixed: Vec<Value> = (0..250)
        .map(|n| entry(&at(&format!("data/f{n}.json")), 1))
        .chain((250..500).map(|n| entry(&format!("{upper}/data/f{n}.json"), 1)))
        .collect();
    refused(mixed, "at most 500 files");
}
