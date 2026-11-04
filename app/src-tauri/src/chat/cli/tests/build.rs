//! Where the program is, what environment it gets, the command lines, the MCP
//! config file and the CLI's conversation numbers.

use std::collections::BTreeSet;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::chat::cli::args::{
    CLAUDE_FILE_TOOLS, claude_args, opencode_args, opencode_config, opencode_env,
    opencode_permission, plain_session,
};
use crate::chat::cli::detect::{signed_in_from, version_of};
use crate::chat::cli::env::{keep, scrubbed};
use crate::chat::cli::mcp::{claude_config, plain, server_for, write_claude_config};
use crate::chat::cli::resolve::{Places, candidates, resolve_with};
use crate::chat::cli::sessions::Sessions;
use crate::chat::cli::{Agent, tools};

fn dir(name: &str) -> PathBuf {
    std::env::temp_dir()
        .join("kasten-agent-cli-tests")
        .join(name)
}

fn places(folders: &[PathBuf], windows: bool) -> Places {
    Places {
        path: Some(std::env::join_paths(folders).unwrap()),
        home: Some(dir("home")),
        app_data: Some(dir("appdata")),
        local_app_data: Some(dir("local")),
        windows,
    }
}

#[test]
fn the_program_is_found_by_absolute_path_and_a_relative_entry_is_ignored() {
    let bin = dir("bin");
    let tools = dir("tools");
    let mut p = places(&[bin.clone(), tools.clone()], true);
    // A relative entry would be the working folder: never looked in.
    p.path = Some(
        std::env::join_paths([PathBuf::from("relative"), bin.clone(), tools.clone()]).unwrap(),
    );
    let here: BTreeSet<PathBuf> = [
        tools.join("claude.exe"),
        PathBuf::from("relative").join("claude.exe"),
    ]
    .into();
    let found = resolve_with(Agent::ClaudeCode, &p, &|f: &Path| here.contains(f)).unwrap();
    assert_eq!(found.path, tools.join("claude.exe"));
    assert!(found.path.is_absolute() && !found.shim);
    assert!(
        candidates(Agent::ClaudeCode, &p)
            .iter()
            .all(|c| c.is_absolute())
    );
}

#[test]
fn an_npm_shim_is_marked_and_an_exe_beats_it() {
    let bin = dir("bin");
    let p = places(std::slice::from_ref(&bin), true);
    let both: BTreeSet<PathBuf> = [bin.join("opencode.cmd"), bin.join("opencode.exe")].into();
    let found = resolve_with(Agent::OpenCode, &p, &|f: &Path| both.contains(f)).unwrap();
    assert_eq!(found.path, bin.join("opencode.exe"));
    let only: BTreeSet<PathBuf> = [bin.join("opencode.cmd")].into();
    let shim = resolve_with(Agent::OpenCode, &p, &|f: &Path| only.contains(f)).unwrap();
    assert!(shim.shim, "a .cmd runs through the command interpreter");
}

#[test]
fn the_installers_own_folders_are_looked_in_and_nothing_found_is_none() {
    let p = places(&[], true);
    let home = dir("home").join(".local").join("bin").join("claude.exe");
    let at: BTreeSet<PathBuf> = [home.clone()].into();
    assert_eq!(
        resolve_with(Agent::ClaudeCode, &p, &|f: &Path| at.contains(f))
            .unwrap()
            .path,
        home
    );
    let npm = dir("appdata").join("npm").join("claude.cmd");
    let at: BTreeSet<PathBuf> = [npm.clone()].into();
    assert_eq!(
        resolve_with(Agent::ClaudeCode, &p, &|f: &Path| at.contains(f))
            .unwrap()
            .path,
        npm
    );
    assert!(resolve_with(Agent::OpenCode, &p, &|_: &Path| false).is_none());
    // Not Windows: the bare name only.
    let unix = places(&[dir("bin")], false);
    assert!(
        candidates(Agent::ClaudeCode, &unix)
            .iter()
            .all(|c| c.file_name().unwrap() == "claude")
    );
}

fn vars(pairs: &[(&str, &str)]) -> Vec<(OsString, OsString)> {
    pairs
        .iter()
        .map(|(k, v)| (OsString::from(k), OsString::from(v)))
        .collect()
}

