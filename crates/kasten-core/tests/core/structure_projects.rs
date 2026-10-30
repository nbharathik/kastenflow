//! What an agent may do with projects: make one (empty or from a setup), set
//! its state through the checking op, and not through `update_props`.

use serde_json::{Map, Value, json};

use crate::change_sets::{open, snapshot};
use crate::common::NOW;
use crate::structure::{commits, done, pending, text_of};
use crate::structure_agent::{Has, batch, set_mode};
use kasten_core::ProjectState;
use kasten_core::agent::AgentOp;
use kasten_core::config_keys::AgentMode;
use kasten_core::history::Actor;

const PROJECT_PAGE: &str = "projects/note-taking-study/_project.md";
const DRAFT: &str = "projects/note-taking-study/pages/report-draft.md";

fn project(title: &str, setup: Option<&str>) -> AgentOp {
    AgentOp::CreateProject {
        title: title.into(),
        setup: setup.map(str::to_owned),
    }
}

fn state(change: impl FnOnce(&mut ProjectState)) -> ProjectState {
    let mut state = ProjectState::default();
    change(&mut state);
    state
}

fn set(value: &str) -> Option<Option<String>> {
    Some(Some(value.to_owned()))
}

fn props(pairs: &[(&str, Value)]) -> Map<String, Value> {
    pairs
        .iter()
        .map(|(k, v)| ((*k).to_owned(), v.clone()))
        .collect()
}

// ---- create_project ----

#[test]
fn an_agent_makes_a_project_in_one_commit() {
    let (t, k, s) = open();
    let before = commits(&k);
    let told = done(
        k.agent_run(&s, &project("Greenhouse build", None), NOW)
            .unwrap(),
    );
    assert_eq!(told["path"], "projects/greenhouse-build/_project.md");
    let made = k.read("projects/greenhouse-build/_project.md").unwrap();
    assert_eq!(
        (made.meta.kind.as_str(), made.meta.title.as_str()),
        ("project", "Greenhouse build")
    );
    assert_eq!(commits(&k), before + 1);
    let head = &k.log(None, 1).unwrap()[0];
    assert!(head.agent && head.session.as_deref() == Some(s.id.as_str()));
    // A second one with the same name is another project, never the first overwritten.
    let again = done(
        k.agent_run(&s, &project("Greenhouse build", None), NOW)
            .unwrap(),
    );
    assert_eq!(again["path"], "projects/greenhouse-build-2/_project.md");
    assert_eq!(
        text_of(&t, "projects/greenhouse-build/_project.md"),
        made.text
    );
}

#[test]
fn a_project_title_must_be_a_title() {
    let (t, k, s) = open();
    let before = snapshot(t.vault.root());
    for title in ["", "   ", "Bad | title", "Has [brackets]", "Two\nlines"] {
        let err = k.agent_run(&s, &project(title, None), NOW);
        assert!(err.is_err(), "{title:?}");
    }
    let err = k
        .agent_run(&s, &project("Fine", Some("no-such-setup")), NOW)
        .unwrap_err()
        .to_string();
    assert!(err.contains("no-such-setup"), "{err}");
    assert_eq!(snapshot(t.vault.root()), before);
    assert!(k.proposals().unwrap().is_empty());
}

#[test]
fn making_projects_counts_toward_the_limit_of_notes_in_ten_minutes() {
    let (_t, k, s) = open();
    let mut config = k.config();
    config.guardrails.max_notes_per_session_10min = 1;
    k.set_config(config).unwrap();
    done(k.agent_run(&s, &project("First", None), NOW).unwrap());
    let waits = k.agent_run(&s, &project("Second", None), NOW).unwrap();
    pending(waits);
    assert!(!k.vault_has("projects/second/_project.md"));
    // A person who trusts the session lifts the soft limit.
    k.trust_session(&s.id, NOW.millis + 3_600_000).unwrap();
    done(k.agent_run(&s, &project("Second", None), NOW).unwrap());
}

