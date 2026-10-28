//! Smart pages are an optional plugin, off until a person turns them on, with a
//! switch of each project. The setting for a page is its project's key if it
//! has one, else the vault's plugin. Agents are refused while it is off and can
//! only ask; asking never turns anything on, in any mode.

use crate::common::NOW;
use crate::smart_support::{
    all_files, dir_of, done, make_page, open, open_off, put_folder, session, set_mode, undo_last,
    write,
};

use kasten_core::agent::{AgentOp, SmartNewFile};
use kasten_core::config_keys::AgentMode;
use kasten_core::history::Actor;
use kasten_core::{Kasten, Outcome, ProjectSmart};

const PROJECT: &str = "projects/photo-organiser/_project.md";
const OTHER: &str = "projects/note-taking-study/_project.md";

fn agent() -> Actor {
    Actor::Agent {
        client: "claude-code".into(),
        session: "01K5ZK00000000000000000009".into(),
    }
}

fn create(title: &str, project: Option<&str>) -> AgentOp {
    AgentOp::SmartCreate {
        title: title.into(),
        project: project.map(str::to_owned),
        parent: None,
        files: vec![SmartNewFile {
            path: "index.html".into(),
            content: "<h1>Hi</h1>".into(),
        }],
        reason: Some("test".into()),
    }
}

fn ask(project: Option<&str>) -> AgentOp {
    AgentOp::RequestSmartPages {
        reason: "A tracker would show the deadlines better".into(),
        project: project.map(str::to_owned),
    }
}

fn set_project(k: &Kasten, page: &str, setting: ProjectSmart) -> bool {
    k.set_project_smart_pages(&Actor::Human, page, setting, NOW)
        .unwrap()
}

fn commits(k: &Kasten) -> usize {
    k.log(None, 1000).unwrap().len()
}

#[test]
fn a_fresh_vault_has_smart_pages_off_everywhere() {
    let (_t, k) = open_off();
    assert!(!k.config().plugin_enabled("smart"));
    assert!(!k.smart_enabled_for_page("library/anything.md"));
    assert!(!k.smart_enabled_for_page("projects/photo-organiser/pages/a.md"));
    assert!(!k.smart_enabled_anywhere());
    assert_eq!(k.project_smart("photo-organiser"), ProjectSmart::Vault);
}

#[test]
fn a_person_turns_the_plugin_on_in_one_commit_and_undo_takes_it_back() {
    let (_t, k) = open_off();
    let before = commits(&k);
    assert!(
        k.set_plugin_enabled(&Actor::Human, "smart", true, NOW)
            .unwrap()
    );
    assert!(k.config().plugin_enabled("smart"));
    assert_eq!(commits(&k), before + 1);
    assert!(k.smart_enabled_for_page("library/anything.md"));
    undo_last(&k);
    assert!(!k.config().plugin_enabled("smart"));
    assert!(
        k.set_plugin_enabled(&agent(), "smart", true, NOW).is_err(),
        "an agent cannot"
    );
}

#[test]
fn a_project_key_beats_the_vault_either_way_and_no_key_follows_it() {
    let (_t, k) = open_off();
    let in_project = "projects/photo-organiser/pages/a.md";
    let in_other = "projects/note-taking-study/pages/b.md";

    // Vault off: a project that says on is on, the rest are off.
    assert!(set_project(&k, PROJECT, ProjectSmart::On));
    assert!(k.smart_enabled_for_page(in_project));
    assert!(!k.smart_enabled_for_page(in_other));
    assert!(!k.smart_enabled_for_page("library/x.md"));
    assert!(k.smart_enabled_anywhere(), "the tools are offered");

    // Vault on: a project that says off is off, the rest follow the vault.
    k.set_plugin_enabled(&Actor::Human, "smart", true, NOW)
        .unwrap();
    set_project(&k, PROJECT, ProjectSmart::Off);
    assert!(!k.smart_enabled_for_page(in_project));
    assert!(k.smart_enabled_for_page(in_other));
    assert!(k.smart_enabled_for_page("library/x.md"));

    // "The vault's choice" takes the key away.
    set_project(&k, PROJECT, ProjectSmart::Vault);
    assert!(k.smart_enabled_for_page(in_project));
    assert_eq!(k.project_smart("photo-organiser"), ProjectSmart::Vault);
    let text = std::fs::read_to_string(_t.vault.root().join(PROJECT)).unwrap();
    assert!(!text.contains("smart_pages"), "{text}");
}

#[test]
fn a_page_moved_between_projects_takes_the_setting_of_its_new_place() {
    let (_t, k) = open();
    set_project(&k, PROJECT, ProjectSmart::Off);
    let page = make_page(&k, "Tracker", Some("note-taking-study"), None);
    assert!(k.smart_enabled_for_page(&page.meta.path));
    let moved = k
        .move_note(&Actor::Human, &page.meta.path, Some("photo-organiser"))
        .unwrap();
    assert!(
        moved.meta.path.starts_with("projects/photo-organiser/"),
        "{}",
        moved.meta.path
    );
    assert!(!k.smart_enabled_for_page(&moved.meta.path), "off there");
    let back = k.move_note(&Actor::Human, &moved.meta.path, None).unwrap();
    assert!(
        k.smart_enabled_for_page(&back.meta.path),
        "the vault's again"
    );
}

