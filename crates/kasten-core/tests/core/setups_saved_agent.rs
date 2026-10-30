//! Saving a project as a setup from an agent: it always waits for review in
//! Balanced and Review (it writes into `templates/`, which agents never write on
//! their own), is taken at once in Autonomous, is refused for a locked project
//! or page, and cannot be aimed outside the project or `templates/setups/`.

use std::fs;

use crate::change_sets::{open, snapshot};
use crate::common::NOW;
use crate::setups_saved::{DRAFT, PROJECT, RELATED, pages, read};
use crate::structure::{done, pending};
use crate::structure_agent::{Has, set_mode};
use kasten_core::agent::AgentOp;
use kasten_core::config_keys::{AgentMode, AgentsConfig, ProjectAgents};
use kasten_core::history::Actor;

const PROJECT_PAGE: &str = "projects/note-taking-study/_project.md";

fn save(title: &str, include: Option<&[&str]>) -> AgentOp {
    AgentOp::SaveProjectSetup {
        project: PROJECT.into(),
        slug: String::new(),
        title: title.into(),
        pages: include.map(pages),
    }
}

#[test]
fn an_agent_save_always_waits_in_balanced_and_review_and_is_taken_in_autonomous() {
    let (t, k, s) = open();
    for mode in [AgentMode::Balanced, AgentMode::Review] {
        set_mode(&k, mode);
        let id = pending(
            k.agent_run(&s, &save("Study kit", Some(&[DRAFT])), NOW)
                .unwrap(),
        );
        assert!(!k.vault_has("templates/setups/study-kit.yaml"), "{mode:?}");
        let held = &k.proposals().unwrap()[0];
        assert!(held.reason.contains("setup"), "{}", held.reason);
        assert!(
            held.diff.contains("Study kit") && !held.diff.contains("save_project_setup"),
            "{}",
            held.diff
        );
        k.accept_proposal(&id, "me", NOW).unwrap();
        assert!(k.vault_has("templates/setups/study-kit.yaml"), "{mode:?}");
        assert!(k.proposals().unwrap().is_empty());
        // Clean up for the next round.
        fs::remove_file(t.vault.root().join("templates/setups/study-kit.yaml")).unwrap();
        fs::remove_dir_all(t.vault.root().join("templates/setups/study-kit")).unwrap();
    }
    set_mode(&k, AgentMode::Autonomous);
    let told = done(
        k.agent_run(&s, &save("Study kit", Some(&[DRAFT])), NOW)
            .unwrap(),
    );
    assert_eq!(told["setup"], "saved:study-kit");
    assert!(k.vault_has("templates/setups/study-kit/pages/report-draft.md"));
    let head = &k.log(None, 1).unwrap()[0];
    assert!(
        head.agent && head.mode.as_deref() == Some("autonomous"),
        "{head:?}"
    );
    assert_eq!(head.op.as_deref(), Some("save_project_setup"));
}

#[test]
fn with_no_pages_named_an_agent_saves_the_pages_directly_under_the_projects_pages_folder() {
    let (t, k, s) = open();
    set_mode(&k, AgentMode::Autonomous);
    let deep = "projects/note-taking-study/pages/extra/deep.md";
    fs::create_dir_all(
        t.vault
            .root()
            .join("projects/note-taking-study/pages/extra"),
    )
    .unwrap();
    fs::write(
        t.vault.root().join(deep),
        "---\ntitle: Deep\ntype: page\n---\nx\n",
    )
    .unwrap();
    k.reindex().unwrap();
    done(k.agent_run(&s, &save("Defaults", None), NOW).unwrap());
    assert!(k.vault_has("templates/setups/defaults/pages/report-draft.md"));
    assert!(k.vault_has("templates/setups/defaults/pages/related-work-notes.md"));
    assert!(!k.vault_has("templates/setups/defaults/pages/deep.md"));
}

