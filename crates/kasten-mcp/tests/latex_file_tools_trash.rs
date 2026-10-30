//! Taking a LaTeX file out of a document (it goes to the trash, never away),
//! and taking back a whole session of the file tools with one undo. The other
//! file tools are in latex_file_tools.rs.

mod common;

use std::fs;
use std::path::Path;

use common::{TempDir, vault};
use kasten_core::agent::Session;
use kasten_core::history::Actor;
use kasten_core::{Instant, Kasten};
use kasten_mcp::tools::call;
use serde_json::json;

const BASE: &str = "projects/photo-organiser/latex";
const ARTICLE: &str = "projects/photo-organiser/latex/article";
const MAIN: &str = "projects/photo-organiser/latex/article/main.tex";

fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

/// A vault with an article and a locked document, and the plugin on.
fn open() -> (TempDir, Kasten, Session) {
    let v = vault();
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/latex");
    for name in ["article", "twocolumn"] {
        copy_dir(&fixtures.join(name), &v.0.join(BASE).join(name));
    }
    let k = Kasten::open(&v.0).unwrap();
    k.set_plugin_enabled(&Actor::Human, "latex", true, Instant::now())
        .unwrap();
    (v, k, Session::start("claude-code", Instant::now()))
}

fn text_of(v: &TempDir, path: &str) -> String {
    fs::read_to_string(v.0.join(path)).unwrap()
}

fn hash_of(k: &Kasten, s: &Session, doc: &str, file: &str) -> String {
    call(k, s, "latex_read", json!({"doc": doc, "file": file})).unwrap()["hash"]
        .as_str()
        .unwrap()
        .to_owned()
}

#[test]
fn latex_delete_file_moves_a_file_to_the_trash_and_a_root_file_waits() {
    let (v, k, s) = open();
    call(
        &k,
        &s,
        "latex_write_file",
        json!({"doc": "article", "file": "refs.bib", "text": "@book{a}\n"}),
    )
    .unwrap();
    let told = call(
        &k,
        &s,
        "latex_delete_file",
        json!({"doc": "article", "file": "refs.bib"}),
    )
    .unwrap();
    assert_eq!(told["result"]["status"], json!("trashed"), "{told}");
    let trashed = told["result"]["trashed"].as_str().unwrap();
    assert!(trashed.starts_with(".trash/"));
    assert_eq!(text_of(&v, trashed), "@book{a}\n");
    assert!(!v.0.join(ARTICLE).join("refs.bib").exists());
    // The root file waits for review.
    let held = call(
        &k,
        &s,
        "latex_delete_file",
        json!({"doc": "article", "file": "main.tex"}),
    )
    .unwrap();
    assert_eq!(held["status"], json!("pending_review"), "{held}");
    assert!(v.0.join(MAIN).is_file());
    // Refusals.
    let why = call(
        &k,
        &s,
        "latex_delete_file",
        json!({"doc": "article", "file": "nope.tex"}),
    )
    .unwrap_err();
    assert!(why.contains("There is no file nope.tex"), "{why}");
    let why = call(
        &k,
        &s,
        "latex_delete_file",
        json!({"doc": "twocolumn", "file": "refs.bib"}),
    )
    .unwrap_err();
    assert!(why.contains("locked"), "{why}");
    for file in ["../../x.tex", "kasten-latex.yaml"] {
        assert!(
            call(
                &k,
                &s,
                "latex_delete_file",
                json!({"doc": "article", "file": file})
            )
            .is_err(),
            "{file}"
        );
    }
}

#[test]
fn one_session_of_these_tools_is_taken_back_by_one_undo() {
    let (v, k, s) = open();
    let before = text_of(&v, MAIN);
    call(&k, &s, "latex_create_document", json!({"title": "Undo me"})).unwrap();
    call(
        &k,
        &s,
        "latex_write_file",
        json!({"doc": "article", "file": "refs.bib", "text": "@book{a}\n"}),
    )
    .unwrap();
    let hash = hash_of(&k, &s, "article", "main.tex");
    call(
        &k,
        &s,
        "latex_append",
        json!({"doc": "article", "file": "main.tex", "text": "x\n", "after": "\\section{Method}\n", "base_hash": hash}),
    )
    .unwrap();
    call(
        &k,
        &s,
        "latex_delete_file",
        json!({"doc": "article", "file": "refs.bib"}),
    )
    .unwrap();
    let undone = k.undo_session(&s.id, Instant::now()).unwrap();
    assert!(undone.conflict.is_none());
    assert_eq!(text_of(&v, MAIN), before);
    assert!(!v.0.join("library/latex/undo-me").exists());
    assert!(!v.0.join(ARTICLE).join("refs.bib").exists());
}
