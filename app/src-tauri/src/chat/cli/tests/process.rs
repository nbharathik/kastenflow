//! A real program (the system shell, never a coding agent): its lines, the
//! environment it is given, and Stop ending everything it started.

use std::ffi::OsString;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use crate::chat::cli::env::scrubbed;
use crate::chat::cli::process::{Process, Recv, Spec, Transport};

fn shell(script: &str, env: Vec<(OsString, OsString)>) -> Spec {
    #[cfg(windows)]
    let (program, args) = {
        let root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
        (
            PathBuf::from(root).join("System32").join("cmd.exe"),
            vec!["/c".to_owned(), script.to_owned()],
        )
    };
    #[cfg(not(windows))]
    let (program, args) = (
        PathBuf::from("/bin/sh"),
        vec!["-c".to_owned(), script.to_owned()],
    );
    Spec {
        program,
        args,
        cwd: std::env::temp_dir(),
        env,
    }
}

/// Everything the program prints until it ends: (stdout, stderr, exit code).
fn collect(process: &mut Process) -> (Vec<String>, Vec<String>, Option<i32>) {
    let (mut out, mut err) = (Vec::new(), Vec::new());
    let began = Instant::now();
    loop {
        match process.recv(Duration::from_millis(20)) {
            Recv::Out(l) => out.push(l),
            Recv::Err(l) => err.push(l),
            Recv::Ended(code) => return (out, err, code),
            Recv::Quiet => assert!(began.elapsed() < Duration::from_secs(20), "it never ended"),
        }
    }
}

#[test]
fn lines_of_both_outputs_come_one_at_a_time_and_the_exit_code_ends_it() {
    #[cfg(windows)]
    let script = "echo hello&& echo oops 1>&2&& exit 3";
    #[cfg(not(windows))]
    let script = "echo hello; echo oops 1>&2; exit 3";
    let mut process = Process::start(&shell(script, scrubbed(std::env::vars_os(), &[]))).unwrap();
    process.close_input();
    let (out, err, code) = collect(&mut process);
    assert_eq!(out.iter().map(|l| l.trim()).collect::<Vec<_>>(), ["hello"]);
    assert_eq!(err.iter().map(|l| l.trim()).collect::<Vec<_>>(), ["oops"]);
    assert_eq!(code, Some(3));
}

#[test]
fn nothing_but_the_given_environment_reaches_the_program() {
    #[cfg(windows)]
    let (script, env) = (
        "set",
        vec![
            (
                OsString::from("SystemRoot"),
                std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()),
            ),
            (OsString::from("ONLY_THIS"), OsString::from("1")),
        ],
    );
    #[cfg(not(windows))]
    let (script, env) = (
        "env",
        vec![(OsString::from("ONLY_THIS"), OsString::from("1"))],
    );
    let mut process = Process::start(&shell(script, env)).unwrap();
    process.close_input();
    let (out, _, _) = collect(&mut process);
    let text = out.join("\n").to_uppercase();
    assert!(text.contains("ONLY_THIS=1"), "{text}");
    for inherited in ["USERPROFILE=", "HOME=", "CARGO_", "APPDATA="] {
        assert!(!text.contains(inherited), "{inherited} leaked: {text}");
    }
}

#[test]
fn input_written_to_the_program_arrives_line_by_line() {
    #[cfg(windows)]
    let script = "findstr /R .";
    #[cfg(not(windows))]
    let script = "cat";
    let mut process = Process::start(&shell(script, scrubbed(std::env::vars_os(), &[]))).unwrap();
    process.send_line("one").unwrap();
    process.send_line("two").unwrap();
    process.close_input();
    let (out, _, code) = collect(&mut process);
    assert_eq!(
        out.iter()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty())
            .collect::<Vec<_>>(),
        ["one", "two"]
    );
    assert_eq!(code, Some(0));
}

#[test]
fn stop_ends_the_program_and_what_it_started() {
    // The shell starts a long-running helper that holds the output open: when
    // the helper dies with its parent, the output closes at once; if it were
    // left behind, the end would wait for the drain.
    #[cfg(windows)]
    let script = "echo started&& ping -n 60 127.0.0.1";
    #[cfg(not(windows))]
    let script = "echo started; sleep 60 & wait";
    let mut process = Process::start(&shell(script, scrubbed(std::env::vars_os(), &[]))).unwrap();
    process.close_input();
    let began = Instant::now();
    loop {
        match process.recv(Duration::from_millis(20)) {
            Recv::Out(l) if l.trim() == "started" => break,
            Recv::Quiet | Recv::Out(_) | Recv::Err(_) => {}
            Recv::Ended(code) => panic!("it ended by itself: {code:?}"),
        }
        assert!(
            began.elapsed() < Duration::from_secs(20),
            "it never started"
        );
    }
    // Give the helper a moment to start, then stop.
    std::thread::sleep(Duration::from_millis(400));
    let stopped = Instant::now();
    process.kill();
    loop {
        if let Recv::Ended(_) = process.recv(Duration::from_millis(20)) {
            break;
        }
        assert!(
            stopped.elapsed() < Duration::from_secs(10),
            "it never ended after Stop"
        );
    }
    // A helper left behind would hold the output open for the full minute it
    // sleeps, so a few seconds of headroom for a loaded machine still tells
    // the two apart.
    assert!(
        stopped.elapsed() < Duration::from_secs(5),
        "the helper was left running: the end came after {:?}",
        stopped.elapsed()
    );
}

#[test]
fn a_program_that_is_not_there_is_an_error_not_a_panic() {
    let spec = Spec {
        program: std::env::temp_dir().join("no-such-agent-program.exe"),
        args: Vec::new(),
        cwd: std::env::temp_dir(),
        env: Vec::new(),
    };
    assert!(Process::start(&spec).is_err());
}