#[test]
fn the_environment_is_clean_of_the_apps_and_the_shells_secrets() {
    let all = vars(&[
        ("PATH", "C:\\bin"),
        ("Path", "C:\\bin2"),
        ("USERPROFILE", "C:\\Users\\a"),
        ("APPDATA", "C:\\Users\\a\\AppData\\Roaming"),
        ("LOCALAPPDATA", "C:\\Users\\a\\AppData\\Local"),
        ("SystemRoot", "C:\\Windows"),
        ("XDG_CONFIG_HOME", "/home/a/.config"),
        ("LC_ALL", "C"),
        ("CLAUDE_CONFIG_DIR", "/home/a/.claude"),
        ("ANTHROPIC_API_KEY", "sk-secret"),
        ("OPENAI_API_KEY", "sk-secret"),
        ("GITHUB_TOKEN", "ghp_secret"),
        ("KASTEN_VAULT", "/vault"),
        ("AWS_SECRET_ACCESS_KEY", "x"),
        ("DATABASE_PASSWORD", "x"),
        ("RANDOM_THING", "x"),
    ]);
    let out = scrubbed(
        all,
        &[("OPENCODE_DISABLE_AUTOUPDATE".to_owned(), "true".to_owned())],
    );
    let names: Vec<String> = out
        .iter()
        .map(|(k, _)| k.to_str().unwrap().to_owned())
        .collect();
    for kept in [
        "PATH",
        "Path",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
        "SystemRoot",
        "XDG_CONFIG_HOME",
        "LC_ALL",
        "CLAUDE_CONFIG_DIR",
        "OPENCODE_DISABLE_AUTOUPDATE",
    ] {
        assert!(
            names.iter().any(|n| n == kept),
            "{kept} should be kept: {names:?}"
        );
    }
    for dropped in [
        "ANTHROPIC_API_KEY",
        "OPENAI_API_KEY",
        "GITHUB_TOKEN",
        "KASTEN_VAULT",
        "AWS_SECRET_ACCESS_KEY",
        "DATABASE_PASSWORD",
        "RANDOM_THING",
    ] {
        assert!(
            !names.iter().any(|n| n == dropped),
            "{dropped} must not reach the agent"
        );
    }
    assert!(keep("home") && !keep("KASTEN_ANYTHING") && !keep("MY_TOKEN"));
}

#[test]
fn what_the_app_sets_wins_over_what_was_inherited() {
    let out = scrubbed(
        vars(&[("NO_PROXY", "a")]),
        &[("NO_PROXY".to_owned(), "b".to_owned())],
    );
    assert_eq!(out, vars(&[("NO_PROXY", "b")]));
}

#[test]
fn claude_code_asks_first_and_is_never_in_a_bypass_mode() {
    let args = claude_args("C:\\cache\\cfg.mcp.json", None);
    let joined = args.join(" ");
    for needed in [
        "-p",
        "--output-format stream-json",
        "--input-format stream-json",
        "--verbose",
        "--permission-mode default",
        "--permission-prompt-tool stdio",
        "--strict-mcp-config",
        "--mcp-config C:\\cache\\cfg.mcp.json",
        // The vault is the working folder and may come from someone else: its
        // `.claude/settings.json` (hooks, allow rules) is never read.
        "--setting-sources user",
    ] {
        assert!(joined.contains(needed), "{needed} in {joined}");
    }
    let sources = args.iter().position(|a| a == "--setting-sources").unwrap();
    assert_eq!(args[sources + 1], "user", "no project or local settings");
    for never in [
        "bypassPermissions",
        "--dangerously-skip-permissions",
        "acceptEdits",
        "--allow-dangerously",
        "dontAsk",
    ] {
        assert!(!joined.contains(never), "{never} in {joined}");
    }
    // Only KastenFlow's tools are pre-approved; the CLI's own file writers are taken away.
    let allowed = args.iter().position(|a| a == "--allowedTools").unwrap();
    assert_eq!(args[allowed + 1], "mcp__kasten__*");
    let denied = args.iter().position(|a| a == "--disallowedTools").unwrap();
    assert_eq!(args[denied + 1], CLAUDE_FILE_TOOLS);
    assert!(CLAUDE_FILE_TOOLS.contains("Write") && CLAUDE_FILE_TOOLS.contains("Edit"));
    // The note added to the system prompt is one plain line: it travels on a command line.
    let note = &args[args
        .iter()
        .position(|a| a == "--append-system-prompt")
        .unwrap()
        + 1];
    assert!(
        !note.contains(['\n', '"', '%', '&', '|', '<', '>', '^']),
        "{note}"
    );
    assert!(!args.iter().any(|a| a.starts_with("--resume")));
}

