//! The tools that put a picture, a citation and a page into a LaTeX document:
//! listed only while the plugin is on, plain in their words, each with its
//! refusals, under the same modes as every agent write, and one undo for a
//! session of them. A diagram becomes a figure through the app's window, and
//! that tool is tested in `figure_tools.rs`.

mod common;

use std::fs;
use std::path::Path;
use std::sync::Mutex;

use common::{Client, TempDir, vault};
use kasten_core::agent::Session;
use kasten_core::config_keys::{AgentMode, AgentsConfig};
use kasten_core::history::Actor;
use kasten_core::{Instant, Kasten};
use kasten_mcp::tools::{Writes, call, call_in, specs};
use serde_json::json;

const BASE: &str = "projects/photo-organiser/latex";
const ARTICLE: &str = "projects/photo-organiser/latex/article";
const MAIN: &str = "projects/photo-organiser/latex/article/main.tex";
const NEW_TOOLS: [&str; 3] = ["latex_add_asset", "latex_cite", "latex_send_page"];
const SENTENCE: &str = "We sample the signal at a fixed rate and subtract the mean.";
/// A 1 by 1 PNG, as base64.
const PNG64: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PAGE: &str = "library/paper-notes.md";
const PAGE_TEXT: &str = "---\nid: 01M36TME401SP99RN33Y20QVVB\ntitle: Paper notes\ntype: page\ncreated: 2026-09-23T11:48:00+02:00\nupdated: 2026-09-23T11:48:00+02:00\n---\n# Paper notes\n\nCosts 100% & $5, see [@vaswani2017attention].\n\n## Method\n\nWe **sample** the signal.\n";

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

/// A vault with an article, a locked document and a page, and the plugin on.
fn open() -> (TempDir, Kasten, Session) {
    let v = vault();
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/latex");
    for name in ["article", "twocolumn"] {
        copy_dir(&fixtures.join(name), &v.0.join(BASE).join(name));
    }
    fs::write(v.0.join(PAGE), PAGE_TEXT).unwrap();
    let k = Kasten::open(&v.0).unwrap();
    k.set_plugin_enabled(&Actor::Human, "latex", true, Instant::now())
        .unwrap();
    (v, k, Session::start("claude-code", Instant::now()))
}

fn text_of(v: &TempDir, path: &str) -> String {
    fs::read_to_string(v.0.join(path)).unwrap()
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
fn the_new_tools_are_listed_only_while_the_plugin_is_on_and_the_figure_tool_with_both_plugins() {
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
    // A diagram becomes a figure through the app's window, so with the diagram plugin on too it is offered
    // (tests/figure_tools.rs holds the rest of what it does).
    assert!(tools.iter().any(|t| t == "diagram_to_latex_figure"));
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
    // The instructions carry the rule about charts.
    assert!(on.instructions.contains("never runs Python or any program"));
    assert!(on.instructions.contains("`latex_add_asset`"));
}

#[test]
fn a_plugin_that_is_off_turns_the_new_tools_away_in_process_too() {
    let (_v, k, s) = open();
    k.set_plugin_enabled(&Actor::Human, "latex", false, Instant::now())
        .unwrap();
    for tool in NEW_TOOLS {
        let why = call(&k, &s, tool, json!({"doc": "article", "page": PAGE})).unwrap_err();
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
            "AgentOp",
        ] {
            assert!(!spec.description.contains(jargon), "{name}: {jargon}");
        }
    }
    assert_eq!(required("latex_add_asset"), ["doc", "name"]);
    assert_eq!(required("latex_cite"), ["doc", "file", "key"]);
    assert_eq!(required("latex_send_page"), ["page"]);
    let asset = all.iter().find(|s| s.name == "latex_add_asset").unwrap();
    for needle in ["never runs Python", "PNG", "\\includegraphics", "SVG"] {
        assert!(asset.description.contains(needle), "{needle}");
    }
    let properties = &asset.input_schema["properties"];
    assert!(properties["base64"].is_object() && properties["vault_path"].is_object());
}

