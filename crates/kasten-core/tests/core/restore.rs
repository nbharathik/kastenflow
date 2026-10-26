//! Restore tools: a note or the whole vault
//! back to an earlier commit, as new commits; nothing is reset or deleted.

use crate::common;

use std::fs;

use common::{NOW, dev_vault};
use kasten_core::history::Actor;
use kasten_core::{Kasten, Kind, NewNote};

fn page(title: &str) -> NewNote {
    NewNote {
        kind: Kind::Page,
        title: title.to_owned(),
        date: "2026-09-24".to_owned(),
        project: None,
        parent: None,
        template: None,
        icon: None,
    }
}

#[test]
fn restores_one_note_to_an_older_version() {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    let path = "library/zettelkasten-method.md";
    let original = k.read(path).unwrap();
    k.save_body(&Actor::Human, path, "Rewritten.\n", &original.hash, NOW)
        .unwrap();
    k.commit_edits().unwrap();
    let first = k.log(Some(path), 10).unwrap().last().unwrap().id.clone();

    let restored = k.restore_version(&Actor::Human, path, &first, NOW).unwrap();
    assert_eq!(restored.text, original.text);
    let log = k.log(Some(path), 10).unwrap();
    assert_eq!(log.len(), 3, "a new commit, the edit is still in history");
    assert!(
        log[0]
            .summary
            .starts_with("restore: Zettelkasten method to "),
        "{}",
        log[0].summary
    );
}

#[test]
fn restores_the_whole_vault_as_a_new_commit() {
    let t = dev_vault();
    let root = t.vault.root().to_owned();
    let k = Kasten::open(&root).unwrap();
    k.start_history().unwrap();
    let start = k.log(None, 1).unwrap()[0].id.clone();
    let before = fs::read_to_string(root.join("library/zettelkasten-method.md")).unwrap();

    let added = k.create(&Actor::Human, &page("Added later"), NOW).unwrap();
    let loaded = k.read("library/zettelkasten-method.md").unwrap();
    k.save_body(
        &Actor::Human,
        "library/zettelkasten-method.md",
        "Changed.\n",
        &loaded.hash,
        NOW,
    )
    .unwrap();
    k.commit_edits().unwrap();
    k.trash(&Actor::Human, "inbox/look-at-json-canvas-spec.md", NOW)
        .unwrap();

    let report = k.restore_vault(&Actor::Human, &start, NOW).unwrap();
    assert_eq!(
        fs::read_to_string(root.join("library/zettelkasten-method.md")).unwrap(),
        before
    );
    assert!(root.join("inbox/look-at-json-canvas-spec.md").exists());
    assert!(!root.join(&added.meta.path).exists());
    // The note made later is not deleted: it waits in the trash.
    assert!(
        report
            .trashed
            .iter()
            .any(|p| p.ends_with("library/added-later.md")),
        "{report:?}"
    );
    assert!(
        k.list_trash()
            .unwrap()
            .iter()
            .any(|t| t.original == added.meta.path)
    );
    assert!(
        k.log(None, 1).unwrap()[0]
            .summary
            .starts_with("restore: vault to ")
    );
    assert!(k.dirty().unwrap().is_empty(), "{:?}", k.dirty().unwrap());
}

#[test]
fn a_whole_vault_restore_keeps_the_settings_as_they_are_now() {
    use kasten_core::config_keys::{AgentMode, AgentsConfig};
    let t = dev_vault();
    let root = t.vault.root().to_owned();
    let k = Kasten::open(&root).unwrap();
    k.start_history().unwrap();
    let start = k.log(None, 1).unwrap()[0].id.clone();
    let mut config = k.config();
    config.agents = Some(AgentsConfig {
        mode: Some(AgentMode::Review),
        ..AgentsConfig::default()
    });
    config.guardrails.max_trash_per_session = 1;
    k.set_config(config).unwrap();
    k.create(&Actor::Human, &page("Added later"), NOW).unwrap();
    k.commit_external().unwrap();
    let settings = fs::read_to_string(root.join(".kasten/config.yaml")).unwrap();

    let report = k.restore_vault(&Actor::Human, &start, NOW).unwrap();
    assert_eq!(
        fs::read_to_string(root.join(".kasten/config.yaml")).unwrap(),
        settings,
        "the settings are not part of what a restore changes"
    );
    assert!(
        !report.written.iter().any(|p| p == ".kasten/config.yaml"),
        "{report:?}"
    );
    assert_eq!(k.config().agent_mode_for(None), AgentMode::Review);
    assert_eq!(k.config().guardrails.max_trash_per_session, 1);
    assert!(k.dirty().unwrap().is_empty(), "{:?}", k.dirty().unwrap());
}

#[test]
fn a_whole_vault_restore_is_one_commit_that_undo_takes_back() {
    let t = dev_vault();
    let root = t.vault.root().to_owned();
    let k = Kasten::open(&root).unwrap();
    k.start_history().unwrap();
    let start = k.log(None, 1).unwrap()[0].id.clone();
    k.create(&Actor::Human, &page("Added later"), NOW).unwrap();
    let loaded = k.read("library/zettelkasten-method.md").unwrap();
    k.save_body(
        &Actor::Human,
        "library/zettelkasten-method.md",
        "Changed.\n",
        &loaded.hash,
        NOW,
    )
    .unwrap();
    k.commit_edits().unwrap();
    let h = kasten_core::history::History::open(&root).unwrap().unwrap();
    let before_restore = h.tree_id("HEAD").unwrap();

    let report = k.restore_vault(&Actor::Human, &start, NOW).unwrap();
    let commit = report.commit.clone().expect("the restore made a commit");
    assert_eq!(k.log(None, 1).unwrap()[0].id, commit);
    // Everything is as it was, and what was made since waits in the trash.
    let outside_trash = |rev: &str| -> Vec<(String, Vec<u8>)> {
        h.files_at(rev)
            .unwrap()
            .into_iter()
            .filter(|p| !p.starts_with(".trash/"))
            .map(|p| {
                let bytes = h.blob_at(rev, &p).unwrap().unwrap();
                (p, bytes)
            })
            .collect()
    };
    assert_eq!(outside_trash("HEAD"), outside_trash(&start));
    assert_eq!(report.trashed.len(), 1, "{report:?}");

    // Undo puts back everything the restore changed, the later note too.
    let undone = k.undo_commit(&commit, NOW).unwrap();
    assert!(undone.conflict.is_none(), "{undone:?}");
    assert_eq!(h.tree_id("HEAD").unwrap(), before_restore);
    assert_eq!(
        fs::read_to_string(root.join("library/zettelkasten-method.md")).unwrap(),
        k.read("library/zettelkasten-method.md").unwrap().text
    );
    assert!(
        k.read("library/zettelkasten-method.md")
            .unwrap()
            .text
            .contains("Changed.")
    );
}
