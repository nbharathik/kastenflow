//! The generator library: code pictures kept for every deck as small `.generator` files in
//! `templates/generators/`. Core keeps the editor's text as it is given, a bad file is refused before
//! anything is written, and the starter library of the dev vault is all usable.

use crate::common::{NOW, TempVault, dev_vault};

use kasten_core::deck::{GENERATOR_FOLDER, generator_head};
use kasten_core::history::Actor;
use kasten_core::{Error, Kasten};
use serde_json::{Value, json};

fn entry_value(id: &str, label: &str, code: &str) -> Value {
    json!({
        "format": "kasten-generator",
        "formatVersion": 1,
        "id": id,
        "label": label,
        "generator": {
            "language": "js",
            "code": code,
            "inputs": [{ "name": "sales", "kind": "data", "value": "a,b\n1,2\n" }],
            "output": "svg",
            "x-future": { "keep": [1, 2] },
        },
        "x-newer": { "added": "later" },
    })
}

fn text_of(value: &Value) -> String {
    let mut text = serde_json::to_string_pretty(value).unwrap();
    text.push('\n');
    text
}

fn entry(id: &str, label: &str) -> String {
    text_of(&entry_value(id, label, "return kit.svg(100, 50);"))
}

fn vault() -> (TempVault, Kasten) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k)
}

#[test]
fn a_saved_code_picture_is_a_file_in_templates_generators_kept_byte_for_byte() {
    let (t, k) = vault();
    let before = k.generator_library().unwrap().len();
    let text = entry("G-one", "Sales bars");
    let saved = k.save_library_generator(&Actor::Human, &text, NOW).unwrap();
    assert_eq!(saved.path, "templates/generators/sales-bars.generator");
    assert!(!saved.replaced && !saved.unchanged);
    let on_disk = std::fs::read_to_string(t.vault.root().join(&saved.path)).unwrap();
    assert_eq!(on_disk, text, "byte for byte what the editor wrote");

    let listed = k.generator_library().unwrap();
    assert_eq!(listed.len(), before + 1);
    let one = listed.iter().find(|g| g.id == "G-one").unwrap();
    assert_eq!(
        (
            one.label.as_str(),
            one.language.as_str(),
            one.output.as_str()
        ),
        ("Sales bars", "js", "svg")
    );
    assert!(one.problem.is_none());
    assert_eq!(k.library_generator(&saved.path).unwrap().text, text);
}

#[test]
fn the_same_id_replaces_its_file_and_a_new_id_never_replaces_another() {
    let (_t, k) = vault();
    let first = k
        .save_library_generator(&Actor::Human, &entry("G-a", "Mine"), NOW)
        .unwrap();
    let other = k
        .save_library_generator(&Actor::Human, &entry("G-b", "Mine"), NOW)
        .unwrap();
    assert_eq!(
        (first.path.as_str(), other.path.as_str()),
        (
            "templates/generators/mine.generator",
            "templates/generators/mine-2.generator"
        )
    );
    let changed = text_of(&entry_value("G-a", "Mine", "return kit.svg(200, 80);"));
    let again = k
        .save_library_generator(&Actor::Human, &changed, NOW)
        .unwrap();
    assert!(again.replaced && !again.unchanged);
    assert_eq!(again.path, first.path);
    assert_eq!(k.library_generator(&first.path).unwrap().text, changed);
    // The same text again writes nothing.
    let same = k
        .save_library_generator(&Actor::Human, &changed, NOW)
        .unwrap();
    assert!(same.unchanged);
    // The other entry is as it was.
    assert_eq!(
        k.library_generator(&other.path).unwrap().text,
        entry("G-b", "Mine")
    );
}