#[test]
fn a_locked_project_or_page_stops_an_agent_in_every_mode_and_a_person_is_not_stopped() {
    let (t, k, s) = open();
    k.set_meta(&Actor::Human, DRAFT, "locked", Some("true"), NOW)
        .unwrap();
    for mode in [
        AgentMode::Balanced,
        AgentMode::Review,
        AgentMode::Autonomous,
    ] {
        set_mode(&k, mode);
        let before_mode = snapshot(t.vault.root());
        for named in [Some(&[DRAFT][..]), None] {
            let err = k
                .agent_run(&s, &save("Kit", named), NOW)
                .unwrap_err()
                .to_string();
            assert!(err.contains("locked"), "{mode:?}: {err}");
        }
        let after = snapshot(t.vault.root());
        let changed: Vec<&String> = after
            .keys()
            .chain(before_mode.keys())
            .filter(|key| after.get(*key) != before_mode.get(*key))
            .collect();
        assert!(changed.is_empty(), "{mode:?}: {changed:?}");
        assert!(k.proposals().unwrap().is_empty(), "{mode:?}");
    }
    // A page that is not locked can still be saved; the person can save anything.
    set_mode(&k, AgentMode::Balanced);
    pending(
        k.agent_run(&s, &save("Kit", Some(&[RELATED])), NOW)
            .unwrap(),
    );
    k.save_project_setup(&Actor::Human, PROJECT, "", "Mine", &pages(&[DRAFT]), NOW)
        .unwrap();
    // A locked project page stops an agent whatever pages it names.
    let (t2, k2, s2) = open();
    k2.set_meta(&Actor::Human, PROJECT_PAGE, "locked", Some("true"), NOW)
        .unwrap();
    for mode in [
        AgentMode::Balanced,
        AgentMode::Review,
        AgentMode::Autonomous,
    ] {
        set_mode(&k2, mode);
        let before = snapshot(t2.vault.root());
        let err = k2
            .agent_run(&s2, &save("Kit", Some(&[RELATED])), NOW)
            .unwrap_err()
            .to_string();
        assert!(err.contains("locked"), "{mode:?}: {err}");
        assert!(snapshot(t2.vault.root()) == before, "{mode:?}");
        assert!(k2.proposals().unwrap().is_empty(), "{mode:?}");
    }
    assert!(
        k2.save_project_setup(&s2.actor(), PROJECT, "", "Kit", &[], NOW)
            .unwrap_err()
            .to_string()
            .contains("locked"),
        "the op refuses an agent that calls it directly too"
    );
    k2.save_project_setup(&Actor::Human, PROJECT, "", "Kit", &[], NOW)
        .unwrap();
}

#[test]
fn an_agent_cannot_aim_a_save_outside_the_project_or_at_a_path_and_nothing_is_queued() {
    let (t, k, s) = open();
    for mode in [
        AgentMode::Balanced,
        AgentMode::Review,
        AgentMode::Autonomous,
    ] {
        set_mode(&k, mode);
        let before = snapshot(t.vault.root());
        let mut ops = Vec::new();
        for slug in ["../x", "a/b", "..", "x.yaml", "UPPER", "con"] {
            ops.push(AgentOp::SaveProjectSetup {
                project: PROJECT.into(),
                slug: slug.into(),
                title: "Kit".into(),
                pages: Some(vec![]),
            });
        }
        for path in [
            "../../outside.md",
            "projects/photo-organiser/pages/photo-organiser-roadmap.md",
            "templates/journal.md",
            PROJECT_PAGE,
            ".trash/x/a.md",
            "projects/note-taking-study/pages/missing.md",
        ] {
            ops.push(save("Kit", Some(&[path])));
        }
        for project in [
            "",
            "no-such-project",
            "../photo-organiser",
            "projects/x/../y",
        ] {
            ops.push(AgentOp::SaveProjectSetup {
                project: project.into(),
                slug: String::new(),
                title: "Kit".into(),
                pages: None,
            });
        }
        ops.push(save("", None));
        for op in &ops {
            assert!(k.agent_run(&s, op, NOW).is_err(), "{mode:?}: {op:?}");
        }
        assert_eq!(snapshot(t.vault.root()), before, "{mode:?}");
        assert!(k.proposals().unwrap().is_empty(), "{mode:?}");
    }
}

#[test]
fn the_projects_own_mode_judges_the_save_whatever_case_the_agent_spells_it_in() {
    let (_t, k, s) = open();
    let mut config = k.config();
    let mut agents = AgentsConfig {
        mode: Some(AgentMode::Autonomous),
        ..AgentsConfig::default()
    };
    agents.projects.insert(
        PROJECT.to_owned(),
        ProjectAgents {
            mode: Some(AgentMode::Review),
            ..ProjectAgents::default()
        },
    );
    config.agents = Some(agents);
    k.set_config(config).unwrap();
    for (n, spelled) in [
        PROJECT.to_owned(),
        PROJECT.to_uppercase(),
        "Note-Taking-Study".to_owned(),
        PROJECT_PAGE.to_owned(),
        PROJECT_PAGE.to_uppercase(),
    ]
    .into_iter()
    .enumerate()
    {
        let op = AgentOp::SaveProjectSetup {
            project: spelled.clone(),
            slug: String::new(),
            title: format!("Kit {n}"),
            pages: Some(vec![]),
        };
        // Autonomous in the vault, Review in the project: the save waits, or is refused; it is never taken.
        if let Ok(outcome) = k.agent_run(&s, &op, NOW) {
            pending(outcome);
        }
        assert!(
            !k.vault_has(&format!("templates/setups/kit-{n}.yaml")),
            "{spelled}: written without review"
        );
    }
    assert!(
        !k.proposals().unwrap().is_empty(),
        "at least the exact spelling waits"
    );
}

