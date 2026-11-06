//! The layout library: layouts kept for every deck as small `.layout` files in `templates/layouts/`.
//! Core keeps the editor's text as it is given, so a field it does not know survives a round trip; a
//! deck never reads the library; removing a layout moves its file to the trash.

use crate::common::{NOW, TempVault, dev_vault};
use crate::deck_support::open;

use kasten_core::deck::{LAYOUT_FOLDER, layout_head};
use kasten_core::graph::Scope;
use kasten_core::history::Actor;
use kasten_core::{Error, Kasten};
use serde_json::{Value, json};

/// A library file as a value, with a field this build does not know on the file, on the layout and on
/// a slot.
fn entry_value(id: &str, label: &str) -> Value {
    json!({
        "format": "kasten-layout",
        "formatVersion": 1,
        "id": id,
        "label": label,
        "layout": {
            "label": label,
            "name": "photo-caption",
            "placeholders": [
                { "role": "title", "kind": "title", "x": 40, "y": 30, "w": 880, "h": 80, "x-future": { "keep": [1, 2] } },
                { "role": "image", "kind": "image", "x": 40, "y": 130, "w": 600, "h": 360 },
            ],
            "x-library-note": "unknown to this build",
        },
        "size": { "h": 540, "w": 960 },
        "textStyles": {},
        "x-newer": { "added": "later" },
    })
}

/// A library file's text as the editor writes it (sorted keys, two-space indent).
fn text_of(value: &Value) -> String {
    let mut text = serde_json::to_string_pretty(value).unwrap();
    text.push('\n');
    text
}

fn entry(id: &str, label: &str) -> String {
    text_of(&entry_value(id, label))
}

fn vault() -> (TempVault, Kasten) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k)
}

#[test]
fn a_saved_layout_is_a_file_in_templates_layouts_kept_byte_for_byte() {
    let (t, k) = vault();
    let text = entry("L-one", "Photo caption");
    let saved = k.save_library_layout(&Actor::Human, &text, NOW).unwrap();
    assert_eq!(saved.path, "templates/layouts/photo-caption.layout");
    assert!(!saved.replaced && !saved.unchanged);
    let on_disk = std::fs::read_to_string(t.vault.root().join(&saved.path)).unwrap();
    assert_eq!(on_disk, text, "byte for byte what the editor wrote");

    let listed = k.layout_library().unwrap();
    assert_eq!(listed.len(), 1);
    let one = &listed[0];
    assert_eq!(
        (
            one.id.as_str(),
            one.label.as_str(),
            one.slots,
            one.path.as_str()
        ),
        ("L-one", "Photo caption", 2, saved.path.as_str())
    );
    assert!(one.problem.is_none());
    assert_eq!(k.library_layout(&saved.path).unwrap().text, text);
}

#[test]
fn a_field_core_does_not_know_survives_a_save_a_replace_and_a_read() {
    let (_t, k) = vault();
    let first = entry("L-one", "Photo caption");
    let saved = k.save_library_layout(&Actor::Human, &first, NOW).unwrap();
    // The editor saves it again with a changed slot and every other field as it was.
    let second = first.replace("\"w\": 600", "\"w\": 640");
    assert_ne!(first, second);
    let again = k.save_library_layout(&Actor::Human, &second, NOW).unwrap();
    assert!(again.replaced && !again.unchanged);
    assert_eq!(again.path, saved.path, "the file keeps its name");
    let text = k.library_layout(&saved.path).unwrap().text;
    assert_eq!(text, second);
    let value: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(value["x-newer"]["added"], "later");
    assert_eq!(value["layout"]["x-library-note"], "unknown to this build");
    assert_eq!(value["layout"]["placeholders"][0]["x-future"]["keep"][1], 2);
    assert_eq!(k.layout_library().unwrap().len(), 1, "still one entry");
}

#[test]
fn a_replaced_layout_leaves_its_old_text_in_the_history() {
    let (_t, k) = vault();
    let first = entry("L-one", "Photo caption");
    let saved = k.save_library_layout(&Actor::Human, &first, NOW).unwrap();
    k.save_library_layout(
        &Actor::Human,
        &first.replace("\"w\": 600", "\"w\": 640"),
        NOW,
    )
    .unwrap();
    let log = k.log(Some(&saved.path), 10).unwrap();
    assert_eq!(log.len(), 2, "one commit for the save, one for the replace");
}

#[test]
fn saving_the_same_text_again_writes_nothing() {
    let (_t, k) = vault();
    let text = entry("L-one", "Photo caption");
    let saved = k.save_library_layout(&Actor::Human, &text, NOW).unwrap();
    let before = k.log(Some(&saved.path), 10).unwrap().len();
    let again = k.save_library_layout(&Actor::Human, &text, NOW).unwrap();
    assert!(again.unchanged && again.replaced);
    assert_eq!(
        k.log(Some(&saved.path), 10).unwrap().len(),
        before,
        "no commit was made"
    );
}

#[test]
fn a_new_id_with_a_name_in_use_gets_the_next_free_file_and_replaces_nothing() {
    let (_t, k) = vault();
    let a = k
        .save_library_layout(&Actor::Human, &entry("L-a", "Mine"), NOW)
        .unwrap();
    let b = k
        .save_library_layout(&Actor::Human, &entry("L-b", "Mine"), NOW)
        .unwrap();
    assert_eq!(
        (a.path.as_str(), b.path.as_str()),
        (
            "templates/layouts/mine.layout",
            "templates/layouts/mine-2.layout"
        )
    );
    let mut ids: Vec<String> = k
        .layout_library()
        .unwrap()
        .into_iter()
        .map(|l| l.id)
        .collect();
    ids.sort();
    assert_eq!(ids, ["L-a", "L-b"]);
}

