//! Paths that would lead out of the vault or stand for a guarded one under
//! another spelling: links are never followed, Windows' device
//! names and trailing dots never made, and templates are templates in any
//! case.

use crate::common;

use std::fs;

use common::{NOW, dev_vault};
use kasten_core::agent::{AgentOp, Session};
use kasten_core::{Error, Kasten, slugify};
#[cfg(unix)]
use kasten_core::{history::Actor, restore_note};

fn agent() -> (common::TempVault, Kasten, Session) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k, Session::start("kasten-chat", NOW))
}

#[cfg(unix)]
#[test]
fn never_follows_a_link_out_of_the_vault() {
    use std::os::unix::fs::symlink;

    let t = dev_vault();
    let outside = t.vault.root().with_extension("outside");
    fs::create_dir_all(&outside).unwrap();
    fs::write(
        outside.join("secret.md"),
        "---\ntitle: Secret\n---\nA key\n",
    )
    .unwrap();
    let root = t.vault.root();
    symlink(outside.join("secret.md"), root.join("library/linked.md")).unwrap();
    symlink(&outside, root.join("elsewhere")).unwrap();

    for linked in ["library/linked.md", "elsewhere/secret.md"] {
        assert!(
            matches!(t.vault.read(linked), Err(Error::InvalidPath(_))),
            "{linked} was read through its link"
        );
    }
    // Every write asks for its file this way first.
    assert!(matches!(
        t.vault.file_of("elsewhere/new.md", &[".md"]),
        Err(Error::InvalidPath(_))
    ));
    let k = Kasten::open(root).unwrap();
    let saved = k.save_body(&Actor::Human, "library/linked.md", "Changed\n", "", NOW);
    assert!(saved.is_err(), "wrote through a link");
    assert_eq!(
        fs::read_to_string(outside.join("secret.md")).unwrap(),
        "---\ntitle: Secret\n---\nA key\n"
    );
    assert!(
        k.list()
            .unwrap()
            .iter()
            .all(|n| n.path != "library/linked.md" && !n.path.starts_with("elsewhere/"))
    );
    fs::remove_dir_all(&outside).unwrap();
}

#[cfg(unix)]
#[test]
fn will_not_open_a_vault_whose_own_folders_are_links() {
    use std::os::unix::fs::symlink;

    for folder in [".trash", ".kasten/cache", ".kasten/proposals", ".kasten"] {
        let t = dev_vault();
        let root = t.vault.root();
        let elsewhere = root.with_extension("elsewhere");
        fs::create_dir_all(&elsewhere).unwrap();
        let link = root.join(folder);
        if let Some(parent) = link.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let _ = fs::remove_dir_all(&link);
        symlink(&elsewhere, &link).unwrap();
        let err = Kasten::open(root).unwrap_err().to_string();
        assert!(
            err.contains(folder) && err.contains("link"),
            "{folder}: {err}"
        );
        assert_eq!(fs::read_dir(&elsewhere).unwrap().count(), 0, "{folder}");
        fs::remove_dir_all(&elsewhere).unwrap();
    }
}

#[test]
fn titles_never_make_a_name_windows_keeps_for_devices() {
    for (title, slug) in [
        ("CON", "con-1"),
        ("nul", "nul-1"),
        ("Aux", "aux-1"),
        ("PRN", "prn-1"),
        ("COM1", "com1-1"),
        ("lpt9", "lpt9-1"),
        ("COM¹", "com¹-1"),
        ("Console", "console"),
        ("COM10", "com10"),
        ("Icon", "icon"),
    ] {
        assert_eq!(slugify(title), slug, "{title}");
    }
}

#[test]
fn agents_cannot_reach_templates_by_another_spelling() {
    let (t, k, s) = agent();
    let before = fs::read_to_string(t.vault.root().join("templates/journal.md")).unwrap();
    for path in [
        "Templates/journal.md",
        "TEMPLATES/journal.md",
        "templateſ/journal.md",
    ] {
        let op = AgentOp::Append {
            path: path.into(),
            markdown: "More".into(),
            heading: None,
        };
        let err = k.agent_run(&s, &op, NOW).unwrap_err().to_string();
        assert!(err.contains("read-only for agents"), "{path}: {err}");
        let moved = AgentOp::Move {
            path: path.into(),
            project: Some("photo-organiser".into()),
        };
        assert!(k.agent_run(&s, &moved, NOW).is_err(), "{path} moved");
    }
    let after = fs::read_to_string(t.vault.root().join("templates/journal.md")).unwrap();
    assert_eq!(before, after);
}

