//! An agent keeps the built PDF in the document's folder: one commit in its
//! session, held as a proposal in Review mode and direct in Balanced and
//! Autonomous, refused for a locked document, with the plugin off, for bytes
//! that are not a PDF and for a build that is not there or out of date. The
//! bytes are the app's, read from the build cache by the core, never sent by
//! the agent. The person's own export stays the person's.

use crate::common::TempVault;
use crate::latex_more_common::*;

use std::fs;
use std::time::{Duration, SystemTime};

use kasten_core::Kasten;
use kasten_core::agent::{AgentOp, Session};
use kasten_core::config_keys::AgentMode;
use kasten_core::history::Actor;
use kasten_core::latex::build_dir;

const PDF_PATH: &str = "projects/photo-organiser/latex/article/main.pdf";

fn export(doc: &str) -> AgentOp {
    AgentOp::ExportLatexPdf {
        doc: doc.into(),
        reason: Some("the paper is ready".into()),
    }
}

fn cache_pdf(t: &TempVault, doc: &str, bytes: &[u8]) {
    put(t, &format!("{}/out/main.pdf", build_dir(doc)), bytes);
}

/// The vault with the LaTeX plugin on and a built PDF in the cache.
fn built(mode: AgentMode) -> (TempVault, Kasten, Session) {
    let (t, k, s) = open();
    k.set_plugin_enabled(&Actor::Human, "latex", true, NOW)
        .unwrap();
    set_mode(&k, mode);
    cache_pdf(&t, ARTICLE, PDF);
    (t, k, s)
}

/// Sets when the file at `path` was last changed, `ago` seconds back.
fn changed(t: &TempVault, path: &str, ago: u64) {
    let file = fs::File::options()
        .write(true)
        .open(t.vault.root().join(path))
        .unwrap();
    file.set_modified(SystemTime::now() - Duration::from_secs(ago))
        .unwrap();
}

#[test]
fn balanced_and_autonomous_keep_the_pdf_as_one_commit_of_the_session() {
    for mode in [AgentMode::Balanced, AgentMode::Autonomous] {
        let (t, k, s) = built(mode);
        let before = snapshot(t.vault.root());
        let told = done(k.agent_run(&s, &export(ARTICLE), NOW).unwrap());
        assert_eq!(told["path"], PDF_PATH, "{mode:?}");
        assert_eq!(told["status"], "exported");
        assert_eq!(told["bytes"], PDF.len());
        assert_eq!(bytes_of(&t, PDF_PATH), PDF);
        // One commit, by the agent, in its session; nothing else changed.
        let log = k.log(None, 3).unwrap();
        assert_eq!(log[0].session.as_deref(), Some(s.id.as_str()), "{mode:?}");
        assert_eq!(log[0].op.as_deref(), Some("export_latex_pdf"));
        assert!(log[0].agent);
        assert_eq!(k.log(Some(PDF_PATH), 5).unwrap().len(), 1);
        let after = snapshot(t.vault.root());
        let changed: Vec<&String> = after.keys().filter(|p| !before.contains_key(*p)).collect();
        assert_eq!(changed, [PDF_PATH], "{mode:?}");
        // One undo takes it back, byte for byte.
        let undone = k.undo_session(&s.id, NOW).unwrap();
        assert!(undone.conflict.is_none());
        assert_eq!(snapshot(t.vault.root()), before, "{mode:?}");
    }
}

#[test]
fn keeping_a_pdf_cannot_ride_in_a_batch() {
    let (t, k, s) = built(AgentMode::Autonomous);
    let batch = AgentOp::Batch {
        ops: vec![export(ARTICLE)],
        reason: None,
    };
    assert!(k.agent_run(&s, &batch, NOW).is_err());
    assert!(!exists(&t, PDF_PATH));
}

#[test]
fn a_second_export_replaces_the_first() {
    let (t, k, s) = built(AgentMode::Balanced);
    done(k.agent_run(&s, &export(ARTICLE), NOW).unwrap());
    let newer = b"%PDF-1.5\nanother build\n%%EOF\n";
    cache_pdf(&t, ARTICLE, newer);
    done(k.agent_run(&s, &export(ARTICLE), NOW).unwrap());
    assert_eq!(bytes_of(&t, PDF_PATH), newer);
}

#[test]
fn review_holds_it_as_a_proposal_that_carries_no_bytes() {
    let (t, k, s) = built(AgentMode::Review);
    let id = pending(k.agent_run(&s, &export(ARTICLE), NOW).unwrap());
    assert!(!exists(&t, PDF_PATH), "nothing is written while it waits");
    let waiting = k
        .proposals()
        .unwrap()
        .into_iter()
        .find(|p| p.id == id)
        .unwrap();
    assert!(waiting.diff.contains("PDF"), "{}", waiting.diff);
    let stored = serde_json::to_string(&waiting).unwrap();
    assert!(
        !stored.contains("%PDF"),
        "the proposal holds no bytes: {stored}"
    );
    // Accepted later, it keeps the PDF the app has built by then.
    let newer = b"%PDF-1.5\nbuilt later\n%%EOF\n";
    cache_pdf(&t, ARTICLE, newer);
    k.accept_proposal(&id, "Ada", NOW).unwrap();
    assert_eq!(bytes_of(&t, PDF_PATH), newer);
}

