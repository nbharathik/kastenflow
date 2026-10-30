//! Running a program: output read a line at a time and kept short, a time
//! limit, cancel, and ending a program together with the helpers it started.
//! The program is this test program itself (see `support`).

use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use super::support::{Dir, wrap};
use crate::plugins::latex::engines::CommandSpec;
use crate::plugins::latex::proc::{End, MAX_TAIL, group_kill_args, kill_pids, run, taskkill_args};

fn spec(dir: &Dir, mode: &'static str, beat: Option<&Path>) -> CommandSpec {
    let plain = CommandSpec {
        program: "unused".into(),
        args: Vec::new(),
        env: Vec::new(),
        cwd: dir.path().to_path_buf(),
    };
    wrap(mode, dir.join("out"), "main", beat.map(Path::to_path_buf))(plain)
}

fn quiet() -> impl FnMut(&str) {
    |_| {}
}

#[test]
fn a_program_that_ends_by_itself_gives_its_code_and_what_it_printed() {
    let dir = Dir::new("proc-ok");
    let mut lines = Vec::new();
    let ran = run(
        &spec(&dir, "ok", None),
        Duration::from_secs(60),
        &AtomicBool::new(false),
        &mut |line| lines.push(line.to_owned()),
    )
    .unwrap();
    assert_eq!(ran.end, End::Exited(Some(0)));
    assert!(
        lines.iter().any(|l| l.contains("downloading a package")),
        "{lines:?}"
    );
    assert!(ran.output.contains("downloading a package"));
    assert!(dir.join("out/main.pdf").is_file());
}

#[test]
fn a_failing_program_gives_its_exit_code() {
    let dir = Dir::new("proc-fail");
    let ran = run(
        &spec(&dir, "fail", None),
        Duration::from_secs(60),
        &AtomicBool::new(false),
        &mut quiet(),
    )
    .unwrap();
    assert_eq!(ran.end, End::Exited(Some(1)));
}

#[test]
fn a_program_that_cannot_be_started_is_an_error_not_a_panic() {
    let dir = Dir::new("proc-missing");
    let missing = CommandSpec {
        program: dir.join("no-such-program"),
        args: Vec::new(),
        env: Vec::new(),
        cwd: dir.path().to_path_buf(),
    };
    let result = run(
        &missing,
        Duration::from_secs(5),
        &AtomicBool::new(false),
        &mut quiet(),
    );
    assert!(result.is_err());
    let bad_folder = CommandSpec {
        cwd: dir.join("no-such-folder"),
        ..spec(&dir, "ok", None)
    };
    assert!(
        run(
            &bad_folder,
            Duration::from_secs(5),
            &AtomicBool::new(false),
            &mut quiet()
        )
        .is_err()
    );
}

#[test]
fn the_time_limit_ends_a_program_that_hangs() {
    let dir = Dir::new("proc-timeout");
    let started = Instant::now();
    let ran = run(
        &spec(&dir, "hang", None),
        Duration::from_millis(400),
        &AtomicBool::new(false),
        &mut quiet(),
    )
    .unwrap();
    assert_eq!(ran.end, End::TimedOut);
    assert!(
        started.elapsed() < Duration::from_secs(30),
        "{:?}",
        started.elapsed()
    );
}

#[test]
fn cancel_ends_a_program_that_hangs() {
    let dir = Dir::new("proc-cancel");
    let cancel = AtomicBool::new(false);
    let ran = std::thread::scope(|scope| {
        scope.spawn(|| {
            std::thread::sleep(Duration::from_millis(400));
            cancel.store(true, Ordering::Relaxed);
        });
        run(
            &spec(&dir, "hang", None),
            Duration::from_secs(120),
            &cancel,
            &mut quiet(),
        )
        .unwrap()
    });
    assert_eq!(ran.end, End::Cancelled);
}

#[test]
fn a_cancel_asked_before_the_start_stops_it_at_once() {
    let dir = Dir::new("proc-cancel-first");
    let ran = run(
        &spec(&dir, "hang", None),
        Duration::from_secs(120),
        &AtomicBool::new(true),
        &mut quiet(),
    )
    .unwrap();
    assert_eq!(ran.end, End::Cancelled);
}

/// How many beats the helper has written so far.
fn beats(file: &Path) -> usize {
    fs::metadata(file).map_or(0, |m| m.len() as usize)
}

