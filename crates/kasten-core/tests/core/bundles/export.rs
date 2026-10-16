//! What goes in a bundle and what stays out, the manifest, and where it may be written.

use std::collections::BTreeSet;
use std::fs;

use kasten_core::bundle::{BundleFileKind, MANIFEST_FILE};
use serde_json::Value;

use super::project::{BIB, Dest, FOLDER, exported, tree, trip};
use crate::bibliography::support::NOW;

const INCLUDED: [&str; 16] = [
    "assets/.meta/chart.png.json",
    "assets/.meta/map.png.json",
    "assets/chart.png",
    "assets/guide.pdf",
    "assets/map.png",
    "projects/trip/_project.md",
    "projects/trip/boards/map.canvas",
    "projects/trip/decks/talk.deck",
    "projects/trip/pages/itinerary.md",
    "projects/trip/pages/plan.comments.json",
    "projects/trip/pages/plan.md",
    "references.bib",
    "sources/paper.highlights.json",
    "sources/paper.pdf",
    "tags/atlas.yaml",
    "tags/journey.yaml",
];

#[test]
fn a_bundle_holds_the_project_what_it_uses_and_nothing_else() {
    let f = trip();
    let plan = f.k.plan_export(FOLDER).unwrap();
    assert_eq!(plan.project.folder, "trip");
    assert_eq!(plan.project.title, "Trip");
    assert_eq!(
        plan.project.id.as_deref(),
        Some(super::project::id(1).as_str())
    );
    let paths: BTreeSet<&str> = plan.files.iter().map(|file| file.path.as_str()).collect();
    let expected: BTreeSet<&str> = INCLUDED.iter().copied().collect();
    assert_eq!(paths, expected);
    let sorted: Vec<&str> = plan.files.iter().map(|file| file.path.as_str()).collect();
    assert!(
        sorted.windows(2).all(|w| w[0] < w[1]),
        "listed by path: {sorted:?}"
    );

    let kind = |path: &str| {
        plan.files
            .iter()
            .find(|file| file.path == path)
            .unwrap()
            .kind
    };
    assert_eq!(kind("projects/trip/pages/plan.md"), BundleFileKind::Project);
    assert_eq!(
        kind("projects/trip/pages/plan.comments.json"),
        BundleFileKind::Project
    );
    assert_eq!(kind("assets/map.png"), BundleFileKind::Asset);
    assert_eq!(kind("assets/.meta/map.png.json"), BundleFileKind::Asset);
    assert_eq!(kind("assets/guide.pdf"), BundleFileKind::Asset);
    assert_eq!(kind("sources/paper.pdf"), BundleFileKind::Source);
    assert_eq!(
        kind("sources/paper.highlights.json"),
        BundleFileKind::Source
    );
    assert_eq!(kind("tags/atlas.yaml"), BundleFileKind::Tag);
    assert_eq!(kind("references.bib"), BundleFileKind::References);
    assert_eq!(
        plan.bytes,
        plan.files.iter().map(|file| file.bytes).sum::<u64>()
    );

    // Cited by a page, a deck and a picture's sidecar; one is in no .bib file.
    assert_eq!(plan.references, ["old2020thing", "other2019"]);
    assert_eq!(plan.missing_references, ["missing2000"]);
    // A page's link and a board's card lead outside the project.
    assert_eq!(plan.outside, ["2 links lead to notes outside the project"]);
}

#[test]
fn what_is_not_the_projects_stays_out() {
    let f = trip();
    let plan = f.k.plan_export(FOLDER).unwrap();
    for path in plan.files.iter().map(|file| file.path.as_str()) {
        for forbidden in [
            ".kasten",
            ".git",
            ".trash",
            "chats/",
            "projects/other",
            "library/",
            "unused",
            "other.pdf",
            "other.highlights",
            "sources/references.bib",
        ] {
            assert!(
                !path.contains(forbidden),
                "{path} should not be in a bundle ({forbidden})"
            );
        }
    }
}

#[test]
fn only_the_cited_works_are_copied_as_written_with_the_macros_they_use() {
    let (_f, dest) = exported();
    let bib = dest.text("references.bib");
    assert!(
        bib.contains("@string{nips = \"Advances in NIPS\"}"),
        "{bib}"
    );
    assert!(
        bib.contains(
            "@article{old2020thing,\n  title = {A thing},\n  booktitle = nips,\n  year = {2020}\n}"
        ),
        "{bib}"
    );
    assert!(
        bib.contains("@article{other2019,\n  title = {Another},\n  year = {2019}\n}"),
        "{bib}"
    );
    assert!(
        !bib.contains("notcited2018") && !bib.contains("% my papers"),
        "{bib}"
    );
    assert!(BIB.contains("notcited2018"));
}

