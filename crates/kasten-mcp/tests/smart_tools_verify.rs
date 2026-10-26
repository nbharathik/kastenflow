//! Added when the smart page tools were verified: ways around the network
//! check, hostile files that must not take long or fill the answer, line
//! endings kept by an edit, the error log read safely, and wording that never
//! says a page is safe.

mod common;

use std::fs;
use std::time::Instant as Clock;

use common::{TempDir, vault};
use kasten_core::agent::Session;
use kasten_core::{Instant, Kasten};
use kasten_mcp::tools::call;
use serde_json::{Value, json};

fn open() -> (TempDir, Kasten, Session) {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    (v, k, Session::start("claude-code", Instant::now()))
}

fn make(k: &Kasten, s: &Session, files: Value) -> (String, String) {
    let made = call(
        k,
        s,
        "smart_create",
        json!({"title": "Verify", "files": files}),
    )
    .unwrap();
    assert_eq!(made["status"], json!("done"), "{made}");
    let page = made["result"]["page"].as_str().unwrap().to_owned();
    let id = made["result"]["id"].as_str().unwrap().to_owned();
    (page, id)
}

fn dir_of(page: &str) -> String {
    format!("{}.smart", page.strip_suffix(".md").unwrap())
}

fn check(k: &Kasten, s: &Session, page: &str) -> Value {
    call(k, s, "smart_check", json!({"page": page})).unwrap()
}

/// Whether the check has a finding of one of `severities` on `line` of `file`.
fn at(found: &Value, file: &str, line: u32, severities: &[&str]) -> bool {
    found["findings"].as_array().unwrap().iter().any(|f| {
        f["file"] == file
            && f["line"] == json!(line)
            && severities.contains(&f["severity"].as_str().unwrap())
    })
}

fn write_all(k: &Kasten, s: &Session, page: &str, name: &str, lines: &[&str]) {
    call(
        k,
        s,
        "smart_write_file",
        json!({"page": page, "file": name, "content": lines.join("\n")}),
    )
    .unwrap();
}

