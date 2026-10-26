//! The KastenFlow command line, a shell over kasten-core. The `kastenflow`
//! and `kasten` commands are both this one program: each names itself in
//! the help and in errors as the person typed it.

mod agents;
mod args;
mod backup;
mod backup_now;
mod commands;
mod import;
mod remotes;
mod show;

use std::process::ExitCode;
use std::sync::OnceLock;

use args::Args;
use show::{say, say_err};

/// Each command and what it does; `{cmd}` stands for the command as typed.
const COMMANDS: &[(&str, &str)] = &[
    (
        "init",
        "create a vault, or finish one: {cmd} init [DIR] [--name NAME]",
    ),
    (
        "capture",
        "add a card to the inbox: {cmd} capture TEXT [--tags a,b]",
    ),
    ("search", "full-text search: {cmd} search QUERY [--limit N]"),
    (
        "verify",
        "check vault integrity, and the backup remote with --remote; exits 1 on problems",
    ),
    ("history", "show commits: {cmd} history [NOTE] [--limit N]"),
    (
        "restore",
        "{cmd} restore NOTE COMMIT, or --vault-wide COMMIT",
    ),
    (
        "import",
        "move notes in: {cmd} import FOLDER [--kind K] [--project TITLE] [--dry-run]",
    ),
    (
        "undo",
        "revert one commit, such as an import: {cmd} undo COMMIT",
    ),
    ("reindex", "rebuild the search index from the files"),
    (
        "start-history",
        "keep git history for a vault that has none",
    ),
    (
        "sessions",
        "list agent sessions: {cmd} sessions [--limit N]",
    ),
    (
        "undo-session",
        "revert an agent session as new commits: {cmd} undo-session ID",
    ),
    ("proposals", "agent changes waiting for review [--diff]"),
    ("accept", "apply a proposal: {cmd} accept ID [--by NAME]"),
    ("reject", "decline a proposal: {cmd} reject ID [--by NAME]"),
    (
        "trust",
        "lift a session's soft limits: {cmd} trust ID [--minutes 60]",
    ),
    (
        "backup-file",
        "write a backup file of the whole vault: {cmd} backup-file FOLDER",
    ),
    (
        "clone-backup",
        "restore a backup file or git remote: {cmd} clone-backup SOURCE DIR",
    ),
    (
        "get-latest",
        "take in another computer's backed-up changes [--from FILE]",
    ),
    (
        "backup-now",
        "back up now and say what happened; exits 1 if not backed up [--carry-on] [--yes: agree to send notes to this vault's backup address]",
    ),
    (
        "backup-status",
        "what is waiting, last backup, last check, files left out; exits 1 on a problem",
    ),
];

static PROGRAM: OnceLock<&'static str> = OnceLock::new();

/// The command as the person typed it: `kastenflow`, or its old name
/// `kasten`.
pub(crate) fn program() -> &'static str {
    PROGRAM.get().copied().unwrap_or("kastenflow")
}

fn usage(program: &str) -> String {
    let mut text = format!(
        "{program} {}\n\nUsage: {program} <command> [options]\n\nCommands:\n",
        kasten_core::VERSION
    );
    for (name, about) in COMMANDS {
        let about = about.replace("{cmd}", program);
        text.push_str(&format!("  {name:<13} {about}\n"));
    }
    text.push_str("\nOptions:\n  --vault DIR    the vault (else KASTEN_VAULT, else the current folder)\n  --json         print JSON\n  -h, --help     print this help\n  -V, --version  print the version\n");
    text
}

/// Runs the command line as `program` (`kastenflow` or `kasten`) with this
/// process's arguments.
pub fn run(program: &'static str) -> ExitCode {
    let program = *PROGRAM.get_or_init(|| program);
    let raw: Vec<String> = std::env::args().skip(1).collect();
    if matches!(raw.first().map(String::as_str), Some("-V" | "--version")) {
        say!("{program} {}", kasten_core::VERSION);
        return ExitCode::SUCCESS;
    }
    let args = match Args::parse(raw) {
        Ok(args) => args,
        Err(why) => {
            say_err!("{program}: {why}");
            return ExitCode::from(2);
        }
    };
    let command = args.positional.first().map(String::as_str);
    if command.is_none() || matches!(command, Some("help")) || args.has("--help") || args.has("-h")
    {
        print!("{}", usage(program));
        return ExitCode::SUCCESS;
    }
    let outcome = match command.unwrap_or_default() {
        "init" => commands::init(&args),
        "capture" => commands::capture(&args),
        "search" => commands::search(&args),
        "verify" => commands::verify(&args),
        "history" => commands::history(&args),
        "restore" => commands::restore(&args),
        "import" => import::import(&args),
        "undo" => import::undo(&args),
        "reindex" => commands::reindex(&args),
        "start-history" => agents::start_history(&args),
        "sessions" => agents::sessions(&args),
        "undo-session" => agents::undo_session(&args),
        "proposals" => agents::proposals(&args),
        "accept" => agents::accept(&args),
        "reject" => agents::reject(&args),
        "trust" => agents::trust(&args),
        "backup-file" => backup::backup_file(&args),
        "clone-backup" => backup::clone(&args),
        "get-latest" => backup::get_latest(&args),
        "backup-now" => backup_now::backup_now(&args),
        "backup-status" => backup_now::backup_status(&args),
        "dev-generate" => commands::generate(&args),
        other => {
            say_err!("{program}: unknown command '{other}'\n\n{}", usage(program));
            return ExitCode::from(2);
        }
    };
    match outcome {
        Ok(code) => ExitCode::from(code as u8),
        Err(why) => {
            say_err!("{program}: {why}");
            ExitCode::from(1)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn help_names_the_command_as_typed() {
        for program in ["kastenflow", "kasten"] {
            let text = usage(program);
            assert!(
                text.starts_with(&format!("{program} {}\n", kasten_core::VERSION)),
                "{text}"
            );
            assert!(
                text.contains(&format!("Usage: {program} <command> [options]")),
                "{text}"
            );
            assert!(
                text.contains(&format!("{program} init [DIR] [--name NAME]")),
                "{text}"
            );
            assert!(!text.contains("{cmd}"), "{text}");
        }
        assert!(!usage("kastenflow").contains(" kasten "));
    }
}
