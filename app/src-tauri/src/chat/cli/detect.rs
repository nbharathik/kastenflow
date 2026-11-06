//! Settings › Agents: which of the CLIs are on this computer, their versions,
//! and whether they are signed in, asked of the CLI itself. Nothing is
//! installed or signed in from here: a missing CLI gets the commands to run.

use std::path::Path;
use std::time::{Duration, Instant};

use serde::Serialize;

use super::Agent;
use super::env::scrubbed;
use super::items::{Problem, classify};
use super::process::{Process, Recv, Spec, Transport};
use super::resolve::{Found, resolve};
use super::tools::clip;

/// How long `--version` may take.
const VERSION_WAIT: Duration = Duration::from_secs(8);
/// How long the sign-in question may take.
const STATUS_WAIT: Duration = Duration::from_secs(15);

/// An agent as Settings shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub id: &'static str,
    pub label: &'static str,
    /// The provider name a thread uses it by.
    pub provider: &'static str,
    pub found: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub install: &'static str,
    pub sign_in: &'static str,
}

/// How "Test" went.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCheck {
    pub ok: bool,
    pub version: Option<String>,
    /// Whether the CLI says it is signed in; none when it did not say.
    pub signed_in: Option<bool>,
    /// What to tell the person: that it works, or what is wrong and what to do.
    pub message: String,
}

/// The arguments that ask a CLI for its version.
fn version_args() -> Vec<String> {
    vec!["--version".to_owned()]
}

/// The arguments that ask a CLI whether it is signed in.
fn status_args(agent: Agent) -> Vec<String> {
    match agent {
        Agent::ClaudeCode => vec!["auth".to_owned(), "status".to_owned()],
        Agent::OpenCode => vec!["auth".to_owned(), "list".to_owned()],
    }
}

fn spec(found: &Found, args: Vec<String>, cwd: &Path) -> Spec {
    Spec {
        program: found.path.clone(),
        args,
        cwd: cwd.to_path_buf(),
        env: scrubbed(std::env::vars_os(), &[]),
    }
}

/// Runs a short question to its end: its exit code and what it printed.
/// Ended at `wait`.
fn ask(spec: &Spec, wait: Duration) -> Result<(Option<i32>, String), String> {
    let mut process = Process::start(spec)?;
    process.close_input();
    let began = Instant::now();
    let mut out = String::new();
    loop {
        match process.recv(Duration::from_millis(40)) {
            Recv::Out(line) | Recv::Err(line) => {
                if out.len() < 8000 {
                    out.push_str(&line);
                    out.push('\n');
                }
            }
            Recv::Ended(code) => return Ok((code, out)),
            Recv::Quiet => {
                if began.elapsed() >= wait {
                    process.kill();
                    return Err("It did not answer in time".to_owned());
                }
            }
        }
    }
}

/// The version a CLI printed: its first line.
pub fn version_of(output: &str) -> Option<String> {
    output
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .map(|l| l.chars().take(80).collect())
}

/// Whether the CLI's answer to the sign-in question says it is signed in.
pub fn signed_in_from(code: Option<i32>, output: &str) -> Option<bool> {
    let words = output.to_ascii_lowercase();
    if words.contains("0 credentials")
        || words.contains("not logged in")
        || words.contains("\"loggedin\": false")
        || words.contains("\"loggedin\":false")
    {
        return Some(false);
    }
    if classify(None, output) == Problem::SignIn {
        return Some(false);
    }
    if code == Some(0) && !output.trim().is_empty() {
        return Some(true);
    }
    None
}

fn home_folder() -> std::path::PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(Into::into)
        .unwrap_or_else(std::env::temp_dir)
}

/// Every agent, with where its program is and its version, asked of the program.
pub fn list() -> Vec<AgentInfo> {
    Agent::ALL
        .into_iter()
        .map(|agent| {
            let found = resolve(agent);
            let version = found.as_ref().and_then(|f| {
                ask(&spec(f, version_args(), &home_folder()), VERSION_WAIT)
                    .ok()
                    .filter(|(code, _)| *code == Some(0))
                    .and_then(|(_, out)| version_of(&out))
            });
            AgentInfo {
                id: agent.id(),
                label: agent.label(),
                provider: agent.provider_name(),
                found: found.is_some(),
                path: found.map(|f| super::mcp::plain(&f.path)),
                version,
                install: agent.install_hint(),
                sign_in: agent.sign_in_hint(),
            }
        })
        .collect()
}

/// "Test": starts the program for its version, then asks whether it is signed in.
pub fn test(agent: Agent) -> AgentCheck {
    let Some(found) = resolve(agent) else {
        return AgentCheck {
            ok: false,
            version: None,
            signed_in: None,
            message: format!(
                "{} was not found on this computer. {}",
                agent.label(),
                agent.install_hint()
            ),
        };
    };
    let cwd = home_folder();
    let version = match ask(&spec(&found, version_args(), &cwd), VERSION_WAIT) {
        Ok((Some(0), out)) => version_of(&out),
        Ok((code, out)) => {
            let said = clip(&out, 200);
            let how = code.map_or("it was ended".to_owned(), |c| format!("exit code {c}"));
            return AgentCheck {
                ok: false,
                version: None,
                signed_in: None,
                message: format!("{} did not start ({how}). {said}", agent.label()),
            };
        }
        Err(err) => {
            return AgentCheck {
                ok: false,
                version: None,
                signed_in: None,
                message: format!("{} could not be started: {err}", agent.label()),
            };
        }
    };
    let signed_in = ask(&spec(&found, status_args(agent), &cwd), STATUS_WAIT)
        .ok()
        .and_then(|(code, out)| signed_in_from(code, &out));
    let label = agent.label();
    let ver = version.clone().unwrap_or_default();
    let message = match signed_in {
        Some(true) => format!(
            "{label} {ver} is installed and signed in. Chats with it use its own account and limits."
        ),
        Some(false) => format!(
            "{label} {ver} is installed but not signed in. {}",
            agent.sign_in_hint()
        ),
        None => format!(
            "{label} {ver} is installed. Whether it is signed in could not be told; the first message will say. {}",
            agent.sign_in_hint()
        ),
    };
    AgentCheck {
        ok: signed_in != Some(false),
        version,
        signed_in,
        message,
    }
}