fn wait_for_beats(file: &Path) {
    let until = Instant::now() + Duration::from_secs(20);
    while beats(file) < 3 {
        assert!(Instant::now() < until, "the helper never started");
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn ending_a_program_ends_the_helpers_it_started_too() {
    let dir = Dir::new("proc-tree");
    let beat = dir.join("beat.txt");
    let cancel = AtomicBool::new(false);
    let ran = std::thread::scope(|scope| {
        scope.spawn(|| {
            wait_for_beats(&beat);
            cancel.store(true, Ordering::Relaxed);
        });
        run(
            &spec(&dir, "tree", Some(&beat)),
            Duration::from_secs(120),
            &cancel,
            &mut quiet(),
        )
        .unwrap()
    });
    assert_eq!(ran.end, End::Cancelled);
    // The helper was running (it wrote beats) and is gone: it writes no more.
    let at_the_end = beats(&beat);
    assert!(at_the_end >= 3);
    std::thread::sleep(Duration::from_millis(500));
    assert_eq!(beats(&beat), at_the_end, "the helper is still writing");
}

#[test]
fn the_time_limit_ends_the_helpers_too() {
    let dir = Dir::new("proc-tree-timeout");
    let beat = dir.join("beat.txt");
    let ran = run(
        &spec(&dir, "tree", Some(&beat)),
        Duration::from_secs(5),
        &AtomicBool::new(false),
        &mut quiet(),
    )
    .unwrap();
    assert_eq!(ran.end, End::TimedOut);
    let at_the_end = beats(&beat);
    assert!(at_the_end >= 3, "the helper wrote {at_the_end} beats");
    std::thread::sleep(Duration::from_millis(500));
    assert_eq!(beats(&beat), at_the_end, "the helper is still writing");
}

#[test]
fn code_that_panics_while_watching_still_ends_the_engine() {
    let dir = Dir::new("proc-panic");
    let beat = dir.join("beat.txt");
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = run(
            &spec(&dir, "chatty", Some(&beat)),
            Duration::from_secs(120),
            &AtomicBool::new(false),
            &mut |_| {
                if beats(&beat) >= 3 {
                    panic!("the watcher breaks");
                }
            },
        );
    }));
    assert!(result.is_err());
    let at_the_end = beats(&beat);
    assert!(at_the_end >= 3);
    std::thread::sleep(Duration::from_millis(500));
    assert_eq!(beats(&beat), at_the_end, "the engine is still running");
}

#[test]
fn quitting_the_app_can_end_an_engine_and_its_helpers() {
    let dir = Dir::new("proc-quit");
    let beat = dir.join("beat.txt");
    let plain = spec(&dir, "tree", Some(&beat));
    let mut command = std::process::Command::new(&plain.program);
    command
        .args(&plain.args)
        .envs(plain.env.iter().map(|(k, v)| (k, v)))
        .current_dir(&plain.cwd)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command.spawn().unwrap();
    wait_for_beats(&beat);
    kill_pids(&[child.id()]);
    let status = child.wait().unwrap();
    assert!(!status.success());
    let at_the_end = beats(&beat);
    std::thread::sleep(Duration::from_millis(500));
    assert_eq!(beats(&beat), at_the_end, "the helper is still writing");
}

#[test]
fn a_lot_of_output_is_read_but_only_the_end_is_kept() {
    let dir = Dir::new("proc-noisy");
    let mut count = 0usize;
    let ran = run(
        &spec(&dir, "noisy", None),
        Duration::from_secs(120),
        &AtomicBool::new(false),
        &mut |_| count += 1,
    )
    .unwrap();
    assert_eq!(ran.end, End::Exited(Some(0)));
    assert!(count >= 20_000, "{count} lines");
    assert!(
        ran.output.len() <= MAX_TAIL + 1_000,
        "{} bytes",
        ran.output.len()
    );
    assert!(ran.output.len() > MAX_TAIL / 2);
}

#[test]
fn variables_that_look_like_secrets_are_not_handed_to_the_engine() {
    use crate::plugins::latex::proc::sensitive;
    for name in [
        "GITHUB_TOKEN",
        "github_token",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_ACCESS_KEY_ID",
        "DB_PASSWORD",
        "MY_PASSWD",
        "GOOGLE_APPLICATION_CREDENTIALS",
        "SSH_PRIVATE_KEY",
        "KASTEN_VAULT",
        "KASTEN_GITHUB_CLIENT_ID",
        "kasten_anything",
    ] {
        assert!(sensitive(name), "{name}");
    }
    for name in [
        "PATH",
        "HOME",
        "USERPROFILE",
        "SystemRoot",
        "TEMP",
        "TEXMFHOME",
        "TEXINPUTS",
        "MIKTEX_USERCONFIG",
        "LANG",
        "APPDATA",
        "LOCALAPPDATA",
    ] {
        assert!(!sensitive(name), "{name}");
    }
}

#[test]
fn the_kill_commands_name_the_whole_tree() {
    assert_eq!(taskkill_args(4242), ["/T", "/F", "/PID", "4242"]);
    assert_eq!(group_kill_args(4242), ["-s", "KILL", "--", "-4242"]);
}
