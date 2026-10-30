//! Telling the person early: a backup that has failed for 6 hours, or a push
//! that was refused three times. The clock is the one the tests pass in.

use crate::backup_support::{Folder, commit_page, two_computers, with_backup};
use crate::common::NOW;

use kasten_core::backup::BackupNotice;
use kasten_core::history::BackupState;

const MIN: u64 = 60_000;
const HOUR: u64 = 60 * MIN;

#[test]
fn six_hours_of_failing_is_told_and_not_before() {
    let (_t, k, remote) = with_backup();
    // The backup cannot be reached: its folder is not there.
    let gone = Folder(remote.0.with_extension("away"));
    std::fs::rename(&remote.0, &gone.0).unwrap();

    // The first try fails; later ones come on the schedule.
    assert!(k.push(NOW.millis).is_err());
    assert!(k.push(NOW.millis + 2 * MIN).is_err());
    assert!(k.push(NOW.millis + 6 * MIN).is_err());
    // Three failures in a row used to turn the dot red; now it takes hours.
    let early = k.backup_status(NOW.millis + 7 * MIN);
    assert_eq!(early.failures, 3);
    assert_ne!(early.state, BackupState::Failing);
    assert_eq!(early.notice, None);

    assert!(k.push(NOW.millis + 5 * HOUR).is_err());
    let at_5h59 = k.backup_status(NOW.millis + 6 * HOUR - 1);
    assert_eq!(at_5h59.notice, None);
    assert_ne!(at_5h59.state, BackupState::Failing);

    let at_6h = k.backup_status(NOW.millis + 6 * HOUR);
    assert_eq!(
        at_6h.notice,
        Some(BackupNotice::Failing { since: NOW.millis })
    );
    assert_eq!(at_6h.state, BackupState::Failing);
    assert_eq!(k.backup_notice(NOW.millis + 6 * HOUR), at_6h.notice);

    // A push that works ends it.
    std::fs::rename(&gone.0, &remote.0).unwrap();
    k.push(NOW.millis + 7 * HOUR).unwrap();
    let healed = k.backup_status(NOW.millis + 7 * HOUR);
    assert_eq!(healed.notice, None);
    assert_eq!(healed.state, BackupState::Ok);
    // A new run of failures counts from its own start.
    commit_page(&k, "After the outage", 1);
    std::fs::rename(&remote.0, &gone.0).unwrap();
    assert!(k.push(NOW.millis + 8 * HOUR).is_err());
    assert_eq!(k.backup_notice(NOW.millis + 9 * HOUR), None);
    assert_eq!(
        k.backup_notice(NOW.millis + 14 * HOUR),
        Some(BackupNotice::Failing {
            since: NOW.millis + 8 * HOUR
        })
    );
    std::fs::rename(&gone.0, &remote.0).unwrap();
}

#[test]
fn a_push_refused_three_times_is_told() {
    let two = two_computers();
    commit_page(&two.b, "Written on the laptop", 1);
    two.b.push(NOW.millis + MIN).unwrap();
    commit_page(&two.a, "Written here", 2);

    let status = |at| two.a.backup_status(at);
    assert!(two.a.push(NOW.millis + 2 * MIN).is_err());
    assert!(two.a.push(NOW.millis + 3 * MIN).is_err());
    assert_eq!(status(NOW.millis + 3 * MIN).notice, None);
    assert!(two.a.push(NOW.millis + 4 * MIN).is_err());
    let told = status(NOW.millis + 4 * MIN);
    assert_eq!(told.notice, Some(BackupNotice::Refused { times: 3 }));
    assert!(told.behind);

    // Getting the latest settles it: the next push is not a refusal.
    two.a
        .get_latest(kasten_core::Instant {
            millis: NOW.millis + 5 * MIN,
        })
        .unwrap();
    assert_eq!(status(NOW.millis + 5 * MIN).notice, None);
    two.a.push(NOW.millis + 6 * MIN).unwrap();
    assert_eq!(status(NOW.millis + 6 * MIN).notice, None);
}
