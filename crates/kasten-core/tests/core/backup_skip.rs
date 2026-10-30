//! Files too big for GitHub stay out of history and are listed in
//! `.kasten/backup-skip.yaml`; every other change still backs up.

use crate::backup_support::{MIB, sparse, with_backup};
use crate::common::NOW;

use std::fs;

const SKIP_FILE: &str = ".kasten/backup-skip.yaml";

fn drop_in(root: &std::path::Path, path: &str, text: &str) {
    let full = root.join(path);
    fs::create_dir_all(full.parent().unwrap()).unwrap();
    fs::write(full, text).unwrap();
}

#[test]
fn a_file_over_100_mib_stays_out_of_history_while_everything_else_backs_up() {
    let (t, k, remote) = with_backup();
    let root = t.vault.root();
    sparse(&root.join("media/huge.bin"), 120);
    drop_in(
        root,
        "Outside note.md",
        "# Outside note\n\nWritten elsewhere.\n",
    );

    k.commit_external().unwrap().expect("the note is committed");
    k.push(NOW.millis).unwrap();

    assert!(remote.holds_file("main", "Outside note.md"));
    assert!(remote.holds_file("main", SKIP_FILE));
    assert!(!remote.holds_file("main", "media/huge.bin"));

    let status = k.backup_status(NOW.millis);
    assert_eq!(status.skipped.len(), 1);
    assert_eq!(status.skipped[0].path, "media/huge.bin");
    assert_eq!(status.skipped[0].size, 120 * MIB);
    assert!(!status.skipped[0].since.is_empty());
    assert_eq!(status.unpushed, 0);
    // The file itself is untouched.
    assert_eq!(
        fs::metadata(root.join("media/huge.bin")).unwrap().len(),
        120 * MIB
    );
}

#[test]
fn a_big_file_alone_still_makes_its_list_and_later_pushes_work() {
    let (t, k, remote) = with_backup();
    let root = t.vault.root();
    sparse(&root.join("huge.bin"), 101);
    k.commit_external().unwrap().expect("the list is committed");
    k.push(NOW.millis).unwrap();
    assert!(!remote.holds_file("main", "huge.bin"));
    assert!(remote.holds_file("main", SKIP_FILE));

    // Asking again changes nothing and makes no empty commit.
    assert_eq!(k.commit_external().unwrap(), None);
    drop_in(root, "later.md", "# Later\n");
    k.commit_external().unwrap().expect("later note");
    k.push(NOW.millis + 1).unwrap();
    assert!(remote.holds_file("main", "later.md"));
}

#[test]
fn a_big_file_the_list_names_is_left_alone_by_the_commit_pass_until_its_size_changes() {
    let (t, k, _remote) = with_backup();
    let root = t.vault.root();
    sparse(&root.join("huge.bin"), 101);
    k.commit_external().unwrap().expect("the list is committed");
    // History does not hold the file, and `dirty` still says so (a batch
    // refuses to touch such a file), but the pass has nothing to do with it.
    assert!(k.dirty().unwrap().iter().any(|p| p == "huge.bin"));
    assert_eq!(k.commit_external().unwrap(), None);
    // Another size is news: the list is brought up to date.
    sparse(&root.join("huge.bin"), 130);
    k.commit_external().unwrap().expect("the list changed");
    assert_eq!(k.backup_status(NOW.millis).skipped[0].size, 130 * MIB);
}

#[test]
fn a_file_over_50_mib_warns_but_is_backed_up() {
    let (t, k, remote) = with_backup();
    sparse(&t.vault.root().join("media/big.bin"), 51);
    k.commit_external().unwrap().expect("committed");
    k.push(NOW.millis).unwrap();

    assert!(remote.holds_file("main", "media/big.bin"));
    let status = k.backup_status(NOW.millis);
    assert!(status.skipped.is_empty());
    assert_eq!(status.warn.len(), 1);
    assert_eq!(status.warn[0].path, "media/big.bin");
    assert_eq!(status.warn[0].size, 51 * MIB);
    assert!(
        !remote.holds_file("main", SKIP_FILE),
        "no list for a warning"
    );
}

