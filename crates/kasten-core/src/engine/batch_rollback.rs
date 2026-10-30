//! Putting a failed batch back (the run itself is batch_apply.rs). Only the
//! files the batch wrote go back to what the last commit holds; a file another
//! program changed meanwhile is left as it is and named in the error, and a file
//! with changes History does not hold is never touched by a batch at all.

use std::collections::BTreeSet;
use std::fs;

use super::{Kasten, Revision};
use crate::agent::{AgentOp, Tally};
use crate::atomic::write_atomic;
use crate::error::{Error, Result};
use crate::history::{Actor, History};
use crate::rollback::Rollback;

/// What the batch has to put back if it fails.
pub(super) struct Before {
    /// Files already differing from the last commit when the batch began.
    pub dirty: BTreeSet<String>,
    /// The session's soft-limit tally.
    pub tally: Option<Tally>,
}

/// What a failed batch did not put back.
pub(super) struct Left {
    /// Files of the batch that could not be put back.
    stuck: Vec<String>,
    /// Files that changed meanwhile but not by the batch: another program's
    /// edits, which are not the batch's to undo.
    others: Vec<String>,
}

impl Left {
    /// `err`, and what was not put back, if anything.
    pub(super) fn told(self, err: Error) -> Error {
        let mut text = err.to_string();
        if !self.stuck.is_empty() {
            text.push_str(&format!(
                " Some files could not be put back as they were ({}); History can restore them.",
                self.stuck.join(", ")
            ));
        }
        if !self.others.is_empty() {
            text.push_str(&format!(
                " Files changed by something else meanwhile were left as they are ({}).",
                self.others.join(", ")
            ));
        }
        if self.stuck.is_empty() && self.others.is_empty() {
            return err;
        }
        Error::Invalid(text)
    }
}

impl Kasten {
    /// A batch may not touch a file that has changes History does not hold
    /// (one too big to back up, say): if it failed, those changes could not be
    /// told from the batch's own, and putting the file back would lose them.
    pub(super) fn refuse_unsaved(&self, ops: &[AgentOp], unsaved: &BTreeSet<String>) -> Result<()> {
        if !unsaved.is_empty() {
            for op in ops {
                let Ok((paths, _)) = self.touches(op) else {
                    continue;
                };
                if let Some(path) = paths.iter().find(|p| unsaved.contains(*p)) {
                    return Err(Error::Invalid(format!(
                        "{path} has changes that History has not saved (it may be too big to back up), so a batch will not touch it. Nothing in the batch was changed. Make these changes one at a time"
                    )));
                }
            }
        }
        self.refuse_unheld(ops)
    }

    /// A note on disk that no commit holds (one the vault's own ignore list
    /// keeps out of History, say) would be taken for a file the batch made,
    /// and removed if the batch failed: a batch does not touch it.
    fn refuse_unheld(&self, ops: &[AgentOp]) -> Result<()> {
        let Some(history) = self.history.get() else {
            return Ok(());
        };
        for path in ops.iter().flat_map(super::batch_person::named) {
            let there = self
                .vault
                .tracked_file(path)
                .is_ok_and(|file| file.is_file());
            if there && history.blob_at("HEAD", path).ok().flatten().is_none() {
                return Err(Error::Invalid(format!(
                    "{path} is not in History (the vault's ignore list keeps it out, say), so a batch will not touch it. Nothing in the batch was changed. Make these changes one at a time"
                )));
            }
        }
        Ok(())
    }

    /// Puts every file the batch wrote (`made`) back to the last commit,
    /// except those already changed when it began. The staging area follows
    /// (a commit that failed part way may have staged them), the counters
    /// that follow the files are bumped (the revision is returned for the
    /// listener), and the paths that could not be put back are returned.
    /// Files that changed meanwhile but not by the batch (another program's
    /// edit) are left as they are, and said.
    pub(super) fn put_back(
        &self,
        history: &History,
        actor: &Actor,
        before: &Before,
        made: &[String],
    ) -> (Option<Revision>, Left) {
        let mut stuck = Vec::new();
        let mut restored = Vec::new();
        for path in made.iter().filter(|p| !before.dirty.contains(*p)) {
            match self.restore_one(history, path) {
                Ok(()) => restored.push(path.clone()),
                Err(_) => stuck.push(path.clone()),
            }
        }
        if history.restage(&restored).is_err() {
            stuck.push("(the list of changes History keeps)".to_owned());
        }
        let others = match history.dirty() {
            Ok(dirty) => dirty
                .into_iter()
                .filter(|p| !before.dirty.contains(p) && !made.contains(p))
                .collect(),
            Err(_) => Vec::new(),
        };
        if let Some(session) = actor.session() {
            let mut state = self.state();
            match &before.tally {
                Some(tally) => {
                    state.tallies.insert(session.to_owned(), tally.clone());
                }
                None => {
                    state.tallies.remove(session);
                }
            }
        }
        self.refresh_or_later(&restored);
        let revision = (!restored.is_empty()).then(|| self.bump(&restored));
        (revision, Left { stuck, others })
    }

