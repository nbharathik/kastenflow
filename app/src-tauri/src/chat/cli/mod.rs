//! Coding-agent CLIs in the chat: the person's own Claude Code or OpenCode,
//! started as a child process, answer a thread with their own account, plan and
//! limits. KastenFlow signs in to nothing and stores no key for them. The CLI
//! gets KastenFlow's MCP server (so its notes pass the same guardrails, modes,
//! review and undo as any agent's) and asks before it does anything else: its
//! questions come back to the chat as approve/deny cards.
//!
//! The pieces: where the program is (`resolve`), what environment it gets
//! (`env`), its command line and MCP config (`args`, `mcp`), the child process
//! (`process`), what its output means (`claude`, `opencode`, `items`), the
//! turn that turns that into chat events (`drive`), and the commands the
//! window calls (`commands`, `detect`).

pub mod approvals;
pub mod args;
pub mod claude;
pub mod commands;
pub mod detect;
pub mod drive;
pub mod env;
pub mod items;
pub mod mcp;
pub mod opencode;
pub mod process;
pub mod resolve;
pub mod sessions;
pub mod tools;

#[cfg(test)]
mod tests;

use serde::{Deserialize, Serialize};

/// The coding agents KastenFlow can run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Agent {
    #[serde(rename = "claude-code")]
    ClaudeCode,
    #[serde(rename = "opencode")]
    OpenCode,
}

impl Agent {
    pub const ALL: [Agent; 2] = [Agent::ClaudeCode, Agent::OpenCode];

    /// The name in files and commands.
    pub fn id(self) -> &'static str {
        match self {
            Agent::ClaudeCode => "claude-code",
            Agent::OpenCode => "opencode",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Agent::ClaudeCode => "Claude Code",
            Agent::OpenCode => "OpenCode",
        }
    }

    /// The name a thread's provider has when it uses this agent. A provider
    /// the vault's config names cannot take it (`providers::save` refuses).
    pub fn provider_name(self) -> &'static str {
        match self {
            Agent::ClaudeCode => "Claude Code (CLI)",
            Agent::OpenCode => "OpenCode (CLI)",
        }
    }

    pub fn of_provider(name: &str) -> Option<Agent> {
        Agent::ALL
            .into_iter()
            .find(|agent| agent.provider_name() == name.trim())
    }

    pub fn of_id(id: &str) -> Option<Agent> {
        Agent::ALL.into_iter().find(|agent| agent.id() == id)
    }

    /// The file names the program may have, best first.
    pub fn programs(self, windows: bool) -> &'static [&'static str] {
        match (self, windows) {
            (Agent::ClaudeCode, true) => &["claude.exe", "claude.cmd"],
            (Agent::ClaudeCode, false) => &["claude"],
            (Agent::OpenCode, true) => &["opencode.exe", "opencode.cmd"],
            (Agent::OpenCode, false) => &["opencode"],
        }
    }

    /// How to install it, in words, from the CLI's own documentation.
    pub fn install_hint(self) -> &'static str {
        match self {
            Agent::ClaudeCode => {
                "Install Claude Code, then open a new KastenFlow chat. On Windows, in PowerShell: irm https://claude.ai/install.ps1 | iex. On macOS or Linux: curl -fsSL https://claude.ai/install.sh | bash. Or with npm: npm install -g @anthropic-ai/claude-code."
            }
            Agent::OpenCode => {
                "Install OpenCode, then open a new KastenFlow chat. With npm: npm install -g opencode-ai. On macOS or Linux: curl -fsSL https://opencode.ai/install | bash. On Windows also: scoop install opencode, or choco install opencode."
            }
        }
    }

    /// How to sign in to it, in words. KastenFlow never does it for the person.
    pub fn sign_in_hint(self) -> &'static str {
        match self {
            Agent::ClaudeCode => {
                "Sign in once in a terminal: run claude and follow the browser prompts. KastenFlow uses the account the CLI is signed in with."
            }
            Agent::OpenCode => {
                "Sign in once in a terminal: run opencode auth login, or /connect inside opencode, and pick a provider. KastenFlow uses the accounts the CLI knows."
            }
        }
    }

    /// The name MCP tools of KastenFlow have for this agent, to cut off a
    /// tool's name: `mcp__kasten__append` in Claude Code, `kasten_append` in
    /// OpenCode.
    pub fn strip_tool(self, name: &str) -> &str {
        let prefix = match self {
            Agent::ClaudeCode => "mcp__kasten__",
            Agent::OpenCode => "kasten_",
        };
        name.strip_prefix(prefix).unwrap_or(name)
    }

    /// Whether `name` is one of KastenFlow's own tools as this agent names them.
    pub fn is_kasten_tool(self, name: &str) -> bool {
        self.strip_tool(name) != name
    }
}

/// The name of the MCP server the CLI is given.
pub const SERVER: &str = "kasten";

/// What the chat keeps about the agents it runs: the questions waiting for the
/// person, and which conversation of the CLI each thread goes on with.
#[derive(Default)]
pub struct Hub {
    pub approvals: approvals::Approvals,
    pub sessions: sessions::Sessions,
}
