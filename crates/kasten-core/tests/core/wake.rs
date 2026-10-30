//! The commit and backup workers wake on work, not on a clock: a quiet vault
//! wakes nobody, a change wakes them at once, and the engine says how long
//! the work it is holding still has to wait.

use crate::common::{NOW, dev_vault};

use std::sync::Arc;
use std::thread;
use std::time::Duration;

use kasten_core::history::Actor;
use kasten_core::{Kasten, Kind, NewNote, QUIET_MS};

fn page(title: &str) -> NewNote {
    NewNote {
        kind: Kind::Page,
        title: title.to_owned(),
        date: "2026-09-24".to_owned(),
        project: None,
        parent: None,
        template: None,
        icon: None,
    }
}

fn save_text(k: &Kasten, path: &str, text: &str) {
    let loaded = k.read(path).unwrap();
    k.save_body(&Actor::Human, path, text, &loaded.hash, NOW)
        .unwrap();
}

const PATH: &str = "library/zettelkasten-method.md";

#[test]
fn a_waiting_worker_sleeps_through_a_quiet_vault_and_wakes_on_a_change() {
    let t = dev_vault();
    let k = Arc::new(Kasten::open(t.vault.root()).unwrap());
    k.start_history().unwrap();
    let mark = k.work_mark();
    let before = k.worker_wakeups();
    let waiting = Arc::clone(&k);
    let worker = thread::spawn(move || waiting.wait_for_work(mark, Duration::from_secs(60)));
    thread::sleep(Duration::from_millis(400));
    assert_eq!(k.worker_wakeups(), before, "woke with nothing to do");
    assert!(!worker.is_finished());
    k.create(&Actor::Human, &page("Wakes the worker"), NOW)
        .unwrap();
    assert!(worker.join().unwrap(), "woken by the change, not the limit");
    assert_eq!(k.worker_wakeups(), before + 1);
}

#[test]
fn a_change_made_before_the_wait_is_not_lost() {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    let mark = k.work_mark();
    k.create(&Actor::Human, &page("Before the wait"), NOW)
        .unwrap();
    let started = std::time::Instant::now();
    assert!(k.wait_for_work(mark, Duration::from_secs(60)));
    assert!(started.elapsed() < Duration::from_secs(5));
    assert_ne!(k.work_mark(), mark);
}

#[test]
fn the_limit_ends_a_wait_nothing_woke() {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    let mark = k.work_mark();
    assert!(!k.wait_for_work(mark, Duration::from_millis(30)));
    assert_eq!(k.work_mark(), mark);
}

#[test]
fn typing_waits_for_the_quiet_spell_and_an_idle_vault_has_no_commit_due() {
    let t = dev_vault();
    let root = t.vault.root().to_owned();
    let k = Kasten::open(&root).unwrap();
    k.start_history().unwrap();
    assert_eq!(k.commit_wait(NOW.millis), None, "nothing pending");
    save_text(&k, PATH, "New body\n");
    assert_eq!(k.commit_wait(NOW.millis), Some(QUIET_MS));
    assert_eq!(k.commit_wait(NOW.millis + 10_000), Some(QUIET_MS - 10_000));
    assert_eq!(k.commit_wait(NOW.millis + QUIET_MS), Some(0));
    assert_eq!(k.commit_wait(NOW.millis + 3 * QUIET_MS), Some(0));
    let tick = k.commit_tick(NOW.millis + QUIET_MS).unwrap();
    assert!(tick.edits.is_some());
    assert_eq!(k.commit_wait(NOW.millis + QUIET_MS), None, "committed");
}

#[test]
fn an_outside_change_waits_for_the_quiet_spell_too() {
    let t = dev_vault();
    let root = t.vault.root().to_owned();
    let k = Kasten::open(&root).unwrap();
    k.start_history().unwrap();
    std::fs::write(root.join("inbox/from-phone.md"), "Synced in\n").unwrap();
    k.outside_changes(&["inbox/from-phone.md".to_owned()], NOW.millis);
    assert_eq!(k.commit_wait(NOW.millis + 5_000), Some(QUIET_MS - 5_000));
    let tick = k.commit_tick(NOW.millis + QUIET_MS).unwrap();
    assert!(tick.external.is_some());
    assert_eq!(k.commit_wait(NOW.millis + QUIET_MS), None);
}

#[test]
fn an_outside_change_wakes_a_waiting_worker() {
    let t = dev_vault();
    let root = t.vault.root().to_owned();
    let k = Arc::new(Kasten::open(&root).unwrap());
    let mark = k.work_mark();
    let waiting = Arc::clone(&k);
    let worker = thread::spawn(move || waiting.wait_for_work(mark, Duration::from_secs(60)));
    std::fs::write(root.join("inbox/from-phone.md"), "Synced in\n").unwrap();
    k.outside_changes(&["inbox/from-phone.md".to_owned()], NOW.millis);
    assert!(worker.join().unwrap());
}