#[test]
fn review_everything_holds_a_new_project_as_a_proposal_and_accepting_makes_it() {
    let (_t, k, s) = open();
    set_mode(&k, AgentMode::Review);
    let id = pending(
        k.agent_run(&s, &project("Held project", None), NOW)
            .unwrap(),
    );
    assert!(!k.vault_has("projects/held-project/_project.md"));
    let log = k.log(None, 3).unwrap();
    assert!(
        log.iter().all(|c| c.op.as_deref() != Some("create_note")),
        "only the proposal is written: {log:?}"
    );
    k.accept_proposal(&id, "me", NOW).unwrap();
    assert!(k.vault_has("projects/held-project/_project.md"));
}

#[test]
fn a_setup_brings_its_files_and_one_that_adds_tag_schemas_waits_for_review() {
    let (_t, k, s) = open();
    // Writing adds pages and a board and no schema: an ordinary write.
    let told = done(
        k.agent_run(&s, &project("Paper two", Some("writing")), NOW)
            .unwrap(),
    );
    let written: Vec<&str> = told["written"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(Value::as_str)
        .collect();
    assert!(
        written.contains(&"projects/paper-two/boards/structure.canvas"),
        "{written:?}"
    );
    assert!(
        written.contains(&"projects/paper-two/pages/outline.md"),
        "{written:?}"
    );
    // Research would make a tag schema the vault lacks: a schema always waits.
    let before = commits(&k);
    let id = pending(
        k.agent_run(&s, &project("Study two", Some("research")), NOW)
            .unwrap(),
    );
    assert!(!k.vault_has("projects/study-two/_project.md"));
    assert!(!k.vault_has("tags/reading.yaml"));
    assert_eq!(commits(&k), before + 1);
    k.accept_proposal(&id, "me", NOW).unwrap();
    assert!(k.vault_has("tags/reading.yaml") && k.vault_has("projects/study-two/_project.md"));
}

#[test]
fn autonomous_mode_makes_the_research_project_with_its_schemas() {
    let (_t, k, s) = open();
    set_mode(&k, AgentMode::Autonomous);
    done(
        k.agent_run(&s, &project("Study three", Some("research")), NOW)
            .unwrap(),
    );
    assert!(k.vault_has("tags/reading.yaml"));
    let head = &k.log(None, 1).unwrap()[0];
    assert!(head.agent && head.mode.as_deref() == Some("autonomous"));
}

#[test]
fn an_agent_still_cannot_apply_a_setup_as_such() {
    let (_t, k, s) = open();
    let target = kasten_core::SetupTarget::Existing {
        folder: "photo-organiser".into(),
    };
    assert!(k.apply_setup(&s.actor(), "writing", &target, NOW).is_err());
}

// ---- set_project_state, and update_props keeping off its keys ----

#[test]
fn an_agent_sets_a_projects_state_through_the_checking_op() {
    let (_t, k, s) = open();
    let op = AgentOp::SetProjectState {
        path: PROJECT_PAGE.into(),
        state: state(|st| {
            st.status = set("Paused");
            st.health = set("At risk");
        }),
    };
    done(k.agent_run(&s, &op, NOW).unwrap());
    let page = k.read(PROJECT_PAGE).unwrap();
    assert_eq!(page.meta.props["status"], "Paused");
    assert_eq!(page.meta.props["health"], "At risk");
    let head = &k.log(None, 1).unwrap()[0];
    assert!(head.agent && head.op.as_deref() == Some("set_project_state"));
}

#[test]
fn a_bad_state_or_a_page_that_is_not_a_project_is_refused_and_never_queued() {
    let (t, k, s) = open();
    for mode in [AgentMode::Balanced, AgentMode::Review] {
        set_mode(&k, mode);
        let before = snapshot(t.vault.root());
        for (path, change) in [
            (PROJECT_PAGE, state(|st| st.status = set("Someday"))),
            (PROJECT_PAGE, state(|st| st.reviewed = set("2026-02-30"))),
            (DRAFT, state(|st| st.status = set("Active"))),
        ] {
            let op = AgentOp::SetProjectState {
                path: path.into(),
                state: change,
            };
            assert!(k.agent_run(&s, &op, NOW).is_err(), "{path}");
        }
        assert_eq!(snapshot(t.vault.root()), before);
        assert!(k.proposals().unwrap().is_empty());
    }
}

#[test]
fn review_everything_holds_a_state_change_and_a_locked_project_page_is_refused() {
    let (_t, k, s) = open();
    let op = AgentOp::SetProjectState {
        path: PROJECT_PAGE.into(),
        state: state(|st| st.status = set("Done")),
    };
    set_mode(&k, AgentMode::Review);
    let id = pending(k.agent_run(&s, &op, NOW).unwrap());
    assert!(
        k.read(PROJECT_PAGE)
            .unwrap()
            .meta
            .props
            .get("status")
            .is_none()
    );
    k.accept_proposal(&id, "me", NOW).unwrap();
    assert_eq!(k.read(PROJECT_PAGE).unwrap().meta.props["status"], "Done");
    k.set_meta(&Actor::Human, PROJECT_PAGE, "locked", Some("true"), NOW)
        .unwrap();
    assert!(
        k.agent_run(&s, &op, NOW)
            .unwrap_err()
            .to_string()
            .contains("locked")
    );
}

#[test]
fn update_props_keeps_off_the_keys_of_a_projects_state() {
    let (t, k, s) = open();
    for key in [
        "status",
        "health",
        "next_action",
        "last_review",
        "review_after",
    ] {
        let before = snapshot(t.vault.root());
        let op = AgentOp::UpdateProps {
            path: PROJECT_PAGE.into(),
            props: props(&[(key, json!("x"))]),
        };
        let err = k.agent_run(&s, &op, NOW).unwrap_err().to_string();
        assert!(err.contains("use set_project_state"), "{key}: {err}");
        assert_eq!(snapshot(t.vault.root()), before);
    }
    // One of them among others refuses all of them.
    let mixed = AgentOp::UpdateProps {
        path: PROJECT_PAGE.into(),
        props: props(&[("summary", json!("A summary")), ("Status", json!("Paused"))]),
    };
    assert!(
        k.agent_run(&s, &mixed, NOW)
            .unwrap_err()
            .to_string()
            .contains("use set_project_state")
    );
    assert!(
        k.read(PROJECT_PAGE)
            .unwrap()
            .meta
            .props
            .get("summary")
            .is_none()
    );
    // The same call in the other modes is refused too, not queued.
    for mode in [AgentMode::Review, AgentMode::Autonomous] {
        set_mode(&k, mode);
        assert!(k.agent_run(&s, &mixed, NOW).is_err(), "{mode:?}");
        assert!(k.proposals().unwrap().is_empty(), "{mode:?}");
    }
    set_mode(&k, AgentMode::Balanced);
    // Other keys on a project page, and these keys on other pages, are fine.
    let other = AgentOp::UpdateProps {
        path: PROJECT_PAGE.into(),
        props: props(&[("summary", json!("A summary"))]),
    };
    done(k.agent_run(&s, &other, NOW).unwrap());
    let paper = AgentOp::UpdateProps {
        path: DRAFT.into(),
        props: props(&[("status", json!("Drafting"))]),
    };
    done(k.agent_run(&s, &paper, NOW).unwrap());
}

#[test]
fn update_props_keeps_off_those_keys_inside_a_batch_and_for_an_agent_called_directly() {
    let (t, k, s) = open();
    let before = snapshot(t.vault.root());
    let ops = vec![
        AgentOp::Append {
            path: DRAFT.into(),
            markdown: "More.".into(),
            heading: None,
        },
        AgentOp::UpdateProps {
            path: PROJECT_PAGE.into(),
            props: props(&[("health", json!("Blocked"))]),
        },
    ];
    let err = k.agent_run(&s, &batch(ops), NOW).unwrap_err().to_string();
    assert!(
        err.contains("Change 2 of 2 (update_props)") && err.contains("use set_project_state"),
        "{err}"
    );
    assert_eq!(snapshot(t.vault.root()), before);
    // The ops themselves refuse an agent as well, whatever called them.
    let err = k
        .update_props(
            &s.actor(),
            PROJECT_PAGE,
            &props(&[("status", json!("Done"))]),
            NOW,
        )
        .unwrap_err()
        .to_string();
    assert!(err.contains("use set_project_state"), "{err}");
    // A person's own edit of the page properties is theirs to make.
    k.update_props(
        &Actor::Human,
        PROJECT_PAGE,
        &props(&[("status", json!("Paused"))]),
        NOW,
    )
    .unwrap();
}
