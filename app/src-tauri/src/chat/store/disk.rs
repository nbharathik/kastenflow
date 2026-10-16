//! Files of the chat's own folders in the app's data: written whole and in
//! one step, read with damage in mind. A file that does not read is set
//! aside under a new name (`.bad`) rather than deleted or trusted.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::de::DeserializeOwned;

static WRITES: AtomicU64 = AtomicU64::new(0);

/// Writes `bytes` to `path`, flushed to disk first and put in place in one
/// step: a power cut leaves the old file or the new one, never half.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let dir = path
        .parent()
        .ok_or_else(|| io::Error::other("a file needs a folder"))?;
    fs::create_dir_all(dir)?;
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let n = WRITES.fetch_add(1, Ordering::Relaxed);
    let temp = dir.join(format!("{name}.{}.{n}.tmp", std::process::id()));
    let written = (|| {
        let mut file = fs::File::create(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp, path)
    })();
    if written.is_err() {
        super::remove::file(dir, &temp);
    }
    written
}

/// How reading a file went wrong.
#[derive(Debug)]
pub enum Unread {
    Missing,
    /// It is there and cannot be used: one that did not parse has been set aside.
    Damaged,
}

/// `path` read as JSON of type `T`. A file that is not valid, or not a `T`,
/// is renamed to `<name>.bad` (replacing an older one) and reported.
pub fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T, Unread> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Err(Unread::Missing),
        // A file that cannot be read now (locked, no rights) is not moved.
        Err(_) => return Err(Unread::Damaged),
    };
    serde_json::from_slice(&bytes).map_err(|_| {
        set_aside(path);
        Unread::Damaged
    })
}

/// Renames a file that does not read to `<name>.bad`.
pub fn set_aside(path: &Path) {
    let mut bad: PathBuf = path.to_path_buf();
    let name = path
        .file_name()
        .map(|n| format!("{}.bad", n.to_string_lossy()))
        .unwrap_or_else(|| "file.bad".to_owned());
    bad.set_file_name(name);
    let _ = fs::rename(path, bad);
}
