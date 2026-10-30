//! What the backup tests share: a vault with history whose confirmed backup
//! is a bare repository next to it, and small helpers to change either.

use crate::common::{self, NOW, dev_vault};

use std::fs;
use std::path::{Path, PathBuf};

use kasten_core::history::Actor;
use kasten_core::{Instant, Kasten, Kind, NewNote};

pub const MIB: u64 = 1024 * 1024;

/// A bare repository, removed again when the test ends.
pub struct Remote(pub PathBuf);

impl Drop for Remote {
    fn drop(&mut self) {
        // Only the test's own bare repository under the system temp folder.
        let _ = fs::remove_dir_all(&self.0);
    }
}

impl Remote {
    pub fn url(&self) -> String {
        self.0.to_string_lossy().into_owned()
    }

    pub fn repo(&self) -> git2::Repository {
        git2::Repository::open_bare(&self.0).unwrap()
    }

    pub fn tip(&self, branch: &str) -> Option<String> {
        self.repo()
            .refname_to_id(&format!("refs/heads/{branch}"))
            .ok()
            .map(|id| id.to_string())
    }

    /// Moves a branch to `id` behind the app's back, as a force push would.
    pub fn force(&self, branch: &str, id: git2::Oid) {
        self.repo()
            .reference(&format!("refs/heads/{branch}"), id, true, "test: rewritten")
            .unwrap();
    }

    /// A commit with nothing in common with the vault's history.
    pub fn unrelated_commit(&self) -> git2::Oid {
        let repo = self.repo();
        let tree = repo.treebuilder(None).unwrap().write().unwrap();
        let tree = repo.find_tree(tree).unwrap();
        let sig = git2::Signature::now("Someone", "someone@example.com").unwrap();
        repo.commit(None, &sig, &sig, "somebody else's history", &tree, &[])
            .unwrap()
    }

    /// Whether the branch's newest tree holds a file.
    pub fn holds_file(&self, branch: &str, path: &str) -> bool {
        let repo = self.repo();
        let Ok(id) = repo.refname_to_id(&format!("refs/heads/{branch}")) else {
            return false;
        };
        repo.find_commit(id)
            .unwrap()
            .tree()
            .unwrap()
            .get_path(Path::new(path))
            .is_ok()
    }
}

/// A vault with history and a confirmed, empty bare backup.
pub fn with_backup() -> (common::TempVault, Kasten, Remote) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    let remote = Remote(t.vault.root().with_extension("backup-remote.git"));
    git2::Repository::init_bare(&remote.0).unwrap();
    let url = remote.url();
    let mut config = k.config();
    config.git.remote = Some(url.clone());
    config.git.push_delay_seconds = 0;
    k.set_config(config).unwrap();
    k.confirm_remote(Some(&url));
    (t, k, remote)
}

/// One more commit: a new page.
pub fn commit_page(k: &Kasten, title: &str, step: u64) {
    let note = NewNote {
        kind: Kind::Page,
        title: title.into(),
        date: "2026-09-25".into(),
        project: None,
        parent: None,
        template: None,
        icon: None,
    };
    let at = Instant {
        millis: NOW.millis + step * 1000,
    };
    k.create(&Actor::Human, &note, at).unwrap();
}

/// A folder beside the vault, removed again when the test ends.
pub struct Folder(pub PathBuf);

impl Drop for Folder {
    fn drop(&mut self) {
        // Only the test's own folder under the system temp folder.
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Two computers with one vault: `a`, the original, and `b`, restored from
/// the backup both push to.
pub struct Two {
    pub a: Kasten,
    pub b: Kasten,
    pub _remote: Remote,
    pub _t: common::TempVault,
    pub _b_folder: Folder,
}

/// `two_computers` with `set` applied to the vault's config before the first
/// backup, so both computers hold the same settings.
pub fn two_computers_with(set: impl FnOnce(&mut kasten_core::Config)) -> Two {
    let (t, a, remote) = with_backup();
    let mut config = a.config();
    set(&mut config);
    a.set_config(config).unwrap();
    // The remote and the settings in the vault's config go into history
    // before the first push.
    a.commit_external().unwrap();
    a.push(NOW.millis).unwrap();
    let b_root = t.vault.root().with_extension("second-computer");
    kasten_core::history::clone_backup(&remote.url(), None, &b_root).unwrap();
    let b = Kasten::open(&b_root).unwrap();
    // The app confirms the remote on a computer restored from it.
    b.confirm_remote(Some(&remote.url()));
    Two {
        a,
        b,
        _remote: remote,
        _t: t,
        _b_folder: Folder(b_root),
    }
}

pub fn two_computers() -> Two {
    two_computers_with(|_| {})
}

/// The newest commit's id.
pub fn head_of(k: &Kasten) -> String {
    k.log(None, 1).unwrap()[0].id.clone()
}

/// How many commits the history holds.
pub fn commits_in(k: &Kasten) -> usize {
    k.log(None, 10_000).unwrap().len()
}

/// A file of `mib` MiB made without writing its bytes.
pub fn sparse(path: &Path, mib: u64) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let file = fs::File::create(path).unwrap();
    file.set_len(mib * MIB).unwrap();
}
