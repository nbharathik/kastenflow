//! Agents adding text to a LaTeX file and taking a file out: the end of a
//! file or a marker that is there once, Windows line breaks kept, every other
//! byte as it was; and a file that goes to the trash and never further.

use crate::common;

use std::fs;
use std::path::Path;

use common::{NOW, dev_vault};
use kasten_core::agent::{AgentOp, Session};
use kasten_core::config_keys::{AgentMode, AgentsConfig};
use kasten_core::latex::MAX_SOURCE_BYTES;
use kasten_core::{Error, Kasten, Outcome, content_hash};
use serde_json::Value;

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

fn open() -> (common::TempVault, Kasten, Session) {
    let t = dev_vault();
    for name in ["article", "twocolumn"] {
        let from = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/latex")
            .join(name);
        copy_dir(&from, &t.vault.root().join(BASE).join(name));
    }
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k, Session::start("claude-code", NOW))
}

fn put(t: &common::TempVault, path: &str, bytes: &[u8]) {
    let file = t.vault.root().join(path);
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    fs::write(file, bytes).unwrap();
}

fn bytes_of(t: &common::TempVault, path: &str) -> Vec<u8> {
    fs::read(t.vault.root().join(path)).unwrap()
}

fn text_of(t: &common::TempVault, path: &str) -> String {
    fs::read_to_string(t.vault.root().join(path)).unwrap()
}

fn set_mode(k: &Kasten, mode: AgentMode) {
    let mut config = k.config();
    config.agents = Some(AgentsConfig {
        mode: Some(mode),
        ..AgentsConfig::default()
    });
    k.set_config(config).unwrap();
}

/// An append of `text` to `path`, written against the file as it is now.
fn append(t: &common::TempVault, path: &str, text: &str, after: Option<&str>) -> AgentOp {
    AgentOp::AppendLatexFile {
        path: path.into(),
        base_hash: content_hash(&text_of(t, path)),
        text: text.into(),
        after: after.map(str::to_owned),
        reason: None,
    }
}

fn trash(path: &str) -> AgentOp {
    AgentOp::TrashLatexFile {
        path: path.into(),
        reason: None,
    }
}

fn done(outcome: Outcome) -> Value {
    match outcome {
        Outcome::Done { result } => result,
        other => panic!("expected done, got {other:?}"),
    }
}

fn pending(outcome: Outcome) -> (String, String) {
    match outcome {
        Outcome::PendingReview { proposal, reason } => (proposal, reason),
        other => panic!("expected a proposal, got {other:?}"),
    }
}

fn refused(result: Result<Outcome, Error>) -> String {
    match result {
        Err(Error::Invalid(why)) => why,
        other => panic!("expected a refusal, got {other:?}"),
    }
}

#[test]
fn text_added_at_the_end_or_after_a_marker_changes_nothing_else() {
    let (t, k, s) = open();
    let before = text_of(&t, MAIN);
    let result = done(
        k.agent_run(&s, &append(&t, MAIN, "% end\n", None), NOW)
            .unwrap(),
    );
    assert_eq!(result["status"], "saved");
    assert_eq!(result["added"], 6);
    assert_eq!(text_of(&t, MAIN), format!("{before}% end\n"));
    assert!(
        result["note"].as_str().unwrap().contains("end{document}"),
        "text after the end of the document is warned about: {result}"
    );

    let now = text_of(&t, MAIN);
    let marker = "\\section{Method}\n";
    let result = done(
        k.agent_run(&s, &append(&t, MAIN, "Added line.\n", Some(marker)), NOW)
            .unwrap(),
    );
    assert!(result.get("note").is_none(), "{result}");
    assert_eq!(
        text_of(&t, MAIN),
        now.replace(marker, &format!("{marker}Added line.\n"))
    );
    let last = &k.log(Some(MAIN), 1).unwrap()[0];
    assert!(last.agent);
    assert_eq!(last.summary, "edit: main.tex");
}

