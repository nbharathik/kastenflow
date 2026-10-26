//! What "Back up now" answers, and what carrying on with a rewritten backup
//! reports. Always a typed answer, never silence.

use serde::Serialize;

/// The answer to "Back up now": done, nothing to do, or the reason.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "answer", rename_all = "camelCase")]
pub enum BackUpNow {
    /// The changes went to the backup: `sent` is how many.
    Done { sent: u32 },
    /// The backup already holds everything.
    NothingToDo,
    /// Nothing was sent, and why.
    Not { reason: NotBackedUp },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum NotBackedUp {
    /// The vault keeps no history yet.
    NoHistory,
    /// No backup is set up.
    NoBackup,
    /// A backup is named in the vault's settings but this computer has not
    /// confirmed it.
    NotConfirmed,
    /// The backup was rewritten and no longer holds what this computer sent.
    LostHistory,
    /// The backup has changes from another computer: get the latest first.
    Behind,
    /// The push failed; `message` is the plain reason.
    Failed { message: String },
}

impl BackUpNow {
    /// Whether the backup is up to date after this answer.
    pub fn is_ok(&self) -> bool {
        matches!(self, BackUpNow::Done { .. } | BackUpNow::NothingToDo)
    }

    /// The answer as one plain sentence.
    pub fn message(&self) -> String {
        match self {
            BackUpNow::Done { sent: 1 } => "Backed up: 1 change sent.".to_owned(),
            BackUpNow::Done { sent } => format!("Backed up: {sent} changes sent."),
            BackUpNow::NothingToDo => {
                "Nothing to back up: the backup already has every change.".to_owned()
            }
            BackUpNow::Not { reason } => reason.message(),
        }
    }
}

impl NotBackedUp {
    pub fn message(&self) -> String {
        match self {
            NotBackedUp::NoHistory => {
                "This vault keeps no history yet, so there is nothing to back up. Turn history on first.".to_owned()
            }
            NotBackedUp::NoBackup => "No backup is set up for this vault.".to_owned(),
            NotBackedUp::NotConfirmed => {
                "The backup named in this vault's settings is not confirmed on this computer yet.".to_owned()
            }
            NotBackedUp::LostHistory => {
                "The backup was rewritten and no longer holds what this computer sent it, so nothing was sent. Save this computer's full history to a safety branch, or carry on with the backup as it is now.".to_owned()
            }
            NotBackedUp::Behind => {
                "The backup has changes from another computer. Get the latest first, then back up.".to_owned()
            }
            NotBackedUp::Failed { message } => message.clone(),
        }
    }
}

/// What carrying on with a rewritten backup found.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CarryOn {
    /// Where the backup's branch stands now, or none when it has no such
    /// branch (the next backup makes it).
    pub tip: Option<String>,
    /// Whether the next backup can go on top of it. When false, this
    /// computer's history and the backup's share nothing, and a backup is
    /// refused as behind until the person decides what to do.
    pub can_push: bool,
}
