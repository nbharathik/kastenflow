//! The backup under stress: a backup put right again, an unreachable one that
//! cannot lift a stop, files that grow or move after they were committed, and
//! lists that are malformed.

use crate::backup_support::{MIB, Remote, commit_page, sparse, with_backup};
use crate::common::NOW;

use std::fs;

use kasten_core::Kasten;

const SKIP_FILE: &str = ".kasten/backup-skip.yaml";
const MIN: u64 = 60_000;

fn drop_in(root: &std::path::Path, path: &str, text: &str) {
    let full = root.join(path);
    fs::create_dir_all(full.parent().unwrap()).unwrap();
    fs::write(full, text).unwrap();
}

fn pushed_twice(k: &Kasten, remote: &Remote) -> String {
    k.push(NOW.millis).unwrap();
    commit_page(k, "Page that went", 1);
    k.push(NOW.millis + 2 * MIN).unwrap();
    remote.tip("main").unwrap()
}

#[test]
fn a_backup_put_right_again_takes_pushes_again() {
    let (_t, k, remote) = with_backup();
    let sent = pushed_twice(&k, &remote);
    remote.force("main", remote.unrelated_commit());
    commit_page(&k, "After the replacement", 2);
    assert!(k.push(NOW.millis + 10 * MIN).is_err());
    assert!(k.backup_status(NOW.millis + 10 * MIN).lost_history);

    // The owner sets the branch back to what this computer sent.
    remote.force("main", git2::Oid::from_str(&sent).unwrap());
    k.push(NOW.millis + 20 * MIN).unwrap();
    let status = k.backup_status(NOW.millis + 20 * MIN);
    assert!(!status.lost_history);
    assert_eq!(status.unpushed, 0);
    assert_ne!(remote.tip("main").unwrap(), sent);
}

#[test]
fn an_unreachable_backup_does_not_lift_a_stop() {
    let (_t, k, remote) = with_backup();
    let sent = pushed_twice(&k, &remote);
    let theirs = remote.unrelated_commit();
    remote.force("main", theirs);
    commit_page(&k, "After the replacement", 2);
    assert!(k.push(NOW.millis + 10 * MIN).is_err());

    // The check cannot be made now, and the push must not be tried.
    let kept = remote.0.with_extension("away");
    fs::rename(&remote.0, &kept).unwrap();
    let err = k.push(NOW.millis + 20 * MIN).unwrap_err().to_string();
    assert!(err.contains("safety branch"), "{err}");
    assert!(k.backup_status(NOW.millis + 20 * MIN).lost_history);
    fs::rename(&kept, &remote.0).unwrap();
    assert_eq!(remote.tip("main"), Some(theirs.to_string()));
    assert_ne!(remote.tip("main"), Some(sent));
}

#[test]
fn a_file_that_grows_after_it_was_committed_stays_out_from_then_on() {
    let (t, k, remote) = with_backup();
    let root = t.vault.root();
    sparse(&root.join("media/clip.bin"), 1);
    k.commit_external().unwrap().expect("committed small");
    k.push(NOW.millis).unwrap();

    sparse(&root.join("media/clip.bin"), 105);
    drop_in(root, "later.md", "# Later\n");
    k.commit_external().unwrap().expect("the note and the list");
    k.push(NOW.millis + MIN).unwrap();

    assert!(remote.holds_file("main", "later.md"));
    let status = k.backup_status(NOW.millis + MIN);
    assert_eq!(status.skipped.len(), 1);
    assert_eq!(status.skipped[0].size, 105 * MIB);
    assert_eq!(status.unpushed, 0);
    // The old, small copy is what history keeps of it.
    let blob = {
        let repo = remote.repo();
        let id = repo.refname_to_id("refs/heads/main").unwrap();
        let tree = repo.find_commit(id).unwrap().tree().unwrap();
        let entry = tree
            .get_path(std::path::Path::new("media/clip.bin"))
            .unwrap();
        repo.find_blob(entry.id()).unwrap().size() as u64
    };
    assert_eq!(blob, MIB);
}

