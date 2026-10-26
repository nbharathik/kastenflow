//! How the server says it is doing: the `server_status` tool, `kasten-mcp
//! --check`, and `kasten-mcp --setup`, which prints the lines that connect an
//! agent to the vault for this program.

mod common;

use std::process::{Command, Output};

use common::{Client, TempDir, vault};
use kasten_core::agent::Session;
use kasten_core::{Instant, Kasten};
use kasten_mcp::tools::call;
use serde_json::{Value, json};

fn mcp(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_kasten-mcp"))
        .args(args)
        .output()
        .unwrap()
}

fn stdout(out: &Output) -> String {
    String::from_utf8_lossy(&out.stdout).into_owned()
}

fn stderr(out: &Output) -> String {
    String::from_utf8_lossy(&out.stderr).into_owned()
}

/// A vault that keeps no history.
fn without_history() -> TempDir {
    let dir = std::env::temp_dir().join(format!(
        "kasten-mcp-status-{}",
        kasten_core::ulid_at(Instant::now().millis)
    ));
    std::fs::create_dir_all(dir.join("library")).unwrap();
    TempDir(dir)
}

fn plain(path: &std::path::Path) -> String {
    path.display()
        .to_string()
        .trim_start_matches(r"\\?\")
        .to_owned()
}

#[test]
fn the_status_tool_says_the_version_the_vault_the_history_the_session_and_whether_slides_can_be_drawn()
 {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    let s = Session::start("kasten-chat", Instant::now());
    let status = call(&k, &s, "server_status", Value::Null).unwrap();
    assert_eq!(status["version"], json!(kasten_core::VERSION));
    assert_eq!(
        status["vault"],
        json!(plain(&std::fs::canonicalize(&v.0).unwrap()))
    );
    assert_eq!(status["history"], json!(true));
    assert_eq!(status["session"]["id"], json!(s.id));
    assert_eq!(status["session"]["client"], json!("kasten-chat"));
    let render = &status["render"];
    assert_eq!(render["built"], json!(cfg!(feature = "render")), "{render}");
    assert!(render["message"].as_str().is_some_and(|m| !m.is_empty()));
    if cfg!(feature = "render") {
        // Whatever this machine has, the status says which: a path, or the reason there is none.
        assert!(
            render["browser"].is_string() != render["browser_problem"].is_string(),
            "{render}"
        );
        assert!(
            render["page"].is_boolean() && render["sandbox"].is_string(),
            "{render}"
        );
    } else {
        assert!(
            render["message"]
                .as_str()
                .unwrap()
                .contains("not part of this program")
        );
        assert_eq!(status["problems"], json!([]), "not drawing is no problem");
    }
    // Looking at the status changes nothing.
    assert!(k.dirty().unwrap().is_empty());
}

/// A little more than the 100 ms the engine waits between looks at the config file.
const PAUSE: std::time::Duration = std::time::Duration::from_millis(200);

fn write_config(root: &std::path::Path, text: &str) {
    std::fs::create_dir_all(root.join(".kasten")).unwrap();
    std::fs::write(root.join(".kasten/config.yaml"), text).unwrap();
}

#[test]
fn the_status_tool_says_the_limits_the_mode_and_the_plugins() {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    let s = Session::start("kasten-chat", Instant::now());
    let status = call(&k, &s, "server_status", Value::Null).unwrap();
    assert_eq!(status["limits"]["max_trash_per_session"], json!(5));
    assert_eq!(status["limits"]["max_board_nodes_removed"], json!(10));
    assert_eq!(status["limits"]["max_write_bytes"], json!(204_800));
    assert_eq!(status["mode"], json!("balanced"));
    assert_eq!(status["plugins"], json!({"diagrams": true, "latex": false}));
}

#[test]
fn a_change_to_the_config_on_disk_shows_without_a_restart() {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    let s = Session::start("kasten-chat", Instant::now());
    let before = call(&k, &s, "server_status", Value::Null).unwrap();
    assert_eq!(before["limits"]["max_trash_per_session"], json!(5));

    // The app saves a new limit, a plugin and a mode while the server runs.
    std::thread::sleep(PAUSE);
    write_config(
        &v.0,
        "name: Dev vault\nguardrails:\n  max_trash_per_session: 2\nplugins:\n  latex: true\nagents:\n  mode: review\n",
    );
    std::thread::sleep(PAUSE);
    let after = call(&k, &s, "server_status", Value::Null).unwrap();
    assert_eq!(
        after["limits"]["max_trash_per_session"],
        json!(2),
        "{after}"
    );
    assert_eq!(after["plugins"]["latex"], json!(true), "{after}");
    assert_eq!(after["mode"], json!("review"), "{after}");

    // A file that does not parse keeps what was in force and says so.
    std::thread::sleep(PAUSE);
    write_config(&v.0, "guardrails: [broken\n");
    std::thread::sleep(PAUSE);
    let broken = call(&k, &s, "server_status", Value::Null).unwrap();
    assert_eq!(broken["limits"]["max_trash_per_session"], json!(2));
    assert!(
        broken["problems"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p.as_str().unwrap().contains("config.yaml")),
        "{broken}"
    );
}

#[test]
fn over_mcp_a_running_server_sees_a_limit_changed_on_disk() {
    let v = vault();
    let mut c = Client::start(&v.0, "claude-code");
    let before = c.call("server_status", json!({})).unwrap();
    assert_eq!(before["limits"]["max_trash_per_session"], json!(5));
    std::thread::sleep(PAUSE);
    write_config(
        &v.0,
        "name: Dev vault\nguardrails:\n  max_trash_per_session: 3\n",
    );
    std::thread::sleep(PAUSE);
    let after = c.call("server_status", json!({})).unwrap();
    assert_eq!(
        after["limits"]["max_trash_per_session"],
        json!(3),
        "{after}"
    );
}

#[test]
fn a_vault_without_history_is_a_problem_the_status_names() {
    let dir = without_history();
    let k = Kasten::open(&dir.0).unwrap();
    let s = Session::start("kasten-chat", Instant::now());
    let status = call(&k, &s, "server_status", Value::Null).unwrap();
    assert_eq!(status["history"], json!(false));
    let problems = status["problems"].as_array().unwrap();
    assert!(
        problems
            .iter()
            .any(|p| p.as_str().unwrap().contains("keeps no history")),
        "{problems:?}"
    );
}

#[test]
fn over_mcp_a_client_has_no_session_until_it_changes_something() {
    let v = vault();
    let mut c = Client::start(&v.0, "claude-code");
    assert!(c.tools().contains(&"server_status".to_owned()));
    let before = c.call("server_status", json!({})).unwrap();
    assert_eq!(before["session"], Value::Null, "{before}");
    assert_eq!(before["history"], json!(true));
    let made = c
        .call("capture", json!({"markdown": "A thought for the status"}))
        .unwrap();
    let after = c.call("server_status", json!({})).unwrap();
    assert_eq!(after["session"]["id"], made["session"], "{after}");
    assert_eq!(after["session"]["client"], json!("claude-code"));
}

#[test]
fn check_prints_the_status_and_exits_with_one_when_something_is_wrong() {
    let v = vault();
    let out = mcp(&["--vault", v.0.to_str().unwrap(), "--check"]);
    let status: Value = serde_json::from_str(&stdout(&out)).unwrap();
    assert_eq!(status["version"], json!(kasten_core::VERSION));
    assert_eq!(status["history"], json!(true));
    let problems = status["problems"].as_array().unwrap();
    // Exit 1 exactly when there is a problem to tell: here only drawing slides can be one.
    assert_eq!(
        out.status.code(),
        Some(i32::from(!problems.is_empty())),
        "{status}"
    );
    for problem in problems {
        assert!(
            stderr(&out).contains(problem.as_str().unwrap()),
            "{problem}"
        );
    }
    if !cfg!(feature = "render") {
        assert!(
            problems.is_empty(),
            "a program made without drawing is not at fault: {problems:?}"
        );
    }
}

#[test]
fn check_on_a_vault_without_history_says_so_and_exits_with_one() {
    let dir = without_history();
    let out = mcp(&["--vault", dir.0.to_str().unwrap(), "--check"]);
    assert_eq!(out.status.code(), Some(1), "{}", stderr(&out));
    let status: Value = serde_json::from_str(&stdout(&out)).unwrap();
    assert_eq!(status["history"], json!(false));
    assert!(
        stderr(&out).contains("keeps no history"),
        "{}",
        stderr(&out)
    );
}

#[test]
fn setup_prints_the_lines_for_this_program_and_the_vault_as_the_file_system_spells_it() {
    let v = vault();
    let vault_path = v.0.to_str().unwrap();
    let canonical = plain(&std::fs::canonicalize(&v.0).unwrap());

    let code = mcp(&["--vault", vault_path, "--setup", "claude-code"]);
    assert!(code.status.success(), "{}", stderr(&code));
    let line = stdout(&code);
    assert!(
        line.starts_with("claude mcp add --scope user kasten -- ")
            && line.contains("kasten-mcp")
            && line
                .trim_end()
                .ends_with(&format!("--vault \"{canonical}\"")),
        "{line}"
    );
    assert!(
        !line.contains("--mcp"),
        "the command-line program is not started with --mcp"
    );

    let desktop = mcp(&["--vault", vault_path, "--setup", "claude-desktop"]);
    let config: Value = serde_json::from_str(&stdout(&desktop)).unwrap();
    let entry = &config["mcpServers"]["kasten"];
    assert!(
        entry["command"].as_str().unwrap().contains("kasten-mcp"),
        "{config}"
    );
    assert_eq!(entry["args"], json!(["--vault", canonical]));

    // Codex: a TOML block for ~/.codex/config.toml, with this program and the vault.
    let codex = mcp(&["--vault", vault_path, "--setup", "codex"]);
    assert!(codex.status.success(), "{}", stderr(&codex));
    let toml = stdout(&codex);
    let escaped = |text: &str| text.replace('\\', "\\\\");
    assert!(
        toml.contains("~/.codex/config.toml")
            && toml.contains("[mcp_servers.kasten]")
            && toml.contains("[mcp_servers.kasten.env]")
            && toml.contains(&format!("KASTEN_VAULT = \"{}\"", escaped(&canonical)))
            && toml.contains("kasten-mcp")
            && toml.contains("args = []"),
        "{toml}"
    );

    let http = mcp(&["--vault", vault_path, "--setup", "http"]);
    let text = stdout(&http);
    assert!(
        text.contains("--http")
            && text.contains("http://127.0.0.1:7433/mcp")
            && text.contains("mcp-token")
            && text.contains("Bearer <token>"),
        "{text}"
    );
    // Printing the setup reads nothing of the vault and starts no server.
    let k = Kasten::open(&v.0).unwrap();
    assert!(k.dirty().unwrap().is_empty());
}

#[test]
fn setup_for_something_it_does_not_know_is_refused_with_the_choices() {
    let v = vault();
    let out = mcp(&["--vault", v.0.to_str().unwrap(), "--setup", "cursor"]);
    assert_eq!(out.status.code(), Some(2));
    let said = stderr(&out);
    assert!(
        said.contains("claude-code, claude-desktop, codex or http") && stdout(&out).is_empty(),
        "{said}"
    );
    let none = mcp(&["--vault", v.0.to_str().unwrap(), "--setup"]);
    assert_eq!(none.status.code(), Some(2));
}