#[test]
fn latex_add_asset_keeps_a_picture_and_gives_the_path_for_includegraphics() {
    let (v, k, s) = open();
    let told = call(
        &k,
        &s,
        "latex_add_asset",
        json!({"doc": "article", "name": "results.png", "base64": PNG64}),
    )
    .unwrap();
    assert_eq!(told["status"], json!("done"), "{told}");
    let result = &told["result"];
    assert_eq!(result["status"], json!("added"));
    assert_eq!(result["figure"], json!("figures/results.png"));
    assert_eq!(
        result["include"],
        json!("\\includegraphics[width=\\linewidth]{figures/results.png}")
    );
    let kept = fs::read(v.0.join(ARTICLE).join("figures/results.png")).unwrap();
    assert_eq!(&kept[..8], b"\x89PNG\r\n\x1a\n");
    // The same picture again is the same file; a picture already in the vault works too.
    let again = call(
        &k,
        &s,
        "latex_add_asset",
        json!({"doc": "article", "name": "other.png", "base64": PNG64}),
    )
    .unwrap();
    assert_eq!(again["result"]["status"], json!("existing"), "{again}");
    fs::create_dir_all(v.0.join("assets")).unwrap();
    fs::write(v.0.join("assets/mine.png"), &kept).unwrap();
    let from_vault = call(
        &k,
        &s,
        "latex_add_asset",
        json!({"doc": "article", "name": "mine.png", "vault_path": "assets/mine.png"}),
    )
    .unwrap();
    assert_eq!(from_vault["result"]["status"], json!("existing"));
}

#[test]
fn latex_add_asset_refuses_what_is_not_a_picture_a_locked_document_and_a_path_outside() {
    let (v, k, s) = open();
    let before = fs::read_dir(v.0.join(ARTICLE)).unwrap().count();
    let svg = "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4="; // <svg xmlns="http://www.w3.org/2000/svg"/>
    let flagged = call(
        &k,
        &s,
        "latex_add_asset",
        json!({"doc": "article", "name": "drawing.svg", "base64": svg}),
    )
    .unwrap();
    assert!(
        flagged["result"]["note"]
            .as_str()
            .unwrap()
            .contains("svg package"),
        "{flagged}"
    );
    for (args, wanted) in [
        (
            json!({"doc": "article", "name": "tool.exe", "base64": "TVqQAAMAAAA="}),
            "never keeps a program",
        ),
        (
            json!({"doc": "article", "name": "a.png", "base64": "aGVsbG8="}),
            "not a PNG",
        ),
        (
            json!({"doc": "twocolumn", "name": "a.png", "base64": PNG64}),
            "locked",
        ),
        (
            json!({"doc": "article", "name": "a.png", "vault_path": "../escape.png"}),
            "not a path inside the vault",
        ),
        (
            json!({"doc": "article", "name": "a.png"}),
            "either as base64",
        ),
        (
            json!({"doc": "nothing-like-it", "name": "a.png", "base64": PNG64}),
            "No LaTeX document",
        ),
    ] {
        let why = call(&k, &s, "latex_add_asset", args.clone()).unwrap_err();
        assert!(why.contains(wanted), "{args}: {why}");
    }
    // Only the SVG's folder was added.
    assert_eq!(fs::read_dir(v.0.join(ARTICLE)).unwrap().count(), before + 1);
    assert!(!v.0.join(ARTICLE).join("figures/a.png").exists());
}

#[test]
fn a_picture_is_never_held_but_a_chat_that_previews_changes_does_not_hold_it_either() {
    let (v, k, s) = open();
    set_mode(&k, AgentMode::Review);
    let told = call(
        &k,
        &s,
        "latex_add_asset",
        json!({"doc": "article", "name": "results.png", "base64": PNG64}),
    )
    .unwrap();
    assert_eq!(told["status"], json!("done"), "{told}");
    let set = Mutex::new(k.begin_changes(&s, Instant::now()));
    let why = call_in(
        &k,
        &s,
        Writes::Staged(&set),
        "latex_add_asset",
        json!({"doc": "article", "name": "second.png", "base64": PNG64}),
    )
    .unwrap_err();
    assert!(
        why.contains("cannot be held with the other changes"),
        "{why}"
    );
    assert!(!v.0.join(ARTICLE).join("figures/second.png").exists());
}

#[test]
fn latex_cite_writes_the_citation_and_keeps_the_entry_once() {
    let (v, k, s) = open();
    let before = text_of(&v, MAIN);
    let args = json!({"doc": "article", "file": "main.tex", "key": "vaswani2017attention", "at": SENTENCE});
    let told = call(&k, &s, "latex_cite", args.clone()).unwrap();
    assert_eq!(told["status"], json!("done"), "{told}");
    assert_eq!(told["file"], json!("main.tex"));
    assert_eq!(told["result"]["bib"]["added"], json!(true));
    assert_eq!(
        text_of(&v, MAIN),
        before.replacen(
            SENTENCE,
            &format!("{SENTENCE} \\cite{{vaswani2017attention}}"),
            1
        )
    );
    let bib = text_of(&v, &format!("{ARTICLE}/references.bib"));
    assert_eq!(
        bib.matches("@inproceedings{vaswani2017attention,").count(),
        1
    );
    let args = json!({"doc": "article", "file": "main.tex", "key": "vaswani2017attention"});
    let again = call(&k, &s, "latex_cite", args).unwrap();
    assert_eq!(again["result"]["bib"]["added"], json!(false));
    assert_eq!(
        text_of(&v, &format!("{ARTICLE}/references.bib")),
        bib,
        "the entry is there once"
    );
}

