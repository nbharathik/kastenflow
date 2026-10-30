//! Agents sending a page, or one section of it, to LaTeX: the same text the
//! app's "Send to LaTeX" makes, citations kept, hostile Markdown escaped, a
//! locked document refused in every mode, and the three modes and one undo.

use crate::latex_more_common::*;

use kasten_core::agent::AgentOp;
use kasten_core::config_keys::AgentMode;
use kasten_core::history::Actor;
use kasten_core::latex::{Material, Template};

const PAGE: &str = "library/paper-notes.md";
const NEW_MAIN: &str = "library/latex/paper-notes/main.tex";

const PAGE_TEXT: &str = "---\nid: 01M36TME401SP99RN33Y20QVVB\ntitle: Paper notes\ntype: page\ncreated: 2026-09-23T11:48:00+02:00\nupdated: 2026-09-23T11:48:00+02:00\n---\n# Paper notes\n\nIntro with 100% & $5, a_b, #hash, {braces}, \\input{/etc/passwd} and a citation [@vaswani2017attention].\n\n## Method\n\nWe **sample** the signal. See [site](https://example.com/a_b?x=1&y=2).\n\n## Results\n\n- one\n- two\n";

fn send(section: Option<&str>, doc: Option<&str>) -> AgentOp {
    AgentOp::SendPageToLatex {
        page: PAGE.into(),
        section: section.map(str::to_owned),
        doc: doc.map(str::to_owned),
        title: None,
        template: String::new(),
        project: None,
        reason: None,
    }
}

fn with_page() -> (
    crate::common::TempVault,
    kasten_core::Kasten,
    kasten_core::agent::Session,
) {
    let (t, k, s) = open();
    put(&t, PAGE, PAGE_TEXT.as_bytes());
    (t, k, s)
}

#[test]
fn a_page_becomes_a_new_document_with_its_citations_and_hostile_text_escaped() {
    let (t, k, s) = with_page();
    let told = done(k.agent_run(&s, &send(None, None), NOW).unwrap());
    assert_eq!(told["status"], "sent", "{told}");
    assert_eq!(told["appended"], false);
    assert_eq!(told["doc"], "library/latex/paper-notes");
    assert_eq!(told["path"], NEW_MAIN);
    assert_eq!(told["cites"], serde_json::json!(["vaswani2017attention"]));
    assert!(
        told["note"].as_str().unwrap().contains("latex_cite"),
        "{told}"
    );
    let tex = text_of(&t, NEW_MAIN);
    assert!(tex.starts_with("\\documentclass"), "{tex}");
    assert!(tex.contains("\\cite{vaswani2017attention}"), "{tex}");
    assert!(tex.contains("\\subsection{Method}"), "{tex}");
    // What TeX would read as commands or specials is text.
    assert!(!tex.contains("\\input{"), "{tex}");
    assert!(
        tex.contains("100\\%") && tex.contains("\\&") && tex.contains("\\$5"),
        "{tex}"
    );
    // Exactly what the app makes of the same page.
    let (twin, k2, _) = with_page();
    k2.send_to_new_latex_doc(
        &Actor::Human,
        Material::Page(PAGE_TEXT),
        "Paper notes",
        Template::Article,
        None,
        NOW,
    )
    .unwrap();
    assert_eq!(tex, text_of(&twin, NEW_MAIN));
}

#[test]
fn one_section_is_sent_with_its_heading_and_nothing_else() {
    let (t, k, s) = with_page();
    let told = done(
        k.agent_run(&s, &send(Some("## Method"), None), NOW)
            .unwrap(),
    );
    assert_eq!(told["status"], "sent", "{told}");
    let tex = text_of(&t, NEW_MAIN);
    assert!(
        tex.contains("sample") && tex.contains("\\subsection{Method}"),
        "{tex}"
    );
    assert!(
        !tex.contains("Results") && !tex.contains("Intro with"),
        "{tex}"
    );
    assert!(told["cites"].as_array().unwrap().is_empty());
    // The same section sent as the app sends a selection.
    let (twin, k2, _) = with_page();
    k2.send_to_new_latex_doc(
        &Actor::Human,
        Material::Selection("## Method\n\nWe **sample** the signal. See [site](https://example.com/a_b?x=1&y=2).\n\n"),
        "Paper notes",
        Template::Article,
        None,
        NOW,
    )
    .unwrap();
    assert_eq!(tex, text_of(&twin, NEW_MAIN));
}

#[test]
fn a_page_is_added_to_the_end_of_a_documents_text_as_the_app_adds_it() {
    let (t, k, s) = with_page();
    let told = done(k.agent_run(&s, &send(None, Some(ARTICLE)), NOW).unwrap());
    assert_eq!(told["appended"], true, "{told}");
    assert_eq!(told["path"], MAIN);
    let (twin, k2, _) = with_page();
    k2.send_to_latex_doc(&Actor::Human, Material::Page(PAGE_TEXT), MAIN, NOW)
        .unwrap();
    assert_eq!(text_of(&t, MAIN), text_of(&twin, MAIN));
    assert!(text_of(&t, MAIN).contains("\\cite{vaswani2017attention}"));
}