#[test]
fn a_marker_that_is_missing_or_twice_or_empty_writes_nothing() {
    let (t, k, s) = open();
    let before = bytes_of(&t, MAIN);
    let why = refused(k.agent_run(&s, &append(&t, MAIN, "x\n", Some("no such text")), NOW));
    assert!(why.contains("is not in main.tex"), "{why}");
    let why = refused(k.agent_run(&s, &append(&t, MAIN, "x\n", Some("\\section")), NOW));
    assert!(
        why.contains("3 times") && why.contains("matches once"),
        "{why}"
    );
    let why = refused(k.agent_run(&s, &append(&t, MAIN, "x\n", Some("")), NOW));
    assert!(why.contains("after is empty"), "{why}");
    let why = refused(k.agent_run(&s, &append(&t, MAIN, "", None), NOW));
    assert!(why.contains("no text to add"), "{why}");
    assert_eq!(bytes_of(&t, MAIN), before);
}

#[test]
fn a_hash_the_file_has_moved_on_from_or_none_is_refused() {
    let (t, k, s) = open();
    let mut op = append(&t, MAIN, "x\n", None);
    // A person types in the file after the agent read it.
    let loaded = k.source(MAIN).unwrap();
    k.save_source(
        &kasten_core::history::Actor::Human,
        MAIN,
        &loaded.hash,
        &format!("{}% mine\n", loaded.text),
        NOW,
    )
    .unwrap();
    let typed = bytes_of(&t, MAIN);
    let why = refused(k.agent_run(&s, &op, NOW));
    assert!(why.contains("changed since you read it"), "{why}");
    if let AgentOp::AppendLatexFile { base_hash, .. } = &mut op {
        base_hash.clear();
    }
    let why = refused(k.agent_run(&s, &op, NOW));
    assert!(why.contains("hash"), "{why}");
    assert_eq!(bytes_of(&t, MAIN), typed);
}

#[test]
fn a_file_with_windows_line_breaks_keeps_them_and_every_other_byte() {
    let (t, k, s) = open();
    let path = format!("{ARTICLE}/sections/win.tex");
    let original = "one\r\ntwo\r\nthree \t\r\n\r\nfour\r\n";
    put(&t, &path, original.as_bytes());
    done(
        k.agent_run(
            &s,
            &append(&t, &path, "after two\nand more\n", Some("two\r\n")),
            NOW,
        )
        .unwrap(),
    );
    assert_eq!(
        bytes_of(&t, &path),
        b"one\r\ntwo\r\nafter two\r\nand more\r\nthree \t\r\n\r\nfour\r\n"
    );
    done(
        k.agent_run(&s, &append(&t, &path, "last\n", None), NOW)
            .unwrap(),
    );
    assert!(bytes_of(&t, &path).ends_with(b"four\r\nlast\r\n"));
    // A file of plain line breaks gets the text as it is, accents and all.
    let plain = format!("{ARTICLE}/sections/plain.tex");
    put(&t, &plain, "é\nü".as_bytes());
    done(
        k.agent_run(&s, &append(&t, &plain, "\nß\n", None), NOW)
            .unwrap(),
    );
    assert_eq!(bytes_of(&t, &plain), "é\nü\nß\n".as_bytes());
}

