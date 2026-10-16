// Keep a console window out of release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::ExitCode;

fn main() -> ExitCode {
    // `kasten-app --mcp --vault <path> [--http]` serves the vault to AI
    // agents instead of opening a window.
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Some(rest) = kasten_app_lib::mcp_args(&args) {
        return kasten_mcp::run_in_app(rest);
    }
    kasten_app_lib::run();
    ExitCode::SUCCESS
}
