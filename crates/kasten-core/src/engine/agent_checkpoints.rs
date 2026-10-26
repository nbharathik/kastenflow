//! Checkpoints through the engine: noted before an autonomous session's first
//! write and before a big batch, listed for History ("Restore to before this
//! session"), and restored by the vault restore that already exists, which
//! only adds commits.

use super::{Kasten, VaultRestore};
use crate::agent::Session;
use crate::config::CONFIG_PATH;
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::id::ulid_at;
use crate::policy::{
    BATCH_CHECKPOINT_OVER, Checkpoint, SESSION_LABEL, load_checkpoints, record_checkpoint,
};
use crate::time::Instant;

impl Kasten {
    /// Notes where the vault is now, if `session` is about to write in
    /// autonomous mode for the first time (`autonomous`), or is about to send
    /// a batch of more than 20 ops (`ops`). Returns the checkpoint it made. A
    /// vault with no history has nothing to go back to and gets none.
    pub fn maybe_checkpoint(
        &self,
        session: &Session,
        autonomous: bool,
        ops: usize,
        now: Instant,
    ) -> Result<Option<Checkpoint>> {
        let Some(history) = self.history.get() else {
            return Ok(None);
        };
        let first = autonomous
            && !load_checkpoints(self.vault.root())
                .iter()
                .any(|c| c.session == session.id && c.label == SESSION_LABEL);
        let label = if first {
            SESSION_LABEL.to_owned()
        } else if ops > BATCH_CHECKPOINT_OVER {
            format!("Before a batch of {ops} changes")
        } else {
            return Ok(None);
        };
        // What a person typed or changed outside goes into history first, so
        // the checkpoint is the vault as it is now and restoring keeps it.
        self.commit_edits()?;
        self.commit_external()?;
        let Some(head) = history.head() else {
            return Ok(None);
        };
        let checkpoint = Checkpoint {
            id: ulid_at(now.millis),
            session: session.id.clone(),
            head,
            time: now.millis,
            label,
        };
        self.lock
            .hold(|| record_checkpoint(self.vault.root(), checkpoint.clone()))?;
        Ok(Some(checkpoint))
    }

    /// The checkpoints, newest first.
    pub fn list_checkpoints(&self) -> Result<Vec<Checkpoint>> {
        let mut all = load_checkpoints(self.vault.root());
        all.reverse();
        Ok(all)
    }

    /// Puts the vault back as it was at a checkpoint, as new commits: what
    /// changed since is undone, notes made since go to the trash, and history
    /// is never rewritten. A person's op; the checkpoint stays in the list.
    /// `.kasten/config.yaml` stays as it is now: going back in time must not
    /// bring back an older agent mode (or plugin settings) that a person has
    /// changed since.
    pub fn restore_to_checkpoint(&self, id: &str, now: Instant) -> Result<VaultRestore> {
        let checkpoint = load_checkpoints(self.vault.root())
            .into_iter()
            .find(|c| c.id == id)
            .ok_or_else(|| Error::NotFound(format!("checkpoint {id}")))?;
        self.restore_vault_keeping(&Actor::Human, &checkpoint.head, now, &[CONFIG_PATH])
    }
}
