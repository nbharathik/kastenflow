//! Kasten's cache belongs to one computer: the index holds every note's
//! text and the MCP token lives there, so it never enters history, even in
//! a vault whose repository some other tool made.

use crate::common;

use std::fs;
use std::path::Path;

use common::{NOW, dev_vault};
use kasten_core::Kasten;

/// A repository another tool made: none of Kasten's ignore lines, and a
/// first commit of whatever is there.
fn their_repository(root: &Path) -> git2::Repository {
    fs::remove_file(root.join(".gitignore")).unwrap();
    let repo = git2::Repository::init(root).unwrap();
    {
        let mut index = repo.index().unwrap();
        index
            .add_all(["*"], git2::IndexAddOption::DEFAULT, None)
            .unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let sig = git2::Signature::now("Someone", "someone@example.com").unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "first", &tree, &[])
            .unwrap();
    }
    repo
}

fn committed(repo: &git2::Repository, path: &str) -> bool {
    let tree = repo.head().unwrap().peel_to_tree().unwrap();
    tree.get_path(Path::new(path)).is_ok()
}

#[test]
fn a_vault_in_another_tools_repository_never_commits_the_cache() {
    let t = dev_vault();
    let root = t.vault.root();
    // The fixture does not carry generated cache files.
    let repo = their_repository(root);

    let k = Kasten::open(root).unwrap();
    assert!(root.join(".kasten/cache/index.sqlite").exists());
    fs::write(root.join("library/new.md"), "---\ntitle: New\n---\nText\n").unwrap();
    k.outside_changes(&["library/new.md".to_owned()], NOW.millis);
    k.commit_external().unwrap().expect("a commit");

    assert!(committed(&repo, "library/new.md"));
    assert!(
        !committed(&repo, ".kasten/cache"),
        "the cache was committed"
    );
    let exclude = fs::read_to_string(root.join(".git/info/exclude")).unwrap();
    assert!(exclude.contains(".kasten/cache/") && exclude.contains(".kasten/write.lock"));
    assert!(
        !root.join(".gitignore").exists(),
        "their files are left alone"
    );
}

#[test]
fn a_cache_an_earlier_version_committed_leaves_history_once() {
    let t = dev_vault();
    let root = t.vault.root();
    drop(Kasten::open(root).unwrap());
    let repo = their_repository(root);
    assert!(committed(&repo, ".kasten/cache/index.sqlite"));

    let k = Kasten::open(root).unwrap();
    let first = k.untrack_local_files().unwrap();
    assert!(first.is_some(), "a commit that stops tracking the cache");
    assert!(!committed(&repo, ".kasten/cache/index.sqlite"));
    assert!(
        root.join(".kasten/cache/index.sqlite").exists(),
        "kept on disk"
    );
    assert_eq!(k.untrack_local_files().unwrap(), None, "only once");
    let last = &k.log(None, 1).unwrap()[0];
    assert_eq!(
        last.summary,
        "untrack: KastenFlow's cache, which belongs to this computer"
    );
}

#[cfg(any(unix, windows))]
#[test]
fn private_file_links_are_rejected_before_opening_the_index() {
    for name in [
        "index.sqlite",
        "index.sqlite-wal",
        "index.sqlite-shm",
        "index.sqlite-journal",
    ] {
        let t = dev_vault();
        let other = dev_vault();
        let target = other.vault.root().join("sentinel");
        fs::write(&target, b"must stay unchanged").unwrap();
        fs::create_dir_all(t.vault.root().join(".kasten/cache")).unwrap();
        let link = t.vault.root().join(".kasten/cache").join(name);
        #[cfg(unix)]
        std::os::unix::fs::symlink(&target, &link).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_file(&target, &link).unwrap();
        assert!(Kasten::open(t.vault.root()).is_err(), "accepted {name}");
        assert_eq!(fs::read(&target).unwrap(), b"must stay unchanged");
    }
}

#[cfg(any(unix, windows))]
#[test]
fn initialization_rejects_linked_private_folders_before_any_write() {
    let t = dev_vault();
    let other = dev_vault();
    let root = t.vault.root().join("new-vault");
    fs::create_dir(&root).unwrap();
    let target = other.vault.root().join("sentinel-folder");
    fs::create_dir(&target).unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(&target, root.join(".kasten")).unwrap();
    #[cfg(windows)]
    std::os::windows::fs::symlink_dir(&target, root.join(".kasten")).unwrap();
    assert!(Kasten::init(&root, "Linked").is_err());
    assert_eq!(fs::read_dir(&target).unwrap().count(), 0);
    assert!(!root.join("inbox").exists());
}

#[cfg(any(unix, windows))]
#[test]
fn the_folder_explicitly_chosen_by_the_user_can_be_an_alias() {
    let t = dev_vault();
    let other = dev_vault();
    let chosen = other.vault.root().join("chosen-vault");
    #[cfg(unix)]
    std::os::unix::fs::symlink(t.vault.root(), &chosen).unwrap();
    #[cfg(windows)]
    std::os::windows::fs::symlink_dir(t.vault.root(), &chosen).unwrap();
    assert!(Kasten::open(&chosen).is_ok());
    assert!(t.vault.root().join(".kasten/cache/index.sqlite").exists());
}

