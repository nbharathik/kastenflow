//! The tools that make a LaTeX document and write, add to and take out its
//! files: listed only while the plugin is on, plain in their words, each with
//! its refusals, and under the same modes as every agent write.

mod common;

use std::fs;
use std::path::Path;

use common::{Client, TempDir, vault};
use kasten_core::agent::Session;
use kasten_core::config_keys::{AgentMode, AgentsConfig};
use kasten_core::history::Actor;
use kasten_core::{Instant, Kasten};
use kasten_mcp::tools::{call, specs};
use serde_json::{Value, json};

const BASE: &str = "projects/photo-organiser/latex";
const ARTICLE: &str = "projects/photo-organiser/latex/article";
const MAIN: &str = "projects/photo-organiser/latex/article/main.tex";
const FIVE_LINES: &str = "Hello\nline two\nline three\nline four\nline five\n";
const NEW_TOOLS: [&str; 4] = [
    "latex_create_document",
    "latex_write_file",
    "latex_append",
    "latex_delete_file",
];

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

fn set_mode(k: &Kasten, mode: AgentMode) {
    let mut config = k.config();
    config.agents = Some(AgentsConfig {
        mode: Some(mode),
        ..AgentsConfig::default()
    });
    k.set_config(config).unwrap();
}

#[test]
fn the_new_tools_are_listed_only_while_the_plugin_is_on() {
    let v = vault();
    let mut off = Client::start(&v.0, "test-agent");
    for tool in NEW_TOOLS {
        assert!(!off.tools().iter().any(|t| t == tool), "{tool} while off");
        assert!(off.call(tool, json!({})).is_err(), "{tool} while off");
    }
    drop(off);
    Kasten::open(&v.0)
        .unwrap()
        .set_plugin_enabled(&Actor::Human, "latex", true, Instant::now())
        .unwrap();
    let mut on = Client::start(&v.0, "test-agent");
    let tools = on.tools();
    for tool in NEW_TOOLS {
        assert!(tools.iter().any(|t| t == tool), "{tool} in {tools:?}");
    }
    // None of them only looks.
    let listed = on.request("tools/list", json!({}));
    for tool in NEW_TOOLS {
        let hint = listed["tools"]
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t["name"] == tool)
            .unwrap()["annotations"]["readOnlyHint"]
            .clone();
        assert_ne!(hint, json!(true), "{tool}");
    }
}

#[test]
fn a_plugin_that_is_off_turns_the_new_tools_away_in_process_too() {
    let (_v, k, s) = open();
    k.set_plugin_enabled(&Actor::Human, "latex", false, Instant::now())
        .unwrap();
    for tool in NEW_TOOLS {
        let why = call(&k, &s, tool, json!({"doc": "article", "title": "x"})).unwrap_err();
        assert_eq!(
            why, "Turn on the LaTeX plugin in Settings → Plugins",
            "{tool}"
        );
    }
}

#[test]
fn the_tools_are_described_in_plain_words_with_their_schemas() {
    let all = specs();
    let required = |name: &str| -> Vec<String> {
        let spec = all.iter().find(|s| s.name == name).unwrap();
        let mut required: Vec<String> = spec.input_schema["required"]
            .as_array()
            .map(|r| r.iter().map(|x| x.as_str().unwrap().to_owned()).collect())
            .unwrap_or_default();
        required.sort_unstable();
        required
    };
    for name in NEW_TOOLS {
        let spec = all.iter().find(|s| s.name == name).unwrap();
        assert!(!spec.read_only, "{name}");
        assert_eq!(spec.input_schema["type"], json!("object"));
        for jargon in [
            "commit",
            "sidecar",
            "SaveSource",
            "save_source",
            "dev/",
            "ADR",
        ] {
            assert!(!spec.description.contains(jargon), "{name}: {jargon}");
        }
    }
    assert_eq!(required("latex_create_document"), ["title"]);
    assert_eq!(required("latex_write_file"), ["doc", "file", "text"]);
    assert_eq!(
        required("latex_append"),
        ["base_hash", "doc", "file", "text"]
    );
    assert_eq!(required("latex_delete_file"), ["doc", "file"]);
    // The older tool no longer says a person makes new files.
    let edit = all.iter().find(|s| s.name == "latex_edit").unwrap();
    assert!(!edit.description.contains("a person adds it in the app"));
    assert!(!edit.description.contains("To make a new file"));
}

