//! The catalog, the pins and the guard every plugin command calls first.

use crate::plugins::pins::{current, for_target, target};
use crate::plugins::{Scope, catalog, check, find, payload_root};

#[test]
fn the_catalog_names_the_three_plugins_with_their_defaults() {
    let all = catalog();
    let ids: Vec<&str> = all.iter().map(|p| p.id.as_str()).collect();
    assert_eq!(ids, ["diagrams", "latex", "browser"]);
    let by = |id: &str| find(id).unwrap();
    assert!(by("diagrams").default_on && by("diagrams").scope == Scope::Vault);
    assert!(!by("latex").default_on && by("latex").scope == Scope::Vault);
    assert!(!by("browser").default_on && by("browser").scope == Scope::Computer);
    assert!(by("browser").payload.is_none());
    let diagrams = by("diagrams").payload.unwrap();
    assert_eq!(diagrams.version, "32.2.0");
    assert_eq!(diagrams.size_bytes, 48_235_802);
}

#[test]
fn a_plugin_that_is_off_is_refused_with_a_sentence_that_says_where_to_turn_it_on() {
    let latex = find("latex").unwrap();
    assert_eq!(check(&latex, true), Ok(()));
    assert_eq!(
        check(&latex, false),
        Err("Turn on the LaTeX plugin in Settings → Plugins".to_owned())
    );
    let message = check(&find("diagrams").unwrap(), false).unwrap_err();
    assert!(message.contains("Diagrams") && message.contains("Settings → Plugins"));
}

#[test]
fn an_unknown_plugin_is_refused_by_name() {
    let message = find("teleport").unwrap_err();
    assert!(message.contains("teleport"), "{message}");
}

#[test]
fn the_diagram_editor_is_pinned_for_every_kind_of_computer() {
    let (version, pin) = for_target("diagrams", "riscv64-plan9").unwrap();
    assert_eq!(version, "32.2.0");
    assert!(pin.url.starts_with("https://github.com/"));
    assert_eq!(pin.sha256.len(), 64);
    assert_eq!(current("diagrams").unwrap().1, pin);
    assert!(for_target("browser", &target()).is_none());
    assert!(for_target("nothing", &target()).is_none());
}

fn scratch(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("kasten-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn the_old_editor_folder_moves_once_to_plugins_diagrams() {
    let local = scratch("migrate-once");
    let version = local.join("diagrams").join("32.2.0");
    std::fs::create_dir_all(&version).unwrap();
    std::fs::write(version.join("index.html"), "editor").unwrap();

    let root = payload_root(&local, "diagrams");
    assert_eq!(root, local.join("plugins").join("diagrams"));
    assert!(root.join("32.2.0").join("index.html").is_file());
    assert!(!local.join("diagrams").exists());

    // A second start, and a stray old folder beside the new one, change nothing.
    std::fs::create_dir_all(local.join("diagrams")).unwrap();
    std::fs::write(local.join("diagrams").join("stray"), "kept").unwrap();
    assert_eq!(payload_root(&local, "diagrams"), root);
    assert!(root.join("32.2.0").join("index.html").is_file());
    assert!(local.join("diagrams").join("stray").is_file());
    let _ = std::fs::remove_dir_all(&local);
}

#[test]
fn when_the_move_fails_the_old_folder_keeps_working() {
    let local = scratch("migrate-fails");
    let version = local.join("diagrams").join("32.2.0");
    std::fs::create_dir_all(&version).unwrap();
    std::fs::write(version.join("index.html"), "editor").unwrap();
    // "plugins" is a file, so the new folder cannot be made.
    std::fs::write(local.join("plugins"), "in the way").unwrap();

    assert_eq!(payload_root(&local, "diagrams"), local.join("diagrams"));
    assert!(version.join("index.html").is_file());
    let _ = std::fs::remove_dir_all(&local);
}

#[test]
fn payloads_live_under_plugins_in_the_local_data_folder() {
    let local = std::env::temp_dir().join(format!("kasten-plugins-root-{}", std::process::id()));
    assert_eq!(
        payload_root(&local, "latex"),
        local.join("plugins").join("latex")
    );
    assert_eq!(
        payload_root(&local, "diagrams"),
        local.join("plugins").join("diagrams")
    );
}
