//! What the waiting LaTeX changes of a session would make of a document: the
//! text a preview build compiles while the real files stay as they are.

use crate::common;

use std::fs;
use std::path::Path;

use common::{NOW, dev_vault};
use kasten_core::agent::{AgentOp, Session};
use kasten_core::config_keys::{AgentMode, AgentsConfig};
use kasten_core::{Kasten, Outcome};

const FOLDER: &str = "projects/photo-organiser/latex/article";
const MAIN: &str = "projects/photo-organiser/latex/article/main.tex";

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

/// A vault with the article, in Review mode: every agent write waits.
fn open() -> (common::TempVault, Kasten, Session) {
    let t = dev_vault();
    let from = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/latex/article");
    copy_dir(&from, &t.vault.root().join(FOLDER));
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    let mut config = k.config();
    config.agents = Some(AgentsConfig {
        mode: Some(AgentMode::Review),
        ..AgentsConfig::default()
    });
    k.set_config(config).unwrap();
    (t, k, Session::start("claude-code", NOW))
}

fn text_of(t: &common::TempVault, path: &str) -> String {
    fs::read_to_string(t.vault.root().join(path)).unwrap()
}

fn propose(k: &Kasten, s: &Session, path: &str, base: &str, text: &str) {
    let op = AgentOp::SaveSource {
        path: path.into(),
        text: text.into(),
        base: base.into(),
        reason: None,
    };
    match k.agent_run(s, &op, NOW).unwrap() {
        Outcome::PendingReview { .. } => {}
        other => panic!("expected a proposal, got {other:?}"),
    }
}

#[test]
fn a_waiting_edit_is_the_text_a_preview_builds_and_the_file_is_untouched() {
    let (t, k, s) = open();
    let before = text_of(&t, MAIN);
    let after = before.replace("fixed rate", "steady rate");
    propose(&k, &s, MAIN, &before, &after);
    let found = k.latex_proposed(FOLDER, &s.id).unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found.get("main.tex"), Some(&after));
    assert_eq!(text_of(&t, MAIN), before, "the real file is not changed");
}

#[test]
fn the_newest_edit_of_a_file_wins_and_other_sessions_and_folders_are_left_out() {
    let (t, k, s) = open();
    let before = text_of(&t, MAIN);
    let first = before.replace("fixed rate", "steady rate");
    let second = first.replace("simple", "plain");
    propose(&k, &s, MAIN, &before, &first);
    propose(&k, &s, MAIN, &before, &second);
    let other = Session::start("other-client", NOW);
    propose(&k, &other, MAIN, &before, &before.replace("works", "holds"));
    let found = k.latex_proposed(FOLDER, &s.id).unwrap();
    assert_eq!(found.get("main.tex"), Some(&second));
    assert_eq!(
        k.latex_proposed(FOLDER, &other.id).unwrap().get("main.tex"),
        Some(&before.replace("works", "holds"))
    );
    assert!(
        k.latex_proposed("projects/photo-organiser/latex/twocolumn", &s.id)
            .unwrap()
            .is_empty()
    );
    assert!(
        k.latex_proposed(FOLDER, "no-such-session")
            .unwrap()
            .is_empty()
    );
}

#[test]
fn a_change_made_to_the_file_since_is_merged_in_and_a_conflict_is_left_out() {
    let (t, k, s) = open();
    let before = text_of(&t, MAIN);
    propose(
        &k,
        &s,
        MAIN,
        &before,
        &before.replace("fixed rate", "steady rate"),
    );
    // The person edits another line meanwhile: the preview has both.
    let person = before.replace("A Small Article", "A Smaller Article");
    fs::write(t.vault.root().join(MAIN), &person).unwrap();
    let found = k.latex_proposed(FOLDER, &s.id).unwrap();
    let merged = found.get("main.tex").unwrap();
    assert!(merged.contains("steady rate") && merged.contains("A Smaller Article"));
    // The person edits the same line: it would be a conflict, so nothing is previewed.
    fs::write(
        t.vault.root().join(MAIN),
        before.replace("fixed rate", "regular rate"),
    )
    .unwrap();
    assert!(k.latex_proposed(FOLDER, &s.id).unwrap().is_empty());
}
