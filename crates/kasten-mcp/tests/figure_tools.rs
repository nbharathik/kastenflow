//! The tools that need the app's window: a diagram as a LaTeX figure and as a
//! PNG in assets/, and the user's selection. The app is a stand-in thread
//! that serves the vault's mailbox (the real app does the same, drawing in its
//! window); the tools ask it, keep what it draws through the guarded ops in the
//! agent's session, and say plainly when the app is closed or says no.

mod common;

use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};

use common::{Client, TempDir, vault};
use kasten_core::agent::Session;
use kasten_core::bridge::{Call, Handler, Server, serve};
use kasten_core::history::Actor;
use kasten_core::{Instant, Kasten};
use kasten_mcp::tools::{Writes, call, call_in, specs};
use serde_json::{Value, json};

const BASE: &str = "projects/photo-organiser/latex";
const ARTICLE: &str = "projects/photo-organiser/latex/article";
/// A 1 by 1 PNG, as base64.
const PNG64: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

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

/// A vault with an article, a locked document and a diagram, both plugins on.
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
    let s = Session::start("claude-code", Instant::now());
    call(
        &k,
        &s,
        "diagram_new",
        json!({"title": "Flow", "spec": {"nodes": [{"id": "web", "label": "Web app", "kind": "client"}]}}),
    )
    .unwrap();
    (v, k, s)
}

/// What the stand-in app was asked to draw: the diagram, the page and the asker's client.
type Seen = Arc<Mutex<Vec<(String, Option<String>, Option<String>)>>>;

fn seen() -> Seen {
    Arc::new(Mutex::new(Vec::new()))
}

/// An app that makes the diagram's picture as the real one does (a second Kasten on the vault) and
/// draws it, whatever it is, as the same small PNG.
fn app_that_draws(root: &Path, seen: &Seen) -> Server {
    let seen = Arc::clone(seen);
    let app = Arc::new(Kasten::open(root).unwrap());
    let handler: Handler = Arc::new(move |request, call| match call {
        Call::DiagramPng { diagram, page } => {
            let picture = app
                .diagram_picture(&diagram, page.as_deref(), true)
                .map_err(|e| e.to_string())?;
            if !picture.svg.contains("Web app") {
                return Err("The picture is not the diagram's".to_owned());
            }
            seen.lock().unwrap().push((
                diagram,
                page,
                request.session.as_ref().map(|s| s.client.clone()),
            ));
            Ok(json!({
                "png_base64": PNG64,
                "bytes": 69,
                "width": 1,
                "height": 1,
                "from": "draft",
                "background": "#ffffff",
                "warnings": ["icons are drawn as labelled boxes"],
            }))
        }
        _ => Err("not asked in this test".to_owned()),
    });
    serve(kasten_mcp::bridge::mailbox(root).unwrap(), "1.2.2", handler).unwrap()
}

fn app_that_says(root: &Path, error: &str) -> Server {
    let error = error.to_owned();
    let handler: Handler = Arc::new(move |_, _| Err(error.clone()));
    serve(kasten_mcp::bridge::mailbox(root).unwrap(), "1.2.2", handler).unwrap()
}

fn figure(k: &Kasten, s: &Session, extra: Value) -> Result<Value, String> {
    let mut args = json!({"diagram": "Flow", "doc": "article"});
    args.as_object_mut()
        .unwrap()
        .extend(extra.as_object().cloned().unwrap_or_default());
    call(k, s, "diagram_to_latex_figure", args)
}

#[test]
fn the_two_tools_are_described_plainly_and_listed_by_the_plugins_they_need() {
    let all = specs();
    let figure = all
        .iter()
        .find(|t| t.name == "diagram_to_latex_figure")
        .unwrap();
    let selection = all.iter().find(|t| t.name == "get_selection").unwrap();
    assert!(!figure.read_only);
    assert!(selection.read_only, "reading the selection changes nothing");
    assert_eq!(figure.input_schema["required"], json!(["diagram", "doc"]));
    let props = &figure.input_schema["properties"];
    for field in ["diagram", "page", "doc", "name", "width", "reason"] {
        assert!(props[field].is_object(), "{field}");
    }
    assert_eq!(selection.input_schema["type"], json!("object"));
    for spec in [figure, selection] {
        for jargon in [
            "commit",
            "sidecar",
            "AgentOp",
            "mailbox",
            "bridge",
            "dev/",
            "ADR",
            "selection.json",
        ] {
            assert!(
                !spec.description.contains(jargon),
                "{}: {jargon}",
                spec.name
            );
        }
    }
    assert!(figure.description.contains("app must be open"));
    assert!(
        figure
            .description
            .contains("Diagrams and the LaTeX plugins")
    );
    for words in ["nothing is selected", "the app is closed", "out of date"] {
        assert!(selection.description.contains(words), "{words}");
    }

    // Over the wire: the selection is always there; the figure tool needs both plugins.
    let v = vault();
    let mut neither = Client::start(&v.0, "test-agent");
    assert!(neither.tools().iter().any(|t| t == "get_selection"));
    assert!(
        !neither
            .tools()
            .iter()
            .any(|t| t == "diagram_to_latex_figure")
    );
    drop(neither);
    let k = Kasten::open(&v.0).unwrap();
    k.set_plugin_enabled(&Actor::Human, "latex", true, Instant::now())
        .unwrap();
    let mut both = Client::start(&v.0, "test-agent");
    assert!(both.tools().iter().any(|t| t == "diagram_to_latex_figure"));
    assert!(both.instructions.contains("`diagram_to_latex_figure`"));
    assert!(both.instructions.contains("`get_selection`"));
    drop(both);
    k.set_plugin_enabled(&Actor::Human, "diagrams", false, Instant::now())
        .unwrap();
    let mut only_latex = Client::start(&v.0, "test-agent");
    assert!(
        !only_latex
            .tools()
            .iter()
            .any(|t| t == "diagram_to_latex_figure")
    );
    assert!(!only_latex.instructions.contains("diagram_to_latex_figure"));
    assert!(only_latex.tools().iter().any(|t| t == "get_selection"));
}

