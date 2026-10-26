//! Getting the latest by itself. A fast-forward is taken when nothing here is
//! waiting (no commit the backup lacks, no change not yet committed) and no
//! open page has unsaved edits. A merge is never done by itself: it asks.

use serde::Serialize;

/// What a look at the backup did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "result", rename_all = "camelCase")]
pub enum AutoPull {
    /// Not tried, and why. Nothing was fetched or changed.
    Held { why: Held },
    /// The backup holds nothing this vault lacks.
    UpToDate,
    /// Other computers' changes were taken in as they are. `changes` counts
    /// the saved changes (commits) brought in, `files` the files that changed
    /// here.
    Brought {
        changes: usize,
        files: usize,
        head: String,
    },
    /// The backup has changes to take, and the person decides: they are set
    /// to be asked, or a merge with changes made here is needed (`merge`).
    Available { merge: bool },
}

/// Why a look was not made, or not acted on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Held {
    /// No backup is set up, or this computer has not confirmed it.
    NoBackup,
    /// The setting is manual.
    Manual,
    /// The backup was rewritten and pushes have stopped.
    LostHistory,
    /// A Get latest was stopped part way and waits to be finished.
    Unfinished,
    /// An open page has unsaved edits.
    UnsavedEdits,
    /// A change here is waiting: not yet committed, or not yet backed up.
    WaitingHere,
    /// The backup shares no history with this vault.
    Unrelated,
}
