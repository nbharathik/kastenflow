//! Smart pages in the engine: reading a page's code folder and the person's
//! ops on it (write a file, take one out, put one back, set the manifest).
//! Each is one change that Undo takes back. A person's typing in the code
//! editor is saved at once and committed after the quiet spell, as a page's
//! text is. Agents use `AgentOp::SmartWrite` and `SmartDelete` instead
//! (`smart_agent.rs`): the public ops here refuse them.

use super::ops::title_of;
use super::{Change, Kasten};
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::smart::ops::{self, Deleted, TrashedFile, Written};
use crate::smart::{SmartBytes, SmartListing, SmartManifest};
use crate::time::Instant;

/// Refuses an agent: it changes a smart page's files through the agent ops,
/// which the modes and the page's lock hold.
pub(super) fn person_only(actor: &Actor) -> Result<()> {
    if actor.is_agent() {
        return Err(Error::Invalid(
            "Agents change a smart page's files with smart_write and smart_delete; the file ops are for a person"
                .to_owned(),
        ));
    }
    Ok(())
}

impl Kasten {
    /// What the code folder of the smart page at `page` holds: its files, the
    /// manifest and what is wrong with either. Not there yet is not an error.
    pub fn smart_read(&self, page: &str) -> Result<SmartListing> {
        crate::smart::listing(&self.vault, page)
    }

    /// One file of the page's folder: its bytes, and the hash to write it
    /// against.
    pub fn smart_file(&self, page: &str, rel: &str) -> Result<SmartBytes> {
        crate::smart::read_file(&self.vault, page, rel)
    }

    /// The page's manifest; none when it has no `smart.yaml`.
    pub fn smart_manifest(&self, page: &str) -> Result<Option<SmartManifest>> {
        crate::smart::read_manifest(&self.vault, page)
    }

    /// The files of the page's folder in the trash that can come back.
    pub fn smart_trashed(&self, page: &str) -> Result<Vec<TrashedFile>> {
        ops::trashed_files(&self.vault, page)
    }

    /// Writes a file of the page's folder (`index.html`, `data/venues.json`).
    /// `base_hash` is the hash the file was read with: `Some("")` says it is
    /// new, `None` that the writer does not mind what is there. The limits
    /// (2 MB a file, 10 MB the folder) and the path rules hold here.
    pub fn smart_write_file(
        &self,
        actor: &Actor,
        page: &str,
        rel: &str,
        bytes: &[u8],
        base_hash: Option<&str>,
        now: Instant,
    ) -> Result<Written> {
        person_only(actor)?;
        self.smart_write_as(actor, page, rel, bytes, base_hash, now)
    }

    /// `smart_write_file` for whoever the rules have let through.
    pub(super) fn smart_write_as(
        &self,
        actor: &Actor,
        page: &str,
        rel: &str,
        bytes: &[u8],
        base_hash: Option<&str>,
        now: Instant,
    ) -> Result<Written> {
        // A person's typing is committed after a quiet spell; an agent's op at once.
        self.apply(
            actor,
            "smart_write",
            !actor.is_agent(),
            now.millis,
            |vault| {
                let written = ops::write_file(vault, page, rel, bytes, base_hash)?;
                Ok(Change {
                    message: format!("edit: {} ({rel})", title_of(vault, page)),
                    paths: if written.changed {
                        vec![written.path.clone()]
                    } else {
                        Vec::new()
                    },
                    value: written,
                })
            },
        )
    }

    /// Takes a file out of the page's folder. It goes to the trash, where it
    /// can be put back; nothing is deleted for good.
    pub fn smart_delete_file(
        &self,
        actor: &Actor,
        page: &str,
        rel: &str,
        now: Instant,
    ) -> Result<Deleted> {
        person_only(actor)?;
        self.smart_delete_as(actor, page, rel, now)
    }

    /// `smart_delete_file` for whoever the rules have let through.
    pub(super) fn smart_delete_as(
        &self,
        actor: &Actor,
        page: &str,
        rel: &str,
        now: Instant,
    ) -> Result<Deleted> {
        self.apply(actor, "smart_delete", false, now.millis, |vault| {
            let deleted = ops::delete_file(vault, page, rel, now)?;
            Ok(Change {
                message: format!("trash: {rel} of {}", title_of(vault, page)),
                paths: vec![deleted.from.clone(), deleted.trashed.clone()],
                value: deleted,
            })
        })
    }

    /// Puts a file back from the trash (`smart_trashed` lists them); returns
    /// where it came back to. It never replaces a file.
    pub fn smart_restore_file(&self, actor: &Actor, trashed: &str, now: Instant) -> Result<String> {
        person_only(actor)?;
        self.apply(actor, "smart_restore", false, now.millis, |vault| {
            let restored = ops::restore_file(vault, trashed)?;
            let name = restored.rsplit('/').next().unwrap_or(&restored).to_owned();
            Ok(Change {
                message: format!("restore: {name}"),
                paths: vec![trashed.to_owned(), restored.clone()],
                value: restored,
            })
        })
    }

    /// Sets the page's manifest. It has to pass its checks, and the keys this
    /// version does not know that `manifest` carries stay in the file.
    pub fn smart_set_manifest(
        &self,
        actor: &Actor,
        page: &str,
        manifest: &SmartManifest,
        base_hash: Option<&str>,
        now: Instant,
    ) -> Result<Written> {
        person_only(actor)?;
        self.apply(actor, "smart_manifest", false, now.millis, |vault| {
            let written = ops::set_manifest(vault, page, manifest, base_hash)?;
            Ok(Change {
                message: format!(
                    "edit: {} ({})",
                    title_of(vault, page),
                    crate::smart::MANIFEST_FILE
                ),
                paths: if written.changed {
                    vec![written.path.clone()]
                } else {
                    Vec::new()
                },
                value: written,
            })
        })
    }
}
