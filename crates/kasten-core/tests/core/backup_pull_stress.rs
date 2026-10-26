//! Getting the latest by itself, under stress: a backup that was rewritten,
//! a Get latest that stopped part way, an address that holds other branches.
//! Nothing may be merged, forced or lost.

use crate::backup_support::{Remote, Two, commit_page, head_of, two_computers, with_backup};
use crate::common::NOW;

use kasten_core::backup::{AutoPull, BackUpNow, GetLatest, Held, LinkResult};
use kasten_core::{Instant, LatestOutcome};

const MIN: u64 = 60_000;

fn at(minutes: u64) -> Instant {
    Instant {
        millis: NOW.millis + minutes * MIN,
    }
}

/// The computer `a` has backed up two commits; the backup is then rewritten
/// to a different line that branches off after the first of them. Nothing
/// is waiting on `a`.
fn related_but_diverged() -> (Two, String) {
    let two = two_computers();
    commit_page(&two.a, "Second line", 1);
    two.a.push(at(1).millis).unwrap();
    let repo = two._remote.repo();
    let tip = repo
        .find_commit(git2::Oid::from_str(&two._remote.tip("main").unwrap()).unwrap())
        .unwrap();
    let base = tip.parent(0).unwrap();
    let sig = git2::Signature::now("Someone", "someone@example.com").unwrap();
    let other = repo
        .commit(
            None,
            &sig,
            &sig,
            "another line",
            &base.tree().unwrap(),
            &[&base],
        )
        .unwrap();
    drop((tip, base));
    two._remote.force("main", other);
    (two, other.to_string())
}

#[test]
fn a_diverged_backup_is_never_merged_by_itself() {
    let (two, _other) = related_but_diverged();
    let before = head_of(&two.a);
    assert!(two.a.can_auto_pull(false), "nothing is waiting here");
    assert_eq!(
        two.a.auto_pull(at(2), false).unwrap(),
        AutoPull::Available { merge: true }
    );
    assert_eq!(head_of(&two.a), before, "the branch moved");
    assert!(!two.a.log(None, 1).unwrap()[0].merge);
    assert!(
        two.a.get_latest_without_merge(at(3)).unwrap().is_none(),
        "the quiet look declines too"
    );
    assert_eq!(head_of(&two.a), before);
    // Asked for by hand, the person gets the join.
    assert_eq!(
        two.a.get_latest(at(4)).unwrap().outcome,
        LatestOutcome::Merged
    );
}

#[test]
fn a_backup_that_shares_nothing_is_held_and_left_alone() {
    let two = two_computers();
    let other = two._remote.unrelated_commit();
    two._remote.force("main", other);
    let before = head_of(&two.a);
    assert_eq!(
        two.a.auto_pull(at(2), false).unwrap(),
        AutoPull::Held {
            why: Held::Unrelated
        }
    );
    assert_eq!(head_of(&two.a), before);
    assert_eq!(two._remote.tip("main"), Some(other.to_string()));
}

#[test]
fn a_stopped_backup_takes_no_look_and_nothing_is_written() {
    let two = two_computers();
    commit_page(&two.a, "Went to the backup", 1);
    two.a.back_up_now(at(1).millis);
    let other = two._remote.unrelated_commit();
    two._remote.force("main", other);
    commit_page(&two.a, "After the rewrite", 2);
    assert!(matches!(
        two.a.back_up_now(at(2).millis),
        BackUpNow::Not { .. }
    ));
    let before = head_of(&two.a);
    assert!(two.a.backup_status(at(3).millis).lost_history);
    assert!(!two.a.can_auto_pull(false));
    assert!(!two.a.fetch_due(at(60).millis));
    assert_eq!(
        two.a.auto_pull(at(3), false).unwrap(),
        AutoPull::Held {
            why: Held::LostHistory
        }
    );
    assert_eq!(head_of(&two.a), before);
    assert_eq!(two._remote.tip("main"), Some(other.to_string()));
}

