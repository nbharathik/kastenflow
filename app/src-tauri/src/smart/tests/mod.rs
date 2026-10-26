//! Tests of the smart page runtime: the scheme that serves a page's folder
//! and the kit, the window's guard, the bridge's calls and the error log.
//! Each works on a private copy of the dev vault.

mod author;
mod bridge;
mod errors;
mod guard;
mod kit;
mod protocol;
mod protocol_frames;
mod protocol_kit;
mod protocol_paths;
mod trust;
mod trust_gate;
mod trust_more;
mod views;
mod writes;
mod writes_folders;

use kasten_core::config_keys::{AgentMode, AgentsConfig, ProjectAgents};
use kasten_core::history::Actor;
use kasten_core::{Instant, Kasten, Kind, NewNote};

use super::runtime::Runtime;
use crate::chat::tests::{Vault, vault};

pub const PNG: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 255, 254, 1,
];

/// What a smart page's folder holds in these tests.
pub fn files() -> Vec<(&'static str, Vec<u8>)> {
    vec![
        ("smart.yaml", b"version: 1\ntitle: Tracker\nsize:\n  height: 300\n  maxHeight: 500\n".to_vec()),
        (
            "index.html",
            b"<!doctype html><link rel=\"stylesheet\" href=\"smart://kit/1/kit.css\"><script src=\"smart://kit/1/kit.js\"></script><script src=\"app.js\"></script>".to_vec(),
        ),
        ("app.js", b"window.app = 1;".to_vec()),
        ("data/venues.json", b"{\"a\": [1, 2]}".to_vec()),
        ("assets/pin.svg", b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>".to_vec()),
        ("assets/p.png", PNG.to_vec()),
    ]
}

/// A private vault with one smart page in it, and a frame showing it.
pub struct Smart {
    pub vault: Vault,
    /// The page's path and its id.
    pub path: String,
    pub id: String,
    /// What the app keeps while pages run, with one live frame of this page.
    pub rt: Runtime,
    /// That frame's secret.
    pub frame: String,
}

impl Smart {
    pub fn k(&self) -> &Kasten {
        &self.vault.kasten
    }
}

/// Makes a smart page called `title` with the files `files` in its folder.
pub fn add_page(k: &Kasten, title: &str, files: &[(&str, Vec<u8>)]) -> (String, String) {
    add_page_in(k, title, None, files)
}

/// `add_page`, in the project `project` (its folder name).
pub fn add_page_in(
    k: &Kasten,
    title: &str,
    project: Option<&str>,
    files: &[(&str, Vec<u8>)],
) -> (String, String) {
    let now = Instant::now();
    let page = k
        .create(
            &Actor::Human,
            &NewNote {
                kind: Kind::Page,
                title: title.to_owned(),
                date: "2026-10-10".to_owned(),
                project: project.map(str::to_owned),
                parent: None,
                template: None,
                icon: None,
            },
            now,
        )
        .unwrap();
    k.set_meta(&Actor::Human, &page.meta.path, "layout", Some("smart"), now)
        .unwrap();
    for (rel, bytes) in files {
        k.smart_write_file(&Actor::Human, &page.meta.path, rel, bytes, Some(""), now)
            .unwrap();
    }
    k.commit_edits().unwrap();
    (page.meta.path, page.meta.id.unwrap())
}

pub fn smart() -> Smart {
    let vault = vault();
    let (path, id) = add_page(&vault.kasten, "Tracker", &files());
    let rt = Runtime::default();
    let frame = rt.open_frame(&id).unwrap();
    Smart {
        vault,
        path,
        id,
        rt,
        frame,
    }
}

/// Sets the agent mode of the vault, and of some projects.
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
            .collect(),
        ..AgentsConfig::default()
    });
    k.set_config(config).unwrap();
}
