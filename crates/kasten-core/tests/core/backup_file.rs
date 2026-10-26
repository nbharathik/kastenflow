//! Backup files: the whole history in one file (a git bundle) in a folder
//! that Dropbox, Google Drive, OneDrive or a disk keeps. Each file is
//! written aside, checked, and only then given its name; the newest 7 are
//! kept, and an older one goes only when the new one holds its history.
//! A file restores into an empty folder, and plain git can clone it.

use crate::common;

use std::fs;
use std::path::{Path, PathBuf};

use common::{NOW, dev_vault};
use kasten_core::history::{self, Actor, History};
use kasten_core::{Instant, Kasten, Kind, NewNote};

const HOUR: u64 = 60 * 60 * 1000;

fn page(title: &str) -> NewNote {
    NewNote {
        kind: Kind::Page,
        title: title.into(),
        date: "2026-09-25".into(),
        project: None,
        parent: None,
        template: None,
        icon: None,
    }
}

fn with_history() -> (common::TempVault, Kasten) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k)
}

/// A folder beside the vault, removed with it at the end of the test.
struct Beside(PathBuf);

impl Drop for Beside {
    fn drop(&mut self) {
        // Only the test's own folder under the system temp folder.
        let _ = fs::remove_dir_all(&self.0);
    }
}

impl std::ops::Deref for Beside {
    type Target = Path;
    fn deref(&self) -> &Path {
        &self.0
    }
}

/// A folder beside the vault, as a sync client's would be.
fn sync_folder(t: &common::TempVault, name: &str) -> Beside {
    let dir = t.vault.root().with_extension(name);
    fs::create_dir_all(&dir).unwrap();
    Beside(dir)
}

/// A place beside the vault for a restore, not made yet.
fn beside(t: &common::TempVault, name: &str) -> Beside {
    Beside(t.vault.root().with_extension(name))
}

fn at(hours: u64) -> Instant {
    Instant {
        millis: NOW.millis + hours * HOUR,
    }
}

