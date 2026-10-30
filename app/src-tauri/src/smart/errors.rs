//! What went wrong inside a smart page, kept for the person and for the agent
//! that writes the page: the last 50 errors the kit caught, per page, in
//! `.kasten/cache/smart/<page id>.log.json`. It is a cache (the vault's
//! history never holds it), written whole, and a file that does not read
//! counts as an empty log. A page that reports in a loop is not let rewrite
//! the file more than about once a second: the first report is written at
//! once, the ones that follow are held in memory and written together a second
//! after the last write (and read from memory meanwhile).

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex, MutexGuard};
use std::time::{Duration, Instant as Clock};

use kasten_core::Instant;
use kasten_core::smart::{ErrorLog, ErrorRecord, ErrorReport, MAX_ERROR_RECORDS};

use super::page::plausible_id;

/// The longest message and source kept; a page cannot fill the log with text.
const MAX_MESSAGE: usize = 2_000;
const MAX_SOURCE: usize = 300;

/// The file of a page is written at most once in this long.
const QUIET: Duration = Duration::from_secs(1);

/// Reports not on disk yet, and when each file was last written; one at a time.
#[derive(Default)]
struct Held {
    pending: HashMap<PathBuf, ErrorLog>,
    written: HashMap<PathBuf, Clock>,
}

static HELD: LazyLock<Mutex<Held>> = LazyLock::new(Mutex::default);

fn held() -> MutexGuard<'static, Held> {
    HELD.lock().unwrap_or_else(|e| e.into_inner())
}

/// Where the log of the page with this id is kept.
pub fn log_path(root: &Path, id: &str) -> Option<PathBuf> {
    plausible_id(id).then(|| {
        root.join(".kasten")
            .join("cache")
            .join("smart")
            .join(format!("{id}.log.json"))
    })
}

fn cut(text: &str, max: usize) -> String {
    match text.char_indices().nth(max) {
        Some((at, _)) => format!("{}…", &text[..at]),
        None => text.to_owned(),
    }
}

/// `text` without secrets, cut to `max` characters. Only its start is looked
/// at, so a page cannot make this slow with a huge message.
fn clean(text: &str, max: usize) -> String {
    let head: String = text.chars().take(max + 100).collect();
    cut(&without_secrets(&head), max)
}

/// The text with every long run of hex digits taken out: a frame's secret is
/// in the addresses an error names (`smart://localhost/<secret>/<id>/app.js`),
/// and it belongs to the frame, not to a log that is kept and read later.
fn without_secrets(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut run = String::new();
    let flush = |run: &mut String, out: &mut String| {
        out.push_str(if run.len() >= 32 { "…" } else { run.as_str() });
        run.clear();
    };
    for c in text.chars() {
        if c.is_ascii_hexdigit() {
            run.push(c);
        } else {
            flush(&mut run, &mut out);
            out.push(c);
        }
    }
    flush(&mut run, &mut out);
    out
}

/// The log in the file, newest last; empty when there is none or it does not read.
fn read_file(path: &Path) -> ErrorLog {
    let mut log: ErrorLog = fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    // A file edited by hand cannot make the log longer than it is kept.
    let extra = log.records.len().saturating_sub(MAX_ERROR_RECORDS);
    log.records.drain(..extra);
    log
}

/// The page's log, newest last (with the reports not written yet); empty when
/// there is none or it does not read.
pub fn read(root: &Path, id: &str) -> ErrorLog {
    let Some(path) = log_path(root, id) else {
        return ErrorLog::default();
    };
    if let Some(log) = held().pending.get(&path) {
        return log.clone();
    }
    read_file(&path)
}

fn write(path: &Path, log: &ErrorLog) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(log).map_err(|e| e.to_string())?;
    let temp = path.with_extension("tmp");
    // Flushed before the rename, so a power cut leaves the old file or the new one.
    let mut out = fs::File::create(&temp).map_err(|e| e.to_string())?;
    out.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    out.sync_all().map_err(|e| e.to_string())?;
    drop(out);
    fs::rename(&temp, path).map_err(|e| e.to_string())
}

/// Writes what is held for `path` now, if anything is.
fn flush_path(path: &Path) {
    let mut state = held();
    if let Some(log) = state.pending.remove(path) {
        // The folder is gone with its vault: nothing to write into.
        if path.parent().is_some_and(Path::is_dir) {
            let _ = write(path, &log);
        }
        state.written.insert(path.to_owned(), Clock::now());
    }
}

/// Writes the reports held for the page with this id now (tests call it
/// instead of waiting a second).
#[cfg(test)]
pub fn flush(root: &Path, id: &str) {
    if let Some(path) = log_path(root, id) {
        flush_path(&path);
    }
}

/// Keeps one more error of the page with this id; only the last 50 stay.
/// Returns the log as it is now.
pub fn append(
    root: &Path,
    id: &str,
    report: &ErrorReport,
    now: Instant,
) -> Result<ErrorLog, String> {
    let path = log_path(root, id).ok_or("That page could not be found.")?;
    let mut state = held();
    let mut log = match state.pending.get(&path) {
        Some(held) => held.clone(),
        None => read_file(&path),
    };
    log.records.push(ErrorRecord {
        time: now.rfc3339(),
        kind: report.kind,
        message: clean(&report.message, MAX_MESSAGE),
        source: report.source.as_deref().map(|s| clean(s, MAX_SOURCE)),
        line: report.line,
    });
    let extra = log.records.len().saturating_sub(MAX_ERROR_RECORDS);
    log.records.drain(..extra);
    state.written.retain(|_, at| at.elapsed() < QUIET);
    match state.written.get(&path).map(Clock::elapsed) {
        Some(since) => {
            // Written a moment ago: held, and written a second after that write.
            let first = state.pending.insert(path.clone(), log.clone()).is_none();
            if first {
                let wait = QUIET.saturating_sub(since);
                std::thread::spawn(move || {
                    std::thread::sleep(wait);
                    flush_path(&path);
                });
            }
        }
        None => {
            write(&path, &log)?;
            state.pending.remove(&path);
            state.written.insert(path, Clock::now());
        }
    }
    Ok(log)
}

/// Forgets the page's errors.
pub fn clear(root: &Path, id: &str) -> Result<(), String> {
    let Some(path) = log_path(root, id) else {
        return Ok(());
    };
    let mut state = held();
    state.pending.remove(&path);
    // The log is a cache of the page's own: emptied, not removed.
    write(&path, &ErrorLog::default())?;
    state.written.insert(path, Clock::now());
    Ok(())
}
