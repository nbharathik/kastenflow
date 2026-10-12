//! The `kasten` binary end to end, on private vaults, and `kastenflow`,
//! the same program under the new name.

use std::path::{Path, PathBuf};
use std::process::Command;

fn run(binary: &str, args: &[&str]) -> std::process::Output {
    Command::new(binary)
        .args(args)
        .env_remove("KASTEN_VAULT")
        .output()
        .unwrap_or_else(|e| panic!("failed to run {binary}: {e}"))
}

fn kasten(args: &[&str]) -> std::process::Output {
    run(env!("CARGO_BIN_EXE_kasten"), args)
}

fn kastenflow(args: &[&str]) -> std::process::Output {
    run(env!("CARGO_BIN_EXE_kastenflow"), args)
}

fn text(out: &std::process::Output) -> String {
    format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    )
}

struct Dir(PathBuf);

impl Drop for Dir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn temp(name: &str) -> Dir {
    Dir(std::env::temp_dir().join(format!(
        "kasten-cli-{name}-{}",
        kasten_core::ulid_at(kasten_core::Instant::now().millis)
    )))
}

fn s(p: &Path) -> &str {
    p.to_str().unwrap()
}

#[test]
fn version_flag_prints_core_version() {
    let out = kasten(&["--version"]);
    assert!(out.status.success());
    assert_eq!(
        String::from_utf8(out.stdout).unwrap().trim(),
        format!("kasten {}", kasten_core::VERSION)
    );
}

#[test]
fn help_lists_every_m1_command() {
    let out = kasten(&["--help"]);
    assert!(out.status.success());
    let stdout = String::from_utf8(out.stdout).unwrap();
    for cmd in ["init", "capture", "search", "verify", "history", "restore"] {
        assert!(stdout.contains(cmd), "help is missing {cmd}:\n{stdout}");
    }
}

#[test]
fn kastenflow_is_the_same_program_under_the_new_name() {
    let out = kastenflow(&["--version"]);
    assert!(out.status.success());
    assert_eq!(
        String::from_utf8(out.stdout).unwrap().trim(),
        format!("kastenflow {}", kasten_core::VERSION)
    );
    for (help, typed) in [
        (kastenflow(&["--help"]), "kastenflow"),
        (kasten(&["help"]), "kasten"),
    ] {
        let said = text(&help);
        assert!(help.status.success(), "{said}");
        assert!(
            said.contains(&format!("Usage: {typed} <command> [options]"))
                && said.contains(&format!("{typed} capture TEXT")),
            "{said}"
        );
    }
    let out = kastenflow(&["frobnicate"]);
    assert_eq!(out.status.code(), Some(2));
    assert!(
        text(&out).starts_with("kastenflow: unknown command"),
        "{}",
        text(&out)
    );

    let dir = temp("alias");
    let vault = s(&dir.0);
    let out = kastenflow(&["init", vault, "--name", "Alias vault"]);
    assert!(out.status.success(), "{}", text(&out));
    let out = kastenflow(&["capture", "--vault", vault, "Water", "the", "plants"]);
    assert!(
        text(&out).contains("inbox/water-the-plants.md"),
        "{}",
        text(&out)
    );
    let out = kasten(&["search", "--vault", vault, "plants", "--json"]);
    let hits: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(hits[0]["path"], "inbox/water-the-plants.md");
    let out = kastenflow(&["restore", "--vault", vault, "only-one"]);
    assert_eq!(out.status.code(), Some(1));
    assert!(
        text(&out).contains("Usage: kastenflow restore NOTE COMMIT"),
        "{}",
        text(&out)
    );
}

#[test]
fn unknown_command_is_rejected() {
    assert_eq!(kasten(&["frobnicate"]).status.code(), Some(2));
    assert_eq!(kasten(&["search", "--limit"]).status.code(), Some(2));
}