#[test]
fn the_project_switch_is_a_persons_one_commit_that_undo_takes_back_and_keeps_the_rest_of_the_page()
{
    let (t, k) = open_off();
    let file = t.vault.root().join(PROJECT);
    let before_text = std::fs::read_to_string(&file).unwrap();
    let before = commits(&k);

    assert!(set_project(&k, PROJECT, ProjectSmart::On));
    assert_eq!(commits(&k), before + 1);
    let written = std::fs::read_to_string(&file).unwrap();
    assert!(written.contains("smart_pages: on"), "{written}");
    for kept in [
        "icon: 📷",
        "tags: [project]",
        "# Photo organiser",
        "[[Photo organiser roadmap]]",
    ] {
        assert!(written.contains(kept), "{kept} stays: {written}");
    }

    // Saying what is already so writes nothing.
    assert!(!set_project(&k, PROJECT, ProjectSmart::On));
    assert_eq!(commits(&k), before + 1);

    undo_last(&k);
    assert_eq!(std::fs::read_to_string(&file).unwrap(), before_text);
    assert_eq!(k.project_smart("photo-organiser"), ProjectSmart::Vault);

    // Not by an agent; not on a page that is not a project's.
    assert!(
        k.set_project_smart_pages(&agent(), PROJECT, ProjectSmart::On, NOW)
            .is_err()
    );
    assert!(
        k.set_project_smart_pages(&Actor::Human, "library/x.md", ProjectSmart::On, NOW)
            .is_err()
    );
}

#[test]
fn an_agent_is_refused_while_smart_pages_are_off_and_told_to_ask() {
    let (t, k) = open_off();
    let page = make_page(&k, "Tracker", None, None);
    k.set_meta(&Actor::Human, &page.meta.path, "layout", Some("smart"), NOW)
        .unwrap();
    put_folder(
        &t,
        &k,
        &page.meta.path,
        &[("index.html", b"<p>x</p>".to_vec())],
    );
    let before = all_files(&t);

    for (name, op) in [
        ("create", create("Deadlines", None)),
        ("write", write(&page.meta.path, "app.js", "x", "")),
    ] {
        for mode in [
            AgentMode::Review,
            AgentMode::Balanced,
            AgentMode::Autonomous,
        ] {
            set_mode(&k, mode, &[]);
            let err = k.agent_run(&session(), &op, NOW).unwrap_err().to_string();
            assert!(
                err.contains("request_smart_pages"),
                "{name} {mode:?}: {err}"
            );
        }
    }
    assert_eq!(all_files(&t), before, "nothing was written");
}

#[test]
fn an_agent_works_where_it_is_on_and_is_refused_where_the_project_says_off() {
    let (t, k) = open();
    set_project(&k, PROJECT, ProjectSmart::Off);
    let err = k
        .agent_run(
            &session(),
            &create("Deadlines", Some("photo-organiser")),
            NOW,
        )
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("photo-organiser") && err.contains("request_smart_pages"),
        "{err}"
    );

    // A page in that project is refused too; the same call in another place runs.
    let inside = make_page(&k, "Inside", Some("photo-organiser"), None);
    k.set_meta(
        &Actor::Human,
        &inside.meta.path,
        "layout",
        Some("smart"),
        NOW,
    )
    .unwrap();
    put_folder(
        &t,
        &k,
        &inside.meta.path,
        &[("index.html", b"<p>x</p>".to_vec())],
    );
    let err = k
        .agent_run(
            &session(),
            &write(&inside.meta.path, "app.js", "x", ""),
            NOW,
        )
        .unwrap_err()
        .to_string();
    assert!(err.contains("request_smart_pages"), "{err}");
    assert!(!there_in(&t, &inside.meta.path, "app.js"));

    let made = done(
        k.agent_run(
            &session(),
            &create("Deadlines", Some("note-taking-study")),
            NOW,
        )
        .unwrap(),
    );
    assert_eq!(made["status"], "created");
    let library = done(
        k.agent_run(&session(), &create("Elsewhere", None), NOW)
            .unwrap(),
    );
    assert_eq!(library["status"], "created");
}

fn there_in(t: &crate::common::TempVault, page: &str, rel: &str) -> bool {
    t.vault.root().join(dir_of(page)).join(rel).exists()
}

