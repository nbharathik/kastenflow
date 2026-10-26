//! The LaTeX tools under attack: names that try to leave a document, links,
//! locks that must hold in every mode (also for documents inside a locked
//! one and for settings that cannot be read), the modes of a project, the size
//! limit, and two writers at once.

mod common;

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use common::{TempDir, vault};
use kasten_core::agent::Session;
use kasten_core::config_keys::{AgentMode, AgentsConfig, ProjectAgents};
use kasten_core::history::Actor;
use kasten_core::{Instant, Kasten};
use kasten_mcp::tools::call;
use serde_json::{Value, json};

const BASE: &str = "projects/photo-organiser/latex";
const ARTICLE: &str = "projects/photo-organiser/latex/article";
const MAIN: &str = "projects/photo-organiser/latex/article/main.tex";
const TWO: &str = "projects/photo-organiser/latex/twocolumn";

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

fn open() -> (TempDir, Kasten, Session) {
    let v = vault();
    for name in ["article", "twocolumn"] {
        let from = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/latex")
            .join(name);
        copy_dir(&from, &v.0.join(BASE).join(name));
    }
    let k = Kasten::open(&v.0).unwrap();
    k.set_plugin_enabled(&Actor::Human, "latex", true, Instant::now())
        .unwrap();
    (v, k, Session::start("claude-code", Instant::now()))
}

fn put(v: &TempDir, path: &str, text: &str) {
    let file = v.0.join(path);
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    fs::write(file, text).unwrap();
}

fn text_of(v: &TempDir, path: &str) -> String {
    fs::read_to_string(v.0.join(path)).unwrap()
}

