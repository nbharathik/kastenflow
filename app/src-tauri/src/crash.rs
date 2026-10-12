//! When something goes wrong. Every panic, on any thread, is
//! written to `crash.log` in the app's log folder, with the thread, the
//! place and a backtrace, and is still printed as before. Commands turn a
//! panic into an error the window shows (`caught`), so a slip in one
//! request never takes the app down; the log is how it gets fixed.

use std::any::Any;
use std::backtrace::Backtrace;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::panic::{self, AssertUnwindSafe, PanicHookInfo};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use kasten_core::Instant;

/// The log, once the app knows its log folder.
static LOG: OnceLock<PathBuf> = OnceLock::new();

/// A log past this size starts again, the last one kept beside it.
const MAX_BYTES: u64 = 1 << 20;

/// Records every panic from now on, once `log_to` has named the folder.
pub fn install() {
    let print = panic::take_hook();
    panic::set_hook(Box::new(move |info| {
        print(info);
        if let Some(path) = LOG.get() {
            let _ = record(path, &report(info));
        }
    }));
}

/// Where the log goes: `crash.log` in `dir`. The first folder given wins.
pub fn log_to(dir: &Path) {
    if fs::create_dir_all(dir).is_ok() {
        let _ = LOG.set(dir.join("crash.log"));
    }
}

/// The log's path, once known.
pub fn log_path() -> Option<&'static Path> {
    LOG.get().map(PathBuf::as_path)
}

/// Runs `work`, answering with an error instead of a panic.
pub fn caught<T>(work: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    panic::catch_unwind(AssertUnwindSafe(work)).unwrap_or_else(|payload| Err(problem(&*payload)))
}

/// What a command answers after a panic, from the panic's payload.
pub fn problem(payload: &(dyn Any + Send)) -> String {
    let log = log_path().map_or(String::new(), |p| {
        format!(" Details are in {}.", p.display())
    });
    format!(
        "KastenFlow hit a problem it did not expect: {}.{log}",
        message(payload)
    )
}

/// Why a blocking task gave no answer: the problem, if it panicked.
pub fn joined(err: tauri::Error) -> String {
    match err {
        tauri::Error::JoinError(join) if join.is_panic() => problem(&*join.into_panic()),
        other => other.to_string(),
    }
}

/// The most of a panic's message that is kept. Some messages quote the
/// text they tripped on, which may be from a note, and the log is a file
/// people are asked to send.
const MAX_MESSAGE: usize = 300;

/// A panic's message: the text given to `panic!`, if any, cut short.
fn message(payload: &(dyn Any + Send)) -> String {
    let text = payload
        .downcast_ref::<&str>()
        .map(|s| (*s).to_owned())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "a panic without a message".to_owned());
    match text.char_indices().nth(MAX_MESSAGE) {
        Some((cut, _)) => format!("{}…", &text[..cut]),
        None => text,
    }
}

fn report(info: &PanicHookInfo<'_>) -> String {
    let thread = std::thread::current();
    let place = info.location().map_or_else(
        || "an unknown place".to_owned(),
        |at| format!("{}:{}:{}", at.file(), at.line(), at.column()),
    );
    format!(
        "{} KastenFlow {} panicked on thread '{}' at {place}: {}\n{}\n\n",
        Instant::now().rfc3339(),
        env!("CARGO_PKG_VERSION"),
        thread.name().unwrap_or("unnamed"),
        message(info.payload()),
        Backtrace::force_capture(),
    )
}

/// Appends `text` to the log, starting afresh past `MAX_BYTES`.
pub(crate) fn record(path: &Path, text: &str) -> std::io::Result<()> {
    if fs::metadata(path).is_ok_and(|m| m.len() > MAX_BYTES) {
        fs::rename(path, path.with_extension("old.log"))?;
    }
    let mut options = OpenOptions::new();
    options.create(true).append(true);
    // Only this user can read what went wrong, which can name notes.
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    options.open(path)?.write_all(text.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_panic_becomes_an_error_with_its_message() {
        let answer: Result<(), String> = caught(|| panic!("the board's file is not JSON"));
        let err = answer.unwrap_err();
        assert!(
            err.starts_with(
                "KastenFlow hit a problem it did not expect: the board's file is not JSON."
            ),
            "{err}"
        );
        let formatted: Result<(), String> = caught(|| panic!("{} cards", 3));
        assert!(formatted.unwrap_err().contains("3 cards"));
        let long: Result<(), String> = caught(|| panic!("{}", "é".repeat(1000)));
        let long = long.unwrap_err();
        assert!(
            long.contains(&format!("{}…", "é".repeat(MAX_MESSAGE))),
            "{long}"
        );
        assert!(!long.contains(&"é".repeat(MAX_MESSAGE + 1)));
        assert_eq!(caught(|| Ok::<_, String>(7)), Ok(7));
        assert_eq!(
            caught(|| Err::<(), _>("plain".to_owned())),
            Err("plain".to_owned())
        );
    }

    #[test]
    #[cfg(unix)]
    fn the_log_is_this_users_alone() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("kasten-crash-mode-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("crash.log");
        record(&path, "one\n").unwrap();
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_log_appends_and_starts_afresh_when_full() {
        let dir = std::env::temp_dir().join(format!("kasten-crash-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("crash.log");
        record(&path, "first\n").unwrap();
        record(&path, "second\n").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "first\nsecond\n");
        fs::write(&path, vec![b'x'; (MAX_BYTES + 1) as usize]).unwrap();
        record(&path, "third\n").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "third\n");
        assert!(dir.join("crash.old.log").exists());
        fs::remove_dir_all(&dir).unwrap();
    }
}
