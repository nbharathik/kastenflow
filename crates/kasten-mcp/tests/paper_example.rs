//! The worked example, kept as the record: an outside assistant writes a short
//! paper in a copy of the dev vault. It turns the plugins on as a person would,
//! makes a LaTeX document, takes two References, writes two pages, draws a
//! diagram as a figure, adds a chart it made itself, cites, builds, keeps the
//! PDF, reads the person's selection and puts the same chart on a slide.
//!
//! The app is a stand-in thread that serves the vault's mailbox: it draws the
//! diagram as a small PNG, answers a clean build and writes a valid PDF into
//! the build cache, keeps the PDF through the core's guarded op in the asker's
//! session (as the real app does) and shares a selection. What is not tested
//! here is a real TeX engine and the real window.

mod common;
#[path = "paper_example/make.rs"]
mod make;
#[path = "paper_example/stand_in.rs"]
mod stand_in;

use std::fs;
use std::sync::{Arc, Mutex};

use common::{Client, OUTLINE, vault};
use kasten_core::agent::Session;
use kasten_core::bridge::Snippet;
use kasten_core::history::{Actor, History};
use kasten_core::{Instant, Kasten};
use kasten_mcp::tools::call;
use serde_json::{Value, json};
use slides_core::agent::base64_encode;
use stand_in::{app, tree};

/// Every tool the assistant called, in order: the record of the visit.
const CALLS: [&str; 24] = [
    "latex_create_document",
    "list_references",
    "add_reference",
    "list_references",
    "latex_read",
    "latex_write_file",
    "diagram_new",
    "diagram_to_latex_figure",
    "latex_read",
    "latex_append",
    "latex_add_asset",
    "latex_read",
    "latex_append",
    "latex_cite",
    "latex_cite",
    "latex_read",
    "latex_append",
    "latex_build",
    "latex_export_pdf",
    "get_selection",
    "create_deck",
    "get_deck",
    "add_asset",
    "place_image",
];

struct Run<'a> {
    k: &'a Kasten,
    s: &'a Session,
    calls: Vec<String>,
}

impl Run<'_> {
    fn tool(&mut self, name: &str, args: Value) -> Value {
        self.calls.push(name.to_owned());
        call(self.k, self.s, name, args).unwrap_or_else(|why| panic!("{name} was refused: {why}"))
    }

    fn hash(&mut self, doc: &str) -> String {
        let read = self.tool("latex_read", json!({"doc": doc, "file": "main.tex"}));
        read["hash"].as_str().unwrap().to_owned()
    }
}

