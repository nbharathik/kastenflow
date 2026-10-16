//! A private copy of `fixtures/dev-vault` per test, so ops never touch the
//! fixtures themselves.

use std::fs;
use std::path::{Path, PathBuf};

use kasten_core::{Instant, Vault, ulid_at};

pub struct TempVault {
    pub vault: Vault,
    dir: PathBuf,
}

impl Drop for TempVault {
    fn drop(&mut self) {
        // Only the test's own copy under the system temp folder.
        let _ = fs::remove_dir_all(&self.dir);
    }
}

fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), &target).unwrap();
        }
    }
}

/// A fresh copy of the dev vault.
pub fn dev_vault() -> TempVault {
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/dev-vault");
    let dir = std::env::temp_dir().join(format!("kasten-test-{}", ulid_at(Instant::now().millis)));
    copy_dir(&source, &dir);
    // macOS reaches its temporary folder through a link (/var is /private/var), and the index
    // refuses a path through a link. The engine resolves the folder it opens; so does the copy.
    #[cfg(unix)]
    let dir = kasten_core::local_paths::resolve_root(&dir).unwrap();
    TempVault {
        vault: Vault::open(&dir).unwrap(),
        dir,
    }
}

/// A fixed moment, so written timestamps are predictable.
pub const NOW: Instant = Instant {
    millis: 1_790_236_800_000,
};
