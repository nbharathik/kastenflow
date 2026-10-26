//! The smart page tools: make a page with its code, read it with hashes and the
//! errors it reported, change files against a hash, take one out, check the
//! files, and be told where a picture cannot be drawn. Writes go through the
//! same rules as every agent write: a locked page is refused, Review holds the
//! change, a file changed since it was read is never written over.

mod common;

use std::fs;
use std::sync::Mutex;

use common::{TempDir, vault};
use kasten_core::agent::Session;
use kasten_core::config_keys::{AgentMode, AgentsConfig};
use kasten_core::history::Actor;
use kasten_core::{Instant, Kasten};
use kasten_mcp::tools::{Writes, call, call_in, specs};
use serde_json::{Value, json};

const INDEX: &str = "<!doctype html>\n<html><head><script src=\"smart://kit/1/kit.js\"></script></head>\n<body><h1>Deadlines</h1><script src=\"app.js\"></script></body></html>\n";
const APP: &str = "kasten.query('papers').then(rows => console.log(rows));\n";

fn open() -> (TempDir, Kasten, Session) {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    (v, k, Session::start("claude-code", Instant::now()))
}

fn files() -> Value {
    json!([
        {"path": "index.html", "content": INDEX},
        {"path": "app.js", "content": APP},
    ])
}

fn queries() -> Value {
    json!({"papers": {"tag": "paper", "filter": [{"key": "status", "op": "is", "value": "Drafting"}],
        "sort": [{"key": "deadline", "dir": "asc"}], "limit": 20}})
}

/// A smart page, made with the tool; its path.
fn page(k: &Kasten, s: &Session) -> String {
    let made = call(
        k,
        s,
        "smart_create",
        json!({"title": "Deadlines", "files": files(), "queries": queries()}),
    )
    .unwrap();
    assert_eq!(made["status"], json!("done"), "{made}");
    made["result"]["page"].as_str().unwrap().to_owned()
}

fn dir_of(page: &str) -> String {
    format!("{}.smart", page.strip_suffix(".md").unwrap())
}

fn read(k: &Kasten, s: &Session, page: &str) -> Value {
    call(k, s, "smart_read", json!({"page": page})).unwrap()
}

