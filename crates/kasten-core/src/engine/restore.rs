//! Restore tools: a note, or the whole vault,
//! back to how it was at a commit. Both write new commits; files made
//! since go to the trash, never away.

use std::fs;

use serde::Serialize;

use super::{Change, Kasten};
use crate::atomic::write_atomic;
use crate::error::{Error, Result};
use crate::history::{Actor, History};
use crate::note::NoteFile;
use crate::rollback::Rollback;
use crate::time::Instant;

/// What a vault restore changed.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultRestore {
    /// Files written back to their old text.
    pub written: Vec<String>,
    /// Where files made after the commit went, under `.trash/`.
    pub trashed: Vec<String>,
    /// The commit the restore made, which undo takes back whole.
    pub commit: Option<String>,
}

/// "2026-09-24 10:20" for a commit.
pub(super) fn when(history: &History, rev: &str) -> String {
    let time = history.log(None, 10_000).ok().and_then(|log| {
        log.into_iter()
            .find(|c| c.id.starts_with(rev))
            .map(|c| c.time)
    });
    match time {
        Some(ms) => {
            let stamp = Instant { millis: ms }.rfc3339();
            format!("{} {}", &stamp[..10], &stamp[11..16])
        }
        None => rev.chars().take(8).collect(),
    }
}

impl Kasten {
    pub(super) fn history_or_err(&self) -> Result<&History> {
        self.history
            .get()
            .ok_or_else(|| Error::Invalid("This vault has no history yet".into()))
    }

    /// Writes a note's text from an earlier commit as its newest version.
    pub fn restore_version(
        &self,
        actor: &Actor,
        path: &str,
        rev: &str,
        now: Instant,
    ) -> Result<NoteFile> {
        let history = self.history_or_err()?;
        // Anything typed or changed outside is committed first, so the
        // version it replaces stays in history.
        self.commit_edits()?;
        self.commit_external()?;
        let text = history
            .file_at(rev, path)?
            .ok_or_else(|| Error::NotFound(format!("{path} at {rev}")))?;
        let label = when(history, rev);
        self.apply(actor, "restore_version", false, now.millis, |vault| {
            let file = vault.path_of(path)?;
            if let Some(dir) = file.parent() {
                fs::create_dir_all(dir)?;
            }
            write_atomic(&file, text.as_bytes())?;
            let note = vault.read(path)?;
            Ok(Change {
                message: format!("restore: {} to {label}", note.meta.title),
                paths: vec![path.to_owned()],
                value: note,
            })
        })
    }

    /// Puts every tracked file back as it was at `rev`, as one new commit,
    /// which `undo_commit` takes back whole. `.kasten/config.yaml` stays as it
    /// is now: going back in time must not bring back an older agent mode,
    /// guardrail limit, plugin choice or backup address.
    pub fn restore_vault(&self, actor: &Actor, rev: &str, now: Instant) -> Result<VaultRestore> {
        self.restore_vault_keeping(actor, rev, now, &[crate::config::CONFIG_PATH])
    }

    /// `restore_vault`, leaving the files named in `keep` as they are now.
    pub(super) fn restore_vault_keeping(
        &self,
        actor: &Actor,
        rev: &str,
        now: Instant,
        keep: &[&str],
    ) -> Result<VaultRestore> {
        let history = self.history_or_err()?;
        // Anything typed or changed outside is committed first, so it stays in history.
        self.commit_edits()?;
        self.commit_external()?;
        let then = history.files_at(rev)?;
        let current = history.files_at("HEAD")?;
        let label = when(history, rev);
        let stamp = now.compact();
        let (mut report, commit) =
            self.apply_committing(actor, "restore_vault", false, now.millis, &[], |vault| {
                let mut report = VaultRestore::default();
                // Every path is checked before anything is written.
                for path in then.iter().chain(&current) {
                    if !path.starts_with(".trash/") {
                        vault.tracked_file(path)?;
                    }
                }
                // A restore that fails part way is put back, whole.
                let mut done = Rollback::default();
                let restored = (|| -> Result<()> {
                    for path in &then {
                        if path.starts_with(".trash/") || keep.contains(&path.as_str()) {
                            continue;
                        }
                        let Some(bytes) = history.blob_at(rev, path)? else {
                            continue;
                        };
                        let file = vault.tracked_file(path)?;
                        let before = crate::atomic::read_if_there(&file)?;
                        if before.as_deref() == Some(bytes.as_slice()) {
                            continue;
                        }
                        done.write(&file, &bytes, before)?;
                        report.written.push(path.clone());
                    }
                    for path in current.iter().filter(|p| {
                        !then.contains(p)
                            && !p.starts_with(".trash/")
                            && !keep.contains(&p.as_str())
                    }) {
                        let from = vault.tracked_file(path)?;
                        if !from.is_file() {
                            continue;
                        }
                        let to_rel = format!(".trash/{stamp}/{path}");
                        done.rename(&from, &vault.tracked_file(&to_rel)?)?;
                        report.trashed.push(to_rel);
                        report.written.push(path.clone());
                    }
                    Ok(())
                })();
                if let Err(err) = restored {
                    done.put_back();
                    return Err(err);
                }
                let mut paths = report.written.clone();
                paths.extend(report.trashed.iter().cloned());
                Ok(Change {
                    message: format!("restore: vault to {label}"),
                    paths,
                    value: report,
                })
            })?;
        report.commit = commit;
        Ok(report)
    }
}
