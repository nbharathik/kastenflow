//! Turning a plugin on or off for a vault: a person's choice, written to
//! `.kasten/config.yaml` as one commit; agents cannot make it; keys this
//! version does not know stay in the file.

use std::fs;

use crate::common;

use common::{NOW, dev_vault};
use kasten_core::history::Actor;
use kasten_core::{Config, Kasten};

fn open() -> (common::TempVault, Kasten) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k)
}

fn agent() -> Actor {
    Actor::Agent {
        client: "claude-code".into(),
        session: "01K5ZK00000000000000000009".into(),
    }
}

fn on_disk(t: &common::TempVault) -> Config {
    Config::load(t.vault.root()).unwrap()
}

#[test]
fn latex_is_off_and_diagrams_on_until_chosen() {
    let (_t, k) = open();
    assert!(k.config().plugin_enabled("diagrams"));
    assert!(!k.config().plugin_enabled("latex"));
}

#[test]
fn turning_a_plugin_on_writes_the_config_in_one_commit() {
    let (t, k) = open();
    let before = k.log(None, 1000).unwrap().len();
    assert!(
        k.set_plugin_enabled(&Actor::Human, "latex", true, NOW)
            .unwrap()
    );
    assert!(on_disk(&t).plugin_enabled("latex"));
    assert!(k.config().plugin_enabled("latex"), "the open vault knows");
    let log = k.log(None, 1000).unwrap();
    assert_eq!(log.len(), before + 1);
    assert_eq!(log[0].summary, "plugins: turn latex on");
    assert!(!log[0].agent);
}

#[test]
fn turning_diagrams_off_is_written_and_back_on_again() {
    let (t, k) = open();
    k.set_plugin_enabled(&Actor::Human, "diagrams", false, NOW)
        .unwrap();
    assert!(!on_disk(&t).plugin_enabled("diagrams"));
    k.set_plugin_enabled(&Actor::Human, "diagrams", true, NOW)
        .unwrap();
    assert!(on_disk(&t).plugin_enabled("diagrams"));
}

#[test]
fn saying_what_is_already_so_changes_nothing() {
    let (_t, k) = open();
    let before = k.log(None, 1000).unwrap().len();
    assert!(
        !k.set_plugin_enabled(&Actor::Human, "diagrams", true, NOW)
            .unwrap()
    );
    assert!(
        !k.set_plugin_enabled(&Actor::Human, "latex", false, NOW)
            .unwrap()
    );
    assert_eq!(k.log(None, 1000).unwrap().len(), before);
}

#[test]
fn an_agent_cannot_turn_a_plugin_on_or_off() {
    let (t, k) = open();
    let before = k.log(None, 1000).unwrap().len();
    let err = k
        .set_plugin_enabled(&agent(), "latex", true, NOW)
        .unwrap_err();
    assert!(err.to_string().contains("person"), "{err}");
    let approved = Actor::Approved {
        client: "claude-code".into(),
        session: "s".into(),
        by: "me".into(),
    };
    assert!(k.set_plugin_enabled(&approved, "latex", true, NOW).is_err());
    assert!(!on_disk(&t).plugin_enabled("latex"));
    assert_eq!(k.log(None, 1000).unwrap().len(), before);
}

#[test]
fn a_plugin_that_does_not_exist_is_refused() {
    let (_t, k) = open();
    let err = k
        .set_plugin_enabled(&Actor::Human, "teleport", true, NOW)
        .unwrap_err();
    assert!(err.to_string().contains("teleport"), "{err}");
}

#[test]
fn keys_this_version_does_not_know_stay_in_the_file() {
    let t = dev_vault();
    let path = t.vault.root().join(".kasten/config.yaml");
    let mut text = fs::read_to_string(&path).unwrap();
    text.push_str("plugins:\n  future: 3\n  latex: false\n");
    fs::write(&path, text).unwrap();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    k.set_plugin_enabled(&Actor::Human, "latex", true, NOW)
        .unwrap();
    let written = fs::read_to_string(&path).unwrap();
    assert!(written.contains("future"), "{written}");
    assert!(on_disk(&t).plugin_enabled("latex"));
}

#[test]
fn undo_takes_the_choice_back() {
    let (t, k) = open();
    k.set_plugin_enabled(&Actor::Human, "latex", true, NOW)
        .unwrap();
    let id = k.log(None, 1).unwrap()[0].id.clone();
    k.undo_commit(&id, NOW).unwrap();
    assert!(!on_disk(&t).plugin_enabled("latex"));
}