#[test]
fn a_big_file_that_moves_is_listed_at_its_new_place_only() {
    let (t, k, _remote) = with_backup();
    let root = t.vault.root();
    sparse(&root.join("huge.bin"), 110);
    k.commit_external().unwrap().unwrap();
    fs::create_dir_all(root.join("media")).unwrap();
    fs::rename(root.join("huge.bin"), root.join("media/huge.bin")).unwrap();
    k.commit_external().unwrap().expect("the list changed");

    let skipped = k.backup_status(NOW.millis).skipped;
    assert_eq!(skipped.len(), 1);
    assert_eq!(skipped[0].path, "media/huge.bin");
}

#[cfg(any(windows, target_os = "macos"))]
#[test]
fn a_big_file_renamed_only_in_case_has_one_entry() {
    let (t, k, _remote) = with_backup();
    let root = t.vault.root();
    sparse(&root.join("huge.bin"), 110);
    k.commit_external().unwrap().unwrap();
    let first = k.backup_status(NOW.millis).skipped;
    fs::rename(root.join("huge.bin"), root.join("Huge.bin")).unwrap();
    k.commit_external().unwrap().expect("the list changed");

    let skipped = k.backup_status(NOW.millis).skipped;
    assert_eq!(skipped.len(), 1, "{skipped:?}");
    assert_eq!(skipped[0].path, "Huge.bin");
    assert_eq!(skipped[0].since, first[0].since);
}

#[test]
fn entries_that_are_not_files_of_the_vault_are_left_as_written_and_do_no_harm() {
    let (t, k, remote) = with_backup();
    let root = t.vault.root();
    sparse(&root.join("huge.bin"), 103);
    drop_in(
        root,
        SKIP_FILE,
        "skipped:\n- path: ../outside.bin\n  size: 200000000\n  since: x\n- path: 5\n- 7\n- path: /etc/passwd\n  size: 9\n",
    );
    k.commit_external().unwrap().unwrap();
    k.push(NOW.millis).unwrap();

    let status = k.backup_status(NOW.millis);
    assert_eq!(status.skipped.len(), 1, "{:?}", status.skipped);
    assert_eq!(status.skipped[0].path, "huge.bin");
    assert!(!remote.holds_file("main", "huge.bin"));
    let list = fs::read_to_string(root.join(SKIP_FILE)).unwrap();
    assert!(list.contains("../outside.bin"), "{list}");
}

#[test]
fn a_list_with_a_byte_order_mark_and_windows_line_ends_is_read() {
    let (t, k, _remote) = with_backup();
    let root = t.vault.root();
    sparse(&root.join("huge.bin"), 103);
    drop_in(
        root,
        SKIP_FILE,
        "\u{feff}extra: kept\r\nskipped:\r\n- path: huge.bin\r\n  size: 1\r\n  since: 2026-01-01T00:00:00Z\r\n",
    );
    k.commit_external().unwrap().unwrap();
    let status = k.backup_status(NOW.millis);
    assert_eq!(status.skipped.len(), 1);
    assert_eq!(status.skipped[0].since, "2026-01-01T00:00:00Z");
    assert!(
        fs::read_to_string(root.join(SKIP_FILE))
            .unwrap()
            .contains("extra: kept")
    );
}

#[test]
fn many_big_files_are_listed_and_the_rest_still_goes() {
    let (t, k, remote) = with_backup();
    let root = t.vault.root();
    for n in 0..40 {
        sparse(&root.join(format!("media/huge-{n}.bin")), 101);
    }
    drop_in(root, "note.md", "# Note\n");
    k.commit_external().unwrap().unwrap();
    k.push(NOW.millis).unwrap();
    assert!(remote.holds_file("main", "note.md"));
    assert_eq!(k.backup_status(NOW.millis).skipped.len(), 40);
    // Nothing changed: no new commit and nothing waiting.
    assert_eq!(k.commit_external().unwrap(), None);
    assert_eq!(k.backup_status(NOW.millis).unpushed, 0);
}
