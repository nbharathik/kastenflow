//! The MCP server over kasten-core, as a
//! library: the `kasten-mcp` binary and the desktop app's `--mcp` mode
//! both call [`run`], and the app's chat calls the same tools in-process
//! through [`tools`].

pub mod decks;
mod http;
mod mcp_board;
mod mcp_diagram;
mod mcp_read;
mod mcp_write;
mod params;
mod server;
mod token;
pub mod tools;

/// The vault's token for MCP over HTTP, made on first use.
pub use token::token as http_token;

/// The port the HTTP server listens on unless told another.
pub const DEFAULT_PORT: u16 = 7433;

use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::Arc;

use kasten_core::Kasten;
use rmcp::ServiceExt;

use crate::server::KastenServer;

const USAGE: &str = "Usage: kasten-mcp --vault <path> [--http [--port 7433]]

Serves a KastenFlow vault to AI agents over MCP. Without --http it speaks
stdio, for Claude Code and Claude Desktop. The vault is --vault, else
KASTEN_VAULT. It must keep history (turn it on in KastenFlow's settings or
with `kastenflow start-history`), so every agent change can be undone.";

struct Options {
    vault: PathBuf,
    http: bool,
    port: u16,
}

fn options(args: &[String]) -> Result<Option<Options>, String> {
    let mut vault = std::env::var_os("KASTEN_VAULT").map(PathBuf::from);
    let mut http = false;
    let mut port = DEFAULT_PORT;
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "-V" | "--version" => {
                println!("kasten-mcp {}", kasten_core::VERSION);
                return Ok(None);
            }
            "-h" | "--help" => {
                println!("kasten-mcp {}\n\n{USAGE}", kasten_core::VERSION);
                return Ok(None);
            }
            "--vault" => vault = Some(iter.next().ok_or("--vault needs a path")?.into()),
            "--http" => http = true,
            "--port" => {
                let value = iter.next().ok_or("--port needs a number")?;
                port = value.parse().map_err(|_| format!("Not a port: {value}"))?;
            }
            other => return Err(format!("Unknown argument {other}\n\n{USAGE}")),
        }
    }
    let vault = vault.ok_or(format!("No vault given\n\n{USAGE}"))?;
    Ok(Some(Options { vault, http, port }))
}

/// Writes to stderr in one go, and carries on if no one reads it any more:
/// a server must not stop because the terminal that started it went away.
pub(crate) fn say(text: &str) {
    use std::io::Write;
    let _ = std::io::stderr().write_all(text.as_bytes());
}

/// Runs the server as `kasten-mcp` would with these arguments (the program
/// name left out), until the client goes away. The desktop app calls this
/// for `--mcp`, so an installed app is all an agent needs.
pub fn run(args: &[String]) -> ExitCode {
    let options = match options(args) {
        Ok(Some(options)) => options,
        Ok(None) => return ExitCode::SUCCESS,
        Err(message) => {
            say(&format!(
                "kasten-mcp: {message}
"
            ));
            return ExitCode::from(2);
        }
    };
    let kasten = match Kasten::open(&options.vault) {
        Ok(kasten) => Arc::new(kasten),
        Err(err) => {
            say(&format!(
                "kasten-mcp: cannot open {}: {err}
",
                options.vault.display()
            ));
            return ExitCode::from(2);
        }
    };
    if !kasten.has_history() {
        say(&format!(
            "kasten-mcp: {} keeps no history, so agent changes could not be undone. \
             Turn on history in KastenFlow's settings or run `kastenflow start-history --vault {}`.\n",
            options.vault.display(),
            options.vault.display()
        ));
        return ExitCode::from(2);
    }
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(err) => {
            say(&format!(
                "kasten-mcp: {err}
"
            ));
            return ExitCode::FAILURE;
        }
    };
    let result = runtime.block_on(async move {
        if options.http {
            http::serve(kasten, options.port).await
        } else {
            stdio(kasten).await
        }
    });
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            say(&format!(
                "kasten-mcp: {err}
"
            ));
            ExitCode::FAILURE
        }
    }
}

async fn stdio(kasten: Arc<Kasten>) -> Result<(), String> {
    let server = KastenServer::new(Arc::clone(&kasten));
    let running = server
        .serve(rmcp::transport::stdio())
        .await
        .map_err(|e| e.to_string())?;
    running.waiting().await.map_err(|e| e.to_string())?;
    // Agent ops commit at once; this catches anything else still waiting.
    let _ = kasten.commit_edits();
    Ok(())
}
