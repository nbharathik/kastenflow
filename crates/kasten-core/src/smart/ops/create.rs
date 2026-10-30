//! The files of a smart page that is made whole in one go: all checked before
//! the page exists, then written one after the other, each one noted so that a
//! failure puts the folder back as it was.

use std::collections::HashSet;

use super::write::{Written, check_write};
use crate::error::{Error, Result};
use crate::rollback::Rollback;
use crate::smart::files::hash_bytes;
use crate::smart::limits::{check_file_size, check_totals};
use crate::smart::{INDEX_FILE, MANIFEST_FILE, MAX_FILES, check_path};
use crate::vault::Vault;

/// Checks the files of a folder that does not exist yet, as the write ops
/// would one by one: the form of every path, the sizes, the manifest, no name
/// twice (a Mac or Windows computer ignores case), and an `index.html`, which
/// is what the page shows.
pub fn check_new(files: &[(&str, &[u8])]) -> Result<()> {
    if files.is_empty() {
        return Err(Error::Invalid(
            "A smart page needs files: at least an index.html".to_owned(),
        ));
    }
    if files.len() > MAX_FILES {
        return Err(Error::Invalid(format!(
            "A smart page's folder may hold at most {MAX_FILES} files"
        )));
    }
    let mut names = HashSet::new();
    let mut held = 0u64;
    for (rel, bytes) in files {
        check_path(rel)?;
        check_file_size(bytes.len())?;
        if !names.insert(rel.to_ascii_lowercase()) {
            return Err(Error::Invalid(format!(
                "{rel} is sent twice (names that differ only in case are one file on a Mac or in Windows)"
            )));
        }
        if *rel == MANIFEST_FILE {
            let text = std::str::from_utf8(bytes)
                .map_err(|_| Error::Invalid(format!("{MANIFEST_FILE} must be text")))?;
            crate::smart::check_manifest(text)?;
        }
        check_totals((held, names.len() - 1), bytes.len(), true)?;
        held += bytes.len() as u64;
    }
    // A name cannot be a file and also hold files.
    for (rel, _) in files {
        let lower = rel.to_ascii_lowercase();
        for (at, _) in lower.match_indices('/') {
            if names.contains(&lower[..at]) {
                return Err(Error::Invalid(format!(
                    "{} is a file, and {rel} would need it to be a folder",
                    &rel[..at]
                )));
            }
        }
    }
    if !files.iter().any(|(rel, _)| *rel == INDEX_FILE) {
        return Err(Error::Invalid(format!(
            "A smart page needs an {INDEX_FILE}: it is what the page shows"
        )));
    }
    Ok(())
}

/// Writes `files` into the folder of `page` (which is there, with no folder
/// yet). Every file is new. What was written is noted in `done`, so a later
/// failure can put it back.
pub(crate) fn write_new(
    vault: &Vault,
    page: &str,
    files: &[(&str, &[u8])],
    done: &mut Rollback,
) -> Result<Vec<Written>> {
    let mut out = Vec::with_capacity(files.len());
    for (rel, bytes) in files {
        let prepared = check_write(vault, page, rel, bytes, Some(""))?;
        done.create(&vault.tracked_file(&prepared.path)?, bytes)?;
        out.push(Written {
            path: prepared.path,
            rel: (*rel).to_owned(),
            hash: hash_bytes(bytes),
            created: true,
            changed: true,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_is_not_a_file_and_a_folder() {
        assert!(check_new(&[("index.html", b"x"), ("a.js/b.js", b"y")]).is_ok());
        assert!(check_new(&[("index.html", b"x"), ("a.js", b"y"), ("a.js/b.js", b"y")]).is_err());
        assert!(check_new(&[("index.html", b"x"), ("a.js/b.js", b"y"), ("A.JS", b"y")]).is_err());
    }

    #[test]
    fn a_failure_half_way_through_the_files_puts_the_folder_back() {
        let root = std::env::temp_dir().join(format!(
            "kasten-new-smart-{}",
            crate::ulid_at(crate::Instant::now().millis)
        ));
        std::fs::create_dir_all(root.join("library")).unwrap();
        std::fs::write(root.join("library/p.md"), "---\ntitle: P\n---\n").unwrap();
        let vault = Vault::open(&root).unwrap();
        // The third file needs the second to be a folder: it fails after the
        // first two were written (check_new would have refused it up front).
        let files: [(&str, &[u8]); 3] = [("index.html", b"x"), ("a.js", b"y"), ("a.js/b.js", b"z")];
        let mut done = Rollback::default();
        assert!(write_new(&vault, "library/p.md", &files, &mut done).is_err());
        assert!(root.join("library/p.smart/a.js").exists());
        done.put_back();
        assert!(!root.join("library/p.smart").exists(), "the folder is gone");
        assert!(
            root.join("library/p.md").exists(),
            "the page is not this function's"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_folder_needs_an_index_and_good_names() {
        assert!(check_new(&[("index.html", b"x")]).is_ok());
        assert!(check_new(&[]).is_err());
        assert!(check_new(&[("app.js", b"x")]).is_err());
        assert!(check_new(&[("index.html", b"x"), ("INDEX.html", b"y")]).is_err());
        assert!(check_new(&[("index.html", b"x"), ("x.exe", b"y")]).is_err());
        assert!(check_new(&[("index.html", b"x"), ("smart.yaml", b"title: ''\n")]).is_err());
    }
}
