//! Putting a many-file op back when a later step fails, so the vault is
//! never left half imported or half restored. Only what the op itself did
//! is undone: files it made are removed, with the folders it made for them
//! once they are empty again, files it replaced get their bytes back, and
//! files it moved go back where they were.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::atomic::{create_atomic, write_atomic};

enum Step {
    Folder(PathBuf),
    Made(PathBuf),
    Replaced(PathBuf, Vec<u8>),
    Moved { from: PathBuf, to: PathBuf },
}

/// The steps an op took so far, to undo last first.
#[derive(Default)]
pub(crate) struct Rollback {
    steps: Vec<Step>,
}

impl Rollback {
    /// Makes a new file, as `create_atomic` does.
    pub(crate) fn create(&mut self, file: &Path, bytes: &[u8]) -> io::Result<()> {
        self.folders_for(file);
        create_atomic(file, bytes)?;
        self.steps.push(Step::Made(file.to_owned()));
        Ok(())
    }

    /// Notes a file the op made by other means, so that putting back removes it.
    pub(crate) fn made(&mut self, file: &Path) {
        self.steps.push(Step::Made(file.to_owned()));
    }

    /// Notes a file the op changed by other means: putting back writes
    /// `before` into it again.
    pub(crate) fn replaced(&mut self, file: &Path, before: Vec<u8>) {
        self.steps.push(Step::Replaced(file.to_owned(), before));
    }

    /// Writes `file` as `write_atomic` does; `before` is what it held, if
    /// it was there.
    pub(crate) fn write(
        &mut self,
        file: &Path,
        bytes: &[u8],
        before: Option<Vec<u8>>,
    ) -> io::Result<()> {
        self.folders_for(file);
        write_atomic(file, bytes)?;
        self.steps.push(match before {
            Some(before) => Step::Replaced(file.to_owned(), before),
            None => Step::Made(file.to_owned()),
        });
        Ok(())
    }

    /// Moves a file, making the folders it goes into.
    pub(crate) fn rename(&mut self, from: &Path, to: &Path) -> io::Result<()> {
        self.folders_for(to);
        if let Some(dir) = to.parent() {
            fs::create_dir_all(dir)?;
        }
        fs::rename(from, to)?;
        self.steps.push(Step::Moved {
            from: from.to_owned(),
            to: to.to_owned(),
        });
        Ok(())
    }

    /// Notes the folders `file` needs that are not there yet, outermost
    /// first, so they go after what is put in them.
    fn folders_for(&mut self, file: &Path) {
        let mut missing = Vec::new();
        let mut dir = file.parent();
        while let Some(folder) = dir.filter(|d| fs::symlink_metadata(d).is_err()) {
            missing.push(Step::Folder(folder.to_owned()));
            dir = folder.parent();
        }
        self.steps.extend(missing.into_iter().rev());
    }

    /// Takes over the steps of `later`, which were taken after these, so
    /// that putting back undoes all of them.
    pub(crate) fn append(&mut self, later: Rollback) {
        self.steps.extend(later.steps);
    }

    /// Undoes every step, the last first. A step that cannot be undone is
    /// left as it is, and the rest still are.
    pub(crate) fn put_back(self) {
        for step in self.steps.into_iter().rev() {
            let _ = match step {
                // Only an empty folder goes.
                Step::Folder(dir) => fs::remove_dir(dir),
                Step::Made(file) => fs::remove_file(file),
                Step::Replaced(file, before) => write_atomic(&file, &before),
                Step::Moved { from, to } => fs::rename(to, from),
            };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn puts_back_what_it_made_replaced_and_moved() {
        let dir = std::env::temp_dir().join(format!(
            "kasten-rollback-{}",
            crate::ulid_at(crate::Instant::now().millis)
        ));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("kept.md"), "before").unwrap();
        fs::write(dir.join("moving.md"), "moving").unwrap();

        let mut done = Rollback::default();
        done.create(&dir.join("new/deep/made.md"), b"made").unwrap();
        done.write(&dir.join("kept.md"), b"after", Some(b"before".to_vec()))
            .unwrap();
        done.rename(&dir.join("moving.md"), &dir.join("away/moving.md"))
            .unwrap();
        // Someone else's file in a folder it made keeps that folder.
        fs::write(dir.join("new/theirs.md"), "theirs").unwrap();
        done.put_back();

        assert!(!dir.join("new/deep").exists());
        assert_eq!(
            fs::read_to_string(dir.join("new/theirs.md")).unwrap(),
            "theirs"
        );
        assert_eq!(fs::read_to_string(dir.join("kept.md")).unwrap(), "before");
        assert_eq!(fs::read_to_string(dir.join("moving.md")).unwrap(), "moving");
        assert!(!dir.join("away").exists());
        fs::remove_dir_all(&dir).unwrap();
    }
}
