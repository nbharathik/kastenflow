//! The MCP server over kasten-core, as a
//! library: the `kasten-mcp` binary and the desktop app's `--mcp` mode
//! both call [`run`], and the app's chat calls the same tools in-process
//! through [`tools`].

mod agent_guide;
pub mod bridge;
mod config_watch;
pub mod decks;
pub mod diagram_words;
mod http;
mod latex_instructions;
pub mod latex_words;
mod mcp_board;
mod mcp_diagram;
mod mcp_diagram_ai;
mod mcp_diagram_more;
mod mcp_figure;
mod mcp_latex;
mod mcp_latex_app;
mod mcp_latex_files;
mod mcp_latex_more;
mod mcp_pages;
mod mcp_parity;
mod mcp_read;
mod mcp_resources;
mod mcp_smart;
mod mcp_structure;
mod mcp_write;
mod page_instructions;
mod params;
mod params_diagram;
mod params_figure;
mod params_latex;
mod params_latex_files;
mod params_latex_more;
mod params_pages;
mod params_parity;
mod params_smart;
mod params_structure;
pub mod parity_words;
mod plugins;
mod server;
mod setup;
mod smart_instructions;
pub mod smart_kit;
pub mod smart_words;
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
use crate::setup::{Server, Target};

const USAGE: &str = "Usage: kasten-mcp --vault <path> [--http [--port 7433]]
       kasten-mcp --vault <path> --check
       kasten-mcp --vault <path> --setup claude-code|claude-desktop|codex|http

Serves a KastenFlow vault to AI agents over MCP. Without --http it speaks
stdio, for Claude Code and Claude Desktop. The vault is --vault, else
KASTEN_VAULT. It must keep history (turn it on in KastenFlow's settings or
with `kastenflow start-history`), so every agent change can be undone.

--check prints how the server is doing (the vault, its history, and whether
slides can be drawn here: a browser, the page it draws with, its sandbox) and
exits with 1 when something is wrong. --setup prints the lines that connect an
agent to this vault, for this program.";

struct Options {
    vault: PathBuf,
    http: bool,
    port: u16,
    check: bool,
    setup: Option<Target>,
}

fn options(args: &[String]) -> Result<Option<Options>, String> {
    let mut vault = std::env::var_os("KASTEN_VAULT").map(PathBuf::from);
    let mut http = false;
    let mut port = DEFAULT_PORT;
    let mut check = false;
    let mut setup = None;
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
            "--check" => check = true,
            "--setup" => {
                let word = iter
                    .next()
                    .ok_or("--setup needs claude-code, claude-desktop, codex or http")?;
                setup = Some(Target::parse(word).ok_or_else(|| {
                    format!(
                        "Not something to set up: {word}. Use claude-code, claude-desktop, codex or http."
                    )
                })?);
            }
            "--port" => {
                let value = iter.next().ok_or("--port needs a number")?;
                port = value.parse().map_err(|_| format!("Not a port: {value}"))?;
            }
            other => return Err(format!("Unknown argument {other}\n\n{USAGE}")),
        }
    }
    let vault = vault.ok_or(format!("No vault given\n\n{USAGE}"))?;
    Ok(Some(Options {
        vault,
        http,
        port,
        check,
        setup,
    }))
}

/// Writes to stderr in one go, and carries on if no one reads it any more:
/// a server must not stop because the terminal that started it went away.
pub(crate) fn say(text: &str) {
    use std::io::Write;
    let _ = std::io::stderr().write_all(text.as_bytes());
}

/// Writes to stdout, for what a person asked to see (`--check`, `--setup`).
fn out(text: &str) {
    use std::io::Write;
    let mut stdout = std::io::stdout();
    let _ = stdout.write_all(text.as_bytes());
    let _ = stdout.flush();
}

/// Runs the server as `kasten-mcp` would with these arguments (the program
/// name left out), until the client goes away.
pub fn run(args: &[String]) -> ExitCode {
    serve(args, false)
}

/// The same for the desktop app, which calls this for `--mcp` (and gives it
/// the arguments after it), so an installed app is all an agent needs. It
/// differs only in what `--setup` prints: the app is started with `--mcp`.
pub fn run_in_app(args: &[String]) -> ExitCode {
    serve(args, true)
}

/// `--setup`: the lines that connect an agent to the vault, for this program.
fn print_setup(target: Target, options: &Options, app: bool) -> ExitCode {
    let vault = match std::fs::canonicalize(&options.vault) {
        Ok(path) => setup::plain(&path),
        Err(err) => {
            say(&format!(
                "kasten-mcp: cannot find {}: {err}\n",
                options.vault.display()
            ));
            return ExitCode::from(2);
        }
    };
    let exe = match std::env::current_exe() {
        Ok(path) => setup::plain(&path),
        Err(err) => {
            say(&format!(
                "kasten-mcp: cannot tell where this program is: {err}\n"
            ));
            return ExitCode::from(2);
        }
    };
    out(&setup::text(
        target,
        &Server::of(&exe, app),
        &vault,
        options.port,
    ));
    ExitCode::SUCCESS
}

/// `--check`: how the server is doing, as JSON; exit 1 when something is wrong.
fn print_check(kasten: &Kasten) -> ExitCode {
    let (status, problems) = tools::health(kasten, None);
    out(&format!(
        "{}\n",
        serde_json::to_string_pretty(&status).unwrap_or_default()
    ));
    for problem in &problems {
        say(&format!("kasten-mcp: {problem}\n"));
    }
    if problems.is_empty() {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}

fn serve(args: &[String], app: bool) -> ExitCode {
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
    if let Some(target) = options.setup {
        return print_setup(target, &options, app);
    }
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
    if options.check {
        return print_check(&kasten);
    }
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
    // A browser is not stopped by the program that started it ending.
    decks::render::shutdown();
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
    // A plugin turned on or off in the app changes the tools this client has.
    let watching = tokio::spawn(config_watch::watch(
        Arc::clone(&kasten),
        running.peer().clone(),
    ));
    let waited = running.waiting().await;
    watching.abort();
    waited.map_err(|e| e.to_string())?;
    // Agent ops commit at once; this catches anything else still waiting.
    let _ = kasten.commit_edits();
    Ok(())
}
