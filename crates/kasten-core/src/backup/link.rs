//! Linking a vault to a backup that already exists. A backup with nothing in
//! it is used at once; one that shares history with this vault is used too
//! (Get latest joins the two); one that shares none is refused, with three
//! ways forward.

use serde::Serialize;

/// What the person can do instead when a backup shares no history with the
/// vault.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LinkChoice {
    /// Choose a different backup.
    PickAnother,
    /// Make a new, empty backup for this vault.
    CreateNew,
    /// Restore that backup into a new folder, as its own vault.
    RestoreIntoNewFolder,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "result", rename_all = "camelCase")]
pub enum LinkResult {
    /// The vault now backs up to it. `empty`: it held nothing of this vault's
    /// line yet. `behind`: it has changes this vault lacks, so Get latest
    /// comes first.
    Linked { empty: bool, behind: bool },
    /// Nothing was changed; the three ways forward.
    Refused { choices: Vec<LinkChoice> },
}

impl LinkResult {
    pub(crate) fn refused() -> LinkResult {
        LinkResult::Refused {
            choices: vec![
                LinkChoice::PickAnother,
                LinkChoice::CreateNew,
                LinkChoice::RestoreIntoNewFolder,
            ],
        }
    }
}
