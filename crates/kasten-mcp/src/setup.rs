//! `kasten-mcp --setup claude-code|claude-desktop|http`: the lines that point
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
    Http,
}

impl Target {
    pub(crate) fn parse(word: &str) -> Option<Target> {
        match word {
            "claude-code" => Some(Target::ClaudeCode),
            "claude-desktop" => Some(Target::ClaudeDesktop),
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
mod tests {
    use super::*;

    const FIXTURE: &str = include_str!("../../../fixtures/mcp-setup.json");

    fn fixture() -> Value {
        serde_json::from_str(FIXTURE).expect("the fixture is JSON")
    }

    fn strings(value: &Value) -> Vec<String> {
        value
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s.as_str().unwrap().to_owned())
            .collect()
    }

    #[test]
    fn every_line_is_what_the_shared_fixture_says_and_settings_says_the_same() {
        let fixture = fixture();
        let cases = fixture["cases"].as_array().unwrap();
        assert!(cases.len() >= 4);
        for case in cases {
            let name = case["name"].as_str().unwrap();
            let server = Server {
                command: case["command"].as_str().unwrap().to_owned(),
                args: strings(&case["args"]),
            };
            let vault = case["vault"].as_str().unwrap();
            assert_eq!(
                claude_code(&server, vault),
                case["claudeCode"].as_str().unwrap(),
                "{name}"
            );
            assert_eq!(mcp_config(&server, vault), case["mcpConfig"], "{name}");
            assert_eq!(
                http_command(&server, vault),
                case["httpCommand"].as_str().unwrap(),
                "{name}"
            );
        }
        assert_eq!(
            http_url(crate::DEFAULT_PORT),
            fixture["url"].as_str().unwrap()
        );
        assert_eq!(url_config(crate::DEFAULT_PORT), fixture["urlConfig"]);
        for pair in fixture["tokenPaths"].as_array().unwrap() {
            assert_eq!(
                token_path(pair[0].as_str().unwrap()),
                pair[1].as_str().unwrap()
            );
        }
    }

    #[test]
    fn the_app_is_asked_to_serve_with_mcp_and_the_command_line_program_is_not() {
        let app = Server::of("/usr/bin/kasten-app", true);
        assert_eq!(app.args, ["--mcp"]);
        assert_eq!(
            claude_code(&app, "/v"),
            "claude mcp add --scope user kasten -- /usr/bin/kasten-app --mcp --vault \"/v\""
        );
        assert!(Server::of("/usr/bin/kasten-mcp", false).args.is_empty());
    }

    #[test]
    fn what_is_printed_is_ready_to_paste_and_names_the_token() {
        let server = Server::of("kasten-mcp", false);
        let code = text(Target::ClaudeCode, &server, "/v", 7433);
        assert!(
            code.starts_with("claude mcp add") && code.ends_with("\"/v\"\n"),
            "{code}"
        );
        let desktop = text(Target::ClaudeDesktop, &server, "/v", 7433);
        let parsed: Value = serde_json::from_str(&desktop).unwrap();
        assert_eq!(parsed, mcp_config(&server, "/v"));
        let http = text(Target::Http, &server, "/v", 7433);
        assert!(
            http.contains("kasten-mcp --vault \"/v\" --http")
                && http.contains("http://127.0.0.1:7433/mcp")
                && http.contains("/v/.kasten/cache/mcp-token")
                && http.contains("Bearer <token>"),
            "{http}"
        );
        assert_eq!(Target::parse("claude-code"), Some(Target::ClaudeCode));
        assert_eq!(Target::parse("claude-desktop"), Some(Target::ClaudeDesktop));
        assert_eq!(Target::parse("http"), Some(Target::Http));
        assert_eq!(Target::parse("cursor"), None);
    }

    #[test]
    fn a_resolved_windows_path_is_written_the_way_a_person_writes_it() {
        assert_eq!(
            plain(Path::new(r"\\?\C:\Users\me\Notes")),
            r"C:\Users\me\Notes"
        );
        assert_eq!(
            plain(Path::new(r"\\?\UNC\server\share\Notes")),
            r"\\server\share\Notes"
        );
        assert_eq!(plain(Path::new("/home/me/Notes")), "/home/me/Notes");
    }
}
