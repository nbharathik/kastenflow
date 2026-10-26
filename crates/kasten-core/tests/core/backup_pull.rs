//! Getting the latest by itself: a fast-forward is taken when nothing here is
//! waiting and no open page has unsaved edits; a merge is never done without
//! asking. How often the backup is looked at, and how many changes came in.

use crate::backup_support::{
    Two, commit_page, commits_in, head_of, two_computers, two_computers_with,
};
use crate::common::NOW;

use std::fs;

use kasten_core::backup::{AutoPull, BackupConfig, GetLatest, Held};
use kasten_core::history::Actor;
use kasten_core::{Instant, Kasten, LatestOutcome};

const MIN: u64 = 60_000;
const NOTE: &str = "library/zettelkasten-method.md";

fn at(minutes: u64) -> Instant {
    Instant {
        millis: NOW.millis + minutes * MIN,
    }
}

fn mode(mode: GetLatest) -> impl FnOnce(&mut kasten_core::Config) {
    move |config| {
        config.backup = Some(BackupConfig {
            get_latest: Some(mode),
            ..BackupConfig::default()
        });
    }
}

/// The other computer wrote a page and backed it up.
fn laptop_writes(two: &Two) -> String {
    commit_page(&two.b, "Written on the laptop", 1);
    two.b.push(at(1).millis).unwrap();
    head_of(&two.b)
}

/// Nothing was brought in and nothing changed here.
fn assert_left_alone(two: &Two, before: &str) {
    assert_eq!(head_of(&two.a), before, "the branch moved");
    assert!(two.a.search("laptop", 10).unwrap().is_empty());
}

#[test]
fn a_fast_forward_is_taken_by_itself_when_nothing_waits_here() {
    let two = two_computers();
    let theirs = laptop_writes(&two);
    let commits_before = commits_in(&two.a);
    assert!(two.a.can_auto_pull(false));

    let AutoPull::Brought {
        changes,
        files,
        head,
    } = two.a.auto_pull(at(2), false).unwrap()
    else {
        panic!("not brought in");
    };
    assert_eq!(head, theirs);
    assert_eq!(head_of(&two.a), theirs);
    assert_eq!(changes, commits_in(&two.a) - commits_before);
    assert!(
        changes >= 1 && files >= 1,
        "{changes} changes, {files} files"
    );
    assert!(!two.a.log(None, 1).unwrap()[0].merge, "a merge was made");
    assert!(!two.a.search("laptop", 10).unwrap().is_empty());
    // Nothing is waiting afterwards: the count goes against the backup.
    assert!(!two.a.backup_status(at(2).millis).waiting);
    // And the next look finds nothing new.
    assert_eq!(two.a.auto_pull(at(3), false).unwrap(), AutoPull::UpToDate);
}

#[test]
fn never_with_unsaved_edits_in_an_open_page() {
    let two = two_computers();
    laptop_writes(&two);
    let before = head_of(&two.a);
    assert!(!two.a.can_auto_pull(true));

    assert_eq!(
        two.a.auto_pull(at(2), true).unwrap(),
        AutoPull::Held {
            why: Held::UnsavedEdits
        }
    );
    assert_left_alone(&two, &before);
    // Once the page is saved, the same look brings it in.
    assert!(matches!(
        two.a.auto_pull(at(3), false).unwrap(),
        AutoPull::Brought { .. }
    ));
}

#[test]
fn never_with_a_change_waiting_to_be_backed_up() {
    // A commit the backup lacks.
    let two = two_computers();
    laptop_writes(&two);
    commit_page(&two.a, "Written here, not backed up", 5);
    let before = head_of(&two.a);
    assert!(!two.a.can_auto_pull(false));
    assert_eq!(
        two.a.auto_pull(at(2), false).unwrap(),
        AutoPull::Held {
            why: Held::WaitingHere
        }
    );
    assert_left_alone(&two, &before);

    // Typing that is not committed yet.
    let two = two_computers();
    laptop_writes(&two);
    let note = two.a.read(NOTE).unwrap();
    let body = format!(
        "{}\nTyped just now.\n",
        kasten_core::frontmatter::split(&note.text).body
    );
    two.a
        .save_body(&Actor::Human, NOTE, &body, &note.hash, NOW)
        .unwrap();
    let before = head_of(&two.a);
    assert!(!two.a.can_auto_pull(false));
    assert_eq!(
        two.a.auto_pull(at(2), false).unwrap(),
        AutoPull::Held {
            why: Held::WaitingHere
        }
    );
    assert_left_alone(&two, &before);

    // A file changed outside the app and not committed yet.
    let two = two_computers();
    laptop_writes(&two);
    fs::write(two.a.root().join("inbox/from-outside.md"), "# Outside\n").unwrap();
    let before = head_of(&two.a);
    assert_eq!(
        two.a.auto_pull(at(2), false).unwrap(),
        AutoPull::Held {
            why: Held::WaitingHere
        }
    );
    assert_left_alone(&two, &before);
    assert!(two.a.root().join("inbox/from-outside.md").is_file());
}