#[test]
fn latex_cite_refuses_an_unknown_key_a_locked_document_and_a_place_that_is_not_one() {
    let (v, k, s) = open();
    let before = text_of(&v, MAIN);
    for (args, wanted) in [
        (
            json!({"doc": "article", "file": "main.tex", "key": "nobody1999"}),
            "no reference with the key",
        ),
        (
            json!({"doc": "article", "file": "main.tex", "key": "a}b"}),
            "cannot be a key",
        ),
        (
            json!({"doc": "twocolumn", "file": "main.tex", "key": "vaswani2017attention"}),
            "locked",
        ),
        (
            json!({"doc": "article", "file": "main.tex", "key": "vaswani2017attention", "at": "\\section"}),
            "matches once",
        ),
        (
            json!({"doc": "article", "file": "kasten-latex.yaml", "key": "vaswani2017attention"}),
            "",
        ),
        (
            json!({"doc": "article", "file": "../x.tex", "key": "vaswani2017attention"}),
            "not a file of the document",
        ),
    ] {
        let why = call(&k, &s, "latex_cite", args.clone()).unwrap_err();
        assert!(why.contains(wanted), "{args}: {why}");
    }
    assert_eq!(text_of(&v, MAIN), before);
    // Where the user reviews changes, the citation waits.
    set_mode(&k, AgentMode::Review);
    let held = call(
        &k,
        &s,
        "latex_cite",
        json!({"doc": "article", "file": "main.tex", "key": "vaswani2017attention"}),
    )
    .unwrap();
    assert_eq!(held["status"], json!("pending_review"), "{held}");
    assert_eq!(text_of(&v, MAIN), before);
}

#[test]
fn latex_send_page_makes_a_document_or_adds_to_one_and_refuses_a_locked_one() {
    let (v, k, s) = open();
    let new = call(&k, &s, "latex_send_page", json!({"page": PAGE})).unwrap();
    assert_eq!(new["status"], json!("done"), "{new}");
    assert_eq!(
        new["result"]["path"],
        json!("library/latex/paper-notes/main.tex")
    );
    let tex = text_of(&v, "library/latex/paper-notes/main.tex");
    assert!(
        tex.contains("100\\% \\& \\$5") && tex.contains("\\cite{vaswani2017attention}"),
        "{tex}"
    );
    let section = call(
        &k,
        &s,
        "latex_send_page",
        json!({"page": "Paper notes", "section": "Method", "doc": "article"}),
    )
    .unwrap();
    assert_eq!(section["result"]["appended"], json!(true), "{section}");
    let article = text_of(&v, MAIN);
    assert!(
        article.contains("\\subsection{Method}") && !article.contains("Costs"),
        "{article}"
    );
    for (args, wanted) in [
        (json!({"page": PAGE, "doc": "twocolumn"}), "locked"),
        (json!({"page": PAGE, "section": "Nope"}), "No heading"),
        (json!({"page": "nothing-like-it"}), "No note called"),
        (
            json!({"page": PAGE, "doc": "article", "title": "x"}),
            "not both",
        ),
        (
            json!({"page": PAGE, "template": "letter"}),
            "article, report and beamer",
        ),
    ] {
        let why = call(&k, &s, "latex_send_page", args.clone()).unwrap_err();
        assert!(why.contains(wanted), "{args}: {why}");
    }
    set_mode(&k, AgentMode::Review);
    let held = call(
        &k,
        &s,
        "latex_send_page",
        json!({"page": PAGE, "title": "Held"}),
    )
    .unwrap();
    assert_eq!(held["status"], json!("pending_review"), "{held}");
    assert!(!v.0.join("library/latex/held").exists());
}

#[test]
fn one_session_of_these_tools_is_taken_back_by_one_undo() {
    let (v, k, s) = open();
    let before = text_of(&v, MAIN);
    call(&k, &s, "latex_send_page", json!({"page": PAGE})).unwrap();
    call(
        &k,
        &s,
        "latex_add_asset",
        json!({"doc": "article", "name": "results.png", "base64": PNG64}),
    )
    .unwrap();
    call(
        &k,
        &s,
        "latex_cite",
        json!({"doc": "article", "file": "main.tex", "key": "vaswani2017attention"}),
    )
    .unwrap();
    let undone = k.undo_session(&s.id, Instant::now()).unwrap();
    assert!(undone.conflict.is_none());
    assert_eq!(text_of(&v, MAIN), before);
    assert!(!v.0.join(ARTICLE).join("figures/results.png").exists());
    assert!(!v.0.join(ARTICLE).join("references.bib").exists());
    assert!(!v.0.join("library/latex/paper-notes").exists());
}
