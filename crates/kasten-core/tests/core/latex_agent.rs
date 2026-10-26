//! Agents and LaTeX sources: the same guarded write for every mode. A locked
//! document is refused, a rewrite that takes out more than the limit waits in
//! Balanced mode (and in Review mode every write does), Autonomous mode
//! commits it, a person's changes made meanwhile are kept, and a file that is
//! not a source, or not in a document, is refused.

use crate::common;

use std::fs;
use std::path::Path;

use common::{NOW, dev_vault};
use kasten_core::agent::{AgentOp, Session};
use kasten_core::config_keys::{AgentMode, AgentsConfig};
use kasten_core::history::Actor;
use kasten_core::latex::MAX_SOURCE_BYTES;
use kasten_core::{Error, Kasten, Outcome};
use serde_json::Value;

const BASE: &str = "projects/photo-organiser/latex";
const MAIN: &str = "projects/photo-organiser/latex/article/main.tex";
const LOCKED: &str = "projects/photo-organiser/latex/twocolumn/main.tex";

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

fn set_mode(k: &Kasten, mode: AgentMode) {
    let mut config = k.config();
    config.agents = Some(AgentsConfig {
        mode: Some(mode),
        ..AgentsConfig::default()
    });
    k.set_config(config).unwrap();
}

fn text_of(t: &common::TempVault, path: &str) -> String {
    fs::read_to_string(t.vault.root().join(path)).unwrap()
}

/// A rewrite of `path`, written against the text it has now.
fn rewrite(t: &common::TempVault, path: &str, text: &str) -> AgentOp {
    AgentOp::SaveSource {
        path: path.into(),
        text: text.into(),
        base: text_of(t, path),
        reason: Some("test".into()),
    }
}

fn new_file(path: &str, text: &str) -> AgentOp {
    AgentOp::SaveSource {
        path: path.into(),
        text: text.into(),
        base: String::new(),
        reason: None,
    }
}

fn done(outcome: Outcome) -> Value {
    match outcome {
        Outcome::Done { result } => result,
        other => panic!("expected done, got {other:?}"),
    }
}