#[test]
fn works_a_vault_from_init_to_restore() {
    let dir = temp("flow");
    let vault = s(&dir.0);
    let out = kasten(&["init", vault, "--name", "CLI vault"]);
    assert!(out.status.success(), "{}", text(&out));

    let out = kasten(&[
        "capture", "--vault", vault, "--tags", "errand", "Renew", "the", "passport",
    ]);
    assert!(out.status.success(), "{}", text(&out));
    assert!(
        text(&out).contains("inbox/renew-the-passport.md"),
        "{}",
        text(&out)
    );

    let out = kasten(&["search", "--vault", vault, "passport", "--json"]);
    let hits: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(hits[0]["path"], "inbox/renew-the-passport.md");
    let out = kasten(&["search", "--vault", vault, "tag:errand"]);
    assert!(text(&out).contains("Renew the passport"), "{}", text(&out));

    let out = kasten(&["history", "--vault", vault, "--json"]);
    let log: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(log[0]["summary"], "capture: Renew the passport");
    assert_eq!(log[1]["summary"], "init: CLI vault");
    let first = log[1]["id"].as_str().unwrap().to_owned();

    let out = kasten(&["verify", "--vault", vault]);
    assert!(out.status.success(), "{}", text(&out));

    let out = kasten(&["restore", "--vault", vault, "--vault-wide", &first]);
    assert!(out.status.success(), "{}", text(&out));
    assert!(!dir.0.join("inbox/renew-the-passport.md").exists());
    let out = kasten(&["history", "--vault", vault, "--limit", "1"]);
    assert!(text(&out).contains("restore: vault to"), "{}", text(&out));
}

#[test]
fn reads_the_vault_from_the_environment_and_reports_problems() {
    let dir = temp("env");
    assert!(kasten(&["init", s(&dir.0)]).status.success());
    std::fs::write(dir.0.join("inbox/broken.md"), "---\ntitle: [oops\n---\n").unwrap();
    let out = Command::new(env!("CARGO_BIN_EXE_kasten"))
        .args(["verify"])
        .env("KASTEN_VAULT", &dir.0)
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(1), "{}", text(&out));
    assert!(text(&out).contains("frontmatter"), "{}", text(&out));
}

#[test]
fn reviews_agent_proposals_and_undoes_sessions() {
    use kasten_core::agent::{AgentOp, Session};
    use kasten_core::{Kasten, Outcome};
    let dir = temp("agents");
    std::fs::create_dir_all(dir.0.join("library")).unwrap();
    let out = kasten(&["start-history", "--vault", s(&dir.0)]);
    assert!(out.status.success(), "{}", text(&out));
    assert!(text(&kasten(&["sessions", "--vault", s(&dir.0)])).contains("No agent sessions"));

    // An agent works in the vault: one capture and one full rewrite.
    let (session, proposal) = {
        let k = Kasten::open(&dir.0).unwrap();
        let s = Session::start("claude-code", kasten_core::Instant::now());
        let captured = AgentOp::Capture {
            markdown: "Agent idea".into(),
            tags: vec![],
        };
        k.agent_run(&s, &captured, kasten_core::Instant::now())
            .unwrap();
        // Escapes that would move the cursor up and erase the diff's lines.
        let rewrite = AgentOp::Edit {
            path: "inbox/agent-idea.md".into(),
            body: "Rewritten\u{1b}[1A\u{1b}[2K\n".into(),
            base: "Agent idea\n".into(),
            reason: None,
        };
        let Outcome::PendingReview { proposal, .. } = k
            .agent_run(&s, &rewrite, kasten_core::Instant::now())
            .unwrap()
        else {
            panic!()
        };
        (s.id, proposal)
    };
    let listed = text(&kasten(&["proposals", "--vault", s(&dir.0), "--diff"]));
    assert!(
        listed.contains(&proposal) && listed.contains("+Rewritten\\u001b[1A"),
        "{listed}"
    );
    assert!(!listed.contains('\u{1b}'), "an escape reached the screen");
    let out = kasten(&["reject", &proposal, "--vault", s(&dir.0), "--by", "Ada"]);
    assert!(out.status.success(), "{}", text(&out));
    assert!(text(&kasten(&["proposals", "--vault", s(&dir.0)])).contains("Nothing waiting"));

    let sessions = text(&kasten(&["sessions", "--vault", s(&dir.0)]));
    assert!(
        sessions.contains(&session) && sessions.contains("claude-code"),
        "{sessions}"
    );
    let out = kasten(&["undo-session", &session, "--vault", s(&dir.0)]);
    assert!(out.status.success(), "{}", text(&out));
    assert!(!dir.0.join("inbox/agent-idea.md").exists());
    assert!(text(&kasten(&["sessions", "--vault", s(&dir.0)])).contains("(undone)"));
    let out = kasten(&["trust", &session, "--vault", s(&dir.0), "--minutes", "5"]);
    assert!(
        text(&out).contains("trusted for 5 minutes"),
        "{}",
        text(&out)
    );
}

