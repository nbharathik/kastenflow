//! The LaTeX tools that need the app: `latex_build` with `wait` and
//! `latex_export_pdf`. The app is a stand-in thread that serves the vault's
//! mailbox (the real app does the same with its own build engine); the tools
//! ask it, wait, and say plainly when it is closed or does not answer.

mod common;

use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use common::{Client, TempDir, vault};
use kasten_core::agent::{AgentOp, Session};
use kasten_core::bridge::{Call, Handler, Server, serve};
use kasten_core::config_keys::{AgentMode, AgentsConfig};
use kasten_core::history::Actor;
use kasten_core::latex::build_dir;
use kasten_core::{Instant, Kasten};
use kasten_mcp::tools::{Writes, call, call_in, specs};
use serde_json::{Value, json};

const BASE: &str = "projects/photo-organiser/latex";
const ARTICLE: &str = "projects/photo-organiser/latex/article";
const PDF: &[u8] = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n";

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

/// A vault with an article and a locked document, the plugin on.
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

fn mode(k: &Kasten, mode: AgentMode) {
    let mut config = k.config();
    config.agents = Some(AgentsConfig {
        mode: Some(mode),
        ..AgentsConfig::default()
    });
    k.set_config(config).unwrap();
}

/// What the stand-in app was asked: the kind, the document, the asker's client.
type Seen = Arc<Mutex<Vec<(String, String, Option<String>)>>>;

fn note(seen: &Seen, request: &kasten_core::bridge::Request, call: &Call) {
    seen.lock().unwrap().push((
        call.kind().to_owned(),
        call.doc().to_owned(),
        request.session.as_ref().map(|s| s.client.clone()),
    ));
}

/// An app that builds with errors and keeps nothing.
fn stand_in(root: &Path, seen: &Seen) -> Server {
    let seen = Arc::clone(seen);
    let handler: Handler = Arc::new(move |request, call| {
        note(&seen, &request, &call);
        match call {
            Call::LatexBuild { wait_ms, .. } => Ok(json!({
                "doc": call.doc(),
                "built": true,
                "succeeded": false,
                "errors": 1,
                "warnings": 1,
                "diagnostics": [
                    {"severity": "error", "file": "main.tex", "line": 12, "message": "Undefined control sequence"},
                    {"severity": "warning", "file": null, "line": null, "message": "Label multiply defined"}
                ],
                "pages": 2,
                "pdf_bytes": 1234,
                "build_ms": 800,
                "asked_to_wait_ms": wait_ms,
            })),
            _ => Err("not asked in this test".to_owned()),
        }
    });
    serve(kasten_mcp::bridge::mailbox(root).unwrap(), "1.2.2", handler).unwrap()
}

/// An app that keeps the PDF through the core's guarded op, as the real one does.
fn app_that_exports(root: &Path, seen: &Seen) -> Server {
    let app = Arc::new(Kasten::open(root).unwrap());
    let seen = Arc::clone(seen);
    let handler: Handler = Arc::new(move |request, call| {
        note(&seen, &request, &call);
        let Call::LatexExportPdf { doc, reason } = call else {
            return Err("not asked in this test".to_owned());
        };
        let session = request.session.ok_or("no session")?;
        let op = AgentOp::ExportLatexPdf { doc, reason };
        let outcome = app
            .agent_run(&session, &op, Instant::now())
            .map_err(|e| e.to_string())?;
        let mut told = serde_json::to_value(outcome).map_err(|e| e.to_string())?;
        told["session"] = json!(session.id);
        told["pages"] = json!(2);
        told["size_bytes"] = json!(PDF.len());
        Ok(told)
    });
    serve(kasten_mcp::bridge::mailbox(root).unwrap(), "1.2.2", handler).unwrap()
}

fn seen() -> Seen {
    Arc::new(Mutex::new(Vec::new()))
}

