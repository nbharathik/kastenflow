//! The types the window and the backup commands share for the simpler GitHub
//! backup set-up and its status line. The commands are in `github_cmds.rs`
//! and `status_cmds.rs`. The same shapes are written in
//! `app/src/lib/vault/backup-types.ts`, field for field (camelCase).

use kasten_core::backup::LinkChoice;
use serde::{Deserialize, Serialize};

/// Whether the backup repository can be read by others.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Visibility {
    Private,
    Public,
    #[default]
    Unknown,
}

/// Whether the repository guards its history against being rewritten.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum ProtectionState {
    Protected,
    Unprotected,
    #[default]
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Protection {
    pub state: ProtectionState,
    /// One plain sentence on why, when it is not protected or not known.
    pub reason: Option<String>,
}

/// A file left out of the backup, for example for its size.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedFile {
    pub path: String,
    pub size: u64,
    /// When it was first left out (ISO time).
    pub since: String,
}

/// A file that is backed up but large enough for GitHub to warn about.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LargeFile {
    pub path: String,
    pub size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    /// Changes are waiting to go to the backup.
    pub waiting: bool,
    /// How many changes are waiting.
    pub unpushed: u32,
    /// When the backup was last read back and found to match (ISO time).
    pub verified_at: Option<String>,
    pub skipped: Vec<SkippedFile>,
    /// Files backed up that GitHub warns about for their size.
    pub warn: Vec<LargeFile>,
    pub visibility: Visibility,
    /// Pushing is paused: the repository is public and the person has not
    /// said they want a public backup.
    pub paused: bool,
    pub protection: Protection,
    /// The backup lost history that this computer still has.
    pub lost_history: bool,
    /// The safety branch this computer's full history was last saved to.
    pub recovered_branch: Option<String>,
    /// When the last backup finished (ISO time).
    pub last_backup_at: Option<String>,
    /// What the history takes on this computer, in bytes, when known.
    pub repo_size: Option<u64>,
    pub repo_url: Option<String>,
}

/// One repository in the picker.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoRow {
    pub name: String,
    pub full_name: String,
    pub clone_url: String,
    pub html_url: String,
    pub updated_at: Option<String>,
    pub visibility: Visibility,
    /// A repository KastenFlow made for a backup (listed first).
    pub is_backup: bool,
}

/// One page of the picker's repositories.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RepoPage {
    pub repos: Vec<RepoRow>,
    pub has_more: bool,
}

/// What a repository holds, next to this vault's history.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum RepoContent {
    /// Nothing has been pushed to it yet.
    Empty,
    /// It shares a commit with this vault's history.
    ThisVault,
    /// It holds something that is not this vault's.
    Unrelated,
    /// Not looked at (the vault has no history to compare).
    #[default]
    Unknown,
}

/// What looking at a repository found.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RepoCheck {
    /// False when GitHub shows nothing by that name to this sign-in.
    pub exists: bool,
    pub visibility: Visibility,
    pub protection: Protection,
    /// Nothing has been pushed to it yet.
    pub empty: bool,
    pub content: RepoContent,
}

/// Who a token or the GitHub command line signed in as.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignedIn {
    pub login: String,
    /// The repository chosen along with the sign-in, if one was given.
    pub repo: Option<RepoRow>,
    /// Kept in the keychain; false when this computer has none KastenFlow
    /// can use, and the sign-in lasts only until KastenFlow closes.
    pub remembered: bool,
}

/// The page where GitHub lets the person take access back for good.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevokeLink {
    pub url: String,
    /// The sign-in is not in the keychain, so it ends when KastenFlow closes.
    pub session_only: bool,
}

/// Why a backup command did not run. Every kind but the first carries one
/// plain sentence in `message`, with no token in it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum BackupError {
    /// Not signed in, or GitHub no longer takes the sign-in.
    SignedOut {
        message: String,
    },
    /// GitHub did not let this sign-in do it (a missing permission).
    NoAccess {
        message: String,
    },
    /// This sign-in can see the repository but not write to it.
    CannotWrite {
        message: String,
    },
    NotFound {
        message: String,
    },
    /// GitHub is limiting requests; `resets_at` is milliseconds since the
    /// Unix epoch.
    RateLimited {
        message: String,
        resets_at: Option<u64>,
    },
    /// A repository by that name exists; `existing` is it, to use instead.
    NameTaken {
        message: String,
        existing: Option<Box<RepoRow>>,
    },
    /// The repository is public and the person has not said they want that.
    PublicRepo {
        message: String,
        repo: String,
    },
    /// The GitHub command line is not installed, or not signed in.
    NoGhCli {
        message: String,
    },
    Offline {
        message: String,
    },
    Other {
        message: String,
    },
}