#[test]
fn a_diagram_becomes_a_figure_in_the_agents_session_with_a_ready_include_line() {
    let (v, k, s) = open();
    let asked = seen();
    let _app = app_that_draws(&v.0, &asked);
    let told = figure(
        &k,
        &s,
        json!({"width": "0.8\\linewidth", "reason": "the architecture"}),
    )
    .unwrap();
    assert_eq!(told["status"], json!("done"), "{told}");
    assert_eq!(told["figure"], json!("figures/flow.png"));
    assert_eq!(
        told["include"],
        json!("\\includegraphics[width=0.8\\linewidth]{figures/flow.png}")
    );
    assert_eq!(told["result"]["include"], told["include"]);
    assert_eq!(
        told["result"]["path"],
        json!(format!("{ARTICLE}/figures/flow.png"))
    );
    assert_eq!(told["doc"], json!(ARTICLE));
    assert_eq!(told["picture"]["from"], json!("draft"));
    assert_eq!(
        told["picture"]["warnings"][0],
        json!("icons are drawn as labelled boxes")
    );
    // The picture the app drew is the file, byte for byte, and it is one change in the agent's session.
    let kept = fs::read(v.0.join(ARTICLE).join("figures/flow.png")).unwrap();
    assert_eq!(kept, kasten_core::latex::base64_decode(PNG64).unwrap());
    let log = k.log(None, 3).unwrap();
    assert_eq!(log[0].session.as_deref(), Some(s.id.as_str()));
    assert_eq!(log[0].op.as_deref(), Some("add_latex_asset"));
    // The app was asked for the diagram's path, and told whose request it was.
    assert_eq!(
        asked.lock().unwrap().as_slice(),
        [(
            "library/Flow.drawio".to_owned(),
            None,
            Some("claude-code".to_owned())
        )]
    );
    // The same picture again is the same file and nothing new is written.
    let again = figure(&k, &s, json!({})).unwrap();
    assert_eq!(again["result"]["status"], json!("existing"));
    assert_eq!(
        again["include"],
        json!("\\includegraphics[width=\\linewidth]{figures/flow.png}")
    );
    // One undo takes the picture back.
    k.undo_session(&s.id, Instant::now()).unwrap();
    assert!(!v.0.join(ARTICLE).join("figures/flow.png").exists());
}

#[test]
fn a_page_a_name_and_a_width_are_passed_on_and_checked() {
    let (v, k, s) = open();
    let asked = seen();
    let _app = app_that_draws(&v.0, &asked);
    let told = figure(
        &k,
        &s,
        json!({"page": "Page-1", "name": "overview", "width": "8cm"}),
    )
    .unwrap();
    assert_eq!(told["figure"], json!("figures/overview.png"));
    assert_eq!(
        told["include"],
        json!("\\includegraphics[width=8cm]{figures/overview.png}")
    );
    assert_eq!(asked.lock().unwrap()[0].1.as_deref(), Some("Page-1"));
    for ok in [
        "\\linewidth",
        "\\textwidth",
        "0.5\\textwidth",
        "12cm",
        "120mm",
        "300pt",
        "3in",
        ".5\\linewidth",
    ] {
        assert!(
            figure(&k, &s, json!({"width": ok, "name": "w"})).is_ok(),
            "{ok}"
        );
    }
    let before = asked.lock().unwrap().len();
    for bad in [
        "wide",
        "100%",
        "\\write18{rm}",
        "1e3cm",
        "0cm",
        "-3cm",
        "8 cm",
        "8cm}{x",
        "99999cm",
    ] {
        let why = figure(&k, &s, json!({"width": bad})).unwrap_err();
        assert!(why.contains("not a width"), "{bad}: {why}");
    }
    assert_eq!(
        asked.lock().unwrap().len(),
        before,
        "nothing was drawn for a bad width"
    );
}