/// The built PDF in the cache for `doc`, made after its sources.
fn cache_pdf(v: &TempDir, doc: &str) {
    let path = v.0.join(build_dir(doc)).join("out/main.pdf");
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, PDF).unwrap();
    // Newer than every source, whatever the copy did to their times.
    fs::File::options()
        .write(true)
        .open(path)
        .unwrap()
        .set_modified(SystemTime::now())
        .unwrap();
}

fn build_now(k: &Kasten, s: &Session, extra: Value) -> Result<Value, String> {
    let mut args = json!({"doc": "article", "wait": true});
    args.as_object_mut()
        .unwrap()
        .extend(extra.as_object().cloned().unwrap_or_default());
    call(k, s, "latex_build", args)
}

#[test]
fn the_tools_are_described_listed_only_with_the_plugin_and_not_read_only_when_they_keep_a_pdf() {
    let all = specs();
    let build = all.iter().find(|s| s.name == "latex_build").unwrap();
    let export = all.iter().find(|s| s.name == "latex_export_pdf").unwrap();
    assert!(build.read_only, "building changes nothing in the vault");
    assert!(!export.read_only);
    let props = &build.input_schema["properties"];
    assert!(props["wait"].is_object() && props["timeout_seconds"].is_object());
    assert_eq!(export.input_schema["required"], json!(["doc"]));
    for spec in [build, export] {
        for jargon in [
            "commit", "sidecar", "AgentOp", "mailbox", "bridge", "dev/", "ADR",
        ] {
            assert!(
                !spec.description.contains(jargon),
                "{}: {jargon}",
                spec.name
            );
        }
    }
    assert!(build.description.contains("90") && build.description.contains("300"));
    assert!(export.description.contains("app must be open"));

    // Over the wire an off plugin's tools are simply not there; on, both are.
    let v = vault();
    let mut off = Client::start(&v.0, "test-agent");
    assert!(!off.tools().iter().any(|t| t.starts_with("latex_")));
    drop(off);
    Kasten::open(&v.0)
        .unwrap()
        .set_plugin_enabled(&Actor::Human, "latex", true, Instant::now())
        .unwrap();
    let mut on = Client::start(&v.0, "test-agent");
    let tools = on.tools();
    for tool in ["latex_build", "latex_export_pdf"] {
        assert!(tools.iter().any(|t| t == tool), "{tool} in {tools:?}");
    }
}

#[test]
fn waiting_for_a_build_asks_the_app_and_gives_its_answer() {
    let (v, k, s) = open();
    let asked = seen();
    let _app = stand_in(&v.0, &asked);
    let told = build_now(&k, &s, json!({"timeout_seconds": 30})).unwrap();
    assert_eq!(told["waited"], json!(true));
    assert_eq!(told["errors"], json!(1));
    assert_eq!(told["pages"], json!(2));
    assert_eq!(told["pdf_bytes"], json!(1234));
    assert_eq!(told["diagnostics"][0]["file"], json!("main.tex"));
    assert_eq!(told["diagnostics"][0]["line"], json!(12));
    assert_eq!(told["main"], json!("main.tex"));
    // The app was asked for the document's folder, and told it should wait a little less than we do.
    assert_eq!(told["asked_to_wait_ms"], json!(28_000));
    assert_eq!(
        asked.lock().unwrap().as_slice(),
        [(
            "latex_build".to_owned(),
            ARTICLE.to_owned(),
            Some("claude-code".to_owned())
        )]
    );
    // A document never built is waited for 240 s (the engine fetches its packages), one that was 90 s, and the most is 300 s.
    assert_eq!(
        build_now(&k, &s, json!({})).unwrap()["asked_to_wait_ms"],
        json!(238_000)
    );
    let log = v.0.join(build_dir(ARTICLE)).join("out/main.log");
    fs::create_dir_all(log.parent().unwrap()).unwrap();
    fs::write(&log, "This is XeTeX, Version 3\n").unwrap();
    assert_eq!(
        build_now(&k, &s, json!({})).unwrap()["asked_to_wait_ms"],
        json!(88_000)
    );
    assert_eq!(
        build_now(&k, &s, json!({"timeout_seconds": 9999})).unwrap()["asked_to_wait_ms"],
        json!(298_000)
    );
}