#[test]
fn a_request_is_always_kept_for_the_person_in_every_mode_and_turns_nothing_on() {
    for mode in [
        AgentMode::Review,
        AgentMode::Balanced,
        AgentMode::Autonomous,
    ] {
        let (_t, k) = open_off();
        set_mode(&k, mode, &[]);
        let outcome = k.agent_run(&session(), &ask(None), NOW).unwrap();
        assert!(
            matches!(outcome, Outcome::PendingReview { .. }),
            "{mode:?}: {outcome:?}"
        );
        assert!(!k.config().plugin_enabled("smart"), "{mode:?}");
        let waiting = k.proposals().unwrap();
        assert_eq!(waiting.len(), 1, "{mode:?}");
        assert!(
            waiting[0]
                .diff
                .starts_with("An agent asks to turn on smart pages: A tracker would show"),
            "{}",
            waiting[0].diff
        );
        assert_eq!(waiting[0].client, "claude-code");
    }
}

#[test]
fn accepting_the_request_turns_the_plugin_on_and_rejecting_changes_nothing() {
    let (_t, k) = open_off();
    let Outcome::PendingReview { proposal, .. } = k.agent_run(&session(), &ask(None), NOW).unwrap()
    else {
        panic!("kept for review")
    };
    // The request itself changed no setting.
    assert!(!k.smart_enabled_for_page("library/x.md"));
    k.accept_proposal(&proposal, "me", NOW).unwrap();
    assert!(k.config().plugin_enabled("smart"));
    assert!(
        k.proposals().unwrap().is_empty(),
        "decided, no longer waiting"
    );
    let on = &k.log(None, 5).unwrap();
    assert!(
        on.iter().any(|c| c.summary == "plugins: turn smart on"),
        "{on:?}"
    );

    let (_t2, k2) = open_off();
    let Outcome::PendingReview { proposal, .. } =
        k2.agent_run(&session(), &ask(None), NOW).unwrap()
    else {
        panic!("kept for review")
    };
    let before = commits(&k2);
    k2.reject_proposal(&proposal, "me", NOW).unwrap();
    assert!(!k2.config().plugin_enabled("smart"));
    assert!(!k2.smart_enabled_anywhere());
    assert!(k2.proposals().unwrap().is_empty());
    assert_eq!(commits(&k2), before + 1, "only the decision is recorded");
}

#[test]
fn a_request_for_a_project_turns_on_that_project_only() {
    let (_t, k) = open_off();
    let Outcome::PendingReview { proposal, .. } = k
        .agent_run(&session(), &ask(Some("Photo organiser")), NOW)
        .unwrap()
    else {
        panic!("kept for review")
    };
    let waiting = k.proposals().unwrap();
    assert!(
        waiting[0].diff.contains("the project “Photo organiser”"),
        "{}",
        waiting[0].diff
    );
    k.accept_proposal(&proposal, "me", NOW).unwrap();
    assert!(!k.config().plugin_enabled("smart"), "the vault stays off");
    assert_eq!(k.project_smart("photo-organiser"), ProjectSmart::On);
    assert!(k.smart_enabled_for_page("projects/photo-organiser/pages/a.md"));
    assert!(!k.smart_enabled_for_page("projects/note-taking-study/pages/a.md"));
}

#[test]
fn a_request_is_refused_for_no_reason_an_unknown_project_what_is_on_and_a_repeat() {
    let (_t, k) = open_off();
    let s = session();
    let blank = AgentOp::RequestSmartPages {
        reason: "  ".into(),
        project: None,
    };
    assert!(k.agent_run(&s, &blank, NOW).is_err());
    assert!(k.agent_run(&s, &ask(Some("No such project")), NOW).is_err());
    assert!(k.proposals().unwrap().is_empty());

    k.agent_run(&s, &ask(None), NOW).unwrap();
    let again = k.agent_run(&s, &ask(None), NOW).unwrap_err().to_string();
    assert!(again.contains("asked already"), "{again}");
    assert_eq!(k.proposals().unwrap().len(), 1);

    set_project(&k, OTHER, ProjectSmart::On);
    let on = k
        .agent_run(&s, &ask(Some("note-taking-study")), NOW)
        .unwrap_err()
        .to_string();
    assert!(on.contains("already on"), "{on}");
}

#[test]
fn turning_smart_pages_off_deletes_nothing_and_a_person_can_still_edit() {
    let (t, k) = open();
    let made = done(
        k.agent_run(&session(), &create("Deadlines", None), NOW)
            .unwrap(),
    );
    let page = made["page"].as_str().unwrap().to_owned();
    let before = all_files(&t);

    k.set_plugin_enabled(&Actor::Human, "smart", false, NOW)
        .unwrap();
    assert_eq!(all_files(&t), before, "every page and file is as it was");
    assert!(!k.smart_enabled_for_page(&page));
    assert!(there_in(&t, &page, "index.html"));
    assert!(
        k.smart_write_file(&Actor::Human, &page, "app.js", b"let a;", Some(""), NOW)
            .is_ok(),
        "a person still edits the code"
    );
    let err = k
        .agent_run(&session(), &write(&page, "b.js", "x", ""), NOW)
        .unwrap_err()
        .to_string();
    assert!(err.contains("request_smart_pages"), "{err}");
}
