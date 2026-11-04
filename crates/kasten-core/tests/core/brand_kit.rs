//! The brand kit: one small `.brand` file in `templates/brand/` for the vault and one for each project
//! that wants its own. Core keeps the editor's text as it is given, so a field it does not know survives
//! a round trip; a project's kit is used in place of the vault's.

use crate::common::{NOW, TempVault, dev_vault};

use kasten_core::deck::{BRAND_FOLDER, brand_head, brand_path};
use kasten_core::history::Actor;
use kasten_core::{Error, Kasten};
use serde_json::{Value, json};

/// A brand file as a value, with a field this build does not know.
fn kit_value(name: &str, accent: &str) -> Value {
    json!({
        "format": "kasten-brand",
        "formatVersion": 1,
        "name": name,
        "logo": "assets/logo.png",
        "colors": { "accent1": accent, "bg1": "#ffffff" },
        "fonts": { "heading": "Lato", "body": "Inter" },
        "theme": "Modern",
        "x-newer": { "added": "later" },
    })
}

fn text_of(value: &Value) -> String {
    let mut text = serde_json::to_string_pretty(value).unwrap();
    text.push('\n');
    text
}

fn vault() -> (TempVault, Kasten) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k)
}

#[test]
fn a_vault_with_no_kit_has_none() {
    let (_t, k) = vault();
    assert!(k.brand_kit(None).unwrap().is_none());
    assert!(k.brand_kit(Some("Talks")).unwrap().is_none());
}

#[test]
fn the_vaults_kit_is_a_file_in_templates_brand_kept_byte_for_byte() {
    let (t, k) = vault();
    let text = text_of(&kit_value("Acme", "#0b5cad"));
    let saved = k.save_brand_kit(&Actor::Human, None, &text, NOW).unwrap();
    assert_eq!(saved.path, "templates/brand/vault.brand");
    assert!(!saved.replaced && !saved.unchanged);
    assert!(saved.path.starts_with(BRAND_FOLDER));
    let on_disk = std::fs::read_to_string(t.vault.root().join(&saved.path)).unwrap();
    assert_eq!(on_disk, text, "byte for byte what the editor wrote");
    let read = k.brand_kit(None).unwrap().unwrap();
    assert_eq!(read.text, text);
    assert_eq!(read.project, None);
    let value: Value = serde_json::from_str(&read.text).unwrap();
    assert_eq!(value["x-newer"]["added"], "later");
}

#[test]
fn a_projects_kit_is_used_in_place_of_the_vaults_for_that_project_only() {
    let (_t, k) = vault();
    let vault_text = text_of(&kit_value("Acme", "#0b5cad"));
    let project_text = text_of(&kit_value("Acme Labs", "#118844"));
    k.save_brand_kit(&Actor::Human, None, &vault_text, NOW)
        .unwrap();
    let saved = k
        .save_brand_kit(&Actor::Human, Some("Acme Labs"), &project_text, NOW)
        .unwrap();
    assert_eq!(saved.path, "templates/brand/project-acme-labs.brand");
    assert_eq!(
        k.brand_kit(Some("Acme Labs")).unwrap().unwrap().text,
        project_text
    );
    assert_eq!(
        k.brand_kit(Some("Other")).unwrap().unwrap().text,
        vault_text
    );
    assert_eq!(k.brand_kit(None).unwrap().unwrap().text, vault_text);
}

#[test]
fn replacing_a_kit_keeps_the_old_text_in_the_history_and_the_same_text_writes_nothing() {
    let (_t, k) = vault();
    let first = text_of(&kit_value("Acme", "#0b5cad"));
    let saved = k.save_brand_kit(&Actor::Human, None, &first, NOW).unwrap();
    let second = text_of(&kit_value("Acme", "#118844"));
    let again = k.save_brand_kit(&Actor::Human, None, &second, NOW).unwrap();
    assert!(again.replaced && !again.unchanged);
    assert_eq!(again.path, saved.path);
    assert_eq!(k.log(Some(&saved.path), 10).unwrap().len(), 2);
    let same = k.save_brand_kit(&Actor::Human, None, &second, NOW).unwrap();
    assert!(same.unchanged);
    assert_eq!(
        k.log(Some(&saved.path), 10).unwrap().len(),
        2,
        "no commit was made"
    );
}

#[test]
fn a_file_that_is_not_a_brand_kit_is_refused_and_nothing_is_written() {
    let (t, k) = vault();
    let mut wrong_format = kit_value("Acme", "#0b5cad");
    wrong_format["format"] = json!("kasten-layout");
    let mut no_version = kit_value("Acme", "#0b5cad");
    no_version.as_object_mut().unwrap().remove("formatVersion");
    for text in [
        "not json".to_owned(),
        "[1, 2]".to_owned(),
        text_of(&wrong_format),
        text_of(&no_version),
        "x".repeat(300 * 1024),
    ] {
        let err = k
            .save_brand_kit(&Actor::Human, None, &text, NOW)
            .unwrap_err();
        assert!(matches!(err, Error::Invalid(_)), "{err:?}");
        assert!(brand_head(&text).is_err());
    }
    assert!(!t.vault.root().join("templates/brand/vault.brand").exists());
}

#[test]
fn a_project_kit_needs_the_projects_name() {
    let (_t, k) = vault();
    let text = text_of(&kit_value("Acme", "#0b5cad"));
    assert!(brand_path(Some("   ")).is_err());
    assert!(
        k.save_brand_kit(&Actor::Human, Some("  "), &text, NOW)
            .is_err()
    );
    assert_eq!(brand_path(None).unwrap(), "templates/brand/vault.brand");
}
