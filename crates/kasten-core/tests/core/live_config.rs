//! `.kasten/config.yaml` is read again when it changes on disk, so an app, a
//! CLI and a running MCP server agree without a restart. A file that no
//! longer parses keeps the last good config and shows up in the health.

use crate::common;

use std::fs;
use std::thread::sleep;
use std::time::Duration;

use common::{NOW, dev_vault};
use kasten_core::Kasten;

/// A little more than the 100 ms the engine waits between looks.
const PAUSE: Duration = Duration::from_millis(160);

fn open() -> (common::TempVault, Kasten) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k)
}

fn write(root: &std::path::Path, text: &str) {
    fs::create_dir_all(root.join(".kasten")).unwrap();
    fs::write(root.join(".kasten/config.yaml"), text).unwrap();
}

#[test]
fn a_limit_changed_on_disk_is_seen_by_the_next_op() {
    let (t, k) = open();
    let root = t.vault.root();
    assert_eq!(k.config().guardrails.max_trash_per_session, 5);
    sleep(PAUSE);
    write(
        root,
        "name: Dev vault\nguardrails:\n  max_trash_per_session: 2\n",
    );
    sleep(PAUSE);
    assert_eq!(k.config().guardrails.max_trash_per_session, 2);
    assert_eq!(k.config().name, "Dev vault");

    sleep(PAUSE);
    write(
        root,
        "name: Dev vault\nguardrails:\n  max_trash_per_session: 12\n",
    );
    sleep(PAUSE);
    assert_eq!(k.config().guardrails.max_trash_per_session, 12);
}

#[test]
fn a_file_that_does_not_parse_keeps_the_last_good_config_until_it_is_fixed() {
    let (t, k) = open();
    let root = t.vault.root();
    sleep(PAUSE);
    write(
        root,
        "name: Kept\nguardrails:\n  max_trash_per_session: 3\n",
    );
    sleep(PAUSE);
    assert_eq!(k.config().guardrails.max_trash_per_session, 3);
    assert!(k.health(NOW.millis).config_problem.is_none());

    sleep(PAUSE);
    write(
        root,
        "name: Kept\nguardrails:\n  max_trash_per_session: [oops\n",
    );
    sleep(PAUSE);
    assert_eq!(
        k.config().guardrails.max_trash_per_session,
        3,
        "the last good config stays"
    );
    assert_eq!(k.config().name, "Kept");
    let problem = k.health(NOW.millis).config_problem.expect("an issue");
    assert!(problem.contains("config.yaml"), "{problem}");

    sleep(PAUSE);
    write(
        root,
        "name: Kept\nguardrails:\n  max_trash_per_session: 9\n",
    );
    sleep(PAUSE);
    assert_eq!(k.config().guardrails.max_trash_per_session, 9);
    assert!(k.health(NOW.millis).config_problem.is_none());
}

#[test]
fn a_config_saved_by_this_engine_is_not_reported_as_a_change_on_disk() {
    let (_t, k) = open();
    let mut config = k.config();
    config.guardrails.max_notes_per_session_10min = 7;
    k.set_config(config).unwrap();
    sleep(PAUSE);
    assert_eq!(k.config().guardrails.max_notes_per_session_10min, 7);
    assert!(k.health(NOW.millis).config_problem.is_none());
}

#[test]
fn a_second_engine_on_the_same_vault_sees_what_the_first_saved() {
    let (t, first) = open();
    let second = Kasten::open(t.vault.root()).unwrap();
    sleep(PAUSE);
    let mut config = first.config();
    config.guardrails.max_assets_per_session_10min = 77;
    first.set_config(config).unwrap();
    sleep(PAUSE);
    assert_eq!(second.config().guardrails.max_assets_per_session_10min, 77);
}

#[test]
fn a_removed_config_file_means_the_defaults_again() {
    let (t, k) = open();
    let root = t.vault.root();
    sleep(PAUSE);
    write(
        root,
        "name: Gone\nguardrails:\n  max_trash_per_session: 3\n",
    );
    sleep(PAUSE);
    assert_eq!(k.config().guardrails.max_trash_per_session, 3);
    fs::remove_file(root.join(".kasten/config.yaml")).unwrap();
    sleep(PAUSE);
    // The first look at a vanished file keeps what was in force; the next one
    // finds it still gone.
    assert_eq!(k.config().guardrails.max_trash_per_session, 3);
    sleep(PAUSE);
    assert_eq!(k.config().guardrails.max_trash_per_session, 5);
}

#[test]
fn a_file_an_editor_truncated_and_is_about_to_write_does_not_read_as_defaults() {
    let (t, k) = open();
    let root = t.vault.root();
    sleep(PAUSE);
    write(
        root,
        "name: Tight\nguardrails:\n  max_trash_per_session: 1\n",
    );
    sleep(PAUSE);
    assert_eq!(k.config().guardrails.max_trash_per_session, 1);

    // Truncated: the limit stays at 1 at the look that sees the empty file...
    write(root, "");
    sleep(PAUSE);
    assert_eq!(k.config().guardrails.max_trash_per_session, 1);
    // ...and the editor's real write is read as itself, not as defaults.
    write(
        root,
        "name: Tight\nguardrails:\n  max_trash_per_session: 2\n",
    );
    sleep(PAUSE);
    assert_eq!(k.config().guardrails.max_trash_per_session, 2);

    // A file that stays empty for a second look is defaults.
    write(root, "");
    sleep(PAUSE);
    assert_eq!(k.config().guardrails.max_trash_per_session, 2);
    sleep(PAUSE);
    assert_eq!(k.config().guardrails.max_trash_per_session, 5);
}

#[test]
fn two_changes_made_through_update_config_both_stay() {
    let (t, k) = open();
    let other = Kasten::open(t.vault.root()).unwrap();
    // The second engine's copy is stale: it has not looked since the first saved.
    k.update_config(|c| {
        c.guardrails.max_trash_per_session = 4;
        Ok(())
    })
    .unwrap();
    other
        .update_config(|c| {
            c.journal_template = Some("daily".into());
            Ok(())
        })
        .unwrap();
    let saved = kasten_core::config::Config::load(t.vault.root()).unwrap();
    assert_eq!(saved.guardrails.max_trash_per_session, 4);
    assert_eq!(saved.journal_template.as_deref(), Some("daily"));
    let refused = k.update_config(|_| Err(kasten_core::Error::Invalid("no".into())));
    assert!(refused.is_err());
    assert_eq!(
        kasten_core::config::Config::load(t.vault.root()).unwrap(),
        saved
    );
}