#[test]
fn an_automatic_pull_that_stopped_part_way_is_finished_not_repeated() {
    let two = two_computers();
    commit_page(&two.b, "Written on the laptop", 1);
    two.b.push(at(1).millis).unwrap();
    let theirs = head_of(&two.b);
    let before = head_of(&two.a);

    two.a.stop_get_latest_before_the_branch_moves();
    assert!(two.a.auto_pull(at(2), false).is_err());
    assert!(two.a.unfinished_get_latest());
    assert_eq!(head_of(&two.a), before, "the branch has not moved yet");
    // A second look does not start another: it waits to be finished.
    assert_eq!(
        two.a.auto_pull(at(3), false).unwrap(),
        AutoPull::Held {
            why: Held::Unfinished
        }
    );
    let done = two.a.finish_get_latest(at(4)).unwrap().unwrap();
    assert_eq!(done.outcome, LatestOutcome::FastForward);
    assert_eq!(head_of(&two.a), theirs);
    assert!(!two.a.unfinished_get_latest());
    assert!(!two.a.backup_status(at(5).millis).waiting);
}

#[test]
fn a_look_with_the_backup_gone_is_an_error_and_changes_nothing() {
    let two = two_computers();
    let before = head_of(&two.a);
    let away = two._remote.0.with_extension("away");
    std::fs::rename(&two._remote.0, &away).unwrap();
    let result = two.a.auto_pull(at(2), false);
    std::fs::rename(&away, &two._remote.0).unwrap();
    assert!(result.is_err());
    assert_eq!(head_of(&two.a), before);
    // The failed look does not count as made: it is tried again at once.
    assert!(two.a.fetch_due(at(3).millis));
}

#[test]
fn a_huge_interval_does_not_overflow() {
    let two = two_computers_with_interval(u64::MAX);
    assert!(two.a.fetch_due(at(0).millis));
    two.a.auto_pull(at(0), false).unwrap();
    assert!(!two.a.fetch_due(u64::MAX - 1));
}

fn two_computers_with_interval(minutes: u64) -> Two {
    crate::backup_support::two_computers_with(|config| {
        config.backup = Some(kasten_core::backup::BackupConfig {
            fetch_interval: Some(minutes),
            get_latest: Some(GetLatest::Auto),
            ..Default::default()
        });
    })
}

#[test]
fn an_address_holding_only_other_branches_is_linked_and_those_are_not_touched() {
    let (t, k, _first) = with_backup();
    let remote = Remote(t.vault.root().with_extension("branches.git"));
    git2::Repository::init_bare(&remote.0).unwrap();
    let theirs = remote.unrelated_commit();
    remote.force("elsewhere", theirs);

    let linked = k.link_existing_backup(&remote.url()).unwrap();
    assert_eq!(
        linked,
        LinkResult::Linked {
            empty: true,
            behind: false
        }
    );
    assert!(k.back_up_now(at(1).millis).is_ok());
    assert!(remote.tip("main").is_some());
    assert_eq!(remote.tip("elsewhere"), Some(theirs.to_string()));
}

#[test]
fn linking_is_refused_while_the_other_branch_is_unrelated_even_with_waiting_changes() {
    let (t, k, first) = with_backup();
    commit_page(&k, "Waiting", 1);
    let theirs = Remote(t.vault.root().with_extension("unrelated2.git"));
    git2::Repository::init_bare(&theirs.0).unwrap();
    let other = theirs.unrelated_commit();
    theirs.force("main", other);
    assert!(matches!(
        k.link_existing_backup(&theirs.url()).unwrap(),
        LinkResult::Refused { .. }
    ));
    assert_eq!(k.config().git.remote, Some(first.url()));
    assert_eq!(theirs.tip("main"), Some(other.to_string()));
}

#[test]
fn carrying_on_needs_a_confirmed_backup() {
    let (_t, k, _remote) = with_backup();
    k.confirm_remote(None);
    assert!(k.carry_on_with_backup().is_err());
}
