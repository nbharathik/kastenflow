//! `kasten-mcp --setup claude-code|claude-desktop|codex|http`: the lines that point
//! an agent at a vault, for this very program. Settings in the app shows the
//! same lines (`connect.ts`); `fixtures/mcp-setup.json` holds what both must
//! say, and both are tested against it.

use std::path::Path;

use serde_json::{Value, json};

/// How to start the server: a program and its first arguments.
pub(crate) struct Server {
    pub command: String,
    pub args: Vec<String>,
}

impl Server {
    /// This program, at `exe`. The desktop app serves MCP when it is given `--mcp`.
    pub(crate) fn of(exe: &str, app: bool) -> Server {
        Server {
            command: exe.to_owned(),
            args: if app {
                vec!["--mcp".to_owned()]
            } else {
                Vec::new()
            },
        }
    }
}

/// What `--setup` can print.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Target {
    ClaudeCode,
    ClaudeDesktop,
    Codex,
    Http,
}

impl Target {
    pub(crate) fn parse(word: &str) -> Option<Target> {
        match word {
            "claude-code" => Some(Target::ClaudeCode),
            "claude-desktop" => Some(Target::ClaudeDesktop),
            "codex" => Some(Target::Codex),
            "http" => Some(Target::Http),
            _ => None,
        }
    }
}

/// A path as a person reads it. On Windows the file system spells a folder
/// `\\?\C:\Users\...` once it has been resolved; nobody writes it so.
pub(crate) fn plain(path: &Path) -> String {
    let text = path.display().to_string();
    match text.strip_prefix(r"\\?\") {
        Some(rest) => match rest.strip_prefix(r"UNC\") {
            Some(share) => format!(r"\\{share}"),
            None => rest.to_owned(),
        },
        None => text,
    }
}

/// A folder as the file system spells it, written plainly; the path as given if it cannot be resolved.
pub(crate) fn canonical(path: &Path) -> String {
    std::fs::canonicalize(path).map_or_else(|_| plain(path), |real| plain(&real))
}

/// A path in double quotes for a shell, inner quotes escaped.
fn quoted(path: &str) -> String {
    format!("\"{}\"", path.replace('"', "\\\""))
}

/// A program for a shell: quoted when it has spaces or quotes.
fn program(command: &str) -> String {
    if command.chars().any(|c| c.is_whitespace() || c == '"') {
        quoted(command)
    } else {
        command.to_owned()
    }
}

fn line(server: &Server, vault: &str, extra: &[&str]) -> String {
    let mut parts = vec![program(&server.command)];
    parts.extend(server.args.iter().cloned());
    parts.push("--vault".to_owned());
    parts.push(quoted(vault));
    parts.extend(extra.iter().map(|e| (*e).to_owned()));
    parts.join(" ")
}

fn pretty(value: &Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_default()
}

/// Adds KastenFlow to Claude Code for every folder it runs in (user scope).
pub(crate) fn claude_code(server: &Server, vault: &str) -> String {
    format!(
        "claude mcp add --scope user kasten -- {}",
        line(server, vault, &[])
    )
}

/// The `mcpServers` entry MCP apps read from their JSON config.
pub(crate) fn mcp_config(server: &Server, vault: &str) -> Value {
    let mut args: Vec<&str> = server.args.iter().map(String::as_str).collect();
    args.extend(["--vault", vault]);
    json!({ "mcpServers": { "kasten": { "command": server.command, "args": args } } })
}

/// A TOML basic string: quoted, with the backslash, the quote and control
/// characters escaped (a Windows path is full of backslashes).
fn toml_string(text: &str) -> String {
    let mut out = String::from("\"");
    for c in text.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c.is_control() => out.push_str(&format!("\\u{:04X}", u32::from(c))),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// The server as Codex reads it from `~/.codex/config.toml`: a stdio server
/// started by this program, told its vault through the environment.
pub(crate) fn codex_block(server: &Server, vault: &str) -> String {
    let args: Vec<String> = server.args.iter().map(|a| toml_string(a)).collect();
    format!(
        "[mcp_servers.kasten]\ncommand = {}\nargs = [{}]\n\n[mcp_servers.kasten.env]\nKASTEN_VAULT = {}\n",
        toml_string(&server.command),
        args.join(", "),
        toml_string(vault),
    )
}

/// What `--setup codex` prints: where the block goes, then the block. The
/// program writes nothing to the person's Codex settings.
fn codex(server: &Server, vault: &str) -> String {
    format!(
        "Add this to Codex's settings file, ~/.codex/config.toml (on Windows .codex\\config.toml in your user folder), then start Codex again. KastenFlow does not change that file itself.\n\n{}",
        codex_block(server, vault)
    )
}

/// Starts the local HTTP server; clients send the token as a bearer.
pub(crate) fn http_command(server: &Server, vault: &str) -> String {
    line(server, vault, &["--http"])
}

/// Where clients reach the HTTP server: this computer only.
pub(crate) fn http_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}/mcp")
}

/// The entry clients that connect by URL read, the token to be pasted in.
pub(crate) fn url_config(port: u16) -> Value {
    json!({ "mcpServers": { "kasten": {
        "type": "http",
        "url": http_url(port),
        "headers": { "Authorization": "Bearer <token>" },
    } } })
}

/// Where the HTTP server keeps its token, inside the vault, in the vault's own style of path.
pub(crate) fn token_path(vault: &str) -> String {
    let sep = if vault.contains('\\') && !vault.contains('/') {
        "\\"
    } else {
        "/"
    };
    let root = vault.trim_end_matches(['\\', '/']);
    [root, ".kasten", "cache", "mcp-token"].join(sep)
}

/// What `--setup` prints for `target`.
pub(crate) fn text(target: Target, server: &Server, vault: &str, port: u16) -> String {
    match target {
        Target::ClaudeCode => format!("{}\n", claude_code(server, vault)),
        Target::ClaudeDesktop => format!("{}\n", pretty(&mcp_config(server, vault))),
        Target::Codex => codex(server, vault),
        Target::Http => format!(
            "Start the server:\n{}\n\nThen point a client at {} with the token that is kept in {}:\n{}\n",
            http_command(server, vault),
            http_url(port),
            token_path(vault),
            pretty(&url_config(port)),
        ),
    }
}

#[cfg(test)]
#[path = "setup_tests.rs"]
mod tests;