impl BackupError {
    pub fn other(message: impl Into<String>) -> Self {
        BackupError::Other {
            message: message.into(),
        }
    }

    /// The plain sentence for the person.
    pub fn message(&self) -> String {
        match self {
            BackupError::SignedOut { message }
            | BackupError::NoAccess { message }
            | BackupError::CannotWrite { message }
            | BackupError::NotFound { message }
            | BackupError::RateLimited { message, .. }
            | BackupError::NameTaken { message, .. }
            | BackupError::PublicRepo { message, .. }
            | BackupError::NoGhCli { message }
            | BackupError::Offline { message }
            | BackupError::Other { message } => message.clone(),
        }
    }
}

impl std::fmt::Display for BackupError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message())
    }
}

impl From<BackupError> for String {
    fn from(err: BackupError) -> String {
        err.message()
    }
}

impl From<kasten_core::Error> for BackupError {
    fn from(err: kasten_core::Error) -> Self {
        BackupError::other(err.to_string())
    }
}

/// What linking a vault to an existing backup came to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "result",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum LinkOutcome {
    /// The vault now backs up to it. `empty`: it held nothing yet. `behind`:
    /// it has changes this vault lacks, so Get latest comes first.
    Linked {
        empty: bool,
        behind: bool,
        status: Box<BackupStatus>,
    },
    /// Nothing was changed; the ways forward.
    Refused { choices: Vec<LinkChoice> },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_empty_status_has_the_shape_the_window_reads() {
        let json = serde_json::to_value(BackupStatus::default()).unwrap();
        let keys = [
            "waiting",
            "unpushed",
            "verifiedAt",
            "skipped",
            "warn",
            "visibility",
            "paused",
            "protection",
            "lostHistory",
            "recoveredBranch",
            "lastBackupAt",
            "repoSize",
            "repoUrl",
        ];
        for key in keys {
            assert!(json.get(key).is_some(), "{key}");
        }
        assert_eq!(json["visibility"], "unknown");
        assert_eq!(json["protection"]["state"], "unknown");
    }

    #[test]
    fn errors_say_their_kind_and_carry_a_sentence() {
        let json = serde_json::to_value(BackupError::Offline {
            message: "m".into(),
        })
        .unwrap();
        assert_eq!(json["kind"], "offline");
        let limited = serde_json::to_value(BackupError::RateLimited {
            message: "wait".into(),
            resets_at: Some(5),
        })
        .unwrap();
        assert_eq!(limited["kind"], "rateLimited");
        assert_eq!(limited["resetsAt"], 5);
        assert_eq!(limited["message"], "wait");
        let taken = serde_json::to_value(BackupError::NameTaken {
            message: "m".into(),
            existing: None,
        })
        .unwrap();
        assert_eq!(taken["kind"], "nameTaken");
        assert!(taken["existing"].is_null());
        let file = serde_json::to_value(SkippedFile {
            path: "a.bin".into(),
            size: 3,
            since: "t".into(),
        })
        .unwrap();
        assert_eq!(file["size"], 3);
    }

    #[test]
    fn a_link_outcome_names_its_result() {
        let refused = serde_json::to_value(LinkOutcome::Refused {
            choices: vec![LinkChoice::PickAnother],
        })
        .unwrap();
        assert_eq!(refused["result"], "refused");
        assert_eq!(refused["choices"][0], "pickAnother");
        let linked = serde_json::to_value(LinkOutcome::Linked {
            empty: true,
            behind: false,
            status: Box::default(),
        })
        .unwrap();
        assert_eq!(linked["result"], "linked");
        assert_eq!(linked["status"]["waiting"], false);
    }
}
