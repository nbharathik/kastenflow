//! A vault of its own for each test, with history, and what the tests share.

use std::fs;
use std::path::PathBuf;

use kasten_core::history::Actor;
use kasten_core::{Instant, Kasten, ulid_at};

pub const NOW: Instant = Instant {
    millis: 1_790_236_800_000,
};

/// Where the managed file is.
pub const MANAGED: &str = "sources/references.bib";

pub struct Fresh {
    pub dir: PathBuf,
    pub k: Kasten,
}

impl Drop for Fresh {
    fn drop(&mut self) {
        // Only the test's own vault under the system temp folder.
        let _ = fs::remove_dir_all(&self.dir);
    }
}

pub fn fresh() -> Fresh {
    let dir = std::env::temp_dir().join(format!("kasten-bib-{}", ulid_at(Instant::now().millis)));
    let k = Kasten::init(&dir, "References").unwrap();
    Fresh { dir, k }
}

pub fn human() -> Actor {
    Actor::Human
}

impl Fresh {
    /// Writes a file of the vault as it is, without telling the engine.
    pub fn put(&self, path: &str, text: &str) {
        let file = self.dir.join(path);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(file, text).unwrap();
    }

    pub fn put_bytes(&self, path: &str, bytes: &[u8]) {
        let file = self.dir.join(path);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(file, bytes).unwrap();
    }

    pub fn text(&self, path: &str) -> String {
        fs::read_to_string(self.dir.join(path)).unwrap()
    }

    /// A file's bytes as text, whatever they are (for comparing binary files too).
    pub fn text_or_bytes(&self, path: &str) -> String {
        String::from_utf8_lossy(&fs::read(self.dir.join(path)).unwrap()).into_owned()
    }

    pub fn exists(&self, path: &str) -> bool {
        self.dir.join(path).exists()
    }

    /// The managed file's hash, as the bibliography reports it.
    pub fn hash(&self) -> String {
        self.k.bibliography().unwrap().managed.hash
    }

    /// The id of the newest commit.
    pub fn head(&self) -> String {
        self.k.log(None, 1).unwrap().remove(0).id
    }

    /// Puts the engine in step with files written behind its back.
    pub fn reindex(&self) {
        self.k.reindex().unwrap();
    }
}