#[test]
fn a_template_a_title_and_a_project_make_the_new_document() {
    let (t, k, s) = with_page();
    let op = AgentOp::SendPageToLatex {
        page: PAGE.into(),
        section: None,
        doc: None,
        title: Some("Talk".into()),
        template: "beamer".into(),
        project: Some("photo-organiser".into()),
        reason: None,
    };
    let told = done(k.agent_run(&s, &op, NOW).unwrap());
    assert_eq!(told["path"], format!("{BASE}/talk/main.tex"), "{told}");
    assert!(text_of(&t, &format!("{BASE}/talk/main.tex")).contains("\\begin{frame}"));
    let before = snapshot(t.vault.root());
    for (title, template, project) in [
        (None, "letter", None),
        (None, "", Some("nope")),
        (Some("  "), "report", None),
    ] {
        let op = AgentOp::SendPageToLatex {
            page: PAGE.into(),
            section: None,
            doc: None,
            title: title.map(str::to_owned),
            template: template.into(),
            project: project.map(str::to_owned),
            reason: None,
        };
        let result = k.agent_run(&s, &op, NOW);
        if template == "report" {
            // A blank title is the page's own.
            assert!(result.is_ok());
        } else {
            assert!(result.is_err(), "{template} {project:?}");
        }
    }
    assert!(before.len() < snapshot(t.vault.root()).len());
}

#[test]
fn what_cannot_be_sent_is_refused_and_nothing_is_written() {
    let (t, k, s) = with_page();
    put(
        &t,
        "library/empty.md",
        b"---\ntitle: Empty\ntype: page\n---\n",
    );
    let huge = format!(
        "---\ntitle: Huge\ntype: page\n---\n{}",
        "word ".repeat(60_000)
    );
    put(&t, "library/huge.md", huge.as_bytes());
    let before = snapshot(t.vault.root());
    let op = |page: &str, section: Option<&str>, doc: Option<&str>, title: Option<&str>| {
        AgentOp::SendPageToLatex {
            page: page.into(),
            section: section.map(str::to_owned),
            doc: doc.map(str::to_owned),
            title: title.map(str::to_owned),
            template: String::new(),
            project: None,
            reason: None,
        }
    };
    let cases = [
        (op(PAGE, Some("No such heading"), None, None), "No heading"),
        (op("library/empty.md", None, None, None), "no text to send"),
        (op("library/nope.md", None, None, None), "nope.md"),
        (op("library/latex", None, None, None), "not a page"),
        (
            op(PAGE, None, Some("library"), None),
            "not a LaTeX document folder",
        ),
        (op(PAGE, None, Some(ARTICLE), Some("Both")), "not both"),
        (op("library/huge.md", None, None, None), "at most"),
        (op("library/huge.md", None, Some(ARTICLE), None), "at most"),
    ];
    for (op, wanted) in cases {
        let said = why(k.agent_run(&s, &op, NOW));
        assert!(said.contains(wanted), "{wanted}: {said}");
    }
    assert_eq!(snapshot(t.vault.root()), before);
}

#[test]
fn a_locked_document_is_refused_in_every_mode() {
    for mode in [
        AgentMode::Review,
        AgentMode::Balanced,
        AgentMode::Autonomous,
    ] {
        let (t, k, s) = with_page();
        set_mode(&k, mode);
        let before = snapshot(t.vault.root());
        let said = why(k.agent_run(&s, &send(None, Some(LOCKED)), NOW));
        assert!(said.contains("locked"), "{mode:?}: {said}");
        assert_eq!(snapshot(t.vault.root()), before, "{mode:?}");
        assert!(k.proposals().unwrap().is_empty(), "{mode:?}");
    }
}

#[test]
fn review_holds_the_send_and_the_other_modes_write_it() {
    let (t, k, s) = with_page();
    set_mode(&k, AgentMode::Review);
    let before = snapshot(t.vault.root());
    let new_id = pending(k.agent_run(&s, &send(None, None), NOW).unwrap());
    let append_id = pending(k.agent_run(&s, &send(None, Some(ARTICLE)), NOW).unwrap());
    assert_eq!(snapshot(t.vault.root()), before);
    k.accept_proposal(&new_id, "tester", NOW).unwrap();
    k.accept_proposal(&append_id, "tester", NOW).unwrap();
    assert!(exists(&t, NEW_MAIN));
    assert!(text_of(&t, MAIN).contains("\\cite{vaswani2017attention}"));
    for mode in [AgentMode::Balanced, AgentMode::Autonomous] {
        let (t, k, s) = with_page();
        set_mode(&k, mode);
        let told = done(k.agent_run(&s, &send(None, None), NOW).unwrap());
        assert_eq!(told["status"], "sent", "{mode:?}");
        assert!(exists(&t, NEW_MAIN));
    }
}

#[test]
fn a_session_of_sends_is_taken_back_by_one_undo() {
    let (t, k, s) = with_page();
    let before = snapshot(t.vault.root());
    done(k.agent_run(&s, &send(None, None), NOW).unwrap());
    done(
        k.agent_run(&s, &send(Some("Results"), Some(ARTICLE)), NOW)
            .unwrap(),
    );
    let undone = k.undo_session(&s.id, NOW).unwrap();
    assert!(undone.conflict.is_none());
    assert_eq!(snapshot(t.vault.root()), before);
}
