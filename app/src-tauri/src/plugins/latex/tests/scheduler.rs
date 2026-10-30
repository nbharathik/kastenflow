//! Who builds when: the latest request wins, a build that has only just
//! started is replaced and one that has run a while is not, and two builds
//! run at once at most. The clock is a number the test passes in.

use crate::plugins::latex::scheduler::{Action, GLOBAL_CAP, RESTART_WITHIN_MS, Scheduler};

type S = Scheduler<&'static str>;

fn start(doc: &str, seq: u64, job: &'static str) -> Action<&'static str> {
    Action::Start {
        doc: doc.to_owned(),
        seq,
        job,
    }
}

fn kill(doc: &str, seq: u64) -> Action<&'static str> {
    Action::Kill {
        doc: doc.to_owned(),
        seq,
    }
}

fn drop_(doc: &str, seq: u64) -> Action<&'static str> {
    Action::Drop {
        doc: doc.to_owned(),
        seq,
    }
}

#[test]
fn the_first_request_starts_at_once() {
    let mut s = S::new(GLOBAL_CAP);
    let (seq, actions) = s.submit("a", "one", 0);
    assert_eq!(seq, 1);
    assert_eq!(actions, [start("a", 1, "one")]);
    assert_eq!(s.running(), 1);
}

#[test]
fn the_latest_waiting_request_wins() {
    let mut s = S::new(GLOBAL_CAP);
    s.submit("a", "one", 0);
    // The first build has run for a while: the new ones wait.
    let (two, actions) = s.submit("a", "two", 1_000);
    assert_eq!((two, actions), (2, vec![]));
    let (three, actions) = s.submit("a", "three", 1_100);
    assert_eq!((three, actions), (3, vec![drop_("a", 2)]));
    let (four, actions) = s.submit("a", "four", 1_200);
    assert_eq!((four, actions), (4, vec![drop_("a", 3)]));
    // When the first ends, only the latest runs.
    assert_eq!(s.finished("a", 1, 1_300), [start("a", 4, "four")]);
    assert!(s.finished("a", 4, 1_400).is_empty());
    assert_eq!(s.running(), 0);
}

#[test]
fn a_build_that_just_started_is_stopped_and_replaced() {
    let mut s = S::new(GLOBAL_CAP);
    s.submit("a", "one", 1_000);
    let (seq, actions) = s.submit("a", "two", 1_000 + RESTART_WITHIN_MS - 1);
    assert_eq!((seq, actions), (2, vec![kill("a", 1)]));
    // A third request before the killed build is gone does not stop it twice.
    let (_, actions) = s.submit("a", "three", 1_000 + RESTART_WITHIN_MS);
    assert_eq!(actions, [drop_("a", 2)]);
    // The killed build ends; the latest request runs.
    assert_eq!(s.finished("a", 1, 1_400), [start("a", 3, "three")]);
}

#[test]
fn a_build_that_has_run_300_ms_finishes_first() {
    let mut s = S::new(GLOBAL_CAP);
    s.submit("a", "one", 5_000);
    let (_, actions) = s.submit("a", "two", 5_000 + RESTART_WITHIN_MS);
    assert!(
        actions.is_empty(),
        "exactly 300 ms is long enough: {actions:?}"
    );
    assert_eq!(s.finished("a", 1, 5_400), [start("a", 2, "two")]);
}

#[test]
fn the_clock_going_backwards_does_not_stop_a_build_forever() {
    let mut s = S::new(GLOBAL_CAP);
    s.submit("a", "one", 10_000);
    // A saturating difference: an earlier time counts as "just started", once.
    let (_, first) = s.submit("a", "two", 9_000);
    let (_, second) = s.submit("a", "three", 9_000);
    assert_eq!(first, [kill("a", 1)]);
    assert_eq!(second, [drop_("a", 2)]);
}

