//! Small files the chat keeps in the app's cache folder: what requests found
//! out about a model, the last list of a plan's models, the connection
//! report. Nothing the person wrote and nothing secret goes in them, so the
//! vault is never touched and losing them costs nothing.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde::Serialize;
use serde::de::DeserializeOwned;

static FOLDER: OnceLock<PathBuf> = OnceLock::new();

/// Where the files go; set once, as the app starts.
pub fn use_folder(dir: PathBuf) {
    let _ = FOLDER.set(dir);
}

/// The folder the app named, if it has.
pub fn folder() -> Option<PathBuf> {
    FOLDER.get().cloned()
}

/// What `name` in `dir` holds, if it is there and reads.
pub fn read<T: DeserializeOwned>(dir: &Path, name: &str) -> Option<T> {
    let text = fs::read_to_string(dir.join(name)).ok()?;
    serde_json::from_str(&text).ok()
}

/// Writes `value` as `name` in `dir` in one step, so a crash leaves the old
/// file or the new one and never half of either.
pub fn write<T: Serialize>(dir: &Path, name: &str, value: &T) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    let text = serde_json::to_string(value).map_err(io::Error::other)?;
    let part = dir.join(format!("{name}.part"));
    fs::write(&part, text)?;
    fs::rename(&part, dir.join(name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_is_written_whole_and_read_back_and_junk_reads_as_nothing() {
        let dir = std::env::temp_dir().join(format!("kasten-cache-{}", std::process::id()));
        write(&dir, "x.json", &vec![1, 2, 3]).unwrap();
        write(&dir, "x.json", &vec![4, 5]).unwrap();
        assert_eq!(read::<Vec<u32>>(&dir, "x.json"), Some(vec![4, 5]));
        assert!(
            !dir.join("x.json.part").exists(),
            "the half-written file is gone"
        );
        fs::write(dir.join("junk.json"), "{").unwrap();
        assert_eq!(read::<Vec<u32>>(&dir, "junk.json"), None);
        assert_eq!(read::<Vec<u32>>(&dir, "missing.json"), None);
        // Only this test's own folder under the system temp folder.
        let _ = fs::remove_dir_all(&dir);
    }
}