#[test]
fn latex_create_document_makes_a_folder_with_a_root_file() {
    let (v, k, s) = open();
    let told = call(
        &k,
        &s,
        "latex_create_document",
        json!({"title": "Thesis", "template": "report", "project": "photo-organiser"}),
    )
    .unwrap();
    assert_eq!(told["status"], json!("done"), "{told}");
    assert_eq!(told["result"]["folder"], json!(format!("{BASE}/thesis")));
    assert_eq!(told["result"]["main"], json!("main.tex"));
    assert!(text_of(&v, &format!("{BASE}/thesis/main.tex")).contains("\\chapter"));
    // The library by default, an article by default, and a taken name numbered.
    let lib = call(&k, &s, "latex_create_document", json!({"title": "Notes"})).unwrap();
    assert_eq!(lib["result"]["folder"], json!("library/latex/notes"));
    let again = call(
        &k,
        &s,
        "latex_create_document",
        json!({"title": "Notes", "project": ""}),
    )
    .unwrap();
    assert_eq!(again["result"]["folder"], json!("library/latex/notes-2"));
    // The new document is listed and can be read at once.
    let docs = call(&k, &s, "latex_list", Value::Null).unwrap();
    assert!(
        docs["documents"]
            .as_array()
            .unwrap()
            .iter()
            .any(|d| d["folder"] == json!("library/latex/notes"))
    );
    // Refusals say why.
    let why = call(
        &k,
        &s,
        "latex_create_document",
        json!({"title": "X", "project": "nope"}),
    )
    .unwrap_err();
    assert!(why.contains("No project called"), "{why}");
    let why = call(
        &k,
        &s,
        "latex_create_document",
        json!({"title": "X", "template": "letter"}),
    )
    .unwrap_err();
    assert!(why.contains("article, report and beamer"), "{why}");
    // Where changes are reviewed, it waits.
    set_mode(&k, AgentMode::Review);
    let held = call(&k, &s, "latex_create_document", json!({"title": "Held"})).unwrap();
    assert_eq!(held["status"], json!("pending_review"), "{held}");
    assert!(!v.0.join("library/latex/held").exists());
}

#[test]
fn latex_write_file_makes_a_new_file_or_replaces_one_against_its_hash() {
    let (v, k, s) = open();
    let new = call(
        &k,
        &s,
        "latex_write_file",
        json!({"doc": "article", "file": "sections/intro.tex", "text": FIVE_LINES}),
    )
    .unwrap();
    assert_eq!(new["result"]["status"], json!("saved"), "{new}");
    assert_eq!(new["file"], json!("sections/intro.tex"));
    assert_eq!(
        text_of(&v, &format!("{ARTICLE}/sections/intro.tex")),
        FIVE_LINES
    );
    // A .bib and a .sty too.
    for (file, text) in [
        ("refs.bib", "@book{a}\n"),
        ("my.sty", "\\ProvidesPackage{my}\n"),
    ] {
        call(
            &k,
            &s,
            "latex_write_file",
            json!({"doc": "article", "file": file, "text": text}),
        )
        .unwrap();
        assert_eq!(text_of(&v, &format!("{ARTICLE}/{file}")), text);
    }
    // A new file where one is: told to read it first.
    let why = call(
        &k,
        &s,
        "latex_write_file",
        json!({"doc": "article", "file": "sections/intro.tex", "text": "x"}),
    )
    .unwrap_err();
    assert!(
        why.contains("already a file") && why.contains("base_hash"),
        "{why}"
    );
    // A replace with the right hash, then the old one.
    let old = hash_of(&k, &s, "article", "sections/intro.tex");
    let replaced = call(
        &k,
        &s,
        "latex_write_file",
        json!({"doc": "article", "file": "sections/intro.tex", "text": FIVE_LINES.replace("three", "3"), "base_hash": old}),
    )
    .unwrap();
    assert_eq!(replaced["result"]["status"], json!("saved"), "{replaced}");
    let why = call(
        &k,
        &s,
        "latex_write_file",
        json!({"doc": "article", "file": "sections/intro.tex", "text": "x", "base_hash": old}),
    )
    .unwrap_err();
    assert!(why.contains("changed since you read it"), "{why}");
    assert_eq!(
        text_of(&v, &format!("{ARTICLE}/sections/intro.tex")),
        FIVE_LINES.replace("three", "3")
    );
    // A hash for a file that is not there.
    let why = call(
        &k,
        &s,
        "latex_write_file",
        json!({"doc": "article", "file": "gone.tex", "text": "x", "base_hash": "abc"}),
    )
    .unwrap_err();
    assert!(why.contains("There is no file gone.tex"), "{why}");
}

