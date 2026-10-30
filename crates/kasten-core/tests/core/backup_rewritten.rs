//! A backup someone rewrote (a force push or a reset) stops taking pushes,
//! says its history was lost, and is never overwritten; this computer's full
//! history can go to a branch of its own instead.

use crate::backup_support::{Remote, commit_page, with_backup};
use crate::common::NOW;

use kasten_core::history::{BackupState, History};
use kasten_core::{Instant, Kasten};

const MIN: u64 = 60_000;

fn local_head(k: &Kasten) -> String {
    History::open(k.root()).unwrap().unwrap().head().unwrap()
}

/// The vault has pushed twice: the first commit, then a page.
fn pushed_twice(k: &Kasten, remote: &Remote) -> String {
    k.push(NOW.millis).unwrap();
    let first = remote.tip("main").unwrap();
    commit_page(k, "Page that went", 1);
    k.push(NOW.millis + 2 * MIN).unwrap();
    assert_ne!(remote.tip("main").unwrap(), first);
    first
}

fn assert_stopped(k: &Kasten, remote: &Remote, kept: &str) {
    let at = NOW.millis + 10 * MIN;
    let err = k.push(at).unwrap_err().to_string();
    assert!(err.contains("safety branch"), "{err}");
    assert_eq!(
        remote.tip("main").as_deref(),
        Some(kept),
        "the backup was overwritten"
    );
    let status = k.backup_status(at);
    assert!(status.lost_history);
    assert_eq!(status.state, BackupState::Failing);
    assert!(k.push_if_due(at + 60 * MIN).is_none(), "kept pushing");
    assert!(!k.push_on_close_due(at + 60 * MIN), "pushes on close");
}

#[test]
fn a_backup_reset_to_an_older_commit_stops_pushes_and_is_not_overwritten() {
    let (_t, k, remote) = with_backup();
    let first = pushed_twice(&k, &remote);
    remote.force("main", git2::Oid::from_str(&first).unwrap());
    commit_page(&k, "Written after the reset", 2);

    assert_stopped(&k, &remote, &first);
}

#[test]
fn a_backup_replaced_by_other_history_stops_pushes_and_is_not_overwritten() {
    let (_t, k, remote) = with_backup();
    pushed_twice(&k, &remote);
    let theirs = remote.unrelated_commit();
    remote.force("main", theirs);
    commit_page(&k, "Written after the replacement", 2);

    assert_stopped(&k, &remote, &theirs.to_string());
}

#[test]
fn a_backup_that_is_ahead_is_behind_not_lost() {
    let (_t, k, remote) = with_backup();
    pushed_twice(&k, &remote);
    // Another computer pushed on top of what this one sent.
    let repo = remote.repo();
    let tip = repo
        .find_commit(repo.refname_to_id("refs/heads/main").unwrap())
        .unwrap();
    let sig = git2::Signature::now("Other", "other@example.com").unwrap();
    let next = repo
        .commit(
            None,
            &sig,
            &sig,
            "from another computer",
            &tip.tree().unwrap(),
            &[&tip],
        )
        .unwrap();
    remote.force("main", next);
    commit_page(&k, "Written here meanwhile", 2);

    assert!(k.push(NOW.millis + 10 * MIN).is_err());
    let status = k.backup_status(NOW.millis + 10 * MIN);
    assert!(status.behind);
    assert!(!status.lost_history);
}

#[test]
fn the_full_history_goes_to_a_safety_branch_and_nothing_is_overwritten() {
    let (_t, k, remote) = with_backup();
    pushed_twice(&k, &remote);
    let theirs = remote.unrelated_commit();
    remote.force("main", theirs);
    commit_page(&k, "Written after the replacement", 2);
    let at = NOW.millis + 10 * MIN;
    assert!(k.push(at).is_err());

    let name = k.save_full_history_to_safety_branch(at).unwrap();
    let day = &Instant { millis: at }.rfc3339()[..10];
    assert_eq!(name, format!("kasten/recovered-{day}"));
    assert_eq!(remote.tip(&name), Some(local_head(&k)));
    assert_eq!(
        remote.tip("main").as_deref(),
        Some(theirs.to_string().as_str()),
        "the original branch was touched"
    );
    let status = k.backup_status(at);
    assert_eq!(status.recovered_branch.as_deref(), Some(name.as_str()));
    assert!(status.lost_history, "the branch itself is still different");

    // Doing it again after more work adds to the same branch; still no force.
    commit_page(&k, "Written later", 3);
    let again = k.save_full_history_to_safety_branch(at + MIN).unwrap();
    assert_eq!(again, name);
    assert_eq!(remote.tip(&name), Some(local_head(&k)));
}

#[test]
fn a_branch_name_taken_by_other_history_gets_a_number() {
    let (_t, k, remote) = with_backup();
    pushed_twice(&k, &remote);
    let at = NOW.millis + 10 * MIN;
    let day = &Instant { millis: at }.rfc3339()[..10];
    let taken = remote.unrelated_commit();
    remote.force(&format!("kasten/recovered-{day}"), taken);

    let name = k.save_full_history_to_safety_branch(at).unwrap();
    assert_eq!(name, format!("kasten/recovered-{day}-2"));
    assert_eq!(
        remote.tip(&format!("kasten/recovered-{day}")).as_deref(),
        Some(taken.to_string().as_str())
    );
}

#[test]
fn a_new_backup_address_is_not_a_rewrite() {
    let (t, k, remote) = with_backup();
    pushed_twice(&k, &remote);
    // Another backup that already holds other history.
    let other = Remote(t.vault.root().with_extension("other-backup.git"));
    git2::Repository::init_bare(&other.0).unwrap();
    let theirs = other.unrelated_commit();
    other.force("main", theirs);
    let mut config = k.config();
    config.git.remote = Some(other.url());
    k.set_config(config).unwrap();
    k.confirm_remote(Some(&other.url()));

    // Refused as behind, since that backup has history this one lacks, but
    // nothing was rewritten.
    assert!(k.push(NOW.millis + 10 * MIN).is_err());
    assert!(!k.backup_status(NOW.millis + 10 * MIN).lost_history);
}
