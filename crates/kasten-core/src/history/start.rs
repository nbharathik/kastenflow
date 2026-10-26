//! Starting a vault's history, and tidying what an earlier version tracked.

use std::path::Path;

use git2::{IndexAddOption, Repository, RepositoryInitOptions};

use super::folder::{has_git_folder, ignore_local, stays_inside};
use super::locks::Writing;
use super::{Actor, History, keep_line_endings, local_only, open_here};
use crate::error::Result;

impl History {
    /// Starts history for a vault: a repository on `main`, the cache ignored,
    /// and a first commit of everything there.
    pub fn init(root: &Path, name: &str) -> Result<History> {
        // A repository made since the vault opened is checked before git
        // writes to it.
        if has_git_folder(root)?
            && let Ok(found) = open_here(root)
        {
            stays_inside(&found, root)?;
        }
        let repo = Repository::init_opts(root, RepositoryInitOptions::new().initial_head("main"))?;
        stays_inside(&repo, root)?;
        keep_line_endings(&repo)?;
        ignore_local(root)?;
        let history = History {
            repo: std::sync::Mutex::new(repo),
            root: root.to_owned(),
        };
        {
            let repo = history.repo();
            let mut index = repo.index()?;
            // Files too big for GitHub stay out of the first commit too.
            let mut too_big = Vec::new();
            let mut leave_out = |path: &Path, _: &[u8]| {
                let path = path.to_string_lossy().replace('\\', "/");
                if crate::backup::skip::too_big(root, &path) {
                    too_big.push(path);
                    1
                } else {
                    0
                }
            };
            index.add_all(["*"], IndexAddOption::DEFAULT, Some(&mut leave_out))?;
            if !too_big.is_empty() && crate::backup::skip::screen(root, &too_big).wrote {
                index.add_path(Path::new(crate::backup::SKIP_PATH))?;
            }
            index.write()?;
        }
        history.commit_index(&format!("init: {name}"), &Actor::Human, "init", &[])?;
        Ok(history)
    }

    /// Stops tracking local files an earlier version committed, keeping
    /// them on disk: one commit, or None when none are tracked.
    pub fn untrack_local(&self) -> Result<Option<String>> {
        self.clear_stale_locks();
        let _writing = Writing::start(&self.root);
        {
            let repo = self.repo();
            let mut index = repo.index()?;
            let tracked: Vec<String> = index
                .iter()
                .filter_map(|e| String::from_utf8(e.path).ok())
                .filter(|p| local_only(p))
                .collect();
            if tracked.is_empty() {
                return Ok(None);
            }
            for path in &tracked {
                index.remove_path(Path::new(path))?;
            }
            index.write()?;
        }
        self.commit_index(
            "untrack: KastenFlow's cache, which belongs to this computer",
            &Actor::Human,
            "untrack",
            &[],
        )
    }
}