#[test]
fn exporting_writes_the_files_and_a_manifest_that_lists_each_with_its_hash() {
    let (f, dest) = exported();
    let manifest: Value = serde_json::from_str(&dest.text(MANIFEST_FILE)).unwrap();
    assert_eq!(manifest["format"], "kastenflow-bundle");
    assert_eq!(manifest["version"], 1);
    assert_eq!(manifest["made"], NOW.rfc3339());
    assert!(manifest["app"].as_str().unwrap().starts_with("KastenFlow "));
    assert_eq!(manifest["project"]["folder"], "trip");
    assert_eq!(manifest["project"]["title"], "Trip");
    assert_eq!(manifest["project"]["id"], super::project::id(1));
    assert_eq!(
        manifest["references"],
        serde_json::json!(["old2020thing", "other2019"])
    );
    assert_eq!(
        manifest["outside"],
        serde_json::json!(["2 links lead to notes outside the project"])
    );

    let listed = manifest["files"].as_array().unwrap();
    assert_eq!(listed.len(), 16);
    for file in listed {
        let path = file["path"].as_str().unwrap();
        let bytes = fs::read(dest.path(path)).unwrap();
        assert_eq!(
            file["bytes"].as_u64().unwrap(),
            bytes.len() as u64,
            "{path}"
        );
        assert_eq!(
            file["sha256"].as_str().unwrap(),
            slides_assets::sha256_hex(&bytes),
            "{path}"
        );
        if path != "references.bib" {
            assert_eq!(
                bytes,
                fs::read(f.dir.join(path)).unwrap(),
                "{path} is copied as it is"
            );
        }
    }
    // The manifest and the listed files are all the folder holds.
    let written: BTreeSet<String> = tree(&dest.dir).into_keys().collect();
    let mut expected: BTreeSet<String> = listed
        .iter()
        .map(|f| f["path"].as_str().unwrap().to_owned())
        .collect();
    expected.insert(MANIFEST_FILE.to_owned());
    assert_eq!(written, expected);
}

#[test]
fn exporting_changes_nothing_in_the_vault_and_makes_no_commit() {
    let f = trip();
    let before = tree(&f.dir);
    let head = f.head();
    let dest = Dest::new();
    let done = f.k.export_project(FOLDER, &dest.dir, NOW).unwrap();
    assert_eq!(done.files, 16);
    assert_eq!(done.references, 2);
    assert_eq!(done.outside, ["2 links lead to notes outside the project"]);
    assert_eq!(tree(&f.dir), before);
    assert_eq!(f.head(), head);
    assert!(
        f.k.dirty().unwrap().is_empty(),
        "{:?}",
        f.k.dirty().unwrap()
    );
}

#[test]
fn a_new_nested_folder_or_an_empty_one_is_fine() {
    let f = trip();
    let dest = Dest::new();
    let nested = dest.path("a/b/c");
    f.k.export_project(FOLDER, &nested, NOW).unwrap();
    assert!(nested.join(MANIFEST_FILE).is_file());

    let empty = Dest::new();
    fs::create_dir_all(&empty.dir).unwrap();
    f.k.export_project(FOLDER, &empty.dir, NOW).unwrap();
    assert!(empty.path(MANIFEST_FILE).is_file());
}

#[test]
fn a_folder_inside_the_vault_or_holding_it_or_not_empty_is_refused_and_nothing_is_written() {
    let f = trip();
    let say = |dest: &std::path::Path| {
        f.k.export_project(FOLDER, dest, NOW)
            .unwrap_err()
            .to_string()
    };

    let inside = f.dir.join("exports/trip");
    assert!(say(&inside).contains("outside the vault"));
    assert!(!f.dir.join("exports").exists());
    assert!(say(&f.dir).contains("outside the vault"));
    assert!(say(&f.dir.join("projects")).contains("outside the vault"));
    assert!(say(f.dir.parent().unwrap()).contains("holds the vault"));

    let full = Dest::new();
    fs::create_dir_all(&full.dir).unwrap();
    fs::write(full.path("mine.txt"), "mine").unwrap();
    assert!(say(&full.dir).contains("not empty"));
    assert_eq!(fs::read_to_string(full.path("mine.txt")).unwrap(), "mine");
    assert_eq!(fs::read_dir(&full.dir).unwrap().count(), 1);

    let file = Dest::new();
    fs::write(&file.dir, "a file").unwrap();
    assert!(say(&file.dir).contains("file"));
    assert!(say(std::path::Path::new("")).contains("Choose a folder"));
}

#[test]
fn a_project_that_is_not_there_or_a_folder_that_is_not_one_is_refused() {
    let f = trip();
    for name in ["nope", "", "../trip", "trip/pages", ".hidden", "a\\b"] {
        let err = f.k.plan_export(name).unwrap_err().to_string();
        assert!(err.contains("project"), "{name:?}: {err}");
    }
    let dest = Dest::new();
    assert!(f.k.export_project("nope", &dest.dir, NOW).is_err());
    assert!(
        !dest.dir.exists(),
        "nothing is made for a project that is not there"
    );
}