#[test]
fn an_append_is_refused_for_what_is_no_source_or_too_big_or_locked() {
    let (t, k, s) = open();
    let before = bytes_of(&t, MAIN);
    put(&t, "inbox/plain.md", b"# Plain\n");
    let md = AgentOp::AppendLatexFile {
        path: "inbox/plain.md".into(),
        base_hash: "x".into(),
        text: "y".into(),
        after: None,
        reason: None,
    };
    assert!(k.agent_run(&s, &md, NOW).is_err());
    for path in [
        format!("{ARTICLE}/kasten-latex.yaml"),
        format!("{ARTICLE}/../article/main.tex"),
        format!("{BASE}/ARTICLE/main.tex"),
        format!("{ARTICLE}/missing.tex"),
        ".kasten/x.tex".to_owned(),
    ] {
        let op = AgentOp::AppendLatexFile {
            path: path.clone(),
            base_hash: "x".into(),
            text: "y".into(),
            after: None,
            reason: None,
        };
        assert!(k.agent_run(&s, &op, NOW).is_err(), "{path}");
    }
    let big = "a".repeat(MAX_SOURCE_BYTES);
    let why = refused(k.agent_run(&s, &append(&t, MAIN, &big, None), NOW));
    assert!(why.contains("KB"), "{why}");
    assert_eq!(bytes_of(&t, MAIN), before);

    let locked = format!("{LOCKED}/main.tex");
    let before = bytes_of(&t, &locked);
    for mode in [
        AgentMode::Review,
        AgentMode::Balanced,
        AgentMode::Autonomous,
    ] {
        set_mode(&k, mode);
        let why = refused(k.agent_run(&s, &append(&t, &locked, "x\n", None), NOW));
        assert!(why.contains("locked"), "{mode:?}: {why}");
    }
    assert_eq!(bytes_of(&t, &locked), before);
}

#[test]
fn an_append_follows_the_three_modes_and_a_proposal_goes_stale_with_the_file() {
    let (t, k, s) = open();
    set_mode(&k, AgentMode::Review);
    let before = text_of(&t, MAIN);
    let (id, _) = pending(
        k.agent_run(&s, &append(&t, MAIN, "% held\n", None), NOW)
            .unwrap(),
    );
    assert_eq!(text_of(&t, MAIN), before);
    let waiting = &k.proposals().unwrap()[0];
    assert!(waiting.diff.contains("+% held"), "{}", waiting.diff);
    k.accept_proposal(&id, "Ada", NOW).unwrap();
    assert!(text_of(&t, MAIN).ends_with("% held\n"));

    // A proposal the file moved on from cannot be accepted.
    let (stale, _) = pending(
        k.agent_run(&s, &append(&t, MAIN, "% stale\n", None), NOW)
            .unwrap(),
    );
    let loaded = k.source(MAIN).unwrap();
    k.save_source(
        &kasten_core::history::Actor::Human,
        MAIN,
        &loaded.hash,
        &format!("{}% mine\n", loaded.text),
        NOW,
    )
    .unwrap();
    assert!(k.accept_proposal(&stale, "Ada", NOW).is_err());
    assert!(!text_of(&t, MAIN).contains("% stale"));

    set_mode(&k, AgentMode::Balanced);
    done(
        k.agent_run(&s, &append(&t, MAIN, "% balanced\n", None), NOW)
            .unwrap(),
    );
    set_mode(&k, AgentMode::Autonomous);
    done(
        k.agent_run(&s, &append(&t, MAIN, "% autonomous\n", None), NOW)
            .unwrap(),
    );
    assert_eq!(
        k.log(Some(MAIN), 1).unwrap()[0].mode.as_deref(),
        Some("autonomous")
    );
}

#[test]
fn a_file_goes_to_the_trash_and_can_be_put_back() {
    let (t, k, s) = open();
    let path = format!("{ARTICLE}/sections/intro.tex");
    put(&t, &path, b"Intro\r\ntext\r\n");
    k.commit_edits().unwrap();
    let result = done(k.agent_run(&s, &trash(&path), NOW).unwrap());
    assert_eq!(result["status"], "trashed");
    let trashed = result["trashed"].as_str().unwrap().to_owned();
    assert!(trashed.starts_with(".trash/") && trashed.ends_with(&format!("/{path}")));
    assert!(!t.vault.root().join(&path).exists());
    assert_eq!(bytes_of(&t, &trashed), b"Intro\r\ntext\r\n");
    // Not a document of its own while it lies in the trash.
    assert!(
        k.latex_docs()
            .unwrap()
            .iter()
            .all(|d| !d.folder.starts_with(".trash"))
    );
    // It is put back by moving it home.
    fs::rename(t.vault.root().join(&trashed), t.vault.root().join(&path)).unwrap();
    assert_eq!(bytes_of(&t, &path), b"Intro\r\ntext\r\n");
}

