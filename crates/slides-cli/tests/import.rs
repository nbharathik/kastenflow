//! `slides import`: a PowerPoint file to a deck, with its pictures beside it and everything the
//! import could not do exactly listed.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn slides(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_slides"))
        .args(args)
        .output()
        .expect("the slides binary runs")
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

/// A folder of this test's own, made fresh names each time by the test's name.
fn folder(name: &str) -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join(format!("slides-import-{name}"));
    fs::create_dir_all(&dir).unwrap_or_else(|e| panic!("{}: {e}", dir.display()));
    dir
}

fn fixture(name: &str) -> String {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/decks/pptx")
        .join(name)
        .to_string_lossy()
        .into_owned()
}

fn pictures(dir: &Path) -> Vec<String> {
    let mut found: Vec<String> = fs::read_dir(dir.join("assets"))
        .map(|list| {
            list.filter_map(Result::ok)
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    found.sort();
    found
}

#[test]
fn a_pptx_becomes_a_deck_with_its_pictures_beside_it_and_a_list_of_what_was_kept() {
    let dir = folder("basic");
    let deck = dir.join("talk.deck");
    let deck_arg = deck.to_string_lossy().into_owned();
    let out = slides(&["import", &fixture("python-pptx.pptx"), "-o", &deck_arg]);
    assert!(out.status.success(), "{}", text(&out.stderr));
    let said = text(&out.stdout);
    assert!(
        said.contains("9 slides, 1 hidden, 2 pictures, 3 kept as they were"),
        "{said}"
    );
    let warned = text(&out.stderr);
    // Each warning names the slide it is about, counting from 1.
    assert!(
        warned.contains("slide 3: ") && warned.contains("chart was kept as it was"),
        "{warned}"
    );
    assert!(
        warned.contains("SmartArt diagram was kept as it was"),
        "{warned}"
    );

    let valid = slides(&["validate", &deck_arg]);
    assert!(valid.status.success(), "{}", text(&valid.stderr));
    let names = pictures(&dir);
    assert_eq!(names.len(), 2, "{names:?}");
    assert!(names.iter().all(|n| n.ends_with(".png")));

    // Doing it again changes nothing and is not refused.
    let again = slides(&["import", &fixture("python-pptx.pptx"), "-o", &deck_arg]);
    assert!(again.status.success(), "{}", text(&again.stderr));
    assert_eq!(pictures(&dir), names);
}

#[test]
fn the_pictures_go_where_assets_says() {
    let dir = folder("assets");
    let assets = folder("assets-elsewhere");
    let deck = dir.join("talk.deck");
    let out = slides(&[
        "import",
        &fixture("python-pptx.pptx"),
        "-o",
        &deck.to_string_lossy(),
        "--assets",
        &assets.to_string_lossy(),
    ]);
    assert!(out.status.success(), "{}", text(&out.stderr));
    assert_eq!(pictures(&assets).len(), 2);
    assert!(pictures(&dir).is_empty());
}

#[test]
fn our_own_export_and_the_libreoffice_copy_import_without_a_warning() {
    for name in ["exported.pptx", "exported-current.pptx", "libreoffice.pptx"] {
        let dir = folder(&format!("clean-{}", name.trim_end_matches(".pptx")));
        let deck = dir.join("talk.deck");
        let out = slides(&["import", &fixture(name), "-o", &deck.to_string_lossy()]);
        assert!(out.status.success(), "{name}: {}", text(&out.stderr));
        assert_eq!(text(&out.stderr), "", "{name}");
        assert!(
            text(&out.stdout).contains("6 slides"),
            "{name}: {}",
            text(&out.stdout)
        );
    }
}

#[test]
fn something_that_is_not_a_presentation_is_refused_and_writes_no_deck() {
    let dir = folder("refused");
    let fake = dir.join("fake.pptx");
    fs::write(&fake, "this is not a zip file").unwrap_or_else(|e| panic!("{e}"));
    let deck = dir.join("fake.deck");
    let out = slides(&[
        "import",
        &fake.to_string_lossy(),
        "-o",
        &deck.to_string_lossy(),
    ]);
    assert!(!out.status.success());
    assert!(
        text(&out.stderr).contains("fake.pptx"),
        "{}",
        text(&out.stderr)
    );
    assert!(!deck.exists());
    let missing = slides(&["import", "no-such-file.pptx", "-o", &deck.to_string_lossy()]);
    assert!(!missing.status.success());
    let none = slides(&["import"]);
    assert!(!none.status.success());
}

#[test]
fn the_kept_objects_get_pictures_when_libreoffice_is_there_to_draw_them() {
    // A program is there if it starts; `pdftoppm -v` ends with a failure status all the same.
    let has = |program: &str| Command::new(program).arg("-v").output().is_ok();
    if !(has("soffice") || has("libreoffice")) || !has("pdftoppm") {
        eprintln!("LibreOffice or pdftoppm is not installed; the previews are not tried");
        return;
    }
    let dir = folder("previews");
    let deck = dir.join("talk.deck");
    let out = slides(&[
        "import",
        &fixture("python-pptx.pptx"),
        "-o",
        &deck.to_string_lossy(),
        "--previews",
    ]);
    assert!(out.status.success(), "{}", text(&out.stderr));
    let body: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&deck).unwrap_or_default()).unwrap_or_default();
    let mut previews = Vec::new();
    for slide in body["slides"].as_array().into_iter().flatten() {
        for element in slide["elements"].as_array().into_iter().flatten() {
            if element["type"] == "raw" {
                previews.push(element["preview"].as_str().unwrap_or_default().to_owned());
            }
        }
    }
    assert_eq!(previews.len(), 3, "{previews:?}");
    for path in previews {
        assert!(path.starts_with("assets/preview-"), "{path}");
        assert!(dir.join(&path).exists(), "{path} is beside the deck");
    }
}