#[test]
fn what_cannot_be_done_is_said_before_the_app_is_asked() {
    let (v, k, s) = open();
    let asked = seen();
    let _app = app_that_draws(&v.0, &asked);
    let why = figure(&k, &s, json!({"doc": "twocolumn"})).unwrap_err();
    assert!(why.contains("locked"), "{why}");
    let why = figure(&k, &s, json!({"doc": "nothing"})).unwrap_err();
    assert!(why.contains("No LaTeX document called"), "{why}");
    let why = figure(&k, &s, json!({"diagram": "Not there"})).unwrap_err();
    assert!(why.contains("No diagram called"), "{why}");
    assert!(asked.lock().unwrap().is_empty());
    // A chat that holds changes it has not applied does not draw: the app would draw the vault's version.
    let set = Mutex::new(k.begin_changes(&s, Instant::now()));
    let why = call_in(
        &k,
        &s,
        Writes::Staged(&set),
        "diagram_to_latex_figure",
        json!({"diagram": "Flow", "doc": "article"}),
    )
    .unwrap_err();
    assert!(why.contains("not applied yet"), "{why}");
    assert!(asked.lock().unwrap().is_empty());
}

#[test]
fn a_tool_that_needs_two_plugins_says_why_when_one_is_off() {
    let (_v, k, s) = open();
    k.set_plugin_enabled(&Actor::Human, "diagrams", false, Instant::now())
        .unwrap();
    let why = figure(&k, &s, json!({})).unwrap_err();
    assert_eq!(
        why,
        "This needs the Diagrams and LaTeX plugins together. Turn on the Diagrams plugin in Settings → Plugins"
    );
    k.set_plugin_enabled(&Actor::Human, "latex", false, Instant::now())
        .unwrap();
    let why = figure(&k, &s, json!({})).unwrap_err();
    assert!(
        why.ends_with("Turn on the Diagrams and LaTeX plugins in Settings → Plugins"),
        "{why}"
    );
    k.set_plugin_enabled(&Actor::Human, "diagrams", true, Instant::now())
        .unwrap();
    let why = figure(&k, &s, json!({})).unwrap_err();
    assert!(
        why.contains("Diagrams and LaTeX plugins together")
            && why.contains("Turn on the LaTeX plugin"),
        "{why}"
    );
}

#[test]
fn a_closed_app_and_an_app_that_says_no_are_each_one_plain_sentence() {
    let (v, k, s) = open();
    let why = figure(&k, &s, json!({})).unwrap_err();
    assert!(why.starts_with("The app is closed"), "{why}");
    assert!(why.contains("PNG") && why.len() < 260, "{why}");
    let why = call(
        &k,
        &s,
        "diagram_export",
        json!({"diagram": "Flow", "format": "png"}),
    )
    .unwrap_err();
    assert!(why.starts_with("The app is closed"), "{why}");
    assert!(why.contains("SVG"), "an SVG can still be exported: {why}");
    // An app that is open but whose window cannot draw says so in its own words.
    let _app = app_that_says(
        &v.0,
        "The picture the window drew is too big to send. Try a smaller diagram or one page of it",
    );
    let why = figure(&k, &s, json!({})).unwrap_err();
    assert!(
        why.starts_with("The picture the window drew is too big"),
        "{why}"
    );
    assert!(
        !v.0.join(ARTICLE).join("figures").exists(),
        "nothing was kept"
    );
}

#[test]
fn a_png_export_keeps_the_picture_in_assets_and_never_over_another() {
    let (v, k, s) = open();
    let asked = seen();
    let _app = app_that_draws(&v.0, &asked);
    let kept = call(
        &k,
        &s,
        "diagram_export",
        json!({"diagram": "Flow", "format": "png"}),
    )
    .unwrap();
    let path = kept["path"].as_str().unwrap();
    assert!(
        path.starts_with("assets/") && path.ends_with(".png"),
        "{path}"
    );
    assert_eq!(kept["format"], json!("png"));
    assert_eq!(kept["use"], json!(format!("![]({path})")));
    assert_eq!(kept["width"], json!(1));
    assert_eq!(
        fs::read(v.0.join(path)).unwrap(),
        kasten_core::latex::base64_decode(PNG64).unwrap()
    );
    let again = call(
        &k,
        &s,
        "diagram_export",
        json!({"diagram": "Flow", "format": "PNG"}),
    )
    .unwrap();
    assert!(again["path"].as_str().unwrap().ends_with(".png"));
    // The svg is still the program's own, and an unknown format is still refused.
    assert!(
        call(
            &k,
            &s,
            "diagram_export",
            json!({"diagram": "Flow", "format": "svg"})
        )
        .is_ok()
    );
    assert!(
        call(
            &k,
            &s,
            "diagram_export",
            json!({"diagram": "Flow", "format": "pdf"})
        )
        .unwrap_err()
        .contains("svg and png")
    );
    // A chat that holds changes does not draw.
    let set = Mutex::new(k.begin_changes(&s, Instant::now()));
    let why = call_in(
        &k,
        &s,
        Writes::Staged(&set),
        "diagram_export",
        json!({"diagram": "Flow", "format": "png"}),
    )
    .unwrap_err();
    assert!(why.contains("not applied yet"), "{why}");
}