#[test]
fn imports_a_folder_of_notes_and_undoes_it() {
    let dir = temp("import");
    let vault = dir.0.join("vault");
    assert!(kasten(&["init", s(&vault)]).status.success());
    let obsidian = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/import/obsidian");

    let dry = kasten(&[
        "import",
        s(&obsidian),
        "--project",
        "Field notes",
        "--dry-run",
        "--vault",
        s(&vault),
    ]);
    let said = text(&dry);
    assert!(dry.status.success(), "{said}");
    assert!(said.contains("Would import an Obsidian vault into “Field notes”: 8 notes, 2 journal days, 1 board, 3 files"), "{said}");
    assert!(
        said.contains("`note-type`"),
        "the warnings are listed: {said}"
    );
    assert!(!vault.join("projects/field-notes").exists());

    let run = kasten(&[
        "import",
        s(&obsidian),
        "--project",
        "Field notes",
        "--json",
        "--vault",
        s(&vault),
    ]);
    assert!(run.status.success(), "{}", text(&run));
    let done: serde_json::Value = serde_json::from_slice(&run.stdout).unwrap();
    assert_eq!(done["summary"]["notes"], 8);
    let commit = done["commit"].as_str().unwrap().to_owned();
    assert!(vault.join("projects/field-notes/pages/welcome.md").exists());

    let undo = kasten(&["undo", &commit, "--vault", s(&vault)]);
    assert!(undo.status.success(), "{}", text(&undo));
    assert!(
        text(&undo).contains("Undid “import: Obsidian vault “Field notes”"),
        "{}",
        text(&undo)
    );
    assert!(!vault.join("projects/field-notes").exists());

    let missing = kasten(&["import", s(&dir.0.join("nowhere")), "--vault", s(&vault)]);
    assert!(!missing.status.success());
    assert!(text(&missing).contains("No folder"), "{}", text(&missing));
}

#[test]
fn verify_reaches_the_backup_remote_only_when_asked() {
    let dir = temp("remote");
    let vault = s(&dir.0);
    assert!(kasten(&["init", vault]).status.success());
    let missing = dir.0.with_extension("missing.git");
    {
        let k = kasten_core::Kasten::open(&dir.0).unwrap();
        let mut config = k.config();
        config.git.remote = Some(missing.to_string_lossy().into_owned());
        k.set_config(config).unwrap();
    }

    let out = kasten(&["verify", "--vault", vault]);
    assert!(out.status.success(), "{}", text(&out));
    assert!(text(&out).contains("add --remote"), "{}", text(&out));

    let out = kasten(&["verify", "--vault", vault, "--remote"]);
    assert_eq!(out.status.code(), Some(1), "{}", text(&out));
    assert!(text(&out).contains("remote"), "{}", text(&out));
    assert!(!missing.exists());
}