/// A vault with a bare repository as its confirmed backup.
fn with_remote(delay_seconds: u64) -> (crate::common::TempVault, Kasten) {
    let t = dev_vault();
    let root = t.vault.root().to_owned();
    let k = Kasten::open(&root).unwrap();
    k.start_history().unwrap();
    let remote = root.with_extension("remote.git");
    git2::Repository::init_bare(&remote).unwrap();
    let mut config = k.config();
    config.git.remote = Some(remote.to_string_lossy().into_owned());
    config.git.push_delay_seconds = delay_seconds;
    k.set_config(config).unwrap();
    k.confirm_remote(Some(&remote.to_string_lossy()));
    (t, k)
}

#[test]
fn a_push_is_waited_for_only_while_the_backup_lacks_a_commit() {
    let now = || kasten_core::Instant::now().millis;
    let (_t, k) = with_remote(0);
    // The first commit is not on the remote yet.
    assert_eq!(k.push_wait(now()), Some(0));
    k.push(now()).unwrap();
    assert_eq!(k.push_wait(now()), None, "the backup holds everything");
    save_text(&k, PATH, "New body\n");
    assert_eq!(k.push_wait(now()), None, "typing is not committed yet");
    k.commit_edits().unwrap();
    assert_eq!(k.push_wait(now()), Some(0));
}

#[test]
fn a_push_waits_for_the_push_delay_after_a_commit() {
    let now = || kasten_core::Instant::now().millis;
    let (_t, k) = with_remote(120);
    k.push(now()).unwrap();
    save_text(&k, PATH, "New body\n");
    k.commit_edits().unwrap();
    let wait = k.push_wait(now()).expect("a push is coming");
    assert!(
        (100_000..=120_000).contains(&wait),
        "waits out the delay: {wait}"
    );
    assert_eq!(k.push_wait(now() + 121_000), Some(0));
}

#[test]
fn no_remote_or_an_unconfirmed_one_means_no_push_to_wait_for() {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    assert_eq!(k.push_wait(NOW.millis), None);
    let (_t, k) = with_remote(0);
    k.confirm_remote(None);
    assert_eq!(k.push_wait(NOW.millis), None);
}

/// A folder beside the vault for backup files, removed with the test.
struct Beside(std::path::PathBuf);

impl Drop for Beside {
    fn drop(&mut self) {
        // Only the test's own folder beside its temporary vault.
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn the_daily_file_waits_for_a_quiet_vault_then_for_a_new_commit() {
    const MINUTE: u64 = 60_000;
    const DAY: u64 = 24 * 60 * MINUTE;
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    assert_eq!(k.backup_file_wait(NOW.millis), None, "no history, no file");
    k.start_history().unwrap();
    assert_eq!(k.backup_file_wait(NOW.millis), Some(0), "none written yet");
    save_text(&k, PATH, "New body\n");
    assert_eq!(
        k.backup_file_wait(NOW.millis),
        None,
        "typing waits for its commit"
    );
    k.commit_edits().unwrap();
    assert_eq!(k.backup_file_wait(NOW.millis), Some(2 * MINUTE));
    assert_eq!(k.backup_file_wait(NOW.millis + 3 * MINUTE), Some(0));

    let folder = Beside(t.vault.root().with_extension("daily"));
    std::fs::create_dir_all(&folder.0).unwrap();
    let written = kasten_core::Instant {
        millis: NOW.millis + 3 * MINUTE,
    };
    k.write_backup_file(&folder.0, "desk", written).unwrap();
    assert_eq!(
        k.backup_file_wait(written.millis),
        None,
        "the file is current"
    );

    // A newer commit makes a file due a day after the last one.
    k.create(&Actor::Human, &page("Newer"), written).unwrap();
    assert_eq!(
        k.backup_file_wait(written.millis + MINUTE),
        Some(DAY - MINUTE)
    );
}

#[test]
fn a_commit_confirming_the_remote_or_a_push_wakes_the_workers() {
    let (_t, k) = with_remote(0);
    let mark = k.work_mark();
    save_text(&k, PATH, "New body\n");
    k.commit_edits().unwrap();
    let after_commit = k.work_mark();
    assert_ne!(after_commit, mark, "a commit tells the backup worker");
    k.confirm_remote(None);
    let after_confirm = k.work_mark();
    assert_ne!(after_confirm, after_commit, "so does a changed remote");
    k.confirm_remote(None);
    k.set_git_token(None);
    assert_ne!(k.work_mark(), after_confirm, "and a changed token");
}
