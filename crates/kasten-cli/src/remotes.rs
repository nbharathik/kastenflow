//! Backup addresses this person has agreed to send notes to from the command
//! line. A vault's settings name its backup, and a vault received from someone
//! could name their server; the app asks before the first push to an address,
//! and so does the command line: once per address (`--yes`), kept in the
//! user's own config folder, never in the vault.

use std::io::Write;
use std::path::PathBuf;

/// The folder for the command line's own settings: `KASTEN_CONFIG_DIR`, else
/// the system's per-user config folder.
fn folder() -> Option<PathBuf> {
    let from = |name: &str| {
        std::env::var_os(name)
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
    };
    let base = from("KASTEN_CONFIG_DIR")
        .or_else(|| from("APPDATA"))
        .or_else(|| from("XDG_CONFIG_HOME"))
        .or_else(|| from("HOME").map(|home| home.join(".config")))?;
    Some(base.join("kastenflow"))
}

fn file() -> Option<PathBuf> {
    Some(folder()?.join("cli-backups.txt"))
}

fn same(a: &str, b: &str) -> bool {
    a.trim() == b.trim()
}

/// Whether `address` was agreed to here before.
pub fn is_confirmed(address: &str) -> bool {
    let Some(file) = file() else {
        return false;
    };
    std::fs::read_to_string(file)
        .map(|text| text.lines().any(|line| same(line, address)))
        .unwrap_or(false)
}

/// Remembers that `address` was agreed to. A computer with no config folder
/// to write in remembers nothing, and `--yes` is needed every time.
pub fn confirm(address: &str) {
    // An address with a line break would be two entries.
    if address.contains(['\n', '\r']) || is_confirmed(address) {
        return;
    }
    let Some(file) = file() else {
        return;
    };
    if let Some(dir) = file.parent()
        && std::fs::create_dir_all(dir).is_err()
    {
        return;
    }
    if let Ok(mut out) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(file)
    {
        let _ = writeln!(out, "{}", address.trim());
    }
}
