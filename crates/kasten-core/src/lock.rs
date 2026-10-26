//! The vault's write lock, `.kasten/write.lock`: the app, the CLI and the MCP
//! server take it for every op, so two processes never write at once.

use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::thread::ThreadId;

use crate::error::Result;

pub const LOCK_PATH: &str = ".kasten/write.lock";

#[derive(Debug)]
pub struct WriteLock {
    path: PathBuf,
    /// Threads of one process queue here before taking the file lock.
    local: Mutex<()>,
    /// The thread that holds the lock now. It may ask for it again (a batch
    /// holds the lock while each of its ops takes it for itself); any other
    /// thread waits its turn.
    owner: Mutex<Option<ThreadId>>,
}

/// Lets go of the thread's claim on the lock, even when the op panics.
struct Claim<'a>(&'a Mutex<Option<ThreadId>>);

impl Drop for Claim<'_> {
    fn drop(&mut self) {
        *self.0.lock().unwrap_or_else(|p| p.into_inner()) = None;
    }
}

impl WriteLock {
    pub fn new(root: &Path) -> WriteLock {
        WriteLock {
            path: root.join(LOCK_PATH),
            local: Mutex::new(()),
            owner: Mutex::new(None),
        }
    }

    /// Runs `op` while holding the lock, waiting for any other holder. A
    /// thread that holds it already runs `op` at once.
    pub fn hold<T>(&self, op: impl FnOnce() -> Result<T>) -> Result<T> {
        let me = std::thread::current().id();
        if *self.owner.lock().unwrap_or_else(|p| p.into_inner()) == Some(me) {
            return op();
        }
        crate::local_paths::check(&self.path)?;
        let _local = self
            .local
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir)?;
        }
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(&self.path)?;
        let mut lock = fd_lock::RwLock::new(file);
        let _held = lock.write()?;
        *self.owner.lock().unwrap_or_else(|p| p.into_inner()) = Some(me);
        let _claim = Claim(&self.owner);
        op()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Duration;

    use super::*;

    #[test]
    fn the_holder_may_ask_again_and_everyone_else_waits() {
        let dir = std::env::temp_dir().join(format!(
            "kasten-lock-{}",
            crate::ulid_at(crate::Instant::now().millis)
        ));
        fs::create_dir_all(&dir).unwrap();
        let lock = Arc::new(WriteLock::new(&dir));
        let other_ran = Arc::new(AtomicBool::new(false));
        let mut waiting = None;
        let inner = lock
            .hold(|| {
                // Again, by the same thread: no wait, no deadlock.
                let inner = lock.hold(|| Ok(7))?;
                let (lock, ran) = (Arc::clone(&lock), Arc::clone(&other_ran));
                waiting = Some(std::thread::spawn(move || {
                    lock.hold(|| {
                        ran.store(true, Ordering::SeqCst);
                        Ok(())
                    })
                }));
                std::thread::sleep(Duration::from_millis(200));
                assert!(
                    !other_ran.load(Ordering::SeqCst),
                    "another thread got in while the lock was held"
                );
                Ok(inner)
            })
            .unwrap();
        assert_eq!(inner, 7);
        // The other thread goes on once the holder is done.
        waiting.unwrap().join().unwrap().unwrap();
        assert!(other_ran.load(Ordering::SeqCst));
        assert_eq!(lock.hold(|| Ok(1)).unwrap(), 1);
        fs::remove_dir_all(&dir).unwrap();
    }
}
