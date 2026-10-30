//! Files too big for GitHub (over 100 MiB) are left out of history, so one
//! file dropped in from outside never makes every push fail. They are listed
//! in `.kasten/backup-skip.yaml`, a vault file, so every computer knows what
//! its backup lacks. A file at 50 MiB or more still goes, with a warning.

use std::fs;
use std::path::{Component, Path};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::loose::Loose;

/// The list of files left out of history, inside the vault.
pub const SKIP_PATH: &str = ".kasten/backup-skip.yaml";
/// GitHub refuses a file larger than this.
pub const SKIP_LIMIT: u64 = 100 * 1024 * 1024;
/// GitHub warns about a file this large.
pub const WARN_LIMIT: u64 = 50 * 1024 * 1024;

/// A file left out of the backup for its size.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedFile {
    pub path: String,
    pub size: u64,
    /// When it was first left out (RFC 3339, UTC).
    pub since: String,
}

/// A file that is backed up but large enough for GitHub to warn about.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LargeFile {
    pub path: String,
    pub size: u64,
}

/// The list as the file holds it. Everything in it is kept as it was read,
/// keys this version does not know included; only the entries change.
struct Doc {
    map: Map<String, Value>,
    /// False when the file exists but is not a list this version can read:
    /// then it is never rewritten.
    readable: bool,
}

impl Doc {
    fn load(root: &Path) -> Doc {
        let empty = |readable| Doc {
            map: Map::new(),
            readable,
        };
        let text = match fs::read_to_string(root.join(SKIP_PATH)) {
            Ok(text) => text,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return empty(true),
            Err(_) => return empty(false),
        };
        let text = text.trim_start_matches('\u{feff}');
        if text.trim().is_empty() {
            return empty(true);
        }
        match serde_saphyr::from_str::<Loose>(text) {
            Ok(Loose(Value::Object(map))) if map.get("skipped").is_none_or(shaped) => Doc {
                map,
                readable: true,
            },
            _ => empty(false),
        }
    }

    fn entries(&self) -> Vec<SkippedFile> {
        let Some(Value::Array(list)) = self.map.get("skipped") else {
            return Vec::new();
        };
        list.iter()
            .filter_map(|entry| {
                Some(SkippedFile {
                    path: entry
                        .get("path")?
                        .as_str()
                        .filter(|p| inside(p))?
                        .to_owned(),
                    size: entry.get("size")?.as_u64()?,
                    since: entry
                        .get("since")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_owned(),
                })
            })
            .collect()
    }

    fn list(&mut self) -> &mut Vec<Value> {
        let slot = self
            .map
            .entry("skipped")
            .or_insert_with(|| Value::Array(Vec::new()));
        if slot.is_null() {
            *slot = Value::Array(Vec::new());
        }
        match slot {
            Value::Array(list) => list,
            _ => unreachable!("load only accepts a list"),
        }
    }

    /// Notes `path` at `size`; true when the file changed. Where the file
    /// system takes `Huge.bin` and `huge.bin` for one file, a file renamed
    /// only in case keeps its one entry (and its `since`).
    fn record(&mut self, path: &str, size: u64, since: &str) -> bool {
        let list = self.list();
        let found = list.iter_mut().find(|e| {
            e.get("path")
                .and_then(Value::as_str)
                .is_some_and(|p| same_file(p, path))
        });
        match found {
            Some(entry)
                if entry.get("size").and_then(Value::as_u64) == Some(size)
                    && entry.get("path").and_then(Value::as_str) == Some(path) =>
            {
                false
            }
            Some(entry) => {
                entry["size"] = json!(size);
                entry["path"] = json!(path);
                true
            }
            None => {
                list.push(json!({ "path": path, "size": size, "since": since }));
                true
            }
        }
    }

    fn remove(&mut self, path: &str) {
        self.list()
            .retain(|e| e.get("path").and_then(Value::as_str) != Some(path));
    }

    fn save(&self, root: &Path) -> bool {
        let Ok(text) = serde_saphyr::to_string(&Value::Object(self.map.clone())) else {
            return false;
        };
        // Comments and the order of the keys of the file as it was stay.
        let text = match fs::read_to_string(root.join(SKIP_PATH)) {
            Ok(old) => crate::config_merge::merge_yaml(&old, &text, &["skipped"]),
            Err(_) => text,
        };
        crate::atomic::write_atomic(&root.join(SKIP_PATH), text.as_bytes()).is_ok()
    }
}

/// Whether two paths name one file on this computer's file system.
fn same_file(a: &str, b: &str) -> bool {
    a == b || (cfg!(any(windows, target_os = "macos")) && a.to_lowercase() == b.to_lowercase())
}

fn shaped(value: &Value) -> bool {
    value.is_null() || value.is_array()
}

/// A path inside the vault: relative, with no `..` in it.
fn inside(path: &str) -> bool {
    !path.is_empty()
        && Path::new(path)
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
}