fn files_in(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

fn head(k: &Kasten) -> String {
    k.log(None, 1).unwrap()[0].id.clone()
}

#[test]
fn writes_a_checked_file_of_the_whole_history_in_a_folder_of_its_own() {
    let (t, k) = with_history();
    let folder = sync_folder(&t, "dropbox");
    let file = k.write_backup_file(&folder, "Desk PC", NOW).unwrap();
    assert!(file.written);
    assert_eq!(file.head, head(&k));
    let path = Path::new(&file.path);
    assert_eq!(
        path.parent().unwrap(),
        folder.join("Kasten backup - Dev vault")
    );
    let name = path.file_name().unwrap().to_string_lossy().into_owned();
    assert!(name.starts_with("kasten-dev-vault-desk-pc-"), "{name}");
    assert!(name.ends_with(".bundle"), "{name}");
    assert!(file.bytes > 0);
    // Only the finished file: nothing half-written is left beside it.
    assert_eq!(files_in(path.parent().unwrap()), [name]);
    let header = history::read_bundle_header(path).unwrap();
    assert_eq!(header.head, file.head);
    assert_eq!(
        k.backup_file_status(NOW.millis).last_written,
        Some(NOW.millis)
    );
}

#[test]
fn writes_nothing_new_when_the_newest_file_holds_everything() {
    let (t, k) = with_history();
    let folder = sync_folder(&t, "drive");
    let first = k.write_backup_file(&folder, "desk", NOW).unwrap();
    let again = k.write_backup_file(&folder, "desk", at(24)).unwrap();
    assert!(!again.written);
    assert_eq!(again.path, first.path);
    assert_eq!(files_in(Path::new(&first.path).parent().unwrap()).len(), 1);
}

#[test]
fn restores_into_an_empty_folder_with_every_commit() {
    let (t, k) = with_history();
    k.create(&Actor::Human, &page("Written before the backup"), NOW)
        .unwrap();
    let folder = sync_folder(&t, "disk");
    let file = k.write_backup_file(&folder, "desk", NOW).unwrap();

    // A folder of its own: the system temp folder is shared with tests running at once,
    // whose restores have their hidden work folders there for a moment.
    let own = beside(&t, "restored-in");
    let target = Beside(own.join("restored"));
    fs::create_dir_all(&*target).unwrap();
    let header = history::restore_from_bundle(Path::new(&file.path), &target).unwrap();
    assert_eq!(header.head, file.head);
    let restored = Kasten::open(&*target).unwrap();
    assert_eq!(
        restored.log(None, 1000).unwrap(),
        k.log(None, 1000).unwrap()
    );
    let original = History::open(t.vault.root()).unwrap().unwrap();
    for path in original.files_at("HEAD").unwrap() {
        assert_eq!(
            fs::read(target.join(&path)).unwrap(),
            original.blob_at("HEAD", &path).unwrap().unwrap(),
            "{path}"
        );
    }
    // Nothing is left beside it from the work.
    let siblings: Vec<String> = files_in(target.parent().unwrap())
        .into_iter()
        .filter(|n| n.contains(".kasten-restore"))
        .collect();
    assert!(siblings.is_empty(), "{siblings:?}");
}

#[test]
fn never_restores_over_a_folder_that_has_something_in_it() {
    let (t, k) = with_history();
    let folder = sync_folder(&t, "disk");
    let file = k.write_backup_file(&folder, "desk", NOW).unwrap();
    let target = beside(&t, "busy");
    fs::create_dir_all(&*target).unwrap();
    fs::write(target.join("keep.md"), "mine\n").unwrap();
    let err = history::restore_from_bundle(Path::new(&file.path), &target).unwrap_err();
    assert!(err.to_string().contains("empty"), "{err}");
    assert_eq!(files_in(&target), ["keep.md"]);
    assert_eq!(
        fs::read_to_string(target.join("keep.md")).unwrap(),
        "mine\n"
    );
}

#[test]
fn a_damaged_file_fails_its_check() {
    let (t, k) = with_history();
    let folder = sync_folder(&t, "disk");
    let file = k.write_backup_file(&folder, "desk", NOW).unwrap();
    let bytes = fs::read(&file.path).unwrap();
    let broken = folder.join("broken.bundle");
    fs::write(&broken, &bytes[..bytes.len() / 2]).unwrap();
    let scratch = t.vault.root().join(".kasten/cache");
    assert!(history::verify_bundle(&broken, &scratch).is_err());
    fs::write(&broken, b"not a bundle at all").unwrap();
    assert!(history::read_bundle_header(&broken).is_err());
    assert!(history::verify_bundle(Path::new(&file.path), &scratch).is_ok());
}

#[test]
fn keeps_the_newest_seven_and_removes_older_ones_only_when_their_history_is_inside() {
    let (t, k) = with_history();
    let folder = sync_folder(&t, "onedrive");
    let mut paths = Vec::new();
    for day in 0..8 {
        k.create(&Actor::Human, &page(&format!("Day {day}")), at(day * 24))
            .unwrap();
        let file = k.write_backup_file(&folder, "desk", at(day * 24)).unwrap();
        assert!(file.written);
        paths.push(file.path.clone());
        if day == 7 {
            assert_eq!(file.removed, [paths[0].clone()]);
            assert!(file.kept.is_empty());
        }
    }
    let dir = Path::new(&paths[0]).parent().unwrap().to_owned();
    assert_eq!(files_in(&dir).len(), 7);
    assert!(!Path::new(&paths[0]).exists());
    assert!(Path::new(&paths[7]).exists());

    // A file whose history is not inside the new one is kept, and said.
    let (other_t, other) = with_history();
    other
        .create(&Actor::Human, &page("Another vault's page"), NOW)
        .unwrap();
    let elsewhere = sync_folder(&other_t, "elsewhere");
    let other_file = other.write_backup_file(&elsewhere, "desk", NOW).unwrap();
    let stray = dir.join("kasten-dev-vault-desk-20200101T000000Z.bundle");
    fs::copy(&other_file.path, &stray).unwrap();
    k.create(&Actor::Human, &page("Day 8"), at(8 * 24)).unwrap();
    let file = k.write_backup_file(&folder, "desk", at(8 * 24)).unwrap();
    assert_eq!(file.kept, [stray.to_string_lossy().into_owned()]);
    assert!(stray.exists());
    assert_eq!(file.removed, [paths[1].clone()]);
}

#[test]
fn keeps_as_many_files_as_the_vault_says_and_never_fewer_than_three() {
    let (t, k) = with_history();
    let mut config = k.config();
    config.backup = Some(kasten_core::backup::BackupConfig {
        keep_files: Some(1),
        ..Default::default()
    });
    k.set_config(config).unwrap();
    let folder = sync_folder(&t, "fewer");
    let mut last = String::new();
    for day in 0..5 {
        k.create(&Actor::Human, &page(&format!("Day {day}")), at(day * 24))
            .unwrap();
        last = k
            .write_backup_file(&folder, "desk", at(day * 24))
            .unwrap()
            .path;
    }
    let dir = Path::new(&last).parent().unwrap().to_owned();
    // 1 is raised to the least that is allowed, 3.
    assert_eq!(files_in(&dir).len(), 3);
}

#[test]
fn leaves_other_computers_files_alone_and_clears_its_own_half_written_ones() {
    let (t, k) = with_history();
    let folder = sync_folder(&t, "shared");
    let first = k.write_backup_file(&folder, "desk", NOW).unwrap();
    let dir = Path::new(&first.path).parent().unwrap().to_owned();
    let laptop = dir.join("kasten-dev-vault-laptop-20200101T000000Z.bundle");
    fs::copy(&first.path, &laptop).unwrap();
    let partial = dir.join("kasten-dev-vault-desk-20200101T000000Z.bundle.partial");
    fs::write(&partial, b"cut off").unwrap();
    for day in 1..9 {
        k.create(&Actor::Human, &page(&format!("Day {day}")), at(day * 24))
            .unwrap();
        k.write_backup_file(&folder, "desk", at(day * 24)).unwrap();
    }
    assert!(laptop.exists(), "another computer's file was removed");
    assert!(!partial.exists(), "a half-written file was left");
}

#[test]
fn plain_git_can_clone_a_backup_file() {
    let (t, k) = with_history();
    let folder = sync_folder(&t, "disk");
    let file = k.write_backup_file(&folder, "desk", NOW).unwrap();
    let clone = beside(&t, "git-clone");
    let Ok(out) = std::process::Command::new("git")
        .arg("clone")
        .arg("--quiet")
        .arg(&file.path)
        .arg(&*clone)
        .output()
    else {
        // No git on this computer: the format is still checked above.
        return;
    };
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let original = History::open(t.vault.root()).unwrap().unwrap();
    for path in original.files_at("HEAD").unwrap() {
        assert!(clone.join(&path).is_file(), "{path}");
    }
}

#[test]
fn a_file_is_due_once_a_day_with_something_new_when_the_vault_is_quiet() {
    const MINUTE: u64 = 60 * 1000;
    let (t, k) = with_history();
    let folder = sync_folder(&t, "due");
    // None written yet.
    assert!(k.backup_file_due(NOW.millis));
    k.write_backup_file(&folder, "desk", NOW).unwrap();
    // Nothing new, even days later.
    assert!(!k.backup_file_due(at(72).millis));
    // Something new, but the newest file is under a day old.
    k.create(&Actor::Human, &page("New today"), at(1)).unwrap();
    assert!(!k.backup_file_due(at(2).millis));
    assert!(k.backup_file_due(at(25).millis));
    // Not while typing, nor until two quiet minutes after it.
    let note = k.read("library/zettelkasten-method.md").unwrap();
    k.save_body(
        &Actor::Human,
        &note.meta.path,
        "Typing\n",
        &note.hash,
        at(25),
    )
    .unwrap();
    assert!(!k.backup_file_due(at(25).millis + MINUTE));
    k.commit_edits().unwrap();
    assert!(!k.backup_file_due(at(25).millis + MINUTE));
    assert!(k.backup_file_due(at(25).millis + 2 * MINUTE));
}

#[test]
fn a_failed_file_waits_longer_after_each_try() {
    const MINUTE: u64 = 60 * 1000;
    let (t, k) = with_history();
    let blocked = t.vault.root().with_extension("not-a-folder");
    fs::write(&blocked, b"a file where the folder should be").unwrap();
    let _gone = Beside(blocked.clone());
    k.write_backup_file(&blocked, "desk", NOW).unwrap_err();
    assert!(!k.backup_file_due(NOW.millis + MINUTE));
    assert!(k.backup_file_due(NOW.millis + 2 * MINUTE));
    k.write_backup_file(
        &blocked,
        "desk",
        Instant {
            millis: NOW.millis + 2 * MINUTE,
        },
    )
    .unwrap_err();
    assert!(!k.backup_file_due(NOW.millis + 5 * MINUTE));
    assert!(k.backup_file_due(NOW.millis + 6 * MINUTE));
    assert_eq!(k.backup_file_status(NOW.millis + 6 * MINUTE).failures, 2);
}