#[test]
fn an_assistant_writes_a_short_paper_with_a_figure_a_chart_and_citations() {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    // (a) The person turns the two plugins on in Settings.
    for plugin in ["latex", "diagrams"] {
        k.set_plugin_enabled(&Actor::Human, plugin, true, Instant::now())
            .unwrap();
    }
    let history = History::open(&v.0).unwrap().unwrap();
    let start_tree = history.tree_id("HEAD").unwrap();
    let start_head = history.head().unwrap();
    let start_files = tree(&v.0);

    let asked = Arc::new(Mutex::new(Vec::new()));
    let selected = Snippet {
        kind: "latex".into(),
        path: "library/latex/a-short-paper/main.tex".into(),
        title: "main.tex".into(),
        heading: Some("Results".into()),
        range: None,
        elements: Vec::new(),
        text: "The numbers in this paper are small on purpose.".into(),
        truncated: false,
        time: 0,
    };
    let _app = app(&v.0, &asked, selected);
    let s = Session::start("claude-code", Instant::now());
    let mut run = Run {
        k: &k,
        s: &s,
        calls: Vec::new(),
    };

    // (b) A document.
    let made = run.tool(
        "latex_create_document",
        json!({"title": "A short paper", "template": "article", "reason": "a short paper from the notes"}),
    );
    assert_eq!(made["status"], json!("done"), "{made}");
    let folder = made["result"]["folder"].as_str().unwrap().to_owned();
    assert_eq!(folder, "library/latex/a-short-paper");

    // (c) Two References: one already in the vault, one the assistant adds. In the balanced
    // setting a new Reference waits for its owner, who accepts it.
    let found = run.tool("list_references", json!({"query": "attention"}));
    assert_eq!(found["references"][0]["key"], json!("vaswani2017attention"));
    let added = run.tool(
        "add_reference",
        json!({"type": "article", "key": "kannan2026agents", "fields": {
            "title": "Agents that write with a vault", "author": "Kannan, Bharathi",
            "year": "2026", "journal": "Journal of Careful Notes"}}),
    );
    assert_eq!(added["status"], json!("pending_review"), "{added}");
    k.accept_proposal(added["proposal"].as_str().unwrap(), "me", Instant::now())
        .unwrap();
    let both = run.tool("list_references", json!({"query": "kannan"}));
    assert_eq!(both["total"], json!(1), "{both}");

    // (d) The root file: two pages, sections, a bibliography line.
    let hash = run.hash(&folder);
    let written = run.tool(
        "latex_write_file",
        json!({"doc": folder, "file": "main.tex", "text": make::paper(), "base_hash": hash}),
    );
    assert_eq!(written["status"], json!("done"), "{written}");

    // (e) A draw.io diagram, then a figure made from it by the app's window.
    run.tool(
        "diagram_new",
        json!({"title": "Flow", "spec": {"nodes": [{"id": "web", "label": "Web app", "kind": "client"}]}}),
    );
    let figure = run.tool(
        "diagram_to_latex_figure",
        json!({"diagram": "Flow", "doc": folder, "name": "flow", "width": "0.8\\linewidth"}),
    );
    assert_eq!(figure["figure"], json!("figures/flow.png"), "{figure}");
    let flow = figure["include"].as_str().unwrap().to_owned();
    let hash = run.hash(&folder);
    run.tool(
        "latex_append",
        json!({"doc": folder, "file": "main.tex", "base_hash": hash, "after": "% figure: flow",
            "text": format!("\n\\begin{{figure}}[ht]\n\\centering\n{flow}\n\\caption{{How the vault and the app fit together.}}\n\\end{{figure}}\n")}),
    );

    // (f) A chart. The client makes this PNG with its own tools; Kasten runs no program.
    let chart = make::chart();
    let chart64 = base64_encode(&chart);
    let asset = run.tool(
        "latex_add_asset",
        json!({"doc": folder, "name": "chart.png", "base64": chart64}),
    );
    let chart_line = asset["result"]["include"].as_str().unwrap().to_owned();
    assert_eq!(asset["result"]["figure"], json!("figures/chart.png"));
    let hash = run.hash(&folder);
    run.tool(
        "latex_append",
        json!({"doc": folder, "file": "main.tex", "base_hash": hash, "after": "% figure: chart",
            "text": format!("\n\\begin{{figure}}[ht]\n\\centering\n{chart_line}\n\\caption{{Four small results.}}\n\\end{{figure}}\n")}),
    );

    // (g) Two citations: the .bib of the document gets each entry once.
    for (key, at) in [
        ("vaswani2017attention", make::ATTENTION),
        ("kannan2026agents", make::SOURCES),
    ] {
        let cited = run.tool(
            "latex_cite",
            json!({"doc": folder, "file": "main.tex", "key": key, "at": at}),
        );
        assert_eq!(cited["status"], json!("done"), "{cited}");
    }

    // (h) A conclusion.
    let hash = run.hash(&folder);
    run.tool(
        "latex_append",
        json!({"doc": folder, "file": "main.tex", "base_hash": hash, "after": "% conclusion",
            "text": "\n\\section{Conclusion}\nThe work stayed inside the vault's rules and can be taken back in one step.\n"}),
    );

    // (i) A build the app answers, (j) the PDF kept in the document's folder.
    let built = run.tool("latex_build", json!({"doc": folder, "wait": true}));
    assert_eq!(built["succeeded"], json!(true), "{built}");
    assert_eq!(built["pages"], json!(2));
    let exported = run.tool(
        "latex_export_pdf",
        json!({"doc": folder, "reason": "the paper is ready"}),
    );
    assert_eq!(exported["status"], json!("done"), "{exported}");
    assert_eq!(
        exported["result"]["path"],
        json!(format!("{folder}/main.pdf"))
    );

    // (k) What the person has selected, now.
    let selection = run.tool("get_selection", Value::Null);
    assert_eq!(selection["status"], json!("selected"), "{selection}");
    assert_eq!(selection["selection"][0]["kind"], json!("latex"));
    assert_eq!(selection["selection"][0]["heading"], json!("Results"));
    assert_eq!(
        selection["selection"][0]["text"],
        json!("The numbers in this paper are small on purpose.")
    );

    // (l) One picture, two uses: the same chart on a slide.
    let deck = run.tool(
        "create_deck",
        json!({"outline": OUTLINE, "project": "photo-organiser"}),
    );
    let deck_path = deck["result"]["deck"].as_str().unwrap().to_owned();
    let slides = run.tool("get_deck", json!({"deck": deck_path}));
    let slide = slides["slides"][1]["id"].as_str().unwrap().to_owned();
    let kept = run.tool("add_asset", json!({"name": "chart.png", "base64": chart64}));
    let asset_path = kept["result"]["path"].as_str().unwrap().to_owned();
    let placed = run.tool(
        "place_image",
        json!({"deck": deck_path, "slide": slide, "src": asset_path, "auto": true, "alt": "Four small results"}),
    );
    assert_eq!(placed["status"], json!("done"), "{placed}");

    // The record of calls, and what the app was asked, in order.
    assert_eq!(run.calls, CALLS);
    assert_eq!(
        asked.lock().unwrap().as_slice(),
        [
            "diagram_png",
            "latex_build",
            "latex_export_pdf",
            "watch_selection"
        ]
    );

    // (m) The final tree.
    let doc = v.0.join(&folder);
    for file in [
        "main.tex",
        "references.bib",
        "figures/flow.png",
        "figures/chart.png",
        "main.pdf",
    ] {
        assert!(doc.join(file).is_file(), "{file}");
    }
    let main = fs::read_to_string(doc.join("main.tex")).unwrap();
    for wanted in [
        "\\cite{vaswani2017attention}",
        "\\cite{kannan2026agents}",
        "{figures/flow.png}",
        "{figures/chart.png}",
        "\\section{Conclusion}",
        "\\bibliography{references}",
    ] {
        assert!(main.contains(wanted), "{wanted}");
    }
    assert!(
        main.split_whitespace().count() > 600,
        "about two pages of text"
    );
    let bib = fs::read_to_string(doc.join("references.bib")).unwrap();
    for key in ["vaswani2017attention", "kannan2026agents"] {
        assert_eq!(bib.matches(&format!("{{{key},")).count(), 1, "{key} once");
    }
    // One picture, two uses: the chart is the same bytes in the document and on the slide.
    assert_eq!(fs::read(doc.join("figures/chart.png")).unwrap(), chart);
    assert_eq!(fs::read(v.0.join(&asset_path)).unwrap(), chart);
    assert!(
        call(
            &k,
            &s,
            "get_slide",
            json!({"deck": deck_path, "slide": slide})
        )
        .unwrap()
        .to_string()
        .contains(&asset_path)
    );
    // The kept PDF is the one the engine made.
    assert_eq!(fs::read(doc.join("main.pdf")).unwrap(), make::pdf());

    // Every step is the one session; nothing was deleted; only the places the work touches changed;
    // the app's mailbox is nowhere in the history.
    let log = k.log(None, 500).unwrap();
    let mine: Vec<_> = log.iter().take_while(|c| c.id != start_head).collect();
    assert!(!mine.is_empty());
    // Accepting the Reference is commits of the same session, marked as approved by the owner
    // (two: the Reference itself, and the note of the waiting ask being taken away), so one undo covers them.
    assert_eq!(
        mine.iter()
            .filter(|c| c.approved_by.as_deref() == Some("me"))
            .count(),
        2
    );
    let mut changed = Vec::new();
    for commit in &mine {
        assert!(commit.agent, "{commit:?}");
        assert_eq!(commit.session.as_deref(), Some(s.id.as_str()), "{commit:?}");
        for change in history.changes(&commit.id).unwrap() {
            // The only file that goes is the note of the Reference that waited for its owner,
            // which is taken away when the owner decides. No content of the vault is deleted.
            let note_of_a_waiting_ask = change.path.starts_with(".kasten/proposals/");
            assert!(
                change.after.is_some() || note_of_a_waiting_ask,
                "{} was deleted",
                change.path
            );
            changed.push(change.path);
        }
    }
    let managed = both["managedFile"]["path"]
        .as_str()
        .unwrap_or("sources/references.bib");
    for path in &changed {
        let allowed = path.starts_with(&format!("{folder}/"))
            || path.starts_with("assets/")
            || *path == deck_path
            || path.starts_with("library/Flow.drawio")
            || path.starts_with(".kasten/proposals/")
            || path == managed;
        assert!(allowed, "{path} is not a place this work touches");
        assert!(!path.contains(".kasten/cache"), "{path}");
    }
    assert!(
        changed
            .iter()
            .all(|p| !p.contains("bridge") && !p.contains("selection"))
    );
    let sessions = k.sessions(20).unwrap();
    let ours: Vec<_> = sessions.iter().filter(|x| x.id == s.id).collect();
    assert_eq!(ours.len(), 1);
    assert_eq!(ours[0].commits, mine.len());
    assert!(k.dirty().unwrap().is_empty(), "{:?}", k.dirty());

    // One undo of the whole session gives the starting tree back, byte for byte.
    let undone = k.undo_session(&s.id, Instant::now()).unwrap();
    assert_eq!(undone.conflict, None);
    assert_eq!(history.tree_id("HEAD").unwrap(), start_tree);
    assert_eq!(tree(&v.0), start_files);
    assert!(!doc.exists() || fs::read_dir(&doc).unwrap().next().is_none());
}

#[test]
fn the_same_assistant_over_the_stdio_server_sees_the_tools_it_needs() {
    // The tools are real over the wire once both plugins are on, the way a client connects.
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    for plugin in ["latex", "diagrams"] {
        k.set_plugin_enabled(&Actor::Human, plugin, true, Instant::now())
            .unwrap();
    }
    let mut client = Client::start(&v.0, "claude-code");
    let tools = client.tools();
    for name in CALLS {
        assert!(tools.iter().any(|t| t == name), "{name} is not listed");
    }
}
