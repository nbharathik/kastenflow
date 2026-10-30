//! Agent modes under stress: private folders reached by odd paths while the
//! vault is autonomous, a stale config copy, restoring a checkpoint after a
//! person changed the mode, a damaged checkpoint list, and two engines on one
//! vault writing as autonomous sessions at once.

use crate::common;

use std::fs;

use common::{NOW, dev_vault};
use kasten_core::agent::{AgentOp, Session};
use kasten_core::config_keys::{AgentMode, AgentsConfig};
use kasten_core::history::Actor;
use kasten_core::policy::AgentPolicy;
use kasten_core::{Config, Instant, Kasten, Outcome};

const WELCOME: &str = "library/welcome-to-kasten.md";
const CONFIG: &str = ".kasten/config.yaml";

fn autonomous() -> (common::TempVault, Kasten, Session) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    let mut config = k.config();
    config.agents = Some(AgentsConfig {
        mode: Some(AgentMode::Autonomous),
        ..AgentsConfig::default()
    });
    k.set_config(config).unwrap();
    let s = Session::start("claude-code", NOW);
    (t, k, s)
}

fn append(path: &str) -> AgentOp {
    AgentOp::Append {
        path: path.into(),
        markdown: "x".into(),
        heading: None,
    }
}

#[test]
fn odd_spellings_of_private_folders_are_refused_in_autonomous_mode() {
    let (t, k, s) = autonomous();
    let config_before = fs::read(t.vault.root().join(CONFIG)).unwrap();
    for path in [
        ".kasten/config.yaml",
        ".KASTEN/config.yaml",
        ".Kasten\\config.yaml",
        "library/../.kasten/config.yaml",
        "library\\..\\.kasten\\config.yaml",
        "./.kasten/config.yaml",
        ".git/config",
        ".GIT/config",
        "library/.git/config",
        "library\\.git\\config",
        "C:\\Windows\\win.ini",
        "/etc/passwd",
        "..\\outside.md",
        "templates/page.md",
        "TEMPLATES/page.md",
        ".trash/x.md",
    ] {
        assert!(
            k.agent_run(&s, &append(path), NOW).is_err(),
            "{path} was not refused"
        );
        let trash = AgentOp::Trash {
            path: path.into(),
            reason: None,
        };
        assert!(
            k.agent_run(&s, &trash, NOW).is_err(),
            "trash of {path} was not refused"
        );
    }
    assert_eq!(
        fs::read(t.vault.root().join(CONFIG)).unwrap(),
        config_before,
        "the config is untouched"
    );
    assert!(k.proposals().unwrap().is_empty());
}

#[test]
fn a_project_name_cannot_aim_a_write_at_a_private_folder() {
    let (t, k, s) = autonomous();
    for project in [
        ".kasten",
        ".git",
        "../.git",
        "..",
        ".",
        "a/../../x",
        "a\\..\\..\\x",
    ] {
        let make = AgentOp::CreateNote {
            note_type: "page".into(),
            title: "Aimed".into(),
            body: String::new(),
            project: Some(project.into()),
            tags: vec![],
            props: Default::default(),
            parent: None,
            template: None,
        };
        let moved = AgentOp::Move {
            path: WELCOME.into(),
            project: Some(project.into()),
        };
        let board = AgentOp::CreateBoard {
            title: "Aimed".into(),
            project: Some(project.into()),
        };
        // A project name is made into a folder name (".kasten" becomes
        // "kasten"), so an op may run, but only ever inside the vault's own
        // folders, never in a private one.
        for op in [make, moved, board] {
            let name = op.name();
            if let Ok(Outcome::Done { result }) = k.agent_run(&s, &op, NOW) {
                let text = result.to_string();
                assert!(
                    !text.contains("\"path\":\".")
                        && !text.contains("..")
                        && !text.contains(".git")
                        && !text.contains(".kasten")
                        && !text.contains('\\'),
                    "{name} into “{project}” went somewhere private: {text}"
                );
            }
        }
    }
    assert!(!t.vault.root().join(".git/pages").exists());
    assert!(!t.vault.root().join(".kasten/pages").exists());
    assert!(!t.vault.root().join(".kasten/projects").exists());
    assert!(!t.vault.root().join(".git/projects").exists());
    assert!(!t.vault.root().join("projects/.git").exists());
    assert!(!t.vault.root().join("projects/.kasten").exists());
}

