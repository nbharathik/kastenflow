//! The weekly check of the backup itself: it holds the commit this computer
//! last sent, and what was fetched from it reads back whole.

use crate::backup_support::{commit_page, two_computers, with_backup};
use crate::common::NOW;

const MIN: u64 = 60_000;
const DAY: u64 = 24 * 60 * MIN;

#[test]
fn nothing_sent_yet_is_not_a_failure_but_is_not_verified() {
    let (_t, k, _remote) = with_backup();
    assert!(!k.remote_check_due(NOW.millis));
    let check = k.verify_remote(NOW.millis).unwrap();
    assert!(!check.ok);
    assert_eq!(check.verified_at, None);
    assert!(check.problems[0].to_lowercase().contains("nothing"));
    assert_eq!(k.backup_status(NOW.millis).verified_at, None);
}

#[test]
fn a_backup_that_holds_what_was_sent_is_verified() {
    let (_t, k, _remote) = with_backup();
    k.back_up_now(NOW.millis);
    assert!(k.remote_check_due(NOW.millis + MIN), "never checked yet");

    let check = k.verify_remote(NOW.millis + MIN).unwrap();
    assert!(check.ok, "{:?}", check.problems);
    assert_eq!(check.verified_at, Some(NOW.millis + MIN));
    assert_eq!(
        k.backup_status(NOW.millis + 2 * MIN).verified_at,
        Some(NOW.millis + MIN)
    );
    // The record survives opening the vault again.
    let again = kasten_core::Kasten::open(k.root()).unwrap();
    assert_eq!(
        again.backup_status(NOW.millis + 2 * MIN).verified_at,
        Some(NOW.millis + MIN)
    );
}

#[test]
fn the_check_is_due_weekly() {
    let (_t, k, _remote) = with_backup();
    assert!(!k.remote_check_due(NOW.millis), "no backup sent yet");
    k.back_up_now(NOW.millis);
    k.verify_remote(NOW.millis).unwrap();
    assert!(!k.remote_check_due(NOW.millis + 6 * DAY));
    assert!(k.remote_check_due(NOW.millis + 7 * DAY));
    // A failed check does not make it look fresh.
    assert!(k.verify_remote_if_due(NOW.millis + 6 * DAY).is_none());
    assert!(matches!(
        k.verify_remote_if_due(NOW.millis + 7 * DAY),
        Some(Ok(check)) if check.ok
    ));
    assert!(!k.remote_check_due(NOW.millis + 8 * DAY));
}

#[test]
fn a_backup_other_computers_added_to_still_holds_ours() {
    let two = two_computers();
    two.a.back_up_now(NOW.millis);
    commit_page(&two.b, "On the laptop", 1);
    two.b.push(NOW.millis + MIN).unwrap();

    let check = two.a.verify_remote(NOW.millis + 2 * MIN).unwrap();
    assert!(check.ok, "{:?}", check.problems);
    assert!(check.objects > 0, "what was fetched was read back");
    // Fetching put nothing in the vault.
    assert!(two.a.search("laptop", 10).unwrap().is_empty());
}

#[test]
fn a_backup_that_lost_what_was_sent_is_not_verified() {
    let (_t, k, remote) = with_backup();
    k.back_up_now(NOW.millis);
    let first = remote.tip("main").unwrap();
    commit_page(&k, "Went to the backup", 1);
    k.back_up_now(NOW.millis + MIN);
    k.verify_remote(NOW.millis + 2 * MIN).unwrap();
    remote.force("main", git2::Oid::from_str(&first).unwrap());

    let check = k.verify_remote(NOW.millis + 9 * DAY).unwrap();
    assert!(!check.ok);
    assert!(!check.problems.is_empty());
    assert_eq!(check.verified_at, Some(NOW.millis + 2 * MIN));
    // The earlier success is kept, so it keeps showing how old it is.
    assert_eq!(
        k.backup_status(NOW.millis + 9 * DAY).verified_at,
        Some(NOW.millis + 2 * MIN)
    );
    assert_eq!(remote.tip("main"), Some(first), "nothing was written there");
}

#[test]
fn an_unreachable_backup_is_an_error_not_a_pass() {
    let (_t, k, remote) = with_backup();
    k.back_up_now(NOW.millis);
    let away = remote.0.with_extension("away");
    std::fs::rename(&remote.0, &away).unwrap();
    let result = k.verify_remote(NOW.millis + MIN);
    std::fs::rename(&away, &remote.0).unwrap();
    assert!(result.is_err());
    assert_eq!(k.backup_status(NOW.millis + MIN).verified_at, None);
}
