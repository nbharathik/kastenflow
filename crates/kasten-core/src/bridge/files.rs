//! The mailbox's folder and every file in it. All reading, writing and
//! removing of those files is here, so the rules are in one place: ids are
//! plain hex (a name can never leave the folder), nothing is followed through a
//! link, a file is read only up to its size limit and only if its owner alone
//! can read it, writes are atomic, and the one removal refuses any path that
//! is not strictly inside the mailbox.

use std::fs::{self, DirBuilder, File};
use std::io::Read as _;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use super::call::{Reply, Request};
use super::{
    DIR, MAX_REPLY_BYTES, MAX_REQUEST_BYTES, MAX_WAITING, Platform, REPLY_TTL_MS, REQUEST_TTL_MS,
};
use crate::error::{Error, Result};
use crate::local_paths;

/// The mailbox of one vault.
#[derive(Clone)]
pub struct Mailbox {
    dir: PathBuf,
    pub(super) platform: Platform,
}

/// What reading a file in the mailbox found.
pub(super) enum Found {
    Missing,
    /// There, but not a plain, private, small-enough file.
    Refused,
    Bytes(Vec<u8>),
}

/// What taking a request came to.
pub(super) enum Taken {
    Request(Request),
    /// Answer with this and nothing else (the request could not be read).
    Reply(Reply),
    Nothing,
}

/// An id is 32 to 64 lowercase hex digits: nothing else is ever a file name here.
fn valid_id(id: &str) -> bool {
    (32..=64).contains(&id.len()) && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn check_id(id: &str) -> Result<()> {
    if valid_id(id) {
        Ok(())
    } else {
        Err(Error::Invalid("That is not a request id".to_owned()))
    }
}

fn private_dir(path: &Path) -> std::io::Result<()> {
    let mut builder = DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path)
}