/// Every file of the vault but git's folder and the cache, with its bytes.
fn snapshot(root: &Path) -> BTreeMap<String, Vec<u8>> {
    fn walk(dir: &Path, root: &Path, out: &mut BTreeMap<String, Vec<u8>>) {
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            let rel = path
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            if rel == ".git" || rel == ".kasten" {
                continue;
            }
            if path.is_dir() {
                walk(&path, root, out);
            } else {
                out.insert(rel, fs::read(&path).unwrap());
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(root, root, &mut out);
    out
}

fn hash_of(k: &Kasten, s: &Session, doc: &str, file: &str) -> String {
    call(k, s, "latex_read", json!({"doc": doc, "file": file})).unwrap()["hash"]
        .as_str()
        .unwrap()
        .to_owned()
}

fn edit_in(k: &Kasten, s: &Session, doc: &str, file: &str, hash: &str) -> Result<Value, String> {
    call(
        k,
        s,
        "latex_edit",
        json!({"doc": doc, "file": file, "search": "fixed rate", "replace": "steady rate", "base_hash": hash}),
    )
}

fn set_agents(k: &Kasten, agents: AgentsConfig) {
    let mut config = k.config();
    config.agents = Some(agents);
    k.set_config(config).unwrap();
}

fn set_mode(k: &Kasten, mode: AgentMode) {
    set_agents(
        k,
        AgentsConfig {
            mode: Some(mode),
            ..AgentsConfig::default()
        },
    );
}

#[test]
fn no_file_name_leaves_the_document_through_latex_edit_or_latex_read() {
    let (v, k, s) = open();
    put(&v, &format!("{ARTICLE}/.hidden/x.tex"), "fixed rate\n");
    put(&v, "projects/photo-organiser/stray.tex", "fixed rate\n");
    put(&v, &format!("{ARTICLE}/notes.md"), "fixed rate\n");
    put(&v, &format!("{ARTICLE}/main.pdf"), "%PDF-1.4 fixed rate\n");
    let hash = hash_of(&k, &s, "article", "main.tex");
    let before = snapshot(&v.0);
    for file in [
        "../twocolumn/main.tex",
        "../../notes/x.tex",
        "./../main.tex",
        "sections/../../x.tex",
        "/abs.tex",
        "C:/x.tex",
        "C:\\x.tex",
        "\\\\server\\share\\x.tex",
        "sections\\x.tex",
        ".hidden/x.tex",
        "./.hidden/x.tex",
        ".git/config",
        "sections//x.tex",
        "sections/./x.tex",
        "notes.md",
        "kasten-latex.yaml",
        "main.pdf",
        "main.tex\0",
        "main.tex/",
        "MAIN.TEX",
        "..",
        ".",
        "sections/..",
        "~/x.tex",
        "projects/photo-organiser/stray.tex",
    ] {
        assert!(
            edit_in(&k, &s, "article", file, &hash).is_err(),
            "edit {file:?}"
        );
        assert!(
            call(
                &k,
                &s,
                "latex_read",
                json!({"doc": "article", "file": file})
            )
            .is_err(),
            "read {file:?}"
        );
    }
    for doc in [
        "..",
        "../..",
        "/",
        "C:/",
        "projects",
        "projects/photo-organiser",
        BASE,
        "projects/photo-organiser/stray.tex",
        ".kasten",
        ".kasten/cache",
        ".git",
        "notes",
    ] {
        assert!(
            edit_in(&k, &s, doc, "main.tex", &hash).is_err(),
            "edit in {doc:?}"
        );
        assert!(
            call(&k, &s, "latex_read", json!({"doc": doc})).is_err(),
            "read {doc:?}"
        );
        assert!(
            call(&k, &s, "latex_build", json!({"doc": doc})).is_err(),
            "build {doc:?}"
        );
    }
    // A hidden folder inside the document, named as the document.
    assert!(
        call(
            &k,
            &s,
            "latex_read",
            json!({"doc": format!("{ARTICLE}/.hidden/x.tex")})
        )
        .is_err()
    );
    assert_eq!(snapshot(&v.0), before, "no refusal wrote anything");
}

#[test]
fn what_is_put_in_place_is_text_in_the_file_and_nothing_else() {
    let (v, k, s) = open();
    let hash = hash_of(&k, &s, "article", "main.tex");
    let before = snapshot(&v.0);
    let smuggled = "\\input{../../../../notes/secret}\n% ../../evil.tex C:\\evil.tex\n";
    let told = call(
        &k,
        &s,
        "latex_edit",
        json!({"doc": "article", "file": "main.tex", "search": "fixed rate", "replace": smuggled, "base_hash": hash}),
    )
    .unwrap();
    assert_eq!(told["status"], json!("done"), "{told}");
    let after = snapshot(&v.0);
    let changed: Vec<&String> = after
        .keys()
        .filter(|path| before.get(*path) != after.get(*path))
        .collect();
    assert_eq!(changed, [MAIN]);
    assert!(text_of(&v, MAIN).contains(smuggled));
}

#[test]
fn a_link_is_never_followed_by_the_tools() {
    let (v, k, s) = open();
    let outside =
        std::env::temp_dir().join(format!("kasten-latex-tool-out-{}", std::process::id()));
    fs::create_dir_all(&outside).unwrap();
    fs::write(outside.join("x.tex"), "fixed rate\n").unwrap();
    let dir_link = v.0.join(ARTICLE).join("linked");
    let file_link = v.0.join(ARTICLE).join("link.tex");
    #[cfg(windows)]
    let made = std::os::windows::fs::symlink_dir(&outside, &dir_link)
        .and_then(|()| std::os::windows::fs::symlink_file(outside.join("x.tex"), &file_link));
    #[cfg(unix)]
    let made = std::os::unix::fs::symlink(&outside, &dir_link)
        .and_then(|()| std::os::unix::fs::symlink(outside.join("x.tex"), &file_link));
    if made.is_err() {
        // No right to make links here: nothing to attack.
        eprintln!("no link rights here: the link attack was not run");
        let _ = fs::remove_dir_all(&outside);
        return;
    }
    for file in ["linked/x.tex", "link.tex"] {
        assert!(
            call(
                &k,
                &s,
                "latex_read",
                json!({"doc": "article", "file": file})
            )
            .is_err(),
            "read {file}"
        );
        assert!(
            edit_in(&k, &s, "article", file, "anything").is_err(),
            "edit {file}"
        );
    }
    let files = call(&k, &s, "latex_read", json!({"doc": "article"})).unwrap();
    let listed = files["files"].to_string();
    assert!(!listed.contains("link"), "{listed}");
    assert_eq!(
        fs::read_to_string(outside.join("x.tex")).unwrap(),
        "fixed rate\n"
    );
    let _ = fs::remove_dir(&dir_link);
    let _ = fs::remove_file(&file_link);
    let _ = fs::remove_dir_all(&outside);
}

#[test]
fn a_locked_document_is_read_only_in_every_mode_and_from_every_side() {
    let (v, k, s) = open();
    // A figure with its own class inside the locked document, and a root inside the unlocked one.
    let figure = format!("{TWO}/figures/fig.tex");
    put(
        &v,
        &figure,
        "\\documentclass{standalone}\n\\begin{document}fixed rate\\end{document}\n",
    );
    let before = snapshot(&v.0);
    let docs = call(&k, &s, "latex_list", Value::Null).unwrap();
    let listed = docs["documents"].as_array().unwrap();
    let find = |folder: &str| listed.iter().find(|d| d["folder"] == folder).unwrap();
    assert_eq!(find(TWO)["locked"], json!(true));
    // The document inside the locked one says it is locked too, since it is.
    assert_eq!(find(&format!("{TWO}/figures"))["locked"], json!(true));
    assert_eq!(find(ARTICLE)["locked"], json!(false));
    let hash = hash_of(&k, &s, &format!("{TWO}/figures"), "fig.tex");
    let two_hash = hash_of(&k, &s, "twocolumn", "main.tex");
    for mode in [
        AgentMode::Review,
        AgentMode::Balanced,
        AgentMode::Autonomous,
    ] {
        set_mode(&k, mode);
        for (doc, file, base) in [
            ("twocolumn", "figures/fig.tex", hash.as_str()),
            (&format!("{TWO}/figures") as &str, "fig.tex", hash.as_str()),
            ("figures", "fig.tex", hash.as_str()),
            (figure.as_str(), "fig.tex", hash.as_str()),
            ("TWOCOLUMN", "main.tex", two_hash.as_str()),
            (TWO, "refs.bib", "x"),
        ] {
            let why = edit_in(&k, &s, doc, file, base);
            assert!(why.is_err(), "{mode:?} {doc} {file}: {why:?}");
        }
    }
    assert_eq!(snapshot(&v.0), before);
    let read = call(&k, &s, "latex_read", json!({"doc": "twocolumn"})).unwrap();
    assert_eq!(read["locked"], json!(true));
}

#[test]
fn settings_that_cannot_be_read_keep_the_tools_out() {
    let (v, k, s) = open();
    let hash = hash_of(&k, &s, "article", "main.tex");
    let settings = format!("{ARTICLE}/kasten-latex.yaml");
    for broken in [
        "locked: false\nengine: [unclosed\n",
        "\u{0}\u{1}\u{2}binary",
        "locked: [1, 2\n",
    ] {
        put(&v, &settings, broken);
        let before = snapshot(&v.0);
        let why = edit_in(&k, &s, "article", "main.tex", &hash).unwrap_err();
        assert!(why.contains("locked"), "{broken:?}: {why}");
        assert_eq!(snapshot(&v.0), before);
        let docs = call(&k, &s, "latex_list", Value::Null).unwrap();
        let article = docs["documents"]
            .as_array()
            .unwrap()
            .iter()
            .find(|d| d["folder"] == ARTICLE)
            .unwrap()
            .clone();
        assert_eq!(article["locked"], json!(true), "{broken:?}");
    }
    // Settings that are not a file at all (a folder with that name) lock just the same.
    fs::remove_file(v.0.join(&settings)).unwrap();
    fs::create_dir_all(v.0.join(&settings)).unwrap();
    let before = text_of(&v, MAIN);
    let why = edit_in(&k, &s, "article", "main.tex", &hash).unwrap_err();
    assert!(why.contains("locked"), "{why}");
    assert_eq!(text_of(&v, MAIN), before);
}

#[test]
fn a_mode_of_review_holds_even_a_small_edit_and_the_project_mode_wins() {
    let (v, k, s) = open();
    let hash = hash_of(&k, &s, "article", "main.tex");
    let before = text_of(&v, MAIN);
    set_mode(&k, AgentMode::Review);
    let held = edit_in(&k, &s, "article", "main.tex", &hash).unwrap();
    assert_eq!(held["status"], json!("pending_review"), "{held}");
    assert_eq!(
        text_of(&v, MAIN),
        before,
        "nothing is written before the person accepts"
    );

    // The vault is autonomous, the project is on review: the project's word counts.
    set_agents(
        &k,
        AgentsConfig {
            mode: Some(AgentMode::Autonomous),
            projects: [(
                "photo-organiser".to_owned(),
                ProjectAgents {
                    mode: Some(AgentMode::Review),
                    ..ProjectAgents::default()
                },
            )]
            .into_iter()
            .collect(),
            ..AgentsConfig::default()
        },
    );
    // Every way of naming the document reaches the same project.
    for doc in ["article", "ARTICLE", ARTICLE, MAIN] {
        let held = edit_in(&k, &s, doc, "main.tex", &hash).unwrap();
        assert_eq!(held["status"], json!("pending_review"), "{doc}: {held}");
    }
    assert_eq!(text_of(&v, MAIN), before);

    // And a project that is not on review follows the vault.
    set_mode(&k, AgentMode::Balanced);
    let done = edit_in(&k, &s, "article", "main.tex", &hash).unwrap();
    assert_eq!(done["status"], json!("done"), "{done}");
}

#[test]
fn the_size_limit_holds_for_what_is_read_and_what_is_written() {
    let (v, k, s) = open();
    let hash = hash_of(&k, &s, "article", "main.tex");
    let before = text_of(&v, MAIN);
    let big = "y".repeat(kasten_core::latex::MAX_SOURCE_BYTES + 1);
    let why = call(
        &k,
        &s,
        "latex_edit",
        json!({"doc": "article", "file": "main.tex", "search": "fixed rate", "replace": big, "base_hash": hash}),
    )
    .unwrap_err();
    assert!(why.contains("at most"), "{why}");
    assert_eq!(text_of(&v, MAIN), before);

    // A file that came from outside and is over the limit is not read or written over.
    let huge = format!("{ARTICLE}/huge.tex");
    put(
        &v,
        &huge,
        &"x".repeat(kasten_core::latex::MAX_SOURCE_BYTES + 1),
    );
    let read = call(
        &k,
        &s,
        "latex_read",
        json!({"doc": "article", "file": "huge.tex"}),
    );
    assert!(read.is_err(), "{read:?}");
    assert!(edit_in(&k, &s, "article", "huge.tex", "x").is_err());
    assert_eq!(
        text_of(&v, &huge).len(),
        kasten_core::latex::MAX_SOURCE_BYTES + 1
    );
}

#[test]
fn a_search_that_overlaps_itself_is_not_one_place() {
    let (v, k, s) = open();
    let path = format!("{ARTICLE}/overlap.tex");
    put(&v, &path, "aaa\nb\u{e9}\u{e9}\u{e9}\n");
    let hash = hash_of(&k, &s, "article", "overlap.tex");
    for search in ["aa", "\u{e9}\u{e9}"] {
        let why = call(
            &k,
            &s,
            "latex_edit",
            json!({"doc": "article", "file": "overlap.tex", "search": search, "replace": "Z", "base_hash": hash}),
        )
        .unwrap_err();
        assert!(
            why.contains("times") && why.contains("matches once"),
            "{why}"
        );
    }
    assert_eq!(text_of(&v, &path), "aaa\nb\u{e9}\u{e9}\u{e9}\n");
}

#[test]
fn a_plugin_that_is_off_turns_every_latex_tool_away() {
    let (v, k, s) = open();
    let hash = hash_of(&k, &s, "article", "main.tex");
    k.set_plugin_enabled(&Actor::Human, "latex", false, Instant::now())
        .unwrap();
    let before = snapshot(&v.0);
    let sentence = "Turn on the LaTeX plugin in Settings → Plugins";
    for (tool, args) in [
        ("latex_list", json!({})),
        ("latex_read", json!({"doc": "article"})),
        ("latex_build", json!({"doc": "article"})),
        (
            "latex_edit",
            json!({"doc": "article", "file": "main.tex", "search": "fixed rate", "replace": "x", "base_hash": hash}),
        ),
    ] {
        assert_eq!(call(&k, &s, tool, args).unwrap_err(), sentence, "{tool}");
    }
    assert_eq!(snapshot(&v.0), before);
}

#[test]
fn two_writers_at_once_lose_neither_edit() {
    let (v, k, _) = open();
    drop(k);
    let edits = [
        ("fixed rate", "steady rate"),
        ("The method is simple", "The approach is simple"),
    ];
    std::thread::scope(|scope| {
        for (n, (search, replace)) in edits.iter().enumerate() {
            let root = v.0.clone();
            scope.spawn(move || {
                let k = Kasten::open(&root).unwrap();
                let s = Session::start(&format!("agent-{n}"), Instant::now());
                for _ in 0..20 {
                    let hash = hash_of(&k, &s, "article", "main.tex");
                    let told = call(
                        &k,
                        &s,
                        "latex_edit",
                        json!({"doc": "article", "file": "main.tex", "search": search, "replace": replace, "base_hash": hash}),
                    );
                    match told {
                        Ok(told) => {
                            assert_eq!(told["status"], json!("done"), "{told}");
                            return;
                        }
                        // The other writer was first: read again, as the tool says.
                        Err(why) => assert!(why.contains("changed since"), "{why}"),
                    }
                }
                panic!("never got in");
            });
        }
    });
    let text = text_of(&v, MAIN);
    assert!(
        text.contains("steady rate") && text.contains("The approach is simple"),
        "{text}"
    );
    let copies: Vec<_> = snapshot(&v.0)
        .into_keys()
        .filter(|p| {
            p.starts_with(ARTICLE) && p != MAIN && p != &format!("{ARTICLE}/kasten-latex.yaml")
        })
        .collect();
    assert!(copies.is_empty(), "no copy beside it: {copies:?}");
}