#[test]
fn without_wait_the_tool_only_reads_and_asks_nothing() {
    let (v, k, s) = open();
    let asked = seen();
    let _app = stand_in(&v.0, &asked);
    for args in [
        json!({"doc": "article"}),
        json!({"doc": "article", "wait": false}),
    ] {
        let told = call(&k, &s, "latex_build", args).unwrap();
        assert_eq!(told["built"], json!(false));
        assert!(told.get("waited").is_none());
    }
    assert!(asked.lock().unwrap().is_empty());
}

#[test]
fn a_closed_app_is_one_plain_sentence_for_both_tools() {
    let (_v, k, s) = open();
    let why = build_now(&k, &s, json!({})).unwrap_err();
    assert!(why.starts_with("The app is closed"), "{why}");
    let why = call(&k, &s, "latex_export_pdf", json!({"doc": "article"})).unwrap_err();
    assert!(why.starts_with("The app is closed"), "{why}");
    assert!(why.len() < 200, "{why}");
}

#[test]
fn an_app_that_is_open_but_does_not_answer_is_timed_out_in_words() {
    let (v, k, s) = open();
    // Open (it says so) but nobody works the requests.
    kasten_mcp::bridge::mailbox(&v.0)
        .unwrap()
        .mark_alive("1.2.2", Instant::now().millis)
        .unwrap();
    let why = build_now(&k, &s, json!({"timeout_seconds": 1})).unwrap_err();
    assert!(why.starts_with("The build did not finish in time"), "{why}");
    assert!(
        fs::read_dir(v.0.join(".kasten/cache/bridge/requests"))
            .unwrap()
            .next()
            .is_none(),
        "the request was withdrawn"
    );
}

#[test]
fn what_the_app_refuses_is_passed_on_in_its_words() {
    let (v, k, s) = open();
    let handler: Handler = Arc::new(|_, _| Err("No TeX engine is installed".to_owned()));
    let _app = serve(kasten_mcp::bridge::mailbox(&v.0).unwrap(), "1.2.2", handler).unwrap();
    assert_eq!(
        build_now(&k, &s, json!({})).unwrap_err(),
        "No TeX engine is installed"
    );
}

#[test]
fn a_document_that_is_not_there_is_refused_before_the_app_is_asked() {
    let (v, k, s) = open();
    let asked = seen();
    let _app = stand_in(&v.0, &asked);
    let why = call(
        &k,
        &s,
        "latex_build",
        json!({"doc": "nothing", "wait": true}),
    )
    .unwrap_err();
    assert!(why.contains("No LaTeX document called"), "{why}");
    let why = call(&k, &s, "latex_export_pdf", json!({"doc": "../../etc"})).unwrap_err();
    assert!(why.contains("No LaTeX document called"), "{why}");
    assert!(asked.lock().unwrap().is_empty());
}

#[test]
fn a_plugin_that_is_off_turns_both_away() {
    let (_v, k, s) = open();
    k.set_plugin_enabled(&Actor::Human, "latex", false, Instant::now())
        .unwrap();
    for (tool, args) in [
        ("latex_build", json!({"doc": "article", "wait": true})),
        ("latex_export_pdf", json!({"doc": "article"})),
    ] {
        assert_eq!(
            call(&k, &s, tool, args).unwrap_err(),
            "Turn on the LaTeX plugin in Settings → Plugins",
            "{tool}"
        );
    }
}

#[test]
fn a_locked_document_is_refused_before_the_app_is_asked() {
    let (v, k, s) = open();
    let asked = seen();
    let _app = stand_in(&v.0, &asked);
    let why = call(&k, &s, "latex_export_pdf", json!({"doc": "twocolumn"})).unwrap_err();
    assert!(why.contains("locked"), "{why}");
    assert!(asked.lock().unwrap().is_empty());
}