#[test]
fn a_layout_needs_the_envelope_and_a_layout() {
    let (_t, k) = vault();
    let change = |edit: fn(&mut Value)| {
        let mut value = entry_value("L-one", "Fine");
        edit(&mut value);
        text_of(&value)
    };
    let big = format!(
        "{{\"format\":\"kasten-layout\",\"formatVersion\":1,\"id\":\"x\",\"label\":\"X\",\"layout\":{{}},\"pad\":\"{}\"}}",
        "x".repeat(1 << 20)
    );
    let broken = [
        ("not JSON", "not json".to_owned()),
        ("not an object", "[]".to_owned()),
        ("format", change(|v| v["format"] = json!("kasten-deck"))),
        ("version", change(|v| v["formatVersion"] = json!(0))),
        ("id with a slash", change(|v| v["id"] = json!("a/b"))),
        ("no id", change(|v| v["id"] = json!(""))),
        ("blank name", change(|v| v["label"] = json!("  "))),
        ("two-line name", change(|v| v["label"] = json!("a\nb"))),
        ("no layout", change(|v| v["layout"] = json!([]))),
        ("too large", big),
    ];
    for (what, text) in broken {
        let err = k
            .save_library_layout(&Actor::Human, &text, NOW)
            .unwrap_err();
        assert!(matches!(err, Error::Invalid(_)), "{what}: {err:?}");
        assert!(
            err.to_string().contains("Not a KastenFlow layout"),
            "{what}: {err}"
        );
    }
    assert!(k.layout_library().unwrap().is_empty());
    assert!(layout_head(&entry("L-one", "Fine")).is_ok());
}

#[test]
fn a_file_that_cannot_be_used_is_listed_with_its_problem_and_does_not_hide_the_rest() {
    let (t, k) = vault();
    k.save_library_layout(&Actor::Human, &entry("L-one", "Photo caption"), NOW)
        .unwrap();
    let odd = t.vault.root().join(LAYOUT_FOLDER).join("odd.layout");
    std::fs::write(&odd, "not a layout").unwrap();
    let listed = k.layout_library().unwrap();
    assert_eq!(listed.len(), 2);
    let bad = listed.iter().find(|l| l.problem.is_some()).unwrap();
    assert_eq!((bad.label.as_str(), bad.id.as_str()), ("odd", ""));
    assert!(
        listed
            .iter()
            .any(|l| l.id == "L-one" && l.problem.is_none())
    );
}

#[test]
fn the_library_is_not_a_deck_or_a_graph_node() {
    let (_t, k, _s, path, _text) = open();
    k.save_library_layout(&Actor::Human, &entry("L-one", "Photo caption"), NOW)
        .unwrap();
    let decks = k.decks().unwrap();
    assert!(decks.iter().any(|d| d.path == path));
    assert!(decks.iter().all(|d| !d.path.ends_with(".layout")));
    assert!(k.deck_templates().unwrap().is_empty());
    let g = k.graph(&Scope::Vault).unwrap();
    assert!(g.nodes.iter().all(|n| !n.id.contains("layouts/")));
}

#[test]
fn a_deck_opens_with_no_library() {
    let (_t, k, _s, path, text) = open();
    let saved = k
        .save_library_layout(&Actor::Human, &entry("L-one", "Photo caption"), NOW)
        .unwrap();
    k.remove_library_layout(&Actor::Human, &saved.path, NOW)
        .unwrap();
    assert!(k.layout_library().unwrap().is_empty());
    assert_eq!(k.deck(&path).unwrap().text, text);
}

#[test]
fn removing_a_layout_moves_its_file_to_the_trash_and_keeps_every_byte() {
    let (t, k) = vault();
    let text = entry("L-one", "Photo caption");
    let saved = k.save_library_layout(&Actor::Human, &text, NOW).unwrap();
    let trashed = k
        .remove_library_layout(&Actor::Human, &saved.path, NOW)
        .unwrap();
    assert!(
        trashed.starts_with(".trash/")
            && trashed.ends_with("/templates/layouts/photo-caption.layout"),
        "{trashed}"
    );
    assert!(!t.vault.root().join(&saved.path).exists());
    assert_eq!(
        std::fs::read_to_string(t.vault.root().join(&trashed)).unwrap(),
        text,
        "nothing was lost"
    );
    assert!(k.layout_library().unwrap().is_empty());
    // The same id can be saved again: it is a new file.
    let back = k.save_library_layout(&Actor::Human, &text, NOW).unwrap();
    assert!(!back.replaced);
}

#[test]
fn only_files_of_the_library_can_be_read_or_removed() {
    let (_t, k) = vault();
    for path in [
        "library/x.layout",
        "templates/layouts/../x.layout",
        "templates/layouts/x.md",
        "/etc/passwd",
        "templates/layoutsx/a.layout",
    ] {
        assert!(k.library_layout(path).is_err(), "{path}");
        assert!(
            k.remove_library_layout(&Actor::Human, path, NOW).is_err(),
            "{path}"
        );
    }
    let missing = k
        .library_layout("templates/layouts/none.layout")
        .unwrap_err();
    assert!(matches!(missing, Error::NotFound(_)), "{missing:?}");
}