#[test]
fn two_builds_run_at_once_at_most() {
    let mut s = S::new(GLOBAL_CAP);
    assert_eq!(s.submit("a", "a1", 0).1, [start("a", 1, "a1")]);
    assert_eq!(s.submit("b", "b1", 0).1, [start("b", 2, "b1")]);
    assert!(s.submit("c", "c1", 0).1.is_empty());
    assert!(s.submit("d", "d1", 0).1.is_empty());
    assert_eq!(s.running(), 2);
    // Places go in the order the documents asked.
    assert_eq!(s.finished("a", 1, 500), [start("c", 3, "c1")]);
    assert_eq!(s.finished("b", 2, 600), [start("d", 4, "d1")]);
    assert_eq!(s.running(), 2);
    assert!(s.finished("c", 3, 700).is_empty());
    assert!(s.finished("d", 4, 800).is_empty());
    assert_eq!(s.running(), 0);
}

#[test]
fn a_document_waiting_for_a_place_keeps_only_its_latest_request() {
    let mut s = S::new(GLOBAL_CAP);
    s.submit("a", "a1", 0);
    s.submit("b", "b1", 0);
    assert!(s.submit("c", "c1", 0).1.is_empty());
    let (_, actions) = s.submit("c", "c2", 10);
    assert_eq!(actions, [drop_("c", 3)]);
    assert_eq!(s.finished("a", 1, 500), [start("c", 4, "c2")]);
}

#[test]
fn a_document_that_finishes_and_asks_again_goes_to_the_back_of_the_line() {
    let mut s = S::new(GLOBAL_CAP);
    s.submit("a", "a1", 0);
    s.submit("b", "b1", 0);
    s.submit("c", "c1", 0);
    // a has a second request waiting while c waits for a place.
    s.submit("a", "a2", 1_000);
    assert_eq!(s.finished("a", 1, 1_100), [start("c", 3, "c1")]);
    assert_eq!(s.finished("b", 2, 1_200), [start("a", 4, "a2")]);
}

#[test]
fn cancel_stops_the_running_build_and_drops_the_waiting_one() {
    let mut s = S::new(GLOBAL_CAP);
    s.submit("a", "a1", 0);
    s.submit("a", "a2", 1_000);
    let actions = s.cancel("a");
    assert_eq!(actions, [drop_("a", 2), kill("a", 1)]);
    // Cancelling again asks for nothing more, and nothing starts after the end.
    assert!(s.cancel("a").is_empty());
    assert!(s.finished("a", 1, 1_100).is_empty());
    assert_eq!(s.running(), 0);
}

#[test]
fn cancel_of_a_document_that_waits_for_a_place_means_it_never_starts() {
    let mut s = S::new(GLOBAL_CAP);
    s.submit("a", "a1", 0);
    s.submit("b", "b1", 0);
    s.submit("c", "c1", 0);
    assert_eq!(s.cancel("c"), [drop_("c", 3)]);
    assert!(s.finished("a", 1, 500).is_empty());
    assert_eq!(s.running(), 1);
}

#[test]
fn cancel_of_an_unknown_document_does_nothing() {
    let mut s = S::new(GLOBAL_CAP);
    assert!(s.cancel("nobody").is_empty());
}

#[test]
fn a_late_or_wrong_finish_changes_nothing() {
    let mut s = S::new(GLOBAL_CAP);
    s.submit("a", "a1", 0);
    assert!(s.finished("a", 99, 10).is_empty());
    assert!(s.finished("zzz", 1, 10).is_empty());
    assert_eq!(s.running(), 1);
    assert!(s.finished("a", 1, 20).is_empty());
    assert!(s.finished("a", 1, 30).is_empty());
    assert_eq!(s.running(), 0);
}

#[test]
fn numbers_only_go_up_and_documents_do_not_disturb_each_other() {
    let mut s = S::new(GLOBAL_CAP);
    let (a, _) = s.submit("a", "a1", 0);
    let (b, _) = s.submit("b", "b1", 0);
    let (a2, actions) = s.submit("a", "a2", 10);
    assert!(a < b && b < a2);
    // b is untouched by a's restart.
    assert_eq!(actions, [kill("a", a)]);
    assert_eq!(s.running(), 2);
}

#[test]
fn an_idle_scheduler_remembers_no_document() {
    let mut s = S::new(GLOBAL_CAP);
    for i in 0..100 {
        let name = format!("doc{i}");
        let (seq, _) = s.submit(&name, "job", 0);
        s.finished(&name, seq, 10);
    }
    assert_eq!(s.running(), 0);
    // A cap of zero is a cap of one: something always can run.
    let mut one = S::new(0);
    assert_eq!(one.submit("a", "x", 0).1.len(), 1);
}