#[test]
fn the_network_check_sees_the_usual_ways_round_it() {
    let (_v, k, s) = open();
    let (page, _) = make(
        &k,
        &s,
        json!([{"path": "index.html", "content": "<p>x</p>"}]),
    );
    let js = [
        "Fetch ('x');",
        "import('https://e.com/x.js');",
        "new WebSocket(\"ws://e.com/s\");",
        "navigator.sendBeacon (\"x\");",
        "new Image().src='http://e.com/p.gif';",
        "window.open('https://e.com');",
        "location='https://e.com';",
        "var u = \"HTTPS://E.COM/up\";",
        "var ok = 'fetched data';",
    ];
    write_all(&k, &s, &page, "evil.js", &js);
    let html = [
        "<meta http-equiv=\"refresh\" content=\"0;url=https://e.com\">",
        "<form action=\"https://e.com/post\"></form>",
        "<iframe src=https://e.com/x></iframe>",
        "<object data=\"https://e.com/o\"></object>",
        "<embed src=//e.com/x.swf>",
        "<SCRIPT SRC=\"HTTPS://E.COM/x.js\"></SCRIPT>",
        "<a href=\"https://e.com\">x</a>",
        "<img src=\"//cdn.e.com/p.png\">",
        "<link rel=stylesheet href='http://e.com/a.css'>",
    ];
    write_all(&k, &s, &page, "evil.html", &html);
    let css = [
        "a{background:url( \"https://e.com/x.png\" )}",
        "@import \"https://e.com/a.css\";",
        "@import url(https://e.com/b.css);",
        "b{background:URL(//e.com/c.png)}",
    ];
    write_all(&k, &s, &page, "evil.css", &css);
    write_all(
        &k,
        &s,
        &page,
        "evil.svg",
        &[
            "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"><use xlink:href=\"https://e.com/s.svg#a\"/></svg>",
        ],
    );
    let found = check(&k, &s, &page);
    for line in [1, 2, 3, 4] {
        assert!(at(&found, "evil.js", line, &["error"]), "js line {line}");
    }
    for line in [5, 6, 7, 8] {
        assert!(
            at(&found, "evil.js", line, &["error", "warning"]),
            "js line {line}"
        );
    }
    assert!(
        !at(&found, "evil.js", 9, &["error", "warning"]),
        "a word that only starts with fetch is no call"
    );
    for line in [1, 2, 3, 4, 5, 6, 8, 9] {
        assert!(
            at(&found, "evil.html", line, &["error"]),
            "html line {line}"
        );
    }
    // A link only warns: the sandbox stops the navigation whatever the file says.
    assert!(at(&found, "evil.html", 7, &["warning"]));
    assert!(!at(&found, "evil.html", 7, &["error"]));
    for line in [1, 2, 3, 4] {
        assert!(at(&found, "evil.css", line, &["error"]), "css line {line}");
    }
    assert!(at(&found, "evil.svg", 1, &["error"]));
    let message = |f: &Value| f["message"].as_str().unwrap().to_owned();
    assert!(
        !found["findings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|f| f["file"] == "evil.svg" && message(f).contains("w3.org")),
        "namespaces are names"
    );
}

#[test]
fn a_clean_check_never_says_the_page_is_safe() {
    let (_v, k, s) = open();
    let (page, _) = make(
        &k,
        &s,
        json!([{"path": "index.html", "content": "<p>x</p>"}]),
    );
    let told = check(&k, &s, &page);
    let summary = told["summary"].as_str().unwrap();
    assert!(summary.contains("Found no problems"), "{summary}");
    assert!(summary.contains("not a promise"), "{summary}");
    for word in ["ok", "safe", "secure"] {
        assert!(told.get(word).is_none(), "{word}");
    }
    let all = told.to_string().to_lowercase();
    assert!(
        !all.contains("is safe\"") && !all.contains("all clear"),
        "{all}"
    );
}

#[test]
fn hostile_files_are_checked_in_bounded_time_with_a_bounded_answer() {
    let (v, k, s) = open();
    let (page, _) = make(
        &k,
        &s,
        json!([{"path": "index.html", "content": "<p>x</p>"}]),
    );
    let folder = v.0.join(dir_of(&page));
    let two_mb = 2 * 1024 * 1024;
    let hostile: Vec<(&str, String)> = vec![
        (
            "deep.html",
            format!("{}{}", "<div>".repeat(300_000), "</b>".repeat(100_000)),
        ),
        ("urls.js", "http://".repeat(290_000)),
        ("calls.js", "fetch(a);".repeat(200_000)),
        ("links.html", "<a href=\"http://x.io\">".repeat(90_000)),
        ("quotes.html", "<a \"".repeat(500_000)),
        ("comments.html", "<!--".repeat(500_000)),
        ("lines.js", "http://x\n".repeat(200_000)),
        ("script.html", "<script>".repeat(250_000)),
        ("slashes.css", "\"//a.b".repeat(300_000)),
    ];
    for (name, text) in &hostile {
        assert!(text.len() <= two_mb, "{name} is {}", text.len());
        fs::write(folder.join(name), text).unwrap();
    }
    let started = Clock::now();
    let told = check(&k, &s, &page);
    let took = started.elapsed();
    assert!(took.as_secs() < 40, "took {took:?}");
    assert!(told["findings"].as_array().unwrap().len() <= 200);
    assert!(
        told.to_string().len() < 120_000,
        "{}",
        told.to_string().len()
    );
    let started = Clock::now();
    let read = call(&k, &s, "smart_read", json!({"page": page})).unwrap();
    assert!(started.elapsed().as_secs() < 40);
    // 60 KB of text, whatever the files hold.
    assert!(
        read.to_string().len() < 200_000,
        "{}",
        read.to_string().len()
    );
}

#[test]
fn a_folder_with_thousands_of_files_is_listed_in_part() {
    let (v, k, s) = open();
    let (page, _) = make(
        &k,
        &s,
        json!([{"path": "index.html", "content": "<p>x</p>"}]),
    );
    let folder = v.0.join(dir_of(&page));
    fs::create_dir_all(folder.join("d")).unwrap();
    for n in 0..700 {
        fs::write(folder.join(format!("d/f{n}.json")), "{}").unwrap();
    }
    fs::write(folder.join("prog.exe"), "x").unwrap();
    let read = call(&k, &s, "smart_read", json!({"page": page})).unwrap();
    assert!(read["files"].as_array().unwrap().len() <= 200);
    assert!(
        read["moreFiles"].as_u64().unwrap() >= 500,
        "{}",
        read["moreFiles"]
    );
    let told = check(&k, &s, &page);
    assert!(told["findings"].as_array().unwrap().len() <= 200);
    assert!(
        told["findings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|f| f["message"]
                .as_str()
                .unwrap()
                .contains("files; only the first")),
        "{told}"
    );
}

#[test]
fn an_edit_keeps_windows_line_breaks_and_refuses_what_it_cannot_place() {
    let (v, k, s) = open();
    let (page, _) = make(
        &k,
        &s,
        json!([
            {"path": "index.html", "content": "<p>a</p>\r\n<p>b</p>\r\n"},
            {"path": "mixed.js", "content": "a\r\nb\nc\r\n"},
            {"path": "plain.js", "content": "one\ntwo\n"},
            {"path": "aaa.txt", "content": "aaa"},
        ]),
    );
    let hash = |file: &str| {
        let r = call(&k, &s, "smart_read", json!({"page": page, "file": file})).unwrap();
        r["hash"].as_str().unwrap().to_owned()
    };
    let edit = |file: &str, steps: Value| {
        call(
            &k,
            &s,
            "smart_edit",
            json!({"page": page, "file": file, "base_hash": hash(file), "steps": steps}),
        )
    };
    let text = |file: &str| fs::read_to_string(v.0.join(dir_of(&page)).join(file)).unwrap();

    // A model sends line feeds; a file with Windows breaks keeps them throughout.
    edit(
        "index.html",
        json!([{"op": "replace", "search": "<p>a</p>\n<p>b</p>", "replace": "<p>x</p>\n<p>y</p>\n<p>z</p>"}]),
    )
    .unwrap();
    assert_eq!(text("index.html"), "<p>x</p>\r\n<p>y</p>\r\n<p>z</p>\r\n");
    // A file with a mixed set is not guessed at: the text must match exactly.
    assert!(
        edit(
            "mixed.js",
            json!([{"op": "replace", "search": "a\nb", "replace": "x"}])
        )
        .is_err()
    );
    assert_eq!(text("mixed.js"), "a\r\nb\nc\r\n");
    edit(
        "mixed.js",
        json!([{"op": "replace", "search": "b\nc", "replace": "b\nd"}]),
    )
    .unwrap();
    assert_eq!(text("mixed.js"), "a\r\nb\nd\r\n");
    // A line-feed file stays so.
    edit(
        "plain.js",
        json!([{"op": "replace", "search": "one\ntwo", "replace": "1\n2"}]),
    )
    .unwrap();
    assert_eq!(text("plain.js"), "1\n2\n");
    // Matches that overlap are two places.
    let err = edit(
        "aaa.txt",
        json!([{"op": "replace", "search": "aa", "replace": "b"}]),
    )
    .unwrap_err();
    assert!(err.contains("times"), "{err}");
    assert_eq!(text("aaa.txt"), "aaa");
    // All or none: a later step that fails leaves the file as it was.
    let before = text("plain.js");
    assert!(
        edit(
            "plain.js",
            json!([
                {"op": "replace", "search": "1", "replace": "uno"},
                {"op": "replace", "search": "not there", "replace": "x"},
            ])
        )
        .is_err()
    );
    assert_eq!(text("plain.js"), before);
}

#[test]
fn the_error_log_is_read_only_when_it_is_a_plain_file_of_sensible_size() {
    let (v, k, s) = open();
    let (page, id) = make(
        &k,
        &s,
        json!([{"path": "index.html", "content": "<p>x</p>"}]),
    );
    let cache = v.0.join(".kasten/cache/smart");
    fs::create_dir_all(&cache).unwrap();
    let log = cache.join(format!("{id}.log.json"));
    let errors = |k: &Kasten| {
        call(k, &s, "smart_read", json!({"page": page})).unwrap()["errors"]
            .as_array()
            .unwrap()
            .clone()
    };
    // A folder where the file should be.
    fs::create_dir_all(&log).unwrap();
    assert!(errors(&k).is_empty());
    fs::remove_dir_all(&log).unwrap();
    // Too big, however well formed.
    let record = json!({"time": "t", "kind": "error", "message": "m", "source": "a.js", "line": 1});
    let many: Vec<Value> = (0..30_000).map(|_| record.clone()).collect();
    fs::write(&log, json!({"records": many}).to_string()).unwrap();
    assert!(errors(&k).is_empty());
    // Nested far deeper than any log, and other shapes.
    for junk in [
        "[".repeat(100_000),
        "{\"records\": 5}".to_owned(),
        "{\"records\": [1, null, \"x\"]}".to_owned(),
        String::new(),
        "\u{0}\u{0}".to_owned(),
    ] {
        fs::write(&log, junk).unwrap();
        assert!(errors(&k).is_empty());
    }
    // Messages as long as a page likes are cut, and the answer stays small.
    let long = "x".repeat(100_000);
    let big: Vec<Value> = (0..9)
        .map(
            |n| json!({"time": "t", "kind": "error", "message": long, "source": "a.js", "line": n}),
        )
        .collect();
    fs::write(&log, json!({"records": big}).to_string()).unwrap();
    let shown = errors(&k);
    assert!(!shown.is_empty());
    assert!(Value::Array(shown).to_string().len() < 20_000);
}
