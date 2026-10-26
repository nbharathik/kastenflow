//! Pushing on schedule: after a failure each try waits longer, up to an
//! hour, counted from the last try, so a long outage costs one try an
//! hour rather than one every tick; a new commit never cuts the wait
//! short, and a push that works again ends it.

use crate::common;

use common::{NOW, dev_vault};
use kasten_core::history::{Actor, BackupState};
use kasten_core::{Kasten, Kind, NewNote};

const MIN: u64 = 60_000;

/// A vault whose confirmed remote is a folder that is not there yet, so
/// every push fails at once.
fn failing_remote() -> (common::TempVault, Kasten, std::path::PathBuf) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    let remote = t.vault.root().with_extension("later-remote.git");
    let url = remote.to_string_lossy().into_owned();
    let mut config = k.config();
    config.git.remote = Some(url.clone());
    config.git.push_delay_seconds = 0;
    k.set_config(config).unwrap();
    k.confirm_remote(Some(&url));
    (t, k, remote)
}

fn page(title: &str) -> NewNote {
    NewNote {
        kind: Kind::Page,
        title: title.into(),
        date: "2026-09-25".into(),
        project: None,
        parent: None,
        template: None,
        icon: None,
    }
}

#[test]
fn after_a_failure_each_try_waits_longer_from_the_last_try_up_to_an_hour() {
    let (_t, k, _remote) = failing_remote();
    let mut now = NOW.millis;
    assert!(matches!(k.push_if_due(now), Some(Err(_))));
    for wait in [2, 4, 8, 16, 32, 60, 60, 60] {
        assert!(
            k.push_if_due(now + wait * MIN - 1).is_none(),
            "tried again before {wait} min"
        );
        now += wait * MIN;
        assert!(
            matches!(k.push_if_due(now), Some(Err(_))),
            "did not try after {wait} min"
        );
    }
    let status = k.backup_status(now);
    assert_eq!(status.failures, 9);
    // Failing means six hours of it, not a few failures in a row.
    assert_ne!(status.state, BackupState::Failing);
    let six_hours = k.backup_status(NOW.millis + 6 * 60 * MIN);
    assert_eq!(six_hours.state, BackupState::Failing);
}

#[test]
fn a_new_commit_does_not_cut_the_wait_short() {
    let (_t, k, _remote) = failing_remote();
    assert!(matches!(k.push_if_due(NOW.millis), Some(Err(_))));
    let later = kasten_core::Instant {
        millis: NOW.millis + MIN,
    };
    k.create(&Actor::Human, &page("Written during the outage"), later)
        .unwrap();
    assert!(k.push_if_due(NOW.millis + MIN + 1).is_none());
    assert!(matches!(k.push_if_due(NOW.millis + 2 * MIN), Some(Err(_))));
}

#[test]
fn a_push_that_works_again_ends_the_wait() {
    let (_t, k, remote) = failing_remote();
    assert!(matches!(k.push_if_due(NOW.millis), Some(Err(_))));
    git2::Repository::init_bare(&remote).unwrap();
    assert!(matches!(k.push_if_due(NOW.millis + 2 * MIN), Some(Ok(()))));
    let status = k.backup_status(NOW.millis + 2 * MIN);
    assert_eq!((status.failures, status.state), (0, BackupState::Ok));
    // The next commit goes at once, with no wait left over.
    let later = kasten_core::Instant {
        millis: NOW.millis + 3 * MIN,
    };
    k.create(&Actor::Human, &page("After the outage"), later)
        .unwrap();
    assert!(matches!(k.push_if_due(later.millis), Some(Ok(()))));
}

#[test]
fn closing_pushes_only_what_is_new_and_not_straight_after_a_failure() {
    let (_t, k, remote) = failing_remote();
    // History the backup lacks: worth one last push.
    assert!(k.push_on_close_due(NOW.millis));
    assert!(matches!(k.push_if_due(NOW.millis), Some(Err(_))));
    // A push just failed: closing does not wait on another.
    assert!(!k.push_on_close_due(NOW.millis + MIN));
    assert!(k.push_on_close_due(NOW.millis + 2 * MIN));
    git2::Repository::init_bare(&remote).unwrap();
    k.push(NOW.millis + 2 * MIN).unwrap();
    // Nothing new since.
    assert!(!k.push_on_close_due(NOW.millis + 3 * MIN));
    let _ = std::fs::remove_dir_all(&remote);
}