#[test]
fn an_agent_cannot_save_a_page_whose_header_cannot_be_read_and_a_lock_set_while_it_waited_stops_the_accept()
 {
    let (t, k, s) = open();
    let broken = "projects/note-taking-study/pages/broken.md";
    fs::write(
        t.vault.root().join(broken),
        "---\ntitle: [oops\n---\nbody\n",
    )
    .unwrap();
    k.reindex().unwrap();
    for mode in [AgentMode::Balanced, AgentMode::Autonomous] {
        set_mode(&k, mode);
        assert!(k.agent_run(&s, &save("Kit", Some(&[broken])), NOW).is_err());
    }
    assert!(k.proposals().unwrap().is_empty());
    // A proposal made while the page was open is refused once the page is locked.
    set_mode(&k, AgentMode::Balanced);
    let id = pending(k.agent_run(&s, &save("Kit", Some(&[DRAFT])), NOW).unwrap());
    k.set_meta(&Actor::Human, DRAFT, "locked", Some("true"), NOW)
        .unwrap();
    let before = snapshot(t.vault.root());
    assert!(k.accept_proposal(&id, "me", NOW).is_err());
    assert!(snapshot(t.vault.root()) == before);
    assert!(!k.vault_has("templates/setups/kit.yaml"));
}

#[test]
fn a_save_cannot_ride_in_a_batch_past_the_modes() {
    let (t, k, s) = open();
    set_mode(&k, AgentMode::Autonomous);
    let ops = vec![
        AgentOp::Append {
            path: DRAFT.into(),
            markdown: "More.".into(),
            heading: None,
        },
        save("Kit", Some(&[DRAFT])),
    ];
    let before = snapshot(t.vault.root());
    let err = k
        .agent_run(
            &s,
            &AgentOp::Batch {
                ops,
                reason: Some("test".into()),
            },
            NOW,
        )
        .unwrap_err()
        .to_string();
    assert!(err.contains("cannot be part of a batch"), "{err}");
    assert!(snapshot(t.vault.root()) == before);
}

#[test]
fn an_agent_starts_a_project_from_a_saved_setup_and_one_that_adds_schemas_waits() {
    let (t, k, s) = open();
    k.save_project_setup(
        &Actor::Human,
        PROJECT,
        "",
        "Study kit",
        &pages(&[DRAFT, RELATED]),
        NOW,
    )
    .unwrap();
    let make = |title: &str| AgentOp::CreateProject {
        title: title.into(),
        setup: Some("saved:study-kit".into()),
    };
    // The vault has the schema already: an ordinary new project.
    set_mode(&k, AgentMode::Balanced);
    let told = done(k.agent_run(&s, &make("Agent made"), NOW).unwrap());
    assert!(
        told["written"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p == "projects/agent-made/pages/report-draft.md")
    );
    assert!(k.vault_has("projects/agent-made/pages/related-work-notes.md"));
    // Without it the setup would make a tag schema, and that always waits.
    fs::remove_file(t.vault.root().join("tags/paper.yaml")).unwrap();
    let id = pending(k.agent_run(&s, &make("Needs schema"), NOW).unwrap());
    assert!(!k.vault_has("projects/needs-schema/_project.md"));
    k.accept_proposal(&id, "me", NOW).unwrap();
    assert!(read(t.vault.root(), "tags/paper.yaml").contains("Pipeline"));
    // A name that is not a saved setup is refused, and so is one that is a path.
    for bad in ["saved:nothing", "saved:../x", "saved:a/b"] {
        let op = AgentOp::CreateProject {
            title: "T".into(),
            setup: Some(bad.into()),
        };
        assert!(k.agent_run(&s, &op, NOW).is_err(), "{bad}");
    }
    // An agent still cannot apply a setup to a project that is there.
    let err = k
        .apply_setup(
            &s.actor(),
            "saved:study-kit",
            &kasten_core::SetupTarget::Existing {
                folder: "photo-organiser".into(),
            },
            NOW,
        )
        .unwrap_err()
        .to_string();
    assert!(err.contains("agent"), "{err}");
}