#[test]
fn one_undo_takes_a_trashed_file_back_byte_for_byte() {
    let (t, k, s) = open();
    let path = format!("{ARTICLE}/refs.bib");
    let other = format!("{ARTICLE}/sections/b.tex");
    put(&t, &path, b"@book{a, title={T}}\n");
    put(&t, &other, b"B\r\n");
    k.commit_edits().unwrap();
    done(k.agent_run(&s, &trash(&path), NOW).unwrap());
    done(k.agent_run(&s, &trash(&other), NOW).unwrap());
    assert!(!t.vault.root().join(&path).exists() && !t.vault.root().join(&other).exists());
    let undone = k.undo_session(&s.id, NOW).unwrap();
    assert!(undone.conflict.is_none());
    assert_eq!(bytes_of(&t, &path), b"@book{a, title={T}}\n");
    assert_eq!(bytes_of(&t, &other), b"B\r\n");
}

#[test]
fn a_documents_root_file_waits_for_review_except_in_autonomous_mode() {
    let (t, k, s) = open();
    for mode in [AgentMode::Review, AgentMode::Balanced] {
        set_mode(&k, mode);
        let (_, why) = pending(k.agent_run(&s, &trash(MAIN), NOW).unwrap());
        assert!(why.contains("root file"), "{mode:?}: {why}");
        assert!(t.vault.root().join(MAIN).is_file());
    }
    // Even a trusted session cannot skip it.
    k.trust_session(&s.id, NOW.millis + 60_000).unwrap();
    set_mode(&k, AgentMode::Balanced);
    let (id, _) = pending(k.agent_run(&s, &trash(MAIN), NOW).unwrap());
    let waiting = k.proposals().unwrap();
    assert!(
        waiting
            .iter()
            .any(|p| p.id == id && p.diff.contains("trash"))
    );
    // The person accepts, and the file is in the trash, not deleted.
    let result = k.accept_proposal(&id, "Ada", NOW).unwrap();
    let trashed = result["trashed"].as_str().unwrap();
    assert!(!t.vault.root().join(MAIN).exists());
    assert!(t.vault.root().join(trashed).is_file());
    assert!(k.latex_docs().unwrap().iter().all(|d| d.folder != ARTICLE));

    set_mode(&k, AgentMode::Autonomous);
    let second = format!("{BASE}/second/main.tex");
    put(&t, &second, b"\\documentclass{article}\n");
    k.commit_edits().unwrap();
    let result = done(k.agent_run(&s, &trash(&second), NOW).unwrap());
    assert!(
        t.vault
            .root()
            .join(result["trashed"].as_str().unwrap())
            .is_file()
    );
}

#[test]
fn a_locked_document_and_what_is_no_source_cannot_be_trashed() {
    let (t, k, s) = open();
    for mode in [
        AgentMode::Review,
        AgentMode::Balanced,
        AgentMode::Autonomous,
    ] {
        set_mode(&k, mode);
        for path in [
            format!("{LOCKED}/main.tex"),
            format!("{LOCKED}/refs.bib"),
            format!("{ARTICLE}/kasten-latex.yaml"),
            "inbox/plain.md".to_owned(),
            "../outside.tex".to_owned(),
            format!("{ARTICLE}/missing.tex"),
        ] {
            assert!(
                k.agent_run(&s, &trash(&path), NOW).is_err(),
                "{mode:?} {path}"
            );
        }
    }
    assert!(t.vault.root().join(LOCKED).join("main.tex").is_file());
    assert!(!t.vault.root().join(".trash").exists());
}