#[test]
fn agents_cannot_write_the_settings_other_programs_read_from_a_vault() {
    // `.claude/`, `.opencode/` and `.mcp.json` can hold hooks and allow rules an agent CLI would run.
    let (t, k, s) = agent();
    for path in [
        ".claude/settings.json",
        ".opencode/command/x.md",
        ".mcp.json",
        "library/.claude/settings.json",
    ] {
        let op = AgentOp::Append {
            path: path.into(),
            markdown: "More".into(),
            heading: None,
        };
        let err = k.agent_run(&s, &op, NOW).unwrap_err().to_string();
        assert!(err.contains("read-only for agents"), "{path}: {err}");
        assert!(!t.vault.root().join(path).exists(), "{path}");
    }
}

#[cfg(windows)]
#[test]
fn windows_names_that_alias_another_are_refused() {
    let t = dev_vault();
    for bad in [
        "library/con.md",
        "library/NUL.md",
        "library/com1.backup.md",
        "templates./journal.md",
        "templates /journal.md",
        "library/con/page.md",
    ] {
        assert!(
            matches!(t.vault.read(bad), Err(Error::InvalidPath(_))),
            "{bad}"
        );
    }
}

#[test]
fn a_proposal_file_cannot_name_another_file() {
    let (t, k, s) = agent();
    let op = AgentOp::Template {
        name: "Standup".into(),
        text: "---\ntitle: Standup\n---\n## Today\n".into(),
        base: None,
        reason: None,
    };
    let kasten_core::Outcome::PendingReview { proposal: id, .. } =
        k.agent_run(&s, &op, NOW).unwrap()
    else {
        panic!("a template is always a proposal");
    };
    let root = t.vault.root();
    let victim = root.join("library/victim.json");
    fs::write(&victim, "{\"kept\": true}\n").unwrap();
    let file = root.join(format!(".kasten/proposals/{id}.json"));
    let text = fs::read_to_string(&file).unwrap();
    let forged = text.replace(
        &format!("\"id\": \"{id}\""),
        "\"id\": \"../../library/victim\"",
    );
    assert_ne!(text, forged, "the proposal's id is in its file");
    fs::write(&file, forged).unwrap();

    assert!(k.reject_proposal(&id, "me", NOW).is_err());
    assert!(k.accept_proposal(&id, "me", NOW).is_err());
    assert_eq!(fs::read_to_string(&victim).unwrap(), "{\"kept\": true}\n");
}

#[cfg(unix)]
#[test]
fn restoring_from_the_trash_never_goes_through_a_link() {
    let t = dev_vault();
    let outside = t.vault.root().with_extension("trash-outside");
    fs::create_dir_all(&outside).unwrap();
    fs::write(outside.join("secret.md"), "---\ntitle: Secret\n---\n").unwrap();
    let stamp = t.vault.root().join(".trash/20260926T000000Z");
    fs::create_dir_all(&stamp).unwrap();
    std::os::unix::fs::symlink(&outside, stamp.join("library")).unwrap();

    let restored = restore_note(&t.vault, ".trash/20260926T000000Z/library/secret.md");
    assert!(restored.is_err(), "restored through a link: {restored:?}");
    assert!(outside.join("secret.md").exists());
    assert!(!t.vault.exists("library/secret.md"));
}

#[cfg(unix)]
#[test]
fn the_tour_and_the_starter_templates_never_go_through_a_link() {
    let t = dev_vault();
    let root = t.vault.root().to_path_buf();
    let outside = root.with_extension("made-outside");
    fs::create_dir_all(&outside).unwrap();
    for folder in ["library", "templates"] {
        fs::rename(root.join(folder), root.join(format!("{folder}-before"))).unwrap();
        std::os::unix::fs::symlink(&outside, root.join(folder)).unwrap();
    }
    let k = Kasten::open(&root).unwrap();
    let _ = k.add_tour(&Actor::Human, NOW);
    let _ = k.add_starter_templates(&Actor::Human, NOW);
    assert_eq!(fs::read_dir(&outside).unwrap().count(), 0);
}
