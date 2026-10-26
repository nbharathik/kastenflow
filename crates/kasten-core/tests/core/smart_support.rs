//! Helpers for the smart page tests: a page with a code folder beside it,
//! the folder's bytes read back, and the tree of the vault's history.

use crate::common::{self, NOW};

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

use kasten_core::agent::{AgentOp, Session};
use kasten_core::config_keys::{AgentMode, AgentsConfig, ProjectAgents};
use kasten_core::history::{Actor, History};
use kasten_core::{Kasten, Kind, NewNote, NoteFile, Outcome};

/// The standard smart page the agent tests use, and its folder.
pub const PAGE: &str = "library/tracker.md";
pub const DIR: &str = "library/tracker.smart";

/// An agent's write of a text file of a smart page's folder.
pub fn write(page: &str, path: &str, content: &str, base: &str) -> AgentOp {
    AgentOp::SmartWrite {
        page: page.into(),
        path: path.into(),
        content: content.into(),
        base: base.into(),
        reason: Some("test".into()),
    }
}

/// An agent taking a file out of a smart page's folder.
pub fn delete(page: &str, path: &str) -> AgentOp {
    AgentOp::SmartDelete {
        page: page.into(),
        path: path.into(),
        reason: None,
    }
}

/// Sets the agent mode of the vault and of some projects.
pub fn set_mode(k: &Kasten, mode: AgentMode, projects: &[(&str, AgentMode)]) {
    let mut config = k.config();
    config.agents = Some(AgentsConfig {
        mode: Some(mode),
        projects: projects
            .iter()
            .map(|(slug, mode)| {
                (
                    (*slug).to_owned(),
                    ProjectAgents {
                        mode: Some(*mode),
                        ..ProjectAgents::default()
                    },
                )
            })
            .collect::<BTreeMap<_, _>>(),
        ..AgentsConfig::default()
    });
    k.set_config(config).unwrap();
}

/// A smart page ("Tracker") with the standard folder, committed.
pub fn smart(t: &common::TempVault, k: &Kasten) -> NoteFile {
    let page = make_page(k, "Tracker", None, None);
    k.set_meta(&Actor::Human, &page.meta.path, "layout", Some("smart"), NOW)
        .unwrap();
    put_folder(t, k, &page.meta.path, &folder_files());
    page
}

/// What an op that ran told the agent.
pub fn done(outcome: Outcome) -> serde_json::Value {
    match outcome {
        Outcome::Done { result } => result,
        other => panic!("expected the op to run: {other:?}"),
    }
}

pub fn session() -> Session {
    Session::start("claude-code", NOW)
}

/// A small PNG-like file that is not text (and not valid UTF-8).
pub const PNG: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 255, 254, 1, 0, 0x80,
];

/// What a smart page's folder holds in these tests: a manifest, the layout
/// (CRLF and no final newline on purpose), code, data and two pictures.
pub fn folder_files() -> Vec<(&'static str, Vec<u8>)> {
    vec![
        (
            "smart.yaml",
            b"version: 1\ntitle: Conference tracker\nfuture: kept\n".to_vec(),
        ),
        (
            "index.html",
            b"<html><body><h1>Pelican deadlines</h1><script>var secret = 'walrus';</script></body></html>".to_vec(),
        ),
        ("app.js", b"console.log('hi');\r\nlet x = 1;\r\n".to_vec()),
        ("data/venues.json", b"{\"a\": [1, 2]}".to_vec()),
        (
            "assets/pin.svg",
            b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>".to_vec(),
        ),
        ("assets/p.png", PNG.to_vec()),
    ]
}

pub fn open() -> (common::TempVault, Kasten) {
    let t = common::dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k)
}

pub fn make_page(
    k: &Kasten,
    title: &str,
    project: Option<&str>,
    parent: Option<String>,
) -> NoteFile {
    k.create(
        &Actor::Human,
        &NewNote {
            kind: Kind::Page,
            title: title.to_owned(),
            date: "2026-10-10".to_owned(),
            project: project.map(str::to_owned),
            parent,
            template: None,
            icon: None,
        },
        NOW,
    )
    .unwrap()
}

/// The folder beside a page: `a/b.md` has `a/b.smart`.
pub fn dir_of(page: &str) -> String {
    format!("{}.smart", page.strip_suffix(".md").unwrap())
}

/// Puts `files` in the folder of `page` by hand (no op), then commits them.
pub fn put_folder(t: &common::TempVault, k: &Kasten, page: &str, files: &[(&str, Vec<u8>)]) {
    let dir = t.vault.root().join(dir_of(page));
    for (rel, bytes) in files {
        let file = dir.join(rel);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(file, bytes).unwrap();
    }
    k.commit_external().unwrap();
}

/// A page with the standard folder, committed.
pub fn smart_page(t: &common::TempVault, k: &Kasten, title: &str) -> NoteFile {
    let page = make_page(k, title, None, None);
    put_folder(t, k, &page.meta.path, &folder_files());
    page
}

/// Every file under `dir` (a vault path) with its bytes, keyed by its path
/// below `dir`.
pub fn snapshot(t: &common::TempVault, dir: &str) -> BTreeMap<String, Vec<u8>> {
    fn walk(base: &Path, dir: &Path, out: &mut BTreeMap<String, Vec<u8>>) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries {
            let path = entry.unwrap().path();
            if path.file_name().is_some_and(|name| name == ".git") {
                continue;
            }
            if path.is_dir() {
                walk(base, &path, out);
            } else {
                let rel = path
                    .strip_prefix(base)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                out.insert(rel, fs::read(&path).unwrap());
            }
        }
    }
    let base = t.vault.root().join(dir);
    let mut out = BTreeMap::new();
    walk(&base, &base, &mut out);
    out
}

/// Every file of the vault but git's folder and the cache, with its bytes.
pub fn all_files(t: &common::TempVault) -> BTreeMap<String, Vec<u8>> {
    let mut out = snapshot(t, "");
    out.retain(|rel, _| !rel.starts_with(".git/") && !rel.starts_with(".kasten/"));
    out
}

/// The standard folder as `snapshot` reads it.
pub fn expected() -> BTreeMap<String, Vec<u8>> {
    folder_files()
        .into_iter()
        .map(|(rel, bytes)| (rel.to_owned(), bytes))
        .collect()
}

/// The tree id of history's head: equal before and after an op and its undo
/// exactly when every file is back byte for byte.
pub fn tree(t: &common::TempVault) -> String {
    History::open(t.vault.root())
        .unwrap()
        .unwrap()
        .tree_id("HEAD")
        .unwrap()
}

/// The paths the newest commit changed.
pub fn changed(k: &Kasten) -> BTreeSet<String> {
    let id = k.log(None, 1).unwrap()[0].id.clone();
    k.commit_changes(&id)
        .unwrap()
        .into_iter()
        .map(|c| c.path)
        .collect()
}

pub fn undo_last(k: &Kasten) {
    let id = k.log(None, 1).unwrap()[0].id.clone();
    let undone = k.undo_commit(&id, NOW).unwrap();
    assert!(undone.conflict.is_none(), "{:?}", undone.conflict);
}

pub fn there(t: &common::TempVault, rel: &str) -> bool {
    t.vault.root().join(rel).exists()
}
