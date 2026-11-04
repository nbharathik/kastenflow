//! KastenFlow's MCP server as the CLI is told to start it: this very program
//! with `--mcp --vault <folder>`. The config file Claude Code reads is written
//! to the app's cache folder, never into the vault (a file in the vault would
//! be synced, backed up and shown to other agents).

use std::path::{Path, PathBuf};

use serde_json::{Value, json};

use super::SERVER;

/// How to start the server: a program and its arguments.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpServer {
    pub command: String,
    pub args: Vec<String>,
}

/// A path as a person reads it: Windows spells a resolved folder
/// `\\?\C:\Users\...`, which no program takes kindly.
pub fn plain(path: &Path) -> String {
    let text = path.display().to_string();
    match text.strip_prefix(r"\\?\") {
        Some(rest) => match rest.strip_prefix(r"UNC\") {
            Some(share) => format!(r"\\{share}"),
            None => rest.to_owned(),
        },
        None => text,
    }
}

/// The server for `vault`, started by the program at `exe`.
pub fn server_for(exe: &Path, vault: &Path) -> McpServer {
    McpServer {
        command: plain(exe),
        args: vec!["--mcp".to_owned(), "--vault".to_owned(), plain(vault)],
    }
}

/// What Claude Code's `--mcp-config` file holds.
pub fn claude_config(server: &McpServer) -> Value {
    json!({ "mcpServers": { (SERVER): { "command": server.command, "args": server.args } } })
}

/// The real place of `path`, though it may not exist yet: its nearest folder
/// that does is resolved (links followed) and the rest put back after it.
fn resolved(path: &Path) -> PathBuf {
    let mut rest: Vec<std::ffi::OsString> = Vec::new();
    let mut current = path;
    loop {
        if let Ok(real) = current.canonicalize() {
            return rest
                .iter()
                .rev()
                .fold(PathBuf::from(plain(&real)), |acc, part| acc.join(part));
        }
        match (current.parent(), current.file_name()) {
            (Some(parent), Some(name)) => {
                rest.push(name.to_owned());
                current = parent;
            }
            _ => return path.to_path_buf(),
        }
    }
}

/// A file name for a chat: letters, digits, `-` and `_` only.
fn file_stem(chat: &str) -> String {
    chat.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .take(80)
        .collect()
}

/// Writes the config for `chat` under `dir` and gives its path. Refuses a
/// folder inside the vault. The file is written whole under another name and
/// moved into place, so a CLI that starts at that moment never reads half.
pub fn write_claude_config(
    dir: &Path,
    vault: &Path,
    chat: &str,
    server: &McpServer,
) -> Result<PathBuf, String> {
    let inside = |a: &Path, b: &Path| resolved(a).starts_with(resolved(b));
    // Looked at before the folder is made: nothing is created in the vault.
    if inside(dir, vault) {
        return Err("The agent's settings must not be kept inside the vault".to_owned());
    }
    std::fs::create_dir_all(dir)
        .map_err(|e| format!("The agent's settings folder could not be made: {e}"))?;
    let name = format!("claude-code-{}.mcp.json", file_stem(chat));
    let target = dir.join(&name);
    let temp = dir.join(format!("{name}.tmp"));
    let body = serde_json::to_string_pretty(&claude_config(server)).map_err(|e| e.to_string())?;
    std::fs::write(&temp, body)
        .map_err(|e| format!("The agent's settings could not be written: {e}"))?;
    std::fs::rename(&temp, &target)
        .map_err(|e| format!("The agent's settings could not be kept: {e}"))?;
    Ok(target)
}
