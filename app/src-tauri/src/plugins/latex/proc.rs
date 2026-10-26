//! Running an engine: started without a window and without input, its
//! output read as it comes (a line at a time, each line and the whole kept
//! short), stopped at a time limit or when the build is cancelled, and when it
//! is stopped its helper programs go with it (latexmk starts TeX, BibTeX and
//! more): on Windows with `taskkill /T /F`, elsewhere by ending the process
//! group the engine was started in.

use std::collections::VecDeque;
use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, SyncSender};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use super::engines::CommandSpec;

/// The most output kept (the end of it, which is where the reason is).
pub const MAX_TAIL: usize = 256 * 1024;
/// How many lines wait between the readers and the loop that watches the process.
const CHANNEL: usize = 4096;
/// The longest line kept; the rest of a longer one is dropped.
const MAX_LINE: usize = 4096;
/// How often the process, the time limit and the cancel flag are looked at.
const POLL: Duration = Duration::from_millis(20);
/// How long to wait for the last output once the process has ended.
const DRAIN: Duration = Duration::from_millis(1500);
/// How long a helper (`taskkill`, `kill`) may take.
const HELPER: Duration = Duration::from_secs(5);

/// How a run ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum End {
    /// It ended by itself, with this exit code (none: ended by a signal).
    Exited(Option<i32>),
    TimedOut,
    Cancelled,
}

#[derive(Debug)]
pub struct Ran {
    pub end: End,
    /// The end of what it printed, line by line.
    pub output: String,
    pub ms: u64,
}

enum Msg {
    Line(String),
    Eof,
}

/// Reads `source` to its end, sending short lines (a `\r` also ends a line,
/// for progress bars).
fn pump(mut source: impl Read, tx: SyncSender<Msg>) {
    let mut chunk = [0u8; 8192];
    let mut line: Vec<u8> = Vec::new();
    let send = |line: &mut Vec<u8>| {
        if !line.is_empty() {
            let _ = tx.send(Msg::Line(String::from_utf8_lossy(line).into_owned()));
            line.clear();
        }
    };
    loop {
        match source.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                for &byte in &chunk[..n] {
                    if byte == b'\n' || byte == b'\r' {
                        send(&mut line);
                    } else if line.len() < MAX_LINE {
                        line.push(byte);
                    }
                }
            }
        }
    }
    send(&mut line);
    let _ = tx.send(Msg::Eof);
}

/// The end of the output, within `MAX_TAIL` bytes.
#[derive(Default)]
struct Tail {
    lines: VecDeque<String>,
    bytes: usize,
}

impl Tail {
    fn push(&mut self, line: &str) {
        self.bytes += line.len() + 1;
        self.lines.push_back(line.to_owned());
        while self.bytes > MAX_TAIL {
            match self.lines.pop_front() {
                Some(old) => self.bytes -= old.len() + 1,
                None => break,
            }
        }
    }

    fn text(self) -> String {
        Vec::from(self.lines).join("\n")
    }
}

/// Runs a helper to its end for at most `HELPER`.
fn run_quiet(mut command: Command) {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let Ok(mut helper) = command.spawn() else {
        return;
    };
    let started = Instant::now();
    loop {
        match helper.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) if started.elapsed() < HELPER => std::thread::sleep(POLL),
            _ => {
                let _ = helper.kill();
                let _ = helper.wait();
                return;
            }
        }
    }
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// The arguments that end a process and everything it started (Windows).
#[cfg(any(windows, test))]
pub fn taskkill_args(pid: u32) -> Vec<String> {
    vec![
        "/T".to_owned(),
        "/F".to_owned(),
        "/PID".to_owned(),
        pid.to_string(),
    ]
}

/// The arguments that end a whole process group (elsewhere); the group's
/// number is the engine's own process number.
#[cfg(any(unix, test))]
pub fn group_kill_args(pid: u32) -> Vec<String> {
    vec![
        "-s".to_owned(),
        "KILL".to_owned(),
        "--".to_owned(),
        format!("-{pid}"),
    ]
}

/// The engines running now, by process number, so that quitting the app can
/// end them (`kill_all`). A number is in the list only while its process has
/// not been collected, so it cannot be another program's.
static LIVE: Mutex<Vec<u32>> = Mutex::new(Vec::new());

fn live() -> MutexGuard<'static, Vec<u32>> {
    LIVE.lock().unwrap_or_else(|e| e.into_inner())
}

/// Ends every engine that is running, with its helpers. For the app's exit:
/// a build thread would otherwise not get to it before the process is gone,
/// and the engine would run on without the app.
pub fn kill_all() {
    let pids: Vec<u32> = std::mem::take(&mut *live());
    kill_pids(&pids);
}

/// Ends each of the processes `pids` (engines started by `run`) and their helpers.
pub fn kill_pids(pids: &[u32]) {
    for pid in pids {
        kill_pid(*pid);
    }
}

/// A started engine. Dropped while it still runs (the code watching it
/// panicked), it is ended with its helpers; it is always collected.
struct Started {
    child: Child,
    listed: bool,
}