#[test]
fn never_a_merge_without_asking() {
    let two = two_computers();
    laptop_writes(&two);
    commit_page(&two.a, "Written here meanwhile", 5);
    let before = head_of(&two.a);

    // The look that needs no merge declines, and changes nothing.
    assert!(two.a.get_latest_without_merge(at(2)).unwrap().is_none());
    assert_left_alone(&two, &before);
    assert_eq!(
        two.a.auto_pull(at(2), false).unwrap(),
        AutoPull::Held {
            why: Held::WaitingHere
        }
    );
    assert_left_alone(&two, &before);

    // Asked for by hand, the two lines are joined.
    let latest = two.a.get_latest(at(3)).unwrap();
    assert_eq!(latest.outcome, LatestOutcome::Merged);
}

#[test]
fn a_fast_forward_needs_no_merge_for_the_quiet_look_either() {
    let two = two_computers();
    let theirs = laptop_writes(&two);
    let latest = two.a.get_latest_without_merge(at(2)).unwrap().unwrap();
    assert_eq!(latest.outcome, LatestOutcome::FastForward);
    assert_eq!(head_of(&two.a), theirs);
}

#[test]
fn ask_and_manual_never_pull_by_themselves() {
    let two = two_computers_with(mode(GetLatest::Ask));
    laptop_writes(&two);
    let before = head_of(&two.a);
    assert_eq!(
        two.a.auto_pull(at(2), false).unwrap(),
        AutoPull::Available { merge: false }
    );
    assert_left_alone(&two, &before);
    // Asking then does it.
    assert_eq!(
        two.a.get_latest(at(3)).unwrap().outcome,
        LatestOutcome::FastForward
    );

    let two = two_computers_with(mode(GetLatest::Manual));
    laptop_writes(&two);
    let before = head_of(&two.a);
    assert_eq!(
        two.a.auto_pull(at(2), false).unwrap(),
        AutoPull::Held { why: Held::Manual }
    );
    assert!(!two.a.fetch_due(at(60).millis), "manual never checks");
    assert_left_alone(&two, &before);
}

#[test]
fn the_backup_is_looked_at_on_open_and_every_interval() {
    let two = two_computers();
    assert!(two.a.fetch_due(at(0).millis), "on open");
    assert_eq!(two.a.auto_pull(at(0), false).unwrap(), AutoPull::UpToDate);
    assert!(!two.a.fetch_due(at(14).millis));
    assert!(two.a.fetch_due(at(15).millis));

    // A look that was held back does not count: try again at once.
    let two = two_computers();
    let _ = two.a.auto_pull(at(0), true).unwrap();
    assert!(two.a.fetch_due(at(1).millis));

    // 0 turns it off; a number sets the minutes.
    let off = two_computers_with(|c| {
        c.backup = Some(BackupConfig {
            fetch_interval: Some(0),
            ..BackupConfig::default()
        });
    });
    assert!(!off.a.fetch_due(at(600).millis));
    let slow = two_computers_with(|c| {
        c.backup = Some(BackupConfig {
            fetch_interval: Some(30),
            ..BackupConfig::default()
        });
    });
    slow.a.auto_pull(at(0), false).unwrap();
    assert!(!slow.a.fetch_due(at(29).millis));
    assert!(slow.a.fetch_due(at(30).millis));
}

#[test]
fn waiting_is_counted_against_the_backup_after_getting_the_latest() {
    let two = two_computers();
    commit_page(&two.b, "First from the laptop", 1);
    commit_page(&two.b, "Second from the laptop", 2);
    two.b.push(at(1).millis).unwrap();

    two.a.get_latest(at(2)).unwrap();
    let status = two.a.backup_status(at(2).millis);
    assert_eq!(
        status.unpushed, 0,
        "what came from the backup is not waiting"
    );
    assert!(!status.waiting);

    // A change made here afterwards is the only one waiting.
    commit_page(&two.a, "Written here after", 9);
    let status = two.a.backup_status(at(3).millis);
    assert_eq!(status.unpushed, 1);
    assert!(status.waiting);
    two.a.push(at(3).millis).unwrap();
    assert_eq!(two.a.backup_status(at(4).millis).unpushed, 0);
}

#[test]
fn an_unfinished_get_latest_or_a_stopped_backup_holds_the_look_back() {
    let two = two_computers();
    laptop_writes(&two);
    let k: &Kasten = &two.a;
    k.stop_get_latest_before_the_branch_moves();
    assert!(k.get_latest(at(2)).is_err());
    assert!(k.unfinished_get_latest());
    assert!(!k.can_auto_pull(false));
    assert!(matches!(
        k.auto_pull(at(3), false).unwrap(),
        AutoPull::Held {
            why: Held::Unfinished
        }
    ));
}
