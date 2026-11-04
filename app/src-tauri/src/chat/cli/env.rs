//! The environment an agent CLI starts with. A clean one: only what a program
//! needs to find itself, its own config and the network, never what the app or
//! the person's shell holds as secrets. The agent signs in by its own
//! login (its config files), not by a key in the environment, so no variable
//! that looks like a key, a token or a password is passed on.

use std::ffi::OsString;

use crate::plugins::latex::proc::sensitive;

/// Variables kept, by name (compared in capitals: Windows ignores case).
const KEEP: &[&str] = &[
    "PATH",
    "PATHEXT",
    "SYSTEMROOT",
    "SYSTEMDRIVE",
    "WINDIR",
    "COMSPEC",
    "TEMP",
    "TMP",
    "TMPDIR",
    "HOME",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "PROGRAMW6432",
    "COMMONPROGRAMFILES",
    "PUBLIC",
    "ALLUSERSPROFILE",
    "USERNAME",
    "USER",
    "LOGNAME",
    "USERDOMAIN",
    "COMPUTERNAME",
    "OS",
    "PROCESSOR_ARCHITECTURE",
    "NUMBER_OF_PROCESSORS",
    "LANG",
    "LANGUAGE",
    "TERM",
    "COLORTERM",
    "SHELL",
    "TZ",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "ALL_PROXY",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_EXTRA_CA_CERTS",
    "REQUESTS_CA_BUNDLE",
    // The agents' own config folders, so a moved config is found.
    "CLAUDE_CONFIG_DIR",
    "OPENCODE_CONFIG_DIR",
    "OPENCODE_CONFIG",
];

/// Prefixes kept (locale and the XDG folders).
const KEEP_PREFIX: &[&str] = &["LC_", "XDG_"];

/// Whether the variable `name` goes to the agent.
pub fn keep(name: &str) -> bool {
    let upper = name.to_ascii_uppercase();
    (KEEP.contains(&upper.as_str()) || KEEP_PREFIX.iter().any(|p| upper.starts_with(p)))
        && !sensitive(name)
}

/// The environment of an agent: what `vars` holds of the kept names, then
/// `set` (what the app sets itself, which is never taken away again).
pub fn scrubbed(
    vars: impl IntoIterator<Item = (OsString, OsString)>,
    set: &[(String, String)],
) -> Vec<(OsString, OsString)> {
    let set_names: Vec<String> = set.iter().map(|(k, _)| k.to_ascii_uppercase()).collect();
    let mut out: Vec<(OsString, OsString)> = vars
        .into_iter()
        .filter(|(k, _)| {
            k.to_str()
                .is_some_and(|name| keep(name) && !set_names.contains(&name.to_ascii_uppercase()))
        })
        .collect();
    out.extend(
        set.iter()
            .map(|(k, v)| (OsString::from(k), OsString::from(v))),
    );
    out
}