impl Started {
    fn new(child: Child) -> Self {
        live().push(child.id());
        Self {
            child,
            listed: true,
        }
    }

    /// Takes the engine off the list of running ones (it has ended or is being ended).
    fn unlist(&mut self) {
        if std::mem::take(&mut self.listed) {
            let pid = self.child.id();
            live().retain(|p| *p != pid);
        }
    }
}

impl Drop for Started {
    fn drop(&mut self) {
        if self.listed {
            kill_tree(&mut self.child);
            self.unlist();
        }
        let _ = self.child.wait();
    }
}

/// Ends `child` and the programs it started.
pub fn kill_tree(child: &mut Child) {
    kill_pid(child.id());
    let _ = child.kill();
}

/// Ends the process `pid` (the engine's own number, from its `Child`) and
/// the programs it started.
fn kill_pid(pid: u32) {
    #[cfg(windows)]
    {
        // By full path: the system's own, never one found in the current folder.
        let root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
        let program = std::path::Path::new(&root)
            .join("System32")
            .join("taskkill.exe");
        let mut command = Command::new(program);
        command.args(taskkill_args(pid));
        run_quiet(command);
    }
    #[cfg(unix)]
    {
        let program = ["/bin/kill", "/usr/bin/kill"]
            .into_iter()
            .find(|p| std::path::Path::new(p).is_file());
        if let Some(program) = program {
            let mut command = Command::new(program);
            command.args(group_kill_args(pid));
            run_quiet(command);
        }
    }
}

/// Whether an environment variable looks like it holds a secret (a key, a
/// token, a password) or belongs to KastenFlow itself. A document is not
/// trusted with these: the engine does not inherit them.
pub fn sensitive(name: &str) -> bool {
    let upper = name.to_ascii_uppercase();
    upper.starts_with("KASTEN")
        || [
            "TOKEN",
            "SECRET",
            "PASSWORD",
            "PASSWD",
            "API_KEY",
            "APIKEY",
            "ACCESS_KEY",
            "PRIVATE_KEY",
            "CREDENTIAL",
            "SESSION_KEY",
        ]
        .iter()
        .any(|word| upper.contains(word))
}

/// Runs `spec`; each line it prints goes to `on_line`. Stops it after
/// `timeout`, or when `cancel` is set. `Err` when it could not be started.
pub fn run(
    spec: &CommandSpec,
    timeout: Duration,
    cancel: &AtomicBool,
    on_line: &mut dyn FnMut(&str),
) -> Result<Ran, String> {
    let mut command = Command::new(&spec.program);
    command
        .args(&spec.args)
        .current_dir(&spec.cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (key, _) in std::env::vars_os() {
        if key.to_str().is_some_and(sensitive) {
            command.env_remove(key);
        }
    }
    // What the build sets itself is not taken away again.
    for (key, value) in &spec.env {
        command.env(key, value);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Its own group, so ending the group ends its helpers and nothing else.
        command.process_group(0);
    }
    let started = Instant::now();
    let mut child = Started::new(command.spawn().map_err(|err| err.to_string())?);
    // Bounded, so an engine that prints faster than it is read waits instead of filling memory.
    let (tx, rx) = mpsc::sync_channel(CHANNEL);
    let mut open = 0;
    if let Some(pipe) = child.child.stdout.take() {
        let tx = tx.clone();
        std::thread::spawn(move || pump(pipe, tx));
        open += 1;
    }
    if let Some(pipe) = child.child.stderr.take() {
        let tx = tx.clone();
        std::thread::spawn(move || pump(pipe, tx));
        open += 1;
    }
    drop(tx);

    let mut tail = Tail::default();
    let mut end: Option<End> = None;
    let mut drain_until: Option<Instant> = None;
    loop {
        match rx.recv_timeout(POLL) {
            Ok(Msg::Line(line)) => {
                tail.push(&line);
                on_line(&line);
            }
            Ok(Msg::Eof) => open -= 1,
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => {
                // Nothing more will be printed; the loop goes on only to watch the process.
                open = 0;
                std::thread::sleep(POLL);
            }
        }
        if end.is_none() {
            if cancel.load(Ordering::Relaxed) {
                kill_tree(&mut child.child);
                child.unlist();
                end = Some(End::Cancelled);
            } else if started.elapsed() >= timeout {
                kill_tree(&mut child.child);
                child.unlist();
                end = Some(End::TimedOut);
            } else if let Ok(Some(status)) = child.child.try_wait() {
                child.unlist();
                end = Some(End::Exited(status.code()));
            }
            if end.is_some() {
                drain_until = Some(Instant::now() + DRAIN);
            }
        }
        if end.is_some() && (open <= 0 || drain_until.is_some_and(|t| Instant::now() >= t)) {
            break;
        }
    }
    // Ended or ended by us: either way it is collected, so no zombie is left.
    let _ = child.child.wait();
    Ok(Ran {
        end: end.unwrap_or(End::Exited(None)),
        output: tail.text(),
        ms: started.elapsed().as_millis() as u64,
    })
}
