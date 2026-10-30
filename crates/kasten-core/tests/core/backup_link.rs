//! Linking a vault to a backup that already exists: used at once when it is
//! empty, joined by Get latest when the two share history, and refused with
//! three ways forward when they do not.

use crate::backup_support::{Remote, commit_page, two_computers, with_backup};
use crate::common::NOW;

use kasten_core::backup::{BackUpNow, LinkChoice, LinkResult, NotBackedUp};
use std::path::Path;

use kasten_core::history::History;
use kasten_core::{Instant, Kasten, LatestOutcome};

const MIN: u64 = 60_000;

/// A bare repository beside the test's vault (named from its plain path: the
/// engine's own path for it is a verbatim one on Windows, which a remote
/// refuses as a network share).
fn bare(vault: &Path, name: &str) -> Remote {
    let remote = Remote(vault.with_extension(name));
    git2::Repository::init_bare(&remote.0).unwrap();
    remote
}

fn history_of(k: &Kasten) -> History {
    History::open(k.root()).unwrap().unwrap()
}

#[test]
fn an_empty_backup_is_used_at_once() {
    let (t, k, _first) = with_backup();
    let empty = bare(t.vault.root(), "empty-backup.git");

    let linked = k.link_existing_backup(&empty.url()).unwrap();
    assert_eq!(
        linked,
        LinkResult::Linked {
            empty: true,
            behind: false
        }
    );
    assert_eq!(k.config().git.remote, Some(empty.url()));
    // It is confirmed too: the person chose it.
    let answer = k.back_up_now(NOW.millis + MIN);
    assert!(matches!(answer, BackUpNow::Done { .. }), "{answer:?}");
    assert!(empty.tip("main").is_some());
}

#[test]
fn a_backup_with_shared_history_is_linked_and_get_latest_joins_it() {
    let two = two_computers();
    // Another backup that holds this vault's line of history, with a page
    // the laptop added on top.
    let other = bare(two._t.vault.root(), "related-backup.git");
    commit_page(&two.b, "On the laptop", 1);
    history_of(&two.b).push_as(&other.url(), None).unwrap();

    let linked = two.a.link_existing_backup(&other.url()).unwrap();
    assert_eq!(
        linked,
        LinkResult::Linked {
            empty: false,
            behind: true
        }
    );
    assert_eq!(two.a.config().git.remote, Some(other.url()));
    let latest = two
        .a
        .get_latest(Instant {
            millis: NOW.millis + MIN,
        })
        .unwrap();
    // The new address in the vault's settings is a change here, so the two
    // lines of history are joined.
    assert_ne!(latest.outcome, LatestOutcome::UpToDate);
    assert!(!two.a.search("laptop", 10).unwrap().is_empty());
}

#[test]
fn a_backup_that_is_behind_this_vault_is_linked_and_takes_a_push() {
    let two = two_computers();
    let other = bare(two._t.vault.root(), "behind-backup.git");
    history_of(&two.a).push_as(&other.url(), None).unwrap();
    commit_page(&two.a, "Only here", 1);

    let linked = two.a.link_existing_backup(&other.url()).unwrap();
    assert_eq!(
        linked,
        LinkResult::Linked {
            empty: false,
            behind: false
        }
    );
    let answer = two.a.back_up_now(NOW.millis + MIN);
    assert!(answer.is_ok(), "{answer:?}");
}

#[test]
fn an_unrelated_backup_is_refused_with_three_ways_forward() {
    let (t, k, first) = with_backup();
    let theirs = bare(t.vault.root(), "unrelated-backup.git");
    let other = theirs.unrelated_commit();
    theirs.force("main", other);

    let refused = k.link_existing_backup(&theirs.url()).unwrap();
    assert_eq!(
        refused,
        LinkResult::Refused {
            choices: vec![
                LinkChoice::PickAnother,
                LinkChoice::CreateNew,
                LinkChoice::RestoreIntoNewFolder
            ]
        }
    );
    // Nothing changed: the old backup is still the one, theirs untouched.
    assert_eq!(k.config().git.remote, Some(first.url()));
    assert_eq!(theirs.tip("main"), Some(other.to_string()));
    let json = serde_json::to_value(&refused).unwrap();
    assert_eq!(json["result"], "refused");
    assert_eq!(json["choices"][2], "restoreIntoNewFolder");
}

#[test]
fn a_bad_or_unreachable_address_is_an_error_and_changes_nothing() {
    let (t, k, first) = with_backup();
    assert!(k.link_existing_backup("ext::sh -c evil").is_err());
    let gone = t.vault.root().with_extension("not-there.git");
    assert!(k.link_existing_backup(&gone.to_string_lossy()).is_err());
    assert_eq!(k.config().git.remote, Some(first.url()));
}

#[test]
fn linking_a_new_backup_ends_the_stop_for_the_old_one() {
    let (t, k, remote) = with_backup();
    k.back_up_now(NOW.millis);
    remote.force("main", remote.unrelated_commit());
    commit_page(&k, "After the rewrite", 1);
    assert_eq!(
        k.back_up_now(NOW.millis + MIN),
        BackUpNow::Not {
            reason: NotBackedUp::LostHistory
        }
    );

    let fresh = bare(t.vault.root(), "fresh-backup.git");
    k.link_existing_backup(&fresh.url()).unwrap();
    let status = k.backup_status(NOW.millis + 2 * MIN);
    assert!(!status.lost_history && status.last_error.is_none());
    assert_eq!(status.verified_at, None);
    assert!(k.back_up_now(NOW.millis + 3 * MIN).is_ok());
    assert!(fresh.tip("main").is_some());
}
