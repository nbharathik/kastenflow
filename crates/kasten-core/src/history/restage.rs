//! Making the staging area follow the files again after changes were put
//! back by hand (a failed batch): a commit that failed part way may have left
//! the batch's files staged, and the next commit would then take them in.

use std::path::Path;

use super::{History, local_only};
use crate::error::Result;

impl History {
    /// Stages `paths` as they are on disk now: a file that is there is staged
    /// as it is, one that is gone is taken out. Nothing is committed.
    pub(crate) fn restage(&self, paths: &[String]) -> Result<()> {
        if paths.is_empty() {
            return Ok(());
        }
        let repo = self.repo();
        let mut index = repo.index()?;
        for path in paths.iter().filter(|p| !local_only(p)) {
            let rel = Path::new(path);
            if self.root.join(rel).is_file() {
                index.add_path(rel)?;
            } else if index.get_path(rel, 0).is_some() {
                index.remove_path(rel)?;
            }
        }
        index.write()?;
        Ok(())
    }
}
