//! Folders a sync app copies to its cloud: OneDrive, Dropbox, Google
//! Drive, iCloud Drive, Box, Nextcloud and the other apps in a Mac's
//! cloud storage. A vault there is warned about, never refused: the app
//! copies files while Kasten writes and commits them, which can leave
//! "conflicted copy" files, a half-copied history, or one computer's note
//! written over another's. Backup is how a vault gets a copy in the cloud.

use std::fs;
use std::path::{Component, Path, PathBuf};

/// The sync app that copies `path`, or None. `home` is the person's home
/// folder, where a Mac keeps Desktop and Documents in iCloud Drive at
/// their usual paths.
pub fn synced_by(path: &Path, home: Option<&Path>) -> Option<&'static str> {
    if let Some(app) = by_name(path) {
        return Some(app);
    }
    // A link can lead into a synced folder from anywhere.
    if let Some(real) = real_place(path)
        && let Some(app) = by_name(&real)
    {
        return Some(app);
    }
    let home = home?;
    let drive = home.join("Library/Mobile Documents/com~apple~CloudDocs");
    ["Desktop", "Documents"]
        .into_iter()
        .any(|folder| {
            path.starts_with(home.join(folder)) && fs::symlink_metadata(drive.join(folder)).is_ok()
        })
        .then_some("iCloud Drive")
}

/// The person's home folder, from the environment.
pub fn home_folder() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .filter(|home| !home.is_empty())
        .map(PathBuf::from)
}

/// What `verify` and the app say about a vault in `app`'s folder.
pub fn synced_warning(app: &str) -> String {
    format!(
        "This vault is inside {app}, which copies files while KastenFlow writes them. That can leave conflicted copies or a half-copied history. Move the vault to a folder {app} doesn't sync, and use Backup for a copy in the cloud."
    )
}

/// The sync app named by one of the folders on `path`.
fn by_name(path: &Path) -> Option<&'static str> {
    let parts: Vec<String> = path
        .components()
        .filter_map(|part| match part {
            Component::Normal(name) => Some(name.to_string_lossy().to_lowercase()),
            _ => None,
        })
        .collect();
    for (at, part) in parts.iter().enumerate() {
        if part == "library" {
            match parts.get(at + 1).map(String::as_str) {
                Some("mobile documents") => return Some("iCloud Drive"),
                Some("cloudstorage") => {
                    // `~/Library/CloudStorage/<App>-<account>` on a Mac.
                    let Some(app) = parts.get(at + 2) else {
                        continue;
                    };
                    return Some(match app {
                        a if a.starts_with("onedrive") => "OneDrive",
                        a if a.starts_with("dropbox") => "Dropbox",
                        a if a.starts_with("googledrive") => "Google Drive",
                        a if a.starts_with("box") => "Box",
                        a if a.starts_with("icloud") => "iCloud Drive",
                        _ => "cloud storage",
                    });
                }
                _ => {}
            }
        }
        let app = match part.as_str() {
            "onedrive" => "OneDrive",
            p if p.starts_with("onedrive - ") => "OneDrive",
            "dropbox" => "Dropbox",
            p if p.starts_with("dropbox (") => "Dropbox",
            "google drive" | "my drive" | "shared drives" => "Google Drive",
            "iclouddrive" | "icloud drive" => "iCloud Drive",
            "box sync" => "Box",
            "nextcloud" => "Nextcloud",
            "owncloud" => "ownCloud",
            _ => continue,
        };
        return Some(app);
    }
    None
}

/// Where `path` really is when a link leads there: its nearest folder that
/// exists, with every link followed, and the rest of the path after it.
fn real_place(path: &Path) -> Option<PathBuf> {
    let mut known = path;
    let mut rest = Vec::new();
    loop {
        if let Ok(real) = fs::canonicalize(known) {
            let mut place = real;
            place.extend(rest.iter().rev());
            return Some(place);
        }
        rest.push(known.file_name()?);
        known = known.parent()?;
    }
}
