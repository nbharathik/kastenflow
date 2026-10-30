//! `backup-now` and `backup-status`, for scripts: each a thin call into
//! kasten-core, with an exit code of 0 when all is well and 1 when not.
//! Running either confirms the vault's backup on this computer, as
//! `get-latest` does. Signing in to the backup is left to SSH keys and git's
//! credential helper. `backup-now` sends notes only to an address this person
//! agreed to on this computer (`--yes` the first time).

use kasten_core::Instant;
use kasten_core::history::BackupState;

use crate::args::Args;
use crate::commands::{Outcome, json_text, open, when};
use crate::show::say;

/// `kasten backup-now [--carry-on]`: backs up, and says what happened (done,
/// nothing to do, or why not). With `--carry-on`, takes a rewritten backup as
/// it is now so backups can go on; it pushes nothing itself (exit 1 when the
/// backup shares no history with this vault, so the next push is refused).
pub fn backup_now(args: &Args) -> Outcome {
    let kasten = open(args)?;
    let remote = kasten.config().git.remote;
    if !args.has("--carry-on")
        && let Some(address) = &remote
        && !crate::remotes::is_confirmed(address)
    {
        // The vault's settings name where notes go; a vault received from
        // someone could name their server. The app asks the person; here the
        // person says so once per address.
        if !args.has("--yes") {
            return Err(format!(
                "This vault's settings send its notes to {address}, and this computer has not agreed to that yet. Nothing was sent. If it is your backup, run the same command with --yes once."
            ));
        }
        crate::remotes::confirm(address);
    }
    kasten.confirm_remote(remote.as_deref());
    if args.has("--carry-on") {
        let carried = kasten.carry_on_with_backup().map_err(|e| e.to_string())?;
        if args.has("--json") {
            say!(
                "{}",
                json_text(serde_json::to_value(&carried).unwrap_or_default())
            );
        } else if carried.can_push {
            say!("Carrying on with the backup as it is now. Run backup-now to send what is new.");
        } else {
            say!(
                "Carrying on with the backup as it is now. It shares no history with this vault, so backing up is refused until you get the latest or choose another backup."
            );
        }
        // A backup that shares nothing with this vault still refuses the next
        // push: that is a problem for a script to see.
        return Ok(i32::from(!carried.can_push));
    }
    if let Some(remote) = &remote
        && !args.has("--json")
    {
        say!("Backing up to {remote}");
    }
    let answer = kasten.back_up_now(Instant::now().millis);
    if args.has("--json") {
        say!(
            "{}",
            json_text(serde_json::to_value(&answer).unwrap_or_default())
        );
    } else {
        say!("{}", answer.message());
    }
    Ok(i32::from(!answer.is_ok()))
}

/// `kasten backup-status`: what is waiting, the last backup, the last check,
/// files left out, and the backup's visibility. Exits 1 when there is a
/// problem to look at: no backup set up, or one not confirmed, failing,
/// rewritten, or with a notice waiting.
pub fn backup_status(args: &Args) -> Outcome {
    let kasten = open(args)?;
    let remote = kasten.config().git.remote;
    kasten.confirm_remote(remote.as_deref());
    let status = kasten.backup_status(Instant::now().millis);
    let problem = matches!(
        status.state,
        BackupState::Off | BackupState::Unconfirmed | BackupState::Failing
    ) || status.lost_history
        || status.notice.is_some();
    if args.has("--json") {
        let mut value = serde_json::to_value(&status).unwrap_or_default();
        // GitHub's answer about privacy is the app's to look up.
        value["visibility"] = "unknown".into();
        value["problem"] = problem.into();
        say!("{}", json_text(value));
        return Ok(i32::from(problem));
    }
    let state = match status.state {
        BackupState::Off => "off: no backup is set up",
        BackupState::Ok => "ok",
        BackupState::Stale => "stale: the last backup is over a day old",
        BackupState::Failing => "failing",
        BackupState::Unconfirmed => "not confirmed on this computer",
    };
    say!("Backup: {state}");
    if status.state == BackupState::Off {
        return Ok(1);
    }
    say!(
        "  Last backup: {}",
        status.last_push.map_or("never".to_owned(), when)
    );
    match status.unpushed {
        0 => say!("  Waiting: nothing"),
        1 => say!("  Waiting: 1 change"),
        n => say!("  Waiting: {n} changes"),
    }
    say!(
        "  Verified: {}",
        status.verified_at.map_or("never".to_owned(), when)
    );
    say!("  Visibility: unknown (the app checks it)");
    for file in &status.skipped {
        say!(
            "  Not backed up (over 100 MB): {} ({} MB)",
            file.path,
            file.size / (1024 * 1024)
        );
    }
    if status.lost_history {
        say!("  The backup was rewritten; nothing is sent until you act.");
        if let Some(branch) = &status.recovered_branch {
            say!("  Your full history is saved on the branch {branch}.");
        }
    }
    if status.behind {
        say!("  The backup has changes from another computer: get the latest.");
    }
    if let Some(error) = &status.last_error {
        say!("  Last problem: {error}");
    }
    Ok(i32::from(problem))
}
