//! Setups a person saves from a project (`templates/setups/<slug>.yaml` and a
//! folder of skeleton pages beside it): what is saved, in one commit, and what
//! the dialog lists. Applying one is in `setups_saved_apply`, names and paths
//! that try to leave `templates/setups/` in `setups_saved_safety`, renaming and
//! deleting in `setups_saved_manage`. The helpers the four share are here.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::change_sets::open;
use crate::common::NOW;
use kasten_core::history::Actor;
use kasten_core::{Instant, Kasten, SetupTarget, ulid_at};

pub(crate) const PROJECT: &str = "note-taking-study";
pub(crate) const DRAFT: &str = "projects/note-taking-study/pages/report-draft.md";
pub(crate) const RELATED: &str = "projects/note-taking-study/pages/related-work-notes.md";

pub(crate) fn pages(paths: &[&str]) -> Vec<String> {
    paths.iter().map(|p| (*p).to_owned()).collect()
}

pub(crate) fn new(title: &str) -> SetupTarget {
    SetupTarget::New {
        title: title.to_owned(),
    }
}

pub(crate) fn read(root: &Path, path: &str) -> String {
    fs::read_to_string(root.join(path)).unwrap()
}

/// `src` with the line `from` replaced by `to` (taken out when empty), in the file's own line ends.
pub(crate) fn edit(src: &str, from: &str, to: &str) -> String {
    let eol = if src.contains("\r\n") { "\r\n" } else { "\n" };
    let old = format!("{from}{eol}");
    assert!(src.contains(&old), "no line {from:?}");
    let new = if to.is_empty() {
        String::new()
    } else {
        format!("{to}{eol}")
    };
    src.replacen(&old, &new, 1)
}

pub(crate) fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), &target).unwrap();
        }
    }
}

