//! The only places the diagram editor's installer removes anything, and only
//! what the installer itself made inside its own folder in the app's data
//! (a download that did not check out, a half-unpacked copy, the copy a
//! removal or an upgrade replaces). A copy of a pinned download holds none of
//! a person's content, and nothing in the vault is ever reached from here.

use std::path::Path;

/// Removes a file the installer wrote; one that is not there is no matter.
pub(super) fn forget_file(path: &Path) {
    let _ = std::fs::remove_file(path);
}

/// Removes a folder the installer made; one that is not there is no matter.
pub(super) fn forget_folder(path: &Path) {
    let _ = std::fs::remove_dir_all(path);
}