fn file_size(root: &Path, path: &str) -> Option<u64> {
    if !inside(path) {
        return None;
    }
    fs::metadata(root.join(path))
        .ok()
        .filter(fs::Metadata::is_file)
        .map(|meta| meta.len())
}

/// The files left out of history, from the list.
pub fn read_list(root: &Path) -> Vec<SkippedFile> {
    Doc::load(root).entries()
}

/// Whether `path` is a file too big to go into history.
pub(crate) fn too_big(root: &Path, path: &str) -> bool {
    path != SKIP_PATH && file_size(root, path).is_some_and(|size| size > SKIP_LIMIT)
}

/// Whether `path` is a file `list` already names at the size it has now, so a
/// pass over the vault's changes has nothing to do with it.
pub(crate) fn already_left_out(root: &Path, list: &[SkippedFile], path: &str) -> bool {
    !list.is_empty()
        && list.iter().any(|e| e.path == path)
        && file_size(root, path).is_some_and(|size| {
            size > SKIP_LIMIT && list.iter().any(|e| e.path == path && e.size == size)
        })
}

/// What to commit of `paths`.
pub(crate) struct Screened {
    /// The paths that go into the commit: `paths` without the files too big.
    pub keep: Vec<String>,
    /// The list changed and was written; it goes into the commit too.
    pub wrote: bool,
}

/// Leaves the files over the limit out of a commit, and brings the list up to
/// date: new files are added, and those that shrank or went are dropped (a
/// file that shrank goes into this commit). A list that cannot be read is
/// left alone, and the big files are left out all the same.
pub(crate) fn screen(root: &Path, paths: &[String]) -> Screened {
    let mut doc = Doc::load(root);
    let since = crate::time::Instant::now().rfc3339();
    let mut changed = false;
    let mut keep = Vec::with_capacity(paths.len());
    for path in paths {
        if crate::history::local_only(path) || !too_big(root, path) {
            keep.push(path.clone());
        } else if doc.readable
            && let Some(size) = file_size(root, path)
        {
            changed |= doc.record(path, size, &since);
        }
    }
    if doc.readable {
        for entry in doc.entries() {
            match file_size(root, &entry.path) {
                Some(size) if size > SKIP_LIMIT => {
                    changed |= doc.record(&entry.path, size, &since);
                }
                now => {
                    doc.remove(&entry.path);
                    changed = true;
                    if now.is_some() && !keep.contains(&entry.path) {
                        keep.push(entry.path);
                    }
                }
            }
        }
    }
    let wrote = changed && doc.readable && doc.save(root);
    Screened { keep, wrote }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_paths_inside_the_vault_count() {
        assert!(inside("media/huge.bin"));
        assert!(!inside("../huge.bin"));
        assert!(!inside("/etc/passwd"));
        assert!(!inside(""));
    }

    #[test]
    fn a_changed_entry_keeps_the_comments_and_the_other_keys_of_the_file() {
        let dir = std::env::temp_dir().join(format!(
            "kasten-skip-keep-{}",
            crate::id::ulid_at(crate::time::Instant::now().millis)
        ));
        fs::create_dir_all(dir.join(".kasten")).unwrap();
        fs::write(
            dir.join(SKIP_PATH),
            "# files GitHub would refuse\nzeta: 1\nskipped:\n- path: a.bin\n  size: 7\n  since: x\n# the end\n",
        )
        .unwrap();
        fs::write(dir.join("a.bin"), vec![0u8; 3]).unwrap();
        let mut doc = Doc::load(&dir);
        assert!(doc.record("b.bin", 9, "y"));
        assert!(doc.save(&dir));
        let text = fs::read_to_string(dir.join(SKIP_PATH)).unwrap();
        assert!(
            text.starts_with("# files GitHub would refuse\nzeta: 1\nskipped:\n"),
            "{text}"
        );
        assert!(text.ends_with("# the end\n"), "{text}");
        assert!(text.contains("b.bin"), "{text}");
        assert_eq!(Doc::load(&dir).entries().len(), 2);
        // Only the test's own folder under the system temp folder.
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_list_of_the_wrong_shape_is_not_rewritten() {
        let dir = std::env::temp_dir().join(format!(
            "kasten-skip-{}",
            crate::id::ulid_at(crate::time::Instant::now().millis)
        ));
        fs::create_dir_all(dir.join(".kasten")).unwrap();
        fs::write(dir.join(SKIP_PATH), "skipped: 3\n").unwrap();
        assert!(!Doc::load(&dir).readable);
        fs::write(dir.join(SKIP_PATH), "skipped:\n- path: a.bin\n  size: 7\n").unwrap();
        assert_eq!(Doc::load(&dir).entries().len(), 1);
        // Only the test's own folder under the system temp folder.
        let _ = fs::remove_dir_all(&dir);
    }
}
