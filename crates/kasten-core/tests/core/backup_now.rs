//! "Back up now" always answers: done, nothing to do, or the reason. And
//! carrying on with a backup that was rewritten, as it is now.

use crate::backup_support::{Remote, commit_page, two_computers, with_backup};
use crate::common::NOW;

use kasten_core::backup::{BackUpNow, NotBackedUp};
use kasten_core::history::BackupState;

const MIN: u64 = 60_000;

fn why(answer: BackUpNow) -> NotBackedUp {
    match answer {
        BackUpNow::Not { reason } => reason,
        other => panic!("expected a reason, got {other:?}"),
    }
}

#[test]
fn done_then_nothing_to_do() {
    let (_t, k, remote) = with_backup();
    let first = k.back_up_now(NOW.millis);
    assert!(
        matches!(first, BackUpNow::Done { sent } if sent >= 1),
        "{first:?}"
    );
    assert!(first.is_ok());
    assert!(remote.tip("main").is_some());

    assert_eq!(k.back_up_now(NOW.millis + MIN), BackUpNow::NothingToDo);
    assert!(BackUpNow::NothingToDo.is_ok());

    // Typing that has not been saved to history yet goes in too.
    commit_page(&k, "A page", 1);
    let again = k.back_up_now(NOW.millis + 2 * MIN);
    assert!(matches!(again, BackUpNow::Done { sent: 1 }), "{again:?}");
    assert_eq!(k.backup_status(NOW.millis + 2 * MIN).unpushed, 0);
}

#[test]
fn every_reason_is_a_typed_answer_with_a_plain_sentence() {
    // No history.
    let t = crate::common::dev_vault();
    let k = kasten_core::Kasten::open(t.vault.root()).unwrap();
    let answer = k.back_up_now(NOW.millis);
    assert_eq!(why(answer.clone()), NotBackedUp::NoHistory);
    assert!(!answer.is_ok());
    assert!(!answer.message().is_empty());

    // No backup set up.
    k.start_history().unwrap();
    assert_eq!(why(k.back_up_now(NOW.millis)), NotBackedUp::NoBackup);

    // A backup the vault names but this computer has not confirmed.
    let remote = Remote(t.vault.root().with_extension("unconfirmed.git"));
    git2::Repository::init_bare(&remote.0).unwrap();
    let mut config = k.config();
    config.git.remote = Some(remote.url());
    k.set_config(config).unwrap();
    assert_eq!(why(k.back_up_now(NOW.millis)), NotBackedUp::NotConfirmed);

    // One that cannot be reached.
    let gone = t.vault.root().with_extension("gone.git");
    let gone_url = gone.to_string_lossy().into_owned();
    let mut config = k.config();
    config.git.remote = Some(gone_url.clone());
    k.set_config(config).unwrap();
    k.confirm_remote(Some(&gone_url));
    let failed = k.back_up_now(NOW.millis);
    assert!(
        matches!(&failed, BackUpNow::Not { reason: NotBackedUp::Failed { message } } if !message.is_empty()),
        "{failed:?}"
    );
    assert!(!failed.message().is_empty());
}

#[test]
fn a_backup_with_newer_changes_says_get_the_latest_first() {
    let two = two_computers();
    commit_page(&two.b, "Written on the laptop", 1);
    two.b.push(NOW.millis + MIN).unwrap();
    commit_page(&two.a, "Written here", 2);

    let answer = two.a.back_up_now(NOW.millis + 2 * MIN);
    assert_eq!(why(answer.clone()), NotBackedUp::Behind);
    assert!(answer.message().to_lowercase().contains("latest"));
}

#[test]
fn a_rewritten_backup_says_so_and_is_not_touched() {
    let (_t, k, remote) = with_backup();
    k.back_up_now(NOW.millis);
    let theirs = remote.unrelated_commit();
    remote.force("main", theirs);
    commit_page(&k, "After the rewrite", 1);

    let answer = k.back_up_now(NOW.millis + MIN);
    assert_eq!(why(answer), NotBackedUp::LostHistory);
    assert_eq!(remote.tip("main"), Some(theirs.to_string()));
}