#[test]
fn latex_write_file_refuses_what_is_no_source_or_leaves_the_document_or_is_locked() {
    let (v, k, s) = open();
    let before = text_of(&v, MAIN);
    for file in [
        "notes.md",
        "fig.pdf",
        "../escape.tex",
        "/abs.tex",
        "a\\b.tex",
        ".git/x.tex",
    ] {
        assert!(
            call(
                &k,
                &s,
                "latex_write_file",
                json!({"doc": "article", "file": file, "text": "x"})
            )
            .is_err(),
            "{file}"
        );
    }
    let big = "a".repeat(kasten_core::latex::MAX_SOURCE_BYTES + 1);
    let why = call(
        &k,
        &s,
        "latex_write_file",
        json!({"doc": "article", "file": "big.tex", "text": big}),
    )
    .unwrap_err();
    assert!(why.contains("KB"), "{why}");
    let why = call(
        &k,
        &s,
        "latex_write_file",
        json!({"doc": "twocolumn", "file": "new.tex", "text": "x"}),
    )
    .unwrap_err();
    assert!(why.contains("locked"), "{why}");
    // Much taken out waits for review.
    let hash = hash_of(&k, &s, "article", "main.tex");
    let held = call(
        &k,
        &s,
        "latex_write_file",
        json!({"doc": "article", "file": "main.tex", "text": "\\documentclass{article}\n", "base_hash": hash}),
    )
    .unwrap();
    assert_eq!(held["status"], json!("pending_review"), "{held}");
    assert_eq!(text_of(&v, MAIN), before);
}

#[test]
fn latex_append_adds_at_the_end_or_after_a_marker_and_keeps_every_other_byte() {
    let (v, k, s) = open();
    let before = text_of(&v, MAIN);
    let hash = hash_of(&k, &s, "article", "main.tex");
    let told = call(
        &k,
        &s,
        "latex_append",
        json!({"doc": "article", "file": "main.tex", "text": "Added.\n", "after": "\\section{Method}\n", "base_hash": hash}),
    )
    .unwrap();
    assert_eq!(told["status"], json!("done"), "{told}");
    assert_eq!(told["file"], json!("main.tex"));
    assert_eq!(
        text_of(&v, MAIN),
        before.replace("\\section{Method}\n", "\\section{Method}\nAdded.\n")
    );
    // At the end, with the warning that it is past the end of the document.
    let hash = hash_of(&k, &s, "article", "main.tex");
    let end = call(
        &k,
        &s,
        "latex_append",
        json!({"doc": "article", "file": "main.tex", "text": "% x\n", "base_hash": hash}),
    )
    .unwrap();
    assert!(
        end["result"]["note"]
            .as_str()
            .unwrap()
            .contains("end{document}"),
        "{end}"
    );
}

#[test]
fn latex_append_refuses_a_stale_hash_a_missing_or_double_marker_and_a_locked_document() {
    let (v, k, s) = open();
    let before = text_of(&v, MAIN);
    let hash = hash_of(&k, &s, "article", "main.tex");
    let append = |after: Option<&str>, hash: &str| {
        call(
            &k,
            &s,
            "latex_append",
            json!({"doc": "article", "file": "main.tex", "text": "x\n", "after": after, "base_hash": hash}),
        )
    };
    let why = append(Some("nothing like this"), &hash).unwrap_err();
    assert!(why.contains("is not in main.tex"), "{why}");
    let why = append(Some("\\section"), &hash).unwrap_err();
    assert!(
        why.contains("times") && why.contains("matches once"),
        "{why}"
    );
    let why = append(None, "0000").unwrap_err();
    assert!(why.contains("changed since you read it"), "{why}");
    assert_eq!(text_of(&v, MAIN), before);
    let locked = hash_of(&k, &s, "twocolumn", "main.tex");
    let why = call(
        &k,
        &s,
        "latex_append",
        json!({"doc": "twocolumn", "file": "main.tex", "text": "x\n", "base_hash": locked}),
    )
    .unwrap_err();
    assert!(why.contains("locked"), "{why}");
    // In Review mode the append waits.
    set_mode(&k, AgentMode::Review);
    let held = append(None, &hash).unwrap();
    assert_eq!(held["status"], json!("pending_review"), "{held}");
    assert_eq!(text_of(&v, MAIN), before);
}