#[test]
fn a_locked_document_is_refused_in_every_mode() {
    for mode in [
        AgentMode::Review,
        AgentMode::Balanced,
        AgentMode::Autonomous,
    ] {
        let (t, k, s) = built(mode);
        cache_pdf(&t, LOCKED, PDF);
        let why = why(k.agent_run(&s, &export(LOCKED), NOW));
        assert!(why.contains("locked"), "{mode:?}: {why}");
        assert!(!exists(&t, &format!("{LOCKED}/main.pdf")));
        assert!(k.proposals().unwrap().is_empty());
    }
}

#[test]
fn with_the_plugin_off_nothing_is_exported() {
    let (t, k, s) = built(AgentMode::Balanced);
    k.set_plugin_enabled(&Actor::Human, "latex", false, NOW)
        .unwrap();
    let why = why(k.agent_run(&s, &export(ARTICLE), NOW));
    assert!(why.contains("LaTeX plugin"), "{why}");
    assert!(!exists(&t, PDF_PATH));
}

#[test]
fn bytes_that_are_not_a_pdf_are_refused() {
    for bytes in [&b"<html>not a pdf</html>"[..], b"", b"PK\x03\x04zip"] {
        let (t, k, s) = built(AgentMode::Balanced);
        cache_pdf(&t, ARTICLE, bytes);
        let why = why(k.agent_run(&s, &export(ARTICLE), NOW));
        assert!(why.contains("not a PDF"), "{why}");
        assert!(!exists(&t, PDF_PATH));
    }
}

#[test]
fn no_build_or_an_old_one_is_said_in_a_sentence() {
    let (t, k, s) = built(AgentMode::Balanced);
    // A document with no build at all.
    fs::remove_file(
        t.vault
            .root()
            .join(format!("{}/out/main.pdf", build_dir(ARTICLE))),
    )
    .unwrap();
    let why_none = why(k.agent_run(&s, &export(ARTICLE), NOW));
    assert!(why_none.contains("no built PDF"), "{why_none}");
    cache_pdf(&t, ARTICLE, PDF);
    // A PDF made before the source last changed.
    changed(&t, &format!("{}/out/main.pdf", build_dir(ARTICLE)), 3600);
    changed(&t, MAIN, 0);
    let why_old = why(k.agent_run(&s, &export(ARTICLE), NOW));
    assert!(why_old.contains("changed after"), "{why_old}");
    assert!(!exists(&t, PDF_PATH));
}

#[test]
fn a_folder_that_is_not_a_document_or_leaves_the_vault_is_refused() {
    let (t, k, s) = built(AgentMode::Balanced);
    for doc in [
        "projects/photo-organiser/latex",
        "../outside",
        "/etc",
        "projects/photo-organiser/latex/article/../article",
        "",
    ] {
        let why = why(k.agent_run(&s, &export(doc), NOW));
        assert!(why.contains("not a LaTeX document"), "{doc:?}: {why}");
    }
    assert!(!exists(&t, PDF_PATH));
}

#[test]
fn a_pdf_name_taken_by_another_kind_of_file_is_left_alone() {
    let (t, k, s) = built(AgentMode::Balanced);
    put(&t, PDF_PATH, b"my own notes, not a pdf");
    let why = why(k.agent_run(&s, &export(ARTICLE), NOW));
    assert!(why.contains("not a PDF"), "{why}");
    assert_eq!(bytes_of(&t, PDF_PATH), b"my own notes, not a pdf");
}

#[test]
fn only_a_person_exports_with_the_person_only_call() {
    let (t, k, s) = built(AgentMode::Autonomous);
    let why = k
        .export_pdf(&s.actor(), ARTICLE, PDF, NOW)
        .unwrap_err()
        .to_string();
    assert!(why.contains("Only a person"), "{why}");
    assert!(!exists(&t, PDF_PATH));
    // The person's export is unchanged.
    let path = k.export_pdf(&Actor::Human, ARTICLE, PDF, NOW).unwrap();
    assert_eq!(path, PDF_PATH);
}

#[cfg(any(unix, windows))]
#[test]
fn a_cached_pdf_that_is_a_link_is_not_followed() {
    let (t, k, s) = built(AgentMode::Balanced);
    let cached = t
        .vault
        .root()
        .join(format!("{}/out/main.pdf", build_dir(ARTICLE)));
    let secret = t.vault.root().join("elsewhere.pdf");
    fs::write(&secret, PDF).unwrap();
    fs::remove_file(&cached).unwrap();
    #[cfg(unix)]
    let made = std::os::unix::fs::symlink(&secret, &cached).is_ok();
    #[cfg(windows)]
    let made = std::os::windows::fs::symlink_file(&secret, &cached).is_ok();
    if !made {
        eprintln!("SKIPPED: this machine does not let a test make links");
        return;
    }
    let why = why(k.agent_run(&s, &export(ARTICLE), NOW));
    assert!(why.contains("no built PDF"), "{why}");
    assert!(!exists(&t, PDF_PATH));
}

#[test]
fn the_proposal_is_refused_when_the_session_has_nothing_to_export_anymore() {
    let (t, k, s) = built(AgentMode::Review);
    let id = pending(k.agent_run(&s, &export(ARTICLE), NOW).unwrap());
    cache_pdf(&t, ARTICLE, b"not a pdf any more");
    assert!(k.accept_proposal(&id, "Ada", NOW).is_err());
    assert!(!exists(&t, PDF_PATH));
}
