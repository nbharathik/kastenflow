//! The LaTeX tools: listed only while the LaTeX plugin is on, reads that
//! change nothing, and a change that goes through the same guardrails as every
//! agent write (a stale hash, a locked document, much of a file taken out).

mod common;

use std::fs;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use common::{Client, TempDir, vault};
use kasten_core::agent::Session;
use kasten_core::history::Actor;
use kasten_core::latex::build_dir;
use kasten_core::{Instant, Kasten};
use kasten_mcp::tools::{Writes, call, call_in, specs};
use serde_json::{Value, json};

const BASE: &str = "projects/photo-organiser/latex";
const ARTICLE: &str = "projects/photo-organiser/latex/article";
const MAIN: &str = "projects/photo-organiser/latex/article/main.tex";
const LOCKED: &str = "projects/photo-organiser/latex/twocolumn";

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

fn fixtures() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/latex")
}

/// A vault with three LaTeX documents (one locked) and the plugin on.
fn open() -> (TempDir, Kasten, Session) {
    let v = vault();
    for name in ["article", "twocolumn", "paper30"] {
        copy_dir(&fixtures().join(name), &v.0.join(BASE).join(name));
    }
    let k = Kasten::open(&v.0).unwrap();
    k.set_plugin_enabled(&Actor::Human, "latex", true, Instant::now())
        .unwrap();
    (v, k, Session::start("claude-code", Instant::now()))
}

fn text_of(v: &TempDir, path: &str) -> String {
    fs::read_to_string(v.0.join(path)).unwrap()
}

fn read(k: &Kasten, s: &Session, args: Value) -> Value {
    call(k, s, "latex_read", args).unwrap()
}

fn edit(k: &Kasten, s: &Session, hash: &str, search: &str, replace: &str) -> Result<Value, String> {
    call(
        k,
        s,
        "latex_edit",
        json!({"doc": "article", "file": "main.tex", "search": search, "replace": replace, "base_hash": hash}),
    )
}

#[test]
fn the_latex_tools_are_listed_only_while_the_plugin_is_on() {
    let v = vault();
    let mut off = Client::start(&v.0, "test-agent");
    assert!(!off.tools().iter().any(|t| t.starts_with("latex_")));
    // Over the wire an off plugin's tool is simply not there.
    assert!(off.call("latex_list", json!({})).is_err());
    drop(off);

    Kasten::open(&v.0)
        .unwrap()
        .set_plugin_enabled(&Actor::Human, "latex", true, Instant::now())
        .unwrap();
    let mut on = Client::start(&v.0, "test-agent");
    let tools = on.tools();
    for tool in ["latex_list", "latex_read", "latex_edit", "latex_build"] {
        assert!(tools.iter().any(|t| t == tool), "{tool} in {tools:?}");
    }
    assert!(tools.iter().any(|t| t == "read_note"));
    // Over the wire the reads say they change nothing and the edit does not.
    let listed = on.request("tools/list", json!({}));
    let hint = |name: &str| {
        listed["tools"]
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t["name"] == name)
            .unwrap()["annotations"]["readOnlyHint"]
            .clone()
    };
    for read in ["latex_list", "latex_read", "latex_build"] {
        assert_eq!(hint(read), json!(true), "{read}");
    }
    assert_ne!(hint("latex_edit"), json!(true));
}

#[test]
fn the_tools_are_described_in_plain_words() {
    let all = specs();
    for name in ["latex_list", "latex_read", "latex_edit", "latex_build"] {
        let spec = all.iter().find(|s| s.name == name).unwrap();
        assert_eq!(spec.read_only, name != "latex_edit", "{name}");
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
        assert_eq!(spec.input_schema["type"], json!("object"));
    }
    let edit = all.iter().find(|s| s.name == "latex_edit").unwrap();
    let mut required: Vec<&str> = edit.input_schema["required"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r.as_str().unwrap())
        .collect();
    required.sort_unstable();
    assert_eq!(required, ["base_hash", "doc", "file", "replace", "search"]);
}

