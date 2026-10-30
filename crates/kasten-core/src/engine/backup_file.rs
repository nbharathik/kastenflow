//! Backup files in a folder that a sync client (Dropbox, Google Drive,
//! OneDrive) or a disk keeps: the whole history in one file, written
//! aside, checked, and only then given its name. Each computer keeps its
//! newest seven, and an older one is removed only when the new file holds
//! its history. Other computers' files are never touched.

use std::fs::{self, File};
use std::io::BufWriter;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::Kasten;
use crate::error::{Error, Result};
use crate::history::{BackupState, read_bundle_header, verify_bundle};
use crate::slug::slugify;
use crate::time::Instant;

const RECORD_PATH: &str = ".kasten/cache/backup-file.json";
/// How many of its own files each computer keeps.
pub const KEEP: usize = 7;
pub(super) const DAY: u64 = 24 * 60 * 60 * 1000;
/// A half-written file older than this was left by a write that stopped.
const STALE_PARTIAL: u64 = 60 * 60 * 1000;
/// How long the vault stays quiet before the daily file is written.
pub(super) const IDLE: u64 = 2 * 60 * 1000;

/// The last backup file written, kept in the cache.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupFileRecord {
    /// When the newest file was written.
    pub last_written: Option<u64>,
    /// The commit the newest file holds.
    pub head: Option<String>,
    pub path: Option<String>,
    pub failures: u32,
    pub last_error: Option<String>,
    /// When a file was last tried, written or not.
    pub last_attempt: Option<u64>,
}

/// What writing a backup file did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupFile {
    /// The file written, or the newest one when it already held everything.
    pub path: String,
    pub head: String,
    /// False when the newest file already held this history.
    pub written: bool,
    pub bytes: u64,
    /// Older files removed, each one's history inside the new file.
    pub removed: Vec<String>,
    /// Older files past the newest seven kept, since their history is not
    /// all in the new file.
    pub kept: Vec<String>,
}

/// How the backup files stand, for the status bar and Settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupFileStatus {
    pub state: BackupState,
    pub last_written: Option<u64>,
    pub path: Option<String>,
    /// The newest file holds every commit there is now.
    pub current: bool,
    pub failures: u32,
    pub last_error: Option<String>,
}

/// A name a folder can have on every system: no separators or reserved
/// characters, and no dot or space at the end, which Windows drops.
fn folder_safe(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                ' '
            } else {
                c
            }
        })
        .take(60)
        .collect();
    let cleaned = cleaned.trim().trim_end_matches(['.', ' ']).to_owned();
    if cleaned.is_empty() {
        "Kasten".to_owned()
    } else {
        cleaned
    }
}

/// A name part from `text`, or `fallback` when it has no letters or digits.
fn part(text: &str, fallback: &str) -> String {
    if text.chars().any(char::is_alphanumeric) {
        slugify(text)
    } else {
        fallback.to_owned()
    }
}

/// Whether `name` is exactly `<prefix><time>[-n]<ending>`, as this
/// computer names its files. Only the exact form: another computer whose
/// name starts the same (`desk` and `desk-2`) has files of its own.
fn is_own(name: &str, prefix: &str, ending: &str) -> bool {
    let Some(rest) = name
        .strip_prefix(prefix)
        .and_then(|rest| rest.strip_suffix(ending))
    else {
        return false;
    };
    let (time, n) = rest.split_once('-').unwrap_or((rest, "0"));
    let b = time.as_bytes();
    b.len() == 16
        && b[8] == b'T'
        && b[15] == b'Z'
        && b[..8].iter().chain(&b[9..15]).all(u8::is_ascii_digit)
        && !n.is_empty()
        && n.bytes().all(|c| c.is_ascii_digit())
}

/// This computer's files for a vault, in `dir`, oldest first by the time in
/// their names.
fn own_files(dir: &Path, prefix: &str, ending: &str) -> Result<Vec<PathBuf>> {
    let mut found: Vec<PathBuf> = fs::read_dir(dir)?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_ok_and(|t| t.is_file()))
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| is_own(n, prefix, ending))
        })
        .collect();
    found.sort();
    Ok(found)
}

/// The time in a file's name, as `Instant::compact` wrote it.
fn stamp_of<'a>(path: &'a Path, prefix: &str) -> Option<&'a str> {
    let name = path.file_name()?.to_str()?;
    name.strip_prefix(prefix)?.split('.').next()
}

