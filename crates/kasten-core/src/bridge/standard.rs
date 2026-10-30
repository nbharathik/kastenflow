//! The standard library's way of doing what `Platform` asks: private files
//! on Unix by permission bits, and ids from the per-process random keys the
//! standard library keeps (as note ids do). On Windows the file inherits its
//! folder's access list; the program gives the strict platform there.

use std::collections::hash_map::RandomState;
use std::fs::OpenOptions;
use std::hash::{BuildHasher, Hasher};
use std::io::{self, Write};
use std::path::Path;

use super::Platform;

impl Platform {
    /// Standard library only; enough for tests and for tools that never
    /// carry secrets.
    pub fn standard() -> Platform {
        Platform {
            write,
            is_private,
            random_id,
        }
    }
}

fn random_id() -> io::Result<String> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos() as u64);
    let mut out = String::with_capacity(64);
    for round in 0..4u64 {
        let mut hasher = RandomState::new().build_hasher();
        hasher.write_u64(nanos ^ round);
        hasher.write_u32(std::process::id());
        out.push_str(&format!("{:016x}", hasher.finish()));
    }
    Ok(out)
}

fn write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let temp = path.with_extension(format!("{}.new", &random_id()?[..16]));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temp)?;
    let written = file.write_all(bytes).and_then(|()| file.sync_all());
    drop(file);
    // A half-made file left by a failure is swept with the other old ones.
    written.and_then(|()| std::fs::rename(&temp, path))
}

fn is_private(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path).is_ok_and(|m| m.permissions().mode() & 0o077 == 0)
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        true
    }
}