/// Every file but git's and Kasten's own.
pub(crate) fn tree(root: &Path) -> BTreeMap<String, Vec<u8>> {
    fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<String, Vec<u8>>) {
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            let rel = path
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            if rel == ".git" || rel == ".kasten" {
                continue;
            }
            if path.is_dir() {
                walk(root, &path, out);
            } else {
                out.insert(rel, fs::read(&path).unwrap());
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(root, root, &mut out);
    out
}

pub(crate) struct Fresh {
    pub(crate) dir: PathBuf,
    pub(crate) k: Kasten,
}

impl Drop for Fresh {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

pub(crate) fn fresh() -> Fresh {
    let dir = std::env::temp_dir().join(format!("kasten-saved-{}", ulid_at(Instant::now().millis)));
    let k = Kasten::init(&dir, "Other").unwrap();
    Fresh { dir, k }
}

pub(crate) fn commits(k: &Kasten) -> usize {
    k.log(None, 10_000).unwrap().len()
}

#[test]
fn a_project_is_saved_as_a_setup_in_one_commit_and_listed_after_the_built_in_ones() {
    let (t, k, _s) = open();
    let before = commits(&k);
    let saved = k
        .save_project_setup(
            &Actor::Human,
            PROJECT,
            "",
            "Study kit",
            &pages(&[DRAFT, RELATED]),
            NOW,
        )
        .unwrap();
    assert_eq!(
        (saved.id.as_str(), saved.slug.as_str()),
        ("saved:study-kit", "study-kit")
    );
    let mut written = saved.written.clone();
    written.sort();
    assert_eq!(
        written,
        [
            "templates/setups/study-kit.yaml",
            "templates/setups/study-kit/pages/related-work-notes.md",
            "templates/setups/study-kit/pages/report-draft.md",
            "templates/setups/study-kit/vault/tags/paper.yaml",
        ]
    );
    for path in &written {
        assert!(t.vault.root().join(path).is_file(), "{path}");
    }
    assert_eq!(commits(&k), before + 1, "one commit");
    let head = &k.log(None, 1).unwrap()[0];
    assert_eq!(saved.commit.as_deref(), Some(head.id.as_str()));
    assert!(
        head.message.contains("Kasten-Setup: saved:study-kit"),
        "{}",
        head.message
    );
    assert!(!head.agent);

    let all = k.list_setups().unwrap();
    let ids: Vec<&str> = all.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(
        ids,
        ["research", "writing", "presentation", "saved:study-kit"]
    );
    assert!(all[..3].iter().all(|s| !s.saved));
    let mine = &all[3];
    assert!(mine.saved);
    assert_eq!(mine.name, "Study kit");
    assert_eq!(
        mine.files,
        ["pages/related-work-notes.md", "pages/report-draft.md"]
    );
    assert_eq!(mine.tags, ["paper"]);
    assert!(!mine.icon.is_empty() && !mine.summary.is_empty());
    // The summary says what is in it, not which project it came from.
    assert!(!mine.summary.contains("Note-taking"), "{}", mine.summary);
    // Saved pages are inert templates: nothing the vault checks is wrong.
    assert!(
        k.verify().unwrap().problems.is_empty(),
        "{:?}",
        k.verify().unwrap().problems
    );
}

#[test]
fn skeleton_pages_are_the_pages_byte_for_byte_but_for_the_lines_that_name_a_page() {
    let (t, k, _s) = open();
    k.save_project_setup(
        &Actor::Human,
        PROJECT,
        "kit",
        "Kit",
        &pages(&[RELATED, DRAFT]),
        NOW,
    )
    .unwrap();
    let root = t.vault.root();
    // Sorted by path, so the ids are p1 for the related notes and p2 for the draft.
    let draft = read(root, DRAFT);
    let draft = edit(
        &draft,
        "id: 01K5Y2PAPERDRAFT0000000001",
        "id: \"{{id:p2}}\"",
    );
    let draft = edit(&draft, "created: 2026-09-24T08:00:00Z", "");
    let draft = edit(&draft, "updated: 2026-09-24T08:00:00Z", "");
    assert_eq!(
        read(root, "templates/setups/kit/pages/report-draft.md"),
        draft
    );

    let related = read(root, RELATED);
    let related = edit(
        &related,
        "id: 01K5Y2RE1ATEDW0RKN0TES0001",
        "id: \"{{id:p1}}\"",
    );
    let related = edit(&related, "created: 2026-09-24T08:00:00Z", "");
    let related = edit(&related, "updated: 2026-09-24T08:00:00Z", "");
    // The sub-page keeps its place under the page that is saved with it.
    let related = edit(
        &related,
        "parent: 01K5Y2PAPERDRAFT0000000001",
        "parent: \"{{id:p2}}\"",
    );
    assert_eq!(
        read(root, "templates/setups/kit/pages/related-work-notes.md"),
        related
    );
    // The tag's schema, views and all, is copied as it is.
    assert_eq!(
        read(root, "templates/setups/kit/vault/tags/paper.yaml"),
        read(root, "tags/paper.yaml")
    );
    // Nothing of the source changed.
    assert_eq!(
        read(root, DRAFT),
        fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../fixtures/dev-vault")
                .join(DRAFT)
        )
        .unwrap()
    );
}

#[test]
fn the_dialog_lists_what_will_be_saved_with_the_pages_under_pages_ticked() {
    let (t, k, _s) = open();
    let deep = "projects/note-taking-study/pages/extra/deep.md";
    fs::create_dir_all(
        t.vault
            .root()
            .join("projects/note-taking-study/pages/extra"),
    )
    .unwrap();
    fs::write(
        t.vault.root().join(deep),
        "---\ntitle: Deep\ntype: page\n---\nx\n",
    )
    .unwrap();
    k.reindex().unwrap();
    let source = k.preview_project_setup(PROJECT).unwrap();
    assert_eq!(
        (source.folder.as_str(), source.title.as_str()),
        (PROJECT, "Note-taking study")
    );
    let rows: Vec<(&str, bool)> = source
        .pages
        .iter()
        .map(|p| (p.path.as_str(), p.included))
        .collect();
    assert_eq!(rows, [(deep, false), (RELATED, true), (DRAFT, true)]);
    assert_eq!(source.tags, ["paper"]);
    // Cards and other kinds are not offered; nor is the project page.
    assert!(
        source
            .pages
            .iter()
            .all(|p| p.path.ends_with(".md") && !p.path.ends_with("_project.md"))
    );
    // Another spelling of the project names the same one.
    assert_eq!(
        k.preview_project_setup("Note-Taking-Study").unwrap().folder,
        PROJECT
    );
    assert_eq!(
        k.preview_project_setup("projects/note-taking-study/_project.md")
            .unwrap()
            .folder,
        PROJECT
    );
    assert!(k.preview_project_setup("no-such").is_err());
    assert!(k.preview_project_setup("../photo-organiser").is_err());
}
