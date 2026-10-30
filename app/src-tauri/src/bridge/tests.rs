//! The app's side of the mailbox with a stand-in app: a build request becomes
//! a build (the tests' fake engine does it), a reply is written, keeping a PDF
//! is the core's agent op in the asker's session, and the loop ends when the
//! vault closes. The mailbox is the real one, asked as the MCP server asks.

use std::collections::VecDeque;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use kasten_core::agent::{AgentOp, Session};
use kasten_core::bridge::{Answer, Call, Mailbox, Sharing, Snippet};
use kasten_core::config_keys::{AgentMode, AgentsConfig};
use kasten_core::history::Actor;
use kasten_core::latex::LatexDoc;
use kasten_core::{Instant, Kasten};
use serde_json::Value;

use super::pages::{pages_in_log, pages_in_pdf};
use super::window::Failed;
use super::{Running, Side, start};
use crate::plugins::latex::build::execute;
use crate::plugins::latex::engines::Engine;
use crate::plugins::latex::preview::{Previewed, run_in};
use crate::plugins::latex::service::Outcome;
use crate::plugins::latex::snapshot::Buffer;
use crate::plugins::latex::tests::support::{Dir, FOLDER, job, vault, wrap};

mod more;

/// An app that builds with the fake engine in the mode it is set to, draws with
/// a fake window that answers what it is told to, and shares a selection it holds.
struct StandIn {
    kasten: Arc<Kasten>,
    plugin_on: AtomicBool,
    diagrams_on: AtomicBool,
    mode: Mutex<&'static str>,
    builds: AtomicUsize,
    stuck: AtomicBool,
    /// What the window answers to each picture it is asked for, in turn.
    window: Mutex<VecDeque<Result<String, Failed>>>,
    /// The SVG and background each picture was asked with.
    drawn: Mutex<Vec<(String, String)>>,
    sharing: Sharing,
    /// What the window would publish.
    selected: Mutex<Vec<Snippet>>,
    /// The window is there and publishes at once when asked.
    window_publishes: AtomicBool,
    /// Preview builds made, and the files the last one was given.
    previews: AtomicUsize,
    previewed: Mutex<Vec<(String, String)>>,
}

impl Side for StandIn {
    fn kasten(&self) -> Result<Arc<Kasten>, String> {
        Ok(Arc::clone(&self.kasten))
    }

    fn latex_on(&self) -> Result<(), String> {
        if self.plugin_on.load(Ordering::SeqCst) {
            Ok(())
        } else {
            Err("Turn on the LaTeX plugin in Settings → Plugins".to_owned())
        }
    }

    fn diagrams_on(&self) -> Result<(), String> {
        if self.diagrams_on.load(Ordering::SeqCst) {
            Ok(())
        } else {
            Err("Turn on the Diagrams plugin in Settings → Plugins".to_owned())
        }
    }

    fn draw_png(&self, svg: &str, background: &str, _wait: Duration) -> Result<String, Failed> {
        self.drawn
            .lock()
            .unwrap()
            .push((svg.to_owned(), background.to_owned()));
        self.window
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or_else(|| {
                Err(Failed {
                    why: "KastenFlow's window did not draw the picture in time. Open its window and ask again".to_owned(),
                    answered: false,
                })
            })
    }

