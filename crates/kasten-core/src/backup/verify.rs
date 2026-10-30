//! The weekly check of the backup itself: it still holds the commit this
//! computer last sent, and what was fetched from it reads back whole. Nothing
//! on the remote is changed and nothing in the vault is touched; the fetched
//! history waits in Kasten's own ref.

use git2::{Oid, Repository};
use serde::Serialize;

use crate::error::Result;
use crate::history::History;

/// How often the backup is checked: weekly.
pub const CHECK_EVERY_MS: u64 = 7 * 24 * 60 * 60 * 1000;

/// What the check found.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteCheck {
    /// The backup holds what was sent and what was fetched reads back.
    pub ok: bool,
    /// When the backup was last found whole: now when `ok`, else the earlier
    /// time, if any.
    pub verified_at: Option<u64>,
    /// Objects of the newly fetched history that were read back.
    pub objects: u32,
    /// Plain sentences on what is wrong; empty when `ok`.
    pub problems: Vec<String>,
}

impl History {
    /// Reads back every object of the commits `tip` reaches that none of
    /// `known` reaches (what a fetch just brought): the number read, and a
    /// sentence for each thing that cannot be.
    pub fn read_back(&self, tip: &str, known: &[&str]) -> Result<(u32, Vec<String>)> {
        let tip = Oid::from_str(tip)?;
        // A handle of its own: the shared one is never held for a long read.
        let path = self.repo().path().to_owned();
        let repo = Repository::open(path)?;
        let mut walk = repo.revwalk()?;
        walk.push(tip)?;
        for known in known.iter().filter_map(|k| Oid::from_str(k).ok()) {
            let _ = walk.hide(known);
        }
        let mut pack = repo.packbuilder()?;
        if let Err(err) = pack.insert_walk(&mut walk) {
            return Ok((
                0,
                vec![format!("The backup's history is incomplete here: {err}")],
            ));
        }
        let count = u32::try_from(pack.object_count()).unwrap_or(u32::MAX);
        // Writing the pack reads and packs each object, and fails on one that
        // cannot be read; the bytes are not kept.
        match pack.foreach(|_| true) {
            Ok(()) => Ok((count, Vec::new())),
            Err(err) => Ok((
                count,
                vec![format!(
                    "Part of the backup's history cannot be read: {err}"
                )],
            )),
        }
    }
}
