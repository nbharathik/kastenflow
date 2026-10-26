//! "Use my GitHub CLI sign-in": when the GitHub command line (`gh`) is
//! installed and signed in, its token can back up a vault too. The token is
//! asked for once, when the person chooses this, and kept like any other.
//! `gh` is run without a window, without input, and for a few seconds at most;
//! its output is never put in a message.

use std::ffi::OsStr;
use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use super::token::plausible;
use crate::backup::contract::BackupError;

const WAIT: Duration = Duration::from_secs(15);
const HOST: &str = "github.com";

const MISSING: &str = "The GitHub command line is not installed or not signed in. Sign in with GitHub instead, or run gh auth login in a terminal";

/// Runs `program` with `args`; None when it did not start or ran out of
/// time. `capture` keeps what it printed.
fn run(program: &OsStr, args: &[&str], capture: bool) -> Option<(bool, String)> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .stdout(if capture {
            Stdio::piped()
        } else {
            Stdio::null()
        });
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // No console window flashing up.
        command.creation_flags(0x0800_0000);
    }
    let mut child = command.spawn().ok()?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut out = String::new();
                if let Some(mut pipe) = child.stdout.take() {
                    let _ = pipe.by_ref().take(4096).read_to_string(&mut out);
                }
                return Some((status.success(), out));
            }
            Ok(None) if started.elapsed() < WAIT => std::thread::sleep(Duration::from_millis(25)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

/// Whether `program` is installed and signed in to GitHub.
pub fn available_with(program: &OsStr) -> bool {
    run(program, &["auth", "status", "--hostname", HOST], false).is_some_and(|(ok, _)| ok)
}

/// The token `program` holds for GitHub.
pub fn token_with(program: &OsStr) -> Result<String, BackupError> {
    let missing = || BackupError::NoGhCli {
        message: MISSING.to_owned(),
    };
    let (ok, out) =
        run(program, &["auth", "token", "--hostname", HOST], true).ok_or_else(missing)?;
    let token = out.lines().next().unwrap_or("").trim();
    if ok && plausible(token) {
        Ok(token.to_owned())
    } else {
        Err(missing())
    }
}

pub fn available() -> bool {
    available_with(OsStr::new("gh"))
}

pub fn token() -> Result<String, BackupError> {
    token_with(OsStr::new("gh"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};

    /// A stand-in for `gh`: a script that answers like it, or not.
    fn fake(name: &str, signed_in: bool) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kasten-app-gh-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let program = dir.join(if cfg!(windows) {
            format!("{name}.cmd")
        } else {
            name.to_owned()
        });
        let script = match (cfg!(windows), signed_in) {
            (true, true) => "@echo off\r\nif \"%2\"==\"token\" echo gho_faketoken\r\nexit /b 0\r\n",
            (true, false) => "@echo off\r\nexit /b 1\r\n",
            (false, true) => {
                "#!/bin/sh\nif [ \"$2\" = token ]; then echo gho_faketoken; fi\nexit 0\n"
            }
            (false, false) => "#!/bin/sh\nexit 1\n",
        };
        fs::write(&program, script).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&program, fs::Permissions::from_mode(0o755)).unwrap();
        }
        program
    }

    #[test]
    fn a_signed_in_gh_gives_its_token() {
        let gh = fake("gh-in", true);
        assert!(available_with(gh.as_os_str()));
        assert_eq!(token_with(gh.as_os_str()).unwrap(), "gho_faketoken");
    }

    #[test]
    fn a_gh_that_is_not_signed_in_gives_no_token() {
        let gh = fake("gh-out", false);
        assert!(!available_with(gh.as_os_str()));
        let err = token_with(gh.as_os_str()).unwrap_err();
        assert!(matches!(err, BackupError::NoGhCli { .. }), "{err:?}");
    }

    #[test]
    fn no_gh_at_all_is_not_available() {
        let nowhere = Path::new("kasten-no-such-program-anywhere");
        assert!(!available_with(nowhere.as_os_str()));
        assert!(matches!(
            token_with(nowhere.as_os_str()),
            Err(BackupError::NoGhCli { .. })
        ));
    }
}