#[test]
fn the_answer_is_json_for_the_app_and_scripts() {
    let json = serde_json::to_value(BackUpNow::NothingToDo).unwrap();
    assert_eq!(json["answer"], "nothingToDo");
    let json = serde_json::to_value(BackUpNow::Not {
        reason: NotBackedUp::Behind,
    })
    .unwrap();
    assert_eq!(json["answer"], "not");
    assert_eq!(json["reason"]["kind"], "behind");
    let json = serde_json::to_value(BackUpNow::Done { sent: 2 }).unwrap();
    assert_eq!(
        (json["answer"].as_str(), json["sent"].as_u64()),
        (Some("done"), Some(2))
    );
}

/// A vault whose backup was reset to its first commit and has since been
/// stopped for a lost history, after a safety-branch save.
fn reset_and_saved() -> (
    crate::common::TempVault,
    kasten_core::Kasten,
    Remote,
    String,
) {
    let (t, k, remote) = with_backup();
    k.back_up_now(NOW.millis);
    let first = remote.tip("main").unwrap();
    commit_page(&k, "Went to the backup", 1);
    k.back_up_now(NOW.millis + 2 * MIN);
    remote.force("main", git2::Oid::from_str(&first).unwrap());
    commit_page(&k, "After the reset", 3);
    assert_eq!(
        why(k.back_up_now(NOW.millis + 10 * MIN)),
        NotBackedUp::LostHistory
    );
    k.save_full_history_to_safety_branch(NOW.millis + 11 * MIN)
        .unwrap();
    (t, k, remote, first)
}

#[test]
fn carrying_on_takes_the_backup_as_it_is_now_and_pushes_go_on() {
    let (_t, k, remote, first) = reset_and_saved();
    assert!(k.backup_status(NOW.millis + 12 * MIN).lost_history);

    let carried = k.carry_on_with_backup().unwrap();
    assert_eq!(carried.tip.as_deref(), Some(first.as_str()));
    assert!(
        carried.can_push,
        "the reset backup is an older line of ours"
    );
    let status = k.backup_status(NOW.millis + 12 * MIN);
    assert!(!status.lost_history);
    assert!(status.last_error.is_none());
    assert_ne!(status.state, BackupState::Failing);
    // Everything after the reset point is waiting again, nothing is forced.
    assert!(
        status.waiting && status.unpushed >= 2,
        "{}",
        status.unpushed
    );
    assert_eq!(remote.tip("main"), Some(first.clone()));

    let answer = k.back_up_now(NOW.millis + 13 * MIN);
    assert!(answer.is_ok(), "{answer:?}");
    assert_eq!(
        remote.tip("main"),
        Some(k.log(None, 1).unwrap()[0].id.clone()),
        "a plain push, on top of what the backup held"
    );
    assert!(!k.backup_status(NOW.millis + 14 * MIN).waiting);
}

#[test]
fn carrying_on_with_other_history_forces_nothing_and_says_get_the_latest() {
    let (_t, k, remote) = with_backup();
    k.back_up_now(NOW.millis);
    commit_page(&k, "Went to the backup", 1);
    k.back_up_now(NOW.millis + 2 * MIN);
    let theirs = remote.unrelated_commit();
    remote.force("main", theirs);
    commit_page(&k, "After the replacement", 3);
    assert_eq!(
        why(k.back_up_now(NOW.millis + 10 * MIN)),
        NotBackedUp::LostHistory
    );

    let carried = k.carry_on_with_backup().unwrap();
    assert_eq!(carried.tip, Some(theirs.to_string()));
    assert!(!carried.can_push, "no shared history to push on top of");
    assert!(!k.backup_status(NOW.millis + 11 * MIN).lost_history);

    // The next try is refused as behind, never forced, and says why.
    assert_eq!(
        why(k.back_up_now(NOW.millis + 12 * MIN)),
        NotBackedUp::Behind
    );
    assert_eq!(remote.tip("main"), Some(theirs.to_string()));
}

#[test]
fn carrying_on_when_nothing_stopped_is_refused() {
    let (_t, k, _remote) = with_backup();
    k.back_up_now(NOW.millis);
    let err = k.carry_on_with_backup().unwrap_err();
    assert!(err.to_string().contains("stopped"), "{err}");
}