#[test]
fn the_app_keeps_the_pdf_as_one_commit_in_the_agents_session() {
    let (v, k, s) = open();
    cache_pdf(&v, ARTICLE);
    mode(&k, AgentMode::Balanced);
    let asked = seen();
    let _app = app_that_exports(&v.0, &asked);
    let told = call(
        &k,
        &s,
        "latex_export_pdf",
        json!({"doc": "article", "reason": "the paper is ready"}),
    )
    .unwrap();
    assert_eq!(told["status"], json!("done"), "{told}");
    assert_eq!(told["result"]["path"], json!(format!("{ARTICLE}/main.pdf")));
    assert_eq!(told["pages"], json!(2));
    assert_eq!(told["size_bytes"], json!(PDF.len()));
    assert_eq!(told["doc"], json!(ARTICLE));
    assert_eq!(fs::read(v.0.join(ARTICLE).join("main.pdf")).unwrap(), PDF);
    let log = k.log(None, 2).unwrap();
    assert_eq!(log[0].session.as_deref(), Some(s.id.as_str()));
    assert_eq!(log[0].op.as_deref(), Some("export_latex_pdf"));
    assert_eq!(
        asked.lock().unwrap().as_slice(),
        [(
            "latex_export_pdf".to_owned(),
            ARTICLE.to_owned(),
            Some("claude-code".to_owned())
        )]
    );
    // One undo takes it back.
    k.undo_session(&s.id, Instant::now()).unwrap();
    assert!(!v.0.join(ARTICLE).join("main.pdf").exists());
}

#[test]
fn in_review_mode_the_pdf_waits_for_the_user() {
    let (v, k, s) = open();
    cache_pdf(&v, ARTICLE);
    mode(&k, AgentMode::Review);
    let _app = app_that_exports(&v.0, &seen());
    let told = call(&k, &s, "latex_export_pdf", json!({"doc": "article"})).unwrap();
    assert_eq!(told["status"], json!("pending_review"), "{told}");
    assert!(!v.0.join(ARTICLE).join("main.pdf").exists());
    assert_eq!(k.proposals().unwrap().len(), 1);
}

#[test]
fn a_chat_that_previews_its_changes_builds_and_holds_the_export() {
    let (v, k, s) = open();
    cache_pdf(&v, ARTICLE);
    let asked = seen();
    let _app = stand_in(&v.0, &asked);
    let set = Mutex::new(k.begin_changes(&s, Instant::now()));
    let told = call_in(
        &k,
        &s,
        Writes::Staged(&set),
        "latex_export_pdf",
        json!({"doc": "article"}),
    )
    .unwrap();
    assert_eq!(told["status"], json!("pending_review"), "{told}");
    assert!(!v.0.join(ARTICLE).join("main.pdf").exists());
    // The app was asked to build, and nothing else.
    let kinds: Vec<String> = asked.lock().unwrap().iter().map(|a| a.0.clone()).collect();
    assert_eq!(kinds, ["latex_build"]);
}

#[test]
fn over_the_wire_a_build_waits_for_the_app_and_a_closed_app_is_said() {
    let (v, _k, _s) = open();
    let mut client = Client::start(&v.0, "test-agent");
    let closed = client
        .call("latex_build", json!({"doc": "article", "wait": true}))
        .unwrap_err();
    assert!(closed.contains("The app is closed"), "{closed}");
    let asked = seen();
    let _app = stand_in(&v.0, &asked);
    let told = client
        .call(
            "latex_build",
            json!({"doc": "article", "wait": true, "timeout_seconds": 30}),
        )
        .unwrap();
    assert_eq!(told["errors"], json!(1), "{told}");
    assert_eq!(told["waited"], json!(true));
    assert_eq!(asked.lock().unwrap().len(), 1);
}
