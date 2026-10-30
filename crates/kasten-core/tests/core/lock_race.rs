//! `health()` only looks: it never removes a git lock file. A lock taken
//! while Kasten itself writes (the vault's write lock held, its mark in
//! place) is not stale, and only an op that holds the write lock may clear
//! the ones a killed process left.

use crate::common;

use std::fs;
use std::sync::mpsc;
use std::thread;

use common::{NOW, dev_vault};
use kasten_core::history::Actor;
use kasten_core::{Kasten, WriteLock};

const MARK: &str = ".kasten/cache/git-writing";

fn open() -> (common::TempVault, Kasten) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k)
}

#[test]
fn health_never_removes_the_lock_of_a_writer_at_work() {
    let (t, k) = open();
    let root = t.vault.root().to_owned();
    let (ready_tx, ready_rx) = mpsc::channel::<()>();
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let writer = thread::spawn({
        let root = root.clone();
        move || {
            WriteLock::new(&root)
                .hold(|| {
                    // What a commit does: the mark first, then git's lock.
                    fs::create_dir_all(root.join(".kasten/cache")).unwrap();
                    fs::write(root.join(MARK), "").unwrap();
                    fs::write(root.join(".git/index.lock"), "").unwrap();
                    ready_tx.send(()).unwrap();
                    stop_rx.recv().unwrap();
                    fs::remove_file(root.join(".git/index.lock")).unwrap();
                    fs::remove_file(root.join(MARK)).unwrap();
                    Ok(())
                })
                .unwrap();
        }
    });
    ready_rx.recv().unwrap();
    for round in 0..1000 {
        let health = k.health(NOW.millis);
        assert!(
            root.join(".git/index.lock").exists(),
            "health removed the writer's lock in round {round}"
        );
        assert!(
            root.join(MARK).exists(),
            "health removed the writer's mark in round {round}"
        );
        assert!(
            !health.history.busy,
            "the writer's own lock is not a git command run by hand"
        );
    }
    stop_tx.send(()).unwrap();
    writer.join().unwrap();
}

#[test]
fn a_stale_lock_a_killed_writer_left_is_cleared_by_the_next_op() {
    let (t, k) = open();
    let root = t.vault.root();
    // A process killed mid-write: its mark and its lock, and nobody holding the write lock.
    fs::create_dir_all(root.join(".kasten/cache")).unwrap();
    fs::write(root.join(MARK), "").unwrap();
    fs::write(root.join(".git/index.lock"), "").unwrap();

    // Looking at the health leaves it, and does not call it a git command's.
    assert!(!k.health(NOW.millis).history.busy);
    assert!(root.join(".git/index.lock").exists());

    k.create_board(&Actor::Human, "After the crash", None, NOW)
        .unwrap();
    assert!(!root.join(".git/index.lock").exists());
    assert!(!root.join(MARK).exists());
}

#[test]
fn a_lock_a_git_command_run_by_hand_holds_is_busy_and_stays() {
    let (t, k) = open();
    let root = t.vault.root();
    fs::write(root.join(".git/index.lock"), "").unwrap();
    assert!(k.health(NOW.millis).history.busy);
    assert!(root.join(".git/index.lock").exists());
    let err = k
        .create_board(&Actor::Human, "Held back", None, NOW)
        .unwrap_err();
    assert!(err.to_string().contains("index.lock"), "{err}");
    assert!(root.join(".git/index.lock").exists());
}
