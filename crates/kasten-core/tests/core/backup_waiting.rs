//! The count of changes not yet backed up: local commits the backup lacks.

use crate::backup_support::{commit_page, with_backup};
use crate::common::NOW;

use std::fs;

#[test]
fn the_count_is_zero_after_a_push_and_grows_with_each_commit() {
    let (_t, k, _remote) = with_backup();
    let before = k.backup_status(NOW.millis);
    assert!(
        before.unpushed >= 1,
        "the first commit is not backed up yet"
    );
    assert!(before.waiting);

    k.push(NOW.millis).unwrap();
    let after = k.backup_status(NOW.millis);
    assert_eq!(after.unpushed, 0);
    assert!(!after.waiting);

    for (i, title) in ["One", "Two", "Three"].iter().enumerate() {
        commit_page(&k, title, i as u64 + 1);
    }
    let three = k.backup_status(NOW.millis);
    assert_eq!(three.unpushed, 3);
    assert!(three.waiting);

    k.push(NOW.millis + 10_000).unwrap();
    assert_eq!(k.backup_status(NOW.millis + 10_000).unpushed, 0);
}

#[test]
fn a_failed_push_does_not_change_the_count() {
    let (_t, k, remote) = with_backup();
    k.push(NOW.millis).unwrap();
    commit_page(&k, "One", 1);
    commit_page(&k, "Two", 2);
    assert_eq!(k.backup_status(NOW.millis).unpushed, 2);

    // The backup goes away: the next push fails.
    fs::remove_dir_all(&remote.0).unwrap();
    assert!(k.push(NOW.millis + 5_000).is_err());
    let status = k.backup_status(NOW.millis + 5_000);
    assert_eq!(status.failures, 1);
    assert_eq!(status.unpushed, 2);
    assert!(status.waiting);
}

#[test]
fn without_a_backup_nothing_is_waiting() {
    let t = crate::common::dev_vault();
    let k = kasten_core::Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    let status = k.backup_status(NOW.millis);
    assert_eq!(status.unpushed, 0);
    assert!(!status.waiting);
}
