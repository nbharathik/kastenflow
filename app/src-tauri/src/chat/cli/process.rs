//! The agent as a child process: started by absolute path with the clean
//! environment of `env`, in the folder it works in, without a window. Its
//! output is read by two threads into a small queue, a line at a time (a line
//! is cut at 8 MiB), so a program that prints without end fills no memory and
//! cannot hold up Stop. Ending it ends everything it started: on Windows with
//! `taskkill /T /F`, elsewhere the process group (the same helpers as the
//! LaTeX engines, which `plugins::latex::proc` holds).

use std::ffi::OsString;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, SyncSender};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use crate::plugins::latex::proc::{kill_pids, kill_tree};

/// The longest line kept; the rest of a longer one is dropped.
const MAX_LINE: usize = 8 * 1024 * 1024;
/// Lines waiting between the readers and the turn.
const QUEUE: usize = 256;
/// How long the last output is waited for once the program has ended.
const DRAIN: Duration = Duration::from_millis(1500);

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Everything needed to start a program.
#[derive(Debug, Clone)]
pub struct Spec {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    /// The whole environment: nothing else is inherited.
    pub env: Vec<(OsString, OsString)>,
}

/// What a wait for the program brought.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Recv {
    /// A line of standard output.
    Out(String),
    /// A line of standard error.
    Err(String),
    /// It ended (the exit code; none when a signal ended it) and printed all it will.
    Ended(Option<i32>),
    /// Nothing came in the time given.
    Quiet,
}

/// The two ends of a conversation with a program: real in the app, a script in tests.
pub trait Transport {
    /// Writes one line to its input.
    fn send_line(&mut self, line: &str) -> Result<(), String>;
    /// Closes its input: it has been told everything.
    fn close_input(&mut self);
    /// Waits up to `wait` for the next thing.
    fn recv(&mut self, wait: Duration) -> Recv;
    /// Ends it, and everything it started.
    fn kill(&mut self);
}

enum Msg {
    Out(String),
    Err(String),
    Closed,
}

/// Processes running now, so that quitting the app can end them.
static LIVE: Mutex<Vec<u32>> = Mutex::new(Vec::new());

fn live() -> MutexGuard<'static, Vec<u32>> {
    LIVE.lock().unwrap_or_else(|e| e.into_inner())
}

/// Ends every agent still running, with what it started. For the app's exit.
pub fn kill_all() {
    let pids: Vec<u32> = std::mem::take(&mut *live());
    kill_pids(&pids);
}

/// Reads up to the next newline into `line`, keeping at most `cap` bytes of
/// it. How many bytes were consumed; 0 at the end.
fn read_capped(
    reader: &mut impl BufRead,
    line: &mut Vec<u8>,
    cap: usize,
) -> std::io::Result<usize> {
    let mut total = 0;
    loop {
        let (used, done) = {
            let chunk = reader.fill_buf()?;
            if chunk.is_empty() {
                return Ok(total);
            }
            match chunk.iter().position(|b| *b == b'\n') {
                Some(at) => {
                    let room = cap.saturating_sub(line.len());
                    line.extend_from_slice(&chunk[..at.min(room)]);
                    (at + 1, true)
                }
                None => {
                    let room = cap.saturating_sub(line.len());
                    line.extend_from_slice(&chunk[..chunk.len().min(room)]);
                    (chunk.len(), false)
                }
            }
        };
        reader.consume(used);
        total += used;
        if done {
            return Ok(total);
        }
    }
}

fn pump(source: impl Read, tx: SyncSender<Msg>, stderr: bool) {
    let mut reader = BufReader::new(source);
    let mut line = Vec::new();
    loop {
        line.clear();
        match read_capped(&mut reader, &mut line, MAX_LINE) {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                let text = String::from_utf8_lossy(&line)
                    .trim_end_matches('\r')
                    .to_owned();
                let msg = if stderr {
                    Msg::Err(text)
                } else {
                    Msg::Out(text)
                };
                if tx.send(msg).is_err() {
                    return;
                }
            }
        }
    }
    let _ = tx.send(Msg::Closed);
}

/// A running program.
pub struct Process {
    child: Child,
    stdin: Option<ChildStdin>,
    rx: Receiver<Msg>,
    open: usize,
    status: Option<Option<i32>>,
    exited_at: Option<Instant>,
    listed: bool,
}

impl Process {
    pub fn start(spec: &Spec) -> Result<Process, String> {
        let mut command = Command::new(&spec.program);
        command
            .args(&spec.args)
            .current_dir(&spec.cwd)
            .env_clear()
            .envs(spec.env.iter().map(|(k, v)| (k, v)))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            // Its own group, so ending the group ends what it started and nothing else.
            command.process_group(0);
        }
        let mut child = command.spawn().map_err(|e| e.to_string())?;
        live().push(child.id());
        let (tx, rx) = mpsc::sync_channel(QUEUE);
        let mut open = 0;
        if let Some(pipe) = child.stdout.take() {
            let tx = tx.clone();
            std::thread::spawn(move || pump(pipe, tx, false));
            open += 1;
        }
        if let Some(pipe) = child.stderr.take() {
            let tx = tx.clone();
            std::thread::spawn(move || pump(pipe, tx, true));
            open += 1;
        }
        let stdin = child.stdin.take();
        Ok(Process {
            child,
            stdin,
            rx,
            open,
            status: None,
            exited_at: None,
            listed: true,
        })
    }

    fn unlist(&mut self) {
        if std::mem::take(&mut self.listed) {
            let pid = self.child.id();
            live().retain(|p| *p != pid);
        }
    }

    fn exited(&mut self) -> Option<Option<i32>> {
        if self.status.is_none()
            && let Ok(Some(status)) = self.child.try_wait()
        {
            self.status = Some(status.code());
            self.exited_at = Some(Instant::now());
            self.unlist();
        }
        self.status
    }
}

impl Transport for Process {
    fn send_line(&mut self, line: &str) -> Result<(), String> {
        let Some(stdin) = self.stdin.as_mut() else {
            return Err("The agent is not listening any more".to_owned());
        };
        stdin
            .write_all(line.as_bytes())
            .and_then(|()| stdin.write_all(b"\n"))
            .and_then(|()| stdin.flush())
            .map_err(|e| format!("The agent could not be written to: {e}"))
    }

    fn close_input(&mut self) {
        self.stdin = None;
    }

    fn recv(&mut self, wait: Duration) -> Recv {
        match self.rx.recv_timeout(wait) {
            Ok(Msg::Out(line)) => return Recv::Out(line),
            Ok(Msg::Err(line)) => return Recv::Err(line),
            Ok(Msg::Closed) => self.open = self.open.saturating_sub(1),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => self.open = 0,
        }
        match self.exited() {
            Some(code)
                if self.open == 0 || self.exited_at.is_some_and(|t| t.elapsed() >= DRAIN) =>
            {
                Recv::Ended(code)
            }
            _ => Recv::Quiet,
        }
    }

    fn kill(&mut self) {
        self.stdin = None;
        kill_tree(&mut self.child);
        self.unlist();
    }
}

impl Drop for Process {
    fn drop(&mut self) {
        // Dropped while it still runs (the code watching it panicked): ended, and always collected.
        if self.status.is_none() {
            kill_tree(&mut self.child);
        }
        self.unlist();
        let _ = self.child.wait();
    }
}