fn millis(time: std::time::SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

impl Mailbox {
    /// The mailbox of the vault at `root`. A link anywhere on the way to it is
    /// refused.
    pub fn open(root: &Path, platform: Platform) -> Result<Mailbox> {
        let dir = local_paths::resolve_root(root)?.join(DIR);
        local_paths::check(&dir)?;
        Ok(Mailbox { dir, platform })
    }

    pub(super) fn requests(&self) -> PathBuf {
        self.dir.join("requests")
    }

    pub(super) fn replies(&self) -> PathBuf {
        self.dir.join("replies")
    }

    pub(super) fn alive_path(&self) -> PathBuf {
        self.dir.join("app-alive.json")
    }

    pub(super) fn selection_path(&self) -> PathBuf {
        self.dir.join("selection.json")
    }

    fn request_path(&self, id: &str) -> PathBuf {
        self.requests().join(format!("{id}.json"))
    }

    fn reply_path(&self, id: &str) -> PathBuf {
        self.replies().join(format!("{id}.json"))
    }

    /// A new unguessable id.
    pub fn new_id(&self) -> Result<String> {
        let id = (self.platform.random_id)()?;
        check_id(&id)?;
        Ok(id)
    }

    /// Makes the folders (readable by their owner alone where that can be said),
    /// and refuses them if any is a link.
    pub fn ensure_dirs(&self) -> Result<()> {
        local_paths::check(&self.dir)?;
        for folder in [self.requests(), self.replies()] {
            private_dir(&folder)?;
            local_paths::check(&folder)?;
        }
        Ok(())
    }

    /// Writes `bytes` at `path` in the mailbox: atomic, owner only.
    pub(super) fn write(&self, path: &Path, bytes: &[u8]) -> Result<()> {
        if let Some(parent) = path.parent() {
            local_paths::check(parent)?;
        }
        (self.platform.write)(path, bytes).map_err(Error::Io)
    }

    /// Reads the file at `path`: only a plain file of at most `cap` bytes that
    /// its owner alone can read.
    pub(super) fn read(&self, path: &Path, cap: u64) -> Found {
        let meta = match fs::symlink_metadata(path) {
            Ok(meta) => meta,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Found::Missing,
            Err(_) => return Found::Refused,
        };
        let plain_folder = path.parent().is_some_and(|p| local_paths::check(p).is_ok());
        if crate::latex::is_link(&meta)
            || !meta.is_file()
            || meta.len() > cap
            || !plain_folder
            || !(self.platform.is_private)(path)
        {
            return Found::Refused;
        }
        let mut bytes = Vec::new();
        match File::open(path).and_then(|file| file.take(cap + 1).read_to_end(&mut bytes)) {
            Ok(_) if bytes.len() as u64 <= cap => Found::Bytes(bytes),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Found::Missing,
            _ => Found::Refused,
        }
    }

    /// Removes a file of the mailbox, or a link left among them (never what a
    /// link points to). Nothing outside the mailbox is ever touched: a path
    /// that is not strictly inside it, or is reached through a link, is left.
    pub(super) fn forget(&self, path: &Path) {
        let inside = path.strip_prefix(&self.dir).is_ok_and(|rel| {
            rel.components().count() > 0
                && rel.components().all(|c| matches!(c, Component::Normal(_)))
        });
        let plain_folder = path.parent().is_some_and(|p| local_paths::check(p).is_ok());
        if inside && plain_folder {
            let _ = fs::remove_file(path);
        }
    }

    /// The ids of the requests waiting, oldest first, at most twice the limit.
    pub(super) fn waiting(&self) -> Vec<String> {
        let folder = self.requests();
        if local_paths::check(&folder).is_err() {
            return Vec::new();
        }
        let Ok(entries) = fs::read_dir(&folder) else {
            return Vec::new();
        };
        let mut found: Vec<(u64, String)> = entries
            .flatten()
            .take(MAX_WAITING * 2)
            .filter_map(|entry| {
                let name = entry.file_name().to_string_lossy().into_owned();
                let id = name.strip_suffix(".json")?;
                let when = entry
                    .metadata()
                    .and_then(|m| m.modified())
                    .map_or(0, millis);
                valid_id(id).then(|| (when, id.to_owned()))
            })
            .collect();
        found.sort();
        found.into_iter().map(|(_, id)| id).collect()
    }

    /// How many request files are there, of any name.
    pub(super) fn waiting_count(&self) -> usize {
        let folder = self.requests();
        if local_paths::check(&folder).is_err() {
            return 0;
        }
        fs::read_dir(folder).map_or(0, |entries| entries.flatten().take(MAX_WAITING * 2).count())
    }

    /// Writes a request. Its id must be a valid one; it may not be too big.
    pub fn put_request(&self, request: &Request) -> Result<()> {
        check_id(&request.id)?;
        let bytes = serde_json::to_vec(request).map_err(|e| Error::Invalid(e.to_string()))?;
        if bytes.len() as u64 > MAX_REQUEST_BYTES {
            return Err(Error::Invalid("That request is too big to send".to_owned()));
        }
        self.ensure_dirs()?;
        self.write(&self.request_path(&request.id), &bytes)
    }

    /// Takes up a waiting request: read once, removed, and dropped if it is
    /// forged (its own id is not its file's name) or has expired.
    pub(super) fn take_request(&self, id: &str, now: u64) -> Taken {
        let path = self.request_path(id);
        let bytes = match self.read(&path, MAX_REQUEST_BYTES) {
            Found::Missing => return Taken::Nothing,
            Found::Refused => {
                self.forget(&path);
                return Taken::Nothing;
            }
            Found::Bytes(bytes) => bytes,
        };
        self.forget(&path);
        let Ok(request) = serde_json::from_slice::<Request>(&bytes) else {
            return Taken::Reply(Reply::failed(id, "The request could not be read"));
        };
        let age = now.saturating_sub(request.created);
        if request.id != id || age > REQUEST_TTL_MS || request.created > now + REQUEST_TTL_MS {
            return Taken::Nothing;
        }
        Taken::Request(request)
    }

    /// Withdraws a request that was not taken up (the asker gave up).
    pub(super) fn withdraw(&self, id: &str) {
        if valid_id(id) {
            self.forget(&self.request_path(id));
            self.forget(&self.reply_path(id));
        }
    }

    /// Writes the app's answer.
    pub fn put_reply(&self, reply: &Reply) -> Result<()> {
        check_id(&reply.id)?;
        let bytes = serde_json::to_vec(reply).map_err(|e| Error::Invalid(e.to_string()))?;
        if bytes.len() as u64 > MAX_REPLY_BYTES {
            return Err(Error::Invalid("That answer is too big to send".to_owned()));
        }
        self.ensure_dirs()?;
        self.write(&self.reply_path(&reply.id), &bytes)
    }

    /// The answer to request `id` if it has come: read once and removed. An
    /// answer that is not as it should be is removed and refused.
    pub fn take_reply(&self, id: &str) -> Result<Option<Reply>> {
        check_id(id)?;
        let path = self.reply_path(id);
        let unreadable = || Error::Invalid("The app's answer could not be read".to_owned());
        match self.read(&path, MAX_REPLY_BYTES) {
            Found::Missing => Ok(None),
            Found::Refused => {
                self.forget(&path);
                Err(unreadable())
            }
            Found::Bytes(bytes) => {
                self.forget(&path);
                match serde_json::from_slice::<Reply>(&bytes) {
                    Ok(reply) if reply.id == id => Ok(Some(reply)),
                    _ => Err(unreadable()),
                }
            }
        }
    }

    /// Removes what is old: requests nobody took up, answers nobody read, the
    /// half-written leftovers of a write that failed, and links.
    pub fn sweep(&self, now: u64) {
        for (folder, ttl) in [
            (self.requests(), REQUEST_TTL_MS * 2),
            (self.replies(), REPLY_TTL_MS),
        ] {
            if local_paths::check(&folder).is_err() {
                continue;
            }
            let Ok(entries) = fs::read_dir(&folder) else {
                continue;
            };
            for entry in entries.flatten().take(MAX_WAITING * 4) {
                let path = entry.path();
                let Ok(meta) = fs::symlink_metadata(&path) else {
                    continue;
                };
                let old = meta
                    .modified()
                    .is_ok_and(|m| now.saturating_sub(millis(m)) > ttl);
                if crate::latex::is_link(&meta) || (meta.is_file() && old) {
                    self.forget(&path);
                }
            }
        }
    }
}