#[test]
fn a_removed_or_smaller_file_leaves_the_list_on_the_next_commit() {
    let (t, k, remote) = with_backup();
    let root = t.vault.root();
    sparse(&root.join("huge.bin"), 110);
    sparse(&root.join("other.bin"), 105);
    k.commit_external().unwrap().unwrap();
    assert_eq!(k.backup_status(NOW.millis).skipped.len(), 2);

    // One shrinks and is backed up with the next commit; one is removed.
    sparse(&root.join("huge.bin"), 1);
    fs::remove_file(root.join("other.bin")).unwrap();
    drop_in(root, "note.md", "# Note\n");
    k.commit_external().unwrap().unwrap();
    k.push(NOW.millis).unwrap();

    assert!(k.backup_status(NOW.millis).skipped.is_empty());
    assert!(remote.holds_file("main", "huge.bin"));
    assert!(!remote.holds_file("main", "other.bin"));
    let list = fs::read_to_string(root.join(SKIP_FILE)).unwrap();
    assert!(
        !list.contains("huge.bin") && !list.contains("other.bin"),
        "{list}"
    );
}

#[test]
fn the_list_keeps_keys_it_does_not_know_and_when_a_file_was_first_left_out() {
    let (t, k, _remote) = with_backup();
    let root = t.vault.root();
    sparse(&root.join("huge.bin"), 103);
    drop_in(
        root,
        SKIP_FILE,
        "note: written by hand\nskipped:\n- path: huge.bin\n  size: 5\n  since: 2026-01-01T00:00:00Z\n  reason: mine\n",
    );
    k.commit_external().unwrap().unwrap();

    let list = fs::read_to_string(root.join(SKIP_FILE)).unwrap();
    for kept in [
        "note: written by hand",
        "reason: mine",
        "2026-01-01T00:00:00Z",
    ] {
        assert!(list.contains(kept), "lost {kept}: {list}");
    }
    let status = k.backup_status(NOW.millis);
    assert_eq!(status.skipped.len(), 1);
    assert_eq!(
        status.skipped[0].size,
        103 * MIB,
        "the size is the current one"
    );
    assert_eq!(status.skipped[0].since, "2026-01-01T00:00:00Z");
}

#[test]
fn a_list_that_cannot_be_read_is_left_alone() {
    let (t, k, remote) = with_backup();
    let root = t.vault.root();
    sparse(&root.join("huge.bin"), 103);
    let broken = "skipped: [unclosed\n";
    drop_in(root, SKIP_FILE, broken);
    drop_in(root, "note.md", "# Note\n");
    k.commit_external().unwrap().unwrap();
    k.push(NOW.millis).unwrap();

    assert_eq!(fs::read_to_string(root.join(SKIP_FILE)).unwrap(), broken);
    assert!(!remote.holds_file("main", "huge.bin"), "still left out");
    assert!(remote.holds_file("main", "note.md"));
}

#[test]
fn a_big_file_in_a_vault_with_no_history_yet_stays_out_of_the_first_commit() {
    let t = crate::common::dev_vault();
    let root = t.vault.root();
    sparse(&root.join("huge.bin"), 104);
    let k = kasten_core::Kasten::open(root).unwrap();
    k.start_history().unwrap();
    let remote = crate::backup_support::Remote(root.with_extension("first-remote.git"));
    git2::Repository::init_bare(&remote.0).unwrap();
    let mut config = k.config();
    config.git.remote = Some(remote.url());
    k.set_config(config).unwrap();
    k.confirm_remote(Some(&remote.url()));
    k.push(NOW.millis).unwrap();

    assert!(!remote.holds_file("main", "huge.bin"));
    assert!(remote.holds_file("main", SKIP_FILE));
    assert_eq!(k.backup_status(NOW.millis).skipped.len(), 1);
}
