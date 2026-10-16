//! The bearer token for MCP over HTTP:
//! 256 bits from the operating system's random source, kept in the vault's
//! cache, which never enters history, and readable by its owner alone
//! from the moment it is written. This computer records the tokens it
//! issued outside every vault, so a token that came inside a shared vault
//! is replaced.

use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

#[cfg(windows)]
#[path = "token_windows.rs"]
mod windows;

/// Where the token is kept, in the vault.
pub const TOKEN: &str = ".kasten/cache/mcp-token";

/// The tokens issued on this computer, by vault folder, in the app's
/// settings folder.
const ISSUED: &str = "mcp-tokens-v2.json";

/// The desktop app's identifier, which names its settings folder.
const APP_ID: &str = "io.github.nbharathik.kasten";

/// The app's settings folder on this computer, outside every vault: the
/// one the desktop app keeps its own settings in.
fn settings_dir() -> Option<PathBuf> {
    let var = |name: &str| {
        std::env::var_os(name)
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
    };
    let base = if cfg!(windows) {
        var("APPDATA")
    } else if cfg!(target_os = "macos") {
        var("HOME").map(|home| home.join("Library/Application Support"))
    } else {
        var("XDG_CONFIG_HOME").or_else(|| var("HOME").map(|home| home.join(".config")))
    };
    base.map(|dir| dir.join(APP_ID))
}

/// Cryptographic bytes from the OS; no fallback when it fails.
fn random_bytes() -> io::Result<[u8; 32]> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(io::Error::other)?;
    Ok(bytes)
}

fn random_hex() -> io::Result<String> {
    Ok(random_bytes()?.iter().map(|b| format!("{b:02x}")).collect())
}

/// Whether a token file is fit to keep: the right form, and on Unix
/// readable by its owner alone. One left readable by others is replaced.
fn trusted(path: &Path, token: &str) -> bool {
    let formed = token.len() == 64 && token.bytes().all(|b| b.is_ascii_hexdigit());
    formed && private_file(path)
}

fn private_file(path: &Path) -> bool {
    if kasten_core::local_paths::check(path).is_err() {
        return false;
    }
    #[cfg(unix)]
    let private = {
        use std::os::unix::fs::PermissionsExt;
        fs::metadata(path).is_ok_and(|m| m.permissions().mode() & 0o077 == 0)
    };
    #[cfg(windows)]
    let private = windows::trusted(path);
    #[cfg(not(any(unix, windows)))]
    let private = false;
    private
}

/// Writes `text` to a new file only its owner can read, then moves it into
/// place, so the token is never readable by others, even for a moment.
fn write_private(path: &Path, text: &str) -> io::Result<()> {
    kasten_core::local_paths::check(path)?;
    let temp = path.with_extension(format!("{}.new", random_hex()?));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    #[cfg(windows)]
    windows::options(&mut options);
    let mut file = options.open(&temp)?;
    #[cfg(windows)]
    windows::protect(&mut file)?;
    file.write_all(text.as_bytes())?;
    file.sync_all()?;
    drop(file);
    fs::rename(&temp, path)
}