#[test]
fn a_thread_resumes_the_clis_conversation_by_id_and_an_odd_id_is_ignored() {
    let args = claude_args("c.json", Some("3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f"));
    assert!(args.contains(&"--resume=3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f".to_owned()));
    assert!(
        !claude_args("c.json", Some("x y; del *"))
            .iter()
            .any(|a| a.starts_with("--resume"))
    );
    assert_eq!(plain_session(" ses_abc-1 "), Some("ses_abc-1"));
    assert_eq!(
        plain_session("--help"),
        None,
        "an id is never read as an option"
    );
    assert_eq!(plain_session(""), None);
    let open = opencode_args(Some("ses_abc123"));
    assert_eq!(open, ["run", "--format", "json", "--session", "ses_abc123"]);
    assert_eq!(opencode_args(Some("bad id")), ["run", "--format", "json"]);
    assert_eq!(opencode_args(None), ["run", "--format", "json"]);
}

#[test]
fn opencode_gets_the_mcp_server_and_asks_for_everything_but_reading_and_the_vault_tools() {
    let server = server_for(
        Path::new("C:\\Apps\\KastenFlow.exe"),
        Path::new("C:\\Notes"),
    );
    let config = opencode_config(&server);
    assert_eq!(config["mcp"]["kasten"]["type"], "local");
    assert_eq!(
        config["mcp"]["kasten"]["command"],
        serde_json::json!(["C:\\Apps\\KastenFlow.exe", "--mcp", "--vault", "C:\\Notes"])
    );
    assert_eq!(config["permission"], opencode_permission());
    let rules = opencode_permission();
    assert_eq!(rules["*"], "ask");
    assert_eq!(rules["kasten_*"], "allow");
    assert_eq!(rules["read"], "allow");
    assert!(
        rules.get("bash").is_none() && rules.get("edit").is_none(),
        "they fall to the ask rule"
    );
    let env = opencode_env(&server);
    let names: Vec<&str> = env.iter().map(|(k, _)| k.as_str()).collect();
    assert_eq!(
        names,
        [
            "OPENCODE_CONFIG_CONTENT",
            "OPENCODE_PERMISSION",
            "OPENCODE_DISABLE_AUTOUPDATE",
            "OPENCODE_DISABLE_PROJECT_CONFIG"
        ]
    );
    // The vault may come from someone else: its `opencode.json` and `.opencode/` are not read.
    let project = env
        .iter()
        .find(|(k, _)| k == "OPENCODE_DISABLE_PROJECT_CONFIG")
        .unwrap();
    assert_eq!(project.1, "true");
    let inline: Value = serde_json::from_str(&env[0].1).unwrap();
    assert_eq!(inline["mcp"]["kasten"]["enabled"], true);
    assert!(
        !env.iter().any(|(_, v)| v.to_lowercase().contains("key")),
        "no secret travels"
    );
}

#[test]
fn the_mcp_config_is_written_to_the_cache_and_never_into_the_vault() {
    let server = server_for(
        Path::new("C:\\Apps\\KastenFlow.exe"),
        Path::new("C:\\Notes"),
    );
    let cache = dir("cache");
    let vault = dir("vault");
    std::fs::create_dir_all(&vault).unwrap();
    let path = write_claude_config(&cache, &vault, "chat-abc/../x", &server).unwrap();
    assert!(path.starts_with(&cache));
    assert_eq!(
        path.file_name().unwrap(),
        "claude-code-chat-abc____x.mcp.json"
    );
    let written: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(written, claude_config(&server));
    assert_eq!(
        written["mcpServers"]["kasten"]["args"],
        serde_json::json!(["--mcp", "--vault", "C:\\Notes"])
    );
    // A cache folder inside the vault is refused.
    let inside = vault.join(".agents");
    let err = write_claude_config(&inside, &vault, "c", &server).unwrap_err();
    assert!(err.contains("inside the vault"), "{err}");
    assert!(!inside.join("claude-code-c.mcp.json").exists());
}

