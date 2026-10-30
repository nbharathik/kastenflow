//! A build of text that is not saved yet: the changes an assistant proposed
//! and the person has not accepted. It is made in a scratch folder of its own
//! in the vault's cache, so the document's own build folder (its last good
//! PDF, its log, its SyncTeX file) and the person's files are never touched,
//! and the scratch folder is removed when the build ends. What comes back is
//! only the engine's diagnostics: how many errors the proposed text has.

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, SystemTime};

use super::build::{Job, PREVIEW_PARENT, execute};
use super::cache::forget;
use super::engines::CommandSpec;
use super::service::Outcome;

/// A scratch folder left by a crash is removed after this long.
const STALE: Duration = Duration::from_secs(60 * 60);

static COUNTER: AtomicU64 = AtomicU64::new(0);

/// How a preview build went.
pub struct Previewed {
    pub outcome: Outcome,
    /// The engine said it was fetching TeX packages (the first build does).
    pub fetched_packages: bool,
}

/// A name for one preview's folder: plain hex, never the same twice.
fn fresh_name() -> String {
    let nanos = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{:x}-{nanos:x}-{n:x}", std::process::id())
}

/// Removes preview folders old enough to be left over from a crash.
fn sweep(root: &Path) {
    let parent = root.join(PREVIEW_PARENT);
    let Ok(entries) = std::fs::read_dir(&parent) else {
        return;
    };
    for entry in entries.flatten() {
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|made| made.elapsed().ok())
            .is_some_and(|age| age > STALE);
        if old {
            forget(&parent, &entry.path());
        }
    }
}

/// Builds `job` (whose `buffers` hold the proposed text) in a scratch folder,
/// then removes the folder. `wrap` may change the command before it runs (the
/// identity for a real build).
pub fn run(job: Job, wrap: &dyn Fn(CommandSpec) -> CommandSpec) -> Previewed {
    run_in(job, &fresh_name(), wrap)
}

/// `run`, in the scratch folder called `name`.
pub fn run_in(mut job: Job, name: &str, wrap: &dyn Fn(CommandSpec) -> CommandSpec) -> Previewed {
    sweep(&job.root);
    job.scratch = Some(name.to_owned());
    let fetched = AtomicBool::new(false);
    let outcome = execute(
        &job,
        &AtomicBool::new(false),
        &|_| fetched.store(true, Ordering::Relaxed),
        wrap,
    );
    let parent = job.root.join(PREVIEW_PARENT);
    forget(&parent, &parent.join(name));
    Previewed {
        outcome,
        fetched_packages: fetched.load(Ordering::Relaxed),
    }
}