#[test]
fn a_plugin_that_is_off_turns_the_tools_away() {
    let (_v, k, s) = open();
    k.set_plugin_enabled(&Actor::Human, "latex", false, Instant::now())
        .unwrap();
    for tool in ["latex_list", "latex_build"] {
        let why = call(&k, &s, tool, json!({"doc": "article"})).unwrap_err();
        assert_eq!(
            why, "Turn on the LaTeX plugin in Settings → Plugins",
            "{tool}"
        );
    }
}

#[test]
fn latex_list_names_each_document_with_its_root_engine_and_lock() {
    let (_v, k, s) = open();
    let listed = call(&k, &s, "latex_list", Value::Null).unwrap();
    let docs = listed["documents"].as_array().unwrap();
    let find = |folder: &str| docs.iter().find(|d| d["folder"] == folder).unwrap();
    let article = find(ARTICLE);
    assert_eq!(article["main"], json!("main.tex"));
    assert_eq!(article["locked"], json!(false));
    assert!(article["engine"].is_string());
    assert_eq!(find(LOCKED)["locked"], json!(true));
    assert!(docs.iter().any(|d| d["title"] == "paper30"));
}

#[test]
fn latex_read_gives_the_text_with_its_hash_and_the_other_files() {
    let (v, k, s) = open();
    let root = read(&k, &s, json!({"doc": "article"}));
    assert_eq!(root["file"], json!("main.tex"));
    assert_eq!(root["text"], json!(text_of(&v, MAIN)));
    assert_eq!(root["hash"], json!(k.source(MAIN).unwrap().hash));
    assert_eq!(root["locked"], json!(false));

    // A section file, by the name the document gives it, and by a path in the vault.
    let paper = "projects/photo-organiser/latex/paper30";
    let section = read(
        &k,
        &s,
        json!({"doc": "paper30", "file": "sections/method.tex"}),
    );
    assert_eq!(
        section["path"],
        json!(format!("{paper}/sections/method.tex"))
    );
    assert!(
        section["files"]
            .as_array()
            .unwrap()
            .iter()
            .any(|f| f == "refs.bib")
    );
    let same = read(
        &k,
        &s,
        json!({"doc": format!("{paper}/sections/method.tex")}),
    );
    assert_eq!(same["text"], section["text"]);
    assert_eq!(same["hash"], section["hash"]);
    // The hash follows the text.
    assert_ne!(section["hash"], root["hash"]);
}

#[test]
fn latex_read_says_what_is_wrong_with_the_name() {
    let (_v, k, s) = open();
    let none = call(&k, &s, "latex_read", json!({"doc": "no such paper"})).unwrap_err();
    assert!(
        none.contains("No LaTeX document called") && none.contains("latex_list"),
        "{none}"
    );
    for file in [
        "../../notes/secret.md",
        "/etc/passwd",
        "sections\\x.tex",
        "C:/x.tex",
        "",
    ] {
        let args = json!({"doc": "article", "file": file});
        if file.is_empty() {
            // An empty file name means the root file.
            assert!(call(&k, &s, "latex_read", args).is_ok());
        } else {
            let why = call(&k, &s, "latex_read", args).unwrap_err();
            assert!(
                why.contains("is not a file of the document"),
                "{file}: {why}"
            );
        }
    }
    let missing = call(
        &k,
        &s,
        "latex_read",
        json!({"doc": "article", "file": "nope.tex"}),
    )
    .unwrap_err();
    assert!(missing.contains("There is no file nope.tex"), "{missing}");
    // Not a source file, even inside the folder.
    let yaml = call(
        &k,
        &s,
        "latex_read",
        json!({"doc": "article", "file": "kasten-latex.yaml"}),
    )
    .unwrap_err();
    assert!(!yaml.is_empty());
}