#[test]
fn a_windows_extended_path_is_written_plainly() {
    assert_eq!(
        plain(Path::new(r"\\?\C:\Users\a\Notes")),
        r"C:\Users\a\Notes"
    );
    assert_eq!(plain(Path::new(r"\\?\UNC\server\share")), r"\\server\share");
    assert_eq!(plain(Path::new("/home/a")), "/home/a");
}

#[test]
fn a_thread_keeps_the_clis_conversation_for_its_own_agent_only() {
    let folder = dir("sessions");
    std::fs::create_dir_all(&folder).unwrap();
    let file = folder.join("agent-sessions.json");
    // A previous run's file would make the test depend on it.
    if file.exists() {
        std::fs::write(&file, "{}").unwrap();
    }
    let sessions = Sessions::default();
    sessions.open(&folder);
    assert_eq!(sessions.get("chat-1", Agent::ClaudeCode), None);
    sessions.set("chat-1", Agent::ClaudeCode, "sess-a");
    assert_eq!(
        sessions.get("chat-1", Agent::ClaudeCode).as_deref(),
        Some("sess-a")
    );
    assert_eq!(
        sessions.get("chat-1", Agent::OpenCode),
        None,
        "another agent starts its own"
    );
    // Read again from the file, as after a restart.
    let again = Sessions::default();
    again.open(&folder);
    assert_eq!(
        again.get("chat-1", Agent::ClaudeCode).as_deref(),
        Some("sess-a")
    );
    again.set("chat-1", Agent::OpenCode, "ses_b");
    assert_eq!(again.get("chat-1", Agent::ClaudeCode), None);
}

#[test]
fn the_agents_own_tools_are_told_in_words() {
    use serde_json::json;
    assert_eq!(
        tools::describe("Bash", &json!({ "command": "npm test" })),
        "Ran npm test"
    );
    assert_eq!(
        tools::describe("read", &json!({ "filePath": "a.md" })),
        "Read a.md"
    );
    assert_eq!(
        tools::describe("Grep", &json!({ "pattern": "todo" })),
        "Searched for todo"
    );
    assert_eq!(tools::describe("some_tool", &json!({})), "Used some tool");
    assert_eq!(
        tools::question("Claude Code", "Bash"),
        "Allow Claude Code to run a command?"
    );
    assert_eq!(
        tools::detail("Bash", &json!({ "command": "ls -la" })).as_deref(),
        Some("ls -la")
    );
}

#[test]
fn the_cli_is_asked_its_version_and_whether_it_is_signed_in() {
    assert_eq!(
        version_of("\n2.1.211 (Claude Code)\n"),
        Some("2.1.211 (Claude Code)".to_owned())
    );
    assert_eq!(version_of("  \n"), None);
    assert_eq!(
        signed_in_from(Some(0), "{\"loggedIn\": true, \"email\": \"a@b\"}"),
        Some(true)
    );
    assert_eq!(
        signed_in_from(Some(0), "{\"loggedIn\": false}"),
        Some(false)
    );
    assert_eq!(signed_in_from(Some(1), "Not logged in"), Some(false));
    assert_eq!(signed_in_from(Some(0), "0 credentials"), Some(false));
    assert_eq!(signed_in_from(Some(2), "unknown command"), None);
    assert_eq!(signed_in_from(Some(0), ""), None);
}

#[test]
fn the_names_a_thread_picks_an_agent_by_are_reserved_and_round_trip() {
    for agent in Agent::ALL {
        assert_eq!(Agent::of_provider(agent.provider_name()), Some(agent));
        assert_eq!(Agent::of_id(agent.id()), Some(agent));
        assert!(!agent.install_hint().is_empty() && !agent.sign_in_hint().is_empty());
    }
    assert_eq!(Agent::of_provider("Anthropic"), None);
    assert_eq!(
        Agent::ClaudeCode.strip_tool("mcp__kasten__append"),
        "append"
    );
    assert_eq!(Agent::OpenCode.strip_tool("kasten_append"), "append");
    assert!(
        Agent::ClaudeCode.is_kasten_tool("mcp__kasten__append")
            && !Agent::ClaudeCode.is_kasten_tool("Bash")
    );
}
