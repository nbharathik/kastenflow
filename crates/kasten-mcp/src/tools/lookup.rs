//! What the write tools name notes, boards and diagrams with. For an external
//! client and for a chat that writes directly that is the vault; for a chat
//! that previews its changes it is the vault with the chat's staged changes
//! on top, so a note it made a moment ago can be named, read and changed.

use std::sync::{Mutex, MutexGuard};

use kasten_core::agent::ChangeSet;
use kasten_core::frontmatter::split;
use kasten_core::{Kasten, Result};

/// The lookups a write tool needs to build its op.
pub(crate) trait Lookup {
    /// A note's path from its path, id or title.
    fn resolve(&self, reference: &str) -> Result<String>;
    /// A board's path from its path or title.
    fn resolve_board(&self, reference: &str) -> Result<String>;
    /// A diagram's path from its path or title.
    fn resolve_diagram(&self, reference: &str) -> Result<String>;
    /// A note's body as it is now.
    fn body_of(&self, path: &str) -> Result<String>;
    /// A diagram's source as it is now.
    fn diagram_xml(&self, path: &str) -> Result<String>;
    /// A note's id, if it has one.
    fn id_of(&self, path: &str) -> Result<Option<String>>;
    /// A saved search's path from its name or path.
    fn resolve_collection(&self, reference: &str) -> Result<String>;
    /// Where a trashed note is now, from that path, the path it had or its title.
    fn resolve_trashed(&self, reference: &str) -> Result<String>;
}

impl Lookup for Kasten {
    fn resolve(&self, reference: &str) -> Result<String> {
        Kasten::resolve(self, reference)
    }

    fn resolve_board(&self, reference: &str) -> Result<String> {
        Kasten::resolve_board(self, reference)
    }

    fn resolve_diagram(&self, reference: &str) -> Result<String> {
        Kasten::resolve_diagram(self, reference)
    }

    fn body_of(&self, path: &str) -> Result<String> {
        Ok(split(&self.read(path)?.text).body.to_owned())
    }

    fn diagram_xml(&self, path: &str) -> Result<String> {
        Ok(self.diagram(path)?.xml)
    }

    fn id_of(&self, path: &str) -> Result<Option<String>> {
        Ok(self.read(path)?.meta.id)
    }

    fn resolve_collection(&self, reference: &str) -> Result<String> {
        super::finders::collection_path(self, reference)
    }

    fn resolve_trashed(&self, reference: &str) -> Result<String> {
        super::finders::trashed_path(self, reference)
    }
}

/// The vault with a chat's staged changes on top.
pub(crate) struct Staged<'a> {
    pub kasten: &'a Kasten,
    pub set: &'a ChangeSet,
}

impl Lookup for Staged<'_> {
    fn resolve(&self, reference: &str) -> Result<String> {
        self.kasten.resolve_staged(self.set, reference)
    }

    fn resolve_board(&self, reference: &str) -> Result<String> {
        self.kasten.resolve_board_staged(self.set, reference)
    }

    fn resolve_diagram(&self, reference: &str) -> Result<String> {
        self.kasten.resolve_diagram_staged(self.set, reference)
    }

    fn body_of(&self, path: &str) -> Result<String> {
        Ok(split(&self.kasten.read_in(self.set, path)?.text)
            .body
            .to_owned())
    }

    fn diagram_xml(&self, path: &str) -> Result<String> {
        Ok(self.kasten.diagram_in(self.set, path)?.xml)
    }

    fn id_of(&self, path: &str) -> Result<Option<String>> {
        Ok(self.kasten.read_in(self.set, path)?.meta.id)
    }

    fn resolve_collection(&self, reference: &str) -> Result<String> {
        super::finders::collection_path(self.kasten, reference)
    }

    fn resolve_trashed(&self, reference: &str) -> Result<String> {
        super::finders::trashed_path(self.kasten, reference)
    }
}

/// How a call's writes reach the vault.
#[derive(Clone, Copy)]
pub enum Writes<'a> {
    /// At once, through the guardrails: an external client, and a chat the
    /// person lets write directly.
    Direct,
    /// Held back in the chat's change set, for the person to look at and
    /// apply or discard. Nothing reaches the vault.
    Staged(&'a Mutex<ChangeSet>),
}

/// What an agent is told of a change that was staged.
pub(crate) const STAGED_NOTE: &str = "Nothing was written to the vault yet. The change is staged: the person reviews the staged changes and applies or discards them. Later reads and writes in this chat see it as if it were saved.";

/// A change set, locked; a panic elsewhere does not lock it for good.
pub(crate) fn locked(set: &Mutex<ChangeSet>) -> MutexGuard<'_, ChangeSet> {
    set.lock().unwrap_or_else(|p| p.into_inner())
}
