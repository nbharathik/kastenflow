//! Where an agent's program is. It is started by absolute path, never by a
//! bare name: a file of that name in the vault or the working folder must not
//! be run in its place (the same rule as the LaTeX engines). `PATH` entries
//! that are not absolute are ignored. On Windows the program may be an `.exe`
//! or an npm shim (`.cmd`); the shim is marked, because it runs through the
//! command interpreter and can take only plain arguments.

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::Agent;

/// The places a program may be in, read once so a test can give its own.
#[derive(Debug, Clone, Default)]
pub struct Places {
    pub path: Option<OsString>,
    pub home: Option<PathBuf>,
    pub app_data: Option<PathBuf>,
    pub local_app_data: Option<PathBuf>,
    pub windows: bool,
}

impl Places {
    pub fn from_env() -> Places {
        let var = |name: &str| std::env::var_os(name).filter(|v| !v.is_empty());
        Places {
            path: var("PATH"),
            home: var("USERPROFILE")
                .or_else(|| var("HOME"))
                .map(PathBuf::from),
            app_data: var("APPDATA").map(PathBuf::from),
            local_app_data: var("LOCALAPPDATA").map(PathBuf::from),
            windows: cfg!(windows),
        }
    }
}

/// A program that was found.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Found {
    pub path: PathBuf,
    /// An npm shim (`.cmd`/`.bat`): started through the command interpreter.
    pub shim: bool,
}

/// Whether `file` is a batch file, which Windows runs through `cmd.exe`.
pub fn is_shim(file: &Path) -> bool {
    file.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"))
}

/// The folders to look in, in order: `PATH`'s absolute entries, then where
/// each CLI's own installer and the usual package managers put it.
fn folders(places: &Places) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    if let Some(path) = &places.path {
        out.extend(std::env::split_paths(path).filter(|p| p.is_absolute()));
    }
    let under = |base: &Option<PathBuf>, rest: &[&str]| {
        base.as_ref()
            .map(|b| rest.iter().fold(b.clone(), |p, part| p.join(part)))
    };
    out.extend(
        [
            under(&places.home, &[".local", "bin"]),
            under(&places.home, &[".claude", "local"]),
            under(&places.home, &[".opencode", "bin"]),
            under(&places.home, &["scoop", "shims"]),
            under(&places.app_data, &["npm"]),
            under(&places.local_app_data, &["Microsoft", "WinGet", "Links"]),
        ]
        .into_iter()
        .flatten(),
    );
    let mut seen: Vec<PathBuf> = Vec::new();
    out.retain(|p| {
        let fresh = !seen.contains(p);
        seen.push(p.clone());
        fresh
    });
    out
}

/// Every path the program may be at, best first.
pub fn candidates(agent: Agent, places: &Places) -> Vec<PathBuf> {
    let names = agent.programs(places.windows);
    folders(places)
        .into_iter()
        .flat_map(|dir| names.iter().map(move |name| dir.join(name)))
        .collect()
}

/// The program's absolute path, if it is there. `exists` says whether a file
/// is (so a test needs no disk).
pub fn resolve_with(
    agent: Agent,
    places: &Places,
    exists: &dyn Fn(&Path) -> bool,
) -> Option<Found> {
    candidates(agent, places)
        .into_iter()
        .find(|c| exists(c))
        .map(|path| Found {
            shim: places.windows && is_shim(&path),
            path,
        })
}

/// `resolve_with` on this computer's files.
pub fn resolve(agent: Agent) -> Option<Found> {
    resolve_with(agent, &Places::from_env(), &|p: &Path| p.is_file())
}