#[cfg(any(unix, windows))]
#[test]
fn linked_git_metadata_is_refused_before_local_excludes_are_written() {
    let t = dev_vault();
    let other = dev_vault();
    let root = t.vault.root();
    drop(git2::Repository::init(root).unwrap());
    let info = root.join(".git/info");
    if info.exists() {
        fs::rename(&info, root.join(".git/info-original")).unwrap();
    }
    let outside = other.vault.root().join("outside-info");
    fs::create_dir(&outside).unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(&outside, &info).unwrap();
    #[cfg(windows)]
    std::os::windows::fs::symlink_dir(&outside, &info).unwrap();
    assert!(kasten_core::history::History::open(root).is_err());
    assert!(!outside.join("exclude").exists());
}

/// Another repository, standing beside the vault.
fn elsewhere(root: &Path) -> git2::Repository {
    git2::Repository::init(root.with_extension("elsewhere")).unwrap()
}

/// Nothing of the vault's went into `theirs`: no commit, no staged file,
/// no ignore line.
fn untouched(theirs: &git2::Repository) {
    assert!(theirs.head().is_err(), "a commit went into it");
    assert_eq!(theirs.index().unwrap().len(), 0, "files were staged in it");
    let exclude = fs::read_to_string(theirs.path().join("info/exclude")).unwrap_or_default();
    assert!(!exclude.contains(".kasten/cache/"), "{exclude}");
}

#[test]
fn history_never_goes_through_a_git_file_into_another_repository() {
    let t = dev_vault();
    let root = t.vault.root();
    let theirs = elsewhere(root);
    let gitfile = format!("gitdir: {}\n", theirs.path().display());
    fs::write(root.join(".git"), &gitfile).unwrap();

    let err = Kasten::open(root).expect_err("refused").to_string();
    assert!(err.contains(".git"), "{err}");
    untouched(&theirs);

    // A `.git` that turns up once the vault is open is refused as well.
    fs::remove_file(root.join(".git")).unwrap();
    let k = Kasten::open(root).unwrap();
    fs::write(root.join(".git"), &gitfile).unwrap();
    assert!(k.start_history().is_err());
    assert!(!k.has_history());
    untouched(&theirs);
    fs::remove_dir_all(theirs.path().parent().unwrap()).unwrap();
}

#[cfg(unix)]
#[test]
fn history_never_goes_through_a_link_into_another_repository() {
    let t = dev_vault();
    let root = t.vault.root();
    let theirs = elsewhere(root);
    std::os::unix::fs::symlink(theirs.path(), root.join(".git")).unwrap();

    let err = Kasten::open(root).expect_err("refused").to_string();
    assert!(err.contains(".git") && err.contains("link"), "{err}");
    untouched(&theirs);

    // A link to nowhere yet would have git make the repository there.
    let nowhere = root.with_extension("nowhere");
    fs::remove_file(root.join(".git")).unwrap();
    std::os::unix::fs::symlink(&nowhere, root.join(".git")).unwrap();
    assert!(Kasten::open(root).is_err());
    let k = {
        fs::remove_file(root.join(".git")).unwrap();
        let k = Kasten::open(root).unwrap();
        std::os::unix::fs::symlink(&nowhere, root.join(".git")).unwrap();
        k
    };
    assert!(k.start_history().is_err());
    assert!(!nowhere.exists(), "a repository was made outside the vault");
    fs::remove_dir_all(theirs.path().parent().unwrap()).unwrap();
}

#[test]
fn history_never_works_a_folder_or_repository_the_git_folder_names() {
    // Its config names another working folder: commits would take files
    // from there.
    let t = dev_vault();
    let root = t.vault.root();
    let outside = root.with_extension("outside");
    fs::create_dir_all(&outside).unwrap();
    fs::write(outside.join("private.md"), "Not the vault's\n").unwrap();
    let repo = git2::Repository::init(root).unwrap();
    let mut config = repo.config().unwrap();
    config
        .set_str("core.worktree", outside.to_str().unwrap())
        .unwrap();
    let err = Kasten::open(root).expect_err("refused").to_string();
    assert!(err.contains(".git"), "{err}");
    fs::remove_dir_all(&outside).unwrap();

    // It names a common folder elsewhere, as a linked worktree's does:
    // commits would go into that repository.
    let t = dev_vault();
    let root = t.vault.root();
    let theirs = elsewhere(root);
    fs::create_dir_all(root.join(".git")).unwrap();
    fs::write(root.join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
    fs::write(
        root.join(".git/commondir"),
        theirs.path().display().to_string(),
    )
    .unwrap();
    let err = Kasten::open(root).expect_err("refused").to_string();
    assert!(err.contains(".git"), "{err}");
    untouched(&theirs);
    fs::remove_dir_all(theirs.path().parent().unwrap()).unwrap();
}
