//! Backup from the command line, each a thin call into kasten-core: a
//! backup file into a folder, a vault restored from a backup into an empty
//! folder, and Get latest. Signing in to a remote is left to SSH keys and
//! git's credential helper; tokens belong to the app's keychain.

use std::path::{Path, PathBuf};

use kasten_core::history::{clone_backup, restore_from_bundle};
use kasten_core::{Instant, LatestOutcome, computer_name};
use serde_json::json;

use crate::args::Args;
use crate::commands::{Outcome, json_text, open};
use crate::show::say;

/// `kasten backup-file FOLDER [--computer NAME]`
pub fn backup_file(args: &Args) -> Outcome {
    let folder = args.positional.get(1).ok_or_else(|| {
        format!(
            "Usage: {} backup-file FOLDER [--computer NAME]",
            crate::program()
        )
    })?;
    let kasten = open(args)?;
    let computer = args
        .value("--computer")
        .map(str::to_owned)
        .unwrap_or_else(computer_name);
    let file = kasten
        .write_backup_file(Path::new(folder), &computer, Instant::now())
        .map_err(|e| e.to_string())?;
    if args.has("--json") {
        say!(
            "{}",
            json_text(serde_json::to_value(&file).unwrap_or_default())
        );
    } else if file.written {
        say!("Wrote {} ({} KB).", file.path, file.bytes.div_ceil(1024));
        for old in &file.removed {
            say!("Removed {old}: the new file holds its history.");
        }
        for old in &file.kept {
            say!("Kept {old}: its history is not all in the new file.");
        }
    } else {
        say!("{} already holds everything.", file.path);
    }
    Ok(0)
}

/// `kasten clone-backup SOURCE DIR`: SOURCE is a backup file or a git
/// address; DIR must be empty or not there yet.
pub fn clone(args: &Args) -> Outcome {
    let (Some(source), Some(dir)) = (args.positional.get(1), args.positional.get(2)) else {
        return Err(format!(
            "Usage: {} clone-backup BACKUP-FILE-OR-GIT-ADDRESS DIR",
            crate::program()
        ));
    };
    let target = PathBuf::from(dir);
    let file = Path::new(source);
    let header = if file.is_file() {
        restore_from_bundle(file, &target)
    } else {
        clone_backup(source, None, &target)
    }
    .map_err(|e| e.to_string())?;
    if args.has("--json") {
        say!(
            "{}",
            json_text(json!({ "vault": target, "head": header.head }))
        );
    } else {
        say!(
            "Restored into {}, at {}.",
            target.display(),
            &header.head[..header.head.len().min(8)]
        );
    }
    Ok(0)
}

/// `kasten get-latest [--from BACKUP-FILE]`: the changes another computer
/// backed up, beside this one's. Running it confirms the vault's remote.
pub fn get_latest(args: &Args) -> Outcome {
    let kasten = open(args)?;
    let now = Instant::now();
    let latest = match args.value("--from") {
        Some(file) => kasten.get_latest_from_file(Path::new(file), now),
        None => {
            let remote = kasten
                .config()
                .git
                .remote
                .ok_or("This vault has no backup remote; use --from BACKUP-FILE")?;
            if !args.has("--json") {
                say!("Getting the latest from {remote}");
            }
            kasten.confirm_remote(Some(&remote));
            kasten.get_latest(now)
        }
    }
    .map_err(|e| e.to_string())?;
    if args.has("--json") {
        say!(
            "{}",
            json_text(serde_json::to_value(&latest).unwrap_or_default())
        );
        return Ok(0);
    }
    match latest.outcome {
        LatestOutcome::UpToDate => say!("Already up to date."),
        LatestOutcome::FastForward => {
            let n = latest.changed.len();
            say!(
                "Got the latest: {n} file{} changed.",
                if n == 1 { "" } else { "s" }
            );
        }
        LatestOutcome::Merged => {
            say!("Got the latest, joined with this computer's changes.");
            for copy in &latest.copies {
                say!("Changed on both computers; the other version is at {copy}");
            }
            for set in &latest.set_aside {
                say!("The other computer's settings are set aside at {set}");
            }
        }
    }
    Ok(0)
}