#[test]
fn setting_the_mode_does_not_write_back_an_older_copy_of_the_config() {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    // Another program switches a plugin on; this engine has not looked yet.
    let mut theirs = Config::load(t.vault.root()).unwrap();
    theirs.set_plugin_enabled("latex", true);
    theirs.guardrails.max_trash_per_session = 2;
    theirs.save(t.vault.root()).unwrap();
    let policy = AgentPolicy {
        mode: AgentMode::Review,
        ..AgentPolicy::default()
    };
    k.set_agent_policy(&Actor::Human, policy, NOW).unwrap();
    let on_disk = Config::load(t.vault.root()).unwrap();
    assert!(
        on_disk.plugin_enabled("latex"),
        "their plugin change survived"
    );
    assert_eq!(on_disk.guardrails.max_trash_per_session, 2);
    assert_eq!(on_disk.agents.unwrap().mode, Some(AgentMode::Review));
    // And this engine now holds the merged file.
    assert!(k.config().plugin_enabled("latex"));
    assert_eq!(k.agent_mode(None, NOW), AgentMode::Review);
}

#[test]
fn restoring_a_checkpoint_does_not_bring_back_an_older_mode() {
    let (t, k, s) = autonomous();
    k.agent_run(&s, &append(WELCOME), NOW).unwrap();
    let mark = k.list_checkpoints().unwrap().remove(0);
    // The person turns the mode down after the session ran.
    let down = AgentPolicy {
        mode: AgentMode::Review,
        ..AgentPolicy::default()
    };
    k.set_agent_policy(&Actor::Human, down, NOW).unwrap();
    let text = fs::read_to_string(t.vault.root().join(CONFIG)).unwrap();
    k.restore_to_checkpoint(&mark.id, NOW).unwrap();
    assert_eq!(
        fs::read_to_string(t.vault.root().join(CONFIG)).unwrap(),
        text,
        "the config is as the person left it"
    );
    assert_eq!(k.agent_mode(None, NOW), AgentMode::Review);
    let held = k.agent_run(&s, &append(WELCOME), NOW).unwrap();
    assert!(matches!(held, Outcome::PendingReview { .. }), "{held:?}");
}

#[test]
fn a_damaged_checkpoint_list_does_not_stop_work_or_the_list_growing_again() {
    let (t, k, s) = autonomous();
    let list = t.vault.root().join(".kasten/cache/checkpoints.json");
    fs::create_dir_all(list.parent().unwrap()).unwrap();
    fs::write(&list, "{ half a file").unwrap();
    k.agent_run(&s, &append(WELCOME), NOW).unwrap();
    let marks = k.list_checkpoints().unwrap();
    assert_eq!(marks.len(), 1);
    // The new list is valid JSON again and survives a second engine.
    let other = Kasten::open(t.vault.root()).unwrap();
    assert_eq!(other.list_checkpoints().unwrap(), marks);
    // An empty file and a list of the wrong shape are only a cache too.
    for bad in ["", "[]", "null", "{\"a\": 1}", "[1, 2]"] {
        fs::write(&list, bad).unwrap();
        assert!(k.list_checkpoints().unwrap().is_empty(), "{bad}");
    }
}

#[test]
fn a_checkpoint_of_an_unknown_commit_fails_cleanly() {
    let (t, k, _s) = autonomous();
    let list = t.vault.root().join(".kasten/cache/checkpoints.json");
    fs::create_dir_all(list.parent().unwrap()).unwrap();
    fs::write(
        &list,
        r#"[{"id":"c1","session":"s","head":"0000000000000000000000000000000000000000","time":1,"label":"x"}]"#,
    )
    .unwrap();
    let before = fs::read(t.vault.root().join(WELCOME)).unwrap();
    assert!(k.restore_to_checkpoint("c1", NOW).is_err());
    assert_eq!(fs::read(t.vault.root().join(WELCOME)).unwrap(), before);
}

#[test]
fn two_engines_on_one_vault_each_get_their_sessions_checkpoint() {
    let (t, k, _s) = autonomous();
    let root = t.vault.root().to_path_buf();
    let other = Kasten::open(&root).unwrap();
    let mine = Session::start(
        "one",
        Instant {
            millis: NOW.millis + 1,
        },
    );
    let theirs = Session::start(
        "two",
        Instant {
            millis: NOW.millis + 2,
        },
    );
    std::thread::scope(|scope| {
        scope.spawn(|| {
            for n in 0..5 {
                let op = AgentOp::Capture {
                    markdown: format!("One {n}"),
                    tags: vec![],
                };
                k.agent_run(&mine, &op, NOW).unwrap();
            }
        });
        scope.spawn(|| {
            for n in 0..5 {
                let op = AgentOp::Capture {
                    markdown: format!("Two {n}"),
                    tags: vec![],
                };
                other.agent_run(&theirs, &op, NOW).unwrap();
            }
        });
    });
    let marks = k.list_checkpoints().unwrap();
    assert!(marks.iter().any(|m| m.session == mine.id), "{marks:?}");
    assert!(marks.iter().any(|m| m.session == theirs.id), "{marks:?}");
    assert!(
        marks.len() >= 2 && marks.len() <= 4,
        "one per session (a lost race may make a second): {marks:?}"
    );
}
