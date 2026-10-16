//! A bundle that was altered, damaged or made to reach where it should not is refused,
//! with a sentence, before anything is written.

use std::fs;

use kasten_core::bundle::MANIFEST_FILE;
use kasten_core::history::Actor;
use kasten_core::import::{ImportKind, ImportOptions};
use serde_json::{Value, json};

use super::project::{Dest, exported, tree};
use crate::bibliography::support::{Fresh, NOW, fresh};

/// A bundle, its manifest as it was made, and an empty vault to try to import it into.
struct Case {
    bundle: Dest,
    original: String,
    into: Fresh,
    _source: Fresh,
}

fn case() -> Case {
    let (source, bundle) = exported();
    Case {
        original: bundle.text(MANIFEST_FILE),
        bundle,
        into: fresh(),
        _source: source,
    }
}

impl Case {
    /// The manifest as it was made, changed by `change`.
    fn edit(&self, change: impl FnOnce(&mut Value)) {
        let mut manifest: Value = serde_json::from_str(&self.original).unwrap();
        change(&mut manifest);
        fs::write(
            self.bundle.path(MANIFEST_FILE),
            serde_json::to_string_pretty(&manifest).unwrap(),
        )
        .unwrap();
    }

    /// Importing the bundle fails with a sentence containing `fragment`, and the vault is as it was.
    fn refused(&self, fragment: &str) {
        let before = tree(&self.into.dir);
        let head = self.into.head();
        let options = ImportOptions::default();
        let planned = self
            .into
            .k
            .plan_import(&self.bundle.dir, &options, NOW)
            .unwrap_err()
            .to_string();
        assert!(planned.contains(fragment), "plan: {planned}");
        let imported = self
            .into
            .k
            .import(&Actor::Human, &self.bundle.dir, &options, NOW)
            .unwrap_err()
            .to_string();
        assert!(imported.contains(fragment), "import: {imported}");
        assert_eq!(tree(&self.into.dir), before);
        assert_eq!(self.into.head(), head);
    }
}

fn entry(path: &str) -> Value {
    json!({"path": path, "bytes": 1, "sha256": "0".repeat(64)})
}

#[test]
fn a_file_that_changed_after_the_bundle_was_made_is_refused() {
    let case = case();
    let path = case.bundle.path("projects/trip/pages/plan.md");
    let text = fs::read_to_string(&path).unwrap();
    // Same length, other letters: only the hash can tell.
    fs::write(&path, text.replacen("Plan", "Plot", 1)).unwrap();
    case.refused("does not match the bundle's manifest");
    fs::write(&path, format!("{text} longer")).unwrap();
    case.refused("does not match the bundle's manifest");
}

#[test]
fn a_file_the_manifest_lists_that_is_gone_is_refused() {
    let case = case();
    fs::remove_file(case.bundle.path("assets/map.png")).unwrap();
    case.refused("is not in the folder");
}

#[test]
fn a_path_that_is_not_plain_or_not_the_bundles_to_put_there_is_refused() {
    let case = case();
    for bad in [
        "../evil.md",
        "/absolute.md",
        "C:/windows/evil.md",
        "projects/trip/../../evil.md",
        "projects/trip/./x.md",
        "projects/trip//x.md",
        "projects\\trip\\x.md",
        ".kasten/config.yaml",
        ".git/config",
        "chats/talk.md",
        "library/note.md",
        "projects/other/pages/x.md",
        "projects/trip/.hidden",
        "assets/a:b.png",
        "assets/.meta",
        "tags",
        "references.bib/x",
        "",
    ] {
        case.edit(|m| m["files"].as_array_mut().unwrap().push(entry(bad)));
        case.refused("will not import");
    }
}

#[test]
fn a_path_listed_twice_a_missing_project_page_and_a_bad_folder_are_refused() {
    let case = case();
    case.edit(|m| {
        // The same file as one the bundle lists already, spelled in other case.
        m["files"]
            .as_array_mut()
            .unwrap()
            .push(entry("tags/ATLAS.yaml"));
    });
    case.refused("twice");

    case.edit(|m| {
        m["files"]
            .as_array_mut()
            .unwrap()
            .retain(|f| f["path"] != "projects/trip/_project.md");
    });
    case.refused("no project page");

    for folder in ["", "../x", "a/b", ".hidden", "x:y"] {
        case.edit(|m| m["project"]["folder"] = json!(folder));
        case.refused("project folder");
    }
}

#[test]
fn a_manifest_that_is_not_one_or_is_from_a_newer_version_is_refused() {
    let case = case();
    case.edit(|m| m["version"] = json!(2));
    case.refused("newer version of KastenFlow");

    case.edit(|m| m["version"] = json!(0));
    case.refused("no version");

    case.edit(|m| m["format"] = json!("something-else"));
    case.refused("not a KastenFlow bundle manifest");

    fs::write(case.bundle.path(MANIFEST_FILE), "{ not json").unwrap();
    case.refused("not a readable manifest");

    case.edit(|m| m["files"][0]["sha256"] = json!("nope"));
    case.refused("no SHA-256");
}

#[test]
fn a_folder_that_is_not_a_bundle_is_not_taken_for_one() {
    let into = fresh();
    let folder = Dest::new();
    fs::create_dir_all(&folder.dir).unwrap();
    fs::write(folder.path("note.md"), "# A note\n").unwrap();
    let options = ImportOptions {
        kind: Some(ImportKind::Bundle),
        project: None,
    };
    let err = into
        .k
        .plan_import(&folder.dir, &options, NOW)
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("not a KastenFlow bundle") && err.contains(MANIFEST_FILE),
        "{err}"
    );
    // Without saying so it is the Markdown folder it looks like.
    let plan = into
        .k
        .plan_import(&folder.dir, &ImportOptions::default(), NOW)
        .unwrap();
    assert_eq!(plan.kind, ImportKind::Markdown);
    assert!(plan.conflicts.is_empty());
}

#[test]
fn a_bundle_can_still_be_read_as_markdown_when_the_person_says_so() {
    let case = case();
    let options = ImportOptions {
        kind: Some(ImportKind::Markdown),
        project: None,
    };
    let plan = case
        .into
        .k
        .plan_import(&case.bundle.dir, &options, NOW)
        .unwrap();
    assert_eq!(plan.kind, ImportKind::Markdown);
}

#[test]
fn a_bundle_folder_inside_the_vault_is_not_imported() {
    let case = case();
    let inside = case.into.dir.join("kept-bundle");
    fs::create_dir_all(&inside).unwrap();
    for (path, bytes) in tree(&case.bundle.dir) {
        let target = inside.join(&path);
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(target, bytes).unwrap();
    }
    let err = case
        .into
        .k
        .plan_import(&inside, &ImportOptions::default(), NOW)
        .unwrap_err()
        .to_string();
    assert!(err.contains("inside this vault"), "{err}");
}