#[test]
fn a_file_that_is_not_a_code_picture_is_refused_before_anything_is_written() {
    let (t, k) = vault();
    let mut bad: Vec<String> = vec![
        "not json".into(),
        "[]".into(),
        text_of(&json!({ "format": "kasten-layout", "formatVersion": 1 })),
    ];
    let mut no_version = entry_value("G-x", "X", "return 1");
    no_version.as_object_mut().unwrap().remove("formatVersion");
    bad.push(text_of(&no_version));
    for id in ["", "has space", "a/b"] {
        bad.push(text_of(&entry_value(id, "X", "return 1")));
    }
    bad.push(text_of(&entry_value("G-x", "two\nlines", "return 1")));
    bad.push(text_of(&entry_value("G-x", "X", "   ")));
    let mut python = entry_value("G-x", "X", "print(1)");
    python["generator"]["language"] = json!("python");
    bad.push(text_of(&python));
    let mut gif = entry_value("G-x", "X", "return 1");
    gif["generator"]["output"] = json!("gif");
    bad.push(text_of(&gif));
    for text in &bad {
        assert!(generator_head(text).is_err(), "{text}");
        let err = k
            .save_library_generator(&Actor::Human, text, NOW)
            .unwrap_err();
        assert!(matches!(err, Error::Invalid(_)), "{err:?}");
    }
    assert!(
        !t.vault
            .root()
            .join("templates/generators/x.generator")
            .exists()
    );
}

#[test]
fn only_files_in_the_library_are_read() {
    let (_t, k) = vault();
    for path in [
        "templates/generators/../x.generator",
        "templates/generators/x.md",
        "templates/generatorsx/a.generator",
        "notes/a.generator",
        "/templates/generators/a.generator",
    ] {
        assert!(k.library_generator(path).is_err(), "{path}");
    }
    assert!(matches!(
        k.library_generator("templates/generators/none.generator"),
        Err(Error::NotFound(_))
    ));
}

#[test]
fn a_program_reads_a_text_file_of_assets_and_nothing_else() {
    let (t, k) = vault();
    let assets = t.vault.root().join("assets");
    std::fs::create_dir_all(&assets).unwrap();
    std::fs::write(assets.join("sales.csv"), "a,b\n1,2\n").unwrap();
    std::fs::write(assets.join("binary.csv"), [0xff, 0xfe, 0x00]).unwrap();
    std::fs::write(assets.join("big.csv"), vec![b'x'; 1024 * 1024 + 1]).unwrap();
    assert_eq!(k.read_text_asset("assets/sales.csv").unwrap(), "a,b\n1,2\n");
    for path in [
        "library/sales.csv",
        "assets/photo.png",
        "assets/sales",
        "/assets/sales.csv",
        "assets/../sales.csv",
        "assets/.hidden.csv",
        "sales.csv",
    ] {
        assert!(k.read_text_asset(path).is_err(), "{path}");
    }
    assert!(matches!(
        k.read_text_asset("assets/missing.csv"),
        Err(Error::NotFound(_))
    ));
    assert!(matches!(
        k.read_text_asset("assets/binary.csv"),
        Err(Error::Invalid(_))
    ));
    assert!(matches!(
        k.read_text_asset("assets/big.csv"),
        Err(Error::Invalid(_))
    ));
    // A folder is no file.
    std::fs::create_dir_all(assets.join("folder.csv")).unwrap();
    assert!(k.read_text_asset("assets/folder.csv").is_err());
}

#[test]
fn the_starter_library_of_the_dev_vault_is_all_usable() {
    let (_t, k) = vault();
    let listed = k.generator_library().unwrap();
    for name in [
        "Bar chart",
        "Line chart",
        "Timeline",
        "2x2 matrix",
        "Funnel",
        "Org chart",
        "Icon grid",
    ] {
        let found = listed.iter().find(|g| g.label == name);
        let found = found.unwrap_or_else(|| panic!("{name} is not in the starter library"));
        assert!(found.problem.is_none(), "{name}: {:?}", found.problem);
        assert!(found.path.starts_with(GENERATOR_FOLDER));
    }
}