fn hash_of(k: &Kasten, s: &Session, page: &str, file: &str) -> String {
    read(k, s, page)["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["path"] == file)
        .unwrap()["hash"]
        .as_str()
        .unwrap()
        .to_owned()
}

fn text_of(v: &TempDir, page: &str, file: &str) -> String {
    fs::read_to_string(v.0.join(dir_of(page)).join(file)).unwrap()
}

fn set_mode(k: &Kasten, mode: AgentMode) {
    let mut config = k.config();
    config.agents = Some(AgentsConfig {
        mode: Some(mode),
        ..AgentsConfig::default()
    });
    k.set_config(config).unwrap();
}

fn findings(k: &Kasten, s: &Session, page: &str) -> Vec<Value> {
    call(k, s, "smart_check", json!({"page": page})).unwrap()["findings"]
        .as_array()
        .unwrap()
        .clone()
}

fn has(found: &[Value], severity: &str, file: &str, needle: &str) -> bool {
    found.iter().any(|f| {
        f["severity"] == severity
            && f["file"] == file
            && f["message"].as_str().unwrap().contains(needle)
    })
}

#[test]
fn the_tools_are_listed_described_in_plain_words_and_the_reads_say_they_change_nothing() {
    let all = specs();
    let tools = [
        "smart_create",
        "smart_read",
        "smart_edit",
        "smart_write_file",
        "smart_delete_file",
        "smart_check",
        "smart_render",
    ];
    for name in tools {
        let spec = all.iter().find(|s| s.name == name).unwrap();
        let reads = matches!(name, "smart_read" | "smart_check" | "smart_render");
        assert_eq!(spec.read_only, reads, "{name}");
        assert_eq!(spec.input_schema["type"], json!("object"));
        for jargon in [
            "commit",
            "sidecar",
            "SmartWrite",
            "smart_write",
            concat!("de", "v/"),
            concat!("A", "DR"),
        ] {
            assert!(!spec.description.contains(jargon), "{name}: {jargon}");
        }
    }
    let required = |name: &str| -> Vec<String> {
        let spec = all.iter().find(|s| s.name == name).unwrap();
        let mut r: Vec<String> = spec.input_schema["required"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r.as_str().unwrap().to_owned())
            .collect();
        r.sort();
        r
    };
    assert_eq!(required("smart_create"), ["files", "title"]);
    assert_eq!(
        required("smart_edit"),
        ["base_hash", "file", "page", "steps"]
    );
    assert_eq!(required("smart_write_file"), ["content", "file", "page"]);
    assert_eq!(required("smart_delete_file"), ["file", "page"]);
    // They are not batchable: a page is made whole by smart_create.
    let batch = all.iter().find(|s| s.name == "batch").unwrap();
    assert!(!batch.description.contains("smart_"));
}

#[test]
fn smart_create_makes_the_page_and_its_folder_in_one_commit_with_a_manifest() {
    let (v, k, s) = open();
    k.start_history().unwrap();
    let before = k.log(None, 500).unwrap().len();
    let made = call(
        &k,
        &s,
        "smart_create",
        json!({"title": "Deadlines", "files": files(), "queries": queries(),
            "views": {"map": {"title": "Map", "entry": "index.html"}}}),
    )
    .unwrap();
    assert_eq!(made["status"], json!("done"), "{made}");
    assert_eq!(made["session"], json!(s.id));
    let page = made["result"]["page"].as_str().unwrap();
    assert!(page.ends_with("deadlines.md"), "{page}");
    assert_eq!(made["result"]["files"].as_array().unwrap().len(), 3);
    assert_eq!(k.log(None, 500).unwrap().len(), before + 1, "one commit");
    let last = &k.log(None, 1).unwrap()[0];
    assert_eq!(last.author, "agent:claude-code");
    assert!(
        fs::read_to_string(v.0.join(page))
            .unwrap()
            .contains("layout: smart")
    );
    assert_eq!(text_of(&v, page, "index.html"), INDEX);
    let manifest = text_of(&v, page, "smart.yaml");
    assert!(
        manifest.contains("title: Deadlines") && manifest.contains("papers"),
        "{manifest}"
    );
    assert!(manifest.contains("kit:"), "{manifest}");
    // One undo takes all of it back.
    k.undo_session(&s.id, Instant::now()).unwrap();
    assert!(!v.0.join(page).exists() && !v.0.join(dir_of(page)).exists());
}

#[test]
fn smart_create_refuses_what_can_never_run_and_writes_nothing() {
    let (v, k, s) = open();
    let before = k.list().unwrap().len();
    let with = |extra: Value| {
        let mut all = files().as_array().unwrap().clone();
        all.push(extra);
        Value::Array(all)
    };
    let bad: Vec<(&str, Value)> = vec![
        ("no files", json!([])),
        ("no index", json!([{"path": "app.js", "content": "x"}])),
        ("a program", with(json!({"path": "x.exe", "content": "x"}))),
        ("a picture", with(json!({"path": "p.png", "content": "x"}))),
        (
            "up a folder",
            with(json!({"path": "../x.js", "content": "x"})),
        ),
        ("hidden", with(json!({"path": ".git/x.js", "content": "x"}))),
        ("absolute", with(json!({"path": "/x.js", "content": "x"}))),
        ("twice", with(json!({"path": "app.js", "content": "x"}))),
        (
            "too big",
            json!([{"path": "index.html", "content": "a".repeat(300_000)}]),
        ),
    ];
    for (what, files) in bad {
        let told = call(
            &k,
            &s,
            "smart_create",
            json!({"title": "Deadlines", "files": files}),
        );
        assert!(told.is_err(), "{what}: {told:?}");
    }
    // A manifest of your own and the arguments for one are two sources.
    let both = call(
        &k,
        &s,
        "smart_create",
        json!({"title": "Deadlines", "files": with(json!({"path": "smart.yaml", "content": "title: X\n"})),
            "queries": queries()}),
    )
    .unwrap_err();
    assert!(both.contains("not both"), "{both}");
    // A query that is not in the shape the manifest takes is told what is wrong.
    let shape = call(
        &k,
        &s,
        "smart_create",
        json!({"title": "Deadlines", "files": files(),
            "queries": {"p": {"tag": "paper", "filter": [{"key": "status", "op": "sort_of"}]}}}),
    )
    .unwrap_err();
    assert!(shape.contains("not in the shape"), "{shape}");
    let name = call(
        &k,
        &s,
        "smart_create",
        json!({"title": "Deadlines", "files": files(), "queries": {"bad name!": {"tag": "paper"}}}),
    )
    .unwrap_err();
    assert!(name.contains("Query name"), "{name}");
    assert_eq!(k.list().unwrap().len(), before);
    assert!(!v.0.join("library/deadlines.md").exists());
    assert!(k.dirty().unwrap().is_empty());
}

#[test]
fn in_review_mode_a_new_page_waits_as_one_proposal() {
    let (v, k, s) = open();
    set_mode(&k, AgentMode::Review);
    let held = call(
        &k,
        &s,
        "smart_create",
        json!({"title": "Deadlines", "files": files()}),
    )
    .unwrap();
    assert_eq!(held["status"], json!("pending_review"), "{held}");
    assert!(!v.0.join("library/deadlines.md").exists());
    k.accept_proposal(held["proposal"].as_str().unwrap(), "Ada", Instant::now())
        .unwrap();
    assert!(v.0.join("library/deadlines.smart/index.html").exists());
}

#[test]
fn smart_read_gives_files_hashes_manifest_data_and_the_errors_the_page_reported() {
    let (v, k, s) = open();
    let page = page(&k, &s);
    let told = read(&k, &s, &page);
    assert_eq!(told["title"], json!("Deadlines"));
    let listed = told["files"].as_array().unwrap();
    let paths: Vec<&str> = listed.iter().map(|f| f["path"].as_str().unwrap()).collect();
    assert_eq!(paths, ["index.html", "smart.yaml", "app.js"]);
    assert_eq!(listed[0]["text"], json!(INDEX));
    assert!(
        listed
            .iter()
            .all(|f| f["hash"].as_str().is_some_and(|h| h.len() == 16))
    );
    assert_eq!(told["manifest"]["title"], json!("Deadlines"));
    assert_eq!(told["manifest"]["queries"]["papers"]["tag"], json!("paper"));
    // What the query returns now: the papers that are being drafted, by deadline.
    let data = &told["data"]["papers"];
    assert!(data["total"].as_u64().unwrap() >= 1, "{data}");
    assert!(data["rows"][0]["title"].is_string());
    assert_eq!(data["truncated"], json!(false));
    // No errors yet, and it says how they come.
    assert_eq!(told["errors"], json!([]));
    assert!(
        told["errorsNote"]
            .as_str()
            .unwrap()
            .contains("open the page")
    );

    // The app's log of what the page reported is read as it is kept.
    let id = told["id"].as_str().unwrap();
    let cache = v.0.join(".kasten/cache/smart");
    fs::create_dir_all(&cache).unwrap();
    let records: Vec<Value> = (0..60)
        .map(|n| {
            json!({"time": format!("2026-10-23T10:{n:02}:00Z"), "kind": "error",
            "message": format!("boom {n}"), "source": "app.js", "line": n})
        })
        .collect();
    fs::write(
        cache.join(format!("{id}.log.json")),
        json!({"records": records}).to_string(),
    )
    .unwrap();
    let again = read(&k, &s, &page);
    let errors = again["errors"].as_array().unwrap();
    assert_eq!(errors.len(), 50, "the last 50");
    assert_eq!(errors[0]["message"], json!("boom 10"));
    assert_eq!(errors[49]["message"], json!("boom 59"));
    assert!(again.get("errorsNote").is_none());
    // A log that does not read counts as none.
    fs::write(cache.join(format!("{id}.log.json")), "not json").unwrap();
    assert_eq!(read(&k, &s, &page)["errors"], json!([]));

    // One file whole.
    let one = call(
        &k,
        &s,
        "smart_read",
        json!({"page": page, "file": "app.js"}),
    )
    .unwrap();
    assert_eq!(one["text"], json!(APP));
    assert_eq!(one["hash"], json!(hash_of(&k, &s, &page, "app.js")));
}

#[test]
fn smart_read_says_what_is_wrong_with_the_page_or_the_file() {
    let (_v, k, s) = open();
    let page = page(&k, &s);
    let plain = call(
        &k,
        &s,
        "smart_read",
        json!({"page": "Welcome to KastenFlow"}),
    )
    .unwrap_err();
    assert!(
        plain.contains("not a smart page") && plain.contains("smart_create"),
        "{plain}"
    );
    let none = call(&k, &s, "smart_read", json!({"page": "No such page"})).unwrap_err();
    assert!(none.contains("No note called"), "{none}");
    for file in [
        "../../notes/secret.md",
        "/etc/passwd",
        "a\\b.js",
        "C:/x.js",
        ".hidden.js",
        "x.exe",
    ] {
        let why = call(&k, &s, "smart_read", json!({"page": page, "file": file})).unwrap_err();
        assert!(
            why.contains("not a file a smart page may have"),
            "{file}: {why}"
        );
    }
    let missing = call(
        &k,
        &s,
        "smart_read",
        json!({"page": page, "file": "nope.js"}),
    )
    .unwrap_err();
    assert!(missing.contains("There is no file nope.js"), "{missing}");
}

#[test]
fn smart_edit_replaces_one_piece_against_the_hash_and_the_agent_is_the_author() {
    let (v, k, s) = open();
    let page = page(&k, &s);
    let hash = hash_of(&k, &s, &page, "app.js");
    let told = call(
        &k,
        &s,
        "smart_edit",
        json!({"page": page, "file": "app.js", "base_hash": hash,
            "steps": [{"op": "replace", "search": "console.log(rows)", "replace": "render(rows)"}]}),
    )
    .unwrap();
    assert_eq!(told["status"], json!("done"), "{told}");
    assert_eq!(told["result"]["status"], json!("saved"));
    assert_eq!(told["file"], json!("app.js"));
    assert_eq!(
        text_of(&v, &page, "app.js"),
        APP.replace("console.log(rows)", "render(rows)")
    );
    assert_eq!(k.log(None, 1).unwrap()[0].author, "agent:claude-code");
    // The hash it brought back is the file's now.
    assert_eq!(
        told["result"]["hash"],
        json!(hash_of(&k, &s, &page, "app.js"))
    );
}

#[test]
fn smart_edit_makes_all_its_steps_or_none_and_can_rewrite_the_whole_file() {
    let (v, k, s) = open();
    let page = page(&k, &s);
    let hash = hash_of(&k, &s, &page, "app.js");
    let step = |search: &str, replace: &str| json!({"op": "replace", "search": search, "replace": replace});
    let edit = |steps: Value| {
        call(
            &k,
            &s,
            "smart_edit",
            json!({"page": page, "file": "app.js", "base_hash": hash, "steps": steps}),
        )
    };
    // The second step cannot be made, so the first is not either.
    let why = edit(json!([
        step("kasten.query", "kit.q"),
        step("no such text", "x")
    ]))
    .unwrap_err();
    assert!(
        why.contains("Step 2") && why.contains("not in app.js"),
        "{why}"
    );
    assert_eq!(text_of(&v, &page, "app.js"), APP);
    // The text must be there once.
    let twice = edit(json!([step("rows", "x")])).unwrap_err();
    assert!(
        twice.contains("times") && twice.contains("matches once"),
        "{twice}"
    );
    assert!(
        edit(json!([step("", "x")]))
            .unwrap_err()
            .contains("search is empty")
    );
    assert!(
        edit(json!([step("rows =>", "rows =>")]))
            .unwrap_err()
            .contains("nothing to change")
    );
    assert!(edit(json!([])).unwrap_err().contains("steps is empty"));
    // A later step sees what the earlier one left.
    edit(json!([
        step("kasten.query", "kit.q"),
        step("kit.q('papers')", "kit.q('p')")
    ]))
    .unwrap();
    assert!(text_of(&v, &page, "app.js").starts_with("kit.q('p')"));
    // A whole new file.
    let hash2 = hash_of(&k, &s, &page, "app.js");
    call(
        &k,
        &s,
        "smart_edit",
        json!({"page": page, "file": "app.js", "base_hash": hash2,
            "steps": [{"op": "rewrite", "content": "// empty\n"}]}),
    )
    .unwrap();
    assert_eq!(text_of(&v, &page, "app.js"), "// empty\n");
}

#[test]
fn smart_edit_refuses_a_hash_the_file_has_moved_on_from() {
    let (v, k, s) = open();
    let page = page(&k, &s);
    let hash = hash_of(&k, &s, &page, "app.js");
    k.smart_write_file(
        &Actor::Human,
        &page,
        "app.js",
        b"a person's edit",
        None,
        Instant::now(),
    )
    .unwrap();
    let why = call(
        &k,
        &s,
        "smart_edit",
        json!({"page": page, "file": "app.js", "base_hash": hash,
            "steps": [{"op": "rewrite", "content": "agent"}]}),
    )
    .unwrap_err();
    assert!(
        why.contains("changed since you read it") && why.contains("smart_read"),
        "{why}"
    );
    assert_eq!(text_of(&v, &page, "app.js"), "a person's edit");
}

#[test]
fn smart_write_file_makes_new_files_and_needs_the_hash_for_one_that_is_there() {
    let (v, k, s) = open();
    let page = page(&k, &s);
    let made = call(
        &k,
        &s,
        "smart_write_file",
        json!({"page": page, "file": "data/venues.json", "content": "[1, 2]"}),
    )
    .unwrap();
    assert_eq!(made["result"]["status"], json!("created"), "{made}");
    assert_eq!(text_of(&v, &page, "data/venues.json"), "[1, 2]");
    // Without the hash an existing file is not written over.
    let blind = call(
        &k,
        &s,
        "smart_write_file",
        json!({"page": page, "file": "data/venues.json", "content": "[3]"}),
    )
    .unwrap_err();
    assert!(blind.contains("already there"), "{blind}");
    let hash = made["result"]["hash"].as_str().unwrap();
    let saved = call(
        &k,
        &s,
        "smart_write_file",
        json!({"page": page, "file": "data/venues.json", "content": "[3]", "base_hash": hash}),
    )
    .unwrap();
    assert_eq!(saved["result"]["status"], json!("saved"));
    assert_eq!(text_of(&v, &page, "data/venues.json"), "[3]");
}

#[test]
fn smart_write_file_refuses_bad_names_pictures_and_big_files() {
    let (v, k, s) = open();
    let page = page(&k, &s);
    let before = fs::read_dir(v.0.join(dir_of(&page))).unwrap().count();
    let write = |file: &str, content: &str| {
        call(
            &k,
            &s,
            "smart_write_file",
            json!({"page": page, "file": file, "content": content}),
        )
    };
    for (file, why) in [
        ("p.png", "not a text file"),
        ("p.jpg", "not a text file"),
        ("x.wasm", "not a file a smart page may have"),
        ("x.exe", "not a file a smart page may have"),
        ("../x.js", "not a file a smart page may have"),
        ("a/../../x.js", "not a file a smart page may have"),
        (".env.js", "not a file a smart page may have"),
        ("/abs.js", "not a file a smart page may have"),
        ("C:/x.js", "not a file a smart page may have"),
        ("CON.js", "not a file a smart page may have"),
        ("a/b/c/d/e/f/g.js", "too many folders"),
    ] {
        let told = write(file, "x").unwrap_err();
        assert!(told.contains(why), "{file}: {told}");
    }
    let big = write("data/big.json", &"a".repeat(300_000)).unwrap_err();
    assert!(big.contains("single write"), "{big}");
    let manifest = write("smart.yaml", "title: ''\n").unwrap_err();
    assert!(manifest.contains("smart.yaml"), "{manifest}");
    assert_eq!(
        fs::read_dir(v.0.join(dir_of(&page))).unwrap().count(),
        before
    );
    // Not a smart page.
    let plain = call(
        &k,
        &s,
        "smart_write_file",
        json!({"page": "Welcome to KastenFlow", "file": "index.html", "content": "x"}),
    )
    .unwrap_err();
    assert!(plain.contains("not a smart page"), "{plain}");
}

#[test]
fn a_locked_page_is_read_only_for_every_tool_that_writes() {
    let (v, k, s) = open();
    let page = page(&k, &s);
    let hash = hash_of(&k, &s, &page, "app.js");
    k.set_meta(&Actor::Human, &page, "locked", Some("true"), Instant::now())
        .unwrap();
    let calls = [
        (
            "smart_write_file",
            json!({"page": page, "file": "new.js", "content": "x"}),
        ),
        (
            "smart_edit",
            json!({"page": page, "file": "app.js", "base_hash": hash,
                "steps": [{"op": "rewrite", "content": "x"}]}),
        ),
        ("smart_delete_file", json!({"page": page, "file": "app.js"})),
    ];
    for (tool, args) in calls {
        let why = call(&k, &s, tool, args).unwrap_err();
        assert!(why.contains("locked"), "{tool}: {why}");
    }
    assert_eq!(text_of(&v, &page, "app.js"), APP);
    // Reading and checking are still allowed.
    assert!(call(&k, &s, "smart_read", json!({"page": page})).is_ok());
    assert!(call(&k, &s, "smart_check", json!({"page": page})).is_ok());
    // And a locked parent keeps a new page out of it.
    let parent = call(
        &k,
        &s,
        "smart_create",
        json!({"title": "Inside", "parent": page, "files": files()}),
    )
    .unwrap_err();
    assert!(parent.contains("locked"), "{parent}");
}

#[test]
fn in_review_mode_every_change_to_a_page_waits_and_a_chat_that_previews_holds_it() {
    let (v, k, s) = open();
    let page = page(&k, &s);
    let hash = hash_of(&k, &s, &page, "app.js");
    let args = json!({"page": page, "file": "app.js", "base_hash": hash,
        "steps": [{"op": "rewrite", "content": "// agent\n"}]});
    // A chat that previews: held, and nothing reaches the vault.
    let set = Mutex::new(k.begin_changes(&s, Instant::now()));
    let told = call_in(&k, &s, Writes::Staged(&set), "smart_edit", args.clone()).unwrap();
    assert_eq!(told["status"], json!("pending_review"), "{told}");
    assert_eq!(text_of(&v, &page, "app.js"), APP);
    // Review mode, written directly: it waits for the person, who accepts it.
    set_mode(&k, AgentMode::Review);
    let held = call(&k, &s, "smart_edit", args).unwrap();
    assert_eq!(held["status"], json!("pending_review"), "{held}");
    assert_eq!(text_of(&v, &page, "app.js"), APP);
    k.accept_proposal(held["proposal"].as_str().unwrap(), "Ada", Instant::now())
        .unwrap();
    assert_eq!(text_of(&v, &page, "app.js"), "// agent\n");
    let gone = call(
        &k,
        &s,
        "smart_delete_file",
        json!({"page": page, "file": "app.js"}),
    )
    .unwrap();
    assert_eq!(gone["status"], json!("pending_review"), "{gone}");
    assert!(v.0.join(dir_of(&page)).join("app.js").exists());
}

#[test]
fn smart_delete_file_moves_the_file_to_the_trash_where_a_person_can_put_it_back() {
    let (v, k, s) = open();
    let page = page(&k, &s);
    let gone = call(
        &k,
        &s,
        "smart_delete_file",
        json!({"page": page, "file": "app.js"}),
    )
    .unwrap();
    assert_eq!(gone["result"]["status"], json!("trashed"), "{gone}");
    assert!(!v.0.join(dir_of(&page)).join("app.js").exists());
    let trashed = gone["result"]["trashed"].as_str().unwrap();
    assert_eq!(fs::read_to_string(v.0.join(trashed)).unwrap(), APP);
    k.smart_restore_file(&Actor::Human, trashed, Instant::now())
        .unwrap();
    assert_eq!(text_of(&v, &page, "app.js"), APP);
    let missing = call(
        &k,
        &s,
        "smart_delete_file",
        json!({"page": page, "file": "nope.js"}),
    )
    .unwrap_err();
    assert!(!missing.is_empty());
    let hidden = call(
        &k,
        &s,
        "smart_delete_file",
        json!({"page": page, "file": "../x.js"}),
    )
    .unwrap_err();
    assert!(
        hidden.contains("not a file a smart page may have"),
        "{hidden}"
    );
}

#[test]
fn smart_check_finds_nothing_in_a_good_page() {
    let (_v, k, s) = open();
    let page = page(&k, &s);
    let told = call(&k, &s, "smart_check", json!({"page": page})).unwrap();
    assert_eq!(told["foundNoErrors"], json!(true), "{told}");
    assert_eq!(told["errors"], json!(0));
    assert_eq!(told["warnings"], json!(0), "{told}");
    assert!(
        told["summary"]
            .as_str()
            .unwrap()
            .contains("does not run the page")
    );
}

#[test]
fn smart_check_catches_every_way_of_reaching_for_the_network() {
    let (_v, k, s) = open();
    let page = page(&k, &s);
    let hash = hash_of(&k, &s, &page, "app.js");
    let bad = "fetch('data.json');\nvar x = new XMLHttpRequest();\nvar w = new WebSocket('x');\nvar e = new EventSource('x');\nnavigator.sendBeacon('x');\nimport('https://cdn.example.com/lib.js');\n";
    call(
        &k,
        &s,
        "smart_edit",
        json!({"page": page, "file": "app.js", "base_hash": hash,
        "steps": [{"op": "rewrite", "content": bad}]}),
    )
    .unwrap();
    let page_html = "<html><head>\n<link rel=\"stylesheet\" href=\"https://fonts.example.com/a.css\">\n<script src=\"https://cdn.example.com/lib.js\"></script>\n<script src=\"//cdn.example.com/other.js\"></script>\n<style>@import url(https://x.example.com/s.css); .a { background: url('http://x.example.com/p.png') }</style>\n</head><body><a href=\"https://example.org/\">out</a><svg xmlns=\"http://www.w3.org/2000/svg\"></svg></body></html>\n";
    let index = hash_of(&k, &s, &page, "index.html");
    call(
        &k,
        &s,
        "smart_edit",
        json!({"page": page, "file": "index.html", "base_hash": index,
        "steps": [{"op": "rewrite", "content": page_html}]}),
    )
    .unwrap();
    let found = findings(&k, &s, &page);
    for needle in [
        "fetch()",
        "XMLHttpRequest",
        "WebSocket",
        "EventSource",
        "sendBeacon()",
    ] {
        assert!(
            has(&found, "error", "app.js", needle),
            "{needle} in {found:?}"
        );
    }
    assert!(has(
        &found,
        "error",
        "app.js",
        "https://cdn.example.com/lib.js"
    ));
    let net = |line: u32, needle: &str| {
        found.iter().any(|f| {
            f["file"] == "index.html"
                && f["line"] == json!(line)
                && f["severity"] == "error"
                && f["message"].as_str().unwrap().contains(needle)
        })
    };
    assert!(net(2, "https://fonts.example.com/a.css"), "{found:?}");
    assert!(net(3, "https://cdn.example.com/lib.js"));
    assert!(net(4, "//cdn.example.com"));
    assert!(net(5, "https://x.example.com/s.css"));
    assert!(net(5, "http://x.example.com/p.png"));
    // A link is only a warning, and an XML namespace is no address at all.
    assert!(has(&found, "warning", "index.html", "https://example.org/"));
    assert!(
        !found
            .iter()
            .any(|f| f["message"].as_str().unwrap().contains("w3.org"))
    );
    // Every finding is typed and says what to do.
    for f in &found {
        assert!(["error", "warning", "info"].contains(&f["severity"].as_str().unwrap()));
        assert!(f["file"].is_string() && f["message"].as_str().unwrap().len() > 20);
    }
    let told = call(&k, &s, "smart_check", json!({"page": page})).unwrap();
    assert_eq!(told["foundNoErrors"], json!(false));
    assert!(told["summary"].as_str().unwrap().contains("to fix"));
}

#[test]
fn smart_check_checks_the_queries_against_the_tags() {
    let (_v, k, s) = open();
    let page = page(&k, &s);
    let manifest = hash_of(&k, &s, &page, "smart.yaml");
    let yaml = "version: 1\ntitle: Deadlines\nkit: \"1\"\nqueries:\n  a:\n    tag: paper\n    filter: [{key: colour, op: is, value: red}]\n  b:\n    tag: papper\n  c:\n    tag: paper\n    filter: [{key: status, op: is, value: Finished}, {key: venue, op: before, value: x}]\n    sort: [{key: shoe_size}]\n";
    call(
        &k,
        &s,
        "smart_write_file",
        json!({"page": page, "file": "smart.yaml", "content": yaml, "base_hash": manifest}),
    )
    .unwrap();
    let found = findings(&k, &s, &page);
    assert!(
        has(
            &found,
            "error",
            "smart.yaml",
            "“colour”, which #paper does not have"
        ),
        "{found:?}"
    );
    assert!(has(&found, "error", "smart.yaml", "“shoe_size”"));
    assert!(has(
        &found,
        "warning",
        "smart.yaml",
        "#papper, which no note has"
    ));
    assert!(has(
        &found,
        "warning",
        "smart.yaml",
        "“Finished” in “status”"
    ));
    assert!(has(
        &found,
        "warning",
        "smart.yaml",
        "compares “venue” with before or after"
    ));
}

#[test]
fn smart_check_knows_the_kit_versions() {
    let (_v, k, s) = open();
    let page = page(&k, &s);
    let manifest = hash_of(&k, &s, &page, "smart.yaml");
    // A kit this version does not have.
    call(
        &k,
        &s,
        "smart_write_file",
        json!({"page": page, "file": "smart.yaml",
        "content": "version: 1\ntitle: Deadlines\nkit: \"9\"\n", "base_hash": manifest}),
    )
    .unwrap();
    assert!(has(
        &findings(&k, &s, &page),
        "error",
        "smart.yaml",
        "kit version “9”"
    ));
    // No kit named: it gets the default, and is told to say so.
    let manifest = hash_of(&k, &s, &page, "smart.yaml");
    call(
        &k,
        &s,
        "smart_write_file",
        json!({"page": page, "file": "smart.yaml",
        "content": "version: 1\ntitle: Deadlines\n", "base_hash": manifest}),
    )
    .unwrap();
    assert!(has(
        &findings(&k, &s, &page),
        "warning",
        "smart.yaml",
        "does not name a kit version"
    ));
    // The page loads a kit that is not there, or none at all.
    let index = hash_of(&k, &s, &page, "index.html");
    call(
        &k,
        &s,
        "smart_write_file",
        json!({"page": page, "file": "index.html",
        "content": INDEX.replace("kit/1/", "kit/7/"), "base_hash": index}),
    )
    .unwrap();
    let found = findings(&k, &s, &page);
    assert!(
        has(&found, "error", "index.html", "kit version “7”"),
        "{found:?}"
    );
    let index = hash_of(&k, &s, &page, "index.html");
    call(
        &k,
        &s,
        "smart_write_file",
        json!({"page": page, "file": "index.html",
        "content": "<p>hi</p>", "base_hash": index}),
    )
    .unwrap();
    assert!(has(
        &findings(&k, &s, &page),
        "info",
        "index.html",
        "does not load the kit"
    ));
}

#[test]
fn smart_check_reads_the_html_and_the_files_it_names() {
    let (v, k, s) = open();
    let page = page(&k, &s);
    let write = |file: &str, content: &str| {
        let hash = k
            .smart_file(&page, file)
            .ok()
            .map(|f| f.hash)
            .unwrap_or_default();
        call(
            &k,
            &s,
            "smart_write_file",
            json!({"page": page, "file": file, "content": content, "base_hash": hash}),
        )
        .unwrap();
    };
    write("index.html", "<div>\n<p>one\n<script>var a = 1;\n");
    let found = findings(&k, &s, &page);
    assert!(
        has(&found, "error", "index.html", "never closed with </script>"),
        "{found:?}"
    );
    write("index.html", "<div><span>x</div>\n<!-- never ends\n");
    let found = findings(&k, &s, &page);
    assert!(
        has(&found, "error", "index.html", "never ends with -->"),
        "{found:?}"
    );
    assert!(has(
        &found,
        "warning",
        "index.html",
        "<span> opened on line 1 is not closed before </div>"
    ));
    write("index.html", "<div\n");
    assert!(has(
        &findings(&k, &s, &page),
        "error",
        "index.html",
        "never ends with >"
    ));
    write(
        "index.html",
        "<script src=\"missing.js\"></script><img src=\"../out.png\"><script src=\"app.js\"></script>\n<p>fine</p>",
    );
    let found = findings(&k, &s, &page);
    assert!(
        has(
            &found,
            "error",
            "index.html",
            "missing.js, which is not in the page's folder"
        ),
        "{found:?}"
    );
    assert!(has(&found, "error", "index.html", "points outside"));
    assert!(
        !found
            .iter()
            .any(|f| f["message"].as_str().unwrap().contains("app.js, which"))
    );
    write("extra.js", "var x;\n");
    assert!(has(
        &findings(&k, &s, &page),
        "info",
        "extra.js",
        "No html file"
    ));
    // The view of a manifest names a file that must be there.
    write(
        "smart.yaml",
        "version: 1\ntitle: D\nkit: \"1\"\nviews:\n  map:\n    entry: map.html\n",
    );
    assert!(has(
        &findings(&k, &s, &page),
        "error",
        "smart.yaml",
        "shows map.html"
    ));
    // A folder filled by hand: a file over the limit and one a page may not have.
    fs::write(
        v.0.join(dir_of(&page)).join("big.json"),
        vec![b'a'; 3 * 1024 * 1024],
    )
    .unwrap();
    fs::write(v.0.join(dir_of(&page)).join("tool.exe"), b"MZ").unwrap();
    let found = findings(&k, &s, &page);
    assert!(
        has(&found, "error", "big.json", "at most 2048 KB"),
        "{found:?}"
    );
    assert!(has(&found, "error", "tool.exe", "may not have this file"));
}

#[test]
fn smart_check_says_when_there_is_no_folder_or_no_index_or_no_manifest() {
    let (v, k, s) = open();
    let page = page(&k, &s);
    for file in ["index.html", "smart.yaml"] {
        call(
            &k,
            &s,
            "smart_delete_file",
            json!({"page": page, "file": file}),
        )
        .unwrap();
    }
    let found = findings(&k, &s, &page);
    assert!(
        has(&found, "error", "index.html", "no index.html"),
        "{found:?}"
    );
    assert!(has(&found, "error", "smart.yaml", "no smart.yaml"));
    // A page made smart by hand has no folder yet.
    let bare = k
        .create(
            &Actor::Human,
            &kasten_core::NewNote {
                kind: kasten_core::Kind::Page,
                title: "Bare".into(),
                date: "2026-10-23".into(),
                project: None,
                parent: None,
                template: None,
                icon: None,
            },
            Instant::now(),
        )
        .unwrap();
    k.set_meta(
        &Actor::Human,
        &bare.meta.path,
        "layout",
        Some("smart"),
        Instant::now(),
    )
    .unwrap();
    let found = findings(&k, &s, &bare.meta.path);
    assert!(has(&found, "error", "", "has no folder yet"), "{found:?}");
    assert!(!v.0.join(dir_of(&bare.meta.path)).exists());
}

#[test]
fn smart_render_says_it_cannot_draw_here_and_never_fails_for_it() {
    let (_v, k, s) = open();
    let page = page(&k, &s);
    let told = call(&k, &s, "smart_render", json!({"page": page})).unwrap();
    assert_eq!(told["drawn"], json!(false));
    let why = told["reason"].as_str().unwrap();
    assert!(
        why.contains("cannot draw a smart page") && why.contains("smart_check"),
        "{why}"
    );
    // Named views are looked up first.
    let view = call(
        &k,
        &s,
        "smart_render",
        json!({"page": page, "view": "nope"}),
    )
    .unwrap_err();
    assert!(
        view.contains("no named views") || view.contains("no view called"),
        "{view}"
    );
    assert!(
        call(
            &k,
            &s,
            "smart_render",
            json!({"page": "Welcome to KastenFlow"})
        )
        .is_err()
    );
}

#[test]
fn a_batch_cannot_carry_a_smart_page_tool() {
    let (v, k, s) = open();
    let told = call(
        &k,
        &s,
        "batch",
        json!({"ops": [{"tool": "smart_create", "args": {"title": "X", "files": files()}}]}),
    );
    assert!(told.is_err(), "{told:?}");
    assert!(!v.0.join("library/x.md").exists());
}