/// This computer's name, which its backup files carry so that other
/// computers' files in the same folder are never touched.
pub fn computer_name() -> String {
    #[cfg(target_os = "macos")]
    let named = std::process::Command::new("/usr/sbin/scutil")
        .args(["--get", "LocalHostName"])
        .output()
        .ok()
        .filter(|out| out.status.success())
        .and_then(|out| String::from_utf8(out.stdout).ok());
    #[cfg(target_os = "windows")]
    let named = std::env::var("COMPUTERNAME").ok();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let named = fs::read_to_string("/proc/sys/kernel/hostname")
        .or_else(|_| fs::read_to_string("/etc/hostname"))
        .ok();
    named
        .map(|name| name.trim().to_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "computer".to_owned())
}

fn shown(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

impl Kasten {
    pub(super) fn backup_file_record(&self) -> BackupFileRecord {
        fs::read_to_string(self.root().join(RECORD_PATH))
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    fn save_backup_file_record(&self, record: &BackupFileRecord) {
        let path = self.root().join(RECORD_PATH);
        if let Ok(text) = serde_json::to_string_pretty(record) {
            let _ = crate::atomic::write_atomic(&path, text.as_bytes());
        }
    }

    /// Writes a backup file of the whole history into
    /// `<folder>/Kasten backup - <vault>/`, named for this computer
    /// (`host`) and the time, unless the newest already holds everything.
    /// Waiting typing and outside changes are committed first.
    pub fn write_backup_file(&self, folder: &Path, host: &str, now: Instant) -> Result<BackupFile> {
        let _turn = self.backup_turn.lock().unwrap_or_else(|p| p.into_inner());
        let written = self.write_backup_file_now(folder, host, now);
        let mut record = self.backup_file_record();
        record.last_attempt = Some(now.millis);
        match &written {
            Ok(file) => {
                if file.written || record.path.as_deref() != Some(file.path.as_str()) {
                    record.last_written = Some(now.millis);
                }
                record.head = Some(file.head.clone());
                record.path = Some(file.path.clone());
                record.failures = 0;
                record.last_error = None;
            }
            Err(err) => {
                record.failures += 1;
                record.last_error = Some(err.to_string());
            }
        }
        self.save_backup_file_record(&record);
        written
    }

    fn write_backup_file_now(&self, folder: &Path, host: &str, now: Instant) -> Result<BackupFile> {
        let history = self.history_or_err()?;
        self.commit_edits()?;
        self.commit_external()?;
        let head = history
            .head()
            .ok_or_else(|| Error::Invalid("This vault's history has no commit yet".into()))?;
        let name = self.config().name;
        let dir = folder.join(format!("Kasten backup - {}", folder_safe(&name)));
        fs::create_dir_all(&dir)?;
        let prefix = format!(
            "kasten-{}-{}-",
            part(&name, "vault"),
            part(host, "computer")
        );
        self.clear_partials(&dir, &prefix, now);

        let existing = own_files(&dir, &prefix, ".bundle")?;
        if let Some(newest) = existing.last()
            && read_bundle_header(newest).is_ok_and(|h| h.head == head)
        {
            return Ok(BackupFile {
                path: shown(newest),
                head,
                written: false,
                bytes: fs::metadata(newest).map(|m| m.len()).unwrap_or(0),
                removed: Vec::new(),
                kept: Vec::new(),
            });
        }

        let mut target = dir.join(format!("{prefix}{}.bundle", now.compact()));
        let mut n = 2;
        while target.exists() {
            target = dir.join(format!("{prefix}{}-{n}.bundle", now.compact()));
            n += 1;
        }
        let partial = PathBuf::from(format!("{}.partial", target.display()));
        let made = (|| {
            let file = File::create(&partial)?;
            let mut out = BufWriter::new(file);
            let header = history.write_bundle(&mut out)?;
            let file = out.into_inner().map_err(|e| e.into_error())?;
            file.sync_all()?;
            drop(file);
            let checked = verify_bundle(&partial, &self.root().join(".kasten/cache"))?;
            if checked.head != header.head {
                return Err(Error::Git(
                    "The backup file did not read back the same".into(),
                ));
            }
            fs::rename(&partial, &target)?;
            Ok(header)
        })();
        let header = match made {
            Ok(header) => header,
            Err(err) => {
                // Only the half-written file this write made.
                let _ = fs::remove_file(&partial);
                return Err(err);
            }
        };

        let mut file = BackupFile {
            path: shown(&target),
            bytes: fs::metadata(&target).map(|m| m.len()).unwrap_or(0),
            head: header.head.clone(),
            written: true,
            removed: Vec::new(),
            kept: Vec::new(),
        };
        let all = own_files(&dir, &prefix, ".bundle")?;
        let older = all.len().saturating_sub(self.config().backup_files_kept());
        for old in &all[..older] {
            let inside =
                read_bundle_header(old).is_ok_and(|h| history.holds(&header.head, &h.head));
            if inside {
                fs::remove_file(old)?;
                file.removed.push(shown(old));
            } else {
                file.kept.push(shown(old));
            }
        }
        Ok(file)
    }

    /// Removes this computer's half-written files that a stopped write
    /// left, going by the time in their names.
    fn clear_partials(&self, dir: &Path, prefix: &str, now: Instant) {
        let before = Instant {
            millis: now.millis.saturating_sub(STALE_PARTIAL),
        }
        .compact();
        for partial in own_files(dir, prefix, ".bundle.partial").unwrap_or_default() {
            if stamp_of(&partial, prefix).is_some_and(|stamp| stamp < before.as_str()) {
                let _ = fs::remove_file(&partial);
            }
        }
    }

    /// Whether the daily file is due: none yet, or the newest is a day old
    /// and history has moved on since; only once nothing has changed for
    /// two minutes, and after a failure, only once its wait is over.
    pub fn backup_file_due(&self, now: u64) -> bool {
        let Some(head) = self.history.get().and_then(|h| h.head()) else {
            return false;
        };
        if !self.quiet_for(now, IDLE) {
            return false;
        }
        let record = self.backup_file_record();
        let waiting = record.failures > 0
            && record
                .last_attempt
                .is_some_and(|t| now < t + super::push::backoff(record.failures));
        if waiting {
            return false;
        }
        match record.last_written {
            None => true,
            Some(_) if record.head.as_deref() == Some(head.as_str()) => false,
            Some(written) => now >= written + DAY,
        }
    }

    /// How the backup files stand: fresh while the newest holds every
    /// commit or is under a day old; stale after that, and failing after
    /// three days or three failures in a row.
    pub fn backup_file_status(&self, now: u64) -> BackupFileStatus {
        let record = self.backup_file_record();
        let head = self.history.get().and_then(|h| h.head());
        let current = record.head.is_some() && record.head == head;
        let age = record.last_written.map(|t| now.saturating_sub(t));
        let state = match age {
            None if record.failures > 0 => BackupState::Failing,
            None => BackupState::Off,
            _ if record.failures >= 3 => BackupState::Failing,
            _ if current => BackupState::Ok,
            Some(age) if age > 3 * DAY => BackupState::Failing,
            Some(age) if age > DAY => BackupState::Stale,
            Some(_) => BackupState::Ok,
        };
        BackupFileStatus {
            state,
            last_written: record.last_written,
            path: record.path,
            current,
            failures: record.failures,
            last_error: record.last_error,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_names_work_on_every_system() {
        assert_eq!(folder_safe("My notes"), "My notes");
        assert_eq!(folder_safe("a/b:c*?"), "a b c");
        assert_eq!(folder_safe("Ends with a dot."), "Ends with a dot");
        assert_eq!(folder_safe("///"), "Kasten");
        assert_eq!(folder_safe(&"x".repeat(100)).len(), 60);
    }

    #[test]
    fn this_computer_has_a_name() {
        assert!(!computer_name().trim().is_empty());
    }

    #[test]
    fn only_this_computers_files_are_its_own() {
        let prefix = "kasten-notes-desk-";
        assert!(is_own(
            "kasten-notes-desk-20260924T081205Z.bundle",
            prefix,
            ".bundle"
        ));
        assert!(is_own(
            "kasten-notes-desk-20260924T081205Z-3.bundle",
            prefix,
            ".bundle"
        ));
        assert!(is_own(
            "kasten-notes-desk-20260924T081205Z.bundle.partial",
            prefix,
            ".bundle.partial"
        ));
        // Another computer named desk-2, and files that only look alike.
        assert!(!is_own(
            "kasten-notes-desk-2-20260924T081205Z.bundle",
            prefix,
            ".bundle"
        ));
        assert!(!is_own(
            "kasten-notes-desk-20260924T081205Z.bundle.partial",
            prefix,
            ".bundle"
        ));
        assert!(!is_own(
            "kasten-notes-desk-20260924T081205Z-.bundle",
            prefix,
            ".bundle"
        ));
        assert!(!is_own(
            "kasten-notes-desk-latest.bundle",
            prefix,
            ".bundle"
        ));
    }

    #[test]
    fn names_and_times_come_back_from_a_file_name() {
        let prefix = "kasten-dev-vault-desk-";
        let path = Path::new("/b/kasten-dev-vault-desk-20260924T081205Z.bundle.partial");
        assert_eq!(stamp_of(path, prefix), Some("20260924T081205Z"));
        assert_eq!(part("Desk PC", "computer"), "desk-pc");
        assert_eq!(part("✨", "computer"), "computer");
    }
}