fn pending(outcome: Outcome) -> String {
    match outcome {
        Outcome::PendingReview { reason, .. } => reason,
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
fn a_small_change_is_committed_at_once_as_the_agents() {
    let (t, k, s) = open();
    let edited = text_of(&t, MAIN).replace("fixed rate", "steady rate");
    let result = done(k.agent_run(&s, &rewrite(&t, MAIN, &edited), NOW).unwrap());
    assert_eq!(result["status"], "saved");
    assert_eq!(text_of(&t, MAIN), edited);
    let log = k.log(Some(MAIN), 1).unwrap();
    assert_eq!(
        (log[0].summary.as_str(), log[0].agent),
        ("edit: main.tex", true)
    );
    assert_eq!(log[0].op.as_deref(), Some("save_source"));
}

#[test]
fn balanced_mode_holds_a_rewrite_that_takes_out_too_much() {
    let (t, k, s) = open();
    let before = text_of(&t, MAIN);
    let why = pending(
        k.agent_run(&s, &rewrite(&t, MAIN, "\\documentclass{article}\n"), NOW)
            .unwrap(),
    );
    assert!(why.contains("Removes") && why.contains("40%"), "{why}");
    assert_eq!(text_of(&t, MAIN), before);
    let waiting = k.proposals().unwrap();
    assert_eq!(waiting.len(), 1);
    assert!(waiting[0].diff.contains("main.tex"), "{}", waiting[0].diff);
    assert_eq!(waiting[0].target.as_ref().unwrap().path, MAIN);
}

#[test]
fn a_trusted_session_may_rewrite_as_it_likes() {
    let (t, k, s) = open();
    k.trust_session(&s.id, NOW.millis + 60_000).unwrap();
    done(
        k.agent_run(&s, &rewrite(&t, MAIN, "\\documentclass{article}\n"), NOW)
            .unwrap(),
    );
    assert_eq!(text_of(&t, MAIN), "\\documentclass{article}\n");
}

#[test]
fn review_mode_holds_every_write_and_autonomous_mode_commits_the_big_one() {
    let (t, k, s) = open();
    set_mode(&k, AgentMode::Review);
    let small = text_of(&t, MAIN).replace("fixed rate", "steady rate");
    pending(k.agent_run(&s, &rewrite(&t, MAIN, &small), NOW).unwrap());
    assert!(text_of(&t, MAIN).contains("fixed rate"));

    set_mode(&k, AgentMode::Autonomous);
    done(
        k.agent_run(&s, &rewrite(&t, MAIN, "\\documentclass{article}\n"), NOW)
            .unwrap(),
    );
    assert_eq!(text_of(&t, MAIN), "\\documentclass{article}\n");
    assert_eq!(
        k.log(Some(MAIN), 1).unwrap()[0].mode.as_deref(),
        Some("autonomous")
    );
}

#[test]
fn a_locked_document_is_refused_in_every_mode() {
    let (t, k, s) = open();
    let before = text_of(&t, LOCKED);
    for mode in [
        AgentMode::Review,
        AgentMode::Balanced,
        AgentMode::Autonomous,
    ] {
        set_mode(&k, mode);
        let op = rewrite(&t, LOCKED, &format!("{before}% more\n"));
        assert!(
            refused(k.agent_run(&s, &op, NOW)).contains("locked"),
            "{mode:?}"
        );
        // A new file in it is refused too.
        let fresh = new_file(&format!("{BASE}/twocolumn/extra.tex"), "words\n");
        assert!(
            refused(k.agent_run(&s, &fresh, NOW)).contains("locked"),
            "{mode:?}"
        );
    }
    assert_eq!(text_of(&t, LOCKED), before);
    assert!(
        !t.vault
            .root()
            .join(BASE)
            .join("twocolumn/extra.tex")
            .exists()
    );
    // A person's save is not an agent's: the lock is for agents.
    let loaded = k.source(LOCKED).unwrap();
    assert!(
        k.save_source(
            &Actor::Human,
            LOCKED,
            &loaded.hash,
            &format!("{before}% mine\n"),
            NOW
        )
        .is_ok()
    );
}

#[test]
fn agents_cannot_skip_the_guarded_write() {
    let (t, k, _) = open();
    let agent = Actor::Agent {
        client: "claude-code".into(),
        session: "s1".into(),
    };
    let loaded = k.source(MAIN).unwrap();
    let why = match k.save_source(&agent, MAIN, &loaded.hash, "x", NOW) {
        Err(Error::Invalid(why)) => why,
        other => panic!("expected a refusal, got {other:?}"),
    };
    assert!(why.contains("guarded"), "{why}");
    assert_eq!(text_of(&t, MAIN), loaded.text);
}

#[test]
fn what_a_person_typed_meanwhile_is_kept() {
    let (t, k, s) = open();
    let read = text_of(&t, MAIN);
    let op = AgentOp::SaveSource {
        path: MAIN.into(),
        text: read.replace("fixed rate", "steady rate"),
        base: read.clone(),
        reason: None,
    };
    // The person changes the title line after the agent read the file.
    let loaded = k.source(MAIN).unwrap();
    k.save_source(
        &Actor::Human,
        MAIN,
        &loaded.hash,
        &read.replace("A Small Article", "A Larger Article"),
        NOW,
    )
    .unwrap();
    let result = done(k.agent_run(&s, &op, NOW).unwrap());
    assert_eq!(result["status"], "merged");
    let now = text_of(&t, MAIN);
    assert!(now.contains("A Larger Article") && now.contains("steady rate"));

    // The same line: the agent's version goes beside the file.
    let again = AgentOp::SaveSource {
        path: MAIN.into(),
        text: now.replace("A Larger Article", "The Agent's Title"),
        base: read,
        reason: None,
    };
    let result = done(k.agent_run(&s, &again, NOW).unwrap());
    assert_eq!(result["status"], "conflict");
    let copy = result["copy"].as_str().unwrap();
    assert!(text_of(&t, copy).contains("The Agent's Title"));
    assert_eq!(text_of(&t, MAIN), now);
}

#[test]
fn only_sources_in_latex_folders_and_new_roots_where_a_document_can_start() {
    let (t, k, s) = open();
    // Not a source file.
    for path in [
        "inbox/plan.md",
        "projects/photo-organiser/latex/article/x.pdf",
    ] {
        let why = refused(k.agent_run(&s, &new_file(path, "x"), NOW));
        assert!(why.contains("not a LaTeX source"), "{path}: {why}");
    }
    // Where agents never write.
    for path in ["templates/x.tex", ".kasten/x.tex", "../x.tex"] {
        assert!(
            k.agent_run(&s, &new_file(path, "\\documentclass{a}"), NOW)
                .is_err(),
            "{path}"
        );
    }
    // A file with no document around it, and no class of its own.
    assert!(
        refused(k.agent_run(&s, &new_file("inbox/loose.tex", "words"), NOW))
            .contains("not in a LaTeX")
    );
    assert!(
        refused(k.agent_run(&s, &new_file("top.tex", "\\documentclass{a}"), NOW))
            .contains("not in a LaTeX")
    );
    // A file that is already there is read first.
    let exists = new_file(MAIN, "x");
    assert!(refused(k.agent_run(&s, &exists, NOW)).contains("already exists"));
    // A root file makes a document; a section joins it.
    let root = "inbox/notes/main.tex";
    done(
        k.agent_run(&s, &new_file(root, "\\documentclass{article}\n"), NOW)
            .unwrap(),
    );
    assert!(k.latex_docs().unwrap().iter().any(|d| d.main_path == root));
    done(
        k.agent_run(&s, &new_file("inbox/notes/intro.tex", "Hello\n"), NOW)
            .unwrap(),
    );
    assert_eq!(text_of(&t, "inbox/notes/intro.tex"), "Hello\n");
    // A .bib is text only inside a document.
    assert!(
        k.agent_run(&s, &new_file("sources/references.bib", "@book{a}"), NOW)
            .is_err()
    );
    done(
        k.agent_run(&s, &new_file("inbox/notes/refs.bib", "@book{a}\n"), NOW)
            .unwrap(),
    );
}

#[test]
fn a_write_over_the_size_limit_is_refused() {
    let (t, k, s) = open();
    let big = "a".repeat(MAX_SOURCE_BYTES + 1);
    let why = refused(k.agent_run(&s, &rewrite(&t, MAIN, &big), NOW));
    assert!(why.contains("KB"), "{why}");
    let fits = "a".repeat(MAX_SOURCE_BYTES);
    // At the limit it is only the removed share that holds it back.
    let reason = pending(k.agent_run(&s, &rewrite(&t, MAIN, &fits), NOW).unwrap());
    assert!(reason.contains("Removes"), "{reason}");
}