#[test]
fn latex_edit_replaces_one_piece_and_the_agent_is_the_author() {
    let (v, k, s) = open();
    let hash = read(&k, &s, json!({"doc": "article"}))["hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let before = text_of(&v, MAIN);
    let told = edit(&k, &s, &hash, "fixed rate", "steady rate").unwrap();
    assert_eq!(told["status"], json!("done"), "{told}");
    assert_eq!(told["result"]["status"], json!("saved"));
    assert_eq!(told["file"], json!("main.tex"));
    assert_eq!(told["session"], json!(s.id));
    // Only that piece changed: every other byte is as it was.
    assert_eq!(
        text_of(&v, MAIN),
        before.replace("fixed rate", "steady rate")
    );
    let last = &k.log(Some(MAIN), 1).unwrap()[0];
    assert_eq!(last.author, "agent:claude-code");
    assert_eq!(last.summary, "edit: main.tex");
    // The hash it brought back is the file's now.
    assert_eq!(told["result"]["hash"], json!(k.source(MAIN).unwrap().hash));
}

#[test]
fn latex_edit_refuses_a_hash_the_file_has_moved_on_from() {
    let (v, k, s) = open();
    let read1 = read(&k, &s, json!({"doc": "article"}));
    let (hash, text) = (
        read1["hash"].as_str().unwrap(),
        read1["text"].as_str().unwrap(),
    );
    // The person types in the file meanwhile.
    let typed = text.replace("Method", "Methods");
    k.save_source(&Actor::Human, MAIN, hash, &typed, Instant::now())
        .unwrap();
    let why = edit(&k, &s, hash, "fixed rate", "steady rate").unwrap_err();
    assert!(
        why.contains("changed since you read it") && why.contains("latex_read"),
        "{why}"
    );
    assert_eq!(
        text_of(&v, MAIN),
        typed,
        "nothing of the agent's was written"
    );
    // Read again, and the change goes through on top of the person's.
    let fresh = read(&k, &s, json!({"doc": "article"}))["hash"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(edit(&k, &s, &fresh, "fixed rate", "steady rate").is_ok());
    let now = text_of(&v, MAIN);
    assert!(now.contains("Methods") && now.contains("steady rate"));
}

#[test]
fn latex_edit_needs_the_text_to_be_there_once() {
    let (v, k, s) = open();
    let hash = read(&k, &s, json!({"doc": "article"}))["hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let before = text_of(&v, MAIN);
    let absent = edit(&k, &s, &hash, "no such words", "x").unwrap_err();
    assert!(absent.contains("is not in main.tex"), "{absent}");
    let twice = edit(&k, &s, &hash, "\\section", "\\subsection").unwrap_err();
    assert!(
        twice.contains("times") && twice.contains("matches once"),
        "{twice}"
    );
    let empty = edit(&k, &s, &hash, "", "x").unwrap_err();
    assert!(empty.contains("search is empty"), "{empty}");
    let same = edit(&k, &s, &hash, "fixed rate", "fixed rate").unwrap_err();
    assert!(same.contains("nothing to change"), "{same}");
    assert_eq!(text_of(&v, MAIN), before, "none of them wrote anything");
}

#[test]
fn latex_edit_is_refused_in_a_locked_document() {
    let (v, k, s) = open();
    let doc = read(&k, &s, json!({"doc": "twocolumn"}));
    assert_eq!(doc["locked"], json!(true));
    let before = text_of(&v, &format!("{LOCKED}/main.tex"));
    let word = before
        .split_whitespace()
        .find(|w| w.len() > 6 && !w.contains('\\'))
        .unwrap();
    let why = call(
        &k,
        &s,
        "latex_edit",
        json!({"doc": "twocolumn", "file": "main.tex", "search": word, "replace": "x", "base_hash": doc["hash"]}),
    )
    .unwrap_err();
    assert!(why.contains("locked"), "{why}");
    assert_eq!(text_of(&v, &format!("{LOCKED}/main.tex")), before);
}

#[test]
fn latex_edit_that_takes_out_much_of_the_file_waits_for_review() {
    let (v, k, s) = open();
    let read1 = read(&k, &s, json!({"doc": "article"}));
    let text = read1["text"].as_str().unwrap();
    let start = text.find("\\begin{abstract}").unwrap();
    let end = text.find("\\end{document}").unwrap();
    let before = text_of(&v, MAIN);
    let told = edit(
        &k,
        &s,
        read1["hash"].as_str().unwrap(),
        &text[start..end],
        "",
    )
    .unwrap();
    assert_eq!(told["status"], json!("pending_review"), "{told}");
    assert!(
        told["reason"].as_str().unwrap().contains("Removes"),
        "{told}"
    );
    assert_eq!(
        text_of(&v, MAIN),
        before,
        "nothing is written until the person accepts"
    );
    // The person accepts it, and it is made.
    let proposal = told["proposal"].as_str().unwrap();
    k.accept_proposal(proposal, "Ada", Instant::now()).unwrap();
    assert!(!text_of(&v, MAIN).contains("\\begin{abstract}"));
}

#[test]
fn a_chat_that_previews_holds_a_latex_edit_for_review_and_writes_nothing() {
    let (v, k, s) = open();
    let hash = read(&k, &s, json!({"doc": "article"}))["hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let set = Mutex::new(k.begin_changes(&s, Instant::now()));
    let before = text_of(&v, MAIN);
    let told = call_in(
        &k,
        &s,
        Writes::Staged(&set),
        "latex_edit",
        json!({"doc": "article", "file": "main.tex", "search": "fixed rate", "replace": "steady rate", "base_hash": hash}),
    )
    .unwrap();
    assert_eq!(told["status"], json!("pending_review"), "{told}");
    assert!(
        told["reason"]
            .as_str()
            .unwrap()
            .contains("waits for your review"),
        "{told}"
    );
    assert_eq!(text_of(&v, MAIN), before);
}

#[test]
fn latex_build_without_a_build_says_to_build_from_the_app() {
    let (_v, k, s) = open();
    let told = call(&k, &s, "latex_build", json!({"doc": "article"})).unwrap();
    assert_eq!(told["built"], json!(false));
    let note = told["note"].as_str().unwrap();
    assert!(
        note.contains("Build from the app; this tool reads diagnostics of the last build"),
        "{note}"
    );
    assert!(told.get("diagnostics").is_none());
}

#[test]
fn latex_build_reads_the_diagnostics_of_the_last_build() {
    let (v, k, s) = open();
    let out = v.0.join(build_dir(ARTICLE)).join("out");
    fs::create_dir_all(&out).unwrap();
    let log = out.join("main.log");
    fs::write(
        &log,
        fs::read_to_string(fixtures().join("logs/undefined-control-sequence.log")).unwrap(),
    )
    .unwrap();
    // The build is a minute old.
    fs::File::options()
        .write(true)
        .open(&log)
        .unwrap()
        .set_modified(SystemTime::now() - Duration::from_secs(60))
        .unwrap();
    // Its sources are older still.
    let old = SystemTime::now() - Duration::from_secs(600);
    for file in ["main.tex", "kasten-latex.yaml"] {
        fs::File::options()
            .write(true)
            .open(v.0.join(ARTICLE).join(file))
            .unwrap()
            .set_modified(old)
            .unwrap();
    }
    let told = call(&k, &s, "latex_build", json!({"doc": "article"})).unwrap();
    assert_eq!(told["built"], json!(true), "{told}");
    assert_eq!(told["errors"], json!(2));
    assert_eq!(told["stale"], json!(false));
    assert_eq!(
        told["summary"],
        json!("The last build had 2 errors and 0 warnings")
    );
    let first = &told["diagnostics"][0];
    assert_eq!(first["severity"], json!("error"));
    assert_eq!(first["file"], json!("main.tex"));
    assert_eq!(first["line"], json!(12));
    assert!(
        first["message"]
            .as_str()
            .unwrap()
            .contains("Undefined control sequence")
    );

    // An edit makes the build old; the tool says so rather than pretend.
    let hash = read(&k, &s, json!({"doc": "article"}))["hash"]
        .as_str()
        .unwrap()
        .to_owned();
    edit(&k, &s, &hash, "fixed rate", "steady rate").unwrap();
    let after = call(&k, &s, "latex_build", json!({"doc": "article"})).unwrap();
    assert_eq!(after["stale"], json!(true), "{after}");
    assert!(
        after["note"]
            .as_str()
            .unwrap()
            .contains("changed after this build"),
        "{after}"
    );
}
