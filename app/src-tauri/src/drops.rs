//! Markdown files or a folder dropped on the window, made ready to import.
//! A webview hands over a dropped file's bytes but not where it lives, and
//! the importer reads a folder, so the files are copied into a folder of
//! the app's own cache, outside every vault. The Import view then looks at
//! that folder and imports it, as one commit that can be undone, as it
//! would a folder picked by hand. The vault is not touched here.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use tauri::{AppHandle, Manager};

/// A drop larger than this is better picked with Browse.
const MOST_BYTES: usize = 64 * 1024 * 1024;
const MOST_FILES: usize = 5_000;
/// Folders deeper than this are not a notes folder.
const MOST_DEPTH: usize = 24;

#[derive(Debug, Deserialize)]
pub struct DroppedFile {
    /// Its path within what was dropped, with forward slashes.
    rel: String,
    data: Vec<u8>,
}

/// `rel` as a path to write under the staging folder: plain names only,
/// never a way out of it and never a hidden file.
fn clean_rel(rel: &str) -> Option<String> {
    let parts: Vec<&str> = rel.split('/').collect();
    let plain = |part: &&str| {
        !part.is_empty()
            && !part.starts_with('.')
            && !part.contains(['\\', ':', '\0'])
            && part.trim() == *part
    };
    (parts.len() <= MOST_DEPTH && parts.iter().all(plain)).then(|| parts.join("/"))
}

/// A folder name for the drop, which names the project it becomes.
fn clean_name(name: &str) -> String {
    let name: String = name
        .chars()
        .filter(|c| {
            !c.is_control() && !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
        })
        .collect();
    let name = name.trim().trim_start_matches('.').trim();
    if name.is_empty() {
        "Dropped notes".to_owned()
    } else {
        name.chars().take(80).collect()
    }
}

/// Writes `files` into a new folder `name` under `drops`, first clearing
/// the copies an earlier drop left there. Returns the folder.
fn stage(drops: &Path, name: &str, files: &[DroppedFile]) -> Result<PathBuf, String> {
    if files.is_empty() {
        return Err("Nothing was dropped that KastenFlow can import".into());
    }
    if files.len() > MOST_FILES || files.iter().map(|f| f.data.len()).sum::<usize>() > MOST_BYTES {
        return Err(
            "That is a lot to drop at once. Pick the folder with Browse in Import instead".into(),
        );
    }
    let cleaned = files
        .iter()
        .map(|f| clean_rel(&f.rel).map(|rel| (rel, &f.data)))
        .collect::<Option<Vec<_>>>()
        .ok_or("A dropped file has a name KastenFlow can't use")?;
    let failed = |e: std::io::Error| format!("Could not get the dropped files ready: {e}");
    fs::create_dir_all(drops).map_err(failed)?;
    clear(drops);
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis());
    let root = drops.join(format!("{stamp}-{}", std::process::id()));
    fs::create_dir(&root).map_err(failed)?;
    let folder = root.join(clean_name(name));
    fs::create_dir(&folder).map_err(failed)?;
    for (rel, data) in cleaned {
        let path = folder.join(&rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(failed)?;
        }
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(failed)?;
        file.write_all(data).map_err(failed)?;
    }
    Ok(folder)
}

/// Removes the copies earlier drops left in `drops`: folders this module
/// made, never the files they were copied from.
fn clear(drops: &Path) {
    for entry in fs::read_dir(drops).into_iter().flatten().flatten() {
        let path = entry.path();
        if entry.file_type().is_ok_and(|t| t.is_dir()) {
            let _ = fs::remove_dir_all(path);
        }
    }
}

/// Copies what was dropped into the app's cache; returns the folder for
/// the Import view to look at.
#[tauri::command(async)]
pub fn stage_drop(
    app: AppHandle,
    name: Option<String>,
    files: Vec<DroppedFile>,
) -> Result<String, String> {
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    let folder = stage(&cache.join("drops"), name.as_deref().unwrap_or(""), &files)?;
    Ok(folder.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kasten-drops-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    fn file(rel: &str, text: &str) -> DroppedFile {
        DroppedFile {
            rel: rel.into(),
            data: text.as_bytes().to_vec(),
        }
    }

    #[test]
    fn names_stay_inside_the_folder() {
        assert_eq!(
            clean_rel("Trip/Day one.md").as_deref(),
            Some("Trip/Day one.md")
        );
        for bad in [
            "../x.md",
            "/etc/passwd",
            "a//b.md",
            ".obsidian/app.json",
            "a/./b.md",
            "C:x.md",
            "a\\b.md",
            "",
        ] {
            assert_eq!(clean_rel(bad), None, "{bad}");
        }
        assert_eq!(clean_name(" ../Trip notes "), "Trip notes");
        assert_eq!(clean_name(""), "Dropped notes");
    }

    #[test]
    fn a_drop_is_written_under_its_name_and_the_last_one_cleared() {
        let drops = scratch("stage");
        let first = stage(
            &drops,
            "Trip",
            &[
                file("Day one.md", "# Day one\n"),
                file("img/map.png", "png"),
            ],
        )
        .unwrap();
        assert!(first.ends_with("Trip"));
        assert_eq!(
            fs::read_to_string(first.join("Day one.md")).unwrap(),
            "# Day one\n"
        );
        assert!(first.join("img/map.png").is_file());

        let second = stage(&drops, "", &[file("Idea.md", "An idea\n")]).unwrap();
        assert!(second.ends_with("Dropped notes"));
        assert!(!first.exists(), "the earlier copy is cleared");
        assert!(stage(&drops, "x", &[file("../out.md", "no")]).is_err());
        assert!(stage(&drops, "x", &[]).is_err());
        let _ = fs::remove_dir_all(&drops);
    }
}