fn issued(record: &Path) -> BTreeMap<String, String> {
    if !private_file(record) {
        return BTreeMap::new();
    }
    fs::read_to_string(record)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Records `token` as issued here for `vault`, leaving out vaults that are
/// gone.
fn remember(record: &Path, vault: &str, token: &str) -> io::Result<()> {
    kasten_core::local_paths::check(record)?;
    let mut all = issued(record);
    all.retain(|folder, _| Path::new(folder).is_dir());
    all.insert(vault.to_owned(), token.to_owned());
    fs::create_dir_all(record.parent().unwrap_or(Path::new(".")))?;
    let text = serde_json::to_string_pretty(&all).map_err(io::Error::other)?;
    write_private(record, &text)
}

/// The vault's MCP token, made on first use.
pub fn token(root: &Path) -> io::Result<String> {
    token_with(root, settings_dir().as_deref())
}

/// `token`, with this computer's issuance record in `settings`.
fn token_with(root: &Path, settings: Option<&Path>) -> io::Result<String> {
    let settings = settings
        .ok_or_else(|| io::Error::other("No private settings folder for MCP credentials"))?;
    let settings = kasten_core::local_paths::resolve_root(settings)?;
    let root = kasten_core::local_paths::resolve_root(root)?;
    let path = root.join(TOKEN);
    kasten_core::local_paths::check(&path)?;
    let vault = root
        .canonicalize()
        .unwrap_or_else(|_| root.to_owned())
        .to_string_lossy()
        .into_owned();
    let record = settings.join(ISSUED);
    kasten_core::local_paths::check(&record)?;
    if fs::metadata(&path).is_ok_and(|metadata| metadata.len() <= 128)
        && let Ok(existing) = fs::read_to_string(&path)
    {
        let existing = existing.trim();
        let here = issued(&record).get(&vault).map(String::as_str) == Some(existing);
        if here && trusted(&path, existing) {
            return Ok(existing.to_owned());
        }
    }
    fs::create_dir_all(path.parent().unwrap_or(&root))?;
    let token = random_hex()?;
    write_private(&path, &format!("{token}\n"))?;
    remember(&record, &vault, &token)?;
    Ok(token)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "kasten-token-{}",
            kasten_core::ulid_at(kasten_core::Instant::now().millis)
        ));
        if cfg!(unix) {
            // macOS reaches its temporary folder through a link (/var is /private/var), which the checks on
            // private files refuse; the token's own folders are resolved the same way.
            return kasten_core::local_paths::resolve_root(&dir).unwrap();
        }
        dir
    }

    #[test]
    fn the_settings_folder_is_the_desktop_apps() {
        // The app's identifier names its settings folder: renaming one
        // without the other would split the record of issued tokens.
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../../../app/src-tauri/tauri.conf.json")).unwrap();
        assert_eq!(conf["identifier"], APP_ID);
    }

    #[test]
    fn no_settings_means_no_token_is_written() {
        let dir = scratch();
        assert!(token_with(&dir, None).is_err());
        assert!(!dir.exists());
    }

    #[test]
    fn old_issuance_records_rotate_once() {
        let dir = scratch();
        let settings = dir.join("settings");
        let first = token_with(&dir, Some(&settings)).unwrap();
        fs::rename(settings.join(ISSUED), settings.join("mcp-tokens.json")).unwrap();
        let rotated = token_with(&dir, Some(&settings)).unwrap();
        assert_ne!(first, rotated);
        assert_eq!(token_with(&dir, Some(&settings)).unwrap(), rotated);
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn linked_token_files_are_refused_without_touching_the_target() {
        let dir = scratch();
        fs::create_dir_all(dir.join("vault/.kasten/cache")).unwrap();
        let target = dir.join("sentinel");
        fs::write(&target, "private content").unwrap();
        let link = dir.join("vault").join(TOKEN);
        #[cfg(unix)]
        std::os::unix::fs::symlink(&target, &link).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_file(&target, &link).unwrap();
        assert!(token_with(&dir.join("vault"), Some(&dir.join("settings"))).is_err());
        assert_eq!(fs::read_to_string(target).unwrap(), "private content");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn tokens_are_long_random_and_kept() {
        let a = random_hex().unwrap();
        assert_eq!(a.len(), 64);
        assert_ne!(a, random_hex().unwrap());
        let dir = scratch();
        let settings = dir.join("settings");
        let first = token_with(&dir, Some(&settings)).unwrap();
        assert_eq!(token_with(&dir, Some(&settings)).unwrap(), first);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_token_this_computer_did_not_issue_is_replaced() {
        let dir = scratch();
        let settings = dir.join("settings");
        let first = token_with(&dir, Some(&settings)).unwrap();
        // One that came with the vault, private and well formed as it is.
        let brought = "b".repeat(64);
        write_private(&dir.join(TOKEN), &format!("{brought}\n")).unwrap();
        let now = token_with(&dir, Some(&settings)).unwrap();
        assert!(now != brought && now != first);
        assert_eq!(token_with(&dir, Some(&settings)).unwrap(), now, "kept");
        // Another computer's record does not know it either.
        let elsewhere = dir.join("elsewhere");
        assert_ne!(token_with(&dir, Some(&elsewhere)).unwrap(), now);
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn only_the_owner_reads_it_and_a_shared_one_is_replaced() {
        use std::os::unix::fs::PermissionsExt;

        let dir = scratch();
        let settings = dir.join("settings");
        let first = token_with(&dir, Some(&settings)).unwrap();
        let path = dir.join(TOKEN);
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );

        // A token anyone could read, as a shared vault would bring, goes.
        let shared = "a".repeat(64);
        fs::write(&path, format!("{shared}\n")).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        let replaced = token_with(&dir, Some(&settings)).unwrap();
        assert_ne!(replaced, shared);
        assert_ne!(replaced, first);
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        let record = settings.join(ISSUED);
        assert_eq!(
            fs::metadata(&record).unwrap().permissions().mode() & 0o777,
            0o600
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