    fn share_selection(&self, now: u64) -> Result<(), String> {
        self.sharing.ask(now);
        if self.window_publishes.load(Ordering::SeqCst) {
            let mailbox =
                kasten_mcp::bridge::mailbox(self.kasten.root()).map_err(|e| e.to_string())?;
            let held = self.selected.lock().unwrap().clone();
            self.sharing
                .publish(&mailbox, &held, now)
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn selection_published_since(&self, since: u64) -> bool {
        self.sharing.written_since(since)
    }

    fn build(&self, doc: &LatexDoc, _wait: Duration) -> Result<Outcome, String> {
        self.builds.fetch_add(1, Ordering::SeqCst);
        if self.stuck.load(Ordering::SeqCst) {
            return Err("The build did not finish in time".to_owned());
        }
        let job = job(self.kasten.root(), Engine::Tectonic);
        assert_eq!(
            job.folder, doc.folder,
            "the build is of the document asked for"
        );
        let mode = *self.mode.lock().unwrap();
        let wrapped = wrap(mode, job.out(), "main", None);
        Ok(execute(&job, &AtomicBool::new(false), &|_| {}, &wrapped))
    }

    fn build_preview(
        &self,
        _doc: &LatexDoc,
        files: Vec<(String, String)>,
        _wait: Duration,
    ) -> Result<Previewed, String> {
        self.previews.fetch_add(1, Ordering::SeqCst);
        *self.previewed.lock().unwrap() = files.clone();
        let mode = *self.mode.lock().unwrap();
        let mut probe = job(self.kasten.root(), Engine::Tectonic);
        probe.scratch = Some("bridge-preview".to_owned());
        let wrapped = wrap(mode, probe.out(), "main", None);
        let mut real = job(self.kasten.root(), Engine::Tectonic);
        real.buffers = files
            .into_iter()
            .map(|(rel, text)| Buffer {
                path: format!("{FOLDER}/{rel}"),
                text,
            })
            .collect();
        Ok(run_in(real, "bridge-preview", &wrapped))
    }
}

struct Setup {
    _dir: Dir,
    root: std::path::PathBuf,
    side: Arc<StandIn>,
    running: Running,
}

fn setup(mode: &'static str) -> Setup {
    let dir = Dir::new("bridge");
    let root = vault(&dir);
    let kasten = Arc::new(Kasten::open(&root).unwrap());
    kasten.start_history().unwrap();
    kasten
        .set_plugin_enabled(&Actor::Human, "latex", true, Instant::now())
        .unwrap();
    let side = Arc::new(StandIn {
        kasten: Arc::clone(&kasten),
        plugin_on: AtomicBool::new(true),
        diagrams_on: AtomicBool::new(true),
        mode: Mutex::new(mode),
        builds: AtomicUsize::new(0),
        stuck: AtomicBool::new(false),
        window: Mutex::new(VecDeque::new()),
        drawn: Mutex::new(Vec::new()),
        sharing: Sharing::default(),
        selected: Mutex::new(Vec::new()),
        window_publishes: AtomicBool::new(true),
        previews: AtomicUsize::new(0),
        previewed: Mutex::new(Vec::new()),
    });
    let running = start(&kasten, side.clone()).unwrap();
    Setup {
        _dir: dir,
        root,
        side,
        running,
    }
}

fn mailbox(root: &Path) -> Mailbox {
    kasten_mcp::bridge::mailbox(root).unwrap()
}

/// Asks as the MCP server does; the reply's result, or its error.
fn ask(root: &Path, call: &Call, session: Option<&Session>) -> Result<Value, String> {
    match mailbox(root)
        .ask(call, session, Duration::from_secs(120))
        .unwrap()
    {
        Answer::Reply(reply) if reply.ok => Ok(reply.result),
        Answer::Reply(reply) => Err(reply.error.unwrap_or_default()),
        other => Err(format!("{other:?}")),
    }
}

fn build(doc: &str) -> Call {
    Call::LatexBuild {
        doc: doc.into(),
        wait_ms: 60_000,
        preview: false,
    }
}

fn export(doc: &str) -> Call {
    Call::LatexExportPdf {
        doc: doc.into(),
        reason: Some("the paper is ready".into()),
    }
}

fn session() -> Session {
    Session::start("claude-code", Instant::now())
}

fn config_mode(kasten: &Kasten, mode: AgentMode) {
    let mut config = kasten.config();
    config.agents = Some(AgentsConfig {
        mode: Some(mode),
        ..AgentsConfig::default()
    });
    kasten.set_config(config).unwrap();
}

#[test]
fn a_build_request_becomes_a_build_and_its_errors_come_back_with_file_and_line() {
    let app = setup("fail");
    let told = ask(&app.root, &build(FOLDER), None).unwrap();
    assert_eq!(told["succeeded"], false);
    assert_eq!(told["errors"], 1);
    assert_eq!(told["warnings"], 0);
    assert_eq!(told["diagnostics"][0]["severity"], "error");
    assert_eq!(told["diagnostics"][0]["file"], "main.tex");
    assert_eq!(told["diagnostics"][0]["line"], 3);
    assert!(
        told["diagnostics"][0]["message"]
            .as_str()
            .unwrap()
            .contains("Undefined control sequence")
    );
    assert_eq!(told["summary"], "The build had 1 error and 0 warnings");
    assert!(told["pdf_bytes"].is_null());
    assert_eq!(app.side.builds.load(Ordering::SeqCst), 1);
}

#[test]
fn a_build_that_works_says_the_pdf_size_and_how_long_it_took() {
    let app = setup("ok");
    let told = ask(&app.root, &build(FOLDER), Some(&session())).unwrap();
    assert_eq!(told["succeeded"], true);
    assert_eq!(told["errors"], 0);
    assert_eq!(told["pdf_bytes"], "%PDF-1.4\nfake\n".len());
    assert!(told["build_ms"].is_u64());
    // The fake PDF holds no page objects, so the count is not guessed.
    assert!(told["pages"].is_null());
    assert_eq!(
        told["summary"],
        "The build worked, with no errors or warnings"
    );
    // Nothing but the cache was written: the document's folder is as it was.
    assert!(!Path::new(&app.root).join(FOLDER).join("main.pdf").exists());
}

#[test]
fn the_loop_ends_with_the_vault_and_the_app_is_then_closed() {
    let app = setup("ok");
    let mailbox = mailbox(&app.root);
    assert!(mailbox.alive(Instant::now().millis).is_some());
    app.running.stop();
    assert!(mailbox.alive(Instant::now().millis).is_none());
    let closed = mailbox
        .ask(&build(FOLDER), None, Duration::from_secs(2))
        .unwrap();
    assert_eq!(closed, Answer::AppClosed);
    // Stopping twice is harmless.
    app.running.stop();
}

#[test]
fn a_preview_build_is_of_the_waiting_changes_and_leaves_the_saved_files_alone() {
    let app = setup("fail");
    config_mode(&app.side.kasten, AgentMode::Review);
    let asker = session();
    let path = format!("{FOLDER}/main.tex");
    let before = std::fs::read_to_string(app.root.join(&path)).unwrap();
    let op = AgentOp::SaveSource {
        path: path.clone(),
        text: before.replace("\\input{sections/intro}", "Hi."),
        base: before.clone(),
        reason: None,
    };
    app.side
        .kasten
        .agent_run(&asker, &op, Instant::now())
        .unwrap();
    let call = Call::LatexBuild {
        doc: FOLDER.into(),
        wait_ms: 60_000,
        preview: true,
    };
    let told = ask(&app.root, &call, Some(&asker)).unwrap();
    assert_eq!(told["preview"], true, "{told}");
    assert_eq!(told["proposed_files"][0], "main.tex");
    assert_eq!(told["errors"], 1);
    assert!(
        told["summary"]
            .as_str()
            .unwrap()
            .starts_with("Preview of your changes that wait for review"),
        "{told}"
    );
    assert!(told["pdf_bytes"].is_null());
    let given = app.side.previewed.lock().unwrap().clone();
    assert_eq!(given.len(), 1);
    assert!(given[0].1.contains("Hi.") && !given[0].1.contains("\\input"));
    assert_eq!(app.side.previews.load(Ordering::SeqCst), 1);
    assert_eq!(app.side.builds.load(Ordering::SeqCst), 0);
    assert_eq!(
        std::fs::read_to_string(app.root.join(&path)).unwrap(),
        before
    );
    // Someone with no waiting changes gets an ordinary build of the saved files.
    let other = ask(&app.root, &call, Some(&session())).unwrap();
    assert!(other.get("preview").is_none(), "{other}");
    assert_eq!(app.side.builds.load(Ordering::SeqCst), 1);
}

#[test]
fn a_plugin_that_is_off_and_a_folder_that_is_no_document_are_said_in_a_sentence() {
    let app = setup("ok");
    let why = ask(&app.root, &build("notes"), None).unwrap_err();
    assert!(why.contains("not a LaTeX document"), "{why}");
    app.side.plugin_on.store(false, Ordering::SeqCst);
    let why = ask(&app.root, &build(FOLDER), None).unwrap_err();
    assert!(why.contains("LaTeX plugin"), "{why}");
    assert_eq!(app.side.builds.load(Ordering::SeqCst), 0);
}

#[test]
fn a_build_that_takes_too_long_is_said_so() {
    let app = setup("ok");
    app.side.stuck.store(true, Ordering::SeqCst);
    let why = ask(&app.root, &build(FOLDER), None).unwrap_err();
    assert_eq!(why, "The build did not finish in time");
}

#[test]
fn keeping_the_pdf_builds_if_needed_then_commits_once_in_the_askers_session() {
    let app = setup("ok");
    let asker = session();
    let told = ask(&app.root, &export(FOLDER), Some(&asker)).unwrap();
    assert_eq!(told["status"], "done", "{told}");
    assert_eq!(told["path"], format!("{FOLDER}/main.pdf"));
    assert_eq!(told["session"], asker.id.as_str());
    assert_eq!(told["size_bytes"], "%PDF-1.4\nfake\n".len());
    assert_eq!(
        std::fs::read(app.root.join(FOLDER).join("main.pdf")).unwrap(),
        b"%PDF-1.4\nfake\n"
    );
    let log = app.side.kasten.log(None, 1).unwrap();
    assert_eq!(log[0].session.as_deref(), Some(asker.id.as_str()));
    assert_eq!(log[0].op.as_deref(), Some("export_latex_pdf"));
    assert_eq!(app.side.builds.load(Ordering::SeqCst), 1);
    // A second ask finds the build fresh and does not build again.
    ask(&app.root, &export(FOLDER), Some(&asker)).unwrap();
    assert_eq!(app.side.builds.load(Ordering::SeqCst), 1);
}

#[test]
fn in_review_mode_the_pdf_is_built_but_waits_for_the_user() {
    let app = setup("ok");
    config_mode(&app.side.kasten, AgentMode::Review);
    let told = ask(&app.root, &export(FOLDER), Some(&session())).unwrap();
    assert_eq!(told["status"], "pending_review", "{told}");
    assert!(!app.root.join(FOLDER).join("main.pdf").exists());
    assert_eq!(app.side.kasten.proposals().unwrap().len(), 1);
}

#[test]
fn a_failed_build_keeps_no_pdf_and_says_what_to_do() {
    let app = setup("fail");
    let why = ask(&app.root, &export(FOLDER), Some(&session())).unwrap_err();
    assert!(why.contains("no new PDF to keep"), "{why}");
    assert!(why.contains("latex_build"), "{why}");
    assert!(!app.root.join(FOLDER).join("main.pdf").exists());
}

#[test]
fn keeping_a_pdf_needs_to_know_whose_it_is() {
    let app = setup("ok");
    let why = ask(&app.root, &export(FOLDER), None).unwrap_err();
    assert!(why.contains("whose"), "{why}");
    assert!(!app.root.join(FOLDER).join("main.pdf").exists());
}

#[test]
fn pages_are_read_from_the_log_then_counted_in_the_pdf_and_never_guessed() {
    let log = "(./main.tex)\nOutput written on main.pdf (3 pages, 41234 bytes).\nTranscript written on main.log.\n";
    assert_eq!(pages_in_log(log), Some(3));
    assert_eq!(
        pages_in_log("Output written on main.pdf (1 page, 9 bytes)."),
        Some(1)
    );
    // A wrapped line, and the last mention wins.
    let wrapped = "Output written on old.pdf (2 pages, 1 bytes).\nOutput written on a-very-long-name.pdf\n(7 pages, 1 bytes).";
    assert_eq!(pages_in_log(wrapped), Some(7));
    assert_eq!(pages_in_log("no such line"), None);
    assert_eq!(pages_in_log("Output written on main.pdf (no pages)"), None);

    let pdf = b"%PDF-1.4\n1 0 obj\n<< /Type /Pages /Count 2 >>\nendobj\n2 0 obj\n<< /Type /Page /Parent 1 0 R >>\nendobj\n3 0 obj\n<</Type/Page>>\nendobj\n";
    assert_eq!(pages_in_pdf(pdf), Some(2));
    assert_eq!(pages_in_pdf(b"%PDF-1.4\nfake\n"), None);
    assert_eq!(pages_in_pdf(b"/Type /Pages only"), None);
}