    /// One file as the last commit has it; a file the commit does not have is
    /// one the batch made, and goes, with the folders it leaves empty.
    fn restore_one(&self, history: &History, path: &str) -> Result<()> {
        let file = self.vault.tracked_file(path)?;
        match history.blob_at("HEAD", path)? {
            Some(bytes) => {
                if let Some(dir) = file.parent() {
                    fs::create_dir_all(dir)?;
                }
                write_atomic(&file, &bytes)?;
            }
            None => {
                // The file this batch made, in no commit: put back like any
                // failed op's own file (rollback.rs), not deleted by this code.
                if fs::symlink_metadata(&file).is_ok() {
                    let mut made = Rollback::default();
                    made.made(&file);
                    made.put_back();
                    if fs::symlink_metadata(&file).is_ok() {
                        return Err(Error::Invalid(format!("{path} could not be put back")));
                    }
                }
                let root = self.vault.root();
                let mut dir = file.parent();
                while let Some(d) = dir.filter(|d| *d != root) {
                    if fs::remove_dir(d).is_err() {
                        break;
                    }
                    dir = d.parent();
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::time::Instant;

    /// What another program wrote while a batch ran is not the batch's to
    /// undo: the files the batch wrote go back, that one stays and is named,
    /// and nothing of it is left staged for the next commit.
    #[test]
    fn a_file_another_program_changed_meanwhile_stays_when_the_batch_is_put_back() {
        let dir = std::env::temp_dir().join(format!(
            "kasten-put-back-{}",
            crate::ulid_at(Instant::now().millis)
        ));
        let k = Kasten::init(&dir, "Put back").unwrap();
        let now = Instant::now();
        let a = k.capture(&Actor::Human, "Alpha card.", &[], now).unwrap();
        let b = k.capture(&Actor::Human, "Beta card.", &[], now).unwrap();
        k.commit_edits().unwrap();
        let history = k.history.get().unwrap();
        let (a, b) = (a.meta.path, b.meta.path);
        let (file_a, file_b) = (dir.join(&a), dir.join(&b));
        let (kept_a, kept_b) = (fs::read(&file_a).unwrap(), fs::read(&file_b).unwrap());

        // The batch changes a and makes c; another program edits b meanwhile.
        fs::write(&file_a, b"changed by the batch").unwrap();
        let made = "inbox/made-by-the-batch.md".to_owned();
        fs::create_dir_all(dir.join("inbox")).unwrap();
        fs::write(dir.join(&made), b"made by the batch").unwrap();
        fs::write(&file_b, b"typed in another editor").unwrap();

        let before = Before {
            dirty: BTreeSet::new(),
            tally: None,
        };
        let (_, left) = k.put_back(history, &Actor::Human, &before, &[a.clone(), made.clone()]);

        assert_eq!(
            fs::read(&file_a).unwrap(),
            kept_a,
            "the batch's change is gone"
        );
        assert!(!dir.join(&made).exists(), "the note it made is gone");
        assert_eq!(
            fs::read(&file_b).unwrap(),
            b"typed in another editor",
            "the other program's edit stays"
        );
        assert!(left.stuck.is_empty(), "{:?}", left.stuck);
        assert_eq!(left.others, vec![b.clone()], "and is named");
        let told = left.told(Error::Invalid("It failed.".into())).to_string();
        assert!(
            told.contains("left as they are") && told.contains(&b),
            "{told}"
        );
        // Not staged: the next commit holds only what it is given.
        let staged = history.dirty().unwrap();
        assert_eq!(staged, vec![b.clone()]);
        assert_ne!(fs::read(&file_b).unwrap(), kept_b);
        drop(k);
        let _ = fs::remove_dir_all(&dir);
    }
}
