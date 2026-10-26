//! The one place the chat's saved files are deleted, and only because the
//! person asked: a conversation they deleted (`chat_delete_thread`), archived
//! conversations they named in a bulk delete (`chat_delete_archived`, which
//! takes only chats already marked archived and goes through the same single
//! delete), an attachment they took off a message or whose last chat they
//! deleted (`chat_attachment_drop`), or the half-written temporary file of a
//! save that just failed. `chat_reset` and `chat_new_thread` delete nothing.
//! Nothing is deleted on a cap, a timer or at start: a list size only marks the
//! oldest threads archived, and disk use is only reported (`chat_usage`).
//! These are the app's own
//! copies in its data folder, never anything in the vault: the work a chat did
//! is in the vault's history, and what it staged waits in the vault's cache
//! until the person applies or discards it.
//!
//! The check is narrow on purpose: a plain file (not a link, not a folder)
//! that sits under the folder the caller names, by a path with no `..`.

use std::fs;
use std::path::{Component, Path};

/// Removes the plain file `path` if it is under `root`. Whether it was.
pub(crate) fn file(root: &Path, path: &Path) -> bool {
    if !path.starts_with(root) || path.components().any(|c| matches!(c, Component::ParentDir)) {
        return false;
    }
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_file() => fs::remove_file(path).is_ok(),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_plain_files_under_the_folder_go() {
        let root = std::env::temp_dir().join(format!("kasten-remove-{}", std::process::id()));
        let inside = root.join("a");
        fs::create_dir_all(&inside).unwrap();
        let file_in = inside.join("x.json");
        fs::write(&file_in, "1").unwrap();
        let outside =
            std::env::temp_dir().join(format!("kasten-outside-{}.json", std::process::id()));
        fs::write(&outside, "2").unwrap();
        // Not under the root, a way out through `..`, a folder: all refused.
        assert!(!file(&root, &outside));
        assert!(!file(
            &root,
            &inside
                .join("..")
                .join("..")
                .join(outside.file_name().unwrap())
        ));
        assert!(!file(&root, &inside));
        assert!(outside.exists() && inside.exists());
        // A plain file under the root goes, and the second try finds nothing.
        assert!(file(&root, &file_in));
        assert!(!file(&root, &file_in));
        // Only this test's own scratch files.
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_file(&outside);
    }
}
